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
 * Volets ajoutés après le contrôle de J11 (critères (b) et notification de bureau) :
 *   2b. notification de bureau à l'arrivée, OBSERVÉE (crochet `lireNotifications`, comme les rappels d'agenda) : une par
 *       mail, sans objet ni expéditeur, rien au premier chargement, jamais deux fois, rien pour le mail classé d'un autre
 *       collaborateur ; bilan en fin de recette et relance du second poste (curseur gardé, mails arrivés fermé annoncés) ;
 *   9 (suite) la réponse envoyée à une invitation se retrouve à la réouverture du message ;
 *   9b. l'écran Agenda de l'avocat (DOM, pas la base) montre la demande (Paris et New York converti), la réponse, la mise
 *       à jour (nouveau jour, réponse à redonner) et l'annulation (marquée, conservée) ; le collaborateur C, connecté sur
 *       son propre poste, ne voit rien. Le collaborateur C n'agit que par décor serveur (boîte, mail, classement).
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
import { accessToken, demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
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
function courrier({ de, a, objet, id, date = new Date().toUTCString(), texte, piece, ical, methodeIcal = "REQUEST" }) {
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
      `Content-Type: text/calendar; charset=utf-8; method=${methodeIcal}`,
      "",
      ical,
      "--limite-jso--",
      "",
    ].join(CRLF);
  }
  return [...entetes, "Content-Type: text/plain; charset=utf-8", "", texte, ""].join(CRLF);
}

