#!/usr/bin/env node
/**
 * J11 étape 3 (critère h) — boîtes nominatives et partagées, tableau de santé, arrivée d'un mail,
 * contre l'instance (API et flux de synchronisation PowerSync, sans app).
 *
 * Boîtes réelles : la boîte nominative du titulaire A lit la boîte « capa » du Dovecot d'imap-test
 * (QRESYNC : un mail déposé réveille le moteur) ; la boîte partagée lit la boîte « capa » du
 * GreenMail d'imap-test. Le collaborateur B a une boîte nominative sans serveur joignable (ses
 * messages sont posés en base) : seule la visibilité y est en jeu.
 *
 * Deux voies sont vérifiées pour chaque droit :
 *   - l'API (liste des messages, comptes, lecture du corps, classement) ;
 *   - le flux de synchronisation : le flux PowerSync de chaque collaborateur est lu en HTTP (le même
 *     protocole que le poste) et les lignes reçues, avec le flux qui les porte, sont comparées.
 *
 * Chaque vérification a son essai négatif : la même vérification, appliquée à la situation
 * inverse (autre collaborateur, membre retiré, message historique au lieu d'une arrivée…), doit
 * donner l'inverse. Un essai négatif qui ne bascule pas fait échouer la recette.
 *
 * Aucun contenu réel : adresses et textes fictifs. Aucun contenu de mail dans les sorties.
 * Prérequis : instance démarrée (`cd instance && docker compose -f docker-compose.yml --env-file
 * ../.env up -d --wait`), `docker compose -f instance/imap-test/docker-compose.yml up -d --wait`,
 * `python`. Usage : node tests/recette/j11-boites.mjs
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, demoAccessToken, demoEmail } from "./lib/demo-auth.mjs";
import { MOT_IMAP_TEST, connecterAuReseauApi, conteneur } from "./lib/moteur-mail.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const marque = randomUUID().slice(0, 8);
/** Boîte « capa » du Dovecot d'imap-test, vue de l'hôte. */
const dovecot = { hote: "127.0.0.1", port: "1143", login: "capa", secret: MOT_IMAP_TEST };
/** Boîte « capa » du GreenMail d'imap-test, vue de l'hôte. */
const greenmail = { hote: "127.0.0.1", port: "3143", login: "capa", secret: MOT_IMAP_TEST };
const PREFIXE = "boites-j11";
/** Identifiant → nom lisible, pour que les échecs disent quelle ligne manque (jamais de contenu). */
const etiquettes = new Map();
const nommer = (id, nom) => {
  etiquettes.set(id, nom);
  return id;
};

