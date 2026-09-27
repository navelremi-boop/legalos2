#!/usr/bin/env node
/**
 * Conflits généralisés — deux postes Tauri (docs/conflits.md § 4–5, PLAN).
 *
 * Critères :
 * - un conflit par table (dossiers, parties, temps, brouillons, taux), modification hors ligne ;
 * - conflit signalé dans l'app ;
 * - S5 : conflit sur dossier restreint ; journal absent du SQLite du poste non autorisé ;
 * - fausse alerte J3 : écriture séquentielle du même poste ≠ conflit ;
 * - refus 400/403/404/409 : table locale, file débloquée, message affiché, écriture suivante OK ;
 * - un champ seul par table ; table inconnue consignée sans bloquer ; PUT/PATCH/DELETE explicites.
 *
 * L'API doit exposer `temps_saisis.revision` (migration 019). Sinon le script échoue.
 *
 * Usage : node tests/recette/conflits-poste-tauri.mjs
 * Ne journalise aucun secret.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAMP_SEUL_PAR_TABLE,
  TABLES_MODIFIABLES,
} from "../../apps/poste/src/sync/uploadContrat.ts";
import {
  accessToken,
  demoAccessToken,
  demoEmail,
  demoPassword,
  totpNow,
  totpSecretB32,
} from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const poste = join(root, "apps/poste");

/** `.env` est ignoré par git : un worktree n'en a pas. Compose cible le dépôt qui le détient. */
function racineInstance() {
  if (existsSync(join(root, ".env"))) return root;
  const principal = join(root, "..", "..");
  if (existsSync(join(principal, ".env"))) return principal;
  return root;
}
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instanceUrl}/api`;
const marque = String(Date.now()).slice(-6);

const collabEmail = "collab-j5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

function fail(message) {
  console.error(`conflits-poste: FAIL — ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlServeur(requete) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "-f",
        "instance/docker-compose.yml",
        "--env-file",
        ".env",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "legalos",
        "-d",
        "legalos",
        "-tAc",
        requete,
      ],
      { cwd: racineInstance(), stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("sql"))));
  });
}

async function apiConflitsPrete() {
  try {
    const colonne = await sqlServeur(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'temps_saisis' AND column_name = 'revision'`,
    );
    return colonne === "1";
  } catch {
    return false;
  }
}

function resetPostesLocaux() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dataDir = join(roaming, "fr.legalos.poste");
  // « c » = poste collab S5 (base neuve : ne pas réutiliser b, pollué par le titulaire).
  for (const id of ["a", "b", "c"]) {
    resetPosteLocal(id, dataDir);
  }
}

function resetPosteLocal(id, dataDir) {
  const base =
    dataDir ?? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "fr.legalos.poste");
  for (const ext of ["", "-shm", "-wal"]) {
    rmSync(join(base, `legalos-powersync-${id}.db${ext}`), { force: true });
  }
}

function portPoste(id) {
  if (id === "a") return "9252";
  if (id === "b") return "9253";
  if (id === "c") return "9254";
  throw new Error(`poste inconnu: ${id}`);
}

function startApp(id) {
  const port = portPoste(id);
  const dir = join(tmpdir(), `legalos-webview-conflits-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-conflits-${id}-${marque}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      app: {
        windows: [
          {
            additionalBrowserArgs: `--remote-debugging-port=${port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`,
          },
        ],
      },
    }),
  );
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm tauri dev --config ${configPath}`], {
    cwd: poste,
    env: {
      ...process.env,
      LEGALOS_POSTE_ID: id,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
      VITE_LEGALOS_RECETTE_HOOKS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 12000) log = log.slice(-12000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.port = port;
  child.logTail = () => log.slice(-1500);
  return child;
}

async function stopApp(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("exit", resolve);
  });
  // Laisse Windows libérer le verrou SQLite PowerSync avant un redémarrage.
  await sleep(2_500);
}

async function connectCdp(port) {
  const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("webview absente");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("websocket")));
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const done = pending.get(msg.id);
    if (done) {
      pending.delete(msg.id);
      done(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

async function evaluate(send, expression) {
  const msg = await Promise.race([
    send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    sleep(30_000).then(() => {
      throw new Error("cdp sans réponse");
    }),
  ]);
  if (msg.result?.exceptionDetails) {
    throw new Error(String(msg.result.exceptionDetails.text ?? "évaluation").slice(0, 200));
  }
  return msg.result?.result?.value;
}

async function waitCdp(child) {
  const start = Date.now();
  while (Date.now() - start < 360_000) {
    if (child.exitCode !== null) throw new Error(`tauri arrêté (${child.exitCode})`);
    try {
      const list = await fetch(`http://127.0.0.1:${child.port}/json`);
      if (list.ok) {
        const pages = await list.json();
        if (pages.some((t) => t.type === "page" && t.webSocketDebuggerUrl)) return;
      }
    } catch {
      /* pas encore */
    }
    await sleep(300);
  }
  throw new Error(`webview ${child.port}`);
}

