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
const marque = String(Date.now()).slice(-6);
const nomHorsLigne = `Hors ligne ${marque}`;
const nomFusion = `Nom fusion ${marque}`;
const slugFusion = `slugf${marque}`;
const nomConflitA = `Conflit A ${marque}`;
const nomConflitB = `Conflit B ${marque}`;
const slugCoupure = `coupure${marque}`;

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
    if (log.length > 12000) log = log.slice(-12000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.port = port;
  child.logTail = () => log.slice(-1500);
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
  const msg = await Promise.race([
    send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
      returnByValue: true,
    }),
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
    const ecran = await evaluate(
      send,
      `document.getElementById("cabinet-nom") ? "local" : document.getElementById("instance-url") ? "login" : ""`,
    );
    if (ecran === "local") {
      await evaluate(
        send,
        `[...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("reconnecter"))?.click()`,
      );
      const jusqua = Date.now() + 10_000;
      while (Date.now() < jusqua) {
        if (await evaluate(send, `Boolean(document.getElementById("instance-url"))`)) break;
        await sleep(200);
      }
      if (!(await evaluate(send, `Boolean(document.getElementById("instance-url"))`))) {
        const flag = await evaluate(send, `Boolean(window.__legalosReconnect)`);
        throw new Error(`reconnect sans formulaire (handler ${flag ? "oui" : "non"})`);
      }
      break;
    }
    if (ecran === "login") break;
    await sleep(200);
  }
  await setField(send, "instance-url", instanceUrl);
  await evaluate(
    send,
    `document.getElementById("instance-url")?.closest("form")?.requestSubmit()`,
  );
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await evaluate(send, `Boolean(document.getElementById("email"))`)) break;
    await sleep(200);
  }
  await setField(send, "email", demoEmail);
  await setField(send, "password", demoPassword);
  await setField(send, "nom-appareil", nomAppareil);
  await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  let totpSoumis = false;
  const totpStart = Date.now();
  while (Date.now() - totpStart < 90_000) {
    if (!totpSoumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await setField(send, "code-totp", totpNow());
      await evaluate(
        send,
        `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`,
      );
      totpSoumis = true;
    }
    const connecte = await evaluate(
      send,
      `Boolean(document.getElementById("cabinet-nom")) && !document.getElementById("instance-url") && !document.getElementById("code-totp")`,
    );
    if (totpSoumis && connecte) return;
    await sleep(250);
  }
  const texte = await evaluate(send, "document.body?.innerText ?? ''");
  throw new Error(`journée absente — ${String(texte).replace(/\s+/g, " ").slice(-240)}`);
}

async function nomAffiche(send) {
  return String((await evaluate(send, `document.getElementById("cabinet-nom")?.value ?? ""`)) ?? "");
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

async function attendreSql(requete, attendu) {
  const start = Date.now();
  let vu = "";
  while (Date.now() - start < 60_000) {
    vu = await sqlServeur(requete);
    if (vu === attendu) return vu;
    await sleep(500);
  }
  throw new Error(`sql ${vu || "vide"} ≠ ${attendu}`);
}

async function editer(send, id, valeur) {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await evaluate(send, `Boolean(document.getElementById(${JSON.stringify(id)}))`)) break;
    await sleep(200);
  }
  await setField(send, id, valeur);
  await evaluate(send, `document.querySelector("form")?.requestSubmit()`);
  await sleep(400);
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
const retour = Date.now();
while (Date.now() - retour < 60_000) {
  const reponse = await fetch(`${instanceUrl}/health`).catch(() => null);
  if (reponse?.ok) break;
  await sleep(500);
}
console.log("j3-poste: services relancés");

