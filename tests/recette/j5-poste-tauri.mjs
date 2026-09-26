#!/usr/bin/env node
/**
 * J5 — S3 (dossier + palette) et S5 (dossier restreint + enfants absents du SQLite du collaborateur).
 * Preuve SQLite poste B : dossiers, parties, documents, document_versions, temps_saisis, brouillons_facture.
 * Ne journalise aucun secret.
 */
import { createHash, randomUUID } from "node:crypto";
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
const marque = String(Date.now()).slice(-6);
const rgPublic = `RG${marque}A`;
const rgRestreint = `RG${marque}R`;
const collabEmail = "collab-j5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

function fail(message) {
  console.error(`j5-poste: FAIL — ${message}`);
  process.exit(1);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const port = id === "a" ? "9222" : "9232";
  const dir = join(tmpdir(), `legalos-webview-j5-${id}-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-j5-${id}-${marque}.json`);
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
    const coque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=ecran-journee], [data-testid=ecran-dossiers], [data-testid=barre-haut]")) && !document.getElementById("instance-url") && !document.getElementById("code-totp")`,
    );
    if (totpSoumis && coque) {
      await ouvrirFormulaireDossier(send);
      return;
    }
    await sleep(250);
  }
  throw new Error("journée absente");
}

/** Coque : le formulaire n'est plus sur La journée — Dossiers ou panneau « Nouveau dossier ». */
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
  throw new Error("formulaire dossier absent (coque)");
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
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`psql ${code}`));
    });
  });
}

function sqliteLocal(id, requete) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${id}.db`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [
        "-c",
        "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute(sys.argv[2]).fetchall())",
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
      else reject(new Error(err.slice(-200) || `sqlite ${code}`));
    });
  });
}

function empreinte(octets) {
  return createHash("sha256").update(octets).digest("hex");
}

async function apiJson(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) {
    throw new Error(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 180)}`);
  }
  return texte ? JSON.parse(texte) : {};
}

async function deposerGarage(url, octets, entetes) {
  const headers = {};
  if (entetes && typeof entetes === "object") {
    for (const [nom, valeur] of Object.entries(entetes)) {
      if (typeof valeur === "string") headers[nom] = valeur;
    }
  }
  const reponse = await fetch(url, { method: "PUT", body: octets, headers });
  if (!reponse.ok) {
    const texte = await reponse.text();
    throw new Error(`dépôt S3 → ${reponse.status} ${texte.slice(0, 120)}`);
  }
}

/** Pièce + temps + brouillon sur le dossier restreint — sans eux les SELECT S5 seraient vacueux. */
async function peuplerDossierRestreint(jeton, dossierId) {
  const documentId = randomUUID();
  const contenu = Buffer.from(`piece-restreinte-j5-${marque}`);
  const depot = await apiJson("/documents", jeton, "POST", {
    id: documentId,
    dossier_id: dossierId,
    nom: `note-restreinte-${marque}.txt`,
    idempotence_cle: `${documentId}:creer`,
  });
  if (depot.numero !== 1 || !depot.url) {
    throw new Error("dépôt initial pièce restreinte inattendu");
  }
  await deposerGarage(depot.url, contenu, depot.entetes);
  await apiJson(`/documents/${documentId}/versions/1/sceller`, jeton, "POST", {
    empreinte: empreinte(contenu),
    idempotence_cle: `${documentId}:v1`,
  });

  const tempsId = randomUUID();
  await apiJson("/temps", jeton, "POST", {
    id: tempsId,
    dossier_id: dossierId,
    minutes: 45,
    libelle: `Temps restreint J5 ${marque}`,
    taux_centimes_heure: 12_000,
    idempotence_cle: `${tempsId}:temps`,
  });
  const brouillonId = randomUUID();
  await apiJson("/brouillons-facture", jeton, "POST", {
    id: brouillonId,
    dossier_id: dossierId,
    temps_id: tempsId,
    libelle: `Brouillon restreint J5 ${marque}`,
    ht_centimes: 9_000,
    taux_centimes_heure: 12_000,
    idempotence_cle: `${brouillonId}:brouillon`,
  });

  return { documentId, tempsId, brouillonId };
}

