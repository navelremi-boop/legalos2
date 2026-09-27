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
 * Ne pas lancer tant que le lot API (lot/conflits-api) n'est pas fusionné :
 * le script s'arrête en SKIP si `temps_saisis.revision` est absent.
 * Forcer : LEGALOS_CONFLITS_API=1
 *
 * Usage : node tests/recette/conflits-poste-tauri.mjs
 * Ne journalise aucun secret.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("sql"))));
  });
}

async function apiConflitsPrete() {
  if (process.env.LEGALOS_CONFLITS_API === "1") return true;
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
  for (const id of ["a", "b"]) {
    for (const ext of ["", "-shm", "-wal"]) {
      rmSync(join(dataDir, `legalos-powersync-${id}.db${ext}`), { force: true });
    }
  }
}

function startApp(id) {
  const port = id === "a" ? "9252" : "9253";
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
  await sleep(800);
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
    sleep(15_000).then(() => {
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
  return String(
    (await evaluate(
      send,
      `document.getElementById("instance-url")
        ? "login"
        : document.getElementById("email")
          ? "creds"
          : document.getElementById("code-totp")
            ? "totp"
            : document.getElementById("cabinet-nom")
              ? "local"
              : ""`,
    )) ?? "",
  );
}

async function login(send, email, password, secret, nomAppareil) {
  const pret = Date.now();
  let ecran = "";
  while (Date.now() - pret < 60_000) {
    ecran = await ecranAuth(send);
    if (ecran === "local") {
      await evaluate(
        send,
        `[...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("reconnecter"))?.click()`,
      );
      const jusqua = Date.now() + 15_000;
      while (Date.now() < jusqua) {
        ecran = await ecranAuth(send);
        if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
        await sleep(200);
      }
    }
    if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
    await sleep(200);
  }
  if (!ecran) throw new Error("écran auth absent");
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
    const pretLocal = await evaluate(
      send,
      `Boolean(document.getElementById("cabinet-nom")) && !document.getElementById("instance-url") && !document.getElementById("code-totp")`,
    );
    if (totpSoumis && pretLocal) {
      const debutHooks = Date.now();
      while (Date.now() - debutHooks < 30_000) {
        const ok = await evaluate(send, `typeof window.__legalosRecette?.patchChampSeul === "function"`);
        if (ok) return;
        await sleep(200);
      }
      throw new Error("hooks recette absents (VITE_LEGALOS_RECETTE_HOOKS=1 ?)");
    }
    await sleep(250);
  }
  throw new Error("journée absente");
}

function compose(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", ...args],
      { cwd: root, stdio: "ignore" },
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

async function hook(send, expression) {
  return evaluate(send, expression);
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
  console.log(
    "conflits-poste-tauri: SKIP — API du lot parallèle non déployée (temps_saisis.revision absente).",
  );
  console.log(
    "Relancer après fusion de lot/conflits-api, ou avec LEGALOS_CONFLITS_API=1 si l'API est déjà en place.",
  );
  process.exit(0);
}

for (const table of TABLES_MODIFIABLES) {
  if (!CHAMP_SEUL_PAR_TABLE[table]) fail(`champ seul manquant pour ${table}`);
}

resetPostesLocaux();
console.log("conflits-poste: bases locales réinitialisées");

const jetonA = await demoAccessToken(api, `Conflits API ${marque}`);
const ids = await creerJeuApi(jetonA);
console.log("conflits-poste: jeu de données API créé");

// Sync initiale des deux postes (démo + collab pour S5).
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste conflits A", async () => {
  await sleep(2_000);
});
await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste conflits B", async () => {
  await sleep(2_000);
});

// ——— un conflit par table (hors ligne) ———
await compose(["pause", "api", "powersync"]);
try {
  await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste conflits A", async (send) => {
    for (const cas of TABLES_CONFLIT) {
      const id = ids[cas.idKey];
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(cas.table)}, ${JSON.stringify(id)}, ${JSON.stringify(cas.valeurA)})`,
      );
    }
  });
  await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste conflits B", async (send) => {
    for (const cas of TABLES_CONFLIT) {
      const id = ids[cas.idKey];
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(cas.table)}, ${JSON.stringify(id)}, ${JSON.stringify(cas.valeurB)})`,
      );
    }
  });
} finally {
  await compose(["unpause", "api", "powersync"]).catch(() => undefined);
}

for (const id of ["a", "b"]) {
  await avecPoste(id, demoEmail, demoPassword, totpSecretB32, `Poste sync ${id}`, async () => {
    await sleep(3_000);
  });
}