function calendrier({ uid, debut, fin, objet, organisateur, participant, sequence = 0, methode = "REQUEST", tzid = "Europe/Paris" }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cabinet fictif//j11-journee//FR",
    `METHOD:${methode}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    "DTSTAMP:20261001T080000Z",
    `DTSTART;TZID=${tzid}:${debut}`,
    `DTEND;TZID=${tzid}:${fin}`,
    `SUMMARY:${objet}`,
    `ORGANIZER;CN=Organisateur Fictif:mailto:${organisateur}`,
    `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${participant}`,
    ...(methode === "CANCEL" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join(CRLF);
}

/** Partie HTML d'un message lu en IMAP (la signature n'y figure qu'une fois ; le texte brut porte la sienne). */
const htmlDe = (copie) => copie.parties.find((p) => p.type === "text/html")?.texte ?? "";

const PDF = { nom: "Convocation.pdf", type: "application/pdf", base64: "JVBERi0xLjQK" };

// ---------------------------------------------------------------------------------------------
// Jours et heures, calculés ici avec Intl (indépendamment du code du poste) pour les attentes de l'écran Agenda
// ---------------------------------------------------------------------------------------------

function murDans(instant, fuseau) {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const v = (type) => parties.find((p) => p.type === type)?.value ?? "";
  return { jour: `${v("year")}-${v("month")}-${v("day")}`, heure: Number(v("hour")), minute: Number(v("minute")) };
}
/** Jour civil décalé de `n` jours. */
function decalerJour(jour, n) {
  const [a, m, j] = jour.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}
/** Instant dont l'heure murale, dans ce fuseau, est ce jour et cette heure. */
function instantDepuisMur(jour, heure, minute, fuseau) {
  const [a, m, j] = jour.split("-").map(Number);
  let utc = Date.UTC(a, m - 1, j, heure, minute);
  for (let essai = 0; essai < 4; essai += 1) {
    const mur = murDans(new Date(utc), fuseau);
    const [aa, mm, jj] = mur.jour.split("-").map(Number);
    const delta = Date.UTC(a, m - 1, j) - Date.UTC(aa, mm - 1, jj) + (heure * 60 + minute - (mur.heure * 60 + mur.minute)) * 60_000;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}
/** « AAAA-MM-JJ » et heure → « AAAAMMJJTHHMM00 » (DTSTART). */
const dtstart = (jour, heure, minute = 0) => `${jour.replaceAll("-", "")}T${String(heure).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
/** Heure à l'écran, « 16 h 00 » (espace insécable ramenée à une espace par `norm`). */
const heureEcran = ({ heure, minute }) => `${String(heure)} h ${String(minute).padStart(2, "0")}`;

// ---------------------------------------------------------------------------------------------
// Décor serveur : boîte nominative sur le Dovecot de test
// ---------------------------------------------------------------------------------------------

const WHERE_COMPTES = `(hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'journee.%@cabinet.example')`;

/** Retire les boîtes nominatives de test (celle de cette recette, celles d'une exécution interrompue) et leurs traces. */
async function retirerComptes() {
  const ids = `SELECT id FROM comptes_mail WHERE ${WHERE_COMPTES}`;
  for (const requete of [
    `DELETE FROM actions_messages WHERE compte_id IN (${ids})`,
    `DELETE FROM file_envoi WHERE compte_id IN (${ids})`,
    `DELETE FROM releve_curseurs WHERE compte_id IN (${ids})`,
    `DELETE FROM membres_boite_partagee WHERE compte_id IN (${ids})`,
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

  // ----- Un second collaborateur du cabinet (C) : ni sa boîte ni ses invitations ne sont celles de l'avocat -----
  const collab = {
    email: `journee-c-${marque}@cabinet-fictif.example`,
    password: "MotDePasseCollab123!",
    totp: "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI",
  };
  await json("/collaborateurs", jeton, "POST", { email: collab.email, password: collab.password, totp_secret_base32: collab.totp });
  const collabId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(collab.email)}`);
  verifier("le collaborateur C existe et n'est pas l'avocat", /^[0-9a-f-]{36}$/u.test(collabId) && collabId !== demoId);

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
  // Le second vieux mail porte aussi le marquage « arrivée notifiable » : un mail arrivé avant le premier chargement du
  // poste est de l'historique pour lui, et ne doit jamais déclencher de notification (volet « notification de bureau »).
  await sqlServeur(`UPDATE messages SET cree_le = '2026-03-20 14:00:00+00', arrivee_notifiable = TRUE, revision = revision + 1 WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienLibre)}`);
  const idServeurAncienClasse = await sqlServeur(`SELECT id FROM messages WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienClasse)}`);
  const idServeurAncienLibre = await sqlServeur(`SELECT id FROM messages WHERE compte_id = '${comptePersoId}' AND message_id = ${lit(idAncienLibre)}`);

  // ----- App Tauri : poste A -----
  resetPostes(["jsoa", "jsob"]);
  let posteA = null;
  let posteB = null;
  let posteC = null;
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

    // Notifications de bureau : le poste les enregistre en mémoire (crochet de recette `lireNotifications`, comme les rappels
    // d'agenda) faute de pouvoir lire le centre de notifications du système.
    // Le cabinet de démonstration porte des rappels d'agenda échus (laissés par d'autres recettes) : le poste les signale au
    // lancement, par le même canal. On les écarte (leur corps est un type d'élément d'agenda) ; tout le reste compte.
    const notifications = async () =>
      (await js(`window.__legalosRecette.lireNotifications()`)).filter((n) => !["audience", "rendez_vous", "tache"].includes(n.corps));
    /** Nombre de mails annoncés : « Nouveau mail » vaut un, « N nouveaux mails » vaut N. */
    const mailsNotifies = (liste) =>
      liste.reduce((n, notif) => {
        const titre = norm(notif.titre);
        const groupe = /^(\d+) nouveaux mails$/u.exec(titre);
        return n + (titre === "Nouveau mail" ? 1 : groupe ? Number(groupe[1]) : 0);
      }, 0);
    /** État utile au diagnostic d'une annonce manquante : rangs, marquages et curseurs de la base du poste (aucun contenu). */
    const etatArrivees = async () =>
      JSON.stringify({
        mails: await sqliteLocal(`SELECT arrivee_seq AS seq, arrivee_notifiable AS notif, lu, titulaire_id IS NULL OR titulaire_id = '' AS partage FROM messages ORDER BY arrivee_seq DESC LIMIT 8`),
        curseurs: await sqliteLocal(`SELECT boite, seq FROM arrivees_notifiees`),
        annonces: await notifications(),
      });
    const attendreNotifies = async (description, attendu, lire = notifications) => {
      try {
        await attendre(description, async () => mailsNotifies(await lire()), (n) => n === attendu, 90_000);
        return await lire();
      } catch (err) {
        console.error(`j11-journee: diagnostic ${await etatArrivees().catch((e) => String(e))}`);
        throw err;
      }
    };
    /** Aucune notification de plus pendant que le poste lit sa base (plusieurs passages de 2 secondes). */
    const stable = async (description, attendu, lire = notifications) => {
      await sleep(7000);
      const liste = await lire();
      verifier(description, mailsNotifies(liste) === attendu && liste.length <= attendu, JSON.stringify(liste));
    };

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
    // Premier chargement : le poste a reçu un mail marqué « arrivée notifiable » avant d'ouvrir (historique). Il n'a rien signalé.
    const historiqueNotifiable = await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE arrivee_notifiable = 1`);
    verifier("le poste a reçu, à son premier chargement, un mail marqué notifiable (historique)", Number(historiqueNotifiable?.[0]?.n) >= 1, JSON.stringify(historiqueNotifiable));
    const curseurDepart = await attendre("curseur d'arrivée posé au premier chargement", () => sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`), (r) => Array.isArray(r) && r.length === 1, 30_000);
    const rangMaxPerso = async () => Number((await sqliteLocal(`SELECT MAX(arrivee_seq) AS m FROM messages WHERE titulaire_id = ${lit(demoId)}`))?.[0]?.m);
    verifier("le curseur couvre tout l'historique présent au premier chargement", Number(curseurDepart[0].seq) === (await rangMaxPerso()));
    verifier("premier chargement : aucune notification, malgré le mail notifiable de l'historique", (await notifications()).length === 0, JSON.stringify(await notifications()));
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

    // ===== 2b. Notification de bureau à l'arrivée : observée, une par mail =====
    const flagsArrivee = await sqliteLocal(`SELECT id, arrivee_notifiable AS n FROM messages WHERE id IN ('${m1}', '${m2}')`);
    verifier("les deux mails arrivés portent le marquage notifiable synchronisé", flagsArrivee.length === 2 && flagsArrivee.every((l) => Number(l.n) === 1), JSON.stringify(flagsArrivee));
    const apresArrivees = await attendreNotifies("une notification par mail arrivé (deux)", 2);
    await stable("jamais deux fois pour le même mail : toujours deux mails annoncés après plusieurs passages", 2);
    verifier("notification : « Nouveau mail » ou « N nouveaux mails », et le nom de la boîte",
      apresArrivees.every((n) => /^(Nouveau mail|\d+ nouveaux mails)$/u.test(norm(n.titre)) && norm(n.corps) === "Ma boîte"), JSON.stringify(apresArrivees));
    const texteNotifie = norm(JSON.stringify(await notifications()));
    essaiNegatif("une notification porte l'objet, l'expéditeur ou le texte d'un mail", [objetM1, objetM2, correspondant, nomExpediteur, "Convocation", "creneau", marque].some((mot) => texteNotifie.includes(mot)));
    await attendre("curseur d'arrivée avancé au dernier mail", async () => Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))?.[0]?.seq) === (await rangMaxPerso()), Boolean, 30_000);
    verifier("le curseur dépasse celui du premier chargement", Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))[0].seq) > Number(curseurDepart[0].seq));
    ok("notification de bureau : une par mail arrivé (deux observées), sans objet ni expéditeur, rien au premier chargement ni deux fois");

    // Un mail arrivé dans la boîte nominative d'un AUTRE collaborateur, puis classé dans un dossier du cabinet, descend sur
    // le poste de l'avocat (flux des messages publics) avec son marquage « notifiable » et un rang d'arrivée plus grand que
    // le curseur : le poste ne doit rien signaler.
    const jetonC = await accessToken(api, { email: collab.email, password: collab.password, totpSecret: collab.totp, nomAppareil: `Journée C API ${marque}` });
    const compteCId = randomUUID();
    await json("/messagerie/comptes", jetonC, "POST", {
      id: compteCId,
      adresse: `journee.c.${marque}@cabinet.example`,
      hote: "injoignable.example",
      port: 143,
      utilisateur: "c",
      mot_de_passe: "MotDePasseC123!",
      tls: false,
    });
    const messageC = randomUUID();
    const objetMailC = `Boite de C ${marque}`;
    await sqlServeur(
      `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement, arrivee_notifiable)
       VALUES ('${messageC}', '${cabinetId}', '${compteCId}', '<jso-c-${marque}@example.com>', 1, 1, ${lit(objetMailC)}, 'tiers@example.com', 'a_classer', TRUE)`,
    );
    await json(`/messagerie/messages/${messageC}/classer`, jetonC, "POST", { dossier_id: dossierId });
    const ligneC = await attendre(
      "le mail classé de C descend sur le poste de l'avocat",
      () => sqliteLocal(`SELECT titulaire_id, arrivee_seq, arrivee_notifiable FROM messages WHERE id = '${messageC}'`),
      (r) => Array.isArray(r) && r.length === 1,
      90_000,
    );
    const curseurApresC = Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))[0].seq);
    verifier("ce mail est celui de C, marqué notifiable, de rang supérieur au curseur de l'avocat",
      ligneC[0].titulaire_id === collabId && Number(ligneC[0].arrivee_notifiable) === 1 && Number(ligneC[0].arrivee_seq) > curseurApresC, JSON.stringify(ligneC));
    await stable("le mail de la boîte nominative de C ne notifie pas l'avocat", 2);
    verifier("le curseur de la boîte de l'avocat n'a pas bougé pour le mail de C", Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))[0].seq) === curseurApresC);
    ok("notification de bureau : le mail de la boîte nominative d'un autre collaborateur (classé, marqué notifiable) ne notifie pas");

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
    // Un second poste de l'avocat charge pour la première fois un historique où deux mails sont marqués notifiables (ceux
    // des étapes précédentes) : il n'en signale aucun.
    const notifiablesB = await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE id IN ('${m1}', '${m2}') AND arrivee_notifiable = 1`);
    verifier("second poste : l'historique contient les deux mails marqués notifiables", Number(notifiablesB?.[0]?.n) === 2, JSON.stringify(notifiablesB));
    await attendre("second poste : curseur d'arrivée posé", () => sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`), (r) => Array.isArray(r) && r.length === 1, 30_000);
    await stable("second poste, premier chargement : aucune notification pour l'historique", 0);
    const curseurB = Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))[0].seq);
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
    // Le poste annonce l'arrivée avant que l'avocat n'y réponde (répondre marque le message lu : on ne l'annoncerait plus).
    await attendreNotifies("l'invitation reçue est annoncée (avec les deux premiers mails : trois)", 3);
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

    // La réponse envoyée se retrouve à la réouverture du message : elle vient de la colonne `reponse` synchronisée, pas de
    // l'état de l'écran (qui est démonté quand on quitte les Mails).
    await attendre("réponse reflétée dans la base du poste", () => sqliteLocal(`SELECT reponse FROM invitations_agenda WHERE uid_ical = ${lit(uidInvitation)}`), (r) => r?.[0]?.reponse === "accepte", 60_000);
    await cliquer("[data-testid=nav-agenda]");
    await attendre("écran Agenda (on quitte les Mails)", () => present("[data-testid=ecran-agenda]"), Boolean, 20_000);
    await ouvrirMails();
    await cliquer("[data-testid=vue-a-classer]");
    await attendre("le message de l'invitation (réouverture)", () => present(ligneDe(mInvitation)), Boolean, 30_000);
    await cliquer(ligneDe(mInvitation));
    await attendre("carte d'invitation (réouverte)", () => present("[data-testid=carte-invitation]"), Boolean, 20_000);
    await attendre("la réponse envoyée est affichée à la réouverture", () => texteDe("[data-testid=invitation-confirmee]"), (t) => norm(t).includes("Réponse envoyée à l'organisateur"), 20_000);
    const pressesReouverture = await js(`[...document.querySelectorAll("[data-testid=invitation-repondre]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-reponse"))`);
    verifier("à la réouverture, seule la réponse « Accepter » est marquée", JSON.stringify(pressesReouverture) === JSON.stringify(["accepter"]), JSON.stringify(pressesReouverture));
    essaiNegatif("à la réouverture, « Refuser » est marqué", pressesReouverture.includes("refuser"));
    ok("invitation : la réponse envoyée est retrouvée à la réouverture du message (colonne synchronisée)");
    await stable("l'invitation reçue n'est annoncée qu'une fois (trois mails en tout)", 3);

    // ===== 9b. L'écran Agenda reflète les invitations (demande, mise à jour, annulation), pour leur seul titulaire =====
    // Les jours sont calculés à partir d'aujourd'hui (Paris) : l'écran Agenda suit l'horloge, la recette aussi.
    const jourUn = decalerJour(murDans(new Date(), "Europe/Paris").jour, 3);
    const jourDeux = decalerJour(jourUn, 1);
    const veille = decalerJour(jourUn, -1);
    const uidAg = `jso-ag-${marque}@etude.example`;
    const uidNy = `jso-ny-${marque}@etude.example`;
    const titreAg = `Audience agenda ${marque}`;
    const titreNy = `Visio New York ${marque}`;
    const titreAgMaj = `Audience agenda ${marque} reportee`;
    const messageIdAg = `<jso-ag-${marque}@etude.example>`;
    const messageIdNy = `<jso-ny-${marque}@etude.example>`;
    const messageIdMaj = `<jso-ag-maj-${marque}@etude.example>`;
    const messageIdAnnul = `<jso-ag-annul-${marque}@etude.example>`;
    const deposerInvitation = ({ id, uid, titre, prefixe = "Invitation", debut, fin, sequence = 0, methode = "REQUEST", tzid = "Europe/Paris" }) =>
      capa.ajouter(
        "INBOX",
        courrier({
          de: `Me Organisateur ${marque} <${correspondant}>`,
          a: adressePerso,
          objet: `${prefixe} : ${titre}`,
          id,
          texte: "Invitation fictive.",
          ical: calendrier({ uid, debut, fin, objet: titre, organisateur: correspondant, participant: adressePerso, sequence, methode, tzid }),
          methodeIcal: methode,
        }),
      );
    const surPoste = async (sendCible, action) => {
      const avant = send;
      send = sendCible;
      try {
        return await action();
      } finally {
        send = avant;
      }
    };
    const ouvrirAgenda = async () => {
      await cliquer("[data-testid=nav-agenda]");
      await attendre("écran Agenda", () => present("[data-testid=ecran-agenda]"), Boolean, 30_000);
    };
    /** Affiche, en vue Semaine, la semaine qui contient ce jour (boutons de l'écran, comme l'utilisateur). */
    const allerAuJour = async (jour) => {
      await ouvrirAgenda();
      await cliquer("[data-testid=agenda-vue-semaine]");
      await cliquer("[data-testid=agenda-aujourdhui]");
      for (let i = 0; i < 30; i += 1) {
        if (await present(`[data-testid=agenda-jour][data-jour="${jour}"]`)) return;
        await cliquer("[data-testid=agenda-suivant]");
        await sleep(120);
      }
      fail(`le jour ${jour} est introuvable dans l'Agenda`);
    };
    const invitationsAgenda = (jour) =>
      js(`[...document.querySelectorAll(${JSON.stringify(`[data-testid=agenda-jour][data-jour="${jour}"] [data-testid=agenda-invitation]`)})].map((li) => {
        const t = (sel) => li.querySelector(sel)?.innerText ?? null;
        return {
          uid: li.getAttribute("data-uid"),
          effet: li.getAttribute("data-effet"),
          reponse: li.getAttribute("data-reponse"),
          titre: t("[data-testid=agenda-invitation-titre]"),
          heure: t("[data-testid=agenda-invitation-heure]"),
          etat: t("[data-testid=agenda-invitation-etat]"),
          libelleReponse: t("[data-testid=agenda-invitation-reponse]"),
          avertissement: t("[data-testid=agenda-invitation-avertissement]"),
          lien: Boolean(li.querySelector("[data-testid=agenda-invitation-ouvrir]")),
          barre: getComputedStyle(li.querySelector("[data-testid=agenda-invitation-titre]")).textDecorationLine,
        };
      })`);
    const invitationDeAgenda = async (jour, uid) => (await invitationsAgenda(jour)).find((i) => i.uid === uid);
    const lienOuvrir = (uid) => `[data-testid=agenda-invitation][data-uid="${uid}"] [data-testid=agenda-invitation-ouvrir]`;
    /** Depuis l'Agenda : « Ouvrir le mail » d'une invitation, jusqu'à sa carte dans l'écran Mails. */
    const ouvrirMailDeInvitation = async (jour, uid) => {
      await allerAuJour(jour);
      await attendre("lien « Ouvrir le mail »", () => present(lienOuvrir(uid)), Boolean, 30_000);
      await cliquer(lienOuvrir(uid));
      await attendre("écran Mails ouvert par le lien", () => present("[data-testid=mails-trois-volets]"), Boolean, 20_000);
      await attendre("carte d'invitation du mail ouvert", () => present("[data-testid=carte-invitation]"), Boolean, 30_000);
    };
    /** Le collaborateur C : son Agenda, au même jour, ne porte aucune invitation (ni dans la base de son poste). */
    const verifierAgendaDeC = async (jour, contexte) => {
      await sleep(4000);
      const vu = await surPoste(sendC, async () => {
        await allerAuJour(jour);
        return {
          jourAffiche: await present(`[data-testid=agenda-jour][data-jour="${jour}"]`),
          duJour: await invitationsAgenda(jour),
          toutes: await compter("[data-testid=agenda-invitation]"),
          enBase: Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM invitations_agenda`))?.[0]?.n),
        };
      });
      verifier(`C (${contexte}) : son écran Agenda s'affiche à ce jour`, vu.jourAffiche === true);
      verifier(`C (${contexte}) : aucune invitation de l'avocat dans son Agenda ni dans sa base`, vu.duJour.length === 0 && vu.toutes === 0 && vu.enBase === 0, JSON.stringify(vu));
    };

    resetPostes(["jsoc"]);
    posteC = await ouvrirPoste("jsoc", 9363, {
      email: collab.email,
      password: collab.password,
      secret: collab.totp,
      nomAppareil: `Journée C ${marque}`,
      mode: "copie",
    });
    const sendC = posteC.page.send;

    // --- Demande : une audience à Paris et une visio dans le fuseau de New York ---
    const murNy = murDans(instantDepuisMur(jourUn, 10, 0, "America/New_York"), "Europe/Paris");
    deposerInvitation({ id: messageIdAg, uid: uidAg, titre: titreAg, debut: dtstart(jourUn, 10), fin: dtstart(jourUn, 11) });
    deposerInvitation({ id: messageIdNy, uid: uidNy, titre: titreNy, debut: dtstart(jourUn, 10), fin: dtstart(jourUn, 11), tzid: "America/New_York" });
    await attendre("les deux invitations dans la base du poste de l'avocat", () => sqliteLocal(`SELECT COUNT(*) AS n FROM invitations_agenda WHERE uid_ical IN (${lit(uidAg)}, ${lit(uidNy)})`), (r) => Number(r?.[0]?.n) === 2, 120_000);
    const lignesNy = await sqliteLocal(`SELECT debut, debut_utc, fuseau FROM invitations_agenda WHERE uid_ical = ${lit(uidNy)}`);
    verifier("base du poste : l'heure civile de New York et l'instant UTC (calculé ici avec Intl)",
      lignesNy[0].debut === `${jourUn}T10:00:00` && lignesNy[0].fuseau === "America/New_York" && lignesNy[0].debut_utc === instantDepuisMur(jourUn, 10, 0, "America/New_York").toISOString(), JSON.stringify(lignesNy[0]));
    await allerAuJour(jourUn);
    const dAg = await attendre("la demande dans l'Agenda de l'avocat", () => invitationDeAgenda(jourUn, uidAg), Boolean, 60_000);
    verifier("Agenda : « Invitation », titre, heure de Paris, demande, réponse à donner, lien vers le mail",
      dAg.effet === "demande" && norm(dAg.titre) === `Invitation — ${titreAg}` && norm(dAg.heure) === "10 h 00" && dAg.etat === null && dAg.reponse === "a_repondre" && norm(dAg.libelleReponse) === "À répondre" && dAg.lien === true && dAg.avertissement === null && dAg.barre === "none", JSON.stringify(dAg));
    const dNy = await attendre("la visio de New York dans l'Agenda", () => invitationDeAgenda(jourUn, uidNy), Boolean, 30_000);
    verifier(`Agenda : l'heure de New York est convertie à l'heure de Paris (${heureEcran(murNy)})`, murNy.jour === jourUn && norm(dNy.heure) === heureEcran(murNy), JSON.stringify(dNy));
    essaiNegatif("l'Agenda montre l'heure de New York telle quelle (10 h 00)", norm(dNy.heure) === "10 h 00");
    essaiNegatif("l'invitation figure la veille ou le lendemain", Boolean(await invitationDeAgenda(veille, uidAg)) || Boolean(await invitationDeAgenda(jourDeux, uidAg)));
    essaiNegatif("une invitation jamais reçue figure dans l'Agenda", Boolean(await invitationDeAgenda(jourUn, `jamais-${marque}@etude.example`)));
    await capturer("journee-agenda-invitations-jour.png", "light");
    await capturer("journee-agenda-invitations-nuit.png", "dark");
    await attendreNotifies("les deux demandes sont annoncées, une fois chacune (cinq mails)", 5);
    await verifierAgendaDeC(jourUn, "demande");
    verifier("A : ses deux invitations sont bien dans sa base (contrôle positif de l'essai de C)", Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM invitations_agenda`))?.[0]?.n) >= 2);
    ok("Agenda : la demande (Paris) et la visio de New York (convertie) s'affichent chez l'avocat, pas chez C");

    // --- « Ouvrir le mail », réponse et réouverture ---
    await ouvrirMailDeInvitation(jourUn, uidAg);
    verifier("le lien ouvre le mail de l'invitation : titre de la carte et objet du message",
      (await texteDe("[data-testid=invitation-titre]")) === titreAg && (await texteDe("[data-testid=lecture-objet]")).includes(titreAg));
    verifier("la carte est celle d'une demande", (await js(`document.querySelector("[data-testid=carte-invitation]").getAttribute("data-effet")`)) === "demande");
    essaiNegatif("une confirmation avant toute réponse", await present("[data-testid=invitation-confirmee]"));
    await cliquer("[data-testid=invitation-repondre][data-reponse=accepter]");
    await attendre("confirmation de la réponse (Agenda)", () => texteDe("[data-testid=invitation-confirmee]"), (t) => norm(t).includes("Réponse envoyée à l'organisateur"), 90_000);
    await attendre("réponse enregistrée au serveur", () => sqlServeur(`SELECT COALESCE(reponse, '') FROM invitations_agenda WHERE uid_ical = ${lit(uidAg)}`), (v) => v === "accepte", 30_000);
    await allerAuJour(jourUn);
    const dAgRepondu = await attendre("la réponse « Accepté » dans l'Agenda", async () => invitationDeAgenda(jourUn, uidAg), (i) => i?.reponse === "accepte", 60_000);
    verifier("Agenda : « Accepté »", norm(dAgRepondu.libelleReponse) === "Accepté", JSON.stringify(dAgRepondu));
    verifier("Agenda : l'autre invitation reste « À répondre »", (await invitationDeAgenda(jourUn, uidNy))?.reponse === "a_repondre");
    // Réouverture : la réponse se retrouve sans nouveau clic ; l'autre invitation n'en a pas.
    await ouvrirMailDeInvitation(jourUn, uidAg);
    await attendre("réponse retrouvée à la réouverture depuis l'Agenda", () => texteDe("[data-testid=invitation-confirmee]"), (t) => norm(t).includes("Réponse envoyée"), 20_000);
    await ouvrirMailDeInvitation(jourUn, uidNy);
    verifier("la carte de l'autre invitation est celle de la visio", (await texteDe("[data-testid=invitation-titre]")) === titreNy);
    essaiNegatif("l'autre invitation, jamais répondue, porte une confirmation", await present("[data-testid=invitation-confirmee]"));
    essaiNegatif("l'autre invitation a un bouton de réponse marqué", (await js(`[...document.querySelectorAll("[data-testid=invitation-repondre]")].some((b) => b.getAttribute("aria-pressed") === "true")`)) === true);
    ok("Agenda : « Ouvrir le mail » ouvre la carte, la réponse envoyée se lit dans l'Agenda et à la réouverture, l'autre invitation reste à répondre");

    // --- Mise à jour (SEQUENCE 1) : l'élément change de jour et d'heure, la réponse est à redonner ---
    deposerInvitation({ id: messageIdMaj, uid: uidAg, titre: titreAgMaj, prefixe: "Updated invitation", debut: dtstart(jourDeux, 14), fin: dtstart(jourDeux, 15), sequence: 1 });
    await attendre("mise à jour dans la base du poste", () => sqliteLocal(`SELECT sequence, effet FROM invitations_agenda WHERE uid_ical = ${lit(uidAg)}`), (r) => Number(r?.[0]?.sequence) === 1 && r?.[0]?.effet === "mise_a_jour", 120_000);
    await allerAuJour(jourDeux);
    const dMaj = await attendre("la mise à jour dans l'Agenda, au nouveau jour", () => invitationDeAgenda(jourDeux, uidAg), Boolean, 60_000);
    verifier("Agenda : mise à jour (nouveau titre, 14 h 00, « Mise à jour », réponse à redonner)",
      dMaj.effet === "mise_a_jour" && norm(dMaj.titre) === `Invitation — ${titreAgMaj}` && norm(dMaj.heure) === "14 h 00" && norm(dMaj.etat) === "Mise à jour" && dMaj.reponse === "a_repondre" && norm(dMaj.libelleReponse) === "À répondre", JSON.stringify(dMaj));
    await allerAuJour(jourUn);
    essaiNegatif("l'ancienne date de l'invitation la montre encore", Boolean(await invitationDeAgenda(jourUn, uidAg)));
    verifier("l'autre invitation est restée à sa date (contrôle positif)", Boolean(await invitationDeAgenda(jourUn, uidNy)));
    await ouvrirMailDeInvitation(jourDeux, uidAg);
    verifier("le lien ouvre désormais le message de la mise à jour : carte « mise à jour »", (await js(`document.querySelector("[data-testid=carte-invitation]").getAttribute("data-effet")`)) === "mise_a_jour" && norm(await texteDe("[data-testid=invitation-etat]")) === "Invitation mise à jour");
    essaiNegatif("la réponse envoyée à l'ancienne version est affichée pour la nouvelle", await present("[data-testid=invitation-confirmee]"));
    await attendreNotifies("la mise à jour est annoncée (six mails)", 6);
    await verifierAgendaDeC(jourDeux, "mise à jour");
    ok("Agenda : la mise à jour déplace l'invitation (nouveau jour et heure), marquée, réponse à redonner ; rien chez C");

    // --- Annulation (SEQUENCE 2) : l'élément reste, marqué annulé ---
    deposerInvitation({ id: messageIdAnnul, uid: uidAg, titre: titreAgMaj, prefixe: "Canceled", debut: dtstart(jourDeux, 14), fin: dtstart(jourDeux, 15), sequence: 2, methode: "CANCEL" });
    await attendre("annulation dans la base du poste", () => sqliteLocal(`SELECT sequence, effet FROM invitations_agenda WHERE uid_ical = ${lit(uidAg)}`), (r) => Number(r?.[0]?.sequence) === 2 && r?.[0]?.effet === "annulation", 120_000);
    await allerAuJour(jourDeux);
    const dAnnul = await attendre("l'annulation dans l'Agenda", async () => invitationDeAgenda(jourDeux, uidAg), (i) => i?.effet === "annulation", 60_000);
    verifier("Agenda : annulée (étiquette, titre barré, plus de réponse à donner, lien conservé)",
      norm(dAnnul.etat) === "Annulée" && dAnnul.barre.includes("line-through") && dAnnul.libelleReponse === null && dAnnul.lien === true, JSON.stringify(dAnnul));
    await allerAuJour(jourUn);
    essaiNegatif("une invitation non annulée est barrée dans l'Agenda", (await invitationDeAgenda(jourUn, uidNy))?.barre?.includes("line-through") === true);
    verifier("l'autre invitation n'est pas touchée", (await invitationDeAgenda(jourUn, uidNy))?.effet === "demande");
    await ouvrirMailDeInvitation(jourDeux, uidAg);
    verifier("la carte du mail d'annulation : « Invitation annulée », aucun bouton de réponse", norm(await texteDe("[data-testid=invitation-etat]")) === "Invitation annulée" && (await compter("[data-testid=invitation-repondre]")) === 0);
    await attendreNotifies("l'annulation est annoncée, comme chaque arrivée (sept mails)", 7);
    await verifierAgendaDeC(jourDeux, "annulation");
    const notifsC = await surPoste(sendC, notifications);
    verifier("C n'est notifié d'aucun des mails de l'avocat", notifsC.length === 0, JSON.stringify(notifsC));
    ok("Agenda : l'annulation marque l'invitation annulée (elle reste listée) ; C n'a rien vu, rien reçu comme notification");
    await posteC.page.ws.close();
    await stopApp(posteC.child);
    posteC = null;

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

    // ===== 10b. Traiter un mail depuis l'app (lu, non lu, déplacer, supprimer) et chercher sur le serveur =====
    // Le vieux mail « libre » est dans la réception IMAP de la boîte nominative (Dovecot). Chaque action passe par l'API et
    // sa file ; l'effet se lit sur le serveur IMAP par un client de contrôle qui ne pose jamais \Seen.
    const drapeauxLibre = (dossier) => capa.drapeaux(dossier, "Message-ID", idAncienLibre);
    const dossierCorbeille = () => capa.dossiers().find((nom) => /(^|[/.])(trash|corbeille)$/iu.test(nom)) ?? null;
    const resultatAction = (texte) => attendre(`résultat de l'action « ${texte} »`, () => texteDe("[data-testid=action-resultat]"), (t) => t.includes(texte), 60_000);
    await cliquer("[data-testid=vue-a-classer]");
    await attendre("le vieux mail libre dans « À classer »", () => present(ligneAncienLibre), Boolean, 30_000);
    await cliquer(ligneAncienLibre);
    await attendre("lecture du vieux mail libre", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objetAncienLibre));
    await attendre("barre de traitement du message", () => present("[data-testid=lecture-traitement]"), Boolean, 20_000);
    verifier("avant toute action : une seule copie, dans la réception IMAP", (await drapeauxLibre("INBOX")).length === 1 && (await drapeauxLibre("Archives")).length === 0);
    // Départ non lu, quel que soit l'état laissé par les étapes précédentes.
    if ((await texteDe("[data-testid=action-lu]")).includes("non lu")) {
      await cliquer("[data-testid=action-lu]");
      await resultatAction("Marqué comme non lu.");
    }
    await attendre("bouton « Marquer lu »", () => texteDe("[data-testid=action-lu]"), (t) => t.trim() === "Marquer lu", 30_000);
    verifier("départ : non lu sur le serveur IMAP", !(await drapeauxLibre("INBOX"))[0].includes("\\Seen"), JSON.stringify(await drapeauxLibre("INBOX")));
    await cliquer("[data-testid=action-lu]");
    await resultatAction("Marqué comme lu.");
    const apresLu = await drapeauxLibre("INBOX");
    verifier("« Marquer lu » : le serveur IMAP porte \\Seen", apresLu.length === 1 && apresLu[0].includes("\\Seen"), JSON.stringify(apresLu));
    essaiNegatif("le mail est resté non lu sur le serveur IMAP après « Marquer lu »", !apresLu[0].includes("\\Seen"));
    await attendre("le poste voit le mail lu (flux de synchronisation)", () => sqliteLocal(`SELECT lu FROM messages WHERE id = '${idServeurAncienLibre}'`), (r) => Number(r?.[0]?.lu) === 1, 60_000);
    await attendre("bouton « Marquer non lu »", () => texteDe("[data-testid=action-lu]"), (t) => t.trim() === "Marquer non lu", 30_000);
    await cliquer("[data-testid=action-lu]");
    await resultatAction("Marqué comme non lu.");
    const apresNonLu = await drapeauxLibre("INBOX");
    verifier("« Marquer non lu » : \\Seen retiré sur le serveur IMAP", apresNonLu.length === 1 && !apresNonLu[0].includes("\\Seen"), JSON.stringify(apresNonLu));
    essaiNegatif("le serveur IMAP porte encore \\Seen après « Marquer non lu »", apresNonLu[0].includes("\\Seen"));
    await attendre("le poste voit le mail non lu", () => sqliteLocal(`SELECT lu FROM messages WHERE id = '${idServeurAncienLibre}'`), (r) => Number(r?.[0]?.lu) === 0, 60_000);

    // Déplacer vers les archives (dossier créé au besoin).
    verifier("« Déplacer » propose les archives", await js(`[...document.querySelectorAll("[data-testid=action-deplacer] option")].some((o) => o.value === "Archives")`));
    essaiNegatif("« Déplacer » propose le dossier où se trouve déjà le mail", await js(`[...document.querySelectorAll("[data-testid=action-deplacer] option")].some((o) => o.value === "INBOX")`));
    // Menu d'action : il revient à « Déplacer vers… » après le choix, la valeur affichée ne prouve donc rien ; le résultat
    // et les copies IMAP ci-dessous le prouvent.
    verifier("destination choisie", await js(`(() => {
      const el = document.querySelector("[data-testid=action-deplacer]");
      if (!el || ![...el.options].some((o) => o.value === "Archives")) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "Archives");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`));
    await resultatAction("Message déplacé.");
    verifier("déplacé : une copie dans Archives, aucune dans la réception", (await drapeauxLibre("Archives")).length === 1 && (await drapeauxLibre("INBOX")).length === 0);
    essaiNegatif("le mail est encore dans la réception IMAP après « Déplacer »", (await drapeauxLibre("INBOX")).length > 0);
    await attendre("le poste voit le dossier Archives", () => sqliteLocal(`SELECT dossier_imap FROM messages WHERE id = '${idServeurAncienLibre}'`), (r) => r?.[0]?.dossier_imap === "Archives", 60_000);

    // Supprimer : vers la Corbeille, jamais d'EXPUNGE.
    await cliquer("[data-testid=action-supprimer]");
    await resultatAction("Déplacé dans la corbeille.");
    const corbeille = dossierCorbeille();
    verifier("une Corbeille existe sur le serveur IMAP", corbeille !== null, JSON.stringify(capa.dossiers()));
    verifier("supprimé : une copie dans la Corbeille, aucune dans Archives", (await drapeauxLibre(corbeille)).length === 1 && (await drapeauxLibre("Archives")).length === 0);
    essaiNegatif("le message a disparu du serveur IMAP après « Supprimer » (expurgé)", (await drapeauxLibre(corbeille)).length === 0);
    ok("traiter un mail depuis l'app : lu et non lu, déplacer, supprimer vers la Corbeille, chacun lu sur le serveur IMAP et vu par le poste");

    // Recherche sur le serveur : l'expéditeur n'est pas dans l'index du poste (objet et texte seulement).
    const termeExpediteur = "ancien example";
    const locauxAvant = await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE id IN ('${idServeurAncienLibre}', '${idServeurAncienClasse}') AND (' ' || lower(coalesce(objet, '')) || ' ' || lower(coalesce(texte_brut, '')) || ' ') LIKE '%ancien%example%'`);
    verifier("le terme ne figure ni dans l'objet ni dans le texte des deux vieux mails (le poste seul ne les trouverait pas)", Number(locauxAvant?.[0]?.n) === 0, JSON.stringify(locauxAvant));
    const objetConfidentiel = `Confidentiel ${marque} C`;
    const messageConfidentiel = randomUUID();
    await sqlServeur(
      `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
       VALUES ('${messageConfidentiel}', '${cabinetId}', '${compteCId}', '<jso-confidentiel-${marque}@example.com>', 1, 2, ${lit(objetConfidentiel)}, 'tiers.confidentiel@example.com', 'a_classer')`,
    );
    const cote = await json(`/messagerie/recherche?q=${encodeURIComponent(`confidentiel ${marque}`)}`, jetonC, "GET");
    verifier("le mail non classé de C est trouvé par C lui-même (l'essai négatif a un sens)", cote.resultats.some((r) => r.id === messageConfidentiel), JSON.stringify(cote.resultats.map((r) => r.id)));
    await setField(send, "recherche-mails", termeExpediteur);
    await attendre("la recherche du serveur a répondu", () => js(`document.querySelector("[data-testid=mails-liste]")?.getAttribute("data-recherche-serveur")`), (v) => v === "ok", 60_000);
    const parExpediteur = await attendre("les deux vieux mails trouvés par l'expéditeur", hits, (h) => h.includes(idServeurAncienLibre) && h.includes(idServeurAncienClasse), 60_000);
    verifier("la recherche serveur retrouve par l'expéditeur, y compris le mail à la Corbeille", parExpediteur.includes(idServeurAncienLibre) && parExpediteur.includes(idServeurAncienClasse), JSON.stringify(parExpediteur));
    essaiNegatif("la recherche par l'expéditeur trouve un mail récent", parExpediteur.includes(m1) || parExpediteur.includes(m2));
    verifier("recherche du serveur disponible : aucun message d'indisponibilité", !(await present("[data-testid=recherche-serveur-indisponible]")));
    await setField(send, "recherche-mails", `confidentiel ${marque}`);
    await attendre("la recherche du serveur a répondu (mot confidentiel)", () => js(`document.querySelector("[data-testid=mails-liste]")?.getAttribute("data-recherche-serveur")`), (v) => v === "ok", 60_000);
    await sleep(1500);
    essaiNegatif("le mail non classé de la boîte d'un confrère est trouvé par l'avocat", (await hits()).includes(messageConfidentiel));
    verifier("le mail de C n'apparaît pas chez l'avocat", !(await hits()).includes(messageConfidentiel));
    await setField(send, "recherche-mails", "");
    ok("recherche serveur : l'expéditeur (absent de l'index du poste) retrouve les vieux mails, y compris à la Corbeille ; le mail non classé d'un confrère n'est jamais rendu");

    // ===== 11. Notification de bureau : bilan du poste A, puis relance du second poste =====
    send = sendA;
    await stable("poste A : sept mails annoncés en tout (deux, l'invitation, deux demandes, la mise à jour, l'annulation), chacun une fois", 7);
    verifier("poste A : chaque notification ne porte que le nom de la boîte", (await notifications()).every((n) => norm(n.corps) === "Ma boîte"));
    // Le second poste a été fermé après l'étape 8. Depuis, cinq mails sont arrivés dans la boîte (l'invitation de l'étape 9,
    // les deux demandes, la mise à jour, l'annulation) : relancé, il les annonce une fois, et jamais ce qu'il avait déjà
    // vu (les deux premiers mails, le vieux mail marqué notifiable). Son curseur est gardé dans sa base locale.
    posteB = await ouvrirPoste("jsob", 9362, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Journée B2 ${marque}`,
      mode: "copie",
      forcer: true,
    });
    send = posteB.page.send;
    await attendre(
      "second poste relancé : les invitations arrivées pendant sa fermeture",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM invitations_agenda WHERE uid_ical IN (${lit(uidInvitation)}, ${lit(uidAg)}, ${lit(uidNy)})`),
      (r) => Number(r?.[0]?.n) === 3,
      180_000,
    );
    await attendreNotifies("second poste relancé : les cinq mails arrivés pendant sa fermeture sont annoncés", 5);
    await stable("second poste : aucune annonce de plus, et jamais l'historique déjà vu (cinq mails seulement)", 5);
    verifier("second poste : son curseur a avancé depuis sa première session", Number((await sqliteLocal(`SELECT seq FROM arrivees_notifiees WHERE boite = 'perso'`))[0].seq) > curseurB);
    verifier("second poste : chaque notification ne porte que le nom de la boîte", (await notifications()).every((n) => norm(n.corps) === "Ma boîte"));
    ok("notification de bureau : poste A sept mails, une fois chacun ; poste B relancé cinq mails arrivés fermé, rien de l'historique");
    send = sendA;

    posteA.page.ws.close();
  } finally {
    if (posteC) await stopApp(posteC.child);
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
