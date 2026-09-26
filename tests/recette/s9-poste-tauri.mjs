#!/usr/bin/env node
/**
 * S9 — temps saisi dans l'app Tauri sur un dossier existant, brouillon local sans numéro,
 * taux paramétrable ; validation en ligne sans créer de dossier.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const poste = join(root, "apps/poste");
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instanceUrl}/api`;
const posteId = "s9";

function fail(message) {
  console.error(`s9-poste: FAIL — ${message}`);
  process.exit(1);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetBase() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dataDir = join(roaming, "fr.legalos.poste");
  for (const ext of ["", "-shm", "-wal"]) {
    rmSync(join(dataDir, `legalos-powersync-${posteId}.db${ext}`), { force: true });
  }
}

function startApp() {
  const dir = join(tmpdir(), `legalos-webview-s9-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-s9-${Date.now()}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      app: {
        windows: [
          {
            additionalBrowserArgs:
              "--remote-debugging-port=9222 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
          },
        ],
      },
    }),
  );
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm tauri dev --config ${configPath}`], {
    cwd: poste,
    env: {
      ...process.env,
      LEGALOS_POSTE_ID: posteId,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (c) => {
    log += c.toString();
    if (log.length > 8000) log = log.slice(-8000);
  });
  child.stderr.on("data", (c) => {
    log += c.toString();
    if (log.length > 8000) log = log.slice(-8000);
  });
  child.logTail = () => log.slice(-1200);
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
}

async function connectCdp() {
  const list = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
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
  while (Date.now() - start < 180_000) {
    if (child.exitCode !== null) throw new Error(`tauri arrêté (${child.exitCode})`);
    try {
      const list = await fetch("http://127.0.0.1:9222/json");
      if (list.ok && (await list.json()).some((t) => t.type === "page")) return;
    } catch {
      /* pas encore */
    }
    await sleep(300);
  }
  throw new Error("webview");
}

async function setField(send, id, value) {
  const ok = await evaluate(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) throw new Error(`champ ${id}`);
}

async function ouvrirTemps(send) {
  if (await evaluate(send, `Boolean(document.getElementById("temps-minutes"))`)) return;
  await evaluate(send, `document.querySelector("[data-testid=chrono-barre]")?.click()`);
  await sleep(400);
  if (!(await evaluate(send, `Boolean(document.getElementById("temps-minutes"))`))) {
    await evaluate(
      send,
      `[...document.querySelectorAll("button")].find((b) => /Saisir du temps/i.test(b.textContent || ""))?.click()`,
    );
    await sleep(400);
  }
}

async function login(send) {
  const debut = Date.now();
  while (Date.now() - debut < 60_000) {
    if (await evaluate(send, `Boolean(document.getElementById("instance-url"))`)) break;
    await sleep(200);
  }
  await setField(send, "instance-url", instanceUrl);
  await evaluate(send, `document.getElementById("instance-url")?.closest("form")?.requestSubmit()`);
  const creds = Date.now();
  while (Date.now() - creds < 45_000) {
    if (await evaluate(send, `Boolean(document.getElementById("email"))`)) break;
    await sleep(200);
  }
  await setField(send, "email", demoEmail);
  await setField(send, "password", demoPassword);
  await setField(send, "nom-appareil", "Poste S9");
  await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  const totp = Date.now();
  let soumis = false;
  while (Date.now() - totp < 90_000) {
    if (!soumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await setField(send, "code-totp", totpNow());
      await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
      soumis = true;
    }
    if (soumis && !(await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await ouvrirTemps(send);
      if (await evaluate(send, `Boolean(document.getElementById("temps-minutes"))`)) return;
    }
    await sleep(250);
  }
  throw new Error("écran temps absent");
}

function lireSqlite() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${posteId}.db`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [
        "-c",
        `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
temps=c.execute("SELECT minutes, libelle, taux_centimes_heure, ht_centimes, dossier_id FROM temps_saisis").fetchall()
brouillon=c.execute("SELECT numero, ht_centimes, libelle, dossier_id FROM brouillons_facture").fetchall()
print(temps)
print(brouillon)`,
        fichier,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c.toString();
    });
    child.stderr.on("data", (c) => {
      err += c.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.slice(-300) || "sqlite"));
    });
  });
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const jeton = await demoAccessToken(api, "s9-poste");
const dossierId = randomUUID();
const creation = await fetch(`${api}/dossiers`, {
  method: "POST",
  headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
  body: JSON.stringify({
    id: dossierId,
    idempotence_cle: `${dossierId}:dossier`,
    nom: `Dossier temps S9 ${String(Date.now()).slice(-6)}`,
    chemise: "kraft",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-6)}`,
    restreint: false,
  }),
});
if (!creation.ok) fail(`création dossier ${creation.status}`);
const tauxId = randomUUID();
await fetch(`${api}/taux-horaires`, {
  method: "POST",
  headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
  body: JSON.stringify({
    id: tauxId,
    centimes_par_heure: 6_000,
    dossier_id: dossierId,
    idempotence_cle: `${tauxId}:taux`,
  }),
});

