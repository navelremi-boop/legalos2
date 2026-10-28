#!/usr/bin/env node
/**
 * J11, critère (v) — écrans de connexion d'une boîte (IMAP/SMTP) et de santé, dans l'app Tauri (Réglages, Messagerie,
 * « Comptes »), sur un vrai serveur IMAP (Dovecot d'imap-test) et l'API réelle. Services requis : instance Docker et
 * instance/imap-test. Le volet OAuth (Microsoft 365, Gmail) tourne sur le fournisseur simulé de lib/simulateur-oauth.mjs
 * (jetons de 100 s), un Dovecot XOAUTH2 et l'écoute de bouclage réelle de l'app ; seul le « navigateur » est simulé, par
 * le crochet de recette `window.__legalosRecette.oauth` (absent du build distribué). Services requis en plus : Docker
 * (Dovecot) et les ports 18766 et 18767 libres (ne pas lancer avec oauth-messagerie.mjs).
 *
 * Prouve, par le DOM de l'app, chacun avec un essai négatif :
 *  1. la santé : une boîte au bon mot de passe est « Connectée », une boîte au mauvais « Identifiants refusés » (tentatives
 *     suspendues, bouton « Reconnecter » en avant) ; la boîte d'un confrère n'y figure pas ;
 *  2. le formulaire refuse une saisie incomplète sans appeler le serveur ;
 *  3. reconnecter avec un mauvais mot de passe : la boîte reste « Identifiants refusés » ;
 *  4. reconnecter avec le bon : « Connectée », sans autre geste ;
 *  5. ajouter une boîte : saisie invalide refusée avant tout appel ; saisie valide : la boîte apparaît « Connectée » ;
 *  6. OAuth, depuis l'écran : le choix du mode (mot de passe, ou un bouton par fournisseur de l'instance ; le simulateur
 *     n'est proposé que par le crochet de recette) ; ajout d'une boîte (adresse demandée, navigateur appelé avec l'adresse
 *     d'autorisation, requêtes parasites sur le port d'écoute : 404 et l'attente continue, retour : boîte « Connectée »
 *     avec son fournisseur, sans « Modifier ») ; révocation côté fournisseur : « Identifiants refusés » avec
 *     « Reconnecter » en avant ; reconnexion depuis l'écran (même boîte, sans formulaire de mot de passe) : « Connectée » ;
 *     essais négatifs : annulation (aucune boîte, le port ne répond plus), retour d'un autre state (rien n'est envoyé à
 *     /echange, la demande du serveur n'est pas consommée), refus du fournisseur (message français, aucune boîte) ;
 *  7. aucun identifiant ni jeton ne reste sur le poste (page, stockage du navigateur, base locale) ni en clair sur le serveur.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demarrerBancOauth, portRepond } from "./lib/banc-oauth-poste.mjs";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerClientImap } from "./lib/imap-controle.mjs";
import { MOT_IMAP_TEST, conteneur, connecterAuReseauApi } from "./lib/moteur-mail.mjs";
import { creerSession, diagnosticProcessusPoste, lireJournalErreursPoste, racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { autoriserDansLeNavigateur } from "./lib/simulateur-oauth.mjs";
import { PLAFOND_CONNEXIONS, demarrerSondeConnexions } from "./lib/sonde-connexions.mjs";
import { creerUi, lit, norm } from "./lib/ui-mails.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Série officielle : poste construit, interface embarquée, sans serveur Vite. */
const modeBuild = process.argv.includes("--build");
const cibleBuild = join(racine, "target-recette");
const exeBuild = join(cibleBuild, "debug", "legal-os-poste.exe");
const dossierCaptures = join(racine, "design", "captures", "j11-mails");
const session = creerSession("j11-connexion");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, fermer } = session;

const marque = String(Date.now()).slice(-6);
let send;
/** Jeton de la session de la recette, gardé pour joindre l'état de santé de l'API à un échec (D4). */
let jetonDiagnostic = null;
/** État du processus du poste relevé à l'échec, avant son arrêt (D4). */
let etatPosteAvantArret = null;
/** Sonde `doveadm who` en cours : arrêtée en tout cas à la fin de la recette. */
let sondeConnexions = null;
const ui = creerUi({ getSend: () => send, fail, dossierCaptures });
const { js, cliquer, texteDe, present, compter, desactive, sqliteLocal, saisir, attendre, verifier, essaiNegatif, capturer } = ui;

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
    `DELETE FROM oauth_etats WHERE ${WHERE_COMPTES}`,
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

