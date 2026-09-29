#!/usr/bin/env node
/**
 * Acceptation jalon Intercalaires personnalisés (§ 7.4 / PLAN).
 * Deux postes Tauri : création, sync, rattachement, retrait, conflits, S5.
 * Instance http://127.0.0.1:8088 — migration 020 requise.
 * Ne journalise aucun secret.
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

function racineInstance() {
  if (existsSync(join(root, ".env"))) return root;
  const principal = join(root, "..", "..");
  if (existsSync(join(principal, ".env"))) return principal;
  return root;
}

function fail(message) {
  console.error(`intercalaires-tauri: FAIL — ${message}`);
  process.exit(1);
}
function ok(message) {
  console.log(`intercalaires-tauri: ${message}`);
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
      { cwd: racineInstance(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`sql ${code}: ${err.slice(0, 200)}`)),
    );
  });
}

/** Preuve S5 : SELECT sur la SQLite PowerSync du poste (fichier legalos-powersync-*.db). */
function sqliteLocal(id, requete) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${id}.db`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [
        "-c",
        "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchone(); print(r[0] if r else '')",
        fichier,
        requete,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || `sqlite ${code}`));
    });
  });
}

async function ensureInstance() {
  const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
  if (!sante?.ok) {
    ok("instance absente — démarrage docker compose");
    const r = spawnSync(
      "docker",
      [
        "compose",
        "-f",
        join(racineInstance(), "instance", "docker-compose.yml"),
        "--env-file",
        join(racineInstance(), ".env"),
        "up",
        "-d",
        "--wait",
      ],
      { cwd: racineInstance(), stdio: "inherit", shell: false },
    );
    if (r.status !== 0) fail(`docker compose up exit ${r.status ?? 1}`);
  }
  const debut = Date.now();
  while (Date.now() - debut < 120_000) {
    const h = await fetch(`${instanceUrl}/health`).catch(() => null);
    if (h?.ok) break;
    await sleep(2_000);
  }
  const table = await sqlServeur(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'intercalaires_personnalises'`,
  ).catch(() => "");
  if (table !== "1") {
    fail(
      "table intercalaires_personnalises absente (migration 020 — reconstruire l'API depuis ce worktree)",
    );
  }
}

function resetPostesLocaux() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dataDir = join(roaming, "fr.legalos.poste");
  for (const id of ["ia", "ib", "ic"]) {
    for (const ext of ["", "-shm", "-wal"]) {
      rmSync(join(dataDir, `legalos-powersync-${id}.db${ext}`), { force: true });
    }
  }
}

function portPoste(id) {
  if (id === "ia") return "9261";
  if (id === "ib") return "9262";
  if (id === "ic") return "9263";
  throw new Error(`poste inconnu: ${id}`);
}

function cheminBinairePoste() {
  const target = process.env.CARGO_TARGET_DIR ?? join(poste, "src-tauri", "target");
  return join(target, "debug", "legal-os-poste.exe");
}