async function setField(send, id, value) {
  const ok = await evaluate(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (el._valueTracker) el._valueTracker.setValue("");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) throw new Error(`champ ${id}`);
}

async function ecranAuth(send) {
  // Priorité aux formulaires d'auth : après sync l'app ouvre La journée, pas Réglages
  // (cabinet-nom n'est monté que sur l'écran Réglages).
  return String(
    (await evaluate(
      send,
      `document.getElementById("instance-url")
        ? "login"
        : document.getElementById("email")
          ? "creds"
          : document.getElementById("code-totp")
            ? "totp"
            : document.querySelector("[data-testid=ecran-journee],[data-testid=barre-haut],[data-testid=ecran-reglages]")
              ? "local"
              : ""`,
    )) ?? "",
  );
}

/**
 * @param {{ horsLigne?: boolean }} [opts]
 * - horsLigne: true → rester sur la coque locale (écritures → ps_crud) sans reconnecter.
 * - défaut → forcer « Se reconnecter » + sync (upload de la file), sinon la coque hors ligne
 *   court-circuite connect_powersync et les PATCH ne partent jamais.
 */
async function login(send, email, password, secret, nomAppareil, opts = {}) {
  const horsLigne = opts.horsLigne === true;
  const pret = Date.now();
  let ecran = "";
  while (Date.now() - pret < 60_000) {
    ecran = await ecranAuth(send);
    if (ecran === "local") {
      const hooksDeja = await evaluate(
        send,
        `typeof window.__legalosRecette?.patchChampSeul === "function"`,
      );
      if (horsLigne && hooksDeja) return;
      // Bouton sur l'écran Réglages uniquement (pas sur La journée).
      await ouvrirReglages(send);
      const clique = await evaluate(
        send,
        `(() => {
          const b = document.querySelector("[data-testid=se-reconnecter]");
          if (!b) return false;
          b.click();
          return true;
        })()`,
      );
      if (!clique) {
        await evaluate(
          send,
          `[...document.querySelectorAll("button")].find((b) =>
            /reconnecter/i.test(b.innerText || ""))?.click()`,
        );
      }
      const jusqua = Date.now() + 20_000;
      while (Date.now() < jusqua) {
        ecran = await ecranAuth(send);
        if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
        await sleep(200);
      }
    }
    if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
    await sleep(200);
  }
  if (!ecran) {
    const texte = await evaluate(send, "document.body?.innerText ?? ''");
    throw new Error(`écran auth absent — ${String(texte).replace(/\s+/g, " ").slice(-240)}`);
  }
  if (ecran === "local" && !horsLigne) {
    const texte = await evaluate(send, "document.body?.innerText ?? ''");
    throw new Error(
      `reconnexion absente (toujours hors ligne) — ${String(texte).replace(/\s+/g, " ").slice(-240)}`,
    );
  }
  if (ecran === "login") {
    await setField(send, "instance-url", instanceUrl);
    await evaluate(send, `document.getElementById("instance-url")?.closest("form")?.requestSubmit()`);
  }
  if (ecran === "login" || ecran === "creds") {
    const debut = Date.now();
    while (Date.now() - debut < 45_000) {
      if (await evaluate(send, `Boolean(document.getElementById("email"))`)) break;
      await sleep(200);
    }
    await setField(send, "email", email);
    await setField(send, "password", password);
    await setField(send, "nom-appareil", nomAppareil);
    await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  }
  let totpSoumis = ecran === "totp";
  const totpStart = Date.now();
  while (Date.now() - totpStart < 180_000) {
    if (!totpSoumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await setField(send, "code-totp", totpNow(secret));
      await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
      totpSoumis = true;
    }
    // Hooks dès le boot : attendre sync réelle (cabinet + coque). Ignorer les champs
    // d'auth encore présents mais masqués après démontage du flux (offsetParent null).
    const syncOk = await evaluate(
      send,
      `(async () => {
        if (typeof window.__legalosRecette?.lireSqlite !== "function") return false;
        const rows = await window.__legalosRecette.lireSqlite("SELECT id FROM cabinets LIMIT 1");
        if (!Array.isArray(rows) || rows.length === 0) return false;
        const coque = document.querySelector(
          "[data-testid=ecran-journee],[data-testid=barre-haut],[data-testid=ecran-reglages]",
        );
        if (!coque) return false;
        const visible = (id) => {
          const el = document.getElementById(id);
          return Boolean(el && el.offsetParent !== null);
        };
        return !visible("code-totp") && !visible("instance-url") && !visible("email");
      })()`,
    );
    if (totpSoumis && syncOk) return;
    await sleep(250);
  }
  const texte = await evaluate(send, "document.body?.innerText ?? ''");
  throw new Error(
    `journée absente — ${String(texte).replace(/\s+/g, " ").slice(-240)}`,
  );
}

