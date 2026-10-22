#!/usr/bin/env node
/**
 * J11 (iii) et (iv) — actions sur les messages d'une boîte et recherche serveur, contre
 * l'instance, le Dovecot et le GreenMail d'imap-test (API et flux PowerSync, sans app).
 *
 * (iii) Marquer lu / non lu, archiver, supprimer (déplacement vers la Corbeille, jamais d'EXPUNGE
 *       d'un message sans copie confirmée ailleurs) et déplacer, pour une boîte nominative (Dovecot,
 *       QRESYNC) et une boîte partagée (GreenMail), par la file idempotente `actions_messages` :
 *       - l'état IMAP est vérifié par un client indépendant (python imaplib) ;
 *       - lu et dossier descendent vers le poste par le flux de synchronisation ;
 *       - rejeu (même clé), clé réutilisée (409), appels simultanés : un seul effet ;
 *       - reprise : serveur IMAP coupé (docker stop), API coupée (bail perdu puis docker restart),
 *         identifiants refusés, UID réattribué, déplacement fait par un autre client avant la reprise ;
 *       - droits : un tiers reçoit 404 (jamais d'effet sur IMAP, aucune action créée), un membre
 *         retiré aussi, un message d'un dossier restreint non autorisé aussi.
 * (iv) Recherche sur objet, expéditeur, destinataires et corps, dans les limites des droits ; saisies
 *       hostiles (vide, jokers, SQL, très longue) ; mesure sur 50 000 messages.
 *
 * Chaque vérification a son essai négatif : la même vérification, appliquée à la situation
 * inverse (autre collaborateur, message d'une boîte non lisible, clé différente…), doit donner
 * l'inverse. Un essai négatif qui ne bascule pas fait échouer la recette.
 *
 * Aucun contenu réel : adresses et textes fictifs. Aucun contenu de mail dans les sorties.
 * Prérequis : instance démarrée, `docker compose -f instance/imap-test/docker-compose.yml up -d --wait`,
 * `python`. Usage : node tests/recette/j11-boites-actions.mjs
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessToken, demoAccessToken, demoEmail } from "./lib/demo-auth.mjs";
import { MOT_IMAP_TEST, connecterAuReseauApi, conteneur } from "./lib/moteur-mail.mjs";
import { sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const marque = randomUUID().slice(0, 8);
/** Boîte « capa » du Dovecot d'imap-test, vue de l'hôte (QRESYNC, MOVE, UIDPLUS). */
const dovecot = { hote: "127.0.0.1", port: "1143", login: "capa", secret: MOT_IMAP_TEST };
/** Boîte « capa » du GreenMail d'imap-test, vue de l'hôte. */
const greenmail = { hote: "127.0.0.1", port: "3143", login: "capa", secret: MOT_IMAP_TEST };
const PREFIXE = "actions-j11";
const mesures = [];
const etiquettes = new Map();
const nommer = (id, nom) => {
  etiquettes.set(id, nom);
  return id;
};

