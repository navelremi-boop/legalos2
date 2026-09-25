/**
 * J3 — deux postes Tauri, coupure réelle (services api et powersync arrêtés).
 * Ne journalise aucun secret.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const poste = fileURLToPath(new URL("../../apps/poste/", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const nomHorsLigne = "Cabinet fictif hors ligne";

function fail(message) {
  console.error(`j3-poste: FAIL — ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startApp(id) {
  const port = id === "a" ? "9222" : "9232";
  const dir = join(tmpdir(), `legalos-webview-${id}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-j3-${id}.json`);
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
    if (log.length > 4000) log = log.slice(-4000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.port = port;
  child.logTail = () => log.slice(-400);
  return child;
}

async function stopApp(child) {
  if (child.exitCode !== null) return;
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
  const msg = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
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

async function login(send, nomAppareil) {
  const pret = Date.now();
  while (Date.now() - pret < 20_000) {
    if (await evaluate(send, `Boolean(document.getElementById("instance-url"))`)) break;
    await sleep(200);
  }
  await setField(send, "instance-url", instanceUrl);
  await evaluate(send, `document.querySelector("form")?.requestSubmit()`);
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await evaluate(send, `Boolean(document.getElementById("email"))`)) break;
    await sleep(200);
  }
  await setField(send, "email", demoEmail);
  await setField(send, "password", demoPassword);
  await setField(send, "nom-appareil", nomAppareil);
  await evaluate(send, `document.querySelector("form")?.requestSubmit()`);
  const totpStart = Date.now();
  while (Date.now() - totpStart < 40_000) {
    if (await evaluate(send, `Boolean(document.getElementById("code-totp"))`)) break;
    await sleep(250);
  }
  await setField(send, "code-totp", totpNow());
  await evaluate(send, `document.querySelector("form")?.requestSubmit()`);
  const jour = Date.now();
  while (Date.now() - jour < 200_000) {
    const text = await evaluate(send, "document.body?.innerText ?? ''");
    if (String(text).includes("La journée")) return;
    await sleep(400);
  }
  const texte = await evaluate(send, "document.body?.innerText ?? ''");
  throw new Error(`journée absente — ${String(texte).replace(/\s+/g, " ").slice(0, 180)}`);
}

async function nomAffiche(send) {
  return String((await evaluate(send, `document.getElementById("cabinet-nom")?.value ?? ""`)) ?? "");
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

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const posteA = startApp("a");
try {
  await waitCdp(posteA);
  const pageA = await connectCdp(posteA.port);
  await login(pageA.send, "Poste recette A");
  const initial = await nomAffiche(pageA.send);
  if (!initial) fail("nom initial absent sur A");
  pageA.ws.close();
  console.log("j3-poste: A synchronisé");

  await compose(["stop", "api", "powersync"]);
  const pageCut = await connectCdp(posteA.port);
  await setField(pageCut.send, "cabinet-nom", nomHorsLigne);
  await evaluate(pageCut.send, `document.querySelector("form")?.requestSubmit()`);
  await sleep(500);
  pageCut.ws.close();
  await stopApp(posteA);

  const posteA2 = startApp("a");
  try {
    await waitCdp(posteA2);
    const pageRestart = await connectCdp(posteA2.port);
    const start = Date.now();
    let vu = "";
    while (Date.now() - start < 30_000) {
      vu = await nomAffiche(pageRestart.send);
      if (vu === nomHorsLigne) break;
      await sleep(300);
    }
    pageRestart.ws.close();
    if (vu !== nomHorsLigne) fail(`nom perdu au redémarrage (${vu || "vide"})`);
    console.log("j3-poste: modification conservée après redémarrage hors ligne");
    await stopApp(posteA2);
  } catch (err) {
    console.error(posteA2.logTail());
    await stopApp(posteA2);
    throw err;
  }
} catch (err) {
  console.error(posteA.logTail());
  await stopApp(posteA);
  await compose(["start", "api", "powersync"]).catch(() => undefined);
  fail(err instanceof Error ? err.message : "parcours");
}
await compose(["start", "api", "powersync"]);
console.log("j3-poste: services relancés");
