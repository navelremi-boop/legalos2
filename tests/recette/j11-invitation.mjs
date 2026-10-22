#!/usr/bin/env node
/**
 * J11 étape 2 (critère b) — invitations de calendrier reçues par mail, côté serveur, contre
 * l'instance et deux GreenMail (API seulement, sans app).
 *
 * Boîtes : le titulaire A reçoit ses invitations dans une boîte nominative sur le Dovecot de
 * `instance/imap-test` (utilisateur « capa ») ; l'organisateur est la boîte « demo » du GreenMail de
 * l'instance, qui reçoit les réponses envoyées par la file d'envoi. Une boîte partagée (sans
 * titulaire) lit la même boîte « capa » : elle ne doit créer l'invitation de personne.
 *
 * Chaque vérification a son essai négatif : la même vérification, appliquée à la situation
 * inversée (autre collaborateur, SEQUENCE plus récente, boîte nominative, réponse différente…),
 * doit donner l'inverse. Un essai négatif qui ne bascule pas fait échouer la recette.
 *
 * Aucun contenu réel : adresses et textes fictifs, identifiants techniques dans les messages.
 * Prérequis : instance démarrée avec GreenMail, `docker compose -f instance/imap-test/docker-compose.yml
 * up -d --wait`, `python`. Usage : node tests/recette/j11-invitation.mjs
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, demoAccessToken, demoEmail } from "./lib/demo-auth.mjs";
import { MOT_IMAP_TEST, connecterAuReseauApi, conteneur } from "./lib/moteur-mail.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const marque = randomUUID().slice(0, 8);
/** Boîte « capa » du Dovecot d'imap-test (QRESYNC : un mail déposé réveille le moteur), vue de l'hôte. */
const capa = { hote: "127.0.0.1", port: "1143", login: "capa", secret: MOT_IMAP_TEST };
/** Boîte « demo » du GreenMail de l'instance, vue de l'hôte : l'organisateur. */
const demo = {
  hote: process.env.LEGALOS_IMAP_HOST ?? "127.0.0.1",
  port: process.env.LEGALOS_IMAP_PORT ?? "13143",
  login: "demo",
};
const organisateur = "demo@cabinet.example";