async function creerDossier(send, { nom, rg, restreint, precedent = "" }) {
  await setField(send, "dossier-nom", nom);
  await setField(send, "dossier-juridiction", "TJ de Lyon");
  await setField(send, "dossier-rg", rg);
  await setField(send, "dossier-partie", `Partie ${rg}`);
  if (restreint) {
    await evaluate(send, `document.getElementById("dossier-restreint")?.click()`);
  }
  await evaluate(
    send,
    `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`,
  );
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  const debut = Date.now();
  while (Date.now() - debut < 20_000) {
    const cree = await evaluate(send, `document.querySelector("[data-testid=dossier-cree]")?.textContent ?? ""`);
    const texte = String(cree).trim();
    if (/[0-9a-f-]{36}/i.test(texte) && texte !== precedent) return texte;
    await sleep(200);
  }
  const texte = await evaluate(
    send,
    `document.querySelector("[data-testid=dossier-cree]")?.textContent ?? ""`,
  );
  throw new Error(`dossier ${rg} non créé (${String(texte).slice(0, 180)})`);
}

const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const jeton = await demoAccessToken(`${instanceUrl}/api`, "j5-creation-collab");
const creation = await fetch(`${instanceUrl}/api/collaborateurs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
  body: JSON.stringify({
    email: collabEmail,
    password: collabPassword,
    totp_secret_base32: collabTotp,
  }),
});
if (!creation.ok) fail(`collaborateur ${creation.status}`);
console.log("j5-poste: collaborateur fictif prêt");

resetPostesLocaux();
const posteA = startApp("a");
try {
  await waitCdp(posteA);
  const { send, ws } = await connectCdp(posteA.port);
  await login(send, demoEmail, demoPassword, undefined, "Poste A J5");
  const idPublic = await creerDossier(send, {
    nom: `Dossier public ${marque}`,
    rg: rgPublic,
    restreint: false,
  });
  await evaluate(send, `document.getElementById("ouvrir-palette")?.click()`);
  await setField(send, "palette-recherche", rgPublic);
  const debutPalette = Date.now();
  let trouve = false;
  while (Date.now() - debutPalette < 15_000) {
    const n = await evaluate(
      send,
      `document.querySelectorAll("[data-testid=palette-resultat]").length`,
    );
    if (Number(n) >= 1) {
      trouve = true;
      break;
    }
    await sleep(200);
  }
  if (!trouve) fail("palette muette");
  const paletteIds = await evaluate(
    send,
    `JSON.stringify([...document.querySelectorAll("[data-testid=palette-resultat]")].map((n) => n.getAttribute("data-dossier-id")))`,
  );
  if (!String(paletteIds).includes(idPublic)) {
    fail(`palette sans id public (${paletteIds})`);
  }
  console.log("j5-poste: OK — dossier retrouvé par la palette");
  const idRestreint = await creerDossier(send, {
    nom: `Dossier restreint ${marque}`,
    rg: rgRestreint,
    restreint: true,
    precedent: idPublic,
  });
  const debutSql = Date.now();
  let serveur = "";
  while (Date.now() - debutSql < 60_000) {
    serveur = await sqlServeur(
      `SELECT COUNT(*) FROM dossiers WHERE numero_rg IN ('${rgPublic}', '${rgRestreint}')`,
    );
    if (serveur === "2") break;
    await sleep(500);
  }
  if (serveur !== "2") fail(`serveur ${serveur || "vide"}`);
  const metaPublic = await sqlServeur(
    `SELECT chemise || '|' || juridiction || '|' || restreint::text || '|' || visibilite FROM dossiers WHERE id = '${idPublic}'`,
  );
  if (!/^bleu-classeur\|TJ de Lyon\|(f|false)\|public$/i.test(metaPublic)) {
    fail(`métadonnées public (${metaPublic})`);
  }
  const metaRestreint = await sqlServeur(
    `SELECT chemise || '|' || juridiction || '|' || restreint::text || '|' || visibilite FROM dossiers WHERE id = '${idRestreint}'`,
  );
  if (!/^bleu-classeur\|TJ de Lyon\|(t|true)\|restreint$/i.test(metaRestreint)) {
    fail(`métadonnées restreint (${metaRestreint})`);
  }
  const partiesRestreintes = await sqlServeur(
    `SELECT COUNT(*) FROM parties WHERE dossier_id = '${idRestreint}' AND visibilite = 'restreint'`,
  );
  if (partiesRestreintes !== "1") fail(`parties restreintes serveur (${partiesRestreintes})`);
  const accesEtranger = await sqlServeur(
    `SELECT COUNT(*) FROM dossier_acces a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE a.dossier_id = '${idRestreint}' AND u.email = '${collabEmail}'`,
  );
  if (accesEtranger !== "0") fail(`accès collab sur restreint (${accesEtranger})`);
  console.log("j5-poste: deux dossiers sur le serveur (chemise + cloisonnement)");

  const { documentId, tempsId, brouillonId } = await peuplerDossierRestreint(jeton, idRestreint);
  const docsServeur = await sqlServeur(
    `SELECT COUNT(*) FROM documents WHERE id = '${documentId}' AND dossier_id = '${idRestreint}'`,
  );
  if (docsServeur !== "1") fail(`document restreint absent serveur (${docsServeur})`);
  const versionsServeur = await sqlServeur(
    `SELECT COUNT(*) FROM document_versions WHERE document_id = '${documentId}' AND dossier_id = '${idRestreint}' AND numero = 1`,
  );
  if (versionsServeur !== "1") fail(`version restreinte absente serveur (${versionsServeur})`);
  const tempsServeur = await sqlServeur(
    `SELECT COUNT(*) FROM temps_saisis WHERE id = '${tempsId}' AND dossier_id = '${idRestreint}'`,
  );
  if (tempsServeur !== "1") fail(`temps restreint absent serveur (${tempsServeur})`);
  const brouillonsServeur = await sqlServeur(
    `SELECT COUNT(*) FROM brouillons_facture WHERE id = '${brouillonId}' AND dossier_id = '${idRestreint}'`,
  );
  if (brouillonsServeur !== "1") fail(`brouillon restreint absent serveur (${brouillonsServeur})`);
  console.log("j5-poste: pièce + temps + brouillon déposés sur le dossier restreint (API)");

  ws.close();
  await stopApp(posteA);

  const posteB = startApp("b");
  try {
    await waitCdp(posteB);
    const sessionB = await connectCdp(posteB.port);
    await login(sessionB.send, collabEmail, collabPassword, collabTotp, "Poste B J5");
    const debutB = Date.now();
    let local = "";
    while (Date.now() - debutB < 90_000) {
      local = await sqliteLocal(
        "b",
        `SELECT id FROM dossiers WHERE numero_rg = '${rgPublic}'`,
      ).catch(() => "");
      if (local.includes(idPublic)) break;
      await sleep(1000);
    }
    if (!local.includes(idPublic)) fail(`dossier public absent de B (${local || "vide"})`);
    // Attente supplémentaire : laisser une fenêtre de sync pour un éventuel seau global erroné.
    await sleep(5_000);
    const interdit = await sqliteLocal(
      "b",
      `SELECT id FROM dossiers WHERE id = '${idRestreint}' OR numero_rg = '${rgRestreint}'`,
    );
    if (interdit !== "[]") fail(`dossier restreint présent chez B (${interdit})`);
    const partiesLocales = await sqliteLocal(
      "b",
      `SELECT id FROM parties WHERE dossier_id = '${idRestreint}'`,
    );
    if (partiesLocales !== "[]") {
      fail(`parties du dossier restreint présentes chez B (${partiesLocales})`);
    }
    const documentsLocaux = await sqliteLocal(
      "b",
      `SELECT id FROM documents WHERE dossier_id = '${idRestreint}'`,
    );
    if (documentsLocaux !== "[]") {
      fail(`documents du dossier restreint présents chez B (${documentsLocaux})`);
    }
    const versionsLocales = await sqliteLocal(
      "b",
      `SELECT id FROM document_versions WHERE dossier_id = '${idRestreint}'`,
    );
    if (versionsLocales !== "[]") {
      fail(`document_versions du dossier restreint présents chez B (${versionsLocales})`);
    }
    const tempsLocaux = await sqliteLocal(
      "b",
      `SELECT id FROM temps_saisis WHERE dossier_id = '${idRestreint}' OR id = '${tempsId}'`,
    );
    if (tempsLocaux !== "[]") {
      fail(`temps_saisis du dossier restreint présents chez B (${tempsLocaux})`);
    }
    const brouillonsLocaux = await sqliteLocal(
      "b",
      `SELECT id FROM brouillons_facture WHERE dossier_id = '${idRestreint}' OR id = '${brouillonId}'`,
    );
    if (brouillonsLocaux !== "[]") {
      fail(`brouillons_facture du dossier restreint présents chez B (${brouillonsLocaux})`);
    }
    const tousLesRg = await sqliteLocal("b", `SELECT numero_rg FROM dossiers`);
    if (String(tousLesRg).includes(rgRestreint)) {
      fail(`RG restreint visible en scan complet chez B (${tousLesRg})`);
    }
    console.log(
      "j5-poste: OK — dossier restreint et enfants (docs, versions, temps, brouillons) absents du SQLite de B",
    );
    sessionB.ws.close();
  } finally {
    await stopApp(posteB);
  }
} catch (error) {
  console.error(posteA.logTail());
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await stopApp(posteA);
}