function startAppDev(id) {
  const port = portPoste(id);
  const dir = join(tmpdir(), `legalos-webview-inter-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-inter-${id}-${marque}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      app: {
        windows: [
          {
            width: 1280,
            height: 900,
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
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
      VITE_LEGALOS_RECETTE_HOOKS: "1",
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 14_000) log = log.slice(-14_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.port = port;
  child.logTail = () => log.slice(-2_000);
  return child;
}

function startAppCopie(id) {
  const port = portPoste(id);
  const src = cheminBinairePoste();
  if (!existsSync(src)) throw new Error(`binaire absent (${src})`);
  const dest = join(tmpdir(), `legal-os-poste-inter-${id}-${marque}.exe`);
  copyFileSync(src, dest);
  const dir = join(tmpdir(), `legalos-webview-inter-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const child = spawn(dest, [], {
    cwd: poste,
    env: {
      ...process.env,
      LEGALOS_POSTE_ID: id,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`,
      VITE_LEGALOS_RECETTE_HOOKS: "1",
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 14_000) log = log.slice(-14_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.port = port;
  child.exeCopie = dest;
  child.logTail = () => log.slice(-2_000);
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
  await sleep(2_000);
  if (child.exeCopie) {
    for (let i = 0; i < 8; i += 1) {
      try {
        rmSync(child.exeCopie, { force: true });
        break;
      } catch {
        await sleep(400);
      }
    }
  }
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
    throw new Error(String(msg.result.exceptionDetails.text ?? "évaluation").slice(0, 240));
  }
  return msg.result?.result?.value;
}

async function waitCdp(child) {
  const start = Date.now();
  while (Date.now() - start < 420_000) {
    if (child.exitCode !== null) {
      throw new Error(`tauri arrêté (${child.exitCode}) : ${child.logTail()}`);
    }
    try {
      const list = await fetch(`http://127.0.0.1:${child.port}/json`);
      if (list.ok) {
        const pages = await list.json();
        if (pages.some((t) => t.type === "page" && t.webSocketDebuggerUrl)) return;
      }
    } catch {
      /* pas encore */
    }
    await sleep(400);
  }
  throw new Error(`webview ${child.port} — ${child.logTail()}`);
}

async function setField(send, id, value) {
  const okField = await evaluate(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (el._valueTracker) el._valueTracker.setValue("");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  if (!okField) throw new Error(`champ ${id} absent`);
}

async function ecranAuth(send) {
  return evaluate(
    send,
    `(() => {
      if (document.getElementById("code-totp")?.offsetParent) return "totp";
      if (document.getElementById("email")?.offsetParent) return "creds";
      if (document.getElementById("instance-url")?.offsetParent) return "login";
      if (document.querySelector("[data-testid=se-reconnecter]")) return "local";
      return "";
    })()`,
  );
}

async function login(send, email, password, secret, nomAppareil) {
  const pret = Date.now();
  let ecran = "";
  while (Date.now() - pret < 90_000) {
    // Session déjà restaurée (trousseau) après redémarrage.
    const deja = await evaluate(
      send,
      `(async () => {
        if (typeof window.__legalosRecette?.lireSqlite !== "function") return false;
        const rows = await window.__legalosRecette.lireSqlite("SELECT id FROM cabinets LIMIT 1");
        if (!Array.isArray(rows) || rows.length === 0) return false;
        return Boolean(document.querySelector("[data-testid=barre-haut]"));
      })()`,
    );
    if (deja) return;

    ecran = await ecranAuth(send);
    if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
    const coque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("instance-url")`,
    );
    if (coque) {
      await evaluate(
        send,
        `(() => {
          const b = document.querySelector("[data-testid=se-reconnecter]");
          if (b) { b.click(); return true; }
          [...document.querySelectorAll("button")].find((x) => /reconnecter/i.test(x.innerText || ""))?.click();
          return false;
        })()`,
      );
      await sleep(400);
      continue;
    }
    await sleep(250);
  }
  if (!ecran) {
    // Dernière chance : coque déjà là.
    const deja = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]"))`,
    );
    if (deja) return;
    throw new Error("écran auth absent");
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
    const syncOk = await evaluate(
      send,
      `(async () => {
        if (typeof window.__legalosRecette?.lireSqlite !== "function") return false;
        const rows = await window.__legalosRecette.lireSqlite("SELECT id FROM cabinets LIMIT 1");
        if (!Array.isArray(rows) || rows.length === 0) return false;
        const coque = document.querySelector("[data-testid=barre-haut]");
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
  throw new Error("coque absente après auth");
}

async function ouvrirFormulaireDossier(send) {
  if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(400);
  if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /nouveau dossier/i.test(b.textContent || "")) || null)?.click()`,
  );
  const debut = Date.now();
  while (Date.now() - debut < 15_000) {
    if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
    await sleep(200);
  }
  throw new Error("formulaire dossier absent");
}

async function creerDossierUi(send, { nom, chemise, juridiction, rg, partie, restreint = false }) {
  await ouvrirFormulaireDossier(send);
  await setField(send, "dossier-nom", nom);
  await evaluate(
    send,
    `(() => {
      const sel = document.getElementById("dossier-chemise");
      if (!sel) return false;
      sel.value = ${JSON.stringify(chemise)};
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await setField(send, "dossier-juridiction", juridiction);
  await setField(send, "dossier-rg", rg);
  await setField(send, "dossier-partie", partie);
  const attenteResponsable = Date.now();
  while (Date.now() - attenteResponsable < 25_000) {
    const pretResp = await evaluate(
      send,
      `(() => {
        const sel = document.getElementById("dossier-responsable");
        if (sel && sel.value) return true;
        const hid = document.querySelector("input[name=responsable_id]");
        return Boolean(hid && hid.value);
      })()`,
    );
    if (pretResp) break;
    await sleep(300);
  }
  if (restreint) {
    await evaluate(send, `document.getElementById("dossier-restreint")?.click()`);
  }
  await evaluate(
    send,
    `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`,
  );
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  const debut = Date.now();
  while (Date.now() - debut < 45_000) {
    const id = await evaluate(
      send,
      `document.querySelector("[data-testid=dossier-cree]")?.textContent?.trim() ?? ""`,
    );
    if (id && /^[0-9a-f-]{36}$/i.test(String(id))) return String(id);
    const ouvert = await evaluate(
      send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") ?? ""`,
    );
    if (ouvert) return String(ouvert);
    await sleep(250);
  }
  throw new Error(`création dossier échouée (${nom})`);
}

async function ouvrirDossierListe(send, dossierId, nom) {
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(500);
  const clique = await evaluate(
    send,
    `(() => {
      const boutons = [...document.querySelectorAll("[data-testid=liste-dossier]")];
      const cible = boutons.find((b) => (b.textContent || "").includes(${JSON.stringify(nom)}));
      if (!cible) return false;
      cible.click();
      return true;
    })()`,
  );
  if (!clique) throw new Error(`ligne dossier absente (${nom})`);
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    const ouvert = await evaluate(
      send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(dossierId)}`,
    );
    if (ouvert) return;
    await sleep(250);
  }
  throw new Error("dossier non ouvert depuis la liste");
}

async function creerIntercalaireUi(send, nom) {
  // S'assurer d'être sur un dossier ouvert.
  if (!(await evaluate(send, `Boolean(document.querySelector("[data-testid=intercalaires]"))`))) {
    throw new Error("bandeau intercalaires absent");
  }
  const clique = await evaluate(
    send,
    `(() => {
      const b = document.querySelector("[data-testid=intercalaire-ajout]");
      if (!b) return false;
      b.click();
      return true;
    })()`,
  );
  if (!clique) throw new Error("bouton + Intercalaire absent");
  const debut = Date.now();
  while (Date.now() - debut < 10_000) {
    if (await evaluate(send, `Boolean(document.querySelector("[data-testid=intercalaire-saisie]"))`)) {
      break;
    }
    await sleep(150);
  }
  const saisieOk = await evaluate(
    send,
    `(() => {
      const el = document.querySelector("[data-testid=intercalaire-saisie]");
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (el._valueTracker) el._valueTracker.setValue("");
      proto.set.call(el, ${JSON.stringify(nom)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    })()`,
  );
  if (!saisieOk) throw new Error("saisie intercalaire absente");
  const wait = Date.now();
  while (Date.now() - wait < 30_000) {
    const id = await evaluate(
      send,
      `(() => {
        const btn = document.querySelector("[data-testid^=intercalaire-perso-][data-perso='1']");
        const raw = btn?.getAttribute("data-testid") ?? "";
        return raw.replace(/^intercalaire-perso-/, "");
      })()`,
    );
    if (id && /^[0-9a-f-]{36}$/i.test(String(id))) return String(id);
    await sleep(250);
  }
  throw new Error("intercalaire personnalisé non créé");
}

async function apiJson(chemin, jeton, method, body) {
  const r = await fetch(`${api}${chemin}`, {
    method,
    headers: {
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
      "X-Poste-Id": `inter-api-${marque}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texte = await r.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = null;
  }
  if (!r.ok) throw new Error(`${method} ${chemin} → ${r.status} ${texte.slice(0, 200)}`);
  return json;
}

async function deposerPiece(jeton, dossierId) {
  // Stockage objet peut être indisponible en local : on pose la ligne métier
  // (documents) côté Postgres pour prouver que le retrait d'intercalaire ne la CASCADE pas.
  const documentId = randomUUID();
  void jeton;
  await new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "legalos-instance-postgres-1",
        "psql",
        "-U",
        "legalos",
        "-d",
        "legalos",
        "-v",
        "ON_ERROR_STOP=1",
        "-tAc",
        `INSERT INTO documents (id, cabinet_id, dossier_id, nom, visibilite, dossier_texte)
         SELECT '${documentId}', cabinet_id, id, 'note-inter-${marque}.txt', visibilite, id::text
         FROM dossiers WHERE id = '${dossierId}'`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err || `insert doc ${code}`))));
  });
  return documentId;
}