function construirePosteConstruit() {
  const poste = join(racine, "apps", "poste");
  const configPath = join(tmpdir(), `legalos-j11-connexion-build-${marque}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      build: {
        frontendDist: "../dist-recette",
        beforeBuildCommand: "pnpm exec vite build --outDir dist-recette --emptyOutDir",
      },
    }),
  );
  console.log("j11-connexion: poste construit, interface embarquée, sans serveur Vite");
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `pnpm tauri build --debug --no-bundle --config ${configPath}`], {
    cwd: poste,
    env: {
      ...process.env,
      RUST_BACKTRACE: "1",
      CARGO_TARGET_DIR: cibleBuild,
      VITE_LEGALOS_RECETTE_HOOKS: "1",
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) fail(`construction du poste exit ${r.status ?? 1}`);
  if (!existsSync(exeBuild)) fail(`binaire absent (${exeBuild})`);
  process.env.CARGO_TARGET_DIR = cibleBuild;
}

async function main() {
  if (modeBuild) construirePosteConstruit();
  await session.assurerInstance();
  const dovecot = await demarrerImapTest();
  // Critère de J11 (consigne du 26/10/2026) : les connexions simultanées par boîte, relevées côté serveur (`doveadm who`),
  // ne dépassent jamais le plafond du moteur. La sonde tourne pendant toute la recette.
  const sonde = demarrerSondeConnexions({
    conteneurs: [dovecot, "legalos-j11-dovecot-oauth-poste"],
    intervalleMs: Number(process.env.LEGALOS_SONDE_MS ?? "4000"),
  });
  sondeConnexions = sonde;
  const jeton = await demoAccessToken(api, `j11-connexion-${marque}`);
  jetonDiagnostic = jeton;
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

  let poste = null;
  let banc = null;
  try {
    // Dans le `try` : un échec ici (base locale tenue par un autre poste) doit quand même arrêter la sonde.
    // Sinon son minuteur garde le processus en vie, et la passe ne se termine pas.
    resetPostes(["jcnx"]);
    console.log("j11-connexion: banc OAuth : fournisseur simulé (jetons de 100 s), relais SMTP XOAUTH2, Dovecot XOAUTH2");
    banc = await demarrerBancOauth({ fail });
    poste = await ouvrirPoste("jcnx", 9371, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Connexion ${marque}`,
      ...(modeBuild ? { mode: "copie" } : {}),
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
    // Progression de l'indexation de fond (critère J11) : la ligne de l'écran reprend les chiffres du serveur, sans dire
    // « terminée » tant qu'il reste des messages. La boîte du cabinet est celle qui porte des messages dans cette instance.
    const santeServeur = await json("/messagerie/sante", jeton, "GET");
    const cabinetSante = (santeServeur.comptes ?? []).find((c) => c.type_compte === "classement");
    verifier("la boîte du cabinet est dans le tableau de santé du serveur", Boolean(cabinetSante), JSON.stringify(Object.keys(santeServeur)));
    const ligneCabinet = ligne(cabinetSante.compte_id);
    const avecMessages = cabinetSante.corps_indexes + cabinetSante.corps_restants + cabinetSante.corps_abandonnes > 0;
    verifier("l'indexation de la boîte du cabinet est connue (sinon la ligne n'a rien à dire)", avecMessages, JSON.stringify(cabinetSante));
    const indexation = norm(await texteDe(`${ligneCabinet} [data-testid=compte-indexation]`));
    verifier("la ligne d'indexation est affichée pour la boîte du cabinet", indexation.startsWith("Recherche dans le texte des messages : "), indexation);
    const nombres = (indexation.match(/\d+/gu) ?? []).map(Number);
    // L'écran montre un instantané pris avant cette lecture ; l'indexation ne fait qu'avancer : le serveur, relu après, ne peut pas en être derrière.
    const santeApres = (await json("/messagerie/sante", jeton, "GET")).comptes.find((c) => c.compte_id === cabinetSante.compte_id);
    verifier("la ligne reprend un nombre de messages préparés que le serveur, relu après, a atteint", nombres.length >= 1 && nombres[0] <= santeApres.corps_indexes, `${indexation} / ${JSON.stringify(santeApres)}`);
    essaiNegatif("l'indexation est dite terminée alors qu'il reste des messages à préparer", santeApres.corps_restants > 0 && indexation.includes("tous les messages"));
    verifier("une boîte sans message indexé ni attendu n'affiche aucune ligne d'indexation", !(await present(`${ligne(compteRefuse)} [data-testid=compte-indexation]`)));
    await js(`document.querySelector(${JSON.stringify(ligneCabinet)})?.scrollIntoView({ block: "center" })`);
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
    await attendre("le serveur la dit connectée", () => etatServeur(compteRefuse), (v) => v === "connecte", 30_000);
    verifier("le bouton redevient « Modifier »", (await texteDe(bouton)) === "Modifier");
    essaiNegatif("la boîte reconnectée reste dite refusée", norm(await etat(compteRefuse)) === "Identifiants refusés");
    ok("reconnexion avec le bon mot de passe : « Connectée » sans autre geste");

    // ===== 5. Ajouter une boîte =====
    const nouvelleAdresse = adresse("nouvelle");
    const nbComptes = () => sqlServeur(`SELECT COUNT(*) FROM comptes_mail WHERE ${WHERE_COMPTES}`);
    const avantAjout = await nbComptes();
    await cliquer("[data-testid=compte-ajouter]");
    await attendre("choix du mode de connexion", () => present("[data-testid=connexion-mode-motdepasse]"), Boolean, 10_000);
    verifier("« Ajouter une boîte » ouvre d'abord le choix du mode, pas le formulaire", !(await present(FORM)));
    await cliquer("[data-testid=connexion-mode-motdepasse]");
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

    // ===== 6. OAuth =====
    const CROCHET = "window.__legalosRecette.oauth";
    const BOUTON_SIMULATEUR = "[data-testid=connexion-fournisseur-simulateur]";
    const ETAPE = "[data-testid=connexion-oauth-etape]";
    const ADRESSE_ATTENTE = "En attente de l'autorisation dans le navigateur…";
    const adressesOuvertes = () => js(`${CROCHET}.adressesOuvertes.length`);
    const echanges = () => js(`window.__echangesOAuth`);
    const montrer = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "center" })`);
    const nbBoitesAdresse = (a) => sqlServeur(`SELECT COUNT(*) FROM comptes_mail WHERE adresse = ${lit(a)}`);
    const nbEtats = (state) => sqlServeur(`SELECT COUNT(*) FROM oauth_etats WHERE state = ${lit(state)}`);
    const codesVus = [];
    const idsFournisseursUi = () =>
      js(`[...document.querySelectorAll("[data-testid^=connexion-fournisseur-]")].map((b) => b.getAttribute("data-testid").slice("connexion-fournisseur-".length)).sort()`);
    const sansEcoute = async (port) => {
      await attendre("l'écoute locale est fermée (le port ne répond plus)", () => portRepond(port), (v) => v === false, 15_000);
    };
    // Compte les appels de l'écran à /messagerie/oauth/echange (preuve qu'un retour refusé n'est rien envoyé à l'instance).
    await js(`(() => { window.__echangesOAuth = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]?.url ?? a[0]).includes("/messagerie/oauth/echange")) window.__echangesOAuth += 1; return f.apply(window, a); }; return true; })()`);

    // --- 6.1 Choix du mode : le simulateur n'est jamais proposé hors recette ---
    const listeInstance = await json("/messagerie/oauth/fournisseurs", jeton, "GET");
    const idsInstance = listeInstance.fournisseurs.map((f) => f.id).sort();
    verifier("l'instance ne propose pas le simulateur", !idsInstance.includes("simulateur"), JSON.stringify(idsInstance));
    await cliquer("[data-testid=compte-ajouter]");
    await attendre("choix du mode", () => present("[data-testid=connexion-mode-motdepasse]"), Boolean, 10_000);
    await attendre("liste des fournisseurs chargée", () => present("[data-testid=connexion-fournisseurs-chargement]"), (v) => v === false, 20_000);
    verifier("les boutons de fournisseur sont ceux de l'instance, rien de plus", JSON.stringify(await idsFournisseursUi()) === JSON.stringify(idsInstance), JSON.stringify(await idsFournisseursUi()));
    essaiNegatif("le simulateur est proposé sans le crochet de recette", (await idsFournisseursUi()).includes("simulateur"));
    await cliquer("[data-testid=connexion-choix-annuler]");
    await attendre("retour à l'écran des comptes", () => present("[data-testid=compte-ajouter]"), Boolean, 10_000);
    await js(`${CROCHET}.configurer(${JSON.stringify({ fournisseurs: [{ id: "simulateur", libelle: "Fournisseur de test" }], supplementsDebut: { simulateur: banc.supplement } })})`);
    await cliquer("[data-testid=compte-ajouter]");
    await attendre("le crochet de recette ajoute le simulateur (contrôle positif)", () => present(BOUTON_SIMULATEUR), Boolean, 20_000);
    verifier("le bouton du simulateur porte son libellé", norm(await texteDe(BOUTON_SIMULATEUR)) === "Fournisseur de test");
    verifier("« Mot de passe (IMAP/SMTP) » reste proposé", norm(await texteDe("[data-testid=connexion-mode-motdepasse]")) === "Mot de passe (IMAP/SMTP)");
    await montrer("[data-testid=connexion-choix]");
    await capturer("connexion-oauth-choix-jour.png", "light");
    await capturer("connexion-oauth-choix-nuit.png", "dark");
    await cliquer("[data-testid=connexion-choix-annuler]");
    await attendre("retour à l'écran des comptes", () => present("[data-testid=compte-ajouter]"), Boolean, 10_000);
    ok("choix du mode : mot de passe ou fournisseurs de l'instance ; le simulateur n'apparaît que par le crochet de recette");

    /** Ajouter une boîte par le simulateur jusqu'à l'ouverture du navigateur ; rend l'adresse d'autorisation et le bouclage. */
    const demarrerParcours = async (adresseBoite) => {
      await cliquer("[data-testid=compte-ajouter]");
      await attendre("choix du mode de connexion", () => present(BOUTON_SIMULATEUR), Boolean, 20_000);
      await cliquer(BOUTON_SIMULATEUR);
      await attendre("l'adresse est demandée avant l'ouverture du navigateur", () => present("[data-testid=connexion-oauth-adresse]"), Boolean, 10_000);
      const avant = await adressesOuvertes();
      await cliquer("[data-testid=connexion-oauth-ouvrir]");
      await attendre("une adresse invalide est refusée avant tout appel", () => texteDe("[data-testid=connexion-oauth-erreur]"), (t) => norm(t).includes("l'adresse de la boîte"), 10_000);
      verifier("le navigateur n'est pas appelé tant que l'adresse est invalide", (await adressesOuvertes()) === avant);
      verifier("adresse saisie", await saisir("[data-testid=connexion-oauth-adresse]", adresseBoite));
      await cliquer("[data-testid=connexion-oauth-ouvrir]");
      await attendre("le navigateur est appelé avec l'adresse d'autorisation", adressesOuvertes, (n) => n === avant + 1, 30_000);
      await attendre("attente de l'autorisation", () => texteDe(ETAPE), (t) => norm(t) === ADRESSE_ATTENTE, 15_000);
      const url = new URL(await js(`${CROCHET}.adressesOuvertes.at(-1)`));
      const redirection = url.searchParams.get("redirect_uri") ?? "";
      verifier("la redirection est le bouclage 127.0.0.1 du poste", /^http:\/\/127\.0\.0\.1:\d{4,5}\/$/u.test(redirection), redirection);
      return { url, state: url.searchParams.get("state"), redirection, port: Number(new URL(redirection).port) };
    };

    /** Le « navigateur » : suit l'adresse d'autorisation, puis fait la requête de redirection vers le poste. */
    const navigateur = async (p, { refus = false, etat: autreState } = {}) => {
      const reponse = await autoriserDansLeNavigateur(p.url.href, refus ? { refus: "1" } : {});
      verifier("le fournisseur redirige vers le bouclage du poste", reponse.statut === 302 && String(reponse.location).startsWith(p.redirection), String(reponse.location).slice(0, 60));
      const cible = new URL(reponse.location);
      if (cible.searchParams.get("code")) codesVus.push(cible.searchParams.get("code"));
      if (autreState !== undefined) cible.searchParams.set("state", autreState);
      const retour = await fetch(cible, { signal: AbortSignal.timeout(10_000) });
      return { statut: retour.status, corps: await retour.text(), entetes: retour.headers };
    };

    // --- 6.2 Ajout d'une boîte OAuth, avec des requêtes parasites sur le port d'écoute ---
    const adresseOauth = adresse("oauth");
    const avantOauth = await nbBoitesAdresse(adresseOauth);
    verifier("la boîte OAuth n'existe pas encore", avantOauth === "0");
    const p1 = await demarrerParcours(adresseOauth);
    verifier("adresse d'autorisation : fournisseur simulé, PKCE S256, state, indice de connexion", p1.url.origin === `http://127.0.0.1:${banc.fournisseur.port}` && p1.url.searchParams.get("code_challenge_method") === "S256" && (p1.url.searchParams.get("code_challenge") ?? "").length >= 43 && (p1.state ?? "").length >= 16 && p1.url.searchParams.get("login_hint") === adresseOauth);
    verifier("l'écoute locale répond (contrôle positif des essais qui suivent)", await portRepond(p1.port));
    verifier("« Annuler » est proposé pendant l'attente", await present("[data-testid=connexion-oauth-annuler]"));
    essaiNegatif("« Ajouter une boîte » reste proposé pendant la connexion", await present("[data-testid=compte-ajouter]"));
    await montrer("[data-testid=connexion-oauth-progression]");
    await capturer("connexion-oauth-attente-jour.png", "light");
    await capturer("connexion-oauth-attente-nuit.png", "dark");
    for (const [nom, chemin, options] of [["favicon", "/favicon.ico", {}], ["autre chemin avec paramètres", "/callback?code=x&state=y", {}], ["code sans state", "/?code=seul", {}], ["autre méthode", "/", { method: "POST" }]]) {
      const parasite = await fetch(`http://127.0.0.1:${p1.port}${chemin}`, { ...options, signal: AbortSignal.timeout(10_000) });
      verifier(`requête parasite (${nom}) : 404`, parasite.status === 404, String(parasite.status));
    }
    verifier("après les requêtes parasites, l'attente continue", norm(await texteDe(ETAPE)) === ADRESSE_ATTENTE && (await portRepond(p1.port)) && (await echanges()) === 0);
    essaiNegatif("une requête parasite termine l'attente", norm(await texteDe(ETAPE)) !== ADRESSE_ATTENTE);
    const retour1 = await navigateur(p1);
    verifier("le navigateur reçoit la page de confirmation en français", retour1.statut === 200 && retour1.corps.includes("Connexion reçue : vous pouvez fermer cette fenêtre et revenir à LEGAL OS."));
    verifier("page sans cache ni contenu actif", retour1.entetes.get("cache-control") === "no-store" && /charset=utf-8/iu.test(retour1.entetes.get("content-type") ?? "") && !/<script|<iframe|<img|onclick/iu.test(retour1.corps) && !retour1.corps.includes(codesVus[0]));
    const idOauth = await attendre("la boîte OAuth est au serveur", () => sqlServeur(`SELECT id FROM comptes_mail WHERE adresse = ${lit(adresseOauth)}`), (v) => /^[0-9a-f-]{36}$/u.test(String(v)), 30_000);
    await attendre("la boîte OAuth apparaît connectée", () => etat(idOauth), (t) => norm(t) === "Connectée", 150_000);
    verifier("l'écran nomme le fournisseur", norm(await texteDe(`${ligne(idOauth)} [data-testid=compte-fournisseur]`)) === "Connexion par Fournisseur de test");
    verifier("aucun bouton « Modifier » ni « Reconnecter » pour une boîte OAuth connectée", !(await present(`${ligne(idOauth)} [data-testid=compte-reconnecter]`)));
    verifier("contrôle positif : une boîte à mot de passe connectée garde « Modifier »", (await texteDe(`${ligne(compteBon)} [data-testid=compte-reconnecter]`)) === "Modifier");
    verifier("serveur : boîte du simulateur, sans mot de passe, première connexion", (await sqlServeur(`SELECT fournisseur || '|' || secret_ref || '|' || oauth_generation::text || '|' || (secret_chiffre IS NULL)::text FROM comptes_mail WHERE id = '${idOauth}'`)) === "simulateur|oauth|0|true");
    verifier("l'écran a envoyé un échange de code à l'instance (et un seul)", (await echanges()) === 1);
    verifier("la demande du serveur est consommée", (await nbEtats(p1.state)) === "0");
    verifier("l'écoute locale est fermée après le retour", (await attendre("écoute fermée", () => portRepond(p1.port), (v) => v === false, 15_000)) === false);
    verifier("l'écran des comptes est revenu (plus de progression)", !(await present("[data-testid=connexion-oauth-progression]")) && (await present("[data-testid=compte-ajouter]")));
    await montrer(ligne(idOauth));
    await capturer("connexion-oauth-connectee-jour.png", "light");
    await capturer("connexion-oauth-connectee-nuit.png", "dark");
    ok("OAuth : boîte ajoutée depuis l'écran, requêtes parasites ignorées (404, l'attente continue), « Connectée » avec son fournisseur, sans « Modifier »");

    // --- 6.3 Révocation côté fournisseur, puis reconnexion depuis l'écran ---
    banc.fournisseur.revoquer();
    await attendre("la boîte révoquée passe à « Identifiants refusés »", () => etat(idOauth), (t) => norm(t) === "Identifiants refusés", 180_000);
    const boutonOauth = `${ligne(idOauth)} [data-testid=compte-reconnecter]`;
    verifier("« Reconnecter » en avant pour la boîte OAuth", (await texteDe(boutonOauth)) === "Reconnecter" && (await js(`document.querySelector(${JSON.stringify(boutonOauth)})?.getAttribute("data-fort")`)) === "true");
    verifier("tentatives suspendues, reconnexion proposée", norm(await detail(idOauth)).includes("Les tentatives sont suspendues. L'autorisation est à renouveler."), await detail(idOauth));
    verifier("le serveur dit la boîte refusée", (await etatServeur(idOauth)) === "identifiants_refuses");
    essaiNegatif("la boîte révoquée est dite connectée", norm(await etat(idOauth)) === "Connectée");
    verifier("la révocation ne touche pas la boîte à mot de passe (contrôle positif)", norm(await etat(compteBon)) === "Connectée");
    await montrer(ligne(idOauth));
    await capturer("connexion-oauth-reconnecter-jour.png", "light");
    await capturer("connexion-oauth-reconnecter-nuit.png", "dark");

    const avantReco = await adressesOuvertes();
    await cliquer(boutonOauth);
    await attendre("le navigateur est appelé pour la reconnexion", adressesOuvertes, (n) => n === avantReco + 1, 30_000);
    await attendre("attente de l'autorisation (reconnexion)", () => texteDe(ETAPE), (t) => norm(t) === ADRESSE_ATTENTE, 15_000);
    verifier("aucun formulaire de mot de passe pour une boîte OAuth", !(await present(FORM)) && !(await present("[data-testid=connexion-motDePasse]")) && (await compter("input[type=password]")) === 0);
    verifier("pendant la connexion, « Reconnecter » est inactif (un seul parcours à la fois)", (await desactive(boutonOauth)) === true);
    const urlReco = new URL(await js(`${CROCHET}.adressesOuvertes.at(-1)`));
    verifier("la demande de reconnexion garde l'identifiant de la boîte et son adresse", urlReco.searchParams.get("login_hint") === adresseOauth);
    const p2 = { url: urlReco, state: urlReco.searchParams.get("state"), redirection: urlReco.searchParams.get("redirect_uri") ?? "" };
    p2.port = Number(new URL(p2.redirection).port);
    await navigateur(p2);
    await attendre("la boîte reconnectée redevient connectée sans autre geste", () => etat(idOauth), (t) => norm(t) === "Connectée", 150_000);
    verifier("même boîte, connexion suivante", (await sqlServeur(`SELECT oauth_generation::text || '|' || (SELECT COUNT(*) FROM comptes_mail WHERE adresse = ${lit(adresseOauth)})::text FROM comptes_mail WHERE id = '${idOauth}'`)) === "1|1");
    verifier("le serveur la dit connectée", (await etatServeur(idOauth)) === "connecte");
    verifier("deux échanges de code en tout (ajout, reconnexion)", (await echanges()) === 2);
    essaiNegatif("la boîte reconnectée reste dite refusée", norm(await etat(idOauth)) === "Identifiants refusés");
    ok("OAuth : révocation côté fournisseur : « Identifiants refusés » avec « Reconnecter » ; reconnexion depuis l'écran : « Connectée »");

    // --- 6.4 Essai négatif : annulation du parcours ---
    const adresseAnnulee = adresse("oauth-annulee");
    const echangesAvantAnnulation = await echanges();
    const pa = await demarrerParcours(adresseAnnulee);
    verifier("avant l'annulation, l'écoute répond (contrôle positif)", await portRepond(pa.port));
    await cliquer("[data-testid=connexion-oauth-annuler]");
    await attendre("retour à l'écran des comptes", () => present("[data-testid=compte-ajouter]"), Boolean, 10_000);
    await sansEcoute(pa.port);
    essaiNegatif("le port répond encore après l'annulation", await portRepond(pa.port));
    let retourTardif = null;
    try {
      retourTardif = await navigateur(pa);
    } catch {
      retourTardif = null;
    }
    essaiNegatif("un retour tardif du navigateur est reçu après l'annulation", retourTardif !== null);
    await sleep(1500);
    essaiNegatif("une boîte est créée par un parcours annulé", (await nbBoitesAdresse(adresseAnnulee)) !== "0");
    verifier("rien n'a été envoyé à /echange", (await echanges()) === echangesAvantAnnulation);
    verifier("aucune progression ni erreur ne reste à l'écran", !(await present("[data-testid=connexion-oauth-progression]")));
    ok("OAuth : annulation : aucune boîte, l'écoute est fermée, rien envoyé à /echange");

    // --- 6.5 Essai négatif : retour avec un autre state ---
    const adresseIncoherente = adresse("oauth-incoherente");
    const echangesAvantIncoherence = await echanges();
    const codesAvant = banc.fournisseur.etat.echangesDeCode;
    const pm = await demarrerParcours(adresseIncoherente);
    verifier("la demande du serveur existe et attend (contrôle positif)", (await nbEtats(pm.state)) === "1");
    await navigateur(pm, { etat: `etat-pirate-${marque}-abcdefgh` });
    await attendre("message d'incohérence en français", () => texteDe("[data-testid=connexion-oauth-erreur]"), (t) => norm(t).includes("ne correspond pas à la demande"), 20_000);
    await sleep(1500);
    essaiNegatif("un retour au state différent est transmis à l'instance", (await echanges()) !== echangesAvantIncoherence);
    verifier("rien n'est parti vers /echange", (await echanges()) === echangesAvantIncoherence);
    verifier("la demande du serveur n'a pas été consommée (aucun échange)", (await nbEtats(pm.state)) === "1");
    verifier("le fournisseur n'a reçu aucun échange de code", banc.fournisseur.etat.echangesDeCode === codesAvant);
    essaiNegatif("une boîte est créée par un retour incohérent", (await nbBoitesAdresse(adresseIncoherente)) !== "0");
    await sansEcoute(pm.port);
    await montrer("[data-testid=connexion-oauth-progression]");
    await capturer("connexion-oauth-erreur-jour.png", "light");
    await capturer("connexion-oauth-erreur-nuit.png", "dark");
    await cliquer("[data-testid=connexion-oauth-fermer]");
    await attendre("retour à l'écran des comptes", () => present("[data-testid=compte-ajouter]"), Boolean, 10_000);
    ok("OAuth : retour avec un autre state : refusé en français, rien envoyé à /echange, demande du serveur intacte");

    // --- 6.6 Essai négatif : refus dans le navigateur (error=access_denied) ---
    const adresseRefusee = adresse("oauth-refusee");
    const echangesAvantRefus = await echanges();
    const pr = await demarrerParcours(adresseRefusee);
    verifier("avant le refus, l'écoute répond (contrôle positif)", await portRepond(pr.port));
    const refus = await navigateur(pr, { refus: true });
    verifier("le navigateur reçoit une page en français", refus.statut === 200 && refus.corps.includes("La connexion n'a pas abouti"));
    await attendre("message de refus en français", () => texteDe("[data-testid=connexion-oauth-erreur]"), (t) => norm(t).includes("L'autorisation a été refusée dans le navigateur."), 20_000);
    await sleep(1000);
    essaiNegatif("un refus du fournisseur est transmis à l'instance", (await echanges()) !== echangesAvantRefus);
    essaiNegatif("une boîte est créée par un refus", (await nbBoitesAdresse(adresseRefusee)) !== "0");
    await sansEcoute(pr.port);
    await cliquer("[data-testid=connexion-oauth-fermer]");
    await attendre("retour à l'écran des comptes", () => present("[data-testid=compte-ajouter]"), Boolean, 10_000);
    ok("OAuth : refus du fournisseur : message français, aucune boîte, rien envoyé à /echange");

    // ===== 7. Aucun identifiant ni jeton ne reste sur le poste ni en clair sur le serveur =====
    const jetons = banc.fournisseur.jetonsEmis();
    const jetonsEtCodes = [...jetons.acces, ...jetons.rafraichissements, ...codesVus];
    verifier("contrôle positif : le fournisseur a émis des jetons et le navigateur a vu des codes", jetons.acces.length >= 2 && jetons.rafraichissements.length >= 2 && codesVus.length >= 3);
    const secrets = [MOT_IMAP_TEST, MAUVAIS, ...jetonsEtCodes];
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
    const lignesLocales = JSON.stringify(await sqliteLocal(`SELECT * FROM comptes_mail`));
    verifier("contrôle positif : la base locale contient bien les boîtes OAuth (adresse)", lignesLocales.includes(adresseOauth));
    for (const secret of jetonsEtCodes) verifier("jeton ou code d'autorisation absent de la base locale", !lignesLocales.includes(secret));
    const jetonsEnBase = await sqlServeur(`SELECT string_agg(coalesce(jeton_rafraichissement_chiffre, '') || coalesce(jeton_acces_chiffre, ''), '|') FROM comptes_mail WHERE ${WHERE_COMPTES}`);
    verifier("les jetons OAuth sont chiffrés sur le serveur (contrôle positif : ils y sont)", jetonsEnBase.length > 0 && !jetonsEtCodes.some((s) => jetonsEnBase.includes(s)));
    ok("aucun identifiant ni jeton sur le poste (page, stockage, base locale), secrets et jetons chiffrés au serveur");
    // Connexions simultanées par boîte, côté serveur : jamais au-dessus du plafond du moteur.
    const releve = await sonde.arreter();
    sondeConnexions = null;
    ok(`connexions simultanées par boîte, relevées par doveadm who (${releve.echantillons} échantillons) : maximum ${releve.maximum.nombre}${releve.maximum.utilisateur === "" ? "" : ` (utilisateur ${releve.maximum.utilisateur})`}, plafond ${PLAFOND_CONNEXIONS}`);
    verifier("la sonde du serveur a relevé des connexions (sinon la mesure ne prouve rien)", releve.echantillons > 0 && releve.maximum.nombre > 0, JSON.stringify(releve));
    verifier(`aucune boîte ne dépasse ${PLAFOND_CONNEXIONS} connexions simultanées`, releve.maximum.nombre <= PLAFOND_CONNEXIONS, JSON.stringify(releve.maximum));
    send = null;
    poste.page.ws.close();
  } catch (err) {
    // Avant que `finally` ne tue le poste : son état au moment de l'échec (D4).
    etatPosteAvantArret = diagnosticProcessusPoste(poste?.child);
    etatPosteAvantArret.push(`page : ${await etatPage()}`);
    throw err;
  } finally {
    if (sondeConnexions !== null) {
      const releve = await sondeConnexions.arreter();
      console.error(`j11-connexion: connexions simultanées relevées avant l'arrêt : maximum ${releve.maximum.nombre} (${releve.echantillons} échantillons)`);
    }
    if (poste) await stopApp(poste.child);
    if (banc) {
      try {
        await banc.arreter();
      } catch (err) {
        console.error(`j11-connexion: arrêt du banc OAuth impossible : ${String(err.message).slice(0, 200)}`);
      }
    }
    try {
      await retirerComptes();
    } catch (err) {
      console.error(`j11-connexion: nettoyage impossible : ${String(err.message).slice(0, 200)}`);
    }
  }
  ok("OK");
}

