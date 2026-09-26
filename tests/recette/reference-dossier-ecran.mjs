#!/usr/bin/env node
/**
 * Acceptation contrôleur — Référence de dossier (cahier § 3.4 et § 7.4), à l'écran de l'app Tauri :
 * « Un dossier créé hors ligne affiche « référence en attente » jusqu'à la synchronisation. »
 * Étiquette « Dossier 2026-042 » (§ 7.4) ; couleur de chemise jamais sans nom ni référence (§ 7.5).
 *
 * Coupure réelle (api + powersync en pause) : dossier créé sur le poste, ouvert depuis la liste →
 * étiquette, onglet et ligne de liste « Référence en attente » ; retour du réseau → référence serveur
 * dans l'étiquette (« Dossier AAAA-NNN ») et l'onglet. Captures dans target/controle-reference/.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const poste = join(root, "apps/poste");
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const marque = String(Date.now()).slice(-6);
const posteId = "r";
const port = "9242";
const captures = join(root, "target", "controle-reference");
const EN_ATTENTE = "Référence en attente";
const MOTIF = /^\d{4}-\d{3,}$/;

function fail(message) {
  console.error(`reference-dossier-ecran: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliser(texte) {
  return String(texte ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
}

function fichierSqlite() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(roaming, "fr.legalos.poste", `legalos-powersync-${posteId}.db`);
}

function resetPosteLocal() {
  for (const ext of ["", "-shm", "-wal"]) rmSync(`${fichierSqlite()}${ext}`, { force: true });
}

function startApp() {
  const dir = join(tmpdir(), `legalos-webview-ref-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-ref-${marque}.json`);
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
      LEGALOS_POSTE_ID: posteId,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (morceau) => {
    log += morceau.toString();
    if (log.length > 12000) log = log.slice(-12000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
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
}

async function waitCdp(child) {
  const debut = Date.now();
  while (Date.now() - debut < 360_000) {
    if (child.exitCode !== null) throw new Error(`tauri arrêté (${child.exitCode})`);
    try {
      const liste = await fetch(`http://127.0.0.1:${port}/json`);
      if (liste.ok && (await liste.json()).some((t) => t.type === "page" && t.webSocketDebuggerUrl)) return;
    } catch {
      /* webview pas encore prête */
    }
    await sleep(300);
  }
  throw new Error("webview absente");
}

async function connectCdp() {
  const liste = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = liste.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("websocket")));
  });
  let seq = 0;
  const enAttente = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const fin = enAttente.get(msg.id);
    if (fin) {
      enAttente.delete(msg.id);
      fin(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      enAttente.set(id, resolve);
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

async function attendre(send, expression, delai, libelle) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await evaluate(send, expression)) return;
    await sleep(250);
  }
  throw new Error(`délai dépassé : ${libelle}`);
}

async function connexion(send) {
  await attendre(
    send,
    `Boolean(document.getElementById("instance-url") || document.getElementById("email") || document.getElementById("code-totp"))`,
    60_000,
    "écran de connexion",
  );
  if (await evaluate(send, `Boolean(document.getElementById("instance-url"))`)) {
    await setField(send, "instance-url", instanceUrl);
    await evaluate(send, `document.getElementById("instance-url")?.closest("form")?.requestSubmit()`);
    await attendre(send, `Boolean(document.getElementById("email"))`, 45_000, "formulaire d'identifiants");
  }
  if (await evaluate(send, `Boolean(document.getElementById("email"))`)) {
    await setField(send, "email", demoEmail);
    await setField(send, "password", demoPassword);
    await setField(send, "nom-appareil", "Poste contrôle référence");
    await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  }
  await attendre(send, `Boolean(document.getElementById("code-totp"))`, 45_000, "écran TOTP");
  await setField(send, "code-totp", totpNow());
  await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
  await attendre(
    send,
    `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("code-totp")`,
    180_000,
    "coque après connexion",
  );
}

