#!/usr/bin/env node
/**
 * J11, critère (v-OAuth) — connexion OAuth 2.0 d'une boîte (Microsoft 365, Gmail), prouvée sur un fournisseur
 * simulé (`lib/simulateur-oauth.mjs`), un Dovecot qui valide XOAUTH2 par introspection et un relais SMTP qui
 * n'accepte que XOAUTH2. Données fictives.
 *
 *  1. le flux : `POST /messagerie/oauth/debut` (PKCE S256, `state`, redirection de bouclage), le « navigateur »
 *     suit l'adresse d'autorisation, le « poste » capte le code sur 127.0.0.1, `POST /messagerie/oauth/echange` ;
 *  2. aucun jeton ni code dans une réponse HTTP, dans la base en clair, dans les journaux de l'API ;
 *  3. la boîte sans mot de passe est relevée en IMAP XOAUTH2 (message déposé, relevé) et envoie en SMTP XOAUTH2 ;
 *  4. le jeton d'accès est renouvelé avant son expiration, le jeton de rafraîchissement tourne, cinq
 *     renouvellements simultanés n'en invalident aucun (verrou par boîte) ;
 *  5. un jeton révoqué : « identifiants refusés » à l'écran de santé (boîte OAuth), envoi refusé (409) ;
 *     la reconnexion rend la boîte au service ;
 *  6. essais négatifs : `state` inconnu, expiré, rejoué ; vérificateur PKCE faux ; autre utilisateur (état et boîte) ;
 *     fournisseur inconnu ou non configuré ; redirection hors bouclage ; adresses du simulateur non locales.
 *
 * Usage : node tests/recette/oauth-messagerie.mjs   (instance et banc imap-test démarrés)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { accessToken, demoAccessToken, demoEmail } from "./lib/demo-auth.mjs";
import { agirImap, connecterAuReseauApi, conteneur } from "./lib/moteur-mail.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { autoriserDansLeNavigateur, demarrerSimulateurOAuth } from "./lib/simulateur-oauth.mjs";
import { demarrerSmtpXoauth2 } from "./lib/smtp-xoauth2.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const racine = racineInstance();
const PORT_FOURNISSEUR = 18766; // écrit aussi dans instance/imap-test/dovecot-oauth2.conf.ext
const PORT_SMTP = 18767;
const PORT_IMAP_HOTE = 21143;
const NOM_DOVECOT = "legalos-j11-dovecot-oauth";
const PREFIXE = "oauth-recette";
const marque = randomUUID().slice(0, 8);

let verifications = 0;
const essaisNegatifs = [];

function fail(message) {
  console.error(`oauth-messagerie: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
function verifier(libelle, condition) {
  if (!condition) fail(libelle);
  verifications += 1;
}
function ok(message) {
  console.log(`oauth-messagerie: ${message}`);
}
/** Essai négatif : la situation inversée doit être refusée, et le contrôle positif accepté. */
function refus(libelle, reponse, statutsAttendus) {
  const attendus = Array.isArray(statutsAttendus) ? statutsAttendus : [statutsAttendus];
  if (!attendus.includes(reponse.statut)) fail(`essai négatif « ${libelle} » : ${reponse.statut} (attendu ${attendus.join(" ou ")})`);
  essaisNegatifs.push(libelle);
}

async function requete(chemin, jeton, methode = "GET", corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(60_000),
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

const sql = (requeteSql) => sqlServeur(requeteSql);

async function attendre(contexte, lecture, delaiMs = 60_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    const valeur = await lecture();
    if (valeur) return valeur;
    await sleep(700);
  }
  return fail(`${contexte} : délai dépassé (${delaiMs} ms)`);
}