function compose(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", ...args],
      { cwd: racineInstance(), stdio: "ignore" },
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`compose ${args[0]}`))));
  });
}

async function attendreSql(requete, attendu, ms = 90_000) {
  const start = Date.now();
  let vu = "";
  while (Date.now() - start < ms) {
    vu = await sqlServeur(requete);
    if (vu === attendu) return vu;
    await sleep(500);
  }
  throw new Error(`sql ${vu || "vide"} ≠ ${attendu}`);
}

async function avecPoste(id, email, password, secret, nom, fn) {
  const child = startApp(id);
  try {
    await waitCdp(child);
    const page = await connectCdp(child.port);
    await login(page.send, email, password, secret, nom);
    const result = await fn(page.send, child);
    page.ws.close();
    return result;
  } catch (err) {
    console.error(child.logTail());
    throw err;
  } finally {
    await stopApp(child);
  }
}

/**
 * Sync en ligne, déconnexion PowerSync, écritures locales (file CRUD), arrêt.
 * L'upload n'a lieu qu'au prochain login (connect_powersync).
 */
async function ecrireApresDeconnexion(id, email, password, secret, nom, idsJeu, fn) {
  const child = startApp(id);
  try {
    await waitCdp(child);
    const page = await connectCdp(child.port);
    // Pas de reconnexion : on écrit hors ligne dans la file locale.
    await login(page.send, email, password, secret, nom, { horsLigne: true });
    await attendreJeuLocal(page.send, idsJeu);
    await hook(page.send, `window.__legalosRecette.disconnectSync()`);
    await sleep(500);
    const result = await fn(page.send, child);
    const crud = await hook(
      page.send,
      `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud")`,
    );
    const nCrud = Array.isArray(crud) ? Number(crud[0]?.n ?? 0) : 0;
    if (nCrud < 1) {
      throw new Error("file ps_crud vide après écriture hors ligne");
    }
    page.ws.close();
    return result;
  } catch (err) {
    console.error(child.logTail());
    throw err;
  } finally {
    await stopApp(child);
  }
}

async function ouvrirReglages(send) {
  await evaluate(
    send,
    `(() => {
      const compte = [...document.querySelectorAll("button")].find((b) =>
        /^Compte$/i.test((b.textContent || "").trim()),
      );
      compte?.click();
      const reglages = [...document.querySelectorAll("button")].find((b) =>
        /réglages|reglages/i.test(b.textContent || ""),
      );
      reglages?.click();
      return Boolean(reglages);
    })()`,
  );
  await sleep(400);
}

async function hook(send, expression) {
  return evaluate(send, expression);
}

async function attendreSante(ms = 60_000) {
  const debut = Date.now();
  while (Date.now() - debut < ms) {
    const reponse = await fetch(`${instanceUrl}/health`).catch(() => null);
    if (reponse?.ok) return;
    await sleep(500);
  }
  throw new Error("instance non saine après reprise");
}

