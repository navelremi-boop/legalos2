/**
 * J2 — parcours réel de l'app Tauri : instance, identifiants, TOTP, session au trousseau.
 * Le jeton de rafraîchissement doit encore être là après fermeture et redémarrage.
 * Ne journalise aucun secret.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const poste = fileURLToPath(new URL("../../apps/poste/", import.meta.url));
const port = process.env.LEGALOS_WEBVIEW_PORT ?? "9222";
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";

let dernierTexte = "";

function fail(message) {
  console.error(`j2-poste: FAIL — ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(250);
  }
  const extrait = dernierTexte.replace(/\s+/g, " ").slice(0, 180);
  throw new Error(`délai dépassé : ${label}${extrait ? ` — ${extrait}` : ""}`);
}

function startApp() {
  const configPath = join(tmpdir(), "legalos-j2-webview.json");
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
  const env = {
    ...process.env,
    LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
  };
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm tauri dev --config ${configPath}`], {
    cwd: poste,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 8000) log = log.slice(-8000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.logTail = () => log.slice(-500);
  return child;
}

async function stopApp(child) {
  if (child.exitCode !== null || child.killed) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("exit", resolve);
  });
  await sleep(1500);
}

async function connectCdp() {
  const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) fail("page webview introuvable");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("websocket webview")));
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
  function send(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  return { ws, send };
}

async function evaluate(send, expression) {
  const msg = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const details = msg.result?.exceptionDetails;
  if (details) {
    const text = details.exception?.description ?? details.text ?? "évaluation";
    throw new Error(String(text).slice(0, 300));
  }
  return msg.result?.result?.value;
}

async function bodyText(send) {
  dernierTexte = String(
    (await evaluate(send, "document.body ? document.body.innerText : ''")) ?? "",
  );
  return dernierTexte;
}

async function setField(send, id, value) {
  const ok = await evaluate(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue("");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) fail(`champ absent : ${id}`);
}

async function submit(send) {
  const ok = await evaluate(
    send,
    `(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`,
  );
  if (!ok) fail("formulaire absent");
}

async function tauriInvoke(send, command) {
  return evaluate(
    send,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)})`,
  );
}

async function waitCdp(child) {
  await waitFor(
    "webview",
    async () => {
      if (child.exitCode !== null) throw new Error(`tauri dev arrêté (${child.exitCode})`);
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json`);
        if (!list.ok) return false;
        const pages = await list.json();
        return pages.some((t) => t.type === "page" && t.webSocketDebuggerUrl);
      } catch {
        return false;
      }
    },
    240_000,
  );
}

async function login(send) {
  await waitFor("écran instance", async () => (await bodyText(send)).includes("Adresse"));
  await setField(send, "instance-url", instanceUrl);
  await submit(send);
  await waitFor("écran identifiants", async () =>
    (await bodyText(send)).includes("Identifiants"),
  );
  await setField(send, "email", demoEmail);
  await setField(send, "password", demoPassword);
  await setField(send, "nom-appareil", "Poste recette J2");
  await submit(send);
  await waitFor("écran TOTP", async () => (await bodyText(send)).includes("Double authentification"));
  await setField(send, "code-totp", totpNow());
  await submit(send);
  await waitFor("session ouverte", async () => {
    const text = await bodyText(send);
    return text.includes("Synchronisation initiale") || text.includes("La journée");
  });
}

async function sessionPresente(send) {
  await waitFor("pont Tauri", async () =>
    Boolean(await evaluate(send, "Boolean(window.__TAURI_INTERNALS__)")),
  );
  return Boolean(await tauriInvoke(send, "keyring_has_refresh"));
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail(`instance injoignable (${instanceUrl}/health)`);

const premier = startApp();
premier.on("exit", (code) => {
  if (code && code !== 0 && code !== 1) console.error(`j2-poste: tauri dev exit ${code}`);
});
try {
  await waitCdp(premier);
  const page = await connectCdp();
  await waitFor("pont Tauri", async () =>
    Boolean(await evaluate(page.send, "Boolean(window.__TAURI_INTERNALS__)")),
  );
  await tauriInvoke(page.send, "keyring_clear_refresh");
  if (await sessionPresente(page.send)) fail("le trousseau n'est pas vide avant la connexion");
  await login(page.send);
  if (!(await sessionPresente(page.send))) fail("jeton absent après la connexion");
  page.ws.close();
  console.log("j2-poste: session enregistrée dans l'app");
} catch (err) {
  console.error(premier.logTail());
  await stopApp(premier);
  fail(err instanceof Error ? err.message : "parcours");
}
await stopApp(premier);

const second = startApp();
try {
  await waitCdp(second);
  const page = await connectCdp();
  const present = await sessionPresente(page.send);
  page.ws.close();
  if (!present) fail("le jeton a disparu après redémarrage");
  console.log("j2-poste: OK — jeton présent après fermeture et redémarrage");
} catch (err) {
  console.error(second.logTail());
  await stopApp(second);
  fail(err instanceof Error ? err.message : "redémarrage");
}
await stopApp(second);