function docker(...args) {
  const run = spawnSync("docker", args, { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`docker ${args.join(" ")} : ${(run.stderr || run.stdout).slice(-200)}`);
  return run.stdout.trim();
}

function lancerDovecot() {
  spawnSync("docker", ["rm", "-f", NOM_DOVECOT], { encoding: "utf8" });
  const lance = spawnSync(
    "docker",
    [
      "run", "-d", "--name", NOM_DOVECOT, "-p", `127.0.0.1:${PORT_IMAP_HOTE}:143`,
      "-v", `${join(racine, "instance/imap-test/dovecot-oauth.conf")}:/etc/dovecot/dovecot.conf:ro`,
      "-v", `${join(racine, "instance/imap-test/dovecot-oauth2.conf.ext")}:/etc/dovecot/dovecot-oauth2.conf.ext:ro`,
      "--entrypoint", "sh", "dovecot/dovecot:2.3.21.1",
      "-c", "mkdir -p /tmp/mail && chown -R dovecot:dovecot /tmp/mail && exec dovecot -F",
    ],
    { encoding: "utf8" },
  );
  if (lance.status !== 0) fail(`Dovecot OAuth : ${(lance.stderr || "").slice(0, 300)}`);
  connecterAuReseauApi(NOM_DOVECOT);
}

/** Le « poste » : écoute 127.0.0.1 sur un port libre et capte la redirection du navigateur. */
function ecouterBouclage() {
  return new Promise((resolve) => {
    let livrer;
    const recu = new Promise((res) => {
      livrer = res;
    });
    const http = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("Connexion reçue : vous pouvez fermer cette fenêtre.");
      livrer({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), erreur: url.searchParams.get("error") });
    });
    http.listen(0, "127.0.0.1", () => {
      resolve({ port: http.address().port, attendre: () => recu, fermer: () => http.close() });
    });
  });
}

const HOTES_SIMULATEUR = {
  imap_hote: NOM_DOVECOT,
  imap_port: 143,
  imap_tls: false,
  smtp_hote: "host.docker.internal",
  smtp_port: PORT_SMTP,
  smtp_chiffrement: "aucun",
};

function corpsDebut({ id, adresse, redirection, fournisseur = "simulateur", extra = {} }) {
  return {
    id,
    adresse,
    fournisseur,
    redirection,
    auth_url: `http://127.0.0.1:${PORT_FOURNISSEUR}/authorize`,
    jeton_url: `http://host.docker.internal:${PORT_FOURNISSEUR}/token`,
    hotes: HOTES_SIMULATEUR,
    ...extra,
  };
}

/** Un parcours complet jusqu'au code capté par le « poste » ; rend ce que le poste transmettrait à l'instance. */
async function parcours(jeton, { id, adresse, options = {} }) {
  const boucle = await ecouterBouclage();
  try {
    const redirection = `http://127.0.0.1:${boucle.port}/`;
    const debut = await requete("/messagerie/oauth/debut", jeton, "POST", corpsDebut({ id, adresse, redirection }));
    verifier(`début de connexion → ${debut.statut}`, debut.statut === 200);
    const navigateur = await autoriserDansLeNavigateur(debut.json.url, options);
    verifier("le fournisseur redirige vers le bouclage", navigateur.statut === 302 && navigateur.location.startsWith(redirection));
    await fetch(navigateur.location);
    const recu = await boucle.attendre();
    return { debut: debut.json, recu, redirection };
  } finally {
    boucle.fermer();
  }
}

const echanger = (jeton, state, code) => requete("/messagerie/oauth/echange", jeton, "POST", { state, code });