/** Les hooks apparaissent dès que le cabinet est là ; les dossiers du jeu peuvent suivre. */
async function attendreLigneLocale(send, table, id, ms = 180_000) {
  if (!TABLES_MODIFIABLES.includes(table) && table !== "dossiers") {
    throw new Error(`table non attendue: ${table}`);
  }
  const debut = Date.now();
  while (Date.now() - debut < ms) {
    const rows = await hook(
      send,
      `window.__legalosRecette.lireSqlite(${JSON.stringify(`SELECT id FROM ${table} WHERE id = ?`)}, ${JSON.stringify([id])})`,
    );
    if (Array.isArray(rows) && rows.length > 0) return;
    await sleep(300);
  }
  const counts = await hook(
    send,
    `window.__legalosRecette.lireSqlite("SELECT (SELECT COUNT(*) FROM dossiers) AS d, (SELECT COUNT(*) FROM parties) AS p, (SELECT COUNT(*) FROM cabinets) AS c")`,
  );
  throw new Error(
    `ligne absente en local: ${table}/${id} (counts=${JSON.stringify(counts)})`,
  );
}

async function attendreJeuLocal(send, ids) {
  for (const cas of TABLES_CONFLIT) {
    await attendreLigneLocale(send, cas.table, ids[cas.idKey]);
  }
  await attendreLigneLocale(send, "dossiers", ids.dossierRestreintId);
}

async function creerJeuApi(jeton) {
  const headers = {
    authorization: `Bearer ${jeton}`,
    "content-type": "application/json",
  };
  const dossierId = randomUUID();
  const partieId = randomUUID();
  const tempsId = randomUUID();
  const brouillonId = randomUUID();
  const tauxId = randomUUID();
  const dossierRestreintId = randomUUID();

  const dossier = await fetch(`${api}/dossiers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: dossierId,
      idempotence_cle: `conflits-d-${marque}`,
      nom: `Conflit public ${marque}`,
      chemise: "kraft",
      juridiction: "TJ Nanterre",
      numero_rg: `RG${marque}P`,
      restreint: false,
    }),
  });
  if (!dossier.ok) throw new Error(`créer dossier → ${dossier.status}`);

  const partie = await fetch(`${api}/dossiers/${dossierId}/parties`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: partieId,
      idempotence_cle: `conflits-p-${marque}`,
      role: "client",
      nom: `Partie ${marque}`,
    }),
  });
  if (!partie.ok) throw new Error(`créer partie → ${partie.status}`);

  const temps = await fetch(`${api}/temps`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: tempsId,
      dossier_id: dossierId,
      minutes: 30,
      libelle: `Temps ${marque}`,
      taux_centimes_heure: 25000,
      idempotence_cle: `conflits-t-${marque}`,
    }),
  });
  if (!temps.ok) throw new Error(`créer temps → ${temps.status}`);

  const brouillon = await fetch(`${api}/brouillons-facture`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: brouillonId,
      dossier_id: dossierId,
      temps_id: tempsId,
      libelle: `Brouillon ${marque}`,
      ht_centimes: 12500,
      taux_centimes_heure: 25000,
      idempotence_cle: `conflits-b-${marque}`,
    }),
  });
  if (!brouillon.ok) throw new Error(`créer brouillon → ${brouillon.status}`);

  const taux = await fetch(`${api}/taux-horaires`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: tauxId,
      dossier_id: dossierId,
      centimes_par_heure: 30000,
      idempotence_cle: `conflits-x-${marque}`,
    }),
  });
  if (!taux.ok) throw new Error(`créer taux → ${taux.status}`);

  const restreint = await fetch(`${api}/dossiers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: dossierRestreintId,
      idempotence_cle: `conflits-r-${marque}`,
      nom: `Conflit restreint ${marque}`,
      chemise: "bleu-classeur",
      juridiction: "TJ Paris",
      numero_rg: `RG${marque}R`,
      restreint: true,
    }),
  });
  if (!restreint.ok) throw new Error(`créer dossier restreint → ${restreint.status}`);

  return { dossierId, partieId, tempsId, brouillonId, tauxId, dossierRestreintId };
}

const TABLES_CONFLIT = [
  { table: "dossiers", idKey: "dossierId", valeurA: `JA-${marque}`, valeurB: `JB-${marque}` },
  { table: "parties", idKey: "partieId", valeurA: "adversaire", valeurB: "confrere" },
  { table: "temps_saisis", idKey: "tempsId", valeurA: `TA-${marque}`, valeurB: `TB-${marque}` },
  {
    table: "brouillons_facture",
    idKey: "brouillonId",
    valeurA: `BA-${marque}`,
    valeurB: `BB-${marque}`,
  },
  { table: "taux_horaires", idKey: "tauxId", valeurA: 31000, valeurB: 32000 },
];