async function ecranDossiers(send) {
  if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /dossiers/i.test(b.textContent || "")) || null)?.click()`,
  );
  await sleep(400);
  if (!(await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`))) {
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /nouveau dossier/i.test(b.textContent || "")) || null)?.click()`,
    );
  }
  await attendre(send, `Boolean(document.getElementById("dossier-nom"))`, 15_000, "écran Dossiers");
}

function compose(args) {
  return new Promise((resolve, reject) => {
    const enfant = spawn("docker", ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", ...args], {
      cwd: root,
      stdio: "ignore",
    });
    enfant.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`compose ${args[0]}`))));
  });
}

function sqliteLocal(requete) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(
      "python",
      ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute(sys.argv[2]).fetchall())", fichierSqlite(), requete],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    enfant.stdout.on("data", (m) => {
      out += m.toString();
    });
    enfant.stderr.on("data", (m) => {
      err += m.toString();
    });
    enfant.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.slice(-200)))));
  });
}

async function capture(send, nom) {
  const msg = await send("Page.captureScreenshot", { format: "png" });
  const donnees = msg.result?.data;
  if (!donnees) throw new Error(`capture ${nom}`);
  mkdirSync(captures, { recursive: true });
  const chemin = join(captures, `${nom}.png`);
  writeFileSync(chemin, Buffer.from(donnees, "base64"));
  console.log(`reference-dossier-ecran: capture ${chemin}`);
}

/** Onglet du dossier : dans la piste, sinon dans le menu « Dossiers ouverts supplémentaires ». */
async function lireEcran(send, nom) {
  const lirePiste = `JSON.stringify((() => {
    const o = [...document.querySelectorAll(".onglet-dossier")].find((n) => (n.querySelector(".onglet-dossier__nom")?.textContent || "").includes(${JSON.stringify(nom)}));
    return {
      etiquette: document.querySelector("[data-testid=etiquette-dossier] .etiquette-dossier__ref")?.textContent ?? null,
      largeur: window.innerWidth,
      piste: document.querySelectorAll(".onglet-dossier").length,
      onglet: o ? { classe: o.className, data: o.getAttribute("data-reference"), texte: o.querySelector(".onglet-dossier__ref")?.textContent ?? "" } : null,
    };
  })())`;
  const brut = JSON.parse(String(await evaluate(send, lirePiste)));
  let onglet = brut.onglet ? { ou: "piste", ...brut.onglet } : null;
  if (!onglet) {
    await evaluate(
      send,
      `(() => { const b = document.querySelector("[data-testid=onglets-overflow]"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); })()`,
    );
    await sleep(300);
    const item = JSON.parse(
      String(
        await evaluate(
          send,
          `JSON.stringify((() => { const b = [...document.querySelectorAll(".onglets-overflow__item")].find((n) => (n.textContent || "").includes(${JSON.stringify(nom)})); return b ? { data: b.getAttribute("data-reference"), texte: b.textContent } : null; })())`,
        ),
      ),
    );
    if (item) onglet = { ou: "menu", classe: "", ...item };
  }
  return {
    etiquette: normaliser(brut.etiquette),
    largeur: brut.largeur,
    piste: brut.piste,
    onglet: onglet ? { ...onglet, data: normaliser(onglet.data), texte: normaliser(onglet.texte) } : null,
  };
}

function ongletAffiche(ecran, libelle) {
  if (!ecran.onglet || ecran.onglet.data !== libelle) return false;
  return ecran.onglet.ou === "piste" ? ecran.onglet.texte === libelle : ecran.onglet.texte.startsWith(libelle);
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) {
  console.error("reference-dossier-ecran: FAIL — instance injoignable");
  process.exit(1);
}

resetPosteLocal();
const app = startApp();
let enPause = false;
try {
  await waitCdp(app);
  const { send, ws } = await connectCdp();
  await connexion(send);
  await ecranDossiers(send);
  console.log("reference-dossier-ecran: connecté, écran Dossiers");

  // La liste Dossiers n'affiche que les 50 premiers noms (tri binaire SQLite) : le nom doit passer en tête.
  const nom = `A contrôle écran ${marque}`;
  await compose(["pause", "api", "powersync"]);
  enPause = true;
  await setField(send, "dossier-nom", nom);
  await setField(send, "dossier-juridiction", "TJ de Lyon");
  await setField(send, "dossier-rg", `RG${marque}E`);
  await setField(send, "dossier-partie", `Partie ${marque}`);
  await evaluate(send, `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`);
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  await attendre(
    send,
    `/[0-9a-f-]{36}/i.test(document.querySelector("[data-testid=dossier-cree]")?.textContent ?? "")`,
    20_000,
    "création du dossier hors ligne",
  );
  const idDossier = String(
    await evaluate(send, `(document.querySelector("[data-testid=dossier-cree]")?.textContent ?? "").match(/[0-9a-f-]{36}/i)?.[0] ?? ""`),
  );
  const refLocale = await sqliteLocal(`SELECT reference FROM dossiers WHERE id = '${idDossier}'`);
  if (refLocale !== "[(None,)]") fail(`SQLite : référence NULL attendue hors ligne (${refLocale})`);
  console.log(`reference-dossier-ecran: dossier ${idDossier} créé hors ligne, SQLite NULL`);

  const trouverLigne = `[...document.querySelectorAll("[data-testid=liste-dossier]")].find((b) => (b.textContent || "").includes(${JSON.stringify(nom)}))`;
  await attendre(send, `Boolean(${trouverLigne})`, 15_000, "ligne du dossier dans la liste");
  const ligne = normaliser(await evaluate(send, `${trouverLigne}?.textContent ?? ""`));
  const ligneData = normaliser(await evaluate(send, `${trouverLigne}?.getAttribute("data-reference") ?? ""`));
  if (!ligne.startsWith(EN_ATTENTE) || ligneData !== EN_ATTENTE) {
    fail(`liste hors ligne : « ${EN_ATTENTE} » attendu (${ligne} | ${ligneData})`);
  }
  console.log(`reference-dossier-ecran: OK — liste : « ${ligne} »`);

  await evaluate(send, `${trouverLigne}?.click()`);
  await attendre(send, `Boolean(document.querySelector("[data-testid=etiquette-dossier]"))`, 10_000, "étiquette du dossier");
  await sleep(500);
  const horsLigne = await lireEcran(send, nom);
  console.log(
    `reference-dossier-ecran: fenêtre ${horsLigne.largeur} px, ${horsLigne.piste} onglet(s) dans la piste, onglet du dossier : ${horsLigne.onglet?.ou ?? "absent"}`,
  );
  await capture(send, "1-hors-ligne-reference-en-attente");
  if (horsLigne.etiquette !== EN_ATTENTE) fail(`étiquette hors ligne : « ${EN_ATTENTE} » attendu (${horsLigne.etiquette})`);
  if (!ongletAffiche(horsLigne, EN_ATTENTE)) {
    fail(`onglet hors ligne : « ${EN_ATTENTE} » attendu (${JSON.stringify(horsLigne.onglet)})`);
  }
  await sleep(3_000);
  const toujours = await lireEcran(send, nom);
  if (toujours.etiquette !== EN_ATTENTE || !ongletAffiche(toujours, EN_ATTENTE)) {
    fail(`référence apparue sans serveur (${JSON.stringify(toujours)})`);
  }
  console.log(`reference-dossier-ecran: OK — étiquette et onglet « ${EN_ATTENTE} » hors ligne (3 s plus tard aussi)`);

  await compose(["unpause", "api", "powersync"]);
  enPause = false;
  const debut = Date.now();
  let refServeur = "";
  let ecran = toujours;
  while (Date.now() - debut < 120_000) {
    const local = await sqliteLocal(`SELECT reference FROM dossiers WHERE id = '${idDossier}'`).catch(() => "");
    refServeur = /'(\d{4}-\d{3,})'/.exec(local)?.[1] ?? "";
    if (refServeur) {
      ecran = await lireEcran(send, nom);
      if (ecran.etiquette === `Dossier ${refServeur}` && ongletAffiche(ecran, refServeur)) break;
    }
    await sleep(1_000);
  }
  await capture(send, "2-apres-synchronisation-reference-serveur");
  if (!MOTIF.test(refServeur)) fail(`référence serveur absente du SQLite après retour du réseau (${refServeur || "vide"})`);
  if (ecran.etiquette !== `Dossier ${refServeur}`) fail(`étiquette : « Dossier ${refServeur} » attendu (${ecran.etiquette})`);
  if (!ongletAffiche(ecran, refServeur)) fail(`onglet : « ${refServeur} » attendu (${JSON.stringify(ecran.onglet)})`);
  console.log(`reference-dossier-ecran: OK — étiquette « Dossier ${refServeur} » et onglet « ${refServeur} » après synchronisation`);
  ws.close();
  console.log("reference-dossier-ecran: OK");
} catch (err) {
  if (process.exitCode !== 1) {
    console.error(`reference-dossier-ecran: FAIL — ${err instanceof Error ? err.message : err}`);
    console.error(app.logTail());
    process.exitCode = 1;
  }
} finally {
  if (enPause) await compose(["unpause", "api", "powersync"]).catch(() => undefined);
  await stopApp(app);
}
