#!/usr/bin/env node
/**
 * Deux postes Tauri créent des dossiers en même temps, dont hors ligne avec retour
 * de réseau simultané ; références distinctes, sans doublon ni trou.
 * S'inspire de j5-poste-tauri.mjs / j3-poste-tauri.mjs.
 * Usage : node tests/recette/reference-deux-postes-tauri.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CABINET_ID } from "../../apps/poste/src/sync/demoCabinet.ts";
import { demoAccessToken, demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const poste = join(root, "apps/poste");
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instanceUrl}/api`;
const marque = String(Date.now()).slice(-6);

function fail(message) {
  console.error(`reference-deux-postes: FAIL — ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetPostesLocaux() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dataDir = join(roaming, "fr.legalos.poste");
  for (const id of ["p", "q"]) {
    for (const ext of ["", "-shm", "-wal"]) {
      rmSync(join(dataDir, `legalos-powersync-${id}.db${ext}`), { force: true });
    }
  }
}

function cheminBinairePoste() {
  const target = process.env.CARGO_TARGET_DIR ?? join(poste, "src-tauri", "target");
  return join(target, "debug", "legal-os-poste.exe");
}

/** Premier poste : `tauri dev` (Vite + compilation). */
function startAppDev(id) {
  const port = id === "p" ? "9246" : "9247";
  const dir = join(tmpdir(), `legalos-webview-ref2-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-ref2-${id}-${marque}.json`);
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

/**
 * Second poste : copie du binaire déjà lancé (évite le verrou Windows sur legal-os-poste.exe)
 * et même Vite (devUrl 1420). CDP via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
 */
function startAppCopie(id) {
  const port = id === "p" ? "9246" : "9247";
  const src = cheminBinairePoste();
  if (!existsSync(src)) throw new Error(`binaire absent (${src})`);
  const dest = join(tmpdir(), `legal-os-poste-${id}-${marque}.exe`);
  copyFileSync(src, dest);
  const dir = join(tmpdir(), `legalos-webview-ref2-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const child = spawn(dest, [], {
    cwd: poste,
    env: {
      ...process.env,
      LEGALOS_POSTE_ID: id,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`,
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
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
  child.exeCopie = dest;
  child.logTail = () => log.slice(-1500);
  return child;
}

async function stopApp(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
      "exit",
      resolve,
    );
  });
  await sleep(800);
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

async function login(send, nomAppareil) {
  const pret = Date.now();
  let ecran = "";
  while (Date.now() - pret < 60_000) {
    ecran = await ecranAuth(send);
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
    await setField(send, "email", demoEmail);
    await setField(send, "password", demoPassword);
    await setField(send, "nom-appareil", nomAppareil);
    await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  }
  let totpSoumis = ecran === "totp";
  const totpStart = Date.now();
  while (Date.now() - totpStart < 180_000) {
    if (!totpSoumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await setField(send, "code-totp", totpNow());
      await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
      totpSoumis = true;
    }
    const coque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("code-totp")`,
    );
    if (totpSoumis && coque) {
      await ouvrirFormulaireDossier(send);
      return;
    }
    await sleep(250);
  }
  throw new Error("coque absente");
}

async function ouvrirFormulaireDossier(send) {
  if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /dossiers/i.test(b.textContent || "")) || null)?.click()`,
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

function compose(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", ...args], {
      cwd: root,
      stdio: "ignore",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`compose ${args[0]}`))));
  });
}