async function main() {
  const sain = await fetch(`${instance}/health`).catch(() => null);
  if (!sain?.ok) fail("instance injoignable");

  // Contrôle statique : aucune colonne de jeton dans les règles de synchronisation.
  const regles = readFileSync(join(racine, "instance/powersync/sync-config.yaml"), "utf8");
  verifier("les règles de synchronisation ne citent aucun jeton OAuth", !/jeton_|oauth_/iu.test(regles));

  const fournisseur = await demarrerSimulateurOAuth({ port: PORT_FOURNISSEUR, dureeJetonSecondes: 100 });
  const smtp = await demarrerSmtpXoauth2({ port: PORT_SMTP, verifier: (jeton) => fournisseur.accesValide(jeton) });
  const debutJournaux = new Date().toISOString();
  try {
    lancerDovecot();
    await attendre("Dovecot OAuth prêt", async () => {
      try {
        agirImap({ hote: "127.0.0.1", port: PORT_IMAP_HOTE, utilisateur: `pret-${marque}`, action: "creer", uid: "1" });
        return true;
      } catch {
        return false;
      }
    }, 40_000);

    const jetonA = await demoAccessToken(api, `${PREFIXE}-a-${marque}`);
    const emailB = `${PREFIXE}-b-${marque}@cabinet-fictif.example`;
    const motB = "MotDePasseCollab123!";
    const totpB = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
    const creation = await requete("/collaborateurs", jetonA, "POST", { email: emailB, password: motB, totp_secret_base32: totpB });
    verifier(`création du collaborateur B → ${creation.statut}`, creation.statut >= 200 && creation.statut < 300);
    let jetonB = null;
    for (let essai = 0; essai < 3 && !jetonB; essai += 1) {
      try {
        jetonB = await accessToken(api, { email: emailB, password: motB, totpSecret: totpB, nomAppareil: `${PREFIXE}-b-${marque}-${Date.now()}` });
      } catch {
        await sleep(31_000);
      }
    }
    verifier("connexion de B", jetonB !== null);

    // ======================================================================================
    // 1. Le flux de bout en bout
    // ======================================================================================
    const id = randomUUID();
    const adresse = `${PREFIXE}.${marque}@cabinet.example`;
    const liste = await requete("/messagerie/oauth/fournisseurs", jetonA);
    verifier("liste des fournisseurs : réponse sans secret", liste.statut === 200 && Array.isArray(liste.json?.fournisseurs) && !/secret/iu.test(liste.texte));
    const p = await parcours(jetonA, { id, adresse });
    verifier("le poste capte un code et le state de la demande", Boolean(p.recu.code) && p.recu.state === p.debut.state);
    const url = new URL(p.debut.url);
    verifier("adresse d'autorisation : PKCE S256, state, redirection de bouclage", url.searchParams.get("code_challenge_method") === "S256" && (url.searchParams.get("code_challenge") ?? "").length >= 43 && url.searchParams.get("state") === p.debut.state && url.searchParams.get("redirect_uri") === p.redirection);
    verifier("le vérificateur PKCE n'est pas dans la réponse de début", !/code_verifier|pkce_verifier/iu.test(JSON.stringify(p.debut)));
    verifier("le fournisseur a reçu l'adresse en indice (login_hint)", fournisseur.etat.derniersParametres.login_hint === adresse);

    const echange = await echanger(jetonA, p.debut.state, p.recu.code);
    verifier(`échange du code → ${echange.statut}`, echange.statut === 200 && echange.json.id === id && echange.json.reconnexion === false);
    const jetons = fournisseur.jetonsEmis();
    const tous = [...jetons.acces, ...jetons.rafraichissements, p.recu.code];
    verifier("aucun jeton ni code dans la réponse d'échange", tous.every((valeur) => !echange.texte.includes(valeur)));
    const ligne = await sql(`SELECT secret_ref || '|' || fournisseur || '|' || oauth_generation::text || '|' || COALESCE(smtp_chiffrement, '') || '|' || (secret_chiffre IS NULL)::text || '|' || (jeton_rafraichissement_chiffre || jeton_acces_chiffre) FROM comptes_mail WHERE id = '${id}'`);
    const [secretRef, fourn, generation, chiffrement, sansMotDePasse, jetonsChiffres] = ligne.split("|");
    verifier("compte OAuth créé : sans mot de passe, génération 0, SMTP en clair du banc", secretRef === "oauth" && fourn === "simulateur" && generation === "0" && sansMotDePasse === "true" && chiffrement === "aucun");
    verifier("jetons chiffrés en base (aucun jeton en clair)", tous.every((valeur) => !jetonsChiffres.includes(valeur)) && jetonsChiffres.length > 40);
    for (const chemin of ["/messagerie/comptes", "/messagerie/sante", "/messagerie/oauth/fournisseurs"]) {
      const lecture = await requete(chemin, jetonA);
      verifier(`${chemin} : aucun jeton dans la réponse`, lecture.statut === 200 && fournisseur.jetonsEmis().acces.every((valeur) => !lecture.texte.includes(valeur)) && !/jeton_(acces|rafraichissement)/iu.test(lecture.texte));
    }
    ok("flux : début, navigateur, bouclage, échange ; jetons chiffrés, absents des réponses");

    // ======================================================================================
    // 2. IMAP XOAUTH2 : la boîte (sans mot de passe) est relevée
    // ======================================================================================
    const messageId = `<oauth-${marque}-1@legalos.test>`;
    agirImap({ hote: "127.0.0.1", port: PORT_IMAP_HOTE, utilisateur: adresse, action: "ajouter", uid: "1", messageId, sujet: `Courrier OAuth ${marque}` });
    await attendre("message relevé par XOAUTH2", async () => (await sql(`SELECT COUNT(*) FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`)) === "1", 90_000);
    verifier("la relève a utilisé un jeton renouvelé du fournisseur", fournisseur.etat.renouvellements >= 1);
    const sante = await requete("/messagerie/sante", jetonA);
    const compteSante = sante.json.comptes.find((c) => c.compte_id === id);
    await attendre("état connecté", async () => (await sql(`SELECT etat_connexion FROM comptes_mail WHERE id = '${id}'`)) === "connecte", 60_000);
    verifier("santé : boîte OAuth, fournisseur annoncé", compteSante?.oauth === true && compteSante?.fournisseur === "simulateur");
    ok("IMAP XOAUTH2 : message déposé dans Dovecot relevé, boîte sans mot de passe");

    // ======================================================================================
    // 3. SMTP XOAUTH2 : un envoi depuis la boîte OAuth
    // ======================================================================================
    agirImap({ hote: "127.0.0.1", port: PORT_IMAP_HOTE, utilisateur: adresse, action: "creer", uid: "1" });
    const idBrouillon = randomUUID();
    const destinataire = `dest.${marque}@example.com`;
    const ecriture = await requete(`/messagerie/brouillons/${idBrouillon}`, jetonA, "PUT", {
      compte_id: id,
      a: [destinataire],
      cci: [],
      objet: `Envoi OAuth ${marque}`,
      corps_html: "<p>Message fictif.</p>",
    });
    verifier(`brouillon depuis la boîte OAuth → ${ecriture.statut}`, ecriture.statut === 200);
    const envoi = await requete(`/messagerie/brouillons/${idBrouillon}/envoyer`, jetonA, "POST");
    verifier(`mise en file → ${envoi.statut}`, envoi.statut === 200);
    await requete(`/messagerie/file-envoi/${idBrouillon}/mettre-en-attente`, jetonA, "POST");
    const traite = await requete(`/messagerie/file-envoi/${idBrouillon}/traiter`, jetonA, "POST");
    verifier(`envoi traité (${traite.json?.etat})`, traite.statut === 200 && traite.json?.etat === "copie_envoyes_confirmee");
    const recuSmtp = smtp.messages.find((m) => m.donnees.includes(`Envoi OAuth ${marque}`));
    verifier("le relais SMTP a reçu le message authentifié en XOAUTH2 au nom de la boîte", recuSmtp?.authentifie === adresse && recuSmtp.de === adresse && recuSmtp.a.includes(destinataire));
    verifier("aucune authentification SMTP refusée", smtp.authentifications.reussies >= 1 && smtp.authentifications.refusees === 0);
    ok("SMTP XOAUTH2 : message envoyé depuis la boîte, copie dans Envoyés confirmée");

    // ======================================================================================
    // 4. Renouvellement : le jeton de rafraîchissement tourne, cinq demandes simultanées
    // ======================================================================================
    const avantRenouvellements = fournisseur.etat.renouvellements;
    const simultanes = await Promise.all(Array.from({ length: 5 }, () => requete("/messagerie/oauth/renouveler", jetonA, "POST", { id })));
    verifier("cinq renouvellements simultanés : tous acceptés", simultanes.every((r) => r.statut === 200 && r.json?.renouvele === true));
    verifier("aucun ancien jeton de rafraîchissement représenté après rotation", fournisseur.etat.ancienRefusApresRotation === 0);
    verifier("chaque renouvellement a tourné le jeton chez le fournisseur", fournisseur.etat.renouvellements >= avantRenouvellements + 5);
    verifier("les réponses de renouvellement ne portent aucun jeton", simultanes.every((r) => fournisseur.jetonsEmis().acces.every((v) => !r.texte.includes(v))));
    ok("renouvellement : rotation du jeton de rafraîchissement, cinq demandes simultanées sans perte");

    // ======================================================================================
    // 5. Jeton révoqué, puis reconnexion
    // ======================================================================================
    fournisseur.revoquer();
    await attendre("boîte marquée « identifiants refusés »", async () => (await sql(`SELECT etat_connexion FROM comptes_mail WHERE id = '${id}'`)) === "identifiants_refuses", 90_000);
    const apresRevocation = await requete("/messagerie/sante", jetonA);
    const compteRevoque = apresRevocation.json.comptes.find((c) => c.compte_id === id);
    verifier("santé : alerte « identifiants refusés » sur une boîte OAuth (le poste propose « Reconnecter »)", compteRevoque?.alerte === true && compteRevoque.motifs.includes("identifiants_refuses") && compteRevoque.oauth === true);
    // Écrire un brouillon n'exige pas le fournisseur (la copie IMAP se fait en tâche de fond) ; l'envoyer, si.
    const idRevoque = randomUUID();
    const ecritureRevoquee = await requete(`/messagerie/brouillons/${idRevoque}`, jetonA, "PUT", { compte_id: id, a: [destinataire], objet: "Après révocation", corps_html: "<p>x</p>" });
    verifier(`contrôle positif : le brouillon s'écrit sur la boîte révoquée (${ecritureRevoquee.statut})`, ecritureRevoquee.statut === 200);
    refus("envoi depuis une boîte dont le jeton est révoqué", await requete(`/messagerie/brouillons/${idRevoque}/envoyer`, jetonA, "POST"), 409);

    const reconnexion = await parcours(jetonA, { id, adresse });
    const echangeBis = await echanger(jetonA, reconnexion.debut.state, reconnexion.recu.code);
    verifier(`reconnexion → ${echangeBis.statut}`, echangeBis.statut === 200 && echangeBis.json.reconnexion === true && echangeBis.json.id === id);
    const apres = await sql(`SELECT oauth_generation::text || '|' || etat_connexion FROM comptes_mail WHERE id = '${id}'`);
    verifier("reconnexion : génération 1, état remis à zéro", apres.split("|")[0] === "1");
    const messageIdBis = `<oauth-${marque}-2@legalos.test>`;
    agirImap({ hote: "127.0.0.1", port: PORT_IMAP_HOTE, utilisateur: adresse, action: "ajouter", uid: "2", messageId: messageIdBis, sujet: `Après reconnexion ${marque}` });
    await attendre("message relevé après la reconnexion", async () => (await sql(`SELECT COUNT(*) FROM messages WHERE compte_id = '${id}' AND message_id = '${messageIdBis}'`)) === "1", 90_000);
    await attendre("boîte reconnectée", async () => (await sql(`SELECT etat_connexion FROM comptes_mail WHERE id = '${id}'`)) === "connecte", 60_000);
    ok("révocation : « identifiants refusés » à l'écran de santé, envoi refusé ; reconnexion : boîte relevée de nouveau");

    // ======================================================================================
    // 6. Essais négatifs
    // ======================================================================================
    const nouvelle = () => ({ id: randomUUID(), adresse: `${PREFIXE}.neg-${randomUUID().slice(0, 6)}@cabinet.example` });

    refus("state inconnu", await echanger(jetonA, "etat-inconnu-" + randomUUID(), "code"), 404);

    {
      const demande = nouvelle();
      const q = await parcours(jetonA, demande);
      await sql(`UPDATE oauth_etats SET expire_le = NOW() - INTERVAL '1 minute' WHERE state = '${q.debut.state}'`);
      refus("state expiré", await echanger(jetonA, q.debut.state, q.recu.code), 404);
      verifier("un state expiré n'a pas créé de boîte", (await sql(`SELECT COUNT(*) FROM comptes_mail WHERE id = '${demande.id}'`)) === "0");
    }

    {
      const demande = nouvelle();
      const q = await parcours(jetonA, demande);
      const premiere = await echanger(jetonA, q.debut.state, q.recu.code);
      verifier("contrôle positif : le premier échange réussit", premiere.statut === 200);
      refus("state rejoué", await echanger(jetonA, q.debut.state, q.recu.code), 404);
      await sql(`DELETE FROM comptes_mail WHERE id = '${demande.id}'`);
    }

    {
      const demande = nouvelle();
      const q = await parcours(jetonA, demande);
      const avantRefus = fournisseur.etat.refusPkce;
      await sql(`UPDATE oauth_etats SET pkce_verifier = repeat('x', 64) WHERE state = '${q.debut.state}'`);
      refus("vérificateur PKCE faux", await echanger(jetonA, q.debut.state, q.recu.code), 400);
      verifier("le fournisseur a refusé le vérificateur (PKCE contrôlé)", fournisseur.etat.refusPkce === avantRefus + 1);
      verifier("PKCE faux : aucune boîte créée", (await sql(`SELECT COUNT(*) FROM comptes_mail WHERE id = '${demande.id}'`)) === "0");
      refus("state consommé même après un échec", await echanger(jetonA, q.debut.state, q.recu.code), 404);
    }

    {
      const demande = nouvelle();
      const q = await parcours(jetonA, demande);
      refus("autre utilisateur : le state de A présenté par B", await echanger(jetonB, q.debut.state, q.recu.code), 404);
      const legitime = await echanger(jetonA, q.debut.state, q.recu.code);
      verifier("contrôle positif : A, titulaire, termine sa connexion (le state n'a pas été consommé par B)", legitime.statut === 200);
      await sql(`DELETE FROM comptes_mail WHERE id = '${demande.id}'`);
    }

    {
      const boucle = await ecouterBouclage();
      const redirection = `http://127.0.0.1:${boucle.port}/`;
      refus("autre utilisateur : B reconnecte la boîte de A", await requete("/messagerie/oauth/debut", jetonB, "POST", corpsDebut({ id, adresse, redirection })), 404);
      refus("autre utilisateur : B renouvelle le jeton de la boîte de A", await requete("/messagerie/oauth/renouveler", jetonB, "POST", { id }), 404);
      const controle = await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ id, adresse, redirection }));
      verifier("contrôle positif : A reconnecte sa boîte", controle.statut === 200);
      boucle.fermer();
    }

    {
      const boucle = await ecouterBouclage();
      const redirection = `http://127.0.0.1:${boucle.port}/`;
      const d = nouvelle();
      refus("fournisseur inconnu", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, fournisseur: "autre" })), 400);
      const configures = (liste.json?.fournisseurs ?? []).map((f) => f.id);
      if (!configures.includes("microsoft")) refus("Microsoft non configuré sur cette instance", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, fournisseur: "microsoft" })), 400);
      if (!configures.includes("gmail")) refus("Gmail non configuré sur cette instance", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, fournisseur: "gmail" })), 400);
      for (const mauvaise of [
        "https://127.0.0.1:49152/", "http://localhost:49152/", "http://127.0.0.1/", "http://127.0.0.1:80/",
        "http://127.0.0.1:49152/autre", "http://127.0.0.1:49152/?x=1", "http://[::1]:49152/", "http://evil.example:49152/",
        "http://127.0.0.1.evil.example:49152/", "javascript:alert(1)",
      ]) {
        refus(`redirection refusée : ${mauvaise}`, await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection: mauvaise })), 400);
      }
      refus("adresse de la boîte invalide (retour à la ligne)", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, adresse: "a@b.example\r\nBcc: x@y.example" })), 400);
      refus("simulateur : adresse de jeton non locale", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, extra: { jeton_url: "http://evil.example:80/token" } })), 400);
      refus("simulateur : adresse d'autorisation non locale", await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection, extra: { auth_url: "https://evil.example/authorize" } })), 400);
      const controle = await requete("/messagerie/oauth/debut", jetonA, "POST", corpsDebut({ ...d, redirection }));
      verifier("contrôle positif : la même demande, conforme, est acceptée", controle.statut === 200);
      boucle.fermer();
    }

    {
      // Dix demandes ouvertes par un même utilisateur : seules les plus récentes sont gardées.
      const boucle = await ecouterBouclage();
      const redirection = `http://127.0.0.1:${boucle.port}/`;
      for (let i = 0; i < 8; i += 1) await requete("/messagerie/oauth/debut", jetonB, "POST", corpsDebut({ ...nouvelle(), redirection }));
      const restantes = Number(await sql(`SELECT COUNT(*) FROM oauth_etats WHERE titulaire_id = (SELECT id FROM utilisateurs WHERE email = '${emailB}')`));
      verifier(`demandes en attente bornées par utilisateur (${restantes})`, restantes <= 5);
      boucle.fermer();
    }
    ok(`essais négatifs : ${essaisNegatifs.length} refus constatés, chacun avec son contrôle positif`);

    // ======================================================================================
    // 7. Journaux : ni jeton ni code
    // ======================================================================================
    const [api1] = conteneur("legalos-instance-api");
    const journaux = docker("logs", "--since", debutJournaux, api1);
    const secrets = [...fournisseur.jetonsEmis().acces, ...fournisseur.jetonsEmis().rafraichissements];
    verifier("journaux de l'API : aucun jeton", secrets.every((valeur) => !journaux.includes(valeur)));
    verifier("journaux de l'API : aucun code ni vérificateur", !/code-[A-Za-z0-9_-]{20,}|code_verifier/u.test(journaux));
    ok("journaux de l'API : ni jeton, ni code d'autorisation, ni vérificateur");

    await sql(`DELETE FROM actions_messages WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%')`);
    await sql(`DELETE FROM file_envoi WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%')`);
    console.log(`oauth-messagerie: OK — ${verifications} vérifications, ${essaisNegatifs.length} essais négatifs (démo ${demoEmail})`);
  } finally {
    // LEGALOS_RECETTE_GARDER=1 : après un échec, laisse la base, Dovecot et les simulateurs en place pour les examiner.
    if (process.env.LEGALOS_RECETTE_GARDER === "1" && process.exitCode) {
      console.error("oauth-messagerie: état gardé pour examen (simulateurs arrêtés à la fin du processus, Dovecot laissé)");
      await new Promise((resolve) => setTimeout(resolve, 120_000));
    }
    await nettoyer();
    await fournisseur.arreter();
    await smtp.arreter();
    spawnSync("docker", ["rm", "-f", NOM_DOVECOT], { encoding: "utf8" });
  }
}

async function nettoyer() {
  for (let essai = 0; essai < 4; essai += 1) {
    const comptes = `SELECT id FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`;
    for (const table of ["actions_messages", "messages", "moteur_connexions", "releve_curseurs", "file_envoi", "brouillons_message"]) {
      await sql(`DELETE FROM ${table} WHERE compte_id IN (${comptes})`).catch(() => {});
    }
    await sql(`DELETE FROM oauth_etats WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => {});
    await sql(`DELETE FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => {});
    const reste = await sql(`SELECT COUNT(*) FROM comptes_mail WHERE adresse LIKE '${PREFIXE}.%'`).catch(() => "?");
    if (reste === "0") return;
    await sleep(1500);
  }
}

main().catch((err) => {
  if (!process.exitCode) {
    console.error(`oauth-messagerie: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
});
