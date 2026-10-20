#!/usr/bin/env node
/**
 * J11, critère (v) — écrans de connexion d'une boîte (IMAP/SMTP) et de santé, dans l'app Tauri (Réglages, Messagerie,
 * « Comptes »), sur un vrai serveur IMAP (Dovecot d'imap-test) et l'API réelle. Services requis : instance Docker et
 * instance/imap-test. Le volet OAuth n'est pas couvert : sa route de retour n'existe pas (question à l'architecte).
 *
 * Prouve, par le DOM de l'app, chacun avec un essai négatif :
 *  1. la santé : une boîte au bon mot de passe est « Connectée », une boîte au mauvais « Identifiants refusés » (tentatives
 *     suspendues, bouton « Reconnecter » en avant) ; la boîte d'un confrère n'y figure pas ;
 *  2. le formulaire refuse une saisie incomplète sans appeler le serveur ;
 *  3. reconnecter avec un mauvais mot de passe : la boîte reste « Identifiants refusés » ;
 *  4. reconnecter avec le bon : « Connectée », sans autre geste ;
 *  5. ajouter une boîte : saisie invalide refusée avant tout appel ; saisie valide : la boîte apparaît « Connectée » ;
 *  6. aucun identifiant ne reste sur le poste (page, stockage du navigateur, base locale) ni en clair sur le serveur.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerClientImap } from "./lib/imap-controle.mjs";
import { MOT_IMAP_TEST, conteneur, connecterAuReseauApi } from "./lib/moteur-mail.mjs";
import { creerSession, racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { creerUi, lit, norm } from "./lib/ui-mails.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dossierCaptures = join(racine, "design", "captures", "j11-mails");
const session = creerSession("j11-connexion");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, fermer } = session;

const marque = String(Date.now()).slice(-6);
let send;
const ui = creerUi({ getSend: () => send, fail, dossierCaptures });
const { js, cliquer, texteDe, present, compter, sqliteLocal, saisir, attendre, verifier, essaiNegatif, capturer } = ui;

const capa = creerClientImap({ hote: "127.0.0.1", port: "1143", login: "capa", secret: MOT_IMAP_TEST });
const MAUVAIS = `MauvaisMotDePasse-${marque}`;
const PREFIXE = "connexion";
const adresse = (nom) => `${PREFIXE}.${nom}.${marque}@cabinet.example`;

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

const WHERE_COMPTES = `adresse LIKE '${PREFIXE}.%@cabinet.example'`;
async function retirerComptes() {
  const ids = `SELECT id FROM comptes_mail WHERE ${WHERE_COMPTES}`;
  for (const requete of [
    `DELETE FROM actions_messages WHERE compte_id IN (${ids})`,
    `DELETE FROM file_envoi WHERE compte_id IN (${ids})`,
    `DELETE FROM releve_curseurs WHERE compte_id IN (${ids})`,
    `DELETE FROM moteur_connexions WHERE compte_id IN (${ids})`,
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
    console.log("j11-connexion: démarrage de instance/imap-test (Dovecot)");
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

async function main() {
  await session.assurerInstance();
  const dovecot = await demarrerImapTest();
  const jeton = await demoAccessToken(api, `j11-connexion-${marque}`);
  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(demoEmail)}`);
  if (!demoId) fail("utilisateur démo absent");
  const cabinetId = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${demoId}'`);
  const autreId = await sqlServeur(`SELECT id FROM utilisateurs WHERE id <> '${demoId}' AND cabinet_id = '${cabinetId}' LIMIT 1`);
  verifier("un confrère existe (l'essai négatif de visibilité a un sens)", /^[0-9a-f-]{36}$/u.test(autreId));

  console.log("j11-connexion: décor : nettoyage, une boîte au bon mot de passe, une au mauvais, la boîte d'un confrère");
  await retirerComptes();
  const compteBon = randomUUID();
  const compteRefuse = randomUUID();
  const compteConfrere = randomUUID();
  const boite = (id, nom, motDePasse) =>
    json("/messagerie/comptes", jeton, "POST", {
      id,
      adresse: adresse(nom),
      hote: dovecot,
      port: 143,
      utilisateur: "capa",
      mot_de_passe: motDePasse,
      tls: false,
    });
  await boite(compteBon, "bon", MOT_IMAP_TEST);
  await boite(compteRefuse, "refuse", MAUVAIS);
  await sqlServeur(
    `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref, hote, port, utilisateur, tls)
     VALUES ('${compteConfrere}', '${cabinetId}', 'nominatif', '${autreId}', ${lit(adresse("confrere"))}, 'test', 'injoignable.example', 143, 'x', FALSE)`,
  );
  const etatServeur = (id) => sqlServeur(`SELECT etat_connexion FROM comptes_mail WHERE id = '${id}'`);
  await attendre("le moteur a essayé la boîte au bon mot de passe", () => etatServeur(compteBon), (v) => v === "connecte", 120_000);
  await attendre("le moteur a essayé la boîte au mauvais mot de passe", () => etatServeur(compteRefuse), (v) => v === "identifiants_refuses", 120_000);

  resetPostes(["jcnx"]);
  let poste = null;
  try {
    poste = await ouvrirPoste("jcnx", 9371, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Connexion ${marque}`,
    });
    send = poste.page.send;
    await attendre(
      "synchronisation des boîtes",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM comptes_mail WHERE adresse IN (${lit(adresse("bon"))}, ${lit(adresse("refuse"))})`),
      (r) => Number(r?.[0]?.n) === 2,
      120_000,
    );
    await cliquer("[data-testid=menu-compte]");
    await cliquer("[data-testid=menu-reglages]");
    await attendre("rubrique Messagerie des réglages", () => present("[data-testid=reglages-messagerie]"), Boolean, 30_000);

    const ligne = (id) => `[data-testid=compte-sante][data-compte-id="${id}"]`;
    const etat = (id) => texteDe(`${ligne(id)} [data-testid=compte-etat]`);
    const detail = (id) => texteDe(`${ligne(id)} [data-testid=compte-detail]`);

    // ===== 1. Santé =====
    await attendre("la boîte au bon mot de passe affichée", () => present(ligne(compteBon)), Boolean, 60_000);
    await attendre("la boîte au bon mot de passe est connectée", () => etat(compteBon), (t) => norm(t) === "Connectée", 60_000);
    await attendre("la boîte au mauvais mot de passe est refusée", () => etat(compteRefuse), (t) => norm(t) === "Identifiants refusés", 60_000);
    verifier("boîte refusée : tentatives suspendues", norm(await detail(compteRefuse)).includes("Les tentatives sont suspendues."), await detail(compteRefuse));
    verifier("boîte refusée : « Reconnecter » en avant", (await texteDe(`${ligne(compteRefuse)} [data-testid=compte-reconnecter]`)) === "Reconnecter" && (await js(`document.querySelector(${JSON.stringify(`${ligne(compteRefuse)} [data-testid=compte-reconnecter]`)})?.getAttribute("data-fort")`)) === "true");
    verifier("boîte connectée : « Modifier »", (await texteDe(`${ligne(compteBon)} [data-testid=compte-reconnecter]`)) === "Modifier");
    verifier("la boîte connectée donne sa dernière relève", /Relevée/u.test(await detail(compteBon)), await detail(compteBon));
    essaiNegatif("la boîte aux identifiants refusés est dite connectée", norm(await etat(compteRefuse)) === "Connectée");
    essaiNegatif("la boîte d'un confrère figure dans les comptes de l'avocat", await present(ligne(compteConfrere)));
    essaiNegatif("l'adresse d'un confrère figure dans l'écran", norm(await texteDe("[data-testid=comptes-messagerie]")).includes(adresse("confrere")));
    await capturer("connexion-sante-jour.png", "light");
    await capturer("connexion-sante-nuit.png", "dark");
    ok("santé : une boîte connectée, une boîte aux identifiants refusés (tentatives suspendues), la boîte d'un confrère absente");

    // ===== 2. Saisie incomplète refusée sans appel =====
    const bouton = `${ligne(compteRefuse)} [data-testid=compte-reconnecter]`;
    const FORM = "[data-testid=connexion-formulaire]";
    await cliquer(bouton);
    await attendre("formulaire de reconnexion", () => present(FORM), Boolean, 10_000);
    verifier("le formulaire est en mode reconnexion, adresse non modifiable", (await js(`document.querySelector(${JSON.stringify(FORM)}).getAttribute("data-mode")`)) === "reconnexion" && !(await present("[data-testid=connexion-adresse]")) && norm(await texteDe("[data-testid=connexion-adresse-fixe]")).includes(adresse("refuse")));
    const avantEtat = await sqlServeur(`SELECT etat_connexion || '|' || hote FROM comptes_mail WHERE id = '${compteRefuse}'`);
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("refus de la saisie vide", () => texteDe("[data-testid=connexion-erreur]"), (t) => norm(t).includes("Saisissez le serveur IMAP."), 10_000);
    await sleep(1500);
    verifier("rien n'a changé sur le serveur", (await sqlServeur(`SELECT etat_connexion || '|' || hote FROM comptes_mail WHERE id = '${compteRefuse}'`)) === avantEtat);
    essaiNegatif("une saisie vide est envoyée au serveur", (await sqlServeur(`SELECT etat_connexion FROM comptes_mail WHERE id = '${compteRefuse}'`)) === "inconnu");
    ok("saisie incomplète : message en français, aucun appel au serveur");

    // ===== 3. Reconnexion avec un mauvais mot de passe =====
    const remplir = async (champs) => {
      for (const [id, valeur] of Object.entries(champs)) verifier(`champ ${id}`, await saisir(`[data-testid=connexion-${id}]`, valeur));
    };
    await remplir({ hote: dovecot, utilisateur: "capa", motDePasse: MAUVAIS });
    if (await js(`document.querySelector("[data-testid=connexion-tls]").checked`)) await cliquer("[data-testid=connexion-tls]");
    verifier("décocher TLS ramène le port à 143", (await js(`document.querySelector("[data-testid=connexion-port]").value`)) === "143");
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("le formulaire se ferme après l'envoi", async () => !(await present(FORM)), Boolean, 30_000);
    await attendre("le serveur a reçu de nouveaux identifiants (état repart de « inconnu » puis les essaie)", () => sqlServeur(`SELECT etat_connexion FROM comptes_mail WHERE id = '${compteRefuse}'`), (v) => v === "identifiants_refuses", 90_000);
    await attendre("la boîte reste refusée à l'écran", () => etat(compteRefuse), (t) => norm(t) === "Identifiants refusés", 60_000);
    essaiNegatif("un mauvais mot de passe reconnecte la boîte", norm(await etat(compteRefuse)) === "Connectée");
    ok("reconnexion avec un mauvais mot de passe : la boîte reste « Identifiants refusés »");

    // ===== 4. Reconnexion avec le bon mot de passe =====
    await cliquer(bouton);
    await attendre("formulaire de reconnexion (bon mot de passe)", () => present(FORM), Boolean, 10_000);
    await remplir({ hote: dovecot, utilisateur: "capa", motDePasse: MOT_IMAP_TEST });
    if (await js(`document.querySelector("[data-testid=connexion-tls]").checked`)) await cliquer("[data-testid=connexion-tls]");
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("la boîte est connectée sans autre geste", () => etat(compteRefuse), (t) => norm(t) === "Connectée", 120_000);
    verifier("le serveur la dit connectée", (await etatServeur(compteRefuse)) === "connecte");
    verifier("le bouton redevient « Modifier »", (await texteDe(bouton)) === "Modifier");
    essaiNegatif("la boîte reconnectée reste dite refusée", norm(await etat(compteRefuse)) === "Identifiants refusés");
    ok("reconnexion avec le bon mot de passe : « Connectée » sans autre geste");

    // ===== 5. Ajouter une boîte =====
    const nouvelleAdresse = adresse("nouvelle");
    const nbComptes = () => sqlServeur(`SELECT COUNT(*) FROM comptes_mail WHERE ${WHERE_COMPTES}`);
    const avantAjout = await nbComptes();
    await cliquer("[data-testid=compte-ajouter]");
    await attendre("formulaire d'ajout", () => present(FORM), Boolean, 10_000);
    verifier("le formulaire est en mode ajout, avec le champ adresse", (await js(`document.querySelector(${JSON.stringify(FORM)}).getAttribute("data-mode")`)) === "ajout" && (await present("[data-testid=connexion-adresse]")));
    await remplir({ adresse: "pas une adresse", hote: dovecot, utilisateur: "capa", motDePasse: MOT_IMAP_TEST });
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("adresse refusée", () => texteDe("[data-testid=connexion-erreur]"), (t) => norm(t).includes("l'adresse de la boîte"), 10_000);
    await remplir({ adresse: nouvelleAdresse, hote: "serveur imap avec espace" });
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("serveur avec espace refusé", () => texteDe("[data-testid=connexion-erreur]"), (t) => norm(t).includes("ni espace"), 10_000);
    await sleep(1000);
    verifier("aucune boîte créée par une saisie invalide", (await nbComptes()) === avantAjout);
    essaiNegatif("une saisie invalide crée une boîte", (await nbComptes()) !== avantAjout);
    await remplir({ hote: dovecot });
    if (await js(`document.querySelector("[data-testid=connexion-tls]").checked`)) await cliquer("[data-testid=connexion-tls]");
    await cliquer("[data-testid=connexion-envoyer]");
    await attendre("le formulaire se ferme", async () => !(await present(FORM)), Boolean, 30_000);
    const idNouvelle = await attendre("la boîte ajoutée est au serveur", () => sqlServeur(`SELECT id FROM comptes_mail WHERE adresse = ${lit(nouvelleAdresse)}`), (v) => /^[0-9a-f-]{36}$/u.test(String(v)), 30_000);
    await attendre("la boîte ajoutée apparaît connectée", () => etat(idNouvelle), (t) => norm(t) === "Connectée", 120_000);
    verifier("elle est celle de l'avocat", (await sqlServeur(`SELECT titulaire_id FROM comptes_mail WHERE id = '${idNouvelle}'`)) === demoId);
    verifier("trois boîtes de l'avocat à l'écran, pas celle du confrère", (await compter("[data-testid=compte-sante]")) >= 3 && !(await present(ligne(compteConfrere))));
    ok("ajout d'une boîte : saisie invalide refusée avant tout appel, saisie valide « Connectée »");

    // ===== 6. Aucun identifiant ne reste sur le poste ni en clair sur le serveur =====
    const secrets = [MOT_IMAP_TEST, MAUVAIS];
    const page = norm(await js(`document.body.innerText`));
    const stockage = await js(`JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])`);
    for (const secret of secrets) {
      verifier("le mot de passe n'est pas dans la page", !page.includes(secret));
      verifier("le mot de passe n'est pas dans le stockage du navigateur", !String(stockage).includes(secret));
    }
    const champsMdp = await js(`[...document.querySelectorAll("input[type=password]")].map((i) => i.value)`);
    verifier("aucun champ mot de passe ne garde de valeur", champsMdp.every((v) => v === ""), JSON.stringify(champsMdp.map((v) => v.length)));
    const colonnes = (await sqliteLocal(`PRAGMA table_info(comptes_mail)`)).map((c) => c.name);
    verifier("la table des comptes du poste n'a aucune colonne d'identifiants", !colonnes.some((c) => /secret|mot_de_passe|hote|utilisateur|jeton/u.test(c)), JSON.stringify(colonnes));
    essaiNegatif("la table des comptes du poste porte une colonne d'identifiants", colonnes.some((c) => /secret|mot_de_passe|hote|utilisateur|jeton/u.test(c)));
    const enBase = await sqlServeur(`SELECT string_agg(coalesce(secret_chiffre, ''), '|') FROM comptes_mail WHERE ${WHERE_COMPTES}`);
    verifier("les secrets sont chiffrés sur le serveur", enBase.length > 0 && !secrets.some((s) => enBase.includes(s)));
    ok("aucun identifiant sur le poste (page, stockage, base locale), secrets chiffrés au serveur");
    send = null;
    poste.page.ws.close();
  } finally {
    if (poste) await stopApp(poste.child);
    try {
      await retirerComptes();
    } catch (err) {
      console.error(`j11-connexion: nettoyage impossible : ${String(err.message).slice(0, 200)}`);
    }
  }
  ok("OK");
}

main()
  .catch((err) => {
    console.error(`j11-connexion: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(1, 5).join("\n"));
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