const posteA3 = startApp("a");
try {
  await waitCdp(posteA3);
  const pageA = await connectCdp(posteA3.port);
  await login(pageA.send, "Poste recette A");
  pageA.ws.close();
  const ecrit = Date.now();
  let nomServeur = "";
  while (Date.now() - ecrit < 60_000) {
    nomServeur = await new Promise((resolve) => {
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
          "SELECT nom FROM cabinets LIMIT 1",
        ],
        { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
      );
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk.toString();
      });
      child.on("exit", () => resolve(out.trim()));
    });
    if (nomServeur === nomHorsLigne) break;
    await sleep(500);
  }
  await stopApp(posteA3);
  if (nomServeur !== nomHorsLigne) {
    console.error(posteA3.logTail());
    fail(`l'API n'a pas enregistré le nom (${nomServeur || "vide"})`);
  }
} catch (err) {
  console.error(posteA3.logTail());
  await stopApp(posteA3);
  fail(err instanceof Error ? err.message : "reprise A");
}

const posteB = startApp("b");
try {
  await waitCdp(posteB);
  const pageB = await connectCdp(posteB.port);
  await login(pageB.send, "Poste recette B");
  const attente = Date.now();
  let vuB = "";
  while (Date.now() - attente < 90_000) {
    vuB = await nomAffiche(pageB.send);
    if (vuB === nomHorsLigne) break;
    await sleep(500);
  }
  pageB.ws.close();
  if (vuB !== nomHorsLigne) fail(`poste B n'a pas reçu le nom (${vuB || "vide"})`);
  console.log("j3-poste: OK — modification hors ligne visible sur B");
  pageB.ws = pageB.ws;
} catch (err) {
  console.error(posteA3.logTail());
  console.error(posteB.logTail());
  await stopApp(posteB);
  fail(err instanceof Error ? err.message : "reprise B");
}
await stopApp(posteB);

await compose(["stop", "api", "powersync"]);
const fusionA = startApp("a");
try {
  await waitCdp(fusionA);
  const page = await connectCdp(fusionA.port);
  await editer(page.send, "cabinet-nom", nomFusion);
  page.ws.close();
} finally {
  await stopApp(fusionA);
}
const fusionB = startApp("b");
try {
  await waitCdp(fusionB);
  const page = await connectCdp(fusionB.port);
  await editer(page.send, "cabinet-slug", slugFusion);
  page.ws.close();
} finally {
  await stopApp(fusionB);
}
await compose(["start", "api", "powersync"]);
await attendreSql("SELECT 1", "1");
for (const id of ["a", "b"]) {
  const poste = startApp(id);
  try {
    await waitCdp(poste);
    const page = await connectCdp(poste.port);
    await login(page.send, `Poste fusion ${id}`);
    page.ws.close();
  } finally {
    await stopApp(poste);
  }
}
await attendreSql(
  "SELECT nom || '|' || slug FROM cabinets LIMIT 1",
  `${nomFusion}|${slugFusion}`,
);
console.log("j3-poste: OK — les deux champs survivent");

for (const id of ["a", "b"]) {
  const poste = startApp(id);
  try {
    await waitCdp(poste);
    const page = await connectCdp(poste.port);
    await login(page.send, `Poste aligné ${id}`);
    page.ws.close();
  } finally {
    await stopApp(poste);
  }
}