function sqliteLocal(id, requete) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${id}.db`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute(sys.argv[2]).fetchall())", fichier, requete],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (m) => {
      out += m.toString();
    });
    child.stderr.on("data", (m) => {
      err += m.toString();
    });
    child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.slice(-200)))));
  });
}

async function creerDossier(send, { nom, rg, precedent = "" }) {
  await ouvrirFormulaireDossier(send);
  await setField(send, "dossier-nom", nom);
  await setField(send, "dossier-juridiction", "TJ de Lyon");
  await setField(send, "dossier-rg", rg);
  await setField(send, "dossier-partie", `Partie ${rg}`);
  await evaluate(send, `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`);
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  const debut = Date.now();
  while (Date.now() - debut < 20_000) {
    const cree = await evaluate(send, `document.querySelector("[data-testid=dossier-cree]")?.textContent ?? ""`);
    const texte = String(cree).trim();
    if (/[0-9a-f-]{36}/i.test(texte) && texte !== precedent) return texte;
    await sleep(200);
  }
  throw new Error(`dossier ${rg} non créé`);
}

function extraireNumero(reference) {
  const chiffres = reference.match(/(\d+)\s*$/) ?? reference.match(/(\d+)/g);
  if (!chiffres) return null;
  const dernier = Array.isArray(chiffres) ? chiffres[chiffres.length - 1] : chiffres[1];
  const n = Number(dernier);
  return Number.isInteger(n) ? n : null;
}

function verifierSuite(references) {
  const uniques = [...new Set(references)];
  if (uniques.length !== references.length) {
    fail(`doublon parmi ${references.join(", ")}`);
  }
  const numeros = references.map((r) => extraireNumero(r)).filter((n) => n !== null);
  if (numeros.length !== references.length) {
    fail(`numéro illisible dans ${references.join(", ")}`);
  }
  const tries = [...numeros].sort((a, b) => a - b);
  for (let i = 1; i < tries.length; i += 1) {
    if (tries[i] !== tries[i - 1] + 1) {
      fail(`trou dans la suite ${tries.join(", ")} (${references.join(", ")})`);
    }
  }
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

let jeton;
try {
  jeton = await demoAccessToken(api, "deux-postes-sonde");
} catch (err) {
  fail(`authentification API (${err instanceof Error ? err.message : err})`);
}
const sonde = await fetch(`${api}/cabinets/${DEMO_CABINET_ID}/reference`, {
  headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
});
if (sonde.status === 404) {
  fail("API personnalisée absente (GET /cabinets/{id}/reference → 404)");
}

resetPostesLocaux();
/** P via tauri dev ; Q = copie du binaire (un seul cargo, pas de conflit d'exe Windows). */
const posteP = startAppDev("p");
let posteQ;
let enPause = false;
try {
  await waitCdp(posteP);
  posteQ = startAppCopie("q");
  await waitCdp(posteQ);
  const a = await connectCdp(posteP.port);
  const b = await connectCdp(posteQ.port);
  await login(a.send, "Poste P référence");
  await login(b.send, "Poste Q référence");
  console.log("reference-deux-postes: connectés");

  const [idEnLigneP, idEnLigneQ] = await Promise.all([
    creerDossier(a.send, { nom: `En ligne P ${marque}`, rg: `RG${marque}P` }),
    creerDossier(b.send, { nom: `En ligne Q ${marque}`, rg: `RG${marque}Q` }),
  ]);
  console.log(`reference-deux-postes: créations simultanées en ligne ${idEnLigneP} ${idEnLigneQ}`);

  await compose(["pause", "api", "powersync"]);
  enPause = true;
  const [idHorsP, idHorsQ] = await Promise.all([
    creerDossier(a.send, { nom: `Hors ligne P ${marque}`, rg: `RG${marque}HP`, precedent: idEnLigneP }),
    creerDossier(b.send, { nom: `Hors ligne Q ${marque}`, rg: `RG${marque}HQ`, precedent: idEnLigneQ }),
  ]);
  const horsP = await sqliteLocal("p", `SELECT reference FROM dossiers WHERE id = '${idHorsP}'`);
  const horsQ = await sqliteLocal("q", `SELECT reference FROM dossiers WHERE id = '${idHorsQ}'`);
  if (!/None/i.test(horsP) && horsP !== "[(None,)]") fail(`P hors ligne devrait être NULL (${horsP})`);
  if (!/None/i.test(horsQ) && horsQ !== "[(None,)]") fail(`Q hors ligne devrait être NULL (${horsQ})`);
  console.log("reference-deux-postes: dossiers hors ligne, références NULL");

  await compose(["unpause", "api", "powersync"]);
  enPause = false;

  const ids = [idEnLigneP, idEnLigneQ, idHorsP, idHorsQ];
  const debut = Date.now();
  const refs = new Map();
  while (Date.now() - debut < 180_000) {
    for (const [posteId, dossierId] of [
      ["p", idEnLigneP],
      ["q", idEnLigneQ],
      ["p", idHorsP],
      ["q", idHorsQ],
    ]) {
      const local = await sqliteLocal(posteId, `SELECT reference FROM dossiers WHERE id = '${dossierId}'`).catch(
        () => "",
      );
      const m = /'([^']+)'/.exec(local);
      if (m && m[1] && m[1] !== "None") refs.set(dossierId, m[1]);
    }
    if (refs.size === ids.length) break;
    await sleep(1_000);
  }
  if (refs.size !== ids.length) {
    fail(`références manquantes après retour réseau (${[...refs.entries()].join(" ; ")})`);
  }
  const references = ids.map((id) => refs.get(id));
  verifierSuite(references);
  console.log(`reference-deux-postes: OK — ${references.join(", ")}`);
  a.ws.close();
  b.ws.close();
  console.log("reference-deux-postes: OK");
} catch (err) {
  console.error(`reference-deux-postes: FAIL — ${err instanceof Error ? err.message : err}`);
  console.error(posteP.logTail());
  console.error(posteQ?.logTail?.() ?? "");
  process.exitCode = 1;
} finally {
  if (enPause) await compose(["unpause", "api", "powersync"]).catch(() => undefined);
  await stopApp(posteP);
  await stopApp(posteQ);
}