resetBase();
const app = startApp();
try {
  await waitCdp(app);
  const { send, ws } = await connectCdp();
  await login(send);

  const syncDebut = Date.now();
  let optionOk = false;
  while (Date.now() - syncDebut < 90_000) {
    await ouvrirTemps(send);
    optionOk = Boolean(
      await evaluate(
        send,
        `Boolean(document.querySelector("#temps-dossier option[value='${dossierId}']"))`,
      ),
    );
    if (optionOk) break;
    await sleep(800);
  }
  if (!optionOk) fail(`dossier existant absent du formulaire (${dossierId})`);

  await evaluate(
    send,
    `(() => {
      const sel = document.getElementById("temps-dossier");
      if (!sel) return false;
      sel.value = ${JSON.stringify(dossierId)};
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await setField(send, "temps-minutes", "60");
  await setField(send, "temps-taux", "6000");
  await setField(send, "temps-libelle", "Honoraires fictifs");
  await evaluate(send, `document.getElementById("temps-minutes")?.closest("form")?.requestSubmit()`);
  const debut = Date.now();
  let texte = "";
  while (Date.now() - debut < 20_000) {
    texte = String(
      (await evaluate(send, `document.querySelector("[data-testid=brouillon-hors-ligne]")?.textContent ?? ""`)) ??
        "",
    );
    if (texte.includes("sans numéro")) break;
    await sleep(200);
  }
  if (!texte.includes("sans numéro")) fail(`brouillon non affiché (${texte})`);
  const lu = await lireSqlite();
  if (!lu.includes("60") || !lu.includes("Honoraires fictifs") || !lu.includes("None")) {
    fail(`sqlite inattendu (${lu})`);
  }
  if (!lu.includes("6000") || !lu.includes(dossierId)) {
    fail(`taux/dossier absents (${lu})`);
  }
  await evaluate(send, `document.getElementById("valider-facture")?.click()`);
  const numeroDebut = Date.now();
  let apres = "";
  while (Date.now() - numeroDebut < 30_000) {
    apres = String(
      (await evaluate(send, `document.querySelector("[data-testid=brouillon-hors-ligne]")?.textContent ?? ""`)) ??
        "",
    );
    if (/numéro \d+/.test(apres)) break;
    await sleep(250);
  }
  if (!/numéro \d+/.test(apres)) fail(`validation en ligne absente (${apres})`);
  const xml = String(
    (await evaluate(send, `document.querySelector("[data-testid=facture-cii]")?.textContent ?? ""`)) ?? "",
  );
  if (!xml.includes("urn:cen.eu:en16931:2017") || !xml.includes("60.00") || !xml.includes("Honoraires fictifs")) {
    fail("Factur-X absent du brouillon validé");
  }
  const apresSql = await lireSqlite();
  if (apresSql.includes("None")) fail(`numéro local resté vide (${apresSql})`);
  console.log(
    "s9-poste: OK — dossier existant, taux paramétrable, brouillon sync sans numéro, puis numéro serveur",
  );
  ws.close();
} catch (error) {
  console.error(app.logTail());
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await stopApp(app);
}