await compose(["stop", "api", "powersync"]);
for (const [id, valeur] of [
  ["a", nomConflitA],
  ["b", nomConflitB],
]) {
  const poste = startApp(id);
  try {
    await waitCdp(poste);
    const page = await connectCdp(poste.port);
    await editer(page.send, "cabinet-nom", valeur);
    page.ws.close();
  } finally {
    await stopApp(poste);
  }
}
await compose(["start", "api", "powersync"]);
const conflitsAvant = Number(
  await sqlServeur("SELECT COUNT(*) FROM journal_modifications WHERE champ = 'nom' AND conflit"),
);
for (const id of ["a", "b"]) {
  const poste = startApp(id);
  try {
    await waitCdp(poste);
    const page = await connectCdp(poste.port);
    await login(page.send, `Poste conflit ${id}`);
    page.ws.close();
  } finally {
    await stopApp(poste);
  }
}
const conflitsApres = Number(
  await attendreSql(
    `SELECT CASE WHEN (SELECT COUNT(*) FROM journal_modifications WHERE champ = 'nom' AND conflit) >= ${conflitsAvant + 1} THEN '${conflitsAvant + 1}' ELSE '' END`,
    String(conflitsAvant + 1),
  ),
);
if (conflitsApres < conflitsAvant + 1) fail(`conflit non journalisé (${conflitsAvant} → ${conflitsApres})`);
// B synchronise après A → dernière écriture = nomConflitB ; la valeur remplacée doit être journalisée.
await attendreSql("SELECT nom FROM cabinets LIMIT 1", nomConflitB);
const journalConflit = await sqlServeur(
  `SELECT valeur_remplacee || '|' || valeur_appliquee || '|' || revision_base::text
   FROM journal_modifications
   WHERE champ = 'nom' AND conflit
   ORDER BY revision_appliquee DESC
   LIMIT 1`,
);
const attenduJournal = `${nomConflitA}|${nomConflitB}|`;
if (!journalConflit.startsWith(attenduJournal)) {
  fail(`journal conflit inattendu (${journalConflit || "vide"})`);
}
const revisionBase = Number(journalConflit.slice(attenduJournal.length));
if (!Number.isFinite(revisionBase) || revisionBase < 1) {
  fail(`revision_base absente ou invalide (${journalConflit})`);
}
const posteConflit = startApp("a");
try {
  await waitCdp(posteConflit);
  const page = await connectCdp(posteConflit.port);
  await login(page.send, "Poste conflit signal");
  const debut = Date.now();
  let vu = false;
  while (Date.now() - debut < 90_000) {
    vu = Boolean(await evaluate(page.send, `Boolean(document.querySelector("[data-testid=conflit-sync]"))`));
    if (vu) break;
    await sleep(500);
  }
  page.ws.close();
  if (!vu) fail("conflit non signalé dans l'app");
} finally {
  await stopApp(posteConflit);
}
console.log("j3-poste: OK — conflit signalé");

const avant = await sqlServeur(
  `SELECT COUNT(*) FROM journal_modifications WHERE champ = 'slug' AND valeur_appliquee = '${slugCoupure}'`,
);
await compose(["stop", "api"]);
const coupure = startApp("a");
try {
  await waitCdp(coupure);
  const page = await connectCdp(coupure.port);
  await editer(page.send, "cabinet-slug", slugCoupure);
  page.ws.close();
} finally {
  await stopApp(coupure);
}
await compose(["start", "api"]);
const reprise = startApp("a");
try {
  await waitCdp(reprise);
  const page = await connectCdp(reprise.port);
  await login(page.send, "Poste coupure");
  // Coupure réelle pendant l'envoi : API figée, nouvelle écriture distincte, puis reprise.
  const slugPendant = `${slugCoupure}x`;
  await compose(["pause", "api"]);
  await editer(page.send, "cabinet-slug", slugPendant);
  await sleep(1500);
  await compose(["unpause", "api"]);
  page.ws.close();
  await attendreSql("SELECT slug FROM cabinets LIMIT 1", slugPendant);
  const apres = await sqlServeur(
    `SELECT COUNT(*) FROM journal_modifications WHERE champ = 'slug' AND valeur_appliquee IN ('${slugCoupure}', '${slugPendant}')`,
  );
  if (Number(apres) !== Number(avant) + 2) {
    fail(`doublon ou perte à l'envoi (${avant} → ${apres}, attendu ${Number(avant) + 2})`);
  }
} finally {
  await compose(["unpause", "api"]).catch(() => undefined);
  await stopApp(reprise);
}
console.log("j3-poste: OK — coupure pendant l'envoi, une seule écriture");