// ——— entrée ———

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

if (!(await apiConflitsPrete())) {
  fail("API des conflits absente (colonne temps_saisis.revision, migration 019)");
}

for (const table of TABLES_MODIFIABLES) {
  if (!CHAMP_SEUL_PAR_TABLE[table]) fail(`champ seul manquant pour ${table}`);
}

// Reprise si un run précédent a laissé api/powersync en pause.
await compose(["unpause", "api", "powersync"]).catch(() => undefined);
await attendreSante().catch(() => undefined);

resetPostesLocaux();
console.log("conflits-poste: bases locales réinitialisées");

const jetonA = await demoAccessToken(api, `Conflits API ${marque}`);
const ids = await creerJeuApi(jetonA);
console.log("conflits-poste: jeu de données API créé");
// Laisse PowerSync répliquer Postgres → buckets avant le premier sync poste.
await sleep(8_000);

// Sync initiale des deux postes (attend le jeu API en SQLite).
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste conflits A", async (send) => {
  await attendreJeuLocal(send, ids);
  console.log("conflits-poste: poste A a le jeu en local");
});
await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste conflits B", async (send) => {
  await attendreJeuLocal(send, ids);
  console.log("conflits-poste: poste B a le jeu en local");
});

// ——— un conflit par table (hors ligne) ———
await ecrireApresDeconnexion(
  "a",
  demoEmail,
  demoPassword,
  totpSecretB32,
  "Poste conflits A",
  ids,
  async (send) => {
    for (const cas of TABLES_CONFLIT) {
      const id = ids[cas.idKey];
      const champ = CHAMP_SEUL_PAR_TABLE[cas.table];
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(cas.table)}, ${JSON.stringify(id)}, ${JSON.stringify(cas.valeurA)})`,
      );
      const rows = await hook(
        send,
        `window.__legalosRecette.lireSqlite(${JSON.stringify(`SELECT ${champ} AS v FROM ${cas.table} WHERE id = ?`)}, ${JSON.stringify([id])})`,
      );
      const vu = Array.isArray(rows) ? rows[0]?.v : undefined;
      if (String(vu) !== String(cas.valeurA)) {
        throw new Error(`patch A non appliqué ${cas.table}.${champ} (vu=${vu})`);
      }
    }
  },
);
{
  const { DatabaseSync } = await import("node:sqlite");
  const { join: pathJoin } = await import("node:path");
  const { homedir } = await import("node:os");
  const roaming = process.env.APPDATA ?? pathJoin(homedir(), "AppData", "Roaming");
  const dbPath = pathJoin(roaming, "fr.legalos.poste", "legalos-powersync-a.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const crud = db.prepare("SELECT COUNT(*) AS n FROM ps_crud").get();
  const jur = db
    .prepare("SELECT juridiction FROM dossiers WHERE id = ?")
    .get(ids.dossierId);
  console.log(
    `conflits-poste: après écriture A (sqlite fichier) crud=${JSON.stringify(crud)} jur=${JSON.stringify(jur)}`,
  );
  db.close();
}
await ecrireApresDeconnexion(
  "b",
  demoEmail,
  demoPassword,
  totpSecretB32,
  "Poste conflits B",
  ids,
  async (send) => {
    for (const cas of TABLES_CONFLIT) {
      const id = ids[cas.idKey];
      const champ = CHAMP_SEUL_PAR_TABLE[cas.table];
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(cas.table)}, ${JSON.stringify(id)}, ${JSON.stringify(cas.valeurB)})`,
      );
      const rows = await hook(
        send,
        `window.__legalosRecette.lireSqlite(${JSON.stringify(`SELECT ${champ} AS v FROM ${cas.table} WHERE id = ?`)}, ${JSON.stringify([id])})`,
      );
      const vu = Array.isArray(rows) ? rows[0]?.v : undefined;
      if (String(vu) !== String(cas.valeurB)) {
        throw new Error(`patch B non appliqué ${cas.table}.${champ} (vu=${vu})`);
      }
    }
  },
);