function fail(message) {
  console.error(`j11-boites-actions: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function ok(message) {
  console.log(`j11-boites-actions: ${message}`);
}

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

/** Jetons d'accès (15 minutes) : renouvelés à la demande, la recette dure plus longtemps. */
const registre = new Map();
async function jetonFrais(jeton) {
  const entree = registre.get(jeton);
  if (!entree) return jeton;
  if (Date.now() - entree.depuis > 600_000) {
    entree.courant = await entree.seConnecter();
    entree.depuis = Date.now();
  }
  return entree.courant;
}
function suivre(jeton, seConnecter) {
  registre.set(jeton, { courant: jeton, depuis: Date.now(), seConnecter });
  return jeton;
}
/** Après le redémarrage de l'API, ses jetons (clé éphémère) ne valent plus. */

async function requete(chemin, jetonInitial, methode = "GET", corps) {
  const jeton = await jetonFrais(jetonInitial);
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), "content-type": "application/json" },
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
  if (r.statut < 200 || r.statut >= 300) fail(`${contexte ?? `${methode} ${chemin}`} → ${r.statut}`);
  return r.json;
}

async function attendre(contexte, lecture, delaiMs = 60_000) {
  const debut = Date.now();
  let derniereErreur = "";
  while (Date.now() - debut < delaiMs) {
    try {
      const valeur = await lecture();
      if (valeur) return valeur;
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    }
    await sleep(700);
  }
  fail(`${contexte} : délai dépassé (${delaiMs} ms)${derniereErreur ? ` — ${derniereErreur}` : ""}`);
  return null;
}

const sql = (requeteSql) => sqlServeur(requeteSql);
const entier = async (requeteSql) => Number.parseInt(await sql(requeteSql), 10);

// --------------------------------------------------------------------------------------------
// Client IMAP de contrôle (python imaplib), indépendant du moteur. Le secret passe par l'environnement.
// --------------------------------------------------------------------------------------------
const SCRIPT_IMAP = String.raw`
import imaplib, json, os, re, sys
hote, port, login, action, dossier, cible = sys.argv[1:7]
boite = imaplib.IMAP4(hote, int(port))
boite.login(login, os.environ['IMAP_SECRET'])

def dossiers():
    noms = []
    for ligne in boite.list()[1]:
        m = re.match(rb'\((.*?)\) "(.)" (.*)$', ligne)
        if not m:
            continue
        nom = m.group(3).decode('utf-8', 'replace')
        if nom.startswith('"') and nom.endswith('"'):
            nom = nom[1:-1]
        noms.append(nom)
    return noms

def citer(nom):
    return '"' + nom + '"'

def uids(nom, mid):
    typ, _ = boite.select(citer(nom), readonly=True)
    if typ != 'OK':
        return []
    typ, data = boite.uid('SEARCH', None, 'HEADER', 'Message-ID', '"' + mid + '"')
    return data[0].split() if data and data[0] else []

if action == 'ajouter':
    brut = (
        'From: ' + os.environ.get('IMAP_DE', 'expediteur.fictif@example.com') + '\r\n'
        'To: ' + os.environ.get('IMAP_A', 'capa@localhost') + '\r\n'
        'Subject: ' + os.environ['IMAP_SUJET'] + '\r\n'
        'Message-ID: ' + os.environ['IMAP_MID'] + '\r\n'
        '\r\n' + os.environ.get('IMAP_CORPS', 'Corps fictif.') + '\r\n'
    )
    typ, _ = boite.append(citer(dossier), None, None, brut.encode('utf-8'))
    assert typ == 'OK', typ
    print('{}')
elif action == 'etat':
    # Où est ce message, avec quels drapeaux : { dossier: [ "\\Seen ...", ... ] }
    sortie = {}
    for nom in dossiers():
        trouves = uids(nom, cible)
        if not trouves:
            continue
        liste = []
        for uid in trouves:
            typ, brut = boite.uid('FETCH', uid, '(FLAGS)')
            liste.append(re.sub(rb'.*FLAGS \((.*?)\).*', rb'\1', brut[0], flags=re.S).decode())
        sortie[nom] = liste
    print(json.dumps(sortie))
elif action == 'deplacer_externe':
    # Un autre client déplace le message (COPY, \Deleted, EXPUNGE) avant que l'API ne reprenne l'action.
    trouves = uids(dossier, cible)
    assert trouves, 'message absent'
    typ, _ = boite.create(citer(os.environ['IMAP_VERS']))
    boite.select(citer(dossier))
    typ, _ = boite.uid('COPY', trouves[0], citer(os.environ['IMAP_VERS']))
    assert typ == 'OK', typ
    boite.uid('STORE', trouves[0], '+FLAGS', '(\\Deleted)')
    boite.expunge()
    print('{}')
elif action == 'supprimer_dossier':
    boite.select(citer(dossier))
    typ, data = boite.search(None, 'ALL')
    for num in (data[0].split() if data and data[0] else []):
        boite.store(num, '+FLAGS', '(\\Deleted)')
    boite.expunge()
    boite.close()
    boite.delete(citer(dossier))
    print('{}')
elif action == 'purger':
    # INBOX vidée ; les dossiers créés par la recette sont supprimés (jamais Sent ni Brouillons).
    # Chaque dossier a sa connexion : un serveur de test peut couper la sienne sur DELETE.
    garde = {'INBOX', 'Sent', 'Brouillons', 'Drafts'}
    def vider(nom, supprimer):
        c = imaplib.IMAP4(hote, int(port))
        c.login(login, os.environ['IMAP_SECRET'])
        try:
            typ, _ = c.select(citer(nom))
            if typ == 'OK':
                typ, data = c.search(None, 'ALL')
                for num in (data[0].split() if data and data[0] else []):
                    c.store(num, '+FLAGS', '(\\Deleted)')
                c.expunge()
                c.close()
            if supprimer:
                c.delete(citer(nom))
            c.logout()
        except Exception:
            pass
    for nom in dossiers():
        if nom not in garde:
            vider(nom, True)
    vider('INBOX', False)
    print('{}')
try:
    boite.logout()
except Exception:
    pass
`;

function imap(boite, action, { dossier = "INBOX", cible = "", env = {} } = {}) {
  const run = spawnSync("python", ["-c", SCRIPT_IMAP, boite.hote, boite.port, boite.login, action, dossier, cible], {
    encoding: "utf8",
    env: { ...process.env, IMAP_SECRET: boite.secret, ...env },
  });
  if (run.status !== 0) throw new Error(`imap ${action} : ${(run.stderr || run.stdout).slice(-300)}`);
  try {
    return JSON.parse(run.stdout.trim().split("\n").pop() || "{}");
  } catch {
    return {};
  }
}

/** Objet encodé (RFC 2047) quand il n'est pas ASCII. */
const objetMime = (sujet) => (/^[ -~]*$/.test(sujet) ? sujet : `=?UTF-8?B?${Buffer.from(sujet, "utf8").toString("base64")}?=`);
const deposer = (boite, sujet, messageId, { dossier = "INBOX", de, a, corps } = {}) =>
  imap(boite, "ajouter", {
    dossier,
    env: { IMAP_SUJET: objetMime(sujet), IMAP_MID: messageId, ...(de ? { IMAP_DE: de } : {}), ...(a ? { IMAP_A: a } : {}), ...(corps ? { IMAP_CORPS: corps } : {}) },
  });
const etatImap = (boite, messageId) => imap(boite, "etat", { cible: messageId });
const copiesImap = (etat, dossier) => (etat[dossier] ?? []).length;
const nbCopies = (etat) => Object.values(etat).reduce((somme, liste) => somme + liste.length, 0);

// --------------------------------------------------------------------------------------------
// Flux de synchronisation PowerSync, lu comme le poste le lit (POST /sync/stream, NDJSON)
// --------------------------------------------------------------------------------------------
const FLUX_MESSAGES = ["messages_publics", "messages_restreints", "messages_a_classer", "messages_nominatifs", "messages_boites_partagees"];

async function instantane(jetonInitial) {
  const jeton = await jetonFrais(jetonInitial);
  const controle = new AbortController();
  const reponse = await fetch(`${instance}/sync/sync/stream`, {
    method: "POST",
    headers: { authorization: `Token ${jeton}`, "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({
      buckets: [],
      raw_data: true,
      client_id: `j11-boites-actions-${marque}`,
      include_checksum: true,
      streams: { include_defaults: false, subscriptions: FLUX_MESSAGES.map((stream) => ({ stream, parameters: null, override_priority: null })) },
    }),
    signal: AbortSignal.any([controle.signal, AbortSignal.timeout(60_000)]),
  });
  if (!reponse.ok) fail(`flux de synchronisation → ${reponse.status}`);
  const seaux = new Map();
  const decodeur = new TextDecoder();
  let tampon = "";
  let termine = false;
  try {
    for await (const morceau of reponse.body) {
      tampon += decodeur.decode(morceau, { stream: true });
      let fin;
      while ((fin = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        if (!ligne) continue;
        const message = JSON.parse(ligne);
        if (message.data) {
          const rangees = seaux.get(message.data.bucket) ?? new Map();
          seaux.set(message.data.bucket, rangees);
          for (const op of message.data.data ?? []) {
            if (op.op === "PUT") {
              const colonnes = typeof op.data === "string" ? JSON.parse(op.data) : (op.data ?? {});
              rangees.set(op.object_id, { type: op.object_type, colonnes });
            } else if (op.op === "REMOVE") rangees.delete(op.object_id);
            else if (op.op === "CLEAR") rangees.clear();
          }
        } else if (message.checkpoint_complete) {
          termine = true;
          controle.abort();
        }
      }
    }
  } catch (err) {
    if (!termine) throw err;
  }
  if (!termine) fail("flux de synchronisation interrompu avant le point de cohérence");
  const messages = new Map();
  for (const rangees of seaux.values()) {
    for (const [id, { type, colonnes }] of rangees) {
      if (type !== "messages") continue;
      messages.set(id, { ...(messages.get(id) ?? {}), ...colonnes });
    }
  }
  return messages;
}

/** Ligne du message dans le flux du collaborateur, quand `condition(ligne)` est vraie. */
async function fluxQuand(contexte, jeton, id, condition, delaiMs = 60_000) {
  return attendre(contexte, async () => {
    const ligne = (await instantane(jeton)).get(id);
    return ligne && condition(ligne) ? ligne : null;
  }, delaiMs);
}

const vrai = (valeur) => Number(valeur) === 1 || valeur === true;

// --------------------------------------------------------------------------------------------
// Aides
// --------------------------------------------------------------------------------------------
async function messageDuCompte(compteId, messageId) {
  const id = await sql(`SELECT id FROM messages WHERE compte_id = '${compteId}' AND message_id = '${messageId}'`);
  return id || null;
}

const ligneBase = async (id) => {
  const brut = await sql(`SELECT dossier_imap || '|' || lu::text || '|' || drapeaux_texte || '|' || uid || '|' || uid_validity FROM messages WHERE id = '${id}'`);
  if (!brut) return null;
  const [dossier, lu, drapeaux, uid, validite] = brut.split("|");
  return { dossier, lu: lu === "true", drapeaux, uid: Number(uid), validite: Number(validite) };
};

const nbActions = (id) => entier(`SELECT COUNT(*) FROM actions_messages WHERE message_ref = '${id}'`);

async function nettoyer() {
  for (let essai = 0; essai < 4; essai += 1) {
    const comptes = `SELECT id FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`;
    await sql(`DELETE FROM actions_messages WHERE compte_id IN (${comptes})`).catch(() => {});
    await sql(`DELETE FROM messages WHERE compte_id IN (${comptes})`).catch(() => {});
    await sql(`DELETE FROM moteur_connexions WHERE compte_id IN (${comptes})`).catch(() => {});
    await sql(`DELETE FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => {});
    await sql(`DELETE FROM actions_messages WHERE message_id LIKE '<${PREFIXE}-%'`).catch(() => {});
    await sql(`DELETE FROM messages WHERE message_id LIKE '<${PREFIXE}-%'`).catch(() => {});
    const reste = await sql(`SELECT COUNT(*) FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => "?");
    if (reste === "0") return;
    await sleep(1500);
  }
}

// Seau PowerSync messages_nominatifs d'un utilisateur : nombre d'opérations gardées dans le stockage.
function operationsSeau(idUtilisateur) {
  const [postgres] = conteneur("legalos-instance-postgres");
  const sortie = docker("exec", postgres, "psql", "-U", "legalos", "-d", "powersync_storage", "-At", "-c",
    `SELECT COUNT(*) FROM powersync.bucket_data WHERE bucket_name LIKE '1#messages_nominatifs|%${idUtilisateur}%'`);
  return Number(sortie);
}

// Deux compactions de suite : la première convertit, la seconde purge (journal du 17/10/2026).
function compacterPowerSync() {
  const [powersync] = conteneur("legalos-instance-powersync");
  for (let i = 0; i < 2; i += 1) docker("exec", powersync, "node", "service/lib/entry.js", "compact");
}

const MARGE_SEAU_DEMO = 2000;
let seauDemoAvant = null;
let idDemo = null;

function docker(...args) {
  const run = spawnSync("docker", args, { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`docker ${args.join(" ")} : ${(run.stderr || run.stdout).slice(-200)}`);
  return run.stdout.trim();
}

// --------------------------------------------------------------------------------------------
async function main() {
  const sain = await fetch(`${instance}/health`).catch(() => null);
  if (!sain?.ok) fail("instance injoignable");
  const dovecotTest = conteneur("legalos-imap-test-dovecot")[0];
  const greenmailTest = conteneur("legalos-imap-test-greenmail")[0];
  if (!dovecotTest || !greenmailTest) fail("serveurs d'imap-test absents : docker compose -f instance/imap-test/docker-compose.yml up -d --wait");
  connecterAuReseauApi(dovecotTest);
  connecterAuReseauApi(greenmailTest);

  await nettoyer();
  imap(dovecot, "purger");
  imap(greenmail, "purger");

  // ==========================================================================================
  // Trois collaborateurs : A (démo), B, C
  // ==========================================================================================
  const connecter = async (lettre, email, mot, totpSecret) => {
    // Un code TOTP ne sert qu'une fois par fenêtre de 30 s : en cas de refus, attendre la suivante.
    for (let essai = 0; essai < 3; essai += 1) {
      try {
        return await accessToken(api, { email, password: mot, totpSecret, nomAppareil: `${PREFIXE}-${lettre}-${marque}-${Date.now()}` });
      } catch {
        await sleep(31_000);
      }
    }
    return fail(`connexion de ${lettre} impossible`);
  };
  const jetonA = suivre(await demoAccessToken(api, `${PREFIXE}-a-${marque}`), () => demoAccessToken(api, `${PREFIXE}-a-${marque}-${Date.now()}`));
  const creerCollaborateur = async (lettre, totpSecret) => {
    const email = `${PREFIXE}-${lettre}-${marque}@cabinet-fictif.example`;
    const mot = "MotDePasseCollab123!";
    await exiger("/collaborateurs", jetonA, "POST", { email, password: mot, totp_secret_base32: totpSecret }, `création du collaborateur ${lettre}`);
    const jeton = suivre(await connecter(lettre, email, mot, totpSecret), () => connecter(lettre, email, mot, totpSecret));
    const id = await sql(`SELECT id FROM utilisateurs WHERE email = '${email}'`);
    return { jeton, id };
  };
  const b = await creerCollaborateur("b", "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA");
  const c = await creerCollaborateur("c", "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI");
  const idA = await sql(`SELECT id FROM utilisateurs WHERE email = '${demoEmail}'`);
  idDemo = idA;
  seauDemoAvant = operationsSeau(idA);
  const cabinet = await sql(`SELECT cabinet_id FROM utilisateurs WHERE id = '${idA}'`);
  verifier("trois collaborateurs distincts", new Set([idA, b.id, c.id]).size === 3);

  const creerCompteNominatif = async (jeton, etiquette, { hote, port, utilisateur, motDePasse }) => {
    const id = nommer(randomUUID(), `compte ${etiquette}`);
    const adresse = `${PREFIXE}.${etiquette}.${marque}@cabinet.example`;
    const r = await requete("/messagerie/comptes", jeton, "POST", { id, adresse, hote, port, utilisateur, mot_de_passe: motDePasse, tls: false });
    verifier(`compte ${etiquette} créé`, r.statut === 200);
    return { id, adresse };
  };

  // ==========================================================================================
  // Boîte nominative de A (Dovecot) : les messages de départ sont relevés à la création du compte
  // ==========================================================================================
  const mid = (nom) => `<${PREFIXE}-${nom}-${marque}@example.com>`;
  const messagesA = ["lu", "archive", "corbeille", "deplace", "simultane", "retour", "oubli", "coupure", "uid", "externe", "bail"];
  for (const nom of messagesA) deposer(dovecot, `Message ${nom} ${marque}`, mid(nom));
  const boiteA = await creerCompteNominatif(jetonA, "a", { hote: dovecotTest, port: 143, utilisateur: dovecot.login, motDePasse: MOT_IMAP_TEST });
  const m = {};
  for (const nom of messagesA) m[nom] = nommer(await attendre(`relève du message ${nom}`, () => messageDuCompte(boiteA.id, mid(nom))), `message ${nom}`);
  await attendre("première relève terminée", async () => {
    const validite = await sql(`SELECT uid_validity FROM releve_curseurs WHERE compte_id = '${boiteA.id}' AND dossier_imap = 'INBOX'`);
    return validite && validite !== "0" ? true : null;
  });

  // Boîte nominative de B sans serveur joignable : seule la visibilité compte.
  const boiteB = await creerCompteNominatif(b.jeton, "b", { hote: "injoignable.example", port: 143, utilisateur: "b", motDePasse: "MotDePasseB123!" });
  const msgB = nommer(randomUUID(), "mail de B");
  await sql(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
     VALUES ('${msgB}', '${cabinet}', '${boiteB.id}', '<${PREFIXE}-b-${marque}@example.com>', 1, 1, 'Boite de B ${marque}', 'tiers@example.com', 'a_classer')`,
  );

  const action = (jeton, message, genre, cle, destination) =>
    requete(`/messagerie/messages/${message}/actions`, jeton, "POST", { genre, idempotence_cle: cle, ...(destination === undefined ? {} : { destination }) });

  // ==========================================================================================
  // (iii) 1. Lu et non lu
  // ==========================================================================================
  verifier("départ : le message n'est pas lu côté serveur", !(etatImap(dovecot, mid("lu")).INBOX ?? [""])[0].includes("\\Seen"));
  const lu1 = await action(jetonA, m.lu, "lu", `lu-${marque}-1`);
  verifier(`lu : action appliquée (statut ${lu1.statut}, état ${lu1.json?.etat}, erreur ${lu1.json?.erreur})`, lu1.statut === 200 && lu1.json.etat === "appliquee" && lu1.json.rejeu === false);
  verifier("lu : \\Seen posé sur le serveur IMAP", etatImap(dovecot, mid("lu")).INBOX?.[0].includes("\\Seen"));
  verifier("lu : l'état est en base (lu et drapeau)", JSON.stringify(await ligneBase(m.lu)) !== "null" && (await ligneBase(m.lu)).lu === true && (await ligneBase(m.lu)).drapeaux.includes("Seen"));
  const fluxLu = await fluxQuand("lu descend vers le poste de A", jetonA, m.lu, (ligne) => vrai(ligne.lu));
  verifier("lu : le flux de A porte lu et le drapeau", String(fluxLu.drapeaux_texte).includes("Seen"));

  // Rejeu : même clé, même demande.
  const lu2 = await action(jetonA, m.lu, "lu", `lu-${marque}-1`);
  verifier("lu : le rejeu rend la même action, marquée rejeu", lu2.statut === 200 && lu2.json.id === lu1.json.id && lu2.json.rejeu === true);
  verifier("lu : le rejeu ne crée pas d'action", (await nbActions(m.lu)) === 1);
  const lu3 = await action(jetonA, m.lu, "lu", `lu-${marque}-2`);
  verifier("lu : une autre clé crée une action, sans autre effet sur le serveur", lu3.json.id !== lu1.json.id && lu3.json.etat === "appliquee" && (await nbActions(m.lu)) === 2 && nbCopies(etatImap(dovecot, mid("lu"))) === 1);
  // Clé réutilisée pour une autre demande : refusée.
  verifier("lu : la même clé pour une autre action est refusée (409)", (await action(jetonA, m.lu, "non_lu", `lu-${marque}-1`)).statut === 409);
  verifier("lu : la même clé pour un autre message est refusée (409)", (await action(jetonA, m.archive, "lu", `lu-${marque}-1`)).statut === 409);
  verifier("lu : ces refus n'ont rien changé", (await nbActions(m.lu)) === 2 && (await nbActions(m.archive)) === 0 && etatImap(dovecot, mid("lu")).INBOX?.[0].includes("\\Seen"));
  // Deux collaborateurs peuvent choisir la même clé : elle est par utilisateur.
  const cleCommune = await action(jetonA, m.lu, "lu", `commune-${marque}`);
  verifier("lu : la clé est propre à l'utilisateur (B ne la réserve pas pour A)", cleCommune.statut === 200 && (await action(b.jeton, msgB, "lu", `commune-${marque}`)).statut === 200);

  const nonLu = await action(jetonA, m.lu, "non_lu", `lu-${marque}-3`);
  verifier("non lu : action appliquée", nonLu.json.etat === "appliquee");
  verifier("non lu : \\Seen retiré sur le serveur IMAP", !etatImap(dovecot, mid("lu")).INBOX?.[0].includes("\\Seen"));
  const fluxNonLu = await fluxQuand("non lu descend vers le poste de A", jetonA, m.lu, (ligne) => !vrai(ligne.lu));
  verifier("non lu : le flux de A ne porte plus le drapeau", !String(fluxNonLu.drapeaux_texte).includes("Seen"));
  essaiNegatif("non lu : le message est encore lu", "après l'action non lu", () => etatImap(dovecot, mid("lu")).INBOX?.[0].includes("\\Seen") || vrai(fluxNonLu.lu));
  ok("lu et non lu : serveur IMAP et flux de synchronisation suivent, rejeu sans effet, clé réutilisée refusée");

  // ==========================================================================================
  // (iii) 2. Archiver
  // ==========================================================================================
  const arch1 = await action(jetonA, m.archive, "archiver", `arch-${marque}-1`);
  verifier(`archiver : action appliquée (${arch1.statut} ${arch1.json?.etat} ${arch1.json?.erreur})`, arch1.statut === 200 && arch1.json.etat === "appliquee" && arch1.json.dossier_final === "Archives");
  let etat = etatImap(dovecot, mid("archive"));
  verifier("archiver : une seule copie, dans « Archives », plus dans la réception", copiesImap(etat, "Archives") === 1 && copiesImap(etat, "INBOX") === 0 && nbCopies(etat) === 1);
  const baseArch = await ligneBase(m.archive);
  verifier("archiver : la ligne n'est pas supprimée et suit son dossier", baseArch?.dossier === "Archives");
  const fluxArch = await fluxQuand("archivage descend vers le poste de A", jetonA, m.archive, (ligne) => ligne.dossier_imap === "Archives");
  verifier("archiver : le flux de A porte le dossier", fluxArch.dossier_imap === "Archives");
  essaiNegatif("archiver : le message est encore dans la réception", "après l'archivage", () => copiesImap(etat, "INBOX") > 0 || fluxArch.dossier_imap === "INBOX");
  const arch2 = await action(jetonA, m.archive, "archiver", `arch-${marque}-1`);
  const arch3 = await action(jetonA, m.archive, "archiver", `arch-${marque}-2`);
  etat = etatImap(dovecot, mid("archive"));
  verifier("archiver : rejeu et seconde demande sans doublon à la destination", arch2.json.rejeu === true && arch3.json.etat === "appliquee" && copiesImap(etat, "Archives") === 1 && nbCopies(etat) === 1);
  ok("archiver : déplacé une fois vers Archives (créé au besoin), ligne et flux à jour, rejeu sans doublon");

  // ==========================================================================================
  // (iii) 3. Supprimer = Corbeille, jamais d'EXPUNGE
  // ==========================================================================================
  const supp1 = await action(jetonA, m.corbeille, "supprimer", `supp-${marque}-1`);
  verifier(`supprimer : action appliquée (${supp1.statut} ${supp1.json?.etat} ${supp1.json?.erreur})`, supp1.statut === 200 && supp1.json.etat === "appliquee" && supp1.json.dossier_final === "Corbeille");
  etat = etatImap(dovecot, mid("corbeille"));
  verifier("supprimer : le message est dans la Corbeille (une copie), plus dans la réception", copiesImap(etat, "Corbeille") === 1 && copiesImap(etat, "INBOX") === 0);
  verifier("supprimer : la copie de la Corbeille n'est pas marquée \\Deleted (rien n'est expurgé)", !etat.Corbeille[0].includes("\\Deleted"));
  verifier("supprimer : la ligne reste, dans le dossier Corbeille", (await ligneBase(m.corbeille))?.dossier === "Corbeille");
  await fluxQuand("suppression descend vers le poste de A", jetonA, m.corbeille, (ligne) => ligne.dossier_imap === "Corbeille");
  essaiNegatif("supprimer : le message a disparu du serveur", "il est dans la Corbeille", () => nbCopies(etat) === 0);
  const supp2 = await action(jetonA, m.corbeille, "supprimer", `supp-${marque}-2`);
  etat = etatImap(dovecot, mid("corbeille"));
  verifier("supprimer : supprimer ce qui est déjà dans la Corbeille le laisse dans la Corbeille", supp2.json.etat === "appliquee" && copiesImap(etat, "Corbeille") === 1 && nbCopies(etat) === 1 && !etat.Corbeille[0].includes("\\Deleted"));
  ok("supprimer : déplacé vers la Corbeille, jamais expurgé, supprimer deux fois ne perd rien");

  // ==========================================================================================
  // (iii) 4. Déplacer
  // ==========================================================================================
  const dest = `Suivi ${marque}`;
  const dep1 = await action(jetonA, m.deplace, "deplacer", `dep-${marque}-1`, dest);
  verifier(`déplacer : action appliquée (${dep1.statut} ${dep1.json?.etat} ${dep1.json?.erreur})`, dep1.statut === 200 && dep1.json.etat === "appliquee" && dep1.json.dossier_final === dest && dep1.json.destination === dest);
  etat = etatImap(dovecot, mid("deplace"));
  verifier("déplacer : une copie à la destination, aucune dans la réception", copiesImap(etat, dest) === 1 && nbCopies(etat) === 1);
  await fluxQuand("déplacement descend vers le poste de A", jetonA, m.deplace, (ligne) => ligne.dossier_imap === dest);
  // Retour vers la réception.
  const retour = await action(jetonA, m.deplace, "deplacer", `dep-${marque}-2`, "INBOX");
  etat = etatImap(dovecot, mid("deplace"));
  verifier("déplacer : retour dans la réception", retour.json.etat === "appliquee" && copiesImap(etat, "INBOX") === 1 && nbCopies(etat) === 1);
  await fluxQuand("retour dans la réception descend vers le poste de A", jetonA, m.deplace, (ligne) => ligne.dossier_imap === "INBOX");
  // Validation de la demande (essais négatifs de la saisie).
  const refus400 = async (libelle, genre, destination) => {
    const avant = await nbActions(m.deplace);
    const r = await action(jetonA, m.deplace, genre, `dep-${marque}-refus-${randomUUID()}`, destination);
    verifier(`${libelle} (400)`, r.statut === 400 && (await nbActions(m.deplace)) === avant);
  };
  await refus400("déplacer : destination absente", "deplacer", undefined);
  await refus400("déplacer : destination vide", "deplacer", "");
  await refus400("déplacer : destination avec retour à la ligne", "deplacer", "A\r\nB");
  await refus400("déplacer : destination avec joker", "deplacer", "Suivi*");
  await refus400("déplacer : destination avec espace en bordure", "deplacer", " Suivi");
  await refus400("déplacer : destination trop longue", "deplacer", "d".repeat(201));
  await refus400("lu : une destination n'a pas de sens", "lu", "Archives");
  await refus400("action inconnue (EXPUNGE n'existe pas)", "expunge");
  await refus400("action inconnue (purger)", "purger");
  verifier("action : clé d'idempotence vide refusée (400)", (await action(jetonA, m.deplace, "lu", "")).statut === 400);
  verifier("action : clé d'idempotence trop longue refusée (400)", (await action(jetonA, m.deplace, "lu", "k".repeat(201))).statut === 400);
  verifier("action : sans jeton, 401", (await action(undefined, m.deplace, "lu", `x-${marque}`)).statut === 401);
  ok("déplacer : vers un dossier créé au besoin et retour dans la réception, saisies hostiles refusées avant tout effet");

  // ==========================================================================================
  // (iii) 5. Appels simultanés : un seul effet
  // ==========================================================================================
  const parallele = await Promise.all([1, 2, 3, 4].map(() => action(jetonA, m.simultane, "archiver", `par-${marque}`)));
  verifier("simultané : quatre appels de même clé rendent la même action", parallele.every((r) => r.statut === 200 && r.json.id === parallele[0].json.id) && parallele.filter((r) => r.json.rejeu === false).length === 1);
  verifier("simultané : un seul effet sur le serveur IMAP", copiesImap(etatImap(dovecot, mid("simultane")), "Archives") === 1 && nbCopies(etatImap(dovecot, mid("simultane"))) === 1 && (await nbActions(m.simultane)) === 1);
  const autresCles = await Promise.all([1, 2, 3].map((i) => action(jetonA, m.retour, "archiver", `par2-${marque}-${i}`)));
  verifier("simultané : trois clés différentes sur le même message sont acceptées", autresCles.every((r) => r.statut === 200) && new Set(autresCles.map((r) => r.json.id)).size === 3);
  await attendre("les trois actions sont passées (les deux dernières attendent la première, dans l'ordre)", async () => ((await sql(`SELECT COUNT(*) FROM actions_messages WHERE message_ref = '${m.retour}' AND etat = 'appliquee'`)) === "3" ? true : null), 60_000);
  const etatRetour = etatImap(dovecot, mid("retour"));
  const lignesRetour = await sql(`SELECT rang, genre, etat, tentatives, COALESCE(erreur,''), COALESCE(dossier_source,''), COALESCE(dossier_final,''), COALESCE(uid_source::text,'') FROM actions_messages WHERE message_ref = '${m.retour}' ORDER BY rang`);
  verifier(`simultané : trois clés différentes sur le même message, une seule copie à la destination (IMAP ${JSON.stringify(etatRetour)} ; actions ${JSON.stringify(lignesRetour)})`, nbCopies(etatRetour) === 1 && copiesImap(etatRetour, "Archives") === 1);
  ok("simultané : même clé, une action ; clés différentes, une seule copie");

  // ==========================================================================================
  // (iii) 6. Droits
  // ==========================================================================================
  const compteursAvant = await entier(`SELECT COUNT(*) FROM actions_messages WHERE cabinet_id = '${cabinet}'`);
  const etatAvantTiers = JSON.stringify(etatImap(dovecot, mid("oubli")));
  const baseAvantTiers = JSON.stringify(await ligneBase(m.oubli));
  const refus = [];
  for (const [lettre, jeton] of [["b", b.jeton], ["c", c.jeton]]) {
    for (const genre of ["lu", "non_lu", "archiver", "supprimer"]) refus.push((await action(jeton, m.oubli, genre, `tiers-${lettre}-${genre}-${marque}`)).statut);
    refus.push((await action(jeton, m.oubli, "deplacer", `tiers-${lettre}-dep-${marque}`, "Vole")).statut);
  }
  verifier("droits : B et C reçoivent 404 sur la boîte de A, pour chaque action", refus.length === 10 && refus.every((s) => s === 404));
  verifier("droits : les refus ne laissent ni action, ni effet sur le serveur, ni changement en base", (await entier(`SELECT COUNT(*) FROM actions_messages WHERE cabinet_id = '${cabinet}'`)) === compteursAvant && JSON.stringify(etatImap(dovecot, mid("oubli"))) === etatAvantTiers && JSON.stringify(await ligneBase(m.oubli)) === baseAvantTiers);
  const titulaire = await action(jetonA, m.oubli, "lu", `titulaire-${marque}`);
  verifier("droits : le titulaire, lui, agit (contrôle positif)", titulaire.statut === 200 && titulaire.json.etat === "appliquee");
  essaiNegatif("droits : un tiers agit sur la boîte de A", "A, le titulaire, agit sur sa boîte", () => refus.some((s) => s === 200));
  verifier("droits : A n'agit pas sur la boîte nominative de B (404)", (await action(jetonA, msgB, "lu", `a-sur-b-${marque}`)).statut === 404);
  verifier("droits : un message inconnu est introuvable (404)", (await action(jetonA, randomUUID(), "lu", `inconnu-${marque}`)).statut === 404);
  verifier("droits : un tiers ne lit pas l'état d'une action d'autrui (404)", (await requete(`/messagerie/actions/${lu1.json.id}`, b.jeton)).statut === 404);
  verifier("droits : le propriétaire lit son action", (await requete(`/messagerie/actions/${lu1.json.id}`, jetonA)).json?.id === lu1.json.id);
  const listeB = (await exiger("/messagerie/actions", b.jeton)) ?? [];
  verifier("droits : la liste d'actions de B ne contient aucune action de A", listeB.every((x) => x.message_id !== m.lu));
  ok("droits : 404 pour B et C sur la boîte de A (aucun effet), 404 pour A sur celle de B, état d'action propre à son auteur");

  // ==========================================================================================
  // (iii) 7. Boîte partagée (GreenMail) : membres A et B ; C n'en est pas ; un dossier restreint
  // ==========================================================================================
  const messagesPartage = ["partage-lu", "partage-arch", "partage-restreint", "partage-retire"];
  for (const nom of messagesPartage) deposer(greenmail, `Partage ${nom} ${marque}`, mid(nom));
  const partagee = nommer(randomUUID(), "compte partagé");
  const creation = await requete("/messagerie/boites-partagees", jetonA, "POST", {
    id: partagee,
    adresse: `${PREFIXE}.secretariat.${marque}@cabinet.example`,
    hote: greenmailTest,
    port: 3143,
    utilisateur: greenmail.login,
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
    membres: [b.id],
  });
  verifier("boîte partagée créée", creation.statut === 200);
  const p = {};
  for (const nom of messagesPartage) p[nom] = nommer(await attendre(`relève du message ${nom}`, () => messageDuCompte(partagee, mid(nom))), `message ${nom}`);

  // Un membre qui n'a pas relevé le message agit : B lit puis archive.
  const bLu = await action(b.jeton, p["partage-lu"], "lu", `p-lu-${marque}`);
  verifier(`partagée : un membre marque lu (${bLu.statut} ${bLu.json?.etat} ${bLu.json?.erreur})`, bLu.statut === 200 && bLu.json.etat === "appliquee");
  verifier("partagée : \\Seen posé sur le GreenMail", etatImap(greenmail, mid("partage-lu")).INBOX?.[0].includes("\\Seen"));
  await fluxQuand("lu de la boîte partagée descend vers le poste de A (autre membre)", jetonA, p["partage-lu"], (ligne) => vrai(ligne.lu));
  const aArch = await action(jetonA, p["partage-arch"], "archiver", `p-arch-${marque}`);
  etat = etatImap(greenmail, mid("partage-arch"));
  verifier(`partagée : un membre archive (${aArch.json?.etat} ${aArch.json?.erreur})`, aArch.json.etat === "appliquee" && copiesImap(etat, "Archives") === 1 && nbCopies(etat) === 1);
  const cRefus = [];
  for (const genre of ["lu", "archiver", "supprimer"]) cRefus.push((await action(c.jeton, p["partage-lu"], genre, `p-c-${genre}-${marque}`)).statut);
  verifier("partagée : un non-membre reçoit 404", cRefus.every((s) => s === 404));
  essaiNegatif("partagée : un non-membre agit sur la boîte partagée", "C n'est pas membre", () => cRefus.some((s) => s === 200));

  // Dossier restreint : D est créé par A, seul A y a accès. Le message partagé y est classé.
  const dossierRestreint = randomUUID();
  await exiger("/dossiers", jetonA, "POST", { id: dossierRestreint, idempotence_cle: `${PREFIXE}-d-${dossierRestreint}`, nom: `Dossier restreint ${marque}`, chemise: "gris-perle", juridiction: "TJ Paris", numero_rg: "26/30002", restreint: true }, "création du dossier restreint");
  await sql(`UPDATE messages SET dossier_id = '${dossierRestreint}', etat_classement = 'classe', visibilite = 'restreint', restreint = TRUE WHERE id = '${p["partage-restreint"]}'`);
  const restreintB = [];
  for (const genre of ["lu", "archiver", "supprimer"]) restreintB.push((await action(b.jeton, p["partage-restreint"], genre, `p-r-b-${genre}-${marque}`)).statut);
  verifier("restreint : B, membre de la boîte mais sans accès au dossier, reçoit 404", restreintB.every((s) => s === 404));
  verifier("restreint : aucun effet sur le serveur", nbCopies(etatImap(greenmail, mid("partage-restreint"))) === 1 && copiesImap(etatImap(greenmail, mid("partage-restreint")), "INBOX") === 1 && (await nbActions(p["partage-restreint"])) === 0);
  const restreintA = await action(jetonA, p["partage-restreint"], "lu", `p-r-a-${marque}`);
  verifier("restreint : A, qui a accès au dossier, agit (contrôle positif)", restreintA.statut === 200 && restreintA.json.etat === "appliquee");
  essaiNegatif("restreint : un membre sans accès au dossier agit", "A a accès au dossier", () => restreintB.some((s) => s === 200));
  // Ouvrir le dossier à B suffit à lui rendre le message.
  await sql(`INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte) VALUES ('${dossierRestreint}', '${b.id}', '${dossierRestreint}', '${b.id}') ON CONFLICT DO NOTHING`);
  const restreintBOuvert = await action(b.jeton, p["partage-restreint"], "non_lu", `p-r-b2-${marque}`);
  verifier("restreint : l'accès au dossier donné, B agit", restreintBOuvert.statut === 200);
  await sql(`DELETE FROM dossier_acces WHERE dossier_id = '${dossierRestreint}' AND utilisateur_id = '${b.id}'`);
  verifier("restreint : l'accès retiré, B est de nouveau refusé", (await action(b.jeton, p["partage-restreint"], "lu", `p-r-b3-${marque}`)).statut === 404);

  // Membre retiré : B perd la boîte, et avec elle le droit d'agir.
  verifier("membre retiré : B agit tant qu'il est membre", (await action(b.jeton, p["partage-retire"], "lu", `p-m-b1-${marque}`)).statut === 200);
  verifier("membre retiré : A remplace B par C", (await requete(`/messagerie/boites-partagees/${partagee}/membres`, jetonA, "PUT", { membres: [idA, c.id] })).statut === 200);
  verifier("membre retiré : B reçoit 404", (await action(b.jeton, p["partage-retire"], "non_lu", `p-m-b2-${marque}`)).statut === 404);
  verifier("membre retiré : C, ajouté, agit", (await action(c.jeton, p["partage-retire"], "non_lu", `p-m-c-${marque}`)).statut === 200);
  ok("boîte partagée : membres agissent, non-membre / dossier restreint non autorisé / membre retiré reçoivent 404");

  // ==========================================================================================
  // (iii) 8. Reprise
  // ==========================================================================================
  // 8a. UID obsolète et UIDVALIDITY changée : le message est retrouvé par son Message-ID.
  await sql(`UPDATE messages SET uid = 99999, uid_validity = 31337 WHERE id = '${m.uid}'`);
  const apresUid = await action(jetonA, m.uid, "archiver", `uid-${marque}`);
  etat = etatImap(dovecot, mid("uid"));
  verifier(`UID obsolète : retrouvé par son Message-ID et déplacé (${apresUid.json?.etat} ${apresUid.json?.erreur})`, apresUid.json.etat === "appliquee" && copiesImap(etat, "Archives") === 1 && nbCopies(etat) === 1);
  const baseUid = await ligneBase(m.uid);
  verifier("UID obsolète : la ligne reprend le dossier et l'UID réels", baseUid.dossier === "Archives" && baseUid.uid !== 99999 && baseUid.validite !== 31337);
  essaiNegatif("UID obsolète : la ligne garde l'UID inventé", "après l'action", () => baseUid.uid === 99999);

  // 8b. Rejeu après un déplacement fait ailleurs (fenêtre de coupure entre IMAP et la base) : l'action
  // est en attente, un autre client déplace le message, la relève ne doit pas effacer la ligne, puis
  // l'action reprend sans recopier. Une ligne sans action en attente, elle, disparaît (contrôle).
  const sansAction = mid("externe-temoin");
  deposer(dovecot, `Témoin ${marque}`, sansAction);
  const idTemoin = nommer(await attendre("relève du témoin", () => messageDuCompte(boiteA.id, sansAction)), "témoin");
  await sql(
    `INSERT INTO actions_messages (id, cabinet_id, utilisateur_id, compte_id, message_ref, message_id, genre, destination, idempotence_cle, prochaine_tentative_le)
     SELECT '${randomUUID()}', cabinet_id, '${idA}', compte_id, id, message_id, 'supprimer', NULL, 'externe-${marque}', NOW() + INTERVAL '1 hour'
     FROM messages WHERE id = '${m.externe}'`,
  );
  imap(dovecot, "deplacer_externe", { dossier: "INBOX", cible: mid("externe"), env: { IMAP_VERS: "Corbeille" } });
  imap(dovecot, "deplacer_externe", { dossier: "INBOX", cible: sansAction, env: { IMAP_VERS: "Corbeille" } });
  await attendre("la relève voit les deux messages partir de la réception (la ligne témoin disparaît)", async () => ((await ligneBase(idTemoin)) === null ? true : null), 90_000);
  const protegee = (await ligneBase(m.externe))?.dossier === "INBOX";
  verifier("reprise : la ligne dont une action est en attente survit à la relève", protegee);
  const temoin = await ligneBase(idTemoin);
  essaiNegatif("reprise : la ligne du témoin, sans action en attente, survit à la relève", "le témoin, déplacé de la même façon, a disparu", () => temoin !== null);
  await sql(`UPDATE actions_messages SET prochaine_tentative_le = NOW() WHERE idempotence_cle = 'externe-${marque}'`);
  await attendre("l'action reprise par le balayage", async () => ((await sql(`SELECT etat FROM actions_messages WHERE idempotence_cle = 'externe-${marque}'`)) === "appliquee" ? true : null), 60_000);
  etat = etatImap(dovecot, mid("externe"));
  verifier("reprise : déjà déplacé par l'autre client, aucun doublon à la Corbeille", copiesImap(etat, "Corbeille") === 1 && nbCopies(etat) === 1);
  verifier("reprise : la ligne est inscrite à la Corbeille", (await ligneBase(m.externe))?.dossier === "Corbeille");

  // 8c. Identifiants refusés : l'action attend, rien ne change.
  const boiteRefus = await creerCompteNominatif(jetonA, "refus", { hote: dovecotTest, port: 143, utilisateur: dovecot.login, motDePasse: "MauvaisMotDePasse123!" });
  const msgRefus = nommer(randomUUID(), "mail du compte refusé");
  await sql(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
     VALUES ('${msgRefus}', '${cabinet}', '${boiteRefus.id}', '<${PREFIXE}-refus-${marque}@example.com>', 1, 1, 'Refus ${marque}', 'tiers@example.com', 'a_classer')`,
  );
  const aRefus = await action(jetonA, msgRefus, "supprimer", `refus-${marque}`);
  verifier(`identifiants refusés : l'action attend (${aRefus.json?.etat} ${aRefus.json?.erreur})`, aRefus.statut === 200 && aRefus.json.etat === "en_attente" && aRefus.json.erreur === "authentification");
  verifier("identifiants refusés : rien n'a changé pour le poste", (await ligneBase(msgRefus))?.dossier === "INBOX");
  essaiNegatif("identifiants refusés : l'action est appliquée", "le serveur a refusé les identifiants", () => aRefus.json.etat === "appliquee");

  // 8d. Serveur IMAP coupé : l'action attend, puis passe au retour du serveur, dans l'ordre.
  docker("stop", dovecotTest);
  let coupe;
  let suite;
  try {
    coupe = await action(jetonA, m.coupure, "archiver", `coupure-${marque}-1`);
    suite = await action(jetonA, m.coupure, "lu", `coupure-${marque}-2`);
    verifier(`coupure IMAP : l'action attend (${coupe.json?.etat} ${coupe.json?.erreur})`, coupe.statut === 200 && coupe.json.etat === "en_attente" && coupe.json.erreur === "connexion");
    verifier("coupure IMAP : la seconde action attend aussi (même message, dans l'ordre)", suite.json.etat === "en_attente");
    verifier("coupure IMAP : l'état du message n'a pas bougé pour le poste", (await ligneBase(m.coupure))?.dossier === "INBOX" && (await ligneBase(m.coupure)).lu === false);
    const attentes = await exiger("/messagerie/actions?etat=en_attente", jetonA);
    verifier("coupure IMAP : les actions en attente sont listées", attentes.some((x) => x.id === coupe.json.id) && attentes.some((x) => x.id === suite.json.id));
  } finally {
    // Le serveur redémarre dans tous les cas : la recette ne laisse pas le banc éteint.
    docker("start", dovecotTest);
    connecterAuReseauApi(dovecotTest);
  }
  await attendre("les deux actions passées au retour du serveur", async () => {
    const etats = await sql(`SELECT string_agg(etat, ',' ORDER BY rang) FROM actions_messages WHERE message_ref = '${m.coupure}'`);
    return etats === "appliquee,appliquee" ? true : null;
  }, 180_000);
  etat = etatImap(dovecot, mid("coupure"));
  verifier("coupure IMAP : une copie à Archives, lue (l'archivage a précédé la lecture)", copiesImap(etat, "Archives") === 1 && nbCopies(etat) === 1 && etat.Archives[0].includes("\\Seen"));
  const baseCoupure = await ligneBase(m.coupure);
  verifier("coupure IMAP : la ligne dit Archives et lu", baseCoupure.dossier === "Archives" && baseCoupure.lu === true);
  const tentativesCoupure = await entier(`SELECT tentatives FROM actions_messages WHERE id = '${coupe.json.id}'`);
  verifier(`coupure IMAP : l'action a été retentée (${tentativesCoupure} tentatives)`, tentativesCoupure >= 2);

  // 8e. API coupée : une action prise par une tâche perdue (bail en cours) est reprise au démarrage.
  const idBail = randomUUID();
  await sql(
    `INSERT INTO actions_messages (id, cabinet_id, utilisateur_id, compte_id, message_ref, message_id, genre, destination, idempotence_cle, reserve_jusqu_le, tentatives)
     SELECT '${idBail}', cabinet_id, '${idA}', compte_id, id, message_id, 'archiver', NULL, 'bail-${marque}', NOW() + INTERVAL '30 minutes', 1
     FROM messages WHERE id = '${m.bail}'`,
  );
  await sleep(12_000);
  verifier("API coupée : une action au bail en cours n'est pas reprise tant que l'API tourne", (await sql(`SELECT etat FROM actions_messages WHERE id = '${idBail}'`)) === "en_attente" && copiesImap(etatImap(dovecot, mid("bail")), "INBOX") === 1);
  const kidAvant = (await (await fetch(`${api}/auth/jwks`)).json()).keys.map((k) => k.kid).sort().join();
  docker("restart", conteneur("legalos-instance-api")[0]);
  await attendre("API de nouveau en ligne", async () => ((await fetch(`${instance}/health`).catch(() => null))?.ok ? true : null), 120_000);
  // La clé de signature est persistante (volume api_cles) et son identifiant en est l'empreinte : après le
  // redémarrage de l'API, le JWKS est inchangé, PowerSync n'est pas redémarré et les jetons restent valides.
  const kidApres = (await (await fetch(`${api}/auth/jwks`)).json()).keys.map((k) => k.kid).sort().join();
  verifier("API coupée : la clé de signature survit au redémarrage (même kid dans le JWKS)", kidAvant !== "" && kidAvant === kidApres);
  await attendre("action au bail perdu reprise après le redémarrage", async () => ((await sql(`SELECT etat FROM actions_messages WHERE id = '${idBail}'`)) === "appliquee" ? true : null), 90_000);
  etat = etatImap(dovecot, mid("bail"));
  verifier("API coupée : l'action est passée une fois", copiesImap(etat, "Archives") === 1 && nbCopies(etat) === 1);
  ok("reprise : UID obsolète, déplacement fait ailleurs, identifiants refusés, serveur IMAP coupé, API coupée");

  // ==========================================================================================
  // (iv) Recherche
  // ==========================================================================================
  const jetonA2 = jetonA;
  const jetonB2 = b.jeton;
  const jetonC2 = c.jeton;
  const cherche = (jeton, q, extra = "") => requete(`/messagerie/recherche?q=${encodeURIComponent(q)}${extra}`, jeton);
  const ids = async (jeton, q, extra) => {
    const r = await cherche(jeton, q, extra);
    verifier(`recherche « ${q.slice(0, 40)} » → ${r.statut}`, r.statut === 200);
    return new Set(r.json.resultats.map((x) => x.id));
  };

  // Jeu de messages : objet, expéditeur, destinataires, corps. Le corps long porte un mot unique
  // au-delà du début du corps (extrait de 1 024 octets) ; il n'est trouvé qu'une fois le message lu.
  const motObjet = `zorglub${marque}`;
  const motCorpsCourt = `quetzalcoatl${marque}`;
  const motCorpsLong = `ornithorynque${marque}`;
  const expediteurRare = `jean.martin${marque}@example.com`;
  const destinataireRare = `destinataire.fictif${marque}@example.com`;
  const bourrage = "lorem ipsum dolor sit amet ".repeat(120);
  deposer(dovecot, `Assignation ${motObjet} Évry`, mid("rech-objet"), { corps: "Corps ordinaire de ce message fictif." });
  deposer(dovecot, `Sans mot rare ${marque}`, mid("rech-exp"), { de: `Jean Martin <${expediteurRare}>` });
  deposer(dovecot, `Pour quelqu'un ${marque}`, mid("rech-dest"), { a: `Destinataire Fictif <${destinataireRare}>, capa@localhost` });
  deposer(dovecot, `Corps court ${marque}`, mid("rech-corps"), { corps: `Bonjour, voici ${motCorpsCourt} dans le début du corps.` });
  deposer(dovecot, `Corps long ${marque}`, mid("rech-long"), { corps: `${bourrage} ${motCorpsLong} fin du message.` });
  const r = {};
  for (const nom of ["rech-objet", "rech-exp", "rech-dest", "rech-corps", "rech-long"]) r[nom] = nommer(await attendre(`relève de ${nom}`, () => messageDuCompte(boiteA.id, mid(nom))), nom);

  const trouveA = async (q, attendu, libelle) => {
    const trouves = await ids(jetonA2, q);
    verifier(`recherche ${libelle} : A retrouve le message`, trouves.has(r[attendu]));
    return trouves;
  };
  await trouveA(motObjet, "rech-objet", "par l'objet");
  await trouveA(motObjet.toUpperCase(), "rech-objet", "par l'objet, sans tenir compte de la casse");
  await trouveA("evry", "rech-objet", "par un mot accentué saisi sans accent");
  await trouveA("ÉVRY", "rech-objet", "par un mot accentué saisi en majuscules");
  await trouveA("assign", "rech-objet", "par un début de mot");
  await trouveA(`assignation ${motObjet}`, "rech-objet", "par plusieurs mots (tous requis)");
  const sansLeMot = await ids(jetonA2, `assignation introuvable${marque}`);
  essaiNegatif("recherche : un mot absent est exigé", "un des deux mots n'existe pas", () => sansLeMot.has(r["rech-objet"]));
  await trouveA(`martin${marque}`, "rech-exp", "par l'expéditeur (partie de l'adresse)");
  await trouveA(expediteurRare, "rech-exp", "par l'adresse entière de l'expéditeur");
  await trouveA(`fictif${marque}`, "rech-dest", "par un destinataire");
  await trouveA(motCorpsCourt, "rech-corps", "par le début du corps");
  // Le corps long n'est jamais ouvert : l'indexation de fond du serveur (critère J11) le rend cherchable sans
  // lecture. L'ancien essai négatif (« seul le début du corps est indexé avant la lecture ») dépendait d'une course
  // avec cette indexation (échec du 22/10/2026) ; il est remplacé par une attente bornée et un mot voisin absent.
  await attendre("le milieu d'un corps jamais ouvert est indexé en tâche de fond", async () => ((await ids(jetonA2, motCorpsLong)).has(r["rech-long"]) ? true : null), 150_000);
  const motVoisin = await ids(jetonA2, `${motCorpsLong}absent`);
  essaiNegatif("recherche : un mot voisin du corps jamais ouvert est trouvé", "le mot exact est trouvé, pas un mot qui n'existe pas", () => motVoisin.has(r["rech-long"]));
  const lecture = await requete(`/messagerie/messages/${r["rech-long"]}/corps`, jetonA2, "POST");
  verifier("recherche : le corps long peut aussi être lu, et reste trouvé après la lecture", lecture.statut === 200 && (await ids(jetonA2, motCorpsLong)).has(r["rech-long"]));
  ok("recherche : objet, expéditeur, destinataires, début du corps, corps complet sans lecture (indexation de fond) ; casse, accents, début de mot, mots multiples");

  // Résultat complet d'un message : champs utiles, aucun secret.
  const detail = (await cherche(jetonA2, motObjet)).json.resultats.find((x) => x.id === r["rech-objet"]);
  verifier("recherche : le résultat porte compte, dossier, objet, expéditeur, date et état de lecture", detail.compte_id === boiteA.id && detail.dossier_imap === "INBOX" && detail.objet.includes(motObjet) && typeof detail.date === "string" && typeof detail.lu === "boolean");

  // Droits : B et C ne trouvent rien, même avec le mot exact.
  const exactes = [[motObjet, "objet"], [expediteurRare, "expéditeur"], [destinataireRare, "destinataire"], [motCorpsCourt, "corps"], [motCorpsLong, "corps lu"]];
  for (const [mot, genre] of exactes) {
    const pourA = await ids(jetonA2, mot);
    verifier(`droits : A trouve le ${genre} (contrôle positif)`, pourA.size >= 1);
    const pourB = await ids(jetonB2, mot);
    const pourC = await ids(jetonC2, mot);
    verifier(`droits : B et C ne trouvent rien par le ${genre}, même exact`, pourB.size === 0 && pourC.size === 0);
    essaiNegatif(`droits : B trouve le ${genre} de A`, "le titulaire, lui, le trouve", () => pourB.size > 0 || pourC.size > 0);
  }
  verifier("droits : B ne cible pas la boîte de A (404)", (await cherche(jetonB2, motObjet, `&compte_id=${boiteA.id}`)).statut === 404);
  verifier("droits : C ne cible pas la boîte de B (404)", (await cherche(jetonC2, "boite", `&compte_id=${boiteB.id}`)).statut === 404);
  verifier("droits : A cible sa boîte", (await ids(jetonA2, motObjet, `&compte_id=${boiteA.id}`)).has(r["rech-objet"]));
  const autreBoite = await ids(jetonA2, motObjet, `&compte_id=${partagee}`);
  essaiNegatif("recherche : limitée à la boîte partagée, elle trouve le message de la boîte nominative", "la même recherche limitée à la boîte A le trouve", () => autreBoite.has(r["rech-objet"]));

  // Boîte partagée : membres oui, non-membre non. Dossier restreint : refus sans accès.
  const termePartage = `Partage ${marque}`;
  const membreA = await ids(jetonA2, termePartage);
  const nonMembre = await ids(jetonC2, termePartage);
  verifier("partagée : A (membre) trouve les messages de la boîte partagée", membreA.has(p["partage-lu"]));
  // C a été ajouté comme membre lors de l'étape précédente : il doit les trouver, et B (retiré) non.
  verifier("partagée : C, devenu membre, les trouve", nonMembre.has(p["partage-lu"]));
  const retire = await ids(jetonB2, termePartage);
  verifier("partagée : B, retiré des membres, ne les trouve plus", !retire.has(p["partage-lu"]) && !retire.has(p["partage-restreint"]));
  essaiNegatif("partagée : un membre retiré trouve la boîte partagée", "A, membre, la trouve", () => retire.has(p["partage-lu"]));
  const restreintTrouve = await ids(jetonA2, termePartage);
  verifier("restreint : A, qui a accès au dossier, trouve le message classé", restreintTrouve.has(p["partage-restreint"]));
  const restreintC = await ids(jetonC2, termePartage);
  verifier("restreint : C, membre de la boîte sans accès au dossier, ne le trouve pas, même avec le mot exact", !restreintC.has(p["partage-restreint"]) && restreintC.has(p["partage-lu"]));
  essaiNegatif("restreint : un membre sans accès trouve le message du dossier restreint", "A, avec accès, le trouve", () => restreintC.has(p["partage-restreint"]));
  await sql(`INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte) VALUES ('${dossierRestreint}', '${c.id}', '${dossierRestreint}', '${c.id}') ON CONFLICT DO NOTHING`);
  verifier("restreint : l'accès au dossier donné, C le trouve", (await ids(jetonC2, termePartage)).has(p["partage-restreint"]));
  await sql(`DELETE FROM dossier_acces WHERE dossier_id = '${dossierRestreint}' AND utilisateur_id = '${c.id}'`);
  verifier("restreint : l'accès retiré, C ne le trouve plus", !(await ids(jetonC2, termePartage)).has(p["partage-restreint"]));
  ok("recherche : boîtes d'autrui, membre retiré et dossier restreint non autorisé ne donnent rien, même avec un terme exact");

  // Saisies hostiles.
  const total = await entier("SELECT COUNT(*) FROM messages");
  const refusRecherche = async (libelle, q) => verifier(`${libelle} (400)`, (await cherche(jetonA2, q)).statut === 400);
  await refusRecherche("recherche vide", "");
  await refusRecherche("recherche faite d'espaces", "    ");
  await refusRecherche("joker %", "%");
  await refusRecherche("jokers %%%", "%%%");
  await refusRecherche("joker _", "_");
  await refusRecherche("jokers _ et %", "_%_ %");
  await refusRecherche("un seul caractère", "a");
  await refusRecherche("ponctuation seule", "'\";--");
  await refusRecherche("très longue chaîne (10 000 caractères)", "x".repeat(10_000));
  await refusRecherche("chaîne de 257 caractères", "x".repeat(257));
  verifier("recherche : sans paramètre q, 400", (await requete("/messagerie/recherche", jetonA2)).statut === 400);
  verifier("recherche : sans jeton, 401", (await cherche(undefined, "bonjour")).statut === 401);
  const sansResultat = async (libelle, q) => {
    const rep = await cherche(jetonA2, q);
    verifier(`${libelle} : 200 et aucun résultat (${rep.statut})`, rep.statut === 200 && rep.json.resultats.length === 0);
  };
  await sansResultat("injection SQL", `'; DROP TABLE messages; --`);
  await sansResultat("injection SQL 2", `${motObjet}' OR '1'='1`);
  await sansResultat("opérateurs de requête", "a:* | !b ) ( & <-> zzzzzz");
  verifier("recherche : rien n'a été supprimé par les saisies hostiles", (await entier("SELECT COUNT(*) FROM messages")) >= total);
  const surLimite = await cherche(jetonA2, `${"x".repeat(255)} `);
  verifier("recherche : 256 caractères exactement sont acceptés (aucun résultat)", surLimite.statut === 200 && surLimite.json.resultats.length === 0);
  const jokerDansMot = await ids(jetonA2, `${motObjet.slice(0, -3)}%`);
  verifier("recherche : « % » en fin de mot n'est qu'un séparateur (début de mot)", jokerDansMot.has(r["rech-objet"]));
  const toutLeMonde = await ids(jetonA2, "%__% zorglub");
  verifier("recherche : « zorglub » avec des jokers reste une recherche de mot (contrôle positif)", toutLeMonde.has(r["rech-objet"]));
  essaiNegatif("recherche : les jokers élargissent la recherche", "un message sans « zorglub » apparaîtrait", () => toutLeMonde.has(r["rech-exp"]) || toutLeMonde.has(r["rech-corps"]));
  // Pagination.
  const deux = await cherche(jetonA2, marque, "&limite=2");
  verifier("recherche : la limite est respectée et l'existence d'une suite signalée", deux.statut === 200 && deux.json.resultats.length === 2 && deux.json.a_suivre === true);
  const suivants = await cherche(jetonA2, marque, "&limite=2&decalage=2");
  verifier("recherche : le décalage donne d'autres résultats", suivants.json.resultats.length >= 1 && suivants.json.resultats.every((x) => !deux.json.resultats.some((y) => y.id === x.id)));
  const surLimiteMax = await cherche(jetonA2, marque, "&limite=100000");
  verifier("recherche : la limite est bornée à 100", surLimiteMax.statut === 200 && surLimiteMax.json.resultats.length <= 100);
  const ordre = deux.json.resultats.map((x) => x.date);
  verifier("recherche : du plus récent au plus ancien", ordre.every((d, i) => i === 0 || ordre[i - 1] >= d));
  ok("recherche : saisies hostiles refusées ou sans effet, pagination bornée, ordre chronologique");

  // ==========================================================================================
  // (iv) Mesure : recherche sur 50 000 messages
  // ==========================================================================================
  // La mesure insère puis supprime 50 000 messages : elle le fait dans la boîte de C, jamais dans celle de
  // l'utilisateur de démo, dont le seau PowerSync (messages_nominatifs) alourdirait la synchronisation initiale
  // de tous les postes suivants (20/10/2026, consigne de l'architecte).
  const boitePerf = await creerCompteNominatif(jetonC2, "perf", { hote: "injoignable.example", port: 143, utilisateur: "perf", motDePasse: "MotDePassePerf123!" });
  const motRare = `rarissime${marque}`;
  const debutInsertion = Date.now();
  await sql(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, destinataires_texte, extrait_texte, etat_classement)
     SELECT gen_random_uuid(), '${cabinet}', '${boitePerf.id}', '<${PREFIXE}-perf-' || i || '-${marque}@example.com>', 7, i,
            CASE WHEN i = 25000 THEN 'Audience ${motRare} fictive' ELSE 'Dossier fictif numero ' || i || ' audience de plaidoirie' END,
            'expediteur' || (i % 500) || '@example.com',
            'destinataire' || (i % 300) || '@example.com, capa@localhost',
            'Texte fictif du début du message numero ' || i || ' concernant une assignation et un jugement',
            'a_classer'
     FROM generate_series(1, 50000) AS i`,
  );
  await sql("ANALYZE messages");
  const insereMs = Date.now() - debutInsertion;
  const compteMesure = await entier(`SELECT COUNT(*) FROM messages WHERE compte_id = '${boitePerf.id}'`);
  verifier("mesure : 50 000 messages en base", compteMesure === 50_000);
  const totalMessages = await entier("SELECT COUNT(*) FROM messages");
  const chronometre = async (libelle, jeton, q, extra = "") => {
    const essais = [];
    let derniere;
    for (let i = 0; i < 5; i += 1) {
      const debut = performance.now();
      derniere = await cherche(jeton, q, extra);
      essais.push(performance.now() - debut);
      verifier(`mesure ${libelle} → ${derniere.statut}`, derniere.statut === 200);
    }
    essais.sort((x, y) => x - y);
    const mediane = Math.round(essais[2]);
    mesures.push({ libelle, mediane, pire: Math.round(essais[4]), resultats: derniere.json.resultats.length, suite: derniere.json.a_suivre });
    return { mediane, pire: Math.round(essais[4]), reponse: derniere };
  };
  const rare = await chronometre("mot rare (1 résultat sur 50 000)", jetonC2, motRare);
  verifier("mesure : le mot rare est trouvé dans la boîte de 50 000", rare.reponse.json.resultats.length === 1 && rare.reponse.json.resultats[0].compte_id === boitePerf.id);
  const courant = await chronometre("mot courant (50 000 résultats, 25 rendus)", jetonC2, "audience plaidoirie");
  verifier("mesure : le mot courant donne une page pleine et une suite", courant.reponse.json.resultats.length === 25 && courant.reponse.json.a_suivre === true);
  const adresse = await chronometre("expéditeur (100 résultats possibles)", jetonC2, "expediteur42 example");
  const absent = await chronometre("mot absent", jetonC2, `introuvable${marque}`);
  const tiers = await chronometre("mot courant, pour un collaborateur sans accès à cette boîte", jetonB2, "audience plaidoirie");
  verifier("mesure : B ne voit rien de la boîte de 50 000 messages", tiers.reponse.json.resultats.every((x) => x.compte_id !== boitePerf.id));
  const rareB = await ids(jetonB2, motRare);
  essaiNegatif("mesure : B trouve le mot rare de la boîte de 50 000", "C, titulaire, le trouve", () => rareB.size > 0);
  for (const x of mesures) ok(`mesure ${x.libelle} : médiane ${x.mediane} ms, pire ${x.pire} ms (${x.resultats} résultat(s) rendus, ${totalMessages} messages en base)`);
  ok(`mesure : insertion et analyse de 50 000 messages : ${insereMs} ms`);
  verifier("mesure : mot rare en moins de 500 ms", rare.mediane < 500);
  verifier("mesure : mot courant (page de 25 sur 50 000 candidats) en moins de 2 000 ms", courant.mediane < 2000 && adresse.mediane < 2000 && absent.mediane < 500 && tiers.mediane < 500);

  console.log("j11-boites-actions: OK");
}

// Après le nettoyage : double compaction, puis le seau de l'utilisateur de démo n'a pas grossi (la mesure de
// 50 000 messages est dans la boîte de C). Une dérive casse la synchronisation initiale des postes suivants.
async function controlerSeauDemo() {
  if (seauDemoAvant === null || idDemo === null) return;
  try {
    compacterPowerSync();
    const apres = operationsSeau(idDemo);
    if (apres - seauDemoAvant > MARGE_SEAU_DEMO) {
      console.error(`j11-boites-actions: FAIL — seau PowerSync de l'utilisateur de démo : ${seauDemoAvant} opérations avant, ${apres} après (marge ${MARGE_SEAU_DEMO})`);
      process.exitCode = 1;
    } else {
      ok(`seau PowerSync de l'utilisateur de démo : ${seauDemoAvant} opérations avant, ${apres} après la double compaction`);
    }
  } catch (err) {
    console.error(`j11-boites-actions: FAIL — contrôle du seau de démo : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    if (!process.exitCode) {
      console.error(`j11-boites-actions: FAIL — ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    // Le banc ne reste jamais éteint, et rien de la recette ne reste en base ni dans les boîtes.
    try {
      const dovecotTest = conteneur("legalos-imap-test-dovecot")[0];
      if (!dovecotTest) spawnSync("docker", ["start", "legalos-imap-test-dovecot-1"], { encoding: "utf8" });
    } catch {
      // Docker indisponible : rien à relancer.
    }
    await nettoyer();
    await controlerSeauDemo();
    await sql(`DELETE FROM dossiers WHERE nom = 'Dossier restreint ${marque}'`).catch(() => {});
    for (const boite of [dovecot, greenmail]) {
      try {
        imap(boite, "purger");
      } catch {
        // Serveur de test arrêté : rien à nettoyer.
      }
    }
  });
