#!/usr/bin/env node
/**
 * J11 — « une journée sans Outlook » : critère final du jalon. Un avocat traite sa boîte nominative depuis l'app Tauri,
 * sans autre client mail, contre l'instance, PowerSync, GreenMail (envoi, copie dans Envoyés, boîte de contrôle) et le
 * Dovecot de `instance/imap-test` (boîte nominative : QRESYNC, donc le moteur relève un dépôt sans attendre 10 minutes).
 *
 * Seuls passent hors de l'app : le dépôt des mails entrants (l'extérieur), la lecture de contrôle côté serveur IMAP,
 * et le décor (dossier, boîte nominative, ancienneté des vieux mails). Chaque action de l'utilisateur passe par
 * l'interface de l'app (clics, saisie au clavier, glisser-déposer), jamais par l'API directement.
 *
 * Étapes, chacune avec ses essais négatifs (une assertion qui doit échouer sur un faux état) :
 *   1. Réglages : une signature par boîte, enregistrée seulement au clic ;
 *   2. recevoir : deux mails déposés pendant que l'app est ouverte arrivent dans « À classer », non lus ;
 *   3. lire : corps, expéditeur, pièce jointe, date du jour ;
 *   4. classer : dans un dossier, le compteur et la liste suivent, l'autre mail reste à classer ;
 *   5. répondre avec l'historique cité : fil (In-Reply-To), signature de la boîte, aucune pièce, aucune copie cachée ;
 *   6. transférer avec la pièce jointe d'origine : aucun fil, historique du message transféré ;
 *   7. rédiger un mail neuf avec une pièce jointe (glisser-déposer) et la signature du cabinet ; envoi refusé sans
 *      destinataire ;
 *   8. reprendre un brouillon sur un second poste, l'envoyer de là ; le premier poste le voit partir ;
 *   9. accepter une invitation reçue : réponse iTIP (PARTSTAT=ACCEPTED) reçue une fois par l'organisateur ;
 *  10. retrouver un ancien mail par la recherche : classé dans un dossier et hors dossier.
 * Captures du poste réel : design/captures/j11-mails/journee-*.png.
 *
 * Prérequis : instance démarrée (`cd instance && docker compose -f docker-compose.yml --env-file ../.env up -d --wait`)
 * avec GreenMail ; le script démarre `instance/imap-test` s'il est arrêté. `python` pour les clients IMAP de contrôle.
 * Une seule recette à la fois (port 1420, instance partagée).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerClientImap, corpsDe, piecesDe, valeurEnTete } from "./lib/imap-controle.mjs";
import { MOT_IMAP_TEST, conteneur, connecterAuReseauApi } from "./lib/moteur-mail.mjs";
import { creerSession, racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { creerUi, lit, norm, occurrences, ordre } from "./lib/ui-mails.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dossierCaptures = join(racine, "design", "captures", "j11-mails");
const session = creerSession("j11-journee");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, setField, fermer } = session;

const marque = String(Date.now()).slice(-6);
let send;
const ui = creerUi({ getSend: () => send, fail, dossierCaptures });
const {
  js, cliquer, texteDe, present, compter, sqliteLocal, htmlCorps, idBrouillon, desactive, valeurDe, saisir,
  choisirOption, taper, touche, entree, focusCorps, curseurFinCorps, deposer, capturer, attendre, verifier,
  essaiNegatif,
} = ui;

const FORM = "[data-testid=mails-redaction]";
const BOITE_CABINET = "demo@cabinet.example";
const adressePerso = `journee.${marque}@cabinet.example`;
/** L'extérieur : un correspondant dont la boîte est la boîte de contrôle GreenMail (il reçoit les réponses). */
const correspondant = BOITE_CABINET;
const CRLF = "\r\n";

// ---------------------------------------------------------------------------------------------
// Serveurs de contrôle
// ---------------------------------------------------------------------------------------------