for (const id of ["a", "b"]) {
  await avecPoste(id, demoEmail, demoPassword, totpSecretB32, `Poste sync ${id}`, async (send, child) => {
    const crud = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud")`,
    );
    const jur = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT juridiction AS v FROM dossiers WHERE id = ?", ${JSON.stringify([ids.dossierId])})`,
    );
    const refus = await hook(send, `window.__legalosRecette.readRefus()`);
    console.log(
      `conflits-poste: sync ${id} ps_crud=${JSON.stringify(crud)} jur=${JSON.stringify(jur)} refus=${JSON.stringify(refus)}`,
    );
    console.log(`conflits-poste: sync ${id} log=${child.logTail().replace(/\s+/g, " ").slice(-500)}`);
    await sleep(8_000);
    const jurServeur = await sqlServeur(
      `SELECT juridiction FROM dossiers WHERE id = '${ids.dossierId}'`,
    );
    console.log(`conflits-poste: sync ${id} juridiction serveur=${jurServeur}`);
  });
}

for (const cas of TABLES_CONFLIT) {
  const champ = CHAMP_SEUL_PAR_TABLE[cas.table];
  const requete = `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = '${cas.table}' AND champ = '${champ}' AND conflit
         AND enregistrement_id = '${ids[cas.idKey]}'`;
  const debut = Date.now();
  let n = 0;
  while (Date.now() - debut < 90_000) {
    n = Number(await sqlServeur(requete));
    if (n >= 1) break;
    await sleep(500);
  }
  if (n < 1) fail(`conflit non journalisé pour ${cas.table}.${champ}`);
}
console.log("conflits-poste: OK — un conflit par table");

// Signalement dans l'app (les deux postes).
for (const id of ["a", "b"]) {
  await avecPoste(id, demoEmail, demoPassword, totpSecretB32, `Poste signal ${id}`, async (send) => {
    const debut = Date.now();
    let vu = false;
    while (Date.now() - debut < 60_000) {
      vu = Boolean(
        await evaluate(send, `Boolean(document.querySelector("[data-testid=conflit-sync]"))`),
      );
      if (vu) break;
      const n = await hook(send, `window.__legalosRecette.readConflits()`);
      if (Number(n) > 0) {
        await ouvrirReglages(send);
      }
      await sleep(400);
    }
    if (!vu) fail(`conflit non signalé sur le poste ${id}`);
  });
}
console.log("conflits-poste: OK — conflit signalé");

// ——— S5 : conflit sur dossier restreint (A et B autorisés), absent chez le collab ———
await ecrireApresDeconnexion(
  "a",
  demoEmail,
  demoPassword,
  totpSecretB32,
  "Poste S5 A",
  ids,
  async (send) => {
    await hook(
      send,
      `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierRestreintId)}, ${JSON.stringify(`RS-A-${marque}`)})`,
    );
  },
);
await ecrireApresDeconnexion(
  "b",
  demoEmail,
  demoPassword,
  totpSecretB32,
  "Poste S5 B",
  ids,
  async (send) => {
    await hook(
      send,
      `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierRestreintId)}, ${JSON.stringify(`RS-B-${marque}`)})`,
    );
  },
);

for (const id of ["a", "b"]) {
  await avecPoste(id, demoEmail, demoPassword, totpSecretB32, `Poste S5 sync ${id}`, async (send, child) => {
    const crud = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud")`,
    );
    const refus = await hook(send, `window.__legalosRecette.readRefus()`);
    console.log(
      `conflits-poste: S5 sync ${id} ps_crud=${JSON.stringify(crud)} refus=${JSON.stringify(refus)} log=${child.logTail().replace(/\s+/g, " ").slice(-400)}`,
    );
    const debut = Date.now();
    let rev = "1";
    while (Date.now() - debut < 90_000) {
      rev = await sqlServeur(
        `SELECT revision::text FROM dossiers WHERE id = '${ids.dossierRestreintId}'`,
      );
      if (Number(rev) >= 2) break;
      await sleep(500);
    }
    console.log(`conflits-poste: S5 sync ${id} revision serveur=${rev}`);
  });
}

