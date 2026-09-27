#!/usr/bin/env node
/**
 * Acceptation — modèle de référence à l'écran (R0) : Réglages (texte + constructeur),
 * enregistrement `{AAAA}/{N:3}`, référence avec « / » intacte à l'écran et dans la palette.
 * Patron : tests/recette/reference-dossier-ecran.mjs
 * Usage : node tests/recette/reference-modele-ecran.mjs
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const envFile = existsSync(join(root, ".env")) ? join(root, ".env") : join(root, "..", "..", ".env");

function sqlServeur(requete) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "-f",
        "instance/docker-compose.yml",
        "--env-file",
        envFile,
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
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
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
      resolve({ code: code ?? 1, out: out.trim(), err: err.trim() });
    });
  });
}
const posteId = "m";
const port = "9244";
const captures = join(root, "target", "controle-reference-modele");
const MODELE = "{AAAA}/{N:3}";

function fail(message) {
  console.error(`reference-modele-ecran: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fichierSqlite() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(roaming, "fr.legalos.poste", `legalos-powersync-${posteId}.db`);
}

function resetPosteLocal() {
  for (const ext of ["", "-shm", "-wal"]) rmSync(`${fichierSqlite()}${ext}`, { force: true });
}

function startApp() {
  const dir = join(tmpdir(), `legalos-webview-modele-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-modele-${marque}.json`);
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

async function setTestId(send, testId, value) {
  const ok = await evaluate(
    send,
    `(() => {
      const el = document.querySelector(${JSON.stringify(`[data-testid=${testId}]`)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (el._valueTracker) el._valueTracker.setValue("");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  if (!ok) throw new Error(`champ ${testId}`);
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
    await setField(send, "nom-appareil", "Poste modèle référence");
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

async function ouvrirReglages(send) {
  if (await evaluate(send, `Boolean(document.querySelector("[data-testid=ecran-reglages]"))`)) return;
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /compte/i.test(b.textContent || "")) || null)?.click()`,
  );
  await sleep(200);
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /réglages/i.test(b.textContent || "")) || null)?.click()`,
  );
  await attendre(send, `Boolean(document.querySelector("[data-testid=ecran-reglages]"))`, 15_000, "Réglages");
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

async function capture(send, nom) {
  const msg = await send("Page.captureScreenshot", { format: "png" });
  const donnees = msg.result?.data;
  if (!donnees) throw new Error(`capture ${nom}`);
  mkdirSync(captures, { recursive: true });
  const chemin = join(captures, `${nom}.png`);
  writeFileSync(chemin, Buffer.from(donnees, "base64"));
  console.log(`reference-modele-ecran: capture ${chemin}`);
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) {
  console.error("reference-modele-ecran: FAIL — instance injoignable");
  process.exit(1);
}

let jeton;
try {
  jeton = await demoAccessToken(api, "modele-ecran-sonde");
} catch (err) {
  console.error(`reference-modele-ecran: FAIL — authentification API (${err instanceof Error ? err.message : err})`);
  process.exit(1);
}
const sonde = await fetch(`${api}/cabinets/${DEMO_CABINET_ID}/reference`, {
  headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
});
if (sonde.status === 404) {
  console.error("reference-modele-ecran: API personnalisée absente (GET /cabinets/{id}/reference → 404)");
  process.exit(1);
}

resetPosteLocal();
const app = startApp();
try {
  await waitCdp(app);
  const { send, ws } = await connectCdp();
  await connexion(send);
  await ouvrirReglages(send);
  await attendre(send, `Boolean(document.querySelector("[data-testid=reglages-reference-modele]"))`, 10_000, "champ modèle");
  await attendre(
    send,
    `Boolean(document.querySelector("[data-testid=reglages-reference-constructeur]"))`,
    5_000,
    "constructeur",
  );
  await attendre(
    send,
    `String(document.querySelector("[data-testid=reglages-reference-modele]")?.value || "").length > 0`,
    10_000,
    "modèle initial",
  );
  await sleep(600);
  let texte = "";
  for (let essai = 0; essai < 5; essai += 1) {
    await setTestId(send, "reglages-reference-modele", MODELE);
    await sleep(200);
    texte = String(
      await evaluate(send, `document.querySelector("[data-testid=reglages-reference-modele]")?.value ?? ""`),
    );
    if (texte === MODELE) break;
  }
  if (texte !== MODELE) fail(`champ modèle : ${texte}`);
  const seps = Number(
    await evaluate(send, `document.querySelectorAll("[data-testid=reglages-reference-separateur]").length`),
  );
  if (seps < 1) fail("constructeur sans séparateur");
  const sepValeur = String(
    await evaluate(send, `document.querySelector("[data-testid=reglages-reference-separateur]")?.value ?? ""`),
  );
  if (sepValeur !== "/") fail(`séparateur attendu « / » (${sepValeur})`);
  await evaluate(
    send,
    `(() => {
      const el = document.querySelector("[data-testid=reglages-reference-separateur]");
      if (!el) return;
      el.value = "-";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  await sleep(200);
  const apresMoins = String(
    await evaluate(send, `document.querySelector("[data-testid=reglages-reference-modele]")?.value ?? ""`),
  );
  if (apresMoins !== "{AAAA}-{N:3}") fail(`sync constructeur → texte : ${apresMoins}`);
  await evaluate(
    send,
    `(() => {
      const el = document.querySelector("[data-testid=reglages-reference-separateur]");
      if (!el) return;
      el.value = "/";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  await sleep(200);
  const apresSlash = String(
    await evaluate(send, `document.querySelector("[data-testid=reglages-reference-modele]")?.value ?? ""`),
  );
  if (apresSlash !== MODELE) fail(`retour « / » : ${apresSlash}`);
  const apercu = String(
    await evaluate(send, `document.querySelector("[data-testid=reglages-reference-apercu]")?.textContent ?? ""`),
  );
  if (!apercu.includes("/")) fail(`aperçu sans « / » (${apercu})`);
  await capture(send, "1-reglages-modele-slash");
  await evaluate(send, `document.querySelector("[data-testid=reglages-reference-enregistrer]")?.click()`);
  await sleep(800);
  console.log("reference-modele-ecran: OK — Réglages texte et constructeur synchronisés");

  await ecranDossiers(send);
  const nom = `A modèle écran ${marque}`;
  await setField(send, "dossier-nom", nom);
  await setField(send, "dossier-juridiction", "TJ de Lyon");
  await setField(send, "dossier-rg", `RG${marque}M`);
  await setField(send, "dossier-partie", `Partie ${marque}`);
  await evaluate(send, `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`);
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  await attendre(
    send,
    `/[0-9a-f-]{36}/i.test(document.querySelector("[data-testid=dossier-cree]")?.textContent ?? "")`,
    20_000,
    "création du dossier",
  );
  const idDossier = String(
    await evaluate(send, `(document.querySelector("[data-testid=dossier-cree]")?.textContent ?? "").match(/[0-9a-f-]{36}/i)?.[0] ?? ""`),
  );
  const trouverLigne = `[...document.querySelectorAll("[data-testid=liste-dossier]")].find((b) => (b.textContent || "").includes(${JSON.stringify(nom)}))`;
  await attendre(send, `Boolean(${trouverLigne})`, 15_000, "ligne du dossier");
  const debut = Date.now();
  let reference = "";
  while (Date.now() - debut < 120_000) {
    reference = String(await evaluate(send, `${trouverLigne}?.getAttribute("data-reference") ?? ""`));
    if (reference.includes("/")) break;
    await sleep(1_000);
  }
  if (!reference.includes("/")) fail(`référence sans « / » à l'écran (${reference})`);
  console.log(`reference-modele-ecran: OK — référence à l'écran « ${reference} »`);

  if (!(await evaluate(send, `Boolean(document.getElementById("palette-recherche"))`))) {
    await evaluate(send, `document.getElementById("ouvrir-palette")?.click()`);
    await sleep(300);
  }
  await setField(send, "palette-recherche", reference);
  await attendre(
    send,
    `Boolean(document.querySelector(${JSON.stringify(`[data-testid=palette-resultat][data-dossier-id="${idDossier}"]`)}))`,
    15_000,
    "palette",
  );
  const paletteRef = String(
    await evaluate(
      send,
      `document.querySelector(${JSON.stringify(`[data-testid=palette-resultat][data-dossier-id="${idDossier}"]`)})?.getAttribute("data-reference") ?? ""`,
    ),
  );
  if (paletteRef !== reference) fail(`palette data-reference : ${paletteRef} ≠ ${reference}`);
  if (!paletteRef.includes("/")) fail(`palette sans « / » (${paletteRef})`);
  await capture(send, "2-palette-reference-slash");
  console.log(`reference-modele-ecran: OK — palette « ${paletteRef} »`);

  const idCollision = randomUUID();
  await sqlServeur(
    `DELETE FROM dossiers WHERE cabinet_id = '${DEMO_CABINET_ID}' AND reference = '999999999'`,
  );
  const insertCollision = await sqlServeur(
    `INSERT INTO dossiers (
       id, cabinet_id, nom, chemise, juridiction, numero_rg,
       reference, reference_annee, reference_numero, restreint, visibilite, revision
     ) VALUES (
       '${idCollision}', '${DEMO_CABINET_ID}', 'fictif collision ecran', 'kraft', 'x', 'RG-ECRAN',
       '999999999', 2019, 999999999, false, 'public', 1
     )`,
  );
  if (insertCollision.code !== 0) {
    fail(`référence 999999999 : ${insertCollision.err || insertCollision.out}`);
  }
  console.log("reference-modele-ecran: référence nombre 999999999");

  await ouvrirReglages(send);
  await attendre(
    send,
    `String(document.querySelector("[data-testid=reglages-reference-modele]")?.value || "").includes("AAAA")`,
    10_000,
    "modèle chargé",
  );
  await sleep(500);
  const pose = await evaluate(
    send,
    `(() => {
      const politique = document.querySelector("[data-testid=reglages-reference-politique]");
      const modele = document.querySelector("[data-testid=reglages-reference-modele]");
      if (!politique || !modele) return "champs absents";
      const selectProto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
      selectProto.set.call(politique, "jamais");
      politique.dispatchEvent(new Event("change", { bubbles: true }));
      const inputProto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (modele._valueTracker) modele._valueTracker.setValue("");
      inputProto.set.call(modele, "{N}");
      modele.dispatchEvent(new Event("input", { bubbles: true }));
      return politique.value + "|" + modele.value;
    })()`,
  );
  await sleep(400);
  if (pose !== "jamais|{N}") fail(`préparation du 409 : ${pose}`);
  await evaluate(send, `document.querySelector("[data-testid=reglages-reference-enregistrer]")?.click()`);
  const debutMinimal = Date.now();
  let minimal = "";
  let message409 = "";
  while (Date.now() - debutMinimal < 15_000) {
    minimal = String(
      await evaluate(
        send,
        `(document.querySelector("[data-testid=reglages-reference-numero-minimal]")?.textContent || "").trim()`,
      ),
    );
    if (/^\d+$/.test(minimal)) break;
    message409 = String(
      await evaluate(
        send,
        `document.querySelector("[data-testid=ecran-reglages] [role=status]")?.textContent || ""`,
      ),
    );
    await sleep(250);
  }
  if (!/^\d+$/.test(minimal) || Number(minimal) < 1) {
    fail(`numero_depart_minimal affiché : ${minimal || "vide"} ; message : ${message409}`);
  }
  await capture(send, "3-reglages-numero-minimal");
  console.log(`reference-modele-ecran: OK — numéro de départ minimal ${minimal}`);
  ws.close();
  console.log("reference-modele-ecran: OK");
} catch (err) {
  if (process.exitCode !== 1) {
    console.error(`reference-modele-ecran: FAIL — ${err instanceof Error ? err.message : err}`);
    console.error(app.logTail());
    process.exitCode = 1;
  }
} finally {
  await stopApp(app);
  try {
    const etat = await fetch(`${api}/cabinets/${DEMO_CABINET_ID}/reference`, {
      headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
    });
    const corps = await etat.json();
    const depart = Number(corps.prochain_numero);
    await sqlServeur(
      `DELETE FROM dossiers WHERE cabinet_id = '${DEMO_CABINET_ID}' AND reference = '999999999'`,
    );
    if (Number.isInteger(depart) && depart >= 1) {
      await fetch(`${api}/cabinets/${DEMO_CABINET_ID}/reference`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${jeton}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotence_cle: `restaurer-ecran-${marque}`,
          modele: "{AAAA}-{N:3}",
          remise_a_zero: "annuelle",
          numero_depart: depart,
        }),
      });
    }
  } catch {
    console.error("reference-modele-ecran: restauration du modèle par défaut non confirmée");
  }
}