for (const cas of TABLES_CONFLIT) {
  const champ = CHAMP_SEUL_PAR_TABLE[cas.table];
  const n = Number(
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = '${cas.table}' AND champ = '${champ}' AND conflit
         AND enregistrement_id = '${ids[cas.idKey]}'`,
    ),
  );
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
        // Ouvrir Réglages si le bandeau n'est pas encore monté.
        await evaluate(
          send,
          `[...document.querySelectorAll("button")].find((b) => /réglages|reglages/i.test(b.textContent || ""))?.click()`,
        );
        await sleep(500);
      }
      await sleep(400);
    }
    if (!vu) fail(`conflit non signalé sur le poste ${id}`);
  });
}
console.log("conflits-poste: OK — conflit signalé");

// ——— S5 : conflit sur dossier restreint (A et B autorisés), absent chez le collab ———
await compose(["pause", "api", "powersync"]);
try {
  await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste S5 A", async (send) => {
    await hook(
      send,
      `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierRestreintId)}, ${JSON.stringify(`RS-A-${marque}`)})`,
    );
  });
  await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste S5 B", async (send) => {
    await hook(
      send,
      `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierRestreintId)}, ${JSON.stringify(`RS-B-${marque}`)})`,
    );
  });
} finally {
  await compose(["unpause", "api", "powersync"]).catch(() => undefined);
}

for (const id of ["a", "b"]) {
  await avecPoste(id, demoEmail, demoPassword, totpSecretB32, `Poste S5 sync ${id}`, async () => {
    await sleep(3_000);
  });
}

const journalRestreint = Number(
  await sqlServeur(
    `SELECT COUNT(*) FROM journal_modifications
     WHERE dossier_id = '${ids.dossierRestreintId}' AND conflit`,
  ),
);
if (journalRestreint < 1) fail("conflit du dossier restreint non journalisé côté serveur");

await avecPoste(
  "b",
  collabEmail,
  collabPassword,
  collabTotp,
  "Poste S5 collab",
  async (send) => {
    await sleep(4_000);
    const n = await hook(
      send,
      `window.__legalosRecette.compterJournalDossier(${JSON.stringify(ids.dossierRestreintId)})`,
    );
    if (Number(n) !== 0) {
      fail(`journal restreint présent chez le collab non autorisé (n=${n})`);
    }
    const dossiers = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM dossiers WHERE id = ?", [${JSON.stringify(ids.dossierRestreintId)}])`,
    );
    const count = Array.isArray(dossiers) ? Number(dossiers[0]?.n ?? 0) : 0;
    if (count !== 0) fail(`dossier restreint présent dans SQLite collab (n=${count})`);
  },
);
console.log("conflits-poste: OK — S5 journal restreint absent du poste non autorisé");

// ——— fausse alerte : même poste, deux écritures séquentielles ———
const avantFausse = Number(
  await sqlServeur(
    `SELECT COUNT(*) FROM journal_modifications
     WHERE table_cible = 'dossiers' AND enregistrement_id = '${ids.dossierId}' AND conflit`,
  ),
);
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste fausse 1", async (send) => {
  await hook(
    send,
    `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierId)}, ${JSON.stringify(`SEQ1-${marque}`)})`,
  );
});
await sleep(2_000);
await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste fausse 2", async (send) => {
  await hook(
    send,
    `window.__legalosRecette.patchChampSeul("dossiers", ${JSON.stringify(ids.dossierId)}, ${JSON.stringify(`SEQ2-${marque}`)})`,
  );
});
await sleep(3_000);
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
  await evaluate(
    send,
    `[...document.querySelectorAll("button")].find((b) => /réglages|reglages/i.test(b.textContent || ""))?.click()`,
  );
  const debut = Date.now();
  let vu = false;
  while (Date.now() - debut < 30_000) {
    vu = Boolean(await evaluate(send, `Boolean(document.querySelector("[data-testid=refus-sync]"))`));
    if (vu) break;
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

await avecPoste("b", demoEmail, demoPassword, totpSecretB32, "Poste apres refus B", async (send) => {
  const debut = Date.now();
  let vu = "";
  while (Date.now() - debut < 90_000) {
    const rows = await hook(
      send,
      `window.__legalosRecette.lireSqlite("SELECT libelle FROM temps_saisis WHERE id = ?", [${JSON.stringify(ids.tempsId)}])`,
    );
    vu = Array.isArray(rows) ? String(rows[0]?.libelle ?? "") : "";
    if (vu === `APRES-REFUS-${marque}`) break;
    await sleep(500);
  }
  if (vu !== `APRES-REFUS-${marque}`) fail(`écriture après refus absente sur B (${vu || "vide"})`);
});
console.log("conflits-poste: OK — refus consignés, file non bloquée, écriture suivante OK");

// ——— un champ seul (cabinets inclus) ———
await compose(["pause", "api", "powersync"]);
try {
  await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste champ seul", async (send) => {
    for (const table of TABLES_MODIFIABLES) {
      if (table === "cabinets") {
        await hook(send, `window.__legalosRecette.patchCabinetNom(${JSON.stringify(`Seul ${marque}`)})`);
        continue;
      }
      const idKey = TABLES_CONFLIT.find((c) => c.table === table)?.idKey;
      if (!idKey) continue;
      const valeur =
        typeof TABLES_CONFLIT.find((c) => c.table === table)?.valeurA === "number"
          ? 33000 + Number(marque.slice(-3))
          : `SEUL-${table}-${marque}`;
      await hook(
        send,
        `window.__legalosRecette.patchChampSeul(${JSON.stringify(table)}, ${JSON.stringify(ids[idKey])}, ${JSON.stringify(valeur)})`,
      );
    }
  });
} finally {
  await compose(["unpause", "api", "powersync"]).catch(() => undefined);
}

await avecPoste("a", demoEmail, demoPassword, totpSecretB32, "Poste champ seul sync", async () => {
  await sleep(4_000);
});

for (const table of TABLES_MODIFIABLES) {
  const champ = CHAMP_SEUL_PAR_TABLE[table];
  const n = Number(
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = '${table}'
         AND champ = '${champ}'
         AND valeur_appliquee LIKE '%${marque}%'`,
    ),
  );
  if (n < 1) fail(`écriture d'un seul champ absente pour ${table}.${champ}`);
}
console.log("conflits-poste: OK — un champ seul par table");

console.log("conflits-poste: OK — tous les critères");