const journalRestreintDebut = Date.now();
let journalRestreint = 0;
while (Date.now() - journalRestreintDebut < 90_000) {
  journalRestreint = Number(
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE dossier_id = '${ids.dossierRestreintId}' AND conflit`,
    ),
  );
  if (journalRestreint >= 1) break;
  await sleep(500);
}
if (journalRestreint < 1) fail("conflit du dossier restreint non journalisé côté serveur");

// Poste « c » : SQLite isolé. Réutiliser « b » laisserait le dossier restreint du titulaire.
await avecPoste(
  "c",
  collabEmail,
  collabPassword,
  collabTotp,
  "Poste S5 collab",
  async (send) => {
    const debut = Date.now();
    let n = -1;
    let count = -1;
    while (Date.now() - debut < 60_000) {
      n = Number(
        await hook(
          send,
          `window.__legalosRecette.compterJournalDossier(${JSON.stringify(ids.dossierRestreintId)})`,
        ),
      );
      const dossiers = await hook(
        send,
        `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM dossiers WHERE id = ?", [${JSON.stringify(ids.dossierRestreintId)}])`,
      );
      count = Array.isArray(dossiers) ? Number(dossiers[0]?.n ?? 0) : 0;
      // Attendre que la sync collab ait au moins reçu le cabinet (sinon assertion vacueuse).
      const cabinets = await hook(
        send,
        `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM cabinets")`,
      );
      const nCab = Array.isArray(cabinets) ? Number(cabinets[0]?.n ?? 0) : 0;
      if (nCab >= 1 && n === 0 && count === 0) break;
      if (nCab >= 1 && (n !== 0 || count !== 0)) break;
      await sleep(400);
    }
    if (Number(n) !== 0) {
      fail(`journal restreint présent chez le collab non autorisé (n=${n})`);
    }
    if (count !== 0) fail(`dossier restreint présent dans SQLite collab (n=${count})`);
  },
);
console.log("conflits-poste: OK — S5 journal restreint absent du poste non autorisé");

// ——— fausse alerte : même poste, deux écritures séquentielles ———
// Même nom d'appareil → même poste_id serveur. Les deux PATCH dans la même
// session après alignement sur la révision serveur (sinon SEQ1 conflictue avec B).
const nomFausse = "Poste fausse sequentiel";
let avantFausse = 0;
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, nomFausse, async (send) => {
  const revServeur = Number(
    await sqlServeur(`SELECT revision::text FROM dossiers WHERE id = '${ids.dossierId}'`),
  );
  // Aligner la base_revision d'upload sur le serveur (la colonne locale peut rester
  // en retard tant que le flux n'a pas rattrapé la valeur gagnante de B).
  await hook(
    send,
    `window.__legalosRecette.fixerRevisionEdition(${JSON.stringify(ids.dossierId)}, ${revServeur})`,
  );
  avantFausse = Number(
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = 'dossiers' AND enregistrement_id = '${ids.dossierId}' AND conflit`,
    ),
  );
  await hook(
    send,
    `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierId)}, ${JSON.stringify(`SEQ1-${marque}`)})`,
  );
  await attendreSql(
    `SELECT juridiction FROM dossiers WHERE id = '${ids.dossierId}'`,
    `SEQ1-${marque}`,
  );
  const revApresSeq1 = Number(
    await sqlServeur(`SELECT revision::text FROM dossiers WHERE id = '${ids.dossierId}'`),
  );
  await hook(
    send,
    `window.__legalosRecette.fixerRevisionEdition(${JSON.stringify(ids.dossierId)}, ${revApresSeq1})`,
  );
  await hook(
    send,
    `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierId)}, ${JSON.stringify(`SEQ2-${marque}`)})`,
  );
  await attendreSql(
    `SELECT juridiction FROM dossiers WHERE id = '${ids.dossierId}'`,
    `SEQ2-${marque}`,
  );
});
await sleep(2_000);
const apresFausse = Number(
  await sqlServeur(
    `SELECT COUNT(*) FROM journal_modifications
     WHERE table_cible = 'dossiers' AND enregistrement_id = '${ids.dossierId}' AND conflit`,
  ),
);
if (apresFausse > avantFausse) {
  fail(`fausse alerte de conflit (même poste) : ${avantFausse} → ${apresFausse}`);
}
console.log("conflits-poste: OK — pas de fausse alerte (même poste)");

// ——— refus puis écriture valide ; table inconnue ; DELETE ———
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste refus", async (send) => {
  await hook(
    send,
    `window.__legalosRecette.injecterCrud({ op: "DELETE", table: "dossiers", id: ${JSON.stringify(ids.dossierId)} })`,
  );
  await hook(
    send,
    `window.__legalosRecette.injecterCrud({ op: "PATCH", table: "table_inconnue_recette", id: "x-${marque}", data: { foo: "bar" } })`,
  );
  // Laisse le connecteur traiter la file.
  await sleep(4_000);
  const refus = await hook(send, `window.__legalosRecette.readRefus()`);
  if (!refus || !refus.message) fail("refus non consigné / message absent");
  await ouvrirReglages(send);
  const debut = Date.now();
  let vu = false;
  while (Date.now() - debut < 30_000) {
    vu = Boolean(await evaluate(send, `Boolean(document.querySelector("[data-testid=refus-sync]"))`));
    if (vu) break;
    await ouvrirReglages(send);
    await sleep(400);
  }
  if (!vu) fail("message de refus non affiché");

  // Écriture valide suivante : doit partir et arriver sur B.
  const libelleValide = `APRES-REFUS-${marque}`;
  await hook(
    send,
    `window.__legalosRecette.patchChampSeul("temps_saisis", ${JSON.stringify(ids.tempsId)}, ${JSON.stringify(libelleValide)})`,
  );
  await sleep(3_000);
  await attendreSql(
    `SELECT libelle FROM temps_saisis WHERE id = '${ids.tempsId}'`,
    libelleValide,
  );
});

// Base B neuve : prouve que l'écriture est dans le bucket (téléchargement complet).
// Après de nombreux cycles Tauri le flux incrémental peut laisser une valeur locale figée.
resetPosteLocal("b");
await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste apres refus B", async (send, child) => {
  await sleep(3_000);
  const attendu = `APRES-REFUS-${marque}`;
  const debut = Date.now();
  let vu = "";
  while (Date.now() - debut < 180_000) {
    const rows = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT libelle FROM temps_saisis WHERE id = ?", [${JSON.stringify(ids.tempsId)}])`,
    );
    vu = Array.isArray(rows) ? String(rows[0]?.libelle ?? "") : "";
    if (vu === attendu) break;
    await sleep(500);
  }
  if (vu !== attendu) {
    const serveur = await sqlServeur(
      `SELECT libelle FROM temps_saisis WHERE id = '${ids.tempsId}'`,
    );
    console.error(
      `conflits-poste: apres refus B local=${vu || "vide"} serveur=${serveur} log=${child.logTail().replace(/\s+/g, " ").slice(-400)}`,
    );
    fail(`écriture après refus absente sur B (${vu || "vide"})`);
  }
});
console.log("conflits-poste: OK — refus consignés, file non bloquée, écriture suivante OK");