async function attendreSql(requete, predicat, ms = 90_000) {
  const debut = Date.now();
  let vu = "";
  while (Date.now() - debut < ms) {
    vu = await sqlServeur(requete);
    if (predicat(vu)) return vu;
    await sleep(400);
  }
  throw new Error(`sql timeout (${vu})`);
}

async function main() {
  await ensureInstance();

  // S'assurer que le collab de démo existe (idempotent).
  const jetonSeed = await demoAccessToken(api, `inter-collab-seed-${marque}`);
  await fetch(`${api}/collaborateurs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jetonSeed}`,
    },
    body: JSON.stringify({
      email: collabEmail,
      password: collabPassword,
      totp_secret_base32: collabTotp,
    }),
  }).catch(() => null);

  resetPostesLocaux();
  const jeton = await demoAccessToken(api, `intercalaires-api-${marque}`);
  if (!jeton) fail("jeton démo absent");

  const enfants = [];
  const lancer = async (id, mode) => {
    const child = mode === "dev" ? startAppDev(id) : startAppCopie(id);
    enfants.push(child);
    await waitCdp(child);
    const page = await connectCdp(child.port);
    return { child, page, send: page.send };
  };
  const arreter = async (session) => {
    try {
      session.page?.ws?.close();
    } catch {
      /* ignore */
    }
    await stopApp(session.child);
    const idx = enfants.indexOf(session.child);
    if (idx >= 0) enfants.splice(idx, 1);
  };

  try {
    const a = await lancer("ia", "dev");
    await login(a.send, demoEmail, demoPassword, totpSecretB32, `Inter A ${marque}`);
    ok("poste A connecté");

    const nomDossier = `Intercalaires ${marque}`;
    const dossierId = await creerDossierUi(a.send, {
      nom: nomDossier,
      chemise: "kraft",
      juridiction: "TJ Nanterre",
      rg: `26/${marque}`,
      partie: "SAS Démo Inter",
    });
    // Ouvrir le dossier créé s'il n'est pas déjà affiché.
    const dejaOuvert = await evaluate(
      a.send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(dossierId)}`,
    );
    if (!dejaOuvert) {
      await ouvrirDossierListe(a.send, dossierId, nomDossier);
    }
    ok(`dossier ${dossierId.slice(0, 8)}`);

    const standards = await evaluate(
      a.send,
      `(() => {
        const ids = ["chrono","procedure","pieces","mails","factures"];
        return ids.map((id) => {
          const btn = document.querySelector("[data-testid=intercalaire-" + id + "]");
          const croix = document.querySelector("[data-testid=intercalaire-retirer-" + id + "]");
          return { id, present: Boolean(btn), croix: Boolean(croix) };
        });
      })()`,
    );
    for (const s of standards ?? []) {
      if (!s.present) fail(`intercalaire standard ${s.id} absent`);
      if (s.croix) fail(`croix de retrait sur standard ${s.id}`);
    }
    ok("standards présents sans croix");

    const intercalaireId = await creerIntercalaireUi(a.send, `Preuve ${marque}`);
    ok(`intercalaire créé ${intercalaireId.slice(0, 8)}`);

    await attendreSql(
      `SELECT nom FROM intercalaires_personnalises WHERE id = '${intercalaireId}'`,
      (v) => Boolean(v),
    );
    ok("intercalaire synchronisé (serveur)");

    await evaluate(a.send, `document.querySelector("[data-testid=intercalaire-rattacher-note]")?.click()`);
    await attendreSql(
      `SELECT COUNT(*) FROM intercalaire_elements WHERE intercalaire_id = '${intercalaireId}' AND type_element = 'note'`,
      (v) => Number(v) >= 1,
    );
    ok("note rattachée (classement supplémentaire)");

    const pieceId = await deposerPiece(jeton, dossierId);
    const lienId = randomUUID();
    await apiJson(`/intercalaires/${intercalaireId}/elements`, jeton, "POST", {
      id: lienId,
      idempotence_cle: `inter-lien-${marque}`,
      type_element: "piece",
      element_id: pieceId,
    });
    const pieceAvant = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE id = '${pieceId}'`);
    if (pieceAvant !== "1") fail("pièce absente avant retrait");
    ok("pièce rattachée ; document métier présent");

    const b = await lancer("ib", "copie");
    await login(b.send, demoEmail, demoPassword, totpSecretB32, `Inter B ${marque}`);
    ok("poste B connecté");

    const debutB = Date.now();
    let vuB = false;
    while (Date.now() - debutB < 120_000) {
      const rows = await evaluate(
        b.send,
        `(async () => window.__legalosRecette.lireSqlite(
          "SELECT id, nom FROM intercalaires_personnalises WHERE id = ?",
          [${JSON.stringify(intercalaireId)}],
        ))()`,
      );
      if (Array.isArray(rows) && rows.length === 1) {
        vuB = true;
        break;
      }
      await sleep(500);
    }
    if (!vuB) fail("intercalaire absent du poste B");
    ok("table synchronisée sur le poste B");

    // Conflit par champ (révision de base) : deux postes via l'API, signal dans l'app.
    const jetonPosteA = await accessToken(api, {
      email: demoEmail,
      password: demoPassword,
      totpSecret: totpSecretB32,
      nomAppareil: `Inter conf A ${marque}`,
    });
    const jetonPosteB = await accessToken(api, {
      email: demoEmail,
      password: demoPassword,
      totpSecret: totpSecretB32,
      nomAppareil: `Inter conf B ${marque}`,
    });
    const revCourante = Number(
      await sqlServeur(
        `SELECT revision FROM intercalaires_personnalises WHERE id = '${intercalaireId}'`,
      ),
    );
    const patchA = await fetch(`${api}/intercalaires/${intercalaireId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${jetonPosteA}`,
        "Content-Type": "application/json",
        "X-Poste-Id": `inter-conf-a-${marque}`,
      },
      body: JSON.stringify({
        base_revision: revCourante,
        idempotence_cle: `conf-a-${marque}`,
        nom: `NomA-${marque}`,
      }),
    });
    if (!patchA.ok) fail(`patch A conflit → ${patchA.status} ${await patchA.text()}`);
    const patchB = await fetch(`${api}/intercalaires/${intercalaireId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${jetonPosteB}`,
        "Content-Type": "application/json",
        "X-Poste-Id": `inter-conf-b-${marque}`,
      },
      body: JSON.stringify({
        base_revision: revCourante,
        idempotence_cle: `conf-b-${marque}`,
        nom: `NomB-${marque}`,
      }),
    });
    if (!patchB.ok) fail(`patch B conflit → ${patchB.status} ${await patchB.text()}`);

    await attendreSql(
      `SELECT COUNT(*) FROM journal_modifications
       WHERE table_cible = 'intercalaires_personnalises'
         AND champ = 'nom' AND conflit
         AND enregistrement_id = '${intercalaireId}'`,
      (v) => Number(v) >= 1,
      60_000,
    );
    ok("conflit par champ journalisé");

    // Laisser PowerSync descendre le journal, puis ouvrir l'intercalaire.
    await sleep(6_000);
    const dejaSurDossier = await evaluate(
      a.send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(dossierId)}`,
    );
    if (!dejaSurDossier) {
      await ouvrirDossierListe(a.send, dossierId, nomDossier);
    }
    await evaluate(
      a.send,
      `document.querySelector(${JSON.stringify(`[data-testid=intercalaire-perso-${intercalaireId}]`)})?.click()`,
    );
    await sleep(1_500);
    const signal = await evaluate(
      a.send,
      `Boolean(document.querySelector("[data-testid=intercalaire-conflit]"))`,
    );
    const nLocal = await evaluate(
      a.send,
      `window.__legalosRecette.compterJournalConflits("intercalaires_personnalises")`,
    );
    if (!signal) fail("conflit non signalé dans l'interface");
    if (Number(nLocal) < 1) fail("conflit absent du journal local");
    ok("conflit signalé dans l'interface");

    const croix = await evaluate(
      a.send,
      `(() => {
        const c = document.querySelector(${JSON.stringify(`[data-testid=intercalaire-retirer-${intercalaireId}]`)});
        if (!c) return false;
        c.click();
        return true;
      })()`,
    );
    if (!croix) fail("croix de retrait absente sur personnalisé");

    await attendreSql(
      `SELECT COUNT(*) FROM intercalaires_personnalises WHERE id = '${intercalaireId}'`,
      (v) => v === "0",
    );
    const pieceApres = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE id = '${pieceId}'`);
    if (pieceApres !== "1") fail("retrait intercalaire a supprimé la pièce métier");
    const liensApres = await sqlServeur(
      `SELECT COUNT(*) FROM intercalaire_elements WHERE intercalaire_id = '${intercalaireId}'`,
    );
    if (liensApres !== "0") fail("rattachements non CASCADE après retrait");
    ok("retrait : pièce conservée, rattachements retirés");

    await sleep(8_000);
    const pieceChezB = await evaluate(
      b.send,
      `(async () => {
        const r = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM documents WHERE id = ?",
          [${JSON.stringify(pieceId)}],
        );
        return Number(r?.[0]?.n ?? 0);
      })()`,
    );
    if (Number(pieceChezB) !== 1) fail("pièce absente du poste B après retrait");
    const interChezB = await evaluate(
      b.send,
      `(async () => {
        const r = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM intercalaires_personnalises WHERE id = ?",
          [${JSON.stringify(intercalaireId)}],
        );
        return Number(r?.[0]?.n ?? 0);
      })()`,
    );
    if (Number(interChezB) !== 0) fail("intercalaire encore présent sur B après retrait");
    ok("poste B : pièce conservée, intercalaire retiré");

    await arreter(a);
    await arreter(b);

    // ——— S5 : intercalaire d'un dossier restreint absent chez le collab non autorisé ———
    const idRestreint = randomUUID();
    const interRestreint = randomUUID();
    const creeRestreint = await fetch(`${api}/dossiers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "application/json",
        "X-Poste-Id": `inter-s5-${marque}`,
      },
      body: JSON.stringify({
        id: idRestreint,
        idempotence_cle: `inter-s5-dos-${marque}`,
        nom: `Inter restreint ${marque}`,
        chemise: "bleu-classeur",
        juridiction: "TJ Lyon",
        numero_rg: `R${marque}`,
        restreint: true,
        responsable_id: "01950000-0000-7000-8000-000000000002",
      }),
    });
    if (!creeRestreint.ok) {
      fail(`créer dossier restreint → ${creeRestreint.status} ${await creeRestreint.text()}`);
    }
    const creeInterR = await fetch(`${api}/dossiers/${idRestreint}/intercalaires`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "application/json",
        "X-Poste-Id": `inter-s5-${marque}`,
      },
      body: JSON.stringify({
        id: interRestreint,
        idempotence_cle: `inter-s5-int-${marque}`,
        nom: `Secret ${marque}`,
      }),
    });
    if (!creeInterR.ok) {
      fail(`créer intercalaire restreint → ${creeInterR.status} ${await creeInterR.text()}`);
    }
    await attendreSql(
      `SELECT COUNT(*) FROM intercalaires_personnalises WHERE id = '${interRestreint}' AND dossier_id = '${idRestreint}'`,
      (v) => v === "1",
    );
    ok(`intercalaire restreint ${interRestreint.slice(0, 8)}`);

    const c = await lancer("ic", "dev");
    const jetonCollab = await accessToken(api, {
      email: collabEmail,
      password: collabPassword,
      totpSecret: collabTotp,
      nomAppareil: `Inter collab ${marque}`,
    });
    if (!jetonCollab) fail("jeton collab absent");
    await login(c.send, collabEmail, collabPassword, collabTotp, `Inter collab ${marque}`);
    await sleep(14_000);

    const interditDossier = await evaluate(
      c.send,
      `(async () => {
        const r = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM dossiers WHERE id = ?",
          [${JSON.stringify(idRestreint)}],
        );
        return Number(r?.[0]?.n ?? 0);
      })()`,
    );
    const interditInter = await evaluate(
      c.send,
      `(async () => {
        const r = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM intercalaires_personnalises WHERE id = ? OR dossier_id = ?",
          [${JSON.stringify(interRestreint)}, ${JSON.stringify(idRestreint)}],
        );
        return Number(r?.[0]?.n ?? 0);
      })()`,
    );
    const sqliteInter = await sqliteLocal(
      "ic",
      `SELECT COUNT(*) FROM intercalaires_personnalises WHERE dossier_id = '${idRestreint}'`,
    );
    if (Number(interditDossier) !== 0) fail("dossier restreint présent chez collab");
    if (Number(interditInter) !== 0) fail("intercalaire restreint présent chez collab (hooks)");
    if (String(sqliteInter) !== "0") {
      fail(`intercalaire restreint présent dans SQLite collab (${sqliteInter})`);
    }
    ok("S5 : intercalaire du dossier restreint absent du SQLite du poste non autorisé");

    await arreter(c);
    ok("tous les critères");
  } catch (err) {
    for (const child of enfants) {
      console.error(child.logTail?.() ?? "");
    }
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    for (const child of [...enfants]) {
      await stopApp(child);
    }
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