function fail(message) {
  console.error(`j11-boites: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function ok(message) {
  console.log(`j11-boites: ${message}`);
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
    fail(`${contexte ?? `${methode} ${chemin}`} → ${r.statut}`);
  }
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
      // Nouvel essai : le service peut ne pas être prêt.
      derniereErreur = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    }
    await sleep(700);
  }
  fail(`${contexte} : délai dépassé (${delaiMs} ms)${derniereErreur ? ` — ${derniereErreur}` : ""}`);
  return null;
}

async function entier(requeteSql) {
  return Number.parseInt(await sqlServeur(requeteSql), 10);
}

// --------------------------------------------------------------------------------------------
// Client IMAP de contrôle (python imaplib). Le secret passe par l'environnement.
// --------------------------------------------------------------------------------------------
const SCRIPT_IMAP = String.raw`
import imaplib, os, sys
hote, port, login, action = sys.argv[1:5]
boite = imaplib.IMAP4(hote, int(port))
boite.login(login, os.environ['IMAP_SECRET'])
if action == 'ajouter':
    brut = (
        'From: expediteur.fictif@example.com\r\n'
        'To: capa@localhost\r\n'
        'Subject: ' + os.environ['IMAP_SUJET'] + '\r\n'
        'Message-ID: ' + os.environ['IMAP_MID'] + '\r\n'
        '\r\n'
        'Corps fictif ' + os.environ['IMAP_SUJET'] + '.\r\n'
    )
    typ, _ = boite.append('INBOX', None, None, brut.encode('utf-8'))
    assert typ == 'OK', typ
elif action == 'purger':
    typ, _ = boite.select('INBOX')
    if typ == 'OK':
        typ, data = boite.search(None, 'ALL')
        for num in (data[0].split() if data and data[0] else []):
            boite.store(num, '+FLAGS', '(\\Deleted)')
        boite.expunge()
boite.logout()
`;

function imap(boite, action, { sujet = "", messageId = "" } = {}) {
  const run = spawnSync("python", ["-c", SCRIPT_IMAP, boite.hote, boite.port, boite.login, action], {
    encoding: "utf8",
    env: { ...process.env, IMAP_SECRET: boite.secret, IMAP_SUJET: sujet, IMAP_MID: messageId },
  });
  if (run.status !== 0) throw new Error(`imap ${action} : ${(run.stderr || run.stdout).slice(0, 200)}`);
}

// --------------------------------------------------------------------------------------------
// Flux de synchronisation PowerSync, lu comme le poste le lit (POST /sync/stream, NDJSON)
// --------------------------------------------------------------------------------------------
const FLUX_MESSAGES = [
  "messages_publics",
  "messages_restreints",
  "messages_a_classer",
  "messages_nominatifs",
  "messages_boites_partagees",
];
const FLUX_COMPTES = ["comptes_nominatifs", "comptes_partages"];

/**
 * Lit un instantané cohérent des flux de messages et de comptes d'un collaborateur. Renvoie
 * `{ messages, comptes }` : id de ligne → { flux: Set des flux qui la portent, ...colonnes }.
 */
async function instantane(jeton) {
  const controle = new AbortController();
  const reponse = await fetch(`${instance}/sync/sync/stream`, {
    method: "POST",
    headers: {
      authorization: `Token ${jeton}`,
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      buckets: [],
      raw_data: true,
      client_id: `j11-boites-${marque}`,
      include_checksum: true,
      streams: {
        include_defaults: false,
        subscriptions: [...FLUX_MESSAGES, ...FLUX_COMPTES].map((stream) => ({
          stream,
          parameters: null,
          override_priority: null,
        })),
      },
    }),
    signal: AbortSignal.any([controle.signal, AbortSignal.timeout(60_000)]),
  });
  if (!reponse.ok) fail(`flux de synchronisation → ${reponse.status}`);
  /** seau → (id de ligne → { type, colonnes }) */
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
            } else if (op.op === "REMOVE") {
              rangees.delete(op.object_id);
            } else if (op.op === "CLEAR") {
              rangees.clear();
            }
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
  const comptes = new Map();
  for (const [seau, rangees] of seaux) {
    const flux = /^\d+#([a-z_]+)\|/.exec(seau)?.[1] ?? seau;
    for (const [id, { type, colonnes }] of rangees) {
      const cible = type === "messages" ? messages : type === "comptes_mail" ? comptes : null;
      if (!cible) continue;
      const ligne = cible.get(id) ?? { flux: new Set(), colonnes };
      ligne.flux.add(flux);
      ligne.colonnes = { ...ligne.colonnes, ...colonnes };
      cible.set(id, ligne);
    }
  }
  return { messages, comptes };
}

/** Instantané où toutes les lignes attendues sont arrivées (la réplication a un délai). */
async function instantaneAvec(contexte, jeton, idsMessages = [], idsComptes = [], delaiMs = 60_000) {
  return attendre(
    contexte,
    async () => {
      const vue = await instantane(jeton);
      const manquants = [...idsMessages.filter((id) => !vue.messages.has(id)), ...idsComptes.filter((id) => !vue.comptes.has(id))];
      if (manquants.length > 0) throw new Error(`absent(s) du flux : ${manquants.map((id) => etiquettes.get(id) ?? id).join(", ")} (${vue.messages.size} messages, ${vue.comptes.size} comptes reçus)`);
      return vue;
    },
    delaiMs,
  );
}

/** Instantané où la ligne a disparu (retrait d'un membre). */
async function instantaneSans(contexte, jeton, idMessage, delaiMs = 60_000) {
  return attendre(contexte, async () => {
    const vue = await instantane(jeton);
    return vue.messages.has(idMessage) ? null : vue;
  }, delaiMs);
}

/**
 * Requête réelle d'un flux, lue dans `sync-config.yaml` et exécutée sur Postgres pour un
 * utilisateur donné (comme `j11-invitation.mjs` le fait pour `invitations_titulaire`) : une
 * seconde voie, indépendante du service PowerSync, pour les mêmes droits.
 */
function requeteDuFlux(nom) {
  const yaml = readFileSync(join(racineInstance(), "instance/powersync/sync-config.yaml"), "utf8");
  const bloc = new RegExp(`^ {2}${nom}:\\s*\\n([\\s\\S]*?)(?=^ {2}[a-z_]+:|(?![\\s\\S]))`, "m").exec(yaml)?.[1] ?? "";
  const requete = /query:\s*\|\s*\n([\s\S]*)/.exec(bloc)?.[1]?.trim().replace(/\s+/g, " ");
  if (!requete) fail(`requête du flux ${nom} introuvable`);
  return requete;
}

async function lignesDuFlux(nom, utilisateur, cabinet, id) {
  const requete = requeteDuFlux(nom)
    .replaceAll("auth.user_id()", `'${utilisateur}'`)
    .replaceAll("auth.parameter('cabinet_id')", `'${cabinet}'`);
  return entier(`SELECT COUNT(*) FROM (${requete}) flux WHERE id = '${id}'`);
}

// --------------------------------------------------------------------------------------------
// Aides d'accès aux données
// --------------------------------------------------------------------------------------------
async function messagesDeLApi(jeton) {
  return new Set(((await exiger("/messagerie/messages", jeton, "GET", undefined, "liste des messages")) ?? []).map((m) => m.id));
}

async function comptesDeLApi(jeton) {
  return new Map(((await exiger("/messagerie/comptes", jeton, "GET", undefined, "liste des comptes")) ?? []).map((c) => [c.id, c]));
}

async function sante(jeton) {
  return exiger("/messagerie/sante", jeton, "GET", undefined, "tableau de santé");
}

const ligneSante = (vue, compteId) => vue.comptes.find((c) => c.compte_id === compteId) ?? null;

async function messageDuCompte(compteId, messageId) {
  const id = await sqlServeur(`SELECT id FROM messages WHERE compte_id = '${compteId}' AND message_id = '${messageId}'`);
  return id || null;
}

async function nettoyer() {
  // Le moteur peut relever encore un message entre les deux suppressions : on recommence.
  for (let essai = 0; essai < 4; essai += 1) {
    const comptes = `SELECT id FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`;
    await sqlServeur(`DELETE FROM messages WHERE compte_id IN (${comptes})`).catch(() => {});
    await sqlServeur(`DELETE FROM moteur_connexions WHERE compte_id IN (${comptes})`).catch(() => {});
    await sqlServeur(`DELETE FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => {});
    await sqlServeur(`DELETE FROM messages WHERE message_id LIKE '<${PREFIXE}-%'`).catch(() => {});
    const reste = await sqlServeur(`SELECT COUNT(*) FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => "?");
    if (reste === "0") return;
    await sleep(1500);
  }
}

// --------------------------------------------------------------------------------------------
async function main() {
  const sain = await fetch(`${instance}/health`).catch(() => null);
  if (!sain?.ok) fail("instance injoignable");
  const dovecotTest = conteneur("legalos-imap-test-dovecot")[0];
  const greenmailTest = conteneur("legalos-imap-test-greenmail")[0];
  if (!dovecotTest || !greenmailTest) {
    fail("serveurs d'imap-test absents : docker compose -f instance/imap-test/docker-compose.yml up -d --wait");
  }
  connecterAuReseauApi(dovecotTest);
  connecterAuReseauApi(greenmailTest);

  await nettoyer();
  imap(dovecot, "purger");
  imap(greenmail, "purger");

  // ==========================================================================================
  // Trois collaborateurs : A (démo), B, C
  // ==========================================================================================
  const jetonA = await demoAccessToken(api, `j11-boites-a-${marque}`);
  const creerCollaborateur = async (lettre, totpSecret) => {
    const email = `j11-boites-${lettre}-${marque}@cabinet-fictif.example`;
    const mot = "MotDePasseCollab123!";
    await exiger("/collaborateurs", jetonA, "POST", { email, password: mot, totp_secret_base32: totpSecret }, `création du collaborateur ${lettre}`);
    const jeton = await accessToken(api, { email, password: mot, totpSecret, nomAppareil: `j11-boites-${lettre}-${marque}` });
    const id = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${email}'`);
    return { jeton, id };
  };
  const b = await creerCollaborateur("b", "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA");
  const c = await creerCollaborateur("c", "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI");
  const idA = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${demoEmail}'`);
  const cabinet = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${idA}'`);
  verifier("trois collaborateurs distincts", new Set([idA, b.id, c.id]).size === 3);

  const creerCompteNominatif = async (jeton, etiquette, { hote, port, utilisateur, motDePasse }) => {
    const id = nommer(randomUUID(), `compte ${etiquette}`);
    const adresse = `${PREFIXE}.${etiquette}.${marque}@cabinet.example`;
    const r = await requete("/messagerie/comptes", jeton, "POST", { id, adresse, hote, port, utilisateur, mot_de_passe: motDePasse, tls: false });
    verifier(`compte ${etiquette} créé`, r.statut === 200);
    verifier(`compte ${etiquette} : aucun mot de passe dans la réponse`, !r.texte.includes(motDePasse));
    return { id, adresse };
  };

  // ==========================================================================================
  // Boîte nominative de A (Dovecot) : historique, puis arrivée
  // ==========================================================================================
  const idHistorique = `<${PREFIXE}-histo-${marque}@example.com>`;
  imap(dovecot, "ajouter", { sujet: `Historique ${marque}`, messageId: idHistorique });
  const boiteA = await creerCompteNominatif(jetonA, "a", { hote: dovecotTest, port: 143, utilisateur: dovecot.login, motDePasse: MOT_IMAP_TEST });
  const msgHistorique = nommer(await attendre("relève initiale de la boîte de A", () => messageDuCompte(boiteA.id, idHistorique)), "mail historique de A");

  // Même boîte, mot de passe refusé : le refus d'authentification du tableau de santé.
  const boiteRefus = await creerCompteNominatif(jetonA, "refus", { hote: dovecotTest, port: 143, utilisateur: dovecot.login, motDePasse: "MauvaisMotDePasse123!" });
  await attendre("refus d'authentification noté", async () =>
    (await sqlServeur(`SELECT etat_connexion FROM comptes_mail WHERE id = '${boiteRefus.id}'`)) === "identifiants_refuses" ? true : null);

  // La première relève est terminée (UIDVALIDITY enregistré) : ce qui arrive ensuite est une arrivée.
  await attendre("première relève terminée", async () => {
    const validite = await sqlServeur(`SELECT uid_validity FROM releve_curseurs WHERE compte_id = '${boiteA.id}' AND dossier_imap = 'INBOX'`);
    return validite && validite !== "0" ? true : null;
  });
  const idArrivee = `<${PREFIXE}-arrivee-${marque}@example.com>`;
  imap(dovecot, "ajouter", { sujet: `Arrivee ${marque}`, messageId: idArrivee });
  const msgArrivee = nommer(await attendre("arrivée relevée dans la boîte de A", () => messageDuCompte(boiteA.id, idArrivee)), "mail arrivé chez A");

  // ==========================================================================================
  // Boîte nominative de B (sans serveur) et boîte de classement du cabinet
  // ==========================================================================================
  const boiteB = await creerCompteNominatif(b.jeton, "b", { hote: "injoignable.example", port: 143, utilisateur: "b", motDePasse: "MotDePasseB123!" });
  const msgB = nommer(randomUUID(), "mail de B");
  await sqlServeur(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
     VALUES ('${msgB}', '${cabinet}', '${boiteB.id}', '<${PREFIXE}-b-${marque}@example.com>', 1, 1, 'Boite de B ${marque}', 'tiers@example.com', 'a_classer')`,
  );
  // La boîte de classement du cabinet existe déjà sur une instance qui a servi ; sinon elle est
  // créée comme l'API le fait (jamais supprimée par la recette : des envois s'y rattachent).
  let classement = await sqlServeur(`SELECT id FROM comptes_mail WHERE cabinet_id = '${cabinet}' AND type_compte = 'classement'`);
  if (!classement) {
    classement = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
       VALUES ('${classement}', '${cabinet}', 'classement', NULL, 'demo', 'env:MESSAGERIE_IMAP')`,
    );
  }
  const msgCabinet = nommer(randomUUID(), "mail du cabinet");
  await sqlServeur(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
     VALUES ('${msgCabinet}', '${cabinet}', '${classement}', '<${PREFIXE}-cabinet-${marque}@example.com>', 1, ${900_000_000 + (Number.parseInt(marque, 16) % 99_000_000)}, 'Boite du cabinet ${marque}', 'tiers@example.com', 'a_classer')`,
  );

  // ==========================================================================================
  // Boîte partagée (GreenMail) : membres A et B ; C n'en est pas
  // ==========================================================================================
  const idPartage = `<${PREFIXE}-partage-${marque}@example.com>`;
  imap(greenmail, "ajouter", { sujet: `Partage ${marque}`, messageId: idPartage });
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
  verifier("boîte partagée : aucun mot de passe dans la réponse", !creation.texte.includes(MOT_IMAP_TEST));
  const msgPartage = nommer(await attendre("relève de la boîte partagée", () => messageDuCompte(partagee, idPartage)), "mail de la boîte partagée");
  const membres = await sqlServeur(`SELECT string_agg(utilisateur_id::text, ',' ORDER BY utilisateur_id::text) FROM membres_boite_partagee WHERE compte_id = '${partagee}'`);
  verifier("membres enregistrés : A et B, pas C", membres === [idA, b.id].sort().join(","));
  const partageLe = await sqlServeur(`SELECT boite_partagee::text FROM messages WHERE id = '${msgPartage}'`);
  verifier("le message de la boîte partagée est marqué comme tel", partageLe === "true");

  // Le mot de passe d'une boîte partagée est chiffré au repos.
  const secretPartage = await sqlServeur(`SELECT CASE WHEN position('${MOT_IMAP_TEST}' in secret_chiffre) > 0 THEN 'clair' ELSE 'chiffre' END FROM comptes_mail WHERE id = '${partagee}'`);
  verifier("secret de la boîte partagée chiffré", secretPartage === "chiffre");

  // ==========================================================================================
  // (h) API : qui lit quoi
  // ==========================================================================================
  const listeA = await messagesDeLApi(jetonA);
  const listeB = await messagesDeLApi(b.jeton);
  const listeC = await messagesDeLApi(c.jeton);
  const voit = (liste, id) => liste.has(id);

  verifier("API : A lit sa boîte nominative (historique et arrivée)", voit(listeA, msgHistorique) && voit(listeA, msgArrivee));
  essaiNegatif("API : un autre collaborateur lit la boîte de A", "B et C à la place du titulaire", () => voit(listeB, msgArrivee) || voit(listeC, msgArrivee) || voit(listeB, msgHistorique));
  verifier("API : B lit sa boîte nominative", voit(listeB, msgB));
  essaiNegatif("API : un autre collaborateur lit la boîte de B", "A et C à la place du titulaire", () => voit(listeA, msgB) || voit(listeC, msgB));
  verifier("API : les membres A et B lisent la boîte partagée", voit(listeA, msgPartage) && voit(listeB, msgPartage));
  essaiNegatif("API : un non-membre lit la boîte partagée", "C à la place d'un membre", () => voit(listeC, msgPartage));
  verifier("API : la boîte du cabinet reste lisible de tous (contrôle positif)", voit(listeA, msgCabinet) && voit(listeB, msgCabinet) && voit(listeC, msgCabinet));
  ok("API : boîtes nominatives lisibles de leur seul titulaire, boîte partagée de ses seuls membres");

  // Comptes connus de chacun.
  const comptesA = await comptesDeLApi(jetonA);
  const comptesB = await comptesDeLApi(b.jeton);
  const comptesC = await comptesDeLApi(c.jeton);
  verifier("API comptes : A connaît ses boîtes et la partagée", comptesA.has(boiteA.id) && comptesA.has(boiteRefus.id) && comptesA.has(partagee));
  verifier("API comptes : B connaît sa boîte et la partagée", comptesB.has(boiteB.id) && comptesB.has(partagee));
  essaiNegatif("API comptes : B connaît la boîte nominative de A", "B à la place de A", () => comptesB.has(boiteA.id) || comptesB.has(boiteRefus.id));
  essaiNegatif("API comptes : A connaît la boîte nominative de B", "A à la place de B", () => comptesA.has(boiteB.id));
  essaiNegatif("API comptes : C connaît une boîte qui n'est pas la sienne", "C n'est ni titulaire ni membre", () => comptesC.has(boiteA.id) || comptesC.has(boiteB.id) || comptesC.has(partagee));
  verifier("API comptes : aucun secret ni hôte dans la liste", !JSON.stringify([...comptesA.values()]).includes(MOT_IMAP_TEST) && ![...comptesA.values()].some((x) => "hote" in x || "secret_chiffre" in x));

  // Corps : 404 pour qui n'a pas le droit (jamais 403, rien n'est révélé) ; lecture réelle du
  // corps de la boîte partagée par un membre.
  const corps = (jeton, id) => requete(`/messagerie/messages/${id}/corps`, jeton, "POST");
  verifier("corps : B ne lit pas le corps d'un mail de A (404)", (await corps(b.jeton, msgArrivee)).statut === 404);
  // (Le mail arrivé n'est pas lu ici : la lecture le marquerait « lu » sur le serveur, et la
  // vérification de l'arrivée plus bas porte sur son état non lu.)
  const corpsA = await corps(jetonA, msgHistorique);
  verifier("corps : A lit le corps de son mail", corpsA.statut === 200 && String(corpsA.json?.texte).includes(`Historique ${marque}`));
  verifier("corps : C ne lit pas le corps de la boîte partagée (404)", (await corps(c.jeton, msgPartage)).statut === 404);
  const corpsMembre = await corps(b.jeton, msgPartage);
  verifier("corps : un membre lit le corps de la boîte partagée", corpsMembre.statut === 200 && String(corpsMembre.json?.texte).includes(`Partage ${marque}`));
  verifier("corps : B ne lit pas le corps d'un mail de A (404, contrôle croisé)", (await corps(b.jeton, msgHistorique)).statut === 404);
  verifier("corps : A ne lit pas le corps d'un mail de B (404)", (await corps(jetonA, msgB)).statut === 404);
  ok("API : corps de message refusé (404) aux non-titulaires et non-membres, lu par les ayants droit");

  // Santé : les boîtes d'autrui n'y figurent pas non plus.
  const santeA0 = await sante(jetonA);
  const santeB0 = await sante(b.jeton);
  const santeC0 = await sante(c.jeton);
  verifier("santé : A voit ses boîtes", ligneSante(santeA0, boiteA.id) !== null && ligneSante(santeA0, partagee) !== null);
  essaiNegatif("santé : B voit la boîte nominative de A", "B à la place de A", () => ligneSante(santeB0, boiteA.id) !== null);
  essaiNegatif("santé : C voit une boîte qui n'est pas la sienne", "C n'est ni titulaire ni membre", () => ligneSante(santeC0, boiteA.id) !== null || ligneSante(santeC0, partagee) !== null);

  // ==========================================================================================
  // (h) Flux de synchronisation : mêmes droits
  // ==========================================================================================
  const fluxA = await instantaneAvec("flux de A", jetonA, [msgHistorique, msgArrivee, msgPartage, msgCabinet], [boiteA.id, boiteRefus.id, partagee]);
  const fluxB = await instantaneAvec("flux de B", b.jeton, [msgB, msgPartage, msgCabinet], [boiteB.id, partagee]);
  const fluxC = await instantaneAvec("flux de C", c.jeton, [msgCabinet], []);
  const dansFlux = (flux, id) => flux.messages.has(id);
  const compteDansFlux = (flux, id) => flux.comptes.has(id);

  verifier("flux : A reçoit sa boîte nominative", dansFlux(fluxA, msgHistorique) && dansFlux(fluxA, msgArrivee));
  essaiNegatif("flux : un autre collaborateur reçoit la boîte de A", "B et C à la place du titulaire", () => dansFlux(fluxB, msgHistorique) || dansFlux(fluxB, msgArrivee) || dansFlux(fluxC, msgHistorique) || dansFlux(fluxC, msgArrivee));
  verifier("flux : B reçoit sa boîte nominative", dansFlux(fluxB, msgB));
  essaiNegatif("flux : un autre collaborateur reçoit la boîte de B", "A et C à la place du titulaire", () => dansFlux(fluxA, msgB) || dansFlux(fluxC, msgB));
  verifier("flux : les membres A et B reçoivent la boîte partagée", dansFlux(fluxA, msgPartage) && dansFlux(fluxB, msgPartage));
  essaiNegatif("flux : un non-membre reçoit la boîte partagée", "C à la place d'un membre", () => dansFlux(fluxC, msgPartage));
  verifier("flux : la boîte du cabinet (À classer) descend chez tous (contrôle positif)", dansFlux(fluxA, msgCabinet) && dansFlux(fluxB, msgCabinet) && dansFlux(fluxC, msgCabinet));
  // Le mail non classé d'une boîte partagée ne passe jamais par « À classer » du cabinet.
  const fluxPartageA = [...fluxA.messages.get(msgPartage).flux];
  verifier("flux : le mail partagé arrive par le flux des boîtes partagées", fluxPartageA.includes("messages_boites_partagees"));
  essaiNegatif("flux : le mail partagé passe par « À classer »", "le mail de la boîte du cabinet, lui, y passe", () => fluxPartageA.includes("messages_a_classer"));
  verifier("flux : le mail de la boîte du cabinet passe par « À classer » (inverse)", fluxC.messages.get(msgCabinet).flux.has("messages_a_classer"));
  // Comptes synchronisés.
  verifier("flux comptes : A reçoit ses boîtes nominatives et la partagée", compteDansFlux(fluxA, boiteA.id) && compteDansFlux(fluxA, boiteRefus.id) && compteDansFlux(fluxA, partagee));
  verifier("flux comptes : B reçoit sa boîte et la partagée", compteDansFlux(fluxB, boiteB.id) && compteDansFlux(fluxB, partagee));
  essaiNegatif("flux comptes : un autre collaborateur reçoit la boîte nominative d'autrui", "B reçoit celle de A, A celle de B", () => compteDansFlux(fluxB, boiteA.id) || compteDansFlux(fluxB, boiteRefus.id) || compteDansFlux(fluxA, boiteB.id));
  essaiNegatif("flux comptes : un non-membre reçoit la boîte partagée", "C à la place d'un membre", () => compteDansFlux(fluxC, partagee) || compteDansFlux(fluxC, boiteA.id) || compteDansFlux(fluxC, boiteB.id));
  verifier("flux comptes : ni mot de passe ni hôte synchronisés", ![...fluxA.comptes.values()].some((x) => "secret_chiffre" in x.colonnes || "hote" in x.colonnes || "empreinte_refus" in x.colonnes));
  ok("flux de synchronisation : mêmes droits que l'API, essais négatifs sur les deux voies");

  // Seconde voie : la requête réelle de chaque flux, exécutée sur Postgres pour chacun.
  const parRequete = async (nom, utilisateur, id) => (await lignesDuFlux(nom, utilisateur, cabinet, id)) === 1;
  verifier("requête de flux : messages_nominatifs renvoie le mail de A à A", await parRequete("messages_nominatifs", idA, msgArrivee));
  verifier("requête de flux : messages_nominatifs renvoie le mail de B à B", await parRequete("messages_nominatifs", b.id, msgB));
  const nominatifsAutrui = [
    await parRequete("messages_nominatifs", b.id, msgArrivee),
    await parRequete("messages_nominatifs", c.id, msgArrivee),
    await parRequete("messages_nominatifs", idA, msgB),
    await parRequete("messages_nominatifs", c.id, msgB),
  ];
  essaiNegatif("requête de flux : messages_nominatifs renvoie une boîte à un autre collaborateur", "autre que le titulaire", () => nominatifsAutrui.some(Boolean));
  verifier("requête de flux : comptes_nominatifs renvoie le compte de A à A", await parRequete("comptes_nominatifs", idA, boiteA.id));
  const comptesAutrui = [await parRequete("comptes_nominatifs", b.id, boiteA.id), await parRequete("comptes_nominatifs", c.id, boiteA.id), await parRequete("comptes_nominatifs", idA, boiteB.id)];
  essaiNegatif("requête de flux : comptes_nominatifs renvoie un compte à un autre collaborateur", "autre que le titulaire", () => comptesAutrui.some(Boolean));
  verifier("requête de flux : messages_boites_partagees renvoie le mail partagé aux membres A et B", (await parRequete("messages_boites_partagees", idA, msgPartage)) && (await parRequete("messages_boites_partagees", b.id, msgPartage)));
  const partageNonMembre = await parRequete("messages_boites_partagees", c.id, msgPartage);
  essaiNegatif("requête de flux : messages_boites_partagees renvoie le mail partagé à un non-membre", "C à la place d'un membre", () => partageNonMembre);
  verifier("requête de flux : comptes_partages renvoie la boîte partagée aux membres A et B", (await parRequete("comptes_partages", idA, partagee)) && (await parRequete("comptes_partages", b.id, partagee)));
  const comptePartageNonMembre = await parRequete("comptes_partages", c.id, partagee);
  essaiNegatif("requête de flux : comptes_partages renvoie la boîte partagée à un non-membre", "C à la place d'un membre", () => comptePartageNonMembre);
  verifier("requête de flux : messages_a_classer ne porte pas le mail partagé mais porte celui du cabinet", !(await parRequete("messages_a_classer", c.id, msgPartage)) && (await parRequete("messages_a_classer", c.id, msgCabinet)));
  ok("requêtes réelles des flux (nominatifs, boîtes partagées, comptes) exécutées pour A, B et C : mêmes droits");

  // ==========================================================================================
  // Retrait d'un membre : B perd la boîte partagée (API et flux), C la gagne
  // ==========================================================================================
  const membresBoite = `/messagerie/boites-partagees/${partagee}/membres`;
  verifier("membres : C (non-membre) ne lit pas la liste (404)", (await requete(membresBoite, c.jeton)).statut === 404);
  verifier("membres : C ne s'ajoute pas lui-même (404)", (await requete(membresBoite, c.jeton, "PUT", { membres: [c.id] })).statut === 404);
  verifier("membres : une boîte sans membre est refusée (400)", (await requete(membresBoite, jetonA, "PUT", { membres: [] })).statut === 400);
  verifier("membres : un inconnu du cabinet est refusé (400)", (await requete(membresBoite, jetonA, "PUT", { membres: [idA, randomUUID()] })).statut === 400);
  verifier("membres : A remplace B par C", (await requete(membresBoite, jetonA, "PUT", { membres: [idA, c.id] })).statut === 200);

  const listeB2 = await messagesDeLApi(b.jeton);
  const listeC2 = await messagesDeLApi(c.jeton);
  verifier("API : C, ajouté, lit la boîte partagée", voit(listeC2, msgPartage));
  essaiNegatif("API : B, retiré, lit encore la boîte partagée", "B avant son retrait la lisait (vérifié plus haut)", () => voit(listeB2, msgPartage));
  verifier("API : B, retiré, ne connaît plus le compte", !(await comptesDeLApi(b.jeton)).has(partagee));
  verifier("corps : B, retiré, reçoit 404", (await corps(b.jeton, msgPartage)).statut === 404);
  const fluxB2 = await instantaneSans("B retiré : le mail disparaît de son flux", b.jeton, msgPartage);
  const fluxC2 = await instantaneAvec("C ajouté : le mail arrive dans son flux", c.jeton, [msgPartage], [partagee]);
  essaiNegatif("flux : B, retiré, reçoit encore la boîte partagée", "B la recevait avant son retrait (vérifié plus haut)", () => dansFlux(fluxB2, msgPartage) || compteDansFlux(fluxB2, partagee));
  verifier("flux : C, ajouté, reçoit la boîte partagée et son compte", dansFlux(fluxC2, msgPartage) && compteDansFlux(fluxC2, partagee));
  verifier("flux : B garde sa boîte nominative après le retrait (contrôle positif)", dansFlux(fluxB2, msgB));
  ok("boîte partagée : retrait et ajout de membre suivis par l'API et le flux");

  // ==========================================================================================
  // Notification de bureau : l'arrivée est repérable par le poste
  // ==========================================================================================
  const colonnesArrivee = fluxA.messages.get(msgArrivee).colonnes;
  const colonnesHistorique = fluxA.messages.get(msgHistorique).colonnes;
  const notifiable = (colonnes) => Number(colonnes.arrivee_notifiable) === 1 || colonnes.arrivee_notifiable === true;
  verifier("arrivée : le mail arrivé après la première relève est notifiable", notifiable(colonnesArrivee));
  essaiNegatif("arrivée : un mail de l'historique est notifiable", "le mail de la première relève", () => notifiable(colonnesHistorique));
  essaiNegatif("arrivée : le mail de la boîte partagée relevé au démarrage est notifiable", "première relève de cette boîte", () => notifiable(fluxA.messages.get(msgPartage).colonnes));
  essaiNegatif("arrivée : un mail du cabinet posé en base est notifiable", "ni le moteur ni une arrivée", () => notifiable(fluxA.messages.get(msgCabinet).colonnes));
  const seqHistorique = Number(colonnesHistorique.arrivee_seq);
  const seqArrivee = Number(colonnesArrivee.arrivee_seq);
  verifier("arrivée : le rang d'arrivée croît (le poste garde le plus grand déjà traité)", Number.isFinite(seqHistorique) && Number.isFinite(seqArrivee) && seqArrivee > seqHistorique);
  essaiNegatif("arrivée : le rang du mail historique dépasse celui de l'arrivée", "ordre inverse", () => seqHistorique > seqArrivee);
  const nonLuArrivee = Number(colonnesArrivee.lu) === 0 || colonnesArrivee.lu === false;
  verifier(`arrivée : le flux porte l'état lu (lu=${JSON.stringify(colonnesArrivee.lu)}, drapeaux=${JSON.stringify(colonnesArrivee.drapeaux_texte)})`, nonLuArrivee);
  // Une seconde arrivée reçoit un rang plus grand encore et reste notifiable.
  const idArrivee2 = `<${PREFIXE}-arrivee2-${marque}@example.com>`;
  imap(dovecot, "ajouter", { sujet: `Arrivee bis ${marque}`, messageId: idArrivee2 });
  const msgArrivee2 = await attendre("seconde arrivée relevée", () => messageDuCompte(boiteA.id, idArrivee2));
  const fluxA3 = await instantaneAvec("flux de A (seconde arrivée)", jetonA, [msgArrivee2]);
  const col2 = fluxA3.messages.get(msgArrivee2).colonnes;
  verifier("arrivée : la seconde arrivée est notifiable", notifiable(col2));
  verifier("arrivée : son rang dépasse celui de la première", Number(col2.arrivee_seq) > seqArrivee);
  ok("notification de bureau : colonnes arrivee_notifiable et arrivee_seq synchronisées, historique exclu");

  // ==========================================================================================
  // Tableau de santé : dernière relève, refus d'authentification, envoi en échec, retard
  // ==========================================================================================
  const sA = await sante(jetonA);
  const bonne = ligneSante(sA, boiteA.id);
  verifier("santé : dernière relève réussie renseignée pour la boîte de A", typeof bonne?.derniere_releve_le === "string");
  verifier("santé : la boîte relevée est saine (connectée, sans alerte)", bonne.etat_connexion === "connecte" && bonne.alerte === false && bonne.motifs.length === 0 && bonne.erreurs_authentification === 0);
  verifier("santé : retard faible sur une boîte relevée à l'instant", bonne.retard_secondes < 300);
  const refusee = ligneSante(sA, boiteRefus.id);
  verifier("santé : le refus d'authentification est visible (état, motif, nombre, date)", refusee.etat_connexion === "identifiants_refuses" && refusee.motifs.includes("identifiants_refuses") && refusee.erreurs_authentification >= 1 && typeof refusee.derniere_erreur_authentification_le === "string" && refusee.alerte === true);
  essaiNegatif("santé : la boîte relevée porte un refus d'authentification", "la boîte relevée au lieu de la boîte refusée", () => bonne.motifs.includes("identifiants_refuses") || bonne.erreurs_authentification > 0);
  essaiNegatif("santé : la boîte refusée porte une dernière relève", "la boîte refusée n'a jamais été relevée", () => typeof refusee.derniere_releve_le === "string");
  verifier("santé : l'alerte générale s'allume dès qu'un compte ne se synchronise plus", sA.alerte === true);
  ok("tableau de santé : dernière relève, refus d'authentification, alerte");

  // Retard : une boîte créée il y a plus de 20 minutes et jamais relevée est en retard.
  const sB1 = await sante(b.jeton);
  const sansRetard = ligneSante(sB1, boiteB.id);
  essaiNegatif("santé : une boîte neuve est en retard", "boîte créée à l'instant", () => sansRetard.motifs.includes("retard"));
  await sqlServeur(`UPDATE comptes_mail SET cree_le = NOW() - INTERVAL '40 minutes' WHERE id = '${boiteB.id}'`);
  const enRetard = ligneSante(await sante(b.jeton), boiteB.id);
  verifier("santé : une boîte jamais relevée depuis 40 minutes est en retard", enRetard.motifs.includes("retard") && enRetard.alerte === true && enRetard.retard_secondes > 2000);
  await sqlServeur(`UPDATE comptes_mail SET cree_le = NOW() WHERE id = '${boiteB.id}'`);
  const remise = ligneSante(await sante(b.jeton), boiteB.id);
  essaiNegatif("santé : le retard persiste", "boîte remise à l'heure", () => remise.motifs.includes("retard"));

  // Envoi en échec : un envoi forcé en échec, vu de son auteur seul ; puis repris et confirmé.
  const echecsAvant = (await sante(jetonA)).envois_en_echec;
  const echecsAvantC = (await sante(c.jeton)).envois_en_echec;
  const envoi = randomUUID();
  await exiger("/messagerie/file-envoi", jetonA, "POST", {
    id: envoi,
    idempotence_cle: `j11-boites-${envoi}`,
    a: ["demo@cabinet.example"],
    objet: `Envoi ${marque}`,
    corps_html: "<p>Corps fictif.</p>",
  }, "création de l'envoi");
  await exiger(`/messagerie/file-envoi/${envoi}/mettre-en-attente`, jetonA, "POST");
  const echoue = await exiger(`/messagerie/file-envoi/${envoi}/traiter?couper_apres=echec`, jetonA, "POST");
  verifier("envoi : l'envoi forcé en échec reste en échec dans la file", echoue.etat === "echec");
  const sEchec = await sante(jetonA);
  verifier("santé : l'envoi en échec est compté pour son auteur", sEchec.envois_en_echec === echecsAvant + 1 && sEchec.alerte === true);
  const ligneClassement = sEchec.comptes.find((x) => x.type_compte === "classement");
  verifier("santé : l'envoi en échec figure sur le compte qui l'envoie, avec son motif", ligneClassement && ligneClassement.envois_en_echec >= 1 && ligneClassement.motifs.includes("envoi_en_echec"));
  const sEchecC = await sante(c.jeton);
  essaiNegatif("santé : l'envoi en échec de A est compté pour C", "un autre collaborateur", () => sEchecC.envois_en_echec > echecsAvantC);
  const repris = await exiger(`/messagerie/file-envoi/${envoi}/traiter`, jetonA, "POST");
  verifier("envoi : repris, il va jusqu'à « copie dans Envoyés confirmée »", repris.etat === "copie_envoyes_confirmee");
  const sRepris = await sante(jetonA);
  verifier("santé : l'alerte d'envoi tombe une fois l'envoi confirmé", sRepris.envois_en_echec === echecsAvant);
  essaiNegatif("santé : l'envoi en échec est encore compté après sa reprise", "avant la reprise il l'était", () => sRepris.envois_en_echec === echecsAvant + 1);
  ok("tableau de santé : envoi en échec compté pour son auteur, levé à la reprise ; retard d'une boîte non relevée");

  console.log("j11-boites: OK");
}

main()
  .catch((err) => {
    if (!process.exitCode) {
      console.error(`j11-boites: FAIL — ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    // Les boîtes de la recette ne doivent plus être relevées, et rien ne reste dans les boîtes de test.
    await nettoyer();
    for (const boite of [dovecot, greenmail]) {
      try {
        imap(boite, "purger");
      } catch {
        // Serveur de test déjà arrêté : rien à nettoyer.
      }
    }
  });