// ——— un champ seul (cabinets inclus) ———
// parties.role n'accepte que client | adversaire | confrere (le conflit laisse l'un des deux derniers).
// Le taux est un entier : la preuve compare la valeur journalisée, pas un motif contenant la marque.
const tauxSeul = 33000 + Number(marque.slice(-3));
const attendusChampSeul = {
  cabinets: `Seul ${marque}`,
  dossiers: `SEUL-dossiers-${marque}`,
  parties: "client",
  temps_saisis: `SEUL-temps_saisis-${marque}`,
  brouillons_facture: `SEUL-brouillons_facture-${marque}`,
  taux_horaires: String(tauxSeul),
};

await ecrireApresDeconnexion(
  "a",
  demoEmail,
  demoPassword,
  totpSecretB32,
  "Poste champ seul",
  ids,
  async (send) => {
    for (const table of TABLES_MODIFIABLES) {
      if (table === "cabinets") {
        await hook(
          send,
          `window.__legalosRecette.patchCabinetNom(${JSON.stringify(attendusChampSeul.cabinets)})`,
        );
        continue;
      }
      const idKey = TABLES_CONFLIT.find((c) => c.table === table)?.idKey;
      if (!idKey) continue;
      const valeur = table === "taux_horaires" ? tauxSeul : attendusChampSeul[table];
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(table)}, ${JSON.stringify(ids[idKey])}, ${JSON.stringify(valeur)})`,
      );
    }
  },
);

await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste champ seul sync", async () => {
  await sleep(5_000);
});

for (const table of TABLES_MODIFIABLES) {
  const champ = CHAMP_SEUL_PAR_TABLE[table];
  const attendu = attendusChampSeul[table].replaceAll("'", "''");
  const n = Number(
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = '${table}'
         AND champ = '${champ}'
         AND valeur_appliquee = '${attendu}'`,
    ),
  );
  if (n < 1) fail(`écriture d'un seul champ absente pour ${table}.${champ} (attendu ${attendu})`);
}
console.log("conflits-poste: OK — un champ seul par table");

console.log("conflits-poste: OK — tous les critères");