function motDePasseCabinet() {
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

/** Boîte de contrôle du cabinet (GreenMail de l'instance) : reçoit les envois, garde Envoyés et Brouillons. */
let cabinet;
/** Boîte « capa » du Dovecot d'imap-test : la boîte nominative de l'avocat, où l'extérieur dépose ses mails. */
const capa = creerClientImap({ hote: "127.0.0.1", port: "1143", login: "capa", secret: MOT_IMAP_TEST });

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

function dossierBrouillonsCabinet() {
  const noms = cabinet.dossiers();
  const dernier = (nom) => nom.split(/[/.]/).pop().toLowerCase();
  return noms.find((n) => dernier(n) === "drafts") ?? noms.find((n) => dernier(n) === "brouillons") ?? "Brouillons";
}
const copiesBrouillon = (messageId) => cabinet.chercher(dossierBrouillonsCabinet(), "Message-ID", messageId);
const recusCabinet = (entete, valeur) => cabinet.chercher("INBOX", entete, valeur);

// ---------------------------------------------------------------------------------------------
// Mails déposés par l'extérieur
// ---------------------------------------------------------------------------------------------

/** Message brut. `piece` : { nom, type, base64 } ; `ical` : corps text/calendar (alternative). */
function courrier({ de, a, objet, id, date = new Date().toUTCString(), texte, piece, ical }) {
  const entetes = [`From: ${de}`, `To: ${a}`, `Subject: ${objet}`, `Message-ID: ${id}`, `Date: ${date}`, "MIME-Version: 1.0"];
  if (piece) {
    return [
      ...entetes,
      'Content-Type: multipart/mixed; boundary="limite-jso"',
      "",
      "--limite-jso",
      "Content-Type: text/plain; charset=utf-8",
      "",
      texte,
      "--limite-jso",
      `Content-Type: ${piece.type}; name="${piece.nom}"`,
      `Content-Disposition: attachment; filename="${piece.nom}"`,
      "Content-Transfer-Encoding: base64",
      "",
      piece.base64,
      "--limite-jso--",
      "",
    ].join(CRLF);
  }
  if (ical) {
    return [
      ...entetes,
      'Content-Type: multipart/alternative; boundary="limite-jso"',
      "",
      "--limite-jso",
      "Content-Type: text/plain; charset=utf-8",
      "",
      texte,
      "--limite-jso",
      "Content-Type: text/calendar; charset=utf-8; method=REQUEST",
      "",
      ical,
      "--limite-jso--",
      "",
    ].join(CRLF);
  }
  return [...entetes, "Content-Type: text/plain; charset=utf-8", "", texte, ""].join(CRLF);
}

function calendrier({ uid, debut, fin, objet, organisateur, participant }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cabinet fictif//j11-journee//FR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "SEQUENCE:0",
    "DTSTAMP:20261001T080000Z",
    `DTSTART;TZID=Europe/Paris:${debut}`,
    `DTEND;TZID=Europe/Paris:${fin}`,
    `SUMMARY:${objet}`,
    `ORGANIZER;CN=Organisateur Fictif:mailto:${organisateur}`,
    `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${participant}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join(CRLF);
}

/** Partie HTML d'un message lu en IMAP (la signature n'y figure qu'une fois ; le texte brut porte la sienne). */
const htmlDe = (copie) => copie.parties.find((p) => p.type === "text/html")?.texte ?? "";

const PDF = { nom: "Convocation.pdf", type: "application/pdf", base64: "JVBERi0xLjQK" };

// ---------------------------------------------------------------------------------------------
// Décor serveur : boîte nominative sur le Dovecot de test
// ---------------------------------------------------------------------------------------------

const WHERE_COMPTES = `(hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'journee.%@cabinet.example')`;

/** Retire les boîtes nominatives de test (celle de cette recette, celles d'une exécution interrompue) et leurs traces. */
async function retirerComptes() {
  const ids = `SELECT id FROM comptes_mail WHERE ${WHERE_COMPTES}`;
  for (const requete of [
    `DELETE FROM signatures_messagerie WHERE compte_id IN (${ids})`,
    `DELETE FROM brouillons_message WHERE compte_id IN (${ids})`,
    `DELETE FROM invitations_agenda WHERE compte_id IN (${ids})`,
    `DELETE FROM messages WHERE compte_id IN (${ids})`,
    `DELETE FROM comptes_mail WHERE ${WHERE_COMPTES}`,
  ]) {
    await sqlServeur(requete);
  }
}

async function demarrerImapTest() {
  if (conteneur("legalos-imap-test-dovecot").length === 0) {
    console.log("j11-journee: démarrage de instance/imap-test (Dovecot)");
    const run = spawnSync("docker", ["compose", "-f", "instance/imap-test/docker-compose.yml", "up", "-d", "--wait"], {
      cwd: racineInstance(),
      stdio: "inherit",
    });
    if (run.status !== 0) fail(`docker compose (imap-test) exit ${String(run.status)}`);
  }
  const dovecot = conteneur("legalos-imap-test-dovecot")[0];
  if (!dovecot) fail("Dovecot d'imap-test absent");
  connecterAuReseauApi(dovecot);
  const debut = Date.now();
  for (;;) {
    try {
      capa.purger("INBOX");
      return dovecot;
    } catch (err) {
      if (Date.now() - debut > 60_000) fail(`Dovecot d'imap-test injoignable : ${String(err.message).slice(0, 160)}`);
      await sleep(1000);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Scénario
// ---------------------------------------------------------------------------------------------

async function main() {
  await session.assurerInstance();
  cabinet = creerClientImap({
    hote: process.env.LEGALOS_IMAP_HOST ?? "127.0.0.1",
    port: process.env.LEGALOS_IMAP_PORT ?? "13143",
    login: "demo",
    secret: motDePasseCabinet(),
  });
  const dovecot = await demarrerImapTest();
  const jeton = await demoAccessToken(api, `j11-journee-${marque}`);
  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(demoEmail)}`);
  if (!demoId) fail("utilisateur démo absent");
  const cabinetId = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${demoId}'`);

  // ----- Décor (hors app) : repartir propre, dossier, vieux mails, boîte nominative -----
  console.log("j11-journee: décor : nettoyage des boîtes de test, dossier, deux vieux mails, boîte nominative");
  await retirerComptes();
  capa.purger("INBOX");

  const nomDossier = `Journée Alpha ${marque}`;
  const dossierId = randomUUID();
  await json("/dossiers", jeton, "POST", {
    id: dossierId,
    idempotence_cle: `jso-${dossierId}`,
    nom: nomDossier,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-JSO-${marque}`,
    restreint: false,
  });

  const idAncienClasse = `<jso-ancien-classe-${marque}@ancien.example>`;
  const idAncienLibre = `<jso-ancien-libre-${marque}@ancien.example>`;
  const jetonRecherche = `archive${marque}`;
  const corpsAncienClasse = `corpsancien${marque}`;
  const objetAncienClasse = `Protocole ${jetonRecherche} classe`;
  const objetAncienLibre = `Courrier ${jetonRecherche} libre`;
  capa.ajouter(
    "INBOX",
    courrier({
      de: `Me Ancien ${marque} <ancien.${marque}@example.com>`,
      a: adressePerso,
      objet: objetAncienClasse,
      id: idAncienClasse,
      date: "Thu, 12 Feb 2026 09:30:00 +0100",
      texte: `Protocole d'accord de février. ${corpsAncienClasse}`,
    }),
  );
  capa.ajouter(
    "INBOX",
    courrier({
      de: `Me Ancien ${marque} <ancien.${marque}@example.com>`,
      a: adressePerso,
      objet: objetAncienLibre,
      id: idAncienLibre,
      date: "Fri, 20 Mar 2026 15:00:00 +0100",
      texte: `Courrier de mars, jamais classé. corpslibre${marque}`,
    }),
  );

  const comptePersoId = randomUUID();
  await json("/messagerie/comptes", jeton, "POST", {
    id: comptePersoId,
    adresse: adressePerso,
    hote: dovecot,
    port: 143,
    utilisateur: "capa",
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
  });
  const compteCabinetId = await sqlServeur(`SELECT id FROM comptes_mail WHERE type_compte = 'classement' LIMIT 1`);
  verifier("boîte du cabinet connue du serveur", /^[0-9a-f-]{36}$/u.test(compteCabinetId));
  for (const id of [idAncienClasse, idAncienLibre]) {
    await attendre(
      "vieux mail relevé par le moteur",
      () => sqlServeur(`SELECT COUNT(*) FROM messages WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(id)}`),
      (n) => n === "1",
      120_000,
    );
  }
  // Le poste montre la date d'arrivée dans la base (l'en-tête Date n'est pas conservé) : on fait vieillir ces deux
  // lignes à la date de leur en-tête, comme si elles étaient arrivées ce jour-là.
  await sqlServeur(`UPDATE messages SET cree_le = '2026-02-12 08:30:00+00', revision = revision + 1 WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienClasse)}`);
  await sqlServeur(`UPDATE messages SET cree_le = '2026-03-20 14:00:00+00', revision = revision + 1 WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienLibre)}`);
  const idServeurAncienClasse = await sqlServeur(`SELECT id FROM messages WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienClasse)}`);
  const idServeurAncienLibre = await sqlServeur(`SELECT id FROM messages WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienLibre)}`);

  // ----- App Tauri : poste A -----
  resetPostes(["jsoa", "jsob"]);
  let posteA = null;
  let posteB = null;
  let sendA = null;
  try {
    posteA = await ouvrirPoste("jsoa", 9361, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Journée A ${marque}`,
    });
    send = posteA.page.send;
    sendA = send;
    await attendre(
      "synchronisation des boîtes et des vieux mails",
      () =>
        sqliteLocal(
          `SELECT (SELECT COUNT(*) FROM comptes_mail WHERE adresse = ${lit(adressePerso)}) AS comptes,
                  (SELECT COUNT(*) FROM messages WHERE message_id IN (${lit(idAncienClasse)}, ${lit(idAncienLibre)})) AS mails`,
        ),
      (r) => Number(r?.[0]?.comptes) === 1 && Number(r?.[0]?.mails) === 2,
      180_000,
    );

    const ouvrirMails = async () => {
      await cliquer("[data-testid=nav-mails]");
      await attendre("écran Mails", () => present("[data-testid=mails-trois-volets]"), Boolean);
    };
    const ouvrirReglages = async () => {
      await cliquer("[data-testid=menu-compte]");
      await cliquer("[data-testid=menu-reglages]");
      await attendre("rubrique Messagerie des réglages", () => present("[data-testid=reglages-messagerie]"), Boolean, 30_000);
    };
    const ligneDe = (id) => `[data-testid=mail-ligne][data-id="${id}"]`;
    const idLocal = (messageId) =>
      attendre(
        `message ${messageId} synchronisé sur le poste`,
        () => sqliteLocal(`SELECT id FROM messages WHERE message_id = ${lit(messageId)}`),
        (r) => Array.isArray(r) && r.length === 1,
        180_000,
      ).then((r) => String(r[0].id));
    const adressesChamp = (champ) =>
      js(`[...document.querySelectorAll("[data-testid=puce-${champ}]")].map((p) => p.getAttribute("data-adresse"))`);
    const lignesListe = () => js(`[...document.querySelectorAll("[data-testid=mail-ligne]")].map((l) => l.innerText)`);
    const nouveauMail = () =>
      js(`[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Nouveau mail"))?.click()`);
    const blocSig = (compteId) => `[data-testid=signature-compte][data-compte-id="${compteId}"]`;
    const signatureServeur = (compteId) =>
      sqlServeur(`SELECT COALESCE((SELECT html FROM signatures_messagerie WHERE compte_id = '${compteId}' AND utilisateur_id = '${demoId}'), '')`);
    const fileEnvoi = (id) => `[data-testid=file-envoi-ligne][data-id="${id}"]`;
    const citation = () =>
      js(`(() => { const q = document.querySelector("[data-testid=redac-corps] > blockquote:last-child"); return q ? { affiche: getComputedStyle(q).display !== "none", texte: q.innerText } : null; })()`);
    const pieces = () =>
      js(`[...document.querySelectorAll("[data-testid=redac-piece]")].map((p) => ({ nom: p.getAttribute("data-nom"), etat: p.getAttribute("data-etat") }))`);

    /** Envoie la rédaction ouverte et rend le message reçu par la boîte de contrôle (copie dans Envoyés confirmée). */
    async function envoyerEtLire(idBrouillonEnvoye, messageIdEnvoye) {
      await cliquer("[data-testid=redac-envoyer]");
      await attendre("rédaction fermée après l'envoi", () => present(FORM), (v) => v === false, 60_000);
      await attendre("ligne de la file d'envoi", () => present(fileEnvoi(idBrouillonEnvoye)), Boolean, 30_000);
      await attendre(
        "copie dans Envoyés confirmée",
        () => js(`document.querySelector(${JSON.stringify(fileEnvoi(idBrouillonEnvoye))})?.getAttribute("data-etat") ?? null`),
        (e) => e === "copie_envoyes_confirmee",
        120_000,
      );
      verifier("libellé de la file", /Copie dans « Envoyés » confirmée/u.test(norm(await texteDe(fileEnvoi(idBrouillonEnvoye)))));
      const recus = await attendre("message reçu par la boîte de contrôle", async () => recusCabinet("Message-ID", messageIdEnvoye), (c) => c.length === 1, 90_000);
      await attendre("brouillon retiré du serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${idBrouillonEnvoye}'`), (v) => v === "0", 30_000);
      await attendre("brouillon retiré du poste", () => sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${idBrouillonEnvoye}'`), (r) => Number(r?.[0]?.n) === 0, 30_000);
      return recus[0];
    }

    // ===== 1. Réglages : une signature par boîte =====
    const sigCabinet = `Signature Cabinet ${marque}`;
    const sigCabinetLigne2 = `Avocat fictif ${marque}`;
    const sigPerso = `Signature Perso ${marque}`;
    await ouvrirReglages();
    for (const compteId of [compteCabinetId, comptePersoId]) {
      await attendre(`signature du compte ${compteId} chargée`, () => present(`${blocSig(compteId)} [data-testid=reglages-signature-corps]`), Boolean, 30_000);
    }
    verifier("la boîte nominative est nommée avec son adresse", (await texteDe(blocSig(comptePersoId))).includes(adressePerso));
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
    await remplacerSignature(compteCabinetId, [sigCabinet, sigCabinetLigne2], true);
    await remplacerSignature(comptePersoId, [sigPerso], false);
    await attendre("« Enregistrer la signature » actif après modification", () => desactive(`${blocSig(comptePersoId)} [data-testid=signature-enregistrer]`), (d) => d === false, 10_000);
    await sleep(1500);
    essaiNegatif("la signature est enregistrée sans clic sur « Enregistrer »", (await signatureServeur(comptePersoId)).includes(sigPerso));
    await cliquer(`${blocSig(compteCabinetId)} [data-testid=signature-enregistrer]`);
    await attendre("signature du cabinet enregistrée", () => present(`${blocSig(compteCabinetId)} [data-testid=signature-enregistree]`), Boolean, 20_000);
    await cliquer(`${blocSig(comptePersoId)} [data-testid=signature-enregistrer]`);
    await attendre("signature perso enregistrée", () => present(`${blocSig(comptePersoId)} [data-testid=signature-enregistree]`), Boolean, 20_000);
    const htmlSigPerso = await signatureServeur(comptePersoId);
    const htmlSigCabinet = await signatureServeur(compteCabinetId);
    verifier("signature perso au serveur, distincte de celle du cabinet", htmlSigPerso.includes(sigPerso) && !htmlSigPerso.includes(sigCabinet), htmlSigPerso);
    verifier("signature du cabinet au serveur, avec sa mise en forme", htmlSigCabinet.includes(`<strong>${sigCabinet}</strong>`) && htmlSigCabinet.includes(sigCabinetLigne2), htmlSigCabinet);
    ok("réglages : une signature par boîte, enregistrée seulement au clic");

    // ===== 2. Recevoir : deux mails déposés pendant que l'app est ouverte =====
    await ouvrirMails();
    await cliquer("[data-testid=vue-a-classer]");
    const objetM1 = `Convocation ${marque}`;
    const objetM2 = `Information ${marque}`;
    const idM1 = `<jso-m1-${marque}@tiers.example>`;
    const idM2 = `<jso-m2-${marque}@tiers.example>`;
    const nomExpediteur = `Me Tiers ${marque}`;
    const messagesAvant = await lignesListe();
    verifier("avant le dépôt, aucun des deux mails n'est dans la liste", !messagesAvant.some((t) => t.includes(objetM1) || t.includes(objetM2)));
    capa.ajouter(
      "INBOX",
      courrier({
        de: `${nomExpediteur} <${correspondant}>`,
        a: adressePerso,
        objet: objetM1,
        id: idM1,
        texte: `Bonjour, merci de confirmer le creneau ${marque}.${CRLF}${CRLF}Bien cordialement.`,
        piece: PDF,
      }),
    );
    capa.ajouter(
      "INBOX",
      courrier({
        de: `Me Autre ${marque} <autre.${marque}@example.com>`,
        a: adressePerso,
        objet: objetM2,
        id: idM2,
        texte: `Pour information, rien a repondre ${marque}.`,
      }),
    );
    const m1 = await idLocal(idM1);
    const m2 = await idLocal(idM2);
    await attendre("les deux mails dans « À classer »", () => js(`[${JSON.stringify(ligneDe(m1))}, ${JSON.stringify(ligneDe(m2))}].every((s) => Boolean(document.querySelector(s)))`), Boolean, 30_000);
    const texteM1 = norm(await texteDe(ligneDe(m1)));
    // Le moteur ne garde que l'adresse de l'expéditeur (imap.rs) : la ligne la montre, sans le nom d'affichage.
    verifier("la ligne porte l'expéditeur (adresse) et l'objet", texteM1.includes(correspondant) && texteM1.includes(objetM1), texteM1);
    verifier("le mail reçu est non lu", (await js(`document.querySelector(${JSON.stringify(ligneDe(m1))}).getAttribute("data-lu")`)) === "false");
    verifier("il est à classer", ["a_classer", "suggestion"].includes(await js(`document.querySelector(${JSON.stringify(ligneDe(m1))}).getAttribute("data-etat")`)));
    essaiNegatif("un mail jamais déposé figure dans la liste", (await lignesListe()).some((t) => t.includes(`Absent ${marque}`)));
    await capturer("journee-recu-jour.png", "light");
    await capturer("journee-recu-nuit.png", "dark");
    ok("recevoir : deux mails déposés pendant que l'app est ouverte arrivent dans « À classer », non lus");

    // ===== 3. Lire =====
    await cliquer(ligneDe(m1));
    await attendre("lecture du premier mail", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetM1));
    await attendre("corps du premier mail", () => texteDe("[data-testid=lecture-corps]"), (t) => t.includes(`creneau ${marque}`), 60_000);
    verifier("expéditeur lu", (await texteDe("[data-testid=lecture-expediteur]")).includes(correspondant) || (await texteDe("[data-testid=lecture-adresse]")).includes(correspondant));
    verifier("pièce jointe listée", (await texteDe("[data-testid=lecture-pieces]")).includes("Convocation.pdf"));
    verifier("reçu aujourd'hui", norm(await texteDe("[data-testid=lecture-date]")).includes("Aujourd'hui"));
    await cliquer(ligneDe(m2));
    await attendre("lecture du second mail", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetM2));
    await attendre("corps du second mail", () => texteDe("[data-testid=lecture-corps]"), (t) => t.includes(`rien a repondre ${marque}`), 60_000);
    essaiNegatif("le second mail montre le texte du premier", (await texteDe("[data-testid=lecture-corps]")).includes(`creneau ${marque}`));
    essaiNegatif("le second mail montre une pièce jointe", await present("[data-testid=lecture-piece]"));
    essaiNegatif("une carte d'invitation sur un mail ordinaire", await present("[data-testid=carte-invitation]"));
    ok("lire : corps, expéditeur, pièce jointe et date du premier mail ; le second mail n'en hérite pas");

    // ===== 4. Classer =====
    const etatServeur = (id) => sqlServeur(`SELECT etat_classement || '|' || COALESCE(dossier_id::text, '') FROM messages WHERE id = '${id}'`);
    verifier("avant le classement, le premier mail est à classer au serveur", (await etatServeur(m1)).startsWith("a_classer") || (await etatServeur(m1)).startsWith("suggestion"));
    await cliquer(ligneDe(m1));
    await attendre("encart de classement", () => js(`Boolean(document.querySelector("[data-testid=bouton-autre-dossier]") || document.querySelector("[data-testid=classer-dossier]"))`), Boolean, 20_000);
    if (await present("[data-testid=bouton-autre-dossier]")) await cliquer("[data-testid=bouton-autre-dossier]");
    await attendre("dossier de la recette proposé", () => js(`[...document.querySelectorAll("[data-testid=classer-dossier] option")].some((o) => o.value === ${JSON.stringify(dossierId)})`), Boolean, 30_000);
    verifier("dossier choisi", await choisirOption("[data-testid=classer-dossier]", dossierId));
    await cliquer("[data-testid=bouton-classer]");
    await attendre("mail classé à l'écran", () => present("[data-testid=encart-classe]"), Boolean, 20_000);
    verifier("l'encart nomme le dossier", (await texteDe("[data-testid=encart-classe-titre]")).includes(nomDossier));
    await attendre("classement enregistré au serveur", () => etatServeur(m1), (v) => v === `classe|${dossierId}`, 30_000);
    await attendre("le premier mail a quitté « À classer »", () => present(ligneDe(m1)), (v) => v === false, 15_000);
    verifier("le second mail reste dans « À classer »", await present(ligneDe(m2)));
    essaiNegatif("le second mail est classé", (await etatServeur(m2)).startsWith("classe"));
    ok("classer : le mail est rangé dans son dossier (serveur), sorti de « À classer » ; l'autre reste à classer");

    // ===== 5. Répondre avec l'historique cité =====
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("le premier mail dans la réception", () => present(ligneDe(m1)), Boolean, 20_000);
    await cliquer(ligneDe(m1));
    await attendre("lecture avant de répondre", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetM1));
    await cliquer("[data-testid=lecture-repondre]");
    await attendre("rédaction de la réponse", () => present(FORM), Boolean);
    verifier("titre « Répondre »", (await texteDe("[data-testid=redac-titre]")) === "Répondre");
    verifier("À : l'expéditeur", JSON.stringify(await adressesChamp("a")) === JSON.stringify([correspondant]), JSON.stringify(await adressesChamp("a")));
    verifier("objet « Re : »", (await valeurDe("[data-testid=redac-objet]")) === `Re : ${objetM1}`);
    const corpsReponse = await attendre("signature de la boîte nominative insérée", () => htmlCorps(), (h) => h.includes(sigPerso), 20_000);
    verifier("signature : ligne « -- », signature, puis historique cité, dans cet ordre", ordre(corpsReponse, "<p>--</p>", sigPerso, "<blockquote>"), corpsReponse);
    verifier("signature : une seule fois", occurrences(corpsReponse, sigPerso) === 1);
    essaiNegatif("la signature du cabinet est dans la réponse d'une boîte nominative", corpsReponse.includes(sigCabinet));
    const q0 = await citation();
    verifier("historique cité présent et masqué au départ", q0 !== null && q0.affiche === false);
    await cliquer("[data-testid=redac-histo]");
    const q1 = await citation();
    verifier("historique affiché sur demande", q1?.affiche === true);
    verifier("la citation porte la mention d'origine et le texte reçu", /a écrit\s?:/u.test(q1.texte) && q1.texte.includes(`creneau ${marque}`), q1.texte);
    essaiNegatif("l'historique reste masqué après « Afficher »", q1.affiche === false);
    await cliquer("[data-testid=redac-histo]");
    const idReponse = await idBrouillon();
    verifier("identifiant du brouillon de la réponse", /^[0-9a-f-]{36}$/u.test(String(idReponse)));
    const texteReponse = `Bien recu ${marque}, je confirme le creneau.`;
    await focusCorps();
    await taper(texteReponse);
    await capturer("journee-reponse-jour.png", "light");
    await capturer("journee-reponse-nuit.png", "dark");
    await attendre("réponse enregistrée au serveur", () => sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${idReponse}'`), (v) => v.includes(texteReponse), 40_000);
    const messageIdReponse = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idReponse}'`);
    const recueReponse = await envoyerEtLire(idReponse, messageIdReponse);
    const brutReponse = recueReponse.brut;
    verifier("In-Reply-To : le message d'origine", valeurEnTete(brutReponse, "In-Reply-To") === idM1, valeurEnTete(brutReponse, "In-Reply-To"));
    verifier("References : le message d'origine", valeurEnTete(brutReponse, "References").includes(idM1));
    verifier("objet « Re : »", valeurEnTete(brutReponse, "Subject") === `Re : ${objetM1}`, valeurEnTete(brutReponse, "Subject"));
    verifier("destinataire : l'expéditeur du mail d'origine", valeurEnTete(brutReponse, "To").includes(correspondant));
    const corpsRecuReponse = corpsDe(recueReponse);
    verifier("le texte écrit est dans le message reçu", corpsRecuReponse.includes(texteReponse));
    verifier("l'historique cité est dans le message reçu", /<blockquote/iu.test(corpsRecuReponse) && /a écrit/u.test(corpsRecuReponse) && corpsRecuReponse.includes(`creneau ${marque}`));
    verifier("signature de la boîte une seule fois (partie HTML), avant l'historique", occurrences(htmlDe(recueReponse), sigPerso) === 1 && ordre(htmlDe(recueReponse), texteReponse, sigPerso, "<blockquote"), htmlDe(recueReponse).slice(0, 500));
    essaiNegatif("la réponse emporte la pièce jointe d'origine", piecesDe(recueReponse).includes("Convocation.pdf"));
    essaiNegatif("la réponse répond au second mail", valeurEnTete(brutReponse, "In-Reply-To") === idM2);
    essaiNegatif("la copie cachée apparaît dans les en-têtes reçus", /^Bcc:/im.test(brutReponse.split(/\r?\n\r?\n/)[0]));
    essaiNegatif("la signature du cabinet est dans la réponse reçue", corpsRecuReponse.includes(sigCabinet));
    ok("répondre : fil (In-Reply-To, References), historique cité, signature de la boîte, texte reçu ; ni pièce ni copie cachée");

    // ===== 6. Transférer avec la pièce jointe d'origine =====
    await attendre("retour à la réception", () => present(ligneDe(m1)), Boolean, 20_000);
    await cliquer(ligneDe(m1));
    await attendre("lecture avant de transférer", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetM1));
    await cliquer("[data-testid=lecture-transferer]");
    await attendre("rédaction du transfert", () => present(FORM), Boolean);
    verifier("titre « Transférer »", (await texteDe("[data-testid=redac-titre]")) === "Transférer");
    verifier("objet « Tr : »", (await valeurDe("[data-testid=redac-objet]")) === `Tr : ${objetM1}`);
    verifier("aucun destinataire au départ", (await compter("[data-testid=puce-a]")) === 0);
    const q2 = await citation();
    verifier("historique du transfert affiché, avec l'en-tête du message transféré", q2?.affiche === true && q2.texte.includes("Message transféré") && q2.texte.includes(`Objet : ${objetM1}`) && q2.texte.includes(`creneau ${marque}`), q2?.texte);
    const corpsTransfert = await attendre("signature insérée dans le transfert", () => htmlCorps(), (h) => h.includes(sigPerso), 20_000);
    verifier("la signature précède le message transféré", ordre(corpsTransfert, "<p>--</p>", sigPerso, "Message transféré") && occurrences(corpsTransfert, sigPerso) === 1, corpsTransfert.slice(0, 400));
    const idTransfert = await idBrouillon();
    await attendre("pièce d'origine à l'écran", () => pieces(), (p) => p.some((x) => x.nom === "Convocation.pdf"), 15_000);
    await js(`document.querySelector("[data-testid=saisie-a]").focus()`);
    await saisir("[data-testid=saisie-a]", `${correspondant};`);
    await attendre("destinataire du transfert", () => adressesChamp("a"), (a) => a.includes(correspondant));
    await focusCorps();
    await taper(`Pour information ${marque}. `);
    await attendre("pièce d'origine confirmée à l'écran", () => pieces(), (p) => p.length === 1 && p[0].etat === "jointe", 60_000);
    await attendre("pièce d'origine au serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${idTransfert}'`), (n) => n === "1", 60_000);
    verifier("un transfert n'ouvre aucun fil", (await sqlServeur(`SELECT COALESCE(en_reponse_a, '') FROM brouillons_message WHERE id = '${idTransfert}'`)) === "");
    const messageIdTransfert = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idTransfert}'`);
    const recuTransfert = await envoyerEtLire(idTransfert, messageIdTransfert);
    verifier("objet « Tr : »", valeurEnTete(recuTransfert.brut, "Subject") === `Tr : ${objetM1}`, valeurEnTete(recuTransfert.brut, "Subject"));
    verifier("pièce du message d'origine conservée", piecesDe(recuTransfert).includes("Convocation.pdf"), JSON.stringify(piecesDe(recuTransfert)));
    verifier("historique du message transféré dans le message reçu", corpsDe(recuTransfert).includes("Message transféré") && corpsDe(recuTransfert).includes(`creneau ${marque}`));
    verifier("le texte ajouté est dans le message reçu", corpsDe(recuTransfert).includes(`Pour information ${marque}`));
    essaiNegatif("un transfert pose In-Reply-To", valeurEnTete(recuTransfert.brut, "In-Reply-To") !== "");
    ok("transférer : pièce jointe d'origine conservée et reçue, historique du message transféré, aucun fil");

    // ===== 7. Mail neuf avec pièce jointe et signature =====
    await nouveauMail();
    await attendre("nouveau mail", () => present(FORM), Boolean, 15_000);
    verifier("titre « Nouveau mail »", (await texteDe("[data-testid=redac-titre]")) === "Nouveau mail");
    verifier("aucun historique pour un message neuf", (await present("[data-testid=redac-histo]")) === false);
    const corpsNeuf = await attendre("signature du cabinet insérée", () => htmlCorps(), (h) => h.includes(sigCabinet), 20_000);
    verifier("un paragraphe pour écrire, puis la signature du cabinet, une fois", corpsNeuf.startsWith("<p><br") && ordre(corpsNeuf, "<br", "<p>--</p>", sigCabinet) && occurrences(corpsNeuf, sigCabinet) === 1, corpsNeuf);
    essaiNegatif("la signature de la boîte nominative est dans le message neuf", corpsNeuf.includes(sigPerso));
    const idNeuf = await idBrouillon();
    const objetNeuf = `Mail neuf ${marque}`;
    const texteNeuf = `Bonjour, ci-joint la note ${marque}.`;
    await saisir("[data-testid=redac-objet]", objetNeuf);
    await focusCorps();
    await taper(texteNeuf);
    // Envoi refusé sans destinataire.
    const fileAvant = await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE cabinet_id = '${cabinetId}'`);
    await cliquer("[data-testid=redac-envoyer]");
    await attendre("refus d'envoi sans destinataire", () => texteDe("[data-testid=redac-erreur]"), (t) => t.includes("Ajoutez au moins un destinataire"), 15_000);
    await sleep(1500);
    essaiNegatif("un message sans destinataire est parti", (await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE cabinet_id = '${cabinetId}'`)) !== fileAvant);
    await js(`document.querySelector("[data-testid=saisie-a]").focus()`);
    await saisir("[data-testid=saisie-a]", `${correspondant};`);
    await attendre("destinataire du mail neuf", () => adressesChamp("a"), (a) => a.includes(correspondant));
    // Pièce jointe par glisser-déposer.
    const nomPieceNeuf = `note-${marque}.txt`;
    await deposer([{ nom: nomPieceNeuf, texte: `Pièce fictive ${marque}`, type: "text/plain" }]);
    await attendre("pièce jointe confirmée", () => pieces(), (p) => p.some((x) => x.nom === nomPieceNeuf && x.etat === "jointe"), 60_000);
    await attendre("pièce au serveur", () => sqlServeur(`SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${idNeuf}'`), (n) => n === "1", 30_000);
    const messageIdNeuf = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idNeuf}'`);
    const recuNeuf = await envoyerEtLire(idNeuf, messageIdNeuf);
    verifier("objet du mail neuf", valeurEnTete(recuNeuf.brut, "Subject") === objetNeuf, valeurEnTete(recuNeuf.brut, "Subject"));
    verifier("pièce jointe déposée dans le message reçu", piecesDe(recuNeuf).includes(nomPieceNeuf), JSON.stringify(piecesDe(recuNeuf)));
    const corpsRecuNeuf = corpsDe(recuNeuf);
    verifier("texte et signature du cabinet, une fois, dans cet ordre", corpsRecuNeuf.includes(texteNeuf) && occurrences(htmlDe(recuNeuf), sigCabinet) === 1 && ordre(htmlDe(recuNeuf), texteNeuf, sigCabinet), htmlDe(recuNeuf).slice(0, 300));
    essaiNegatif("un mail neuf pose In-Reply-To", valeurEnTete(recuNeuf.brut, "In-Reply-To") !== "");
    essaiNegatif("la signature de la boîte nominative est dans le mail neuf reçu", corpsRecuNeuf.includes(sigPerso));
    essaiNegatif("le mail neuf emporte la pièce du transfert", piecesDe(recuNeuf).includes("Convocation.pdf"));
    ok("mail neuf : pièce jointe par glisser-déposer, signature du cabinet, envoi refusé sans destinataire, reçu avec pièce et signature");

    // ===== 8. Reprendre un brouillon sur un second poste =====
    await nouveauMail();
    await attendre("nouveau mail (brouillon)", () => present(FORM), Boolean, 15_000);
    const idBrouillonRepris = await idBrouillon();
    await attendre("signature du cabinet (brouillon)", () => htmlCorps(), (h) => h.includes(sigCabinet), 20_000);
    const objetBrouillon = `Brouillon repris ${marque}`;
    const texteBrouillon = `Texte commencé sur le poste A ${marque}`;
    const nomPieceBrouillon = `annexe-${marque}.txt`;
    await saisir("[data-testid=redac-objet]", objetBrouillon);
    await js(`document.querySelector("[data-testid=saisie-a]").focus()`);
    await saisir("[data-testid=saisie-a]", `${correspondant};`);
    await attendre("destinataire du brouillon", () => adressesChamp("a"), (a) => a.includes(correspondant));
    await focusCorps();
    await taper(texteBrouillon);
    await deposer([{ nom: nomPieceBrouillon, texte: `Annexe fictive ${marque}`, type: "text/plain" }]);
    await attendre("annexe jointe", () => pieces(), (p) => p.some((x) => x.nom === nomPieceBrouillon && x.etat === "jointe"), 60_000);
    await attendre("brouillon au serveur", () => sqlServeur(`SELECT objet || '|' || (SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${idBrouillonRepris}') FROM brouillons_message WHERE id = '${idBrouillonRepris}'`), (v) => v === `${objetBrouillon}|1`, 60_000);
    const messageIdBrouillon = await sqlServeur(`SELECT message_id FROM brouillons_message WHERE id = '${idBrouillonRepris}'`);
    const copieBrouillon = await attendre("copie dans le dossier Brouillons du serveur IMAP", async () => copiesBrouillon(messageIdBrouillon), (c) => c.length === 1, 40_000);
    verifier("la copie IMAP porte \\Draft", copieBrouillon[0].drapeaux.includes("\\Draft"), JSON.stringify(copieBrouillon[0].drapeaux));
    await attendre("statut « visible sur vos autres appareils »", () => texteDe("[data-testid=redac-statut]"), (t) => /visible sur vos autres appareils/u.test(norm(t)), 30_000);
    // On quitte la rédaction : le brouillon reste.
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("rédaction fermée", () => present(FORM), (v) => v === false, 10_000);
    verifier("le brouillon est toujours au serveur", (await sqlServeur(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${idBrouillonRepris}'`)) === "1");

    resetPostes(["jsob"]);
    posteB = await ouvrirPoste("jsob", 9362, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Journée B ${marque}`,
      mode: "copie",
    });
    send = posteB.page.send;
    const ligneB = await attendre("brouillon synchronisé sur le second poste", () => sqliteLocal(`SELECT objet, corps_html FROM brouillons_message WHERE id = '${idBrouillonRepris}'`), (r) => Array.isArray(r) && r.length === 1, 180_000);
    verifier("second poste : contenu du brouillon", ligneB[0].objet === objetBrouillon && String(ligneB[0].corps_html).includes(texteBrouillon));
    essaiNegatif("le second poste a le mail neuf déjà envoyé", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${idNeuf}'`))?.[0]?.n) > 0);
    await ouvrirMails();
    await attendre("dossier Brouillons (poste B)", () => present("[data-testid=dossier-imap][data-dossier=brouillons]"), Boolean, 60_000);
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=brouillons]");
    const ligneBrouillon = `[data-testid=mail-ligne][data-id="${idBrouillonRepris}"]`;
    await attendre("le brouillon est dans la liste (poste B)", () => present(ligneBrouillon), Boolean, 60_000);
    essaiNegatif("un mail reçu figure dans les Brouillons du second poste", await present(ligneDe(m1)));
    await cliquer(ligneBrouillon);
    await attendre("brouillon rouvert (poste B)", () => present(FORM), Boolean);
    verifier("repris sur le second poste : même identifiant, objet, destinataire, texte",
      (await idBrouillon()) === idBrouillonRepris &&
        (await valeurDe("[data-testid=redac-objet]")) === objetBrouillon &&
        (await adressesChamp("a")).includes(correspondant) &&
        (await htmlCorps()).includes(texteBrouillon),
    );
    await attendre("annexe du brouillon à l'écran (poste B)", () => pieces(), (p) => p.some((x) => x.nom === nomPieceBrouillon), 30_000);
    await sleep(2000);
    verifier("la signature n'est pas insérée une seconde fois", occurrences(await htmlCorps(), sigCabinet) === 1);
    await curseurFinCorps();
    const suiteB = ` Suite écrite sur le poste B ${marque}.`;
    await taper(suiteB);
    await attendre("suite du poste B reçue par le serveur", () => sqlServeur(`SELECT corps_html FROM brouillons_message WHERE id = '${idBrouillonRepris}'`), (v) => v.includes(`Suite écrite sur le poste B ${marque}`), 60_000);
    const recuBrouillon = await envoyerEtLire(idBrouillonRepris, messageIdBrouillon);
    verifier("brouillon envoyé du second poste : objet et annexe", valeurEnTete(recuBrouillon.brut, "Subject") === objetBrouillon && piecesDe(recuBrouillon).includes(nomPieceBrouillon), JSON.stringify(piecesDe(recuBrouillon)));
    verifier("texte du poste A, signature (une fois), puis la suite écrite en fin de message sur le poste B", ordre(htmlDe(recuBrouillon), texteBrouillon, sigCabinet, `Suite écrite sur le poste B ${marque}`) && occurrences(htmlDe(recuBrouillon), sigCabinet) === 1, htmlDe(recuBrouillon).slice(0, 300));
    await attendre("copie IMAP du brouillon retirée", async () => copiesBrouillon(messageIdBrouillon), (c) => c.length === 0, 30_000);
    await posteB.page.ws.close();
    await stopApp(posteB.child);
    posteB = null;
    send = sendA;
    await attendre("le premier poste voit partir le brouillon", () => sqliteLocal(`SELECT COUNT(*) AS n FROM brouillons_message WHERE id = '${idBrouillonRepris}'`), (r) => Number(r?.[0]?.n) === 0, 60_000);
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=brouillons]");
    await attendre("le brouillon a quitté la liste du premier poste", () => present(ligneBrouillon), (v) => v === false, 20_000);
    ok("brouillon : commencé sur le poste A (annexe), repris et envoyé du poste B, copie IMAP retirée, le poste A le voit partir");

    // ===== 9. Accepter une invitation =====
    const uidInvitation = `jso-${marque}@etude.example`;
    const objetReunion = `Reunion ${marque}`;
    const idMessageInvitation = `<jso-invitation-${marque}@etude.example>`;
    await cliquer("[data-testid=vue-a-classer]");
    capa.ajouter(
      "INBOX",
      courrier({
        de: `Me Organisateur ${marque} <${correspondant}>`,
        a: adressePerso,
        objet: `Invitation : ${objetReunion}`,
        id: idMessageInvitation,
        texte: "Invitation fictive à une réunion.",
        ical: calendrier({ uid: uidInvitation, debut: "20261215T100000", fin: "20261215T110000", objet: objetReunion, organisateur: correspondant, participant: adressePerso }),
      }),
    );
    const mInvitation = await idLocal(idMessageInvitation);
    await attendre("invitation synchronisée sur le poste", () => sqliteLocal(`SELECT debut, fuseau, effet FROM invitations_agenda WHERE uid_ical = ${lit(uidInvitation)}`), (r) => Array.isArray(r) && r.length === 1, 120_000);
    await attendre("le message de l'invitation dans la liste", () => present(ligneDe(mInvitation)), Boolean, 30_000);
    await cliquer(ligneDe(mInvitation));
    await attendre("carte d'invitation", () => present("[data-testid=carte-invitation]"), Boolean, 20_000);
    verifier("titre de l'invitation", (await texteDe("[data-testid=invitation-titre]")) === objetReunion);
    verifier("quand : mardi 15 décembre, 10 h à 11 h", /^mardi 15 décembre, 10 h 00 à 11 h 00$/u.test(norm(await texteDe("[data-testid=invitation-quand]"))), await texteDe("[data-testid=invitation-quand]"));
    verifier("trois réponses proposées", JSON.stringify(await js(`[...document.querySelectorAll("[data-testid=invitation-repondre]")].map((b) => b.getAttribute("data-reponse"))`)) === JSON.stringify(["accepter", "peut_etre", "refuser"]));
    const ligneLocaleInvitation = (await sqliteLocal(`SELECT debut, fuseau, effet FROM invitations_agenda WHERE uid_ical = ${lit(uidInvitation)}`))[0];
    verifier("invitation dans la base du titulaire : heure civile, fuseau, effet", ligneLocaleInvitation.debut === "2026-12-15T10:00:00" && ligneLocaleInvitation.fuseau === "Europe/Paris" && ligneLocaleInvitation.effet === "demande", JSON.stringify(ligneLocaleInvitation));
    const repliesAvant = recusCabinet("In-Reply-To", idMessageInvitation);
    verifier("aucune réponse avant le clic", repliesAvant.length === 0);
    essaiNegatif("une confirmation avant tout clic", await present("[data-testid=invitation-confirmee]"));
    await capturer("journee-invitation-jour.png", "light");
    await capturer("journee-invitation-nuit.png", "dark");
    await cliquer("[data-testid=invitation-repondre][data-reponse=accepter]");
    await attendre("confirmation de la réponse", () => texteDe("[data-testid=invitation-confirmee]"), (t) => norm(t).includes("Réponse envoyée à l'organisateur"), 90_000);
    verifier("le bouton « Accepter » est marqué", (await js(`document.querySelector("[data-testid=invitation-repondre][data-reponse=accepter]").getAttribute("aria-pressed")`)) === "true");
    essaiNegatif("un message d'erreur accompagne la confirmation", await present("[data-testid=invitation-erreur]"));
    const repliesApres = await attendre("réponse reçue par l'organisateur", async () => recusCabinet("In-Reply-To", idMessageInvitation), (c) => c.length >= 1, 90_000);
    await sleep(1500);
    verifier("une seule réponse reçue", recusCabinet("In-Reply-To", idMessageInvitation).length === 1);
    const partieCal = repliesApres[0].parties.find((p) => p.type === "text/calendar");
    verifier("réponse iTIP : METHOD:REPLY, même UID, PARTSTAT=ACCEPTED, participant = la boîte nominative",
      Boolean(partieCal) && /METHOD:REPLY/.test(partieCal.texte) && partieCal.texte.includes(`UID:${uidInvitation}`) && /PARTSTAT=ACCEPTED/.test(partieCal.texte) && partieCal.texte.includes(`mailto:${adressePerso}`), partieCal?.texte);
    essaiNegatif("la réponse est un refus", /PARTSTAT=DECLINED/.test(partieCal.texte));
    essaiNegatif("la réponse est un peut-être", /PARTSTAT=TENTATIVE/.test(partieCal.texte));
    verifier("adressée à l'organisateur", valeurEnTete(repliesApres[0].brut, "To").includes(correspondant));
    await attendre("réponse enregistrée sur l'invitation du titulaire", () => sqlServeur(`SELECT COALESCE(reponse, '') FROM invitations_agenda WHERE uid_ical = ${lit(uidInvitation)}`), (v) => v === "accepte", 20_000);
    ok("invitation : carte (titre, date, trois réponses), « Accepter » depuis la carte, PARTSTAT=ACCEPTED reçu une fois par l'organisateur");

    // ===== 10. Retrouver un ancien mail par la recherche =====
    await cliquer("[data-testid=vue-a-classer]");
    const ligneAncienClasse = ligneDe(idServeurAncienClasse);
    const ligneAncienLibre = ligneDe(idServeurAncienLibre);
    await attendre("le vieux mail dans « À classer »", () => present(ligneAncienClasse), Boolean, 30_000);
    await cliquer(ligneAncienClasse);
    await attendre("lecture du vieux mail", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetAncienClasse));
    await attendre("corps du vieux mail", () => texteDe("[data-testid=lecture-corps]"), (t) => t.includes(corpsAncienClasse), 60_000);
    verifier("date du vieux mail : février, pas aujourd'hui", /février/u.test(await texteDe("[data-testid=lecture-date]")) && !norm(await texteDe("[data-testid=lecture-date]")).includes("Aujourd'hui"), await texteDe("[data-testid=lecture-date]"));
    if (await present("[data-testid=bouton-autre-dossier]")) await cliquer("[data-testid=bouton-autre-dossier]");
    await attendre("dossier proposé (vieux mail)", () => js(`[...document.querySelectorAll("[data-testid=classer-dossier] option")].some((o) => o.value === ${JSON.stringify(dossierId)})`), Boolean, 30_000);
    verifier("dossier choisi (vieux mail)", await choisirOption("[data-testid=classer-dossier]", dossierId));
    await cliquer("[data-testid=bouton-classer]");
    await attendre("vieux mail classé", () => etatServeur(idServeurAncienClasse), (v) => v === `classe|${dossierId}`, 30_000);
    await attendre("texte du vieux mail indexé sur le poste", () => sqliteLocal(`SELECT length(texte_brut) AS n FROM messages WHERE id = '${idServeurAncienClasse}'`), (r) => Number(r?.[0]?.n) > 0, 60_000);
    essaiNegatif("l'autre vieux mail est classé", (await etatServeur(idServeurAncienLibre)).startsWith("classe"));

    const hits = () => js(`[...document.querySelectorAll("[data-testid=recherche-mail-hit]")].map((n) => n.getAttribute("data-id"))`);
    await setField(send, "recherche-mails", jetonRecherche);
    const trouves = await attendre("résultats de la recherche", hits, (h) => h.length >= 2, 60_000);
    verifier("la recherche remplace la liste par ses résultats", (await texteDe("[data-testid=liste-titre]")) === "Résultats");
    verifier("les deux vieux mails sont trouvés, classé et hors dossier, et eux seuls", trouves.length === 2 && trouves.includes(idServeurAncienClasse) && trouves.includes(idServeurAncienLibre), JSON.stringify(trouves));
    essaiNegatif("un mail récent figure dans les résultats", trouves.includes(m1) || trouves.includes(m2));
    // Ouvrir le résultat classé.
    await cliquer(ligneAncienClasse);
    await attendre("vieux mail classé ouvert depuis la recherche", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetAncienClasse));
    await attendre("encart du dossier", () => present("[data-testid=encart-classe]"), Boolean, 20_000);
    verifier("il est rangé dans le dossier de la recette", (await texteDe("[data-testid=encart-classe-titre]")).includes(nomDossier));
    verifier("il porte sa date de février", /février/u.test(await texteDe("[data-testid=lecture-date]")));
    // Ouvrir le résultat hors dossier.
    await cliquer(ligneAncienLibre);
    await attendre("vieux mail libre ouvert depuis la recherche", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetAncienLibre));
    await attendre("invitation à classer", () => present("[data-testid=banniere-classer]"), Boolean, 20_000);
    verifier("il n'est rangé nulle part", !(await present("[data-testid=encart-classe]")));
    verifier("il porte sa date de mars", /mars/u.test(await texteDe("[data-testid=lecture-date]")), await texteDe("[data-testid=lecture-date]"));
    await capturer("journee-recherche-jour.png", "light");
    await capturer("journee-recherche-nuit.png", "dark");
    // Le texte d'un mail déjà lu est cherché aussi.
    await setField(send, "recherche-mails", corpsAncienClasse);
    const parTexte = await attendre("recherche par le texte du vieux mail", hits, (h) => h.length === 1, 60_000);
    verifier("le texte seul retrouve le vieux mail classé", parTexte.length === 1 && parTexte[0] === idServeurAncienClasse, JSON.stringify(parTexte));
    // Essais négatifs : un mot absent ne trouve rien ; un mot de l'autre mail récent ne trouve pas les vieux.
    await setField(send, "recherche-mails", `absent${marque}zz`);
    await attendre("aucun résultat", () => compter("[data-testid=recherche-mail-hit]"), (n) => n === 0, 30_000);
    essaiNegatif("un mot absent trouve un mail", (await compter("[data-testid=recherche-mail-hit]")) > 0);
    verifier("la liste vide le dit", norm(await texteDe("[data-testid=mails-liste]")).includes("Aucun mail ne correspond."));
    await setField(send, "recherche-mails", `creneau`);
    const parMotRecent = await attendre("recherche d'un mot du mail récent", hits, (h) => h.includes(m1), 60_000);
    essaiNegatif("les vieux mails répondent à un mot qu'ils ne contiennent pas", parMotRecent.includes(idServeurAncienClasse) || parMotRecent.includes(idServeurAncienLibre));
    await setField(send, "recherche-mails", "");
    ok("recherche : deux vieux mails (février et mars), classé et hors dossier, retrouvés par l'objet puis par le texte ; un mot absent ne trouve rien");

    posteA.page.ws.close();
  } finally {
    if (posteB) await stopApp(posteB.child);
    if (posteA) await stopApp(posteA.child);
    try {
      await retirerComptes();
    } catch (err) {
      console.error(`j11-journee: nettoyage de la boîte nominative impossible : ${String(err.message).slice(0, 200)}`);
    }
    try {
      capa.purger("INBOX");
    } catch {
      // Dovecot déjà arrêté : rien à vider.
    }
  }
  ok("OK");
}

main()
  .catch((err) => {
    console.error(`j11-journee: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