/**
 * État technique de la page au moment d'un échec : route, nombre de lignes de santé, identifiants techniques
 * (`data-testid`) présents. Aucun texte affiché. Borné à 10 s : une page figée est un résultat, pas un blocage.
 */
async function etatPage() {
  if (!send) return "pas de connexion au protocole de débogage";
  try {
    const lu = await Promise.race([
      js(
        `JSON.stringify({ route: location.pathname + location.hash.split("?")[0], lignesSante: document.querySelectorAll("[data-testid=compte-sante]").length, testids: [...new Set([...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")))].slice(0, 40) })`,
      ),
      sleep(10_000).then(() => "aucune réponse en 10 s (page figée ?)"),
    ]);
    return String(lu).slice(0, 1_200);
  } catch (err) {
    return `illisible : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
  }
}

/**
 * Consigne de l'architecte du 24/10/2026 (D4) : en cas d'échec ou d'arrêt du poste, la recette joint les 200 dernières
 * lignes du journal d'erreurs du poste (panics, erreurs JavaScript non capturées, sessions disparues) et l'état de santé
 * des boîtes lu par l'API. Aucune exception ne sort d'ici : un diagnostic qui échoue ne masque pas l'échec d'origine.
 */
async function joindreDiagnostic() {
  if (etatPosteAvantArret !== null) {
    console.error("j11-connexion: état du poste à l'instant de l'échec, avant son arrêt :");
    for (const ligne of etatPosteAvantArret) console.error(`  ${ligne}`);
  }
  try {
    const lignes = lireJournalErreursPoste(200);
    console.error(`j11-connexion: journal d'erreurs du poste (${lignes.length} dernière(s) ligne(s)) :`);
    for (const ligne of lignes) console.error(`  ${ligne}`);
    if (lignes.length === 0) console.error("  (aucune ligne : le poste n'a rien consigné, ou le journal est absent)");
  } catch (err) {
    console.error(`j11-connexion: journal d'erreurs du poste illisible : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
  try {
    if (jetonDiagnostic === null) {
      console.error("j11-connexion: état de santé de l'API non lu : la connexion de la recette n'a pas eu lieu.");
      return;
    }
    const reponse = await fetch(`${api}/messagerie/sante`, {
      headers: { authorization: `Bearer ${jetonDiagnostic}` },
      signal: AbortSignal.timeout(15_000),
    });
    const texte = await reponse.text();
    console.error(`j11-connexion: état de santé lu par l'API (${reponse.status}) : ${texte.slice(0, 1500)}`);
  } catch (err) {
    console.error(`j11-connexion: état de santé de l'API non lu : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
}

main()
  .catch(async (err) => {
    console.error(`j11-connexion: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(1, 5).join("\n"));
    await joindreDiagnostic();
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