function fail(message) {
  console.error(`j11-invitation: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function ok(message) {
  console.log(`j11-invitation: ${message}`);
}

/** Vérification : doit être vraie. */
function verifier(libelle, condition) {
  if (!condition) fail(libelle);
}

/**
 * Essai négatif : `verification` est la vérification elle-même, rappelée sur la situation
 * inversée ; elle doit y être fausse. `situation` décrit l'inversion.
 */
function essaiNegatif(libelle, situation, verification) {
  if (verification()) fail(`essai négatif « ${libelle} » : la vérification passe encore (${situation})`);
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

async function requete(chemin, jeton, methode = "GET", corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(90_000),
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = null;
  }
  return { statut: reponse.status, json, texte };
}

async function exiger(chemin, jeton, methode, corps, contexte) {
  const r = await requete(chemin, jeton, methode, corps);
  if (r.statut < 200 || r.statut >= 300) {
    fail(`${contexte ?? `${methode} ${chemin}`} → ${r.statut} ${r.texte.slice(0, 300)}`);
  }
  return r.json;
}

async function attendre(contexte, lecture, delaiMs = 60_000) {
  const debut = Date.now();
  let derniere = null;
  while (Date.now() - debut < delaiMs) {
    try {
      derniere = await lecture();
      if (derniere) return derniere;
    } catch (err) {
      derniere = null;
      void err;
    }
    await sleep(700);
  }
  fail(`${contexte} : délai dépassé (${delaiMs} ms)`);
  return null;
}

async function entier(requeteSql) {
  return Number.parseInt(await sqlServeur(requeteSql), 10);
}

// --------------------------------------------------------------------------------------------
// Client IMAP de contrôle (python imaplib). Le mot de passe et le message passent par l'environnement.
// --------------------------------------------------------------------------------------------
const SCRIPT_IMAP = String.raw`
import email, email.policy, imaplib, json, os, sys
hote, port, login, action, dossier, cible = sys.argv[1:7]
boite = imaplib.IMAP4(hote, int(port))
boite.login(login, os.environ['IMAP_SECRET'])
if action == 'ajouter':
    typ, _ = boite.append(dossier, None, None, os.environ['IMAP_BRUT'].encode('utf-8'))
    assert typ == 'OK', typ
    print('[]')
elif action == 'purger':
    typ, _ = boite.select(dossier)
    n = 0
    if typ == 'OK':
        typ, data = boite.search(None, 'ALL')
        for num in (data[0].split() if data and data[0] else []):
            boite.store(num, '+FLAGS', '(\\Deleted)')
            n += 1
        boite.expunge()
    print(json.dumps(n))
elif action == 'lister':
    typ, _ = boite.select(dossier)
    if typ != 'OK':
        print('[]'); sys.exit(0)
    entete, valeur = cible.split('=', 1)
    typ, data = boite.search(None, 'HEADER', entete, '"' + valeur + '"')
    sortie = []
    for num in (data[0].split() if data and data[0] else []):
        typ, brut = boite.fetch(num, '(RFC822)')
        msg = email.message_from_bytes(brut[0][1], policy=email.policy.default)
        parties = []
        for p in msg.walk():
            if p.get_content_maintype() == 'multipart':
                continue
            texte = p.get_content() if p.get_content_maintype() == 'text' else ''
            parties.append({'type': p.get_content_type(), 'methode': p.get_param('method'),
                            'disposition': p.get_content_disposition(), 'texte': texte})
        sortie.append({'sujet': str(msg['Subject']), 'message_id': str(msg['Message-ID']),
                       'en_reponse_a': str(msg['In-Reply-To']), 'a': str(msg['To']),
                       'de': str(msg['From']), 'reply_to': str(msg['Reply-To']) if msg['Reply-To'] is not None else None,
                       'bcc': msg['Bcc'] is not None, 'parties': parties})
    print(json.dumps(sortie))
boite.logout()
`;

function imap({ boite, action, dossier = "INBOX", cible = "", brut = "" }) {
  const run = spawnSync(
    "python",
    ["-c", SCRIPT_IMAP, boite.hote, boite.port, boite.login, action, dossier, cible],
    { encoding: "utf8", env: { ...process.env, IMAP_SECRET: boite.secret, IMAP_BRUT: brut } },
  );
  if (run.status !== 0) {
    throw new Error(`imap ${action} ${dossier} : ${(run.stderr || run.stdout).slice(0, 200)}`);
  }
  return JSON.parse(run.stdout || "[]");
}

// --------------------------------------------------------------------------------------------
// Messages d'invitation fictifs
// --------------------------------------------------------------------------------------------
const CRLF = "\r\n";

/** Corps iCalendar. `debut` : la ligne DTSTART complète ; `fin` : la ligne DTEND ou rien. */
function calendrier({ methode = "REQUEST", uid, sequence = 0, debut, fin = "", objet, participant, organisateurIcal = organisateur }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cabinet fictif//j11-invitation//FR",
    `METHOD:${methode}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    "DTSTAMP:20261001T080000Z",
    debut,
    ...(fin ? [fin] : []),
    `SUMMARY:${objet}`,
    `ORGANIZER;CN=Organisateur Fictif:mailto:${organisateurIcal}`,
    `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${participant}`,
    ...(methode === "CANCEL" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join(CRLF);
}

function messageInvitation({ messageId, destinataire, objet, ical, methode = "REQUEST", de = organisateur, sender = "" }) {
  return [
    `From: Organisateur Fictif <${de}>`,
    ...(sender ? [`Sender: ${sender}`] : []),
    `To: ${destinataire}`,
    `Subject: Invitation : ${objet}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="limite-inv"',
    "",
    "--limite-inv",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Invitation fictive a une audience.",
    "--limite-inv",
    `Content-Type: text/calendar; charset=utf-8; method=${methode}`,
    "",
    ical,
    "--limite-inv--",
    "",
  ].join(CRLF);
}

const identifiantMessage = (etiquette) => `<inv-${etiquette}-${marque}@example.com>`;

function deposer({ etiquette, uid, sequence, debut, fin, objet, methode = "REQUEST", participant, de, sender, organisateurIcal }) {
  const messageId = identifiantMessage(etiquette);
  imap({
    boite: capa,
    action: "ajouter",
    brut: messageInvitation({
      messageId,
      destinataire: participant,
      objet,
      methode,
      de,
      sender,
      ical: calendrier({ methode, uid, sequence, debut, fin, objet, participant, organisateurIcal }),
    }),
  });
  return messageId;
}

// --------------------------------------------------------------------------------------------
// Lecture en base et par l'API
// --------------------------------------------------------------------------------------------
async function ligneInvitation(uid) {
  const brut = await sqlServeur(
    `SELECT sequence, effet, fuseau, debut, COALESCE(fin, ''), COALESCE(debut_utc, ''), COALESCE(fin_utc, ''), objet, revision, COALESCE(reponse, ''), COALESCE(message_id, ''), COALESCE(compte_id::text, '') FROM invitations_agenda WHERE uid_ical = '${uid}'`,
  );
  if (!brut) return null;
  const [sequence, effet, fuseau, debut, fin, debutUtc, finUtc, objet, revision, reponse, messageId, compte] =
    brut.split("|");
  return {
    sequence: Number(sequence),
    effet,
    fuseau,
    debut,
    fin,
    debutUtc,
    finUtc,
    objet,
    revision: Number(revision),
    reponse,
    messageId,
    compte,
  };
}

async function attendreLigne(uid, predicat = () => true, delaiMs = 60_000) {
  return attendre(
    `invitation ${uid}`,
    async () => {
      const ligne = await ligneInvitation(uid);
      return ligne && predicat(ligne) ? ligne : null;
    },
    delaiMs,
  );
}

async function attendreMessageRecu(compteId, messageId) {
  await attendre(
    `message ${messageId} relevé par le moteur`,
    async () =>
      (await entier(`SELECT COUNT(*) FROM messages WHERE compte_id = '${compteId}' AND message_id = '${messageId}'`)) === 1,
  );
}

async function listeApi(jeton) {
  return (await exiger("/messagerie/invitations", jeton, "GET", undefined, "liste des invitations")) ?? [];
}

// --------------------------------------------------------------------------------------------
async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const secretDemo = motDePasseBoite();
  demo.secret = secretDemo;
  const dovecotTest = conteneur("legalos-imap-test-dovecot")[0];
  if (!dovecotTest) {
    fail("GreenMail d'imap-test absent : docker compose -f instance/imap-test/docker-compose.yml up -d --wait");
  }
  connecterAuReseauApi(dovecotTest);

  // Repartir d'une boîte « capa » vide et sans compte du moteur sur elle : aucune invitation d'un
  // autre essai ne vient se mêler aux nôtres.
  await sqlServeur(
    `DELETE FROM invitations_agenda WHERE compte_id IN (SELECT id FROM comptes_mail WHERE hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'inv-j11.%')`,
  );
  await sqlServeur(
    `DELETE FROM messages WHERE compte_id IN (SELECT id FROM comptes_mail WHERE hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'inv-j11.%')`,
  );
  // Les réponses d'invitation partent de la boîte invitée : leurs lignes de file la référencent.
  await sqlServeur(
    `DELETE FROM file_envoi_pieces WHERE envoi_id IN (SELECT id FROM file_envoi WHERE compte_id IN (SELECT id FROM comptes_mail WHERE hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'inv-j11.%'))`,
  );
  await sqlServeur(
    `DELETE FROM file_envoi WHERE compte_id IN (SELECT id FROM comptes_mail WHERE hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'inv-j11.%')`,
  );
  await sqlServeur(
    `DELETE FROM comptes_mail WHERE hote LIKE 'legalos-imap-test-dovecot%' OR adresse LIKE 'inv-j11.%'`,
  );
  imap({ boite: capa, action: "purger" });

  const jetonA = await demoAccessToken(api, `j11-invitation-a-${marque}`);
  const emailB = `j11-invitation-${marque}@cabinet-fictif.example`;
  const collabB = { email: emailB, password: "MotDePasseCollab123!", totpSecret: "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA" };
  await exiger(
    "/collaborateurs",
    jetonA,
    "POST",
    { email: collabB.email, password: collabB.password, totp_secret_base32: collabB.totpSecret },
    "création du collaborateur B",
  );
  const jetonB = await accessToken(api, { ...collabB, nomAppareil: `j11-invitation-b-${marque}` });
  const idA = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${demoEmail}'`);
  const idB = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${emailB}'`);
  const cabinet = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${idA}'`);
  if (!idA || !idB || idA === idB) fail("deux collaborateurs distincts attendus");

  const creerCompteNominatif = async (etiquette) => {
    const id = randomUUID();
    const adresse = `inv-j11.${etiquette}.${marque}@cabinet.example`;
    await exiger(
      "/messagerie/comptes",
      jetonA,
      "POST",
      { id, adresse, hote: dovecotTest, port: 143, utilisateur: capa.login, mot_de_passe: MOT_IMAP_TEST, tls: false },
      `compte nominatif ${etiquette}`,
    );
    return { id, adresse };
  };

  const idsNettoyage = [];
  try {
    // ==========================================================================================
    // Boîte partagée (sans titulaire) : aucune invitation chez personne
    // ==========================================================================================
    // Le secret chiffré d'un compte nominatif jetable sert à créer la boîte partagée (même boîte
    // « capa ») ; le compte jetable est retiré aussitôt, avant que le moteur ne l'ait relevé.
    const jetable = await creerCompteNominatif("jetable");
    const secretChiffre = await sqlServeur(`SELECT secret_chiffre FROM comptes_mail WHERE id = '${jetable.id}'`);
    const idPartage = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref, hote, port, utilisateur, tls, secret_chiffre)
       VALUES ('${idPartage}', '${cabinet}', 'partage', NULL, 'inv-j11.partage.${marque}@cabinet.example', 'chiffre',
               '${dovecotTest}', 143, '${capa.login}', FALSE, '${secretChiffre}')`,
    );
    idsNettoyage.push(idPartage);
    // Un seul envoi, donc une seule transaction : le verrou de la ligne du compte retient l'insertion d'un message
    // par le moteur (clé étrangère) jusqu'à la suppression. Sans lui, un moteur qui relevait le compte jetable
    // avant ce retrait (passe 8 de la série du 22/10) laissait des messages et faisait échouer la suppression.
    await sqlServeur(
      `SELECT 1 FROM comptes_mail WHERE id = '${jetable.id}' FOR UPDATE; DELETE FROM messages WHERE compte_id = '${jetable.id}'; DELETE FROM comptes_mail WHERE id = '${jetable.id}'`,
    );

    const uidPartage = `partage-${marque}@example.com`;
    const adresseCompteA = `inv-j11.a.${marque}@cabinet.example`;
    const idMessagePartage = deposer({
      etiquette: "partage",
      uid: uidPartage,
      debut: "DTSTART;TZID=Europe/Paris:20261006T090000",
      fin: "DTEND;TZID=Europe/Paris:20261006T100000",
      objet: `Audience partagee ${marque}`,
      participant: adresseCompteA,
    });
    await attendreMessageRecu(idPartage, idMessagePartage);
    const titulaireMessage = await sqlServeur(
      `SELECT COALESCE(titulaire_id::text, 'aucun') FROM messages WHERE compte_id = '${idPartage}' AND message_id = '${idMessagePartage}'`,
    );
    verifier("le message de la boîte partagée n'a pas de titulaire", titulaireMessage === "aucun");
    await sleep(3000);
    const aucune = () => ligneInvitation(uidPartage);
    verifier("boîte partagée : aucune invitation créée", (await aucune()) === null);
    ok("boîte partagée : message relevé, aucune invitation chez personne");

    // Essai négatif : la même invitation, relevée par la boîte nominative de A, est créée.
    const compteA = await creerCompteNominatif("a");
    idsNettoyage.push(compteA.id);
    verifier("adresse de la boîte nominative de A", compteA.adresse === adresseCompteA);
    const lignePartagee = await attendreLigne(uidPartage);
    essaiNegatif("boîte partagée sans invitation", "la même invitation reçue par une boîte nominative", () =>
      lignePartagee === null,
    );
    verifier("l'invitation vient de la boîte nominative, non de la boîte partagée", lignePartagee.compte === compteA.id);
    const titulaireLigne = await sqlServeur(`SELECT titulaire_id FROM invitations_agenda WHERE uid_ical = '${uidPartage}'`);
    verifier("l'invitation appartient au titulaire A", titulaireLigne === idA);
    ok("boîte nominative : la même invitation est créée chez son titulaire (essai négatif de la boîte partagée)");

    // ==========================================================================================
    // Demande, visible du seul titulaire
    // ==========================================================================================
    const uid = `principale-${marque}@example.com`;
    const idMessage0 = deposer({
      etiquette: "m0",
      uid,
      sequence: 0,
      debut: "DTSTART;TZID=Europe/Paris:20261006T090000",
      fin: "DTEND;TZID=Europe/Paris:20261006T100000",
      objet: `Audience ${marque}`,
      participant: adresseCompteA,
    });
    const demande = await attendreLigne(uid);
    verifier("demande : effet « demande », SEQUENCE 0", demande.effet === "demande" && demande.sequence === 0);
    verifier("demande : heure civile et fuseau conservés", demande.debut === "2026-10-06T09:00:00" && demande.fuseau === "Europe/Paris");
    verifier("demande : instant UTC (été, UTC+2)", demande.debutUtc === "2026-10-06T07:00:00.000Z" && demande.finUtc === "2026-10-06T08:00:00.000Z");
    verifier("demande : lien avec le message", demande.messageId === idMessage0);

    const visibleChez = async (jeton) => (await listeApi(jeton)).some((i) => i.uid_ical === uid);
    const visibleChezA = await visibleChez(jetonA);
    const visibleChezB = await visibleChez(jetonB);
    verifier("A voit l'invitation par l'API", visibleChezA);
    verifier("B ne voit pas l'invitation par l'API", !visibleChezB);
    essaiNegatif("invitation absente chez B", "la même vérification appliquée à A, titulaire", () => !visibleChezA);
    verifier("la ligne de A est à A", (await sqlServeur(`SELECT titulaire_id FROM invitations_agenda WHERE uid_ical = '${uid}'`)) === idA);

    // Flux de synchronisation : la requête réelle du flux, exécutée pour A puis pour B.
    const yaml = readFileSync(join(racineInstance(), "instance/powersync/sync-config.yaml"), "utf8");
    const bloc = /^ {2}invitations_titulaire:\s*\n([\s\S]*?)(?=^ {2}[a-z_]+:|(?![\s\S]))/m.exec(yaml)?.[1] ?? "";
    const requeteFlux = /query:\s*\|\s*\n([\s\S]*)/.exec(bloc)?.[1]?.trim().replace(/\s+/g, " ");
    if (!requeteFlux) fail("requête du flux invitations_titulaire introuvable");
    const lignesDuFlux = async (utilisateur) =>
      entier(
        `SELECT COUNT(*) FROM (${requeteFlux
          .replaceAll("auth.user_id()", `'${utilisateur}'`)
          .replaceAll("auth.parameter('cabinet_id')", `'${cabinet}'`)}) flux WHERE uid_ical = '${uid}'`,
      );
    const fluxA = await lignesDuFlux(idA);
    const fluxB = await lignesDuFlux(idB);
    verifier("flux de synchronisation : la ligne est envoyée à A", fluxA === 1);
    verifier("flux de synchronisation : rien pour B", fluxB === 0);
    essaiNegatif("flux sans ligne pour B", "la même vérification appliquée à A", () => fluxA === 0);
    ok("demande reçue : ligne chez A (API, base, flux), absente chez B (API, flux) ; UTC+2 en été");

    // ==========================================================================================
    // Mise à jour (SEQUENCE), SEQUENCE ancienne ignorée, annulation
    // ==========================================================================================
    const idMessage1 = deposer({
      etiquette: "m1",
      uid,
      sequence: 1,
      debut: "DTSTART;TZID=Europe/Paris:20261006T110000",
      fin: "DTEND;TZID=Europe/Paris:20261006T120000",
      objet: `Audience reportee ${marque}`,
      participant: adresseCompteA,
    });
    const maj = await attendreLigne(uid, (l) => l.sequence === 1);
    verifier("mise à jour : effet, heure et instant UTC", maj.effet === "mise_a_jour" && maj.debut === "2026-10-06T11:00:00" && maj.debutUtc === "2026-10-06T09:00:00.000Z");
    verifier("mise à jour : objet et message reflétés", maj.objet === `Audience reportee ${marque}` && maj.messageId === idMessage1);
    verifier("mise à jour : une seule ligne", (await entier(`SELECT COUNT(*) FROM invitations_agenda WHERE uid_ical = '${uid}'`)) === 1);

    // SEQUENCE ancienne (0) arrivée après : ignorée. On attend que le moteur l'ait relevée.
    const idAncien = deposer({
      etiquette: "ancien",
      uid,
      sequence: 0,
      debut: "DTSTART;TZID=Europe/Paris:20261006T150000",
      objet: `Ancienne version ${marque}`,
      participant: adresseCompteA,
    });
    await attendreMessageRecu(compteA.id, idAncien);
    await sleep(2000);
    const apresAncien = await ligneInvitation(uid);
    const inchangee = (avant, apres) => JSON.stringify(avant) === JSON.stringify(apres);
    verifier("SEQUENCE ancienne ignorée : la ligne n'a pas bougé", inchangee(maj, apresAncien));
    // Essai négatif : une SEQUENCE plus récente, elle, change la ligne (la vérification le voit).
    const idRecente = deposer({
      etiquette: "m2",
      uid,
      sequence: 2,
      debut: "DTSTART;TZID=Europe/Paris:20261006T140000",
      fin: "DTEND;TZID=Europe/Paris:20261006T150000",
      objet: `Audience maintenue ${marque}`,
      participant: adresseCompteA,
    });
    const apresRecente = await attendreLigne(uid, (l) => l.sequence === 2);
    essaiNegatif("SEQUENCE ancienne ignorée", "une SEQUENCE plus récente", () => inchangee(maj, apresRecente));
    verifier("SEQUENCE 2 reflétée", apresRecente.debut === "2026-10-06T14:00:00" && apresRecente.messageId === idRecente);
    // Rejeu : le moteur revoit un message déjà traité (ligne du message retirée de la base, puis
    // un courrier quelconque réveille la relève) ; l'invitation ne bouge pas.
    await sqlServeur(`DELETE FROM messages WHERE compte_id = '${compteA.id}' AND message_id = '${idRecente}'`);
    // Dovecot (QRESYNC) ne renverrait rien de ce que le curseur a déjà vu : le curseur repart de zéro.
    await sqlServeur(`DELETE FROM releve_curseurs WHERE compte_id = '${compteA.id}'`);
    imap({
      boite: capa,
      action: "ajouter",
      brut: [
        `From: Confrere Fictif <confrere@example.com>`,
        `To: ${adresseCompteA}`,
        `Subject: Note sans calendrier ${marque}`,
        `Message-ID: <note-${marque}@example.com>`,
        "",
        "Corps fictif.",
        "",
      ].join(CRLF),
    });
    await attendreMessageRecu(compteA.id, idRecente);
    await attendreMessageRecu(compteA.id, `<note-${marque}@example.com>`);
    const apresRejeu = await ligneInvitation(uid);
    verifier("rejeu d'un message déjà vu : aucune révision de plus", inchangee(apresRecente, apresRejeu));
    essaiNegatif("rejeu sans effet", "l'état avant la SEQUENCE 2", () => inchangee(maj, apresRejeu));
    ok("mise à jour SEQUENCE 1 puis 2 reflétées, SEQUENCE 0 ignorée, rejeu sans effet (essai négatif : SEQUENCE récente appliquée)");

    // Annulation (METHOD:CANCEL) : la ligne reste, marquée annulée.
    const uidAnnulee = `annulee-${marque}@example.com`;
    deposer({
      etiquette: "a0",
      uid: uidAnnulee,
      sequence: 0,
      debut: "DTSTART;TZID=Europe/Paris:20261007T090000",
      objet: `Rendez-vous annule ${marque}`,
      participant: adresseCompteA,
    });
    await attendreLigne(uidAnnulee);
    deposer({
      etiquette: "a1",
      uid: uidAnnulee,
      sequence: 1,
      methode: "CANCEL",
      debut: "DTSTART;TZID=Europe/Paris:20261007T090000",
      objet: `Rendez-vous annule ${marque}`,
      participant: adresseCompteA,
    });
    const annulee = await attendreLigne(uidAnnulee, (l) => l.effet === "annulation");
    verifier("annulation : la ligne reste, effet « annulation »", annulee.sequence === 1);
    verifier("annulation : la ligne est encore listée chez A", (await listeApi(jetonA)).some((i) => i.uid_ical === uidAnnulee && i.effet === "annulation"));
    verifier("annulation : toujours une seule ligne", (await entier(`SELECT COUNT(*) FROM invitations_agenda WHERE uid_ical = '${uidAnnulee}'`)) === 1);
    essaiNegatif("annulation reflétée", "l'invitation maintenue, jamais annulée", () => apresRecente.effet === "annulation");
    const idAnnulee = (await listeApi(jetonA)).find((i) => i.uid_ical === uidAnnulee).id;
    const refus409 = await requete(`/messagerie/invitations/${idAnnulee}/reponse`, jetonA, "POST", { reponse: "accepter" });
    verifier("réponse à une invitation annulée : 409", refus409.statut === 409);
    verifier("réponse à une invitation annulée : message en français", /annulée/.test(refus409.json?.message ?? ""));
    ok("annulation : ligne conservée et marquée, réponse refusée (409, message en français)");

    // ==========================================================================================
    // Réponses accepter / refuser / peut-être, reçues par l'organisateur
    // ==========================================================================================
    const uidReponse = `reponse-${marque}@example.com`;
    const objetReponse = `Reunion ${marque}`;
    const idMessageReponse = deposer({
      etiquette: "r0",
      uid: uidReponse,
      debut: "DTSTART;TZID=America/New_York:20261006T140000",
      fin: "DTEND;TZID=America/New_York:20261006T150000",
      objet: objetReponse,
      participant: adresseCompteA,
    });
    const aRepondre = await attendreLigne(uidReponse);
    const idReponse = (await listeApi(jetonA)).find((i) => i.uid_ical === uidReponse).id;
    const uriReponse = `/messagerie/invitations/${idReponse}/reponse`;
    verifier("fuseau étranger : New York conservé, instant UTC+4 en octobre", aRepondre.fuseau === "America/New_York" && aRepondre.debutUtc === "2026-10-06T18:00:00.000Z");

    verifier("B ne peut pas répondre à l'invitation de A (404)", (await requete(uriReponse, jetonB, "POST", { reponse: "accepter" })).statut === 404);
    verifier("réponse inconnue refusée (400)", (await requete(uriReponse, jetonA, "POST", { reponse: "oui" })).statut === 400);
    const recuesAvant = imap({ boite: demo, action: "lister", cible: `In-Reply-To=${idMessageReponse}` });
    verifier("aucune réponse avant que le titulaire ne réponde", recuesAvant.length === 0);

    const lireReponses = (dossier = "INBOX") =>
      imap({ boite: demo, action: "lister", dossier, cible: `In-Reply-To=${idMessageReponse}` });
    const partstatDe = (message) => {
      const partie = message.parties.find((p) => p.type === "text/calendar");
      return partie ? (/PARTSTAT=([A-Z-]+)/.exec(partie.texte)?.[1] ?? "") : "";
    };
    const attendreReponses = (attendu, dossier = "INBOX") =>
      attendre(
        `${attendu} réponse(s) reçue(s) dans ${dossier}`,
        async () => {
          const lues = lireReponses(dossier);
          return lues.length === attendu ? lues : null;
        },
        30_000,
      );

    const attendreReponsesDans = (boiteLue, attendu, dossier = "INBOX") =>
      attendre(
        `${attendu} réponse(s) dans ${dossier} de ${boiteLue.login}`,
        async () => {
          const lues = imap({ boite: boiteLue, action: "lister", dossier, cible: `In-Reply-To=${idMessageReponse}` });
          return lues.length === attendu ? lues : null;
        },
        30_000,
      );

    const rAccepter = await requete(uriReponse, jetonA, "POST", { reponse: "accepter" });
    const accepte = rAccepter.json;
    essaiNegatif("réponse refusée sur invitation annulée (409)", "une invitation maintenue", () => rAccepter.statut === 409);
    verifier("accepter : réponse enregistrée, copie dans Envoyés confirmée", rAccepter.statut === 200 && accepte.reponse === "accepte" && accepte.envoi_etat === "copie_envoyes_confirmee");
    let recues = await attendreReponses(1);
    verifier("accepter : l'organisateur reçoit PARTSTAT=ACCEPTED", partstatDe(recues[0]) === "ACCEPTED");
    const partieCal = recues[0].parties.find((p) => p.type === "text/calendar");
    verifier("réponse : méthode REPLY dans l'en-tête de la partie et dans le calendrier", partieCal.methode?.toUpperCase() === "REPLY" && /METHOD:REPLY/.test(partieCal.texte));
    verifier("réponse : partie alternative, pas une pièce jointe", partieCal.disposition === null);
    verifier("réponse : même UID, même fuseau", partieCal.texte.includes(`UID:${uidReponse}`) && partieCal.texte.includes("TZID=America/New_York"));
    verifier("réponse : le participant est la boîte de réception", partieCal.texte.includes(`mailto:${adresseCompteA}`));
    verifier("réponse : adressée à l'organisateur, en réponse au message d'invitation", recues[0].a.includes(organisateur) && recues[0].en_reponse_a === idMessageReponse);
    verifier("réponse : sans copie cachée visible", recues[0].bcc === false);
    verifier("réponse : objet en français", /^Accept/.test(recues[0].sujet) && recues[0].sujet.includes(objetReponse));
    // Identité d'envoi (critère (i)) : la réponse part de l'adresse invitée (ATTENDEE), la boîte qui a
    // reçu l'invitation ; elle ne part jamais de l'adresse du cabinet, et la copie va dans les
    // envoyés de cette boîte (et non dans ceux de la boîte de classement du cabinet).
    verifier("réponse : From = adresse invitée (ATTENDEE)", recues[0].de.includes(adresseCompteA) && partieCal.texte.includes(`mailto:${adresseCompteA}`));
    essaiNegatif("From = adresse invitée", "le From de l'ancien comportement (adresse du cabinet)", () => "Cabinet <demo@cabinet.example>".includes(adresseCompteA));
    verifier("réponse : aucun Reply-To (le compte n'en définit pas)", recues[0].reply_to === null);
    const copiesCompte = await attendreReponsesDans(capa, 1, "Sent");
    verifier("copie « Envoyés » de la réponse, dans les envoyés de la boîte invitée", partstatDe(copiesCompte[0]) === "ACCEPTED");
    essaiNegatif("copie dans les envoyés de la boîte invitée", "les envoyés de la boîte de classement du cabinet", () => lireReponses("Sent").length === 1);
    verifier("aucune copie dans les envoyés de la boîte de classement du cabinet", lireReponses("Sent").length === 0);

    const refuse = await exiger(uriReponse, jetonA, "POST", { reponse: "refuser" }, "refuser");
    verifier("refuser : la réponse remplace la première", refuse.reponse === "refuse" && refuse.envoi_etat === "copie_envoyes_confirmee");
    recues = await attendreReponses(2);
    verifier("refuser : l'organisateur reçoit PARTSTAT=DECLINED", partstatDe(recues[1]) === "DECLINED");
    essaiNegatif("PARTSTAT=ACCEPTED pour « refuser »", "la seconde réponse", () => partstatDe(recues[1]) === "ACCEPTED");

    const peutEtre = await exiger(uriReponse, jetonA, "POST", { reponse: "peut_etre" }, "peut-être");
    verifier("peut-être : la réponse remplace la précédente", peutEtre.reponse === "peut_etre");
    recues = await attendreReponses(3);
    verifier("peut-être : l'organisateur reçoit PARTSTAT=TENTATIVE", partstatDe(recues[2]) === "TENTATIVE");
    const identifiants = new Set(recues.map((m) => m.message_id));
    verifier("un Message-ID propre à chaque réponse", identifiants.size === 3);

    // La même réponse rejouée n'en renvoie pas de seconde.
    const rejeu = await exiger(uriReponse, jetonA, "POST", { reponse: "peut_etre" }, "rejeu peut-être");
    verifier("rejeu : même réponse, même envoi", rejeu.reponse === "peut_etre" && rejeu.envoi_etat === "copie_envoyes_confirmee");
    await sleep(1500);
    verifier("rejeu : toujours trois réponses reçues, aucune de plus", lireReponses().length === 3);
    const enFile = () => entier(`SELECT COUNT(*) FROM file_envoi WHERE en_reponse_a = '${idMessageReponse}'`);
    verifier("rejeu : trois envois en file, pas quatre", (await enFile()) === 3);
    await exiger(uriReponse, jetonA, "POST", { reponse: "refuser" }, "retour à refuser");
    recues = await attendreReponses(4);
    verifier("réponse différente : une quatrième réponse part", recues.length === 4 && partstatDe(recues[3]) === "DECLINED");
    essaiNegatif("rejeu sans réponse de plus", "après une réponse différente", () => lireReponses().length === 3);
    const enFileApres = await enFile();
    essaiNegatif("rejeu sans envoi de plus en file", "après une réponse différente", () => enFileApres === 3);
    verifier("l'invitation garde la dernière réponse, avec sa date", (await ligneInvitation(uidReponse)).reponse === "refuse" && (await entier(`SELECT COUNT(*) FROM invitations_agenda WHERE uid_ical = '${uidReponse}' AND repondu_le IS NOT NULL`)) === 1);
    ok("réponses accepter, refuser, peut-être reçues avec le bon PARTSTAT ; même réponse rejouée : aucune de plus");

    // Une nouvelle version remet la réponse à vide : il faut répondre à celle-ci.
    const avantNouvelleVersion = await ligneInvitation(uidReponse);
    deposer({
      etiquette: "r1",
      uid: uidReponse,
      sequence: 1,
      debut: "DTSTART;TZID=America/New_York:20261006T160000",
      objet: objetReponse,
      participant: adresseCompteA,
    });
    const reinit = await attendreLigne(uidReponse, (l) => l.sequence === 1);
    verifier("nouvelle version : la réponse est remise à vide", reinit.reponse === "");
    essaiNegatif("réponse remise à vide", "avant la nouvelle version", () => avantNouvelleVersion.reponse === "");

    // ==========================================================================================
    // Fuseaux : Europe/Paris été et hiver, passage à l'heure d'hiver, étranger, UTC, flottant
    // ==========================================================================================
    const cas = [
      ["ete", "DTSTART;TZID=Europe/Paris:20260708T090000", "Europe/Paris", "2026-07-08T09:00:00", "2026-07-08T07:00:00.000Z"],
      ["hiver", "DTSTART;TZID=Europe/Paris:20261208T090000", "Europe/Paris", "2026-12-08T09:00:00", "2026-12-08T08:00:00.000Z"],
      ["avant", "DTSTART;TZID=Europe/Paris:20261025T013000", "Europe/Paris", "2026-10-25T01:30:00", "2026-10-24T23:30:00.000Z"],
      ["ambigu", "DTSTART;TZID=Europe/Paris:20261025T023000", "Europe/Paris", "2026-10-25T02:30:00", "2026-10-25T00:30:00.000Z"],
      ["apres", "DTSTART;TZID=Europe/Paris:20261025T033000", "Europe/Paris", "2026-10-25T03:30:00", "2026-10-25T02:30:00.000Z"],
      ["ny", "DTSTART;TZID=America/New_York:20261208T140000", "America/New_York", "2026-12-08T14:00:00", "2026-12-08T19:00:00.000Z"],
      ["tokyo", "DTSTART;TZID=Asia/Tokyo:20261006T090000", "Asia/Tokyo", "2026-10-06T09:00:00", "2026-10-06T00:00:00.000Z"],
      ["utc", "DTSTART:20261006T070000Z", "UTC", "2026-10-06T07:00:00", "2026-10-06T07:00:00.000Z"],
      ["flottant", "DTSTART:20261006T090000", "flottant", "2026-10-06T09:00:00", ""],
      ["journee", "DTSTART;VALUE=DATE:20261006", "flottant", "2026-10-06", ""],
      ["windows", "DTSTART;TZID=Romance Standard Time:20261006T090000", "Romance Standard Time", "2026-10-06T09:00:00", "2026-10-06T07:00:00.000Z"],
      ["inconnu", "DTSTART;TZID=Fuseau Fictif Inconnu:20261006T090000", "Fuseau Fictif Inconnu", "2026-10-06T09:00:00", ""],
    ];
    for (const [etiquette, debut] of cas) {
      deposer({
        etiquette: `f-${etiquette}`,
        uid: `fuseau-${etiquette}-${marque}@example.com`,
        debut,
        objet: `Fuseau ${etiquette} ${marque}`,
        participant: adresseCompteA,
      });
    }
    for (const [etiquette, , fuseau, local, utc] of cas) {
      const ligne = await attendreLigne(`fuseau-${etiquette}-${marque}@example.com`);
      verifier(`fuseau ${etiquette} : fuseau annoncé conservé (${fuseau})`, ligne.fuseau === fuseau);
      verifier(`fuseau ${etiquette} : heure civile ${local}`, ligne.debut === local);
      verifier(`fuseau ${etiquette} : instant UTC « ${utc || "aucun"} »`, ligne.debutUtc === utc);
    }
    const ambigu = await ligneInvitation(`fuseau-ambigu-${marque}@example.com`);
    const hiver = await ligneInvitation(`fuseau-hiver-${marque}@example.com`);
    verifier("25 octobre 02:30 (ambigu) : première occurrence, heure d'été, 00:30 UTC", ambigu.debutUtc === "2026-10-25T00:30:00.000Z");
    essaiNegatif("première occurrence de 02:30", "la seconde occurrence (heure d'hiver, 01:30 UTC)", () => ambigu.debutUtc === "2026-10-25T01:30:00.000Z");
    essaiNegatif("décalage d'hiver une heure", "le décalage d'été deux heures", () => hiver.debutUtc === "2026-12-08T07:00:00.000Z");
    const ete = await ligneInvitation(`fuseau-ete-${marque}@example.com`);
    const decalageHeures = (l) => (Date.parse(`${l.debut}Z`) - Date.parse(l.debutUtc)) / 3_600_000;
    verifier("Europe/Paris : UTC+2 en été, UTC+1 en hiver", decalageHeures(ete) === 2 && decalageHeures(hiver) === 1);
    essaiNegatif("UTC+2 en été", "la ligne d'hiver", () => decalageHeures(hiver) === 2);
    ok("fuseaux : Europe/Paris été (UTC+2) et hiver (UTC+1), 25 octobre 02:30 = première occurrence, New York, Tokyo, UTC, flottant, journée entière, nom Windows, fuseau inconnu sans instant inventé");

    // ==========================================================================================
    // Origine : seul l'organisateur enregistré met à jour ou annule ; l'ORGANIZER ne change pas
    // ==========================================================================================
    const uidOrigine = `origine-${marque}@example.com`;
    const intrus = "intrus@example.com";
    const secretariat = "secretariat@cabinet.example";
    const verifiee = async (u) => (await sqlServeur(`SELECT verifiee::text FROM invitations_agenda WHERE uid_ical = '${u}'`)) === "true";
    const apresMessage = async (etiquette, parametres) => {
      const id = deposer({ etiquette, participant: adresseCompteA, debut: "DTSTART;TZID=Europe/Paris:20261008T090000", ...parametres });
      await attendreMessageRecu(compteA.id, id);
      return id;
    };

    // Création par un expéditeur qui n'est pas l'ORGANIZER annoncé : enregistrée, « non vérifiée ».
    await apresMessage("o0", { uid: uidOrigine, sequence: 0, objet: `Audience origine ${marque}`, de: secretariat });
    const creeeParTiers = await attendreLigne(uidOrigine);
    verifier("création par un tiers : enregistrée", creeeParTiers.sequence === 0 && creeeParTiers.effet === "demande");
    verifier("création par un tiers : marquée non vérifiée", !(await verifiee(uidOrigine)));
    verifier("création par un tiers : l'API expose verifiee=false", (await listeApi(jetonA)).find((i) => i.uid_ical === uidOrigine)?.verifiee === false);
    // Essai négatif : la même création par l'organisateur est vérifiée.
    const uidDirecte = `origine-directe-${marque}@example.com`;
    await apresMessage("o0b", { uid: uidDirecte, sequence: 0, objet: `Audience directe ${marque}` });
    const directeVerifiee = await verifiee(uidDirecte);
    verifier("création par l'organisateur : vérifiée", directeVerifiee);
    essaiNegatif("création non vérifiée", "la même création envoyée par l'organisateur", () => !directeVerifiee);

    // Mise à jour et annulation (SEQUENCE supérieure) par un tiers : aucun effet.
    await apresMessage("o1", { uid: uidOrigine, sequence: 1, objet: `Audience deplacee par un intrus ${marque}`, de: intrus, organisateurIcal: organisateur });
    await apresMessage("o2", { uid: uidOrigine, sequence: 2, methode: "CANCEL", objet: `Audience origine ${marque}`, de: intrus });
    const apresTiers = await ligneInvitation(uidOrigine);
    const miseAJourAppliquee = (l) => l.sequence >= 1 || l.objet.includes("intrus");
    const annulationAppliquee = (l) => l.effet === "annulation";
    verifier("mise à jour par un tiers : sans effet", !miseAJourAppliquee(apresTiers));
    verifier("annulation par un tiers : sans effet", !annulationAppliquee(apresTiers));
    verifier("tiers : la ligne est strictement inchangée", inchangee(creeeParTiers, apresTiers));

    // ORGANIZER modifié dans une mise à jour envoyée par l'organisateur enregistré : refusé.
    await apresMessage("o3", { uid: uidOrigine, sequence: 3, objet: `Audience reprise ${marque}`, organisateurIcal: intrus });
    const apresChangement = await ligneInvitation(uidOrigine);
    const organisateurEnBase = () => sqlServeur(`SELECT organisateur FROM invitations_agenda WHERE uid_ical = '${uidOrigine}'`);
    verifier("ORGANIZER modifié : mise à jour refusée", inchangee(creeeParTiers, apresChangement));
    verifier("ORGANIZER modifié : l'organisateur enregistré ne change pas", (await organisateurEnBase()) === organisateur);

    // Essais négatifs : les mêmes mises à jour et annulation, envoyées par l'organisateur enregistré
    // (ici via l'en-tête Sender, l'expéditeur réel étant un secrétariat), s'appliquent.
    await apresMessage("o4", { uid: uidOrigine, sequence: 4, objet: `Audience deplacee ${marque}`, de: secretariat, sender: organisateur });
    const apresOrganisateur = await attendreLigne(uidOrigine, (l) => l.sequence === 4);
    verifier("organisateur (en-tête Sender) : mise à jour appliquée", apresOrganisateur.effet === "mise_a_jour" && apresOrganisateur.objet === `Audience deplacee ${marque}`);
    verifier("organisateur : la ligne devient vérifiée", await verifiee(uidOrigine));
    essaiNegatif("mise à jour sans effet", "la mise à jour envoyée par l'organisateur", () => !miseAJourAppliquee(apresOrganisateur));
    await apresMessage("o5", { uid: uidOrigine, sequence: 5, methode: "CANCEL", objet: `Audience origine ${marque}` });
    const annuleeParOrganisateur = await attendreLigne(uidOrigine, (l) => l.effet === "annulation");
    essaiNegatif("annulation sans effet", "l'annulation envoyée par l'organisateur", () => !annulationAppliquee(annuleeParOrganisateur));
    ok("origine : création par un tiers non vérifiée ; mise à jour, annulation et ORGANIZER modifié par un tiers sans effet (essais négatifs : l'organisateur, lui, est appliqué)");

    // ==========================================================================================
    // Un autre collaborateur ne voit rien (bilan)
    // ==========================================================================================
    const chezA = (await listeApi(jetonA)).filter((i) => i.uid_ical.endsWith(`${marque}@example.com`));
    const chezB = (await listeApi(jetonB)).filter((i) => i.uid_ical.endsWith(`${marque}@example.com`));
    verifier("A voit toutes ses invitations", chezA.length >= 4 + cas.length);
    verifier("B n'en voit aucune", chezB.length === 0);
    essaiNegatif("B ne voit aucune invitation", "A, titulaire", () => chezA.length === 0);
    verifier("aucune invitation n'est rattachée à la boîte partagée", (await entier(`SELECT COUNT(*) FROM invitations_agenda WHERE compte_id = '${idPartage}'`)) === 0);
    verifier("la boîte partagée a bien relevé des messages", (await entier(`SELECT COUNT(*) FROM messages WHERE compte_id = '${idPartage}'`)) >= 5);
    verifier("le flux ne renvoie rien à B pour toutes les invitations", (await entier(`SELECT COUNT(*) FROM (${requeteFlux.replaceAll("auth.user_id()", `'${idB}'`).replaceAll("auth.parameter('cabinet_id')", `'${cabinet}'`)}) flux WHERE uid_ical LIKE '%${marque}@example.com'`)) === 0);

    // ==========================================================================================
    // Coupure : la réponse reste dans la file, puis part une seule fois
    // ==========================================================================================
    const uidPanne = `panne-${marque}@example.com`;
    const idMessagePanne = deposer({
      etiquette: "panne",
      uid: uidPanne,
      debut: "DTSTART;TZID=Europe/Paris:20261110T090000",
      objet: `Reunion panne ${marque}`,
      participant: adresseCompteA,
    });
    await attendreLigne(uidPanne);
    const idPanne = (await listeApi(jetonA)).find((i) => i.uid_ical === uidPanne).id;
    const uriPanne = `/messagerie/invitations/${idPanne}/reponse`;
    const greenmailInstance = conteneur("legalos-instance-greenmail")[0];
    if (!greenmailInstance) fail("GreenMail de l'instance absent");
    spawnSync("docker", ["stop", greenmailInstance], { encoding: "utf8" });
    let pendant;
    try {
      pendant = await exiger(uriPanne, jetonA, "POST", { reponse: "accepter" }, "réponse pendant la coupure");
    } finally {
      spawnSync("docker", ["start", greenmailInstance], { encoding: "utf8" });
    }
    verifier("coupure : la réponse est enregistrée mais pas confirmée", pendant.reponse === "accepte" && pendant.envoi_etat !== "copie_envoyes_confirmee");
    await attendre(
      "retour du GreenMail de l'instance",
      async () => {
        try {
          imap({ boite: demo, action: "lister", cible: "Message-ID=<absent@example.com>" });
          return true;
        } catch {
          return null;
        }
      },
      90_000,
    );
    const recuesPendantCoupure = imap({ boite: demo, action: "lister", cible: `In-Reply-To=${idMessagePanne}` }).length;
    verifier("coupure : l'organisateur n'a encore rien reçu", recuesPendantCoupure === 0);
    const apresCoupure = await exiger(uriPanne, jetonA, "POST", { reponse: "accepter" }, "reprise après la coupure");
    verifier("reprise : la même réponse rejouée termine l'envoi", apresCoupure.envoi_etat === "copie_envoyes_confirmee");
    await sleep(1500);
    const lesPannes = () => imap({ boite: demo, action: "lister", cible: `In-Reply-To=${idMessagePanne}` });
    verifier("reprise : une seule réponse reçue par l'organisateur", lesPannes().length === 1 && partstatDe(lesPannes()[0]) === "ACCEPTED");
    await exiger(uriPanne, jetonA, "POST", { reponse: "accepter" }, "second rejeu");
    await sleep(1500);
    verifier("second rejeu : toujours une seule réponse", lesPannes().length === 1);
    verifier("une seule ligne de file pour cette réponse", (await entier(`SELECT COUNT(*) FROM file_envoi WHERE en_reponse_a = '${idMessagePanne}'`)) === 1);
    essaiNegatif("une seule réponse reçue", "avant la reprise (rien reçu pendant la coupure)", () => recuesPendantCoupure === 1);
    ok("coupure du serveur de messagerie : réponse gardée dans la file, envoyée une seule fois à la reprise");

    console.log("j11-invitation: OK");
  } finally {
    // Les comptes de la recette ne doivent plus être relevés. Les invitations (identifiants à
    // marque unique) sont retirées avec leurs messages.
    await sqlServeur(`DELETE FROM invitations_agenda WHERE uid_ical LIKE '%${marque}@example.com'`).catch(() => {});
    await sqlServeur(`DELETE FROM messages WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'inv-j11.%.${marque}@cabinet.example')`).catch(() => {});
    await sqlServeur(`DELETE FROM file_envoi_pieces WHERE envoi_id IN (SELECT id FROM file_envoi WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'inv-j11.%.${marque}@cabinet.example'))`).catch(() => {});
    await sqlServeur(`DELETE FROM file_envoi WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'inv-j11.%.${marque}@cabinet.example')`).catch(() => {});
    await sqlServeur(`DELETE FROM comptes_mail WHERE adresse LIKE 'inv-j11.%.${marque}@cabinet.example'`).catch(() => {});
    try {
      imap({ boite: capa, action: "purger" });
    } catch {
      // Boîte de test déjà arrêtée : rien à nettoyer.
    }
  }
}

main().catch((err) => {
  if (!process.exitCode) {
    console.error(`j11-invitation: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
});
