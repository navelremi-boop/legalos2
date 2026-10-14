#!/usr/bin/env node
/**
 * J11 étape 4 partie A — écran Mails d'après design/maquettes/prototype-mails.html, dans l'app Tauri,
 * sur des données réelles synchronisées (PowerSync). Services requis : instance Docker (Postgres,
 * PowerSync, API) et GreenMail (états de la file d'envoi).
 *
 * Prouve, par le DOM de l'app, chacun avec un essai négatif :
 *  1. trois volets (rail, liste, lecture) ;
 *  2. « À classer » en tête du rail, compteur égal au nombre de mails à classer en base ;
 *  3. noms de dossiers IMAP en français ;
 *  4. liste groupée par jour, filtres, étiquette de dossier à la couleur de chemise, pastille « À classer » ;
 *  5. classement depuis le message (suggestion acceptée, autre dossier), le compteur baisse ;
 *  6. file d'envoi dans le rail et pas dans le volet de lecture, états, annulation, nouvelle tentative ;
 *  7. carte d'invitation (présente pour le message qui la porte, absente sinon), réponse en échec propre ;
 *  8. sous-titre, badge de la navigation, absence de témoin de relève sans donnée ;
 *  9. boutons de rédaction : ils ouvrent la rédaction à la place de la lecture, dock, ouverture du dossier ;
 * 10. recherche hors ligne en tête de liste.
 * Captures du poste réel : design/captures/j11-mails/poste-reel-*.png.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dossierCaptures = join(racine, "design", "captures", "j11-mails");
const session = creerSession("j11-mails");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, evaluate, fermer, setField } = session;

const marque = String(Date.now()).slice(-6);
const motCle = `motclef${marque}`;
/** Espaces insécables et fines insécables ramenés à une espace, pour comparer du texte typographié. */
const norm = (texte) => String(texte).replace(/[  ]/gu, " ");
const lit = (texte) => `'${String(texte).replaceAll("'", "''")}'`;

let send;

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

/** Vérifie une condition ; un essai négatif prouve que la vérification sait échouer. */
function verifier(nom, condition, detail = "") {
  if (!condition) fail(`${nom}${detail === "" ? "" : ` — ${detail}`}`);
}
function essaiNegatif(nom, condition) {
  if (condition) fail(`essai négatif muet : ${nom}`);
}

const cliquer = (selecteur) =>
  evaluate(
    send,
    `(() => { const b = document.querySelector(${JSON.stringify(selecteur)}); if (!b) return false; b.click(); return true; })()`,
  );
const texteDe = async (selecteur) =>
  String((await evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.innerText ?? null`)) ?? "");
const present = (selecteur) =>
  evaluate(send, `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`);
const compter = (selecteur) =>
  evaluate(send, `document.querySelectorAll(${JSON.stringify(selecteur)}).length`);
const sqliteLocal = (sql) =>
  evaluate(send, `window.__legalosRecette.lireSqlite(${JSON.stringify(sql)})`);

/** Prédicats évalués dans la page sur un élément racine (l'écran réel, ou un clone modifié pour l'essai négatif). */
const PREDICATS = `window.__j11 = {
  volets: (r) => {
    const g = r.querySelector('[data-testid=mails-trois-volets]');
    if (!g) return false;
    const ids = [...g.children].map((e) => e.getAttribute('data-testid'));
    return ids.length === 3 && ids[0] === 'mails-comptes' && ids[1] === 'mails-liste' && ids[2] === 'mails-lecture';
  },
  enTete: (r) => {
    const rail = r.querySelector('[data-testid=mails-comptes]');
    const premier = rail ? rail.firstElementChild : null;
    if (!premier || premier.getAttribute('data-testid') !== 'vue-a-classer') return null;
    const n = premier.querySelector('[data-testid=compteur-a-classer]');
    return { libelle: premier.innerText.replace(/\\s+/g, ' ').trim(), compteur: n ? Number(n.textContent) : 0 };
  },
  dossiersPerso: (r) =>
    [...r.querySelectorAll('[data-testid=boite-rail][data-boite=perso] [data-testid=dossier-imap]')].map((b) =>
      (b.childNodes[0] ? b.childNodes[0].textContent : '').trim()),
  texteRail: (r) => {
    const rail = r.querySelector('[data-testid=mails-comptes]');
    return rail ? rail.innerText : '';
  },
  fileDansRail: (r) => {
    const f = r.querySelector('[data-testid=mails-file]');
    return Boolean(f) && Boolean(f.closest('[data-testid=mails-comptes]')) && !f.closest('[data-testid=mails-lecture]');
  },
  fileDansLecture: (r) => Boolean(r.querySelector('[data-testid=mails-lecture] [data-testid=file-envoi-ligne]')),
  carte: (r) => {
    const c = r.querySelector('[data-testid=carte-invitation]');
    if (!c) return null;
    return {
      titre: (c.querySelector('[data-testid=invitation-titre]') || {}).innerText || '',
      quand: (c.querySelector('[data-testid=invitation-quand]') || {}).innerText || '',
      reponses: [...c.querySelectorAll('[data-testid=invitation-repondre]')].map((b) => b.getAttribute('data-reponse')),
    };
  },
};`;

async function predicat(nom, mutation) {
  const racineJs = `document.querySelector('[data-testid=ecran-mails]')`;
  const corps =
    mutation === undefined
      ? `const r = ${racineJs}; return window.__j11.${nom}(r);`
      : `const r = ${racineJs}.cloneNode(true); ${mutation}; return window.__j11.${nom}(r);`;
  return evaluate(send, `(() => { ${corps} })()`);
}

async function capturer(nom, theme) {
  mkdirSync(dossierCaptures, { recursive: true });
  await evaluate(send, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const donnees = capture.result?.data;
  if (donnees) writeFileSync(join(dossierCaptures, nom), Buffer.from(donnees, "base64"));
  await send("Emulation.clearDeviceMetricsOverride");
}

async function main() {
  await session.assurerInstance();
  const jeton = await demoAccessToken(api, `j11-mails-${marque}`);

  // ----- Données de l'instance (fictives) -----
  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(demoEmail)}`);
  if (!demoId) fail("utilisateur démo absent");
  const cabinet = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${demoId}'`);

  const dossierA = randomUUID();
  const dossierB = randomUUID();
  const creeA = await json("/dossiers", jeton, "POST", {
    id: dossierA,
    idempotence_cle: `j11m-${dossierA}`,
    nom: `J11 Alpha ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-J11A-${marque}`,
    restreint: false,
  });
  const creeB = await json("/dossiers", jeton, "POST", {
    id: dossierB,
    idempotence_cle: `j11m-${dossierB}`,
    nom: `J11 Bravo ${marque}`,
    chemise: "bleu-classeur",
    juridiction: "TJ fictif",
    numero_rg: `RG-J11B-${marque}`,
    restreint: false,
  });
  if (!creeA.reference || !creeB.reference) fail("références de dossier absentes");

  const comptePerso = randomUUID();
  const adressePerso = `j11.perso.${marque}@cabinet.example`;
  await sqlServeur(
    `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
     VALUES ('${comptePerso}', '${cabinet}', 'nominatif', '${demoId}', ${lit(adressePerso)}, 'srv:j11-mails')`,
  );
  let compteClassement = await sqlServeur(
    `SELECT id FROM comptes_mail WHERE type_compte = 'classement' AND cabinet_id = '${cabinet}' LIMIT 1`,
  );
  if (!compteClassement) {
    compteClassement = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref)
       VALUES ('${compteClassement}', '${cabinet}', 'classement', 'classement@cabinet.example', 'srv:j11-mails')`,
    );
  }

  const organisateur = `org.${marque}@etude.example`;
  const uidBase = Date.now() % 1_000_000_000;
  let uid = uidBase;
  const ids = {};
  async function message(cle, champs) {
    const id = randomUUID();
    ids[cle] = id;
    uid += 1;
    const c = {
      compte: comptePerso,
      dossier: null,
      suggestion: null,
      etat: "a_classer",
      imap: "INBOX",
      lu: false,
      expediteur: `Tiers ${marque} <tiers.${marque}@example.com>`,
      destinataires: adressePerso,
      pieces: "",
      texte: `Texte fictif ${cle}.`,
      secondes: 5,
      ...champs,
    };
    await sqlServeur(
      `INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, suggestion_dossier_id, message_id, uid_validity, uid,
         objet, expediteur, destinataires_texte, pieces_texte, texte_brut, etat_classement, dossier_imap, lu, cree_le)
       VALUES ('${id}', '${cabinet}', '${c.compte}', ${c.dossier ? `'${c.dossier}'` : "NULL"},
         ${c.suggestion ? `'${c.suggestion}'` : "NULL"}, ${lit(`<j11m-${cle}-${marque}@cabinet.example>`)}, 1, ${uid},
         ${lit(c.objet)}, ${lit(c.expediteur)}, ${lit(c.destinataires)}, ${lit(c.pieces)}, ${lit(c.texte)},
         '${c.etat}', ${lit(c.imap)}, ${c.lu ? "TRUE" : "FALSE"}, NOW() - INTERVAL '${c.secondes} seconds')`,
    );
  }
  const objets = {
    suggestion: `Avis de fixation ${marque}`,
    horsDossier: `Courrier sans dossier ${marque}`,
    classeB: `Mail classe ${marque}`,
    invitation: `Invitation : Reunion ${marque}`,
    autreSujet: `Autre sujet ${marque}`,
    envoye: `Envoye ${marque}`,
    brouillon: `Brouillon ${marque}`,
    archive: `Archive ${marque}`,
    corbeille: `Corbeille ${marque}`,
    partage: `Partage ${marque}`,
    ancien: `Ancien ${marque}`,
  };
  await message("suggestion", {
    objet: objets.suggestion,
    etat: "suggestion",
    suggestion: dossierA,
    expediteur: `Greffe ${marque} <greffe.${marque}@justice.example>`,
    pieces: "Avis.pdf",
    texte: `Le greffe vous avise. ${motCle}`,
    secondes: 1,
  });
  await message("horsDossier", { objet: objets.horsDossier, lu: true, secondes: 2 });
  await message("classeB", { objet: objets.classeB, etat: "classe", dossier: dossierB, secondes: 3 });
  await message("invitation", {
    objet: objets.invitation,
    etat: "classe",
    dossier: dossierA,
    lu: true,
    expediteur: `Me Organisateur ${marque} <${organisateur}>`,
    secondes: 4,
  });
  await message("autreSujet", {
    objet: objets.autreSujet,
    lu: true,
    expediteur: `Me Organisateur ${marque} <${organisateur}>`,
    secondes: 6,
  });
  await message("envoye", { objet: objets.envoye, etat: "classe", dossier: dossierA, imap: "Sent", lu: true, expediteur: adressePerso, secondes: 7 });
  await message("brouillon", { objet: objets.brouillon, etat: "classe", dossier: dossierA, imap: "Drafts", lu: true, expediteur: adressePerso, secondes: 8 });
  await message("archive", { objet: objets.archive, etat: "classe", dossier: dossierA, imap: "Archive", lu: true, secondes: 9 });
  await message("corbeille", { objet: objets.corbeille, etat: "classe", dossier: dossierA, imap: "Trash", lu: true, secondes: 10 });
  await message("partage", { objet: objets.partage, compte: compteClassement, secondes: 11 });
  await message("ancien", { objet: objets.ancien, etat: "classe", dossier: dossierA, lu: true, secondes: 10 * 86_400 });

  const idInvitation = randomUUID();
  await sqlServeur(
    `INSERT INTO invitations_agenda (id, cabinet_id, titulaire_id, uid_ical, sequence, effet, fuseau, debut, fin, objet, organisateur)
     VALUES ('${idInvitation}', '${cabinet}', '${demoId}', ${lit(`j11m-${marque}@etude.example`)}, 0, 'demande',
       'Europe/Paris', '2026-12-15T10:00:00', '2026-12-15T11:00:00', ${lit(`Reunion ${marque}`)}, ${lit(`mailto:${organisateur}`)})`,
  );

  // File d'envoi : les cinq états du cycle de vie (§ 3.8.3).
  const envois = {};
  async function envoi(cle, etat) {
    const id = randomUUID();
    envois[cle] = { id, objet: `Envoi ${cle} ${marque}` };
    await json("/messagerie/file-envoi", jeton, "POST", {
      id,
      idempotence_cle: `j11m-envoi-${id}`,
      dossier_id: dossierA,
      destinataire: `dest.${cle}.${marque}@example.com`,
      objet: envois[cle].objet,
      corps: "Corps fictif.",
      message_id: `<j11m-envoi-${id}@cabinet.example>`,
    });
    if (etat === "brouillon") return;
    await json(`/messagerie/file-envoi/${id}/mettre-en-attente`, jeton, "POST");
    if (etat === "en_attente") return;
    const coupe = { envoye: "?couper_apres=smtp", echec: "?couper_apres=echec", copie_envoyes_confirmee: "" }[etat];
    const obtenu = await json(`/messagerie/file-envoi/${id}/traiter${coupe}`, jeton, "POST");
    if (obtenu.etat !== etat) fail(`état ${etat} attendu pour l'envoi ${cle}, obtenu ${obtenu.etat}`);
  }
  await envoi("brouillon", "brouillon");
  await envoi("attente", "en_attente");
  await envoi("envoye", "envoye");
  await envoi("confirme", "copie_envoyes_confirmee");
  await envoi("echec", "echec");

  const sqlAClasser = `SELECT COUNT(*) FROM messages WHERE cabinet_id = '${cabinet}'
    AND etat_classement IN ('a_classer', 'suggestion')
    AND (titulaire_id = '${demoId}' OR (titulaire_id IS NULL AND dossier_id IS NULL AND visibilite = 'public'))`;
  const aClasserServeur = async () => Number(await sqlServeur(sqlAClasser));
  const attendusAvant = await aClasserServeur();
  if (attendusAvant < 3) fail(`moins de 3 mails à classer côté serveur (${attendusAvant})`);

  spawnSync("docker", ["restart", "legalos-instance-powersync-1"], { stdio: "inherit" });
  await sleep(8000);

  // ----- App Tauri -----
  resetPostes(["j11m"]);
  const { child, page } = await ouvrirPoste("j11m", 9347, {
    email: demoEmail,
    password: demoPassword,
    secret: totpSecretB32,
    nomAppareil: `J11 mails ${marque}`,
  });
  send = page.send;
  try {
    await evaluate(send, PREDICATS);
    await attendre(
      "synchronisation des messages",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE objet LIKE '%${marque}'`),
      (r) => Number(r?.[0]?.n) >= 11,
      120_000,
    );
    await attendre(
      "synchronisation de l'invitation",
      () => sqliteLocal(`SELECT COUNT(*) AS n FROM invitations_agenda WHERE objet = 'Reunion ${marque}'`),
      (r) => Number(r?.[0]?.n) === 1,
      60_000,
    );
    await cliquer("[data-testid=nav-mails]");
    await attendre("écran Mails", () => present("[data-testid=mails-trois-volets]"), Boolean);

    // 0. Fond neutre, titre
    verifier("fond neutre", (await evaluate(send, `document.querySelector("[data-testid=ecran-mails]").getAttribute("data-fond")`)) === "neutre");

    // 1. Trois volets
    verifier("trois volets", (await predicat("volets")) === true);
    essaiNegatif(
      "un écran sans volet de lecture passe pour valide",
      await predicat("volets", `r.querySelector('[data-testid=mails-lecture]').remove()`),
    );
    essaiNegatif(
      "un volet supplémentaire passe pour valide",
      await predicat("volets", `r.querySelector('[data-testid=mails-trois-volets]').appendChild(document.createElement('div'))`),
    );
    ok("trois volets : rail, liste, lecture");

    // 2. « À classer » en tête, compteur égal au nombre en base
    await attendre(
      "compteur À classer",
      async () => (await predicat("enTete"))?.compteur,
      (n) => n === attendusAvant,
    );
    const enTete = await predicat("enTete");
    verifier("« À classer » en tête du rail", enTete?.libelle.startsWith("À classer"), JSON.stringify(enTete));
    const sqliteAvant = Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE etat_classement IN ('a_classer', 'suggestion')`))?.[0]?.n);
    verifier("compteur égal à la base locale", enTete.compteur === sqliteAvant, `${enTete.compteur} contre ${sqliteAvant}`);
    verifier("compteur égal à la base du serveur", enTete.compteur === attendusAvant, `${enTete.compteur} contre ${attendusAvant}`);
    essaiNegatif("un compteur décalé d'un mail passe pour égal à la base", enTete.compteur + 1 === attendusAvant);
    essaiNegatif(
      "un rail sans « À classer » en tête passe pour valide",
      (await predicat("enTete", `r.querySelector('[data-testid=vue-a-classer]').remove()`)) !== null,
    );
    // Le badge de la navigation vaut le même nombre.
    const badge = Number(await texteDe("[data-testid=nav-mails] .barre-haut__compteur"));
    verifier("badge de la navigation", badge === attendusAvant, `${badge} contre ${attendusAvant}`);
    essaiNegatif("un badge décalé passe pour égal", badge + 1 === attendusAvant);
    ok(`« À classer » en tête, compteur ${enTete.compteur} = base locale = base serveur = badge`);

    // 3. Dossiers IMAP en français
    const dossiersAttendus = ["Boîte de réception", "Brouillons", "Envoyés", "Archives", "Corbeille"];
    const dossiers = await predicat("dossiersPerso");
    verifier("dossiers de Ma boîte en français", JSON.stringify(dossiers) === JSON.stringify(dossiersAttendus), JSON.stringify(dossiers));
    const texteRail = await predicat("texteRail");
    for (const brut of ["INBOX", "Sent", "Drafts", "Trash"]) {
      verifier(`nom IMAP brut « ${brut} » absent du rail`, !new RegExp(`\\b${brut}\\b`, "u").test(texteRail));
    }
    essaiNegatif(
      "un nom IMAP brut dans le rail passe pour absent",
      !/\bINBOX\b/u.test(
        await predicat("texteRail", `const n = document.createElement('button'); n.setAttribute('data-testid','dossier-imap'); n.textContent = ' INBOX '; r.querySelector('[data-testid=mails-comptes]').appendChild(n)`),
      ),
    );
    verifier("adresse du compte nominatif dans « Ma boîte »", texteRail.includes(adressePerso));
    verifier("« Boîte partagée » présente (message sans titulaire)", texteRail.includes("Boîte partagée"));
    // Un dossier ouvert : les Envoyés ne contiennent que le mail envoyé.
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=envoyes]");
    await attendre("liste des Envoyés", () => texteDe("[data-testid=liste-titre]"), (t) => t === "Envoyés");
    const objetsEnvoyes = await evaluate(send, `[...document.querySelectorAll("[data-testid=mail-ligne] .mails-ligne__obj")].map((n) => n.textContent)`);
    verifier("Envoyés : le mail envoyé", objetsEnvoyes.includes(objets.envoye), JSON.stringify(objetsEnvoyes));
    verifier("Envoyés : aucun mail de la réception", !objetsEnvoyes.includes(objets.suggestion));
    essaiNegatif("les Envoyés contiennent un mail de la réception", objetsEnvoyes.includes(objets.suggestion));
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("liste de la réception", () => texteDe("[data-testid=liste-titre]"), (t) => t === "Boîte de réception");
    ok("dossiers IMAP en français, Envoyés distincts de la réception");

    // 4. Liste : groupes par jour, étiquette de dossier à la couleur de chemise, pastille « À classer », filtres
    const ligne = (cle) => `[data-testid=mail-ligne][data-id="${ids[cle]}"]`;
    await attendre("mails de la réception", () => present(ligne("suggestion")), Boolean);
    const groupeDe = (cle) =>
      evaluate(send, `document.querySelector(${JSON.stringify(ligne(cle))})?.closest('[data-testid=groupe-jour]')?.getAttribute('data-groupe') ?? null`);
    verifier("mail récent dans « Aujourd'hui »", (await groupeDe("suggestion")) === "aujourdhui");
    const groupeAncien = await groupeDe("ancien");
    verifier("mail de dix jours hors « Aujourd'hui »", groupeAncien !== null && groupeAncien !== "aujourdhui" && groupeAncien !== "hier", String(groupeAncien));
    essaiNegatif("un mail de dix jours est dans « Aujourd'hui »", groupeAncien === "aujourdhui");
    const dateAncien = await evaluate(send, `document.querySelector(${JSON.stringify(ligne("ancien"))})?.querySelector('.mails-ligne__quand')?.innerText ?? ''`);
    verifier("date courte d'un ancien mail", /\d{1,2}(?:er)? [a-zéû.]+/u.test(dateAncien) && !/\d{4}-\d{2}/u.test(dateAncien), dateAncien);
    const etiquette = await evaluate(
      send,
      `(() => { const c = document.querySelector(${JSON.stringify(ligne("classeB"))} + ' .mails-dos'); return c ? { chemise: c.getAttribute('data-chemise'), texte: c.innerText.trim(), pastille: Boolean(c.querySelector('[data-testid=pastille-mail]')), fond: getComputedStyle(c).backgroundColor } : null; })()`,
    );
    verifier("étiquette du dossier de classement", etiquette?.chemise === "bleu-classeur" && etiquette.texte === creeB.reference && etiquette.pastille, JSON.stringify(etiquette));
    const etiquetteA = await evaluate(
      send,
      `(() => { const c = document.querySelector(${JSON.stringify(ligne("invitation"))} + ' .mails-dos'); return c ? { chemise: c.getAttribute('data-chemise'), fond: getComputedStyle(c).backgroundColor } : null; })()`,
    );
    verifier("étiquette kraft", etiquetteA?.chemise === "kraft");
    essaiNegatif("deux chemises différentes ont la même couleur", etiquette.fond === etiquetteA.fond);
    verifier(
      "pastille « À classer » sur un mail à classer",
      (await texteDe(`${ligne("suggestion")} [data-testid=etiquette-a-classer]`)) === "À classer",
    );
    essaiNegatif("un mail classé porte la pastille « À classer »", await present(`${ligne("classeB")} [data-testid=etiquette-a-classer]`));
    // Filtres
    await cliquer("[data-testid=filtre-mails][data-filtre=nonlus]");
    await sleep(300);
    const nonLus = await evaluate(send, `[...document.querySelectorAll("[data-testid=mail-ligne]")].map((n) => n.getAttribute("data-lu"))`);
    verifier("Non lus : uniquement des mails non lus", nonLus.length > 0 && nonLus.every((v) => v === "false"));
    essaiNegatif("le filtre Non lus laisse un mail lu", nonLus.some((v) => v === "true"));
    await cliquer("[data-testid=filtre-mails][data-filtre=pj]");
    await sleep(300);
    verifier("Pièces jointes : le mail avec pièce, pas les autres", (await present(ligne("suggestion"))) && !(await present(ligne("horsDossier"))));
    await cliquer("[data-testid=filtre-mails][data-filtre=tous]");
    await sleep(300);
    ok("liste groupée par jour, étiquettes de dossier, pastille, filtres");

    // 5. « À classer » : uniquement des mails à classer
    await cliquer("[data-testid=vue-a-classer]");
    await attendre("vue À classer", () => texteDe("[data-testid=liste-titre]"), (t) => t === "À classer");
    const etats = await evaluate(send, `[...document.querySelectorAll("[data-testid=mail-ligne]")].map((n) => n.getAttribute("data-etat"))`);
    verifier("vue À classer : seulement des mails non classés", etats.length === attendusAvant && etats.every((e) => e === "a_classer" || e === "suggestion"), JSON.stringify(etats));
    verifier("vue À classer : le mail classé n'y figure pas", !(await present(ligne("classeB"))));
    essaiNegatif("la vue À classer montre un mail classé", etats.includes("classe"));

    // 6. Lecture d'un mail suggéré, puis classement depuis le message
    await cliquer(ligne("suggestion"));
    await attendre("lecture du mail suggéré", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.suggestion));
    const bannière = norm(await texteDe("[data-testid=banniere-classer]"));
    verifier("encart « Classer dans … ? »", bannière.includes(`Classer dans ${creeA.reference}`) && bannière.includes("?") && bannière.includes(`J11 Alpha ${marque}`), bannière);
    verifier("expéditeur, destinataire et date en tête de lecture", (await texteDe("[data-testid=lecture-expediteur]")).includes(`Greffe ${marque}`) && (await texteDe("[data-testid=lecture-destinataires]")) === "À vous" && /Aujourd.hui, \d{1,2} h \d{2}/u.test(await texteDe("[data-testid=lecture-date]")), await texteDe("[data-testid=lecture-date]"));
    await attendre("corps du message", () => texteDe("[data-testid=lecture-corps]"), (t) => t.includes(motCle));
    verifier("pièce jointe listée", (await texteDe("[data-testid=lecture-pieces]")).includes("Avis.pdf"));
    // Essai négatif : « Classer » sans dossier choisi (mail hors dossier) ne classe rien.
    await cliquer(ligne("horsDossier"));
    await attendre("lecture du mail hors dossier", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.horsDossier));
    verifier("encart « Hors dossier »", (await texteDe("[data-testid=banniere-classer]")).startsWith("Hors dossier"));
    verifier("« Hors dossier » : pas de bouton Classer avant le choix", !(await present("[data-testid=bouton-classer]")));
    await cliquer("[data-testid=bouton-autre-dossier]");
    await attendre("sélecteur de dossier", () => present("[data-testid=classer-dossier]"), Boolean);
    verifier("« Classer » désactivé tant qu'aucun dossier n'est choisi", (await evaluate(send, `document.querySelector("[data-testid=bouton-classer]").disabled`)) === true);
    await cliquer("[data-testid=bouton-classer]");
    await sleep(1500);
    verifier(
      "aucun classement sans dossier choisi (serveur)",
      (await sqlServeur(`SELECT etat_classement FROM messages WHERE id = '${ids.horsDossier}'`)) === "a_classer",
    );

    // Classement du mail suggéré : le compteur baisse.
    await cliquer(ligne("suggestion"));
    await attendre("relecture du mail suggéré", () => present("[data-testid=bouton-classer]"), Boolean);
    await cliquer("[data-testid=bouton-classer]");
    await attendre("encart « Classé dans »", () => texteDe("[data-testid=encart-classe-titre]"), (t) => t.startsWith(`Classé dans ${creeA.reference}`));
    await attendre("compteur après classement", async () => (await predicat("enTete"))?.compteur, (n) => n === attendusAvant - 1);
    verifier(
      "mail suggéré classé côté serveur, dans le dossier suggéré",
      (await sqlServeur(`SELECT etat_classement || ' ' || dossier_id FROM messages WHERE id = '${ids.suggestion}'`)) === `classe ${dossierA}`,
    );
    verifier("le mail classé quitte la vue À classer", !(await present(ligne("suggestion"))));
    essaiNegatif("le compteur n'a pas baissé", (await predicat("enTete")).compteur === attendusAvant);
    await attendre("base serveur après classement", aClasserServeur, (n) => n === attendusAvant - 1);
    await attendre(
      "base locale après classement",
      async () => Number((await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE etat_classement IN ('a_classer', 'suggestion')`))?.[0]?.n),
      (n) => n === attendusAvant - 1,
    );
    // Autre dossier choisi dans la liste.
    await cliquer(ligne("horsDossier"));
    await attendre("relecture du mail hors dossier", () => present("[data-testid=bouton-autre-dossier]"), Boolean);
    await cliquer("[data-testid=bouton-autre-dossier]");
    await attendre("sélecteur de dossier (2)", () => present("[data-testid=classer-dossier]"), Boolean);
    await evaluate(
      send,
      `(() => { const s = document.querySelector("[data-testid=classer-dossier]"); const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value"); d.set.call(s, ${JSON.stringify(dossierB)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`,
    );
    await attendre("bouton Classer actif", () => evaluate(send, `document.querySelector("[data-testid=bouton-classer]")?.disabled === false`), Boolean);
    await cliquer("[data-testid=bouton-classer]");
    await attendre("encart « Classé dans » (autre dossier)", () => texteDe("[data-testid=encart-classe-titre]"), (t) => t.startsWith(`Classé dans ${creeB.reference}`));
    await attendre("compteur après second classement", async () => (await predicat("enTete"))?.compteur, (n) => n === attendusAvant - 2);
    verifier(
      "mail hors dossier classé dans le dossier choisi (serveur)",
      (await sqlServeur(`SELECT dossier_id FROM messages WHERE id = '${ids.horsDossier}'`)) === dossierB,
    );
    ok("classement depuis le message : suggestion acceptée et autre dossier, compteur en baisse");

    // 7. File d'envoi dans le rail, pas dans la lecture
    verifier("file d'envoi dans le rail", (await predicat("fileDansRail")) === true);
    verifier("aucune ligne de la file dans le volet de lecture", (await predicat("fileDansLecture")) === false);
    essaiNegatif(
      "une file d'envoi dans le volet de lecture passe pour absente",
      (await predicat("fileDansLecture", `const l = r.querySelector('[data-testid=file-envoi-ligne]'); r.querySelector('[data-testid=mails-lecture]').appendChild(l.cloneNode(true))`)) === false,
    );
    essaiNegatif(
      "une file hors du rail passe pour dans le rail",
      (await predicat("fileDansRail", `r.querySelector('[data-testid=mails-lecture]').appendChild(r.querySelector('[data-testid=mails-file]'))`)) === true,
    );
    const etatLigne = (cle) =>
      evaluate(send, `document.querySelector('[data-testid=file-envoi-ligne][data-id="${envois[cle].id}"]')?.getAttribute('data-etat') ?? null`);
    const attendus = { brouillon: "brouillon", attente: "en_attente", envoye: "envoye", confirme: "copie_envoyes_confirmee", echec: "echec" };
    for (const [cle, etat] of Object.entries(attendus)) {
      await attendre(`ligne d'envoi ${cle}`, () => etatLigne(cle), (v) => v === etat);
    }
    const libelleConfirme = await evaluate(send, `document.querySelector('[data-testid=file-envoi-ligne][data-id="${envois.confirme.id}"]').innerText`);
    verifier("« Copie dans « Envoyés » confirmée »", /Copie dans « Envoyés » confirmée/u.test(libelleConfirme), libelleConfirme);
    const actionsLigne = (cle, testid) =>
      evaluate(send, `Boolean(document.querySelector('[data-testid=file-envoi-ligne][data-id="${envois[cle].id}"] [data-testid=${testid}]'))`);
    verifier("Annuler sur l'envoi en attente", await actionsLigne("attente", "file-envoi-annuler"));
    verifier("Nouvelle tentative sur l'échec", await actionsLigne("echec", "file-envoi-reessayer"));
    essaiNegatif("un brouillon est annulable", await actionsLigne("brouillon", "file-envoi-annuler"));
    essaiNegatif("un envoi confirmé a une nouvelle tentative", await actionsLigne("confirme", "file-envoi-reessayer"));
    essaiNegatif("un échec est annulable", await actionsLigne("echec", "file-envoi-annuler"));
    await evaluate(send, `document.querySelector('[data-testid=file-envoi-ligne][data-id="${envois.attente.id}"] [data-testid=file-envoi-annuler]').click()`);
    await attendre("annulation", () => etatLigne("attente"), (v) => v === "brouillon");
    await evaluate(send, `document.querySelector('[data-testid=file-envoi-ligne][data-id="${envois.echec.id}"] [data-testid=file-envoi-reessayer]').click()`);
    await attendre("nouvelle tentative", () => etatLigne("echec"), (v) => v === "copie_envoyes_confirmee", 90_000);
    ok("file d'envoi dans le rail : cinq états, annulation, nouvelle tentative");

    // 8. Carte d'invitation
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("réception", () => present(ligne("invitation")), Boolean);
    await cliquer(ligne("invitation"));
    await attendre("carte d'invitation", () => predicat("carte"), (c) => c !== null);
    const carte = await predicat("carte");
    verifier("titre de l'invitation", carte.titre === `Reunion ${marque}`, JSON.stringify(carte));
    verifier("quand : mardi 15 décembre, 10 h à 11 h", /^mardi 15 décembre, 10 h 00 à 11 h 00$/u.test(carte.quand), JSON.stringify(carte.quand));
    verifier("trois réponses", JSON.stringify(carte.reponses) === JSON.stringify(["accepter", "peut_etre", "refuser"]));
    verifier("organisateur", norm(await texteDe("[data-testid=invitation-organisateur]")).includes(`Organisateur : ${organisateur}`));
    essaiNegatif(
      "une carte sans réponses passe pour valide",
      (await predicat("carte", `r.querySelectorAll('[data-testid=invitation-repondre]').forEach((b) => b.remove())`)).reponses.length === 3,
    );
    // Un autre sujet du même expéditeur, un mail sans invitation : pas de carte.
    await cliquer(ligne("autreSujet"));
    await attendre("autre sujet du même expéditeur", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.autreSujet));
    essaiNegatif("une carte d'invitation sur un autre sujet", (await predicat("carte")) !== null);
    await cliquer(ligne("classeB"));
    await attendre("mail classé sans invitation", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.classeB));
    essaiNegatif("une carte d'invitation sur un mail sans invitation", (await predicat("carte")) !== null);
    // Réponse : la route n'existe pas encore (étape 2) ; l'échec est propre, rien n'est simulé.
    const sonde = await fetch(`${api}/messagerie/invitations/${randomUUID()}/repondre`, {
      method: "POST",
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: JSON.stringify({ reponse: "accepter" }),
    });
    const routeAbsente = sonde.status === 404 || sonde.status === 405;
    await cliquer(ligne("invitation"));
    await attendre("carte d'invitation (2)", () => predicat("carte"), (c) => c !== null);
    await cliquer("[data-testid=invitation-repondre][data-reponse=accepter]");
    if (routeAbsente) {
      const erreur = await attendre("message d'erreur de la réponse", () => texteDe("[data-testid=invitation-erreur]"), (t) => t !== "");
      verifier("échec propre, en français", /pas encore disponible/u.test(erreur), erreur);
      verifier("aucune réponse simulée", !(await present("[data-testid=invitation-confirmee]")));
      verifier("aucun bouton marqué comme choisi", (await evaluate(send, `[...document.querySelectorAll("[data-testid=invitation-repondre]")].every((b) => b.getAttribute("aria-pressed") === "false")`)) === true);
      essaiNegatif("une confirmation de réponse sans route", await present("[data-testid=invitation-confirmee]"));
    } else {
      ok(`route de réponse présente (${sonde.status}) : le contrôle de l'échec propre est ignoré`);
    }
    ok("carte d'invitation : présente pour son message, absente ailleurs, échec propre de la réponse");

    // 9. Sous-titre, badge, témoin de relève
    const restant = attendusAvant - 2;
    // D'autres boîtes reçoivent des mails pendant la recette : on compare le sous-titre à la base locale lue au même instant,
    // jusqu'à ce que l'écran ait rattrapé (il relit la base toutes les 1,5 s). Une vraie divergence ne se résorbe pas.
    let sousTitre = "";
    let attenduSousTitre = "";
    for (let essai = 0; essai < 30; essai += 1) {
      const nonLusAttendus = Number(
        (await sqliteLocal(`SELECT COUNT(*) AS n FROM messages WHERE lu = 0 AND dossier_imap = 'INBOX' AND (titulaire_id = '${demoId}' OR titulaire_id IS NULL)`))?.[0]?.n,
      );
      attenduSousTitre = restant > 0 ? `${restant} mail${restant > 1 ? "s" : ""} à classer, ${nonLusAttendus} non lu${nonLusAttendus > 1 ? "s" : ""}` : "Tout est classé";
      sousTitre = (await texteDe("[data-testid=mails-sous-titre]")).replace(/\s+/gu, " ").trim();
      if (sousTitre === attenduSousTitre) break;
      await sleep(500);
    }
    verifier("sous-titre", sousTitre === attenduSousTitre, `${sousTitre} contre ${attenduSousTitre}`);
    essaiNegatif("« Tout est classé » alors que des mails sont à classer", sousTitre === "Tout est classé");
    const badgeApres = Number(await texteDe("[data-testid=nav-mails] .barre-haut__compteur"));
    verifier("badge après classement", badgeApres === restant, `${badgeApres} contre ${restant}`);
    verifier("aucun témoin de relève sans donnée de relève", !(await present("[data-testid=mails-releve]")));
    essaiNegatif("un témoin de relève inventé", await present("[data-testid=mails-releve]"));
    ok(`sous-titre « ${sousTitre} », badge ${badgeApres}, pas de témoin de relève sans donnée`);

    // 10. Boutons de rédaction : ils ouvrent la rédaction à la place de la lecture (détail : j11-redaction.mjs), dock
    await cliquer(ligne("classeB"));
    await attendre("lecture du mail classé", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.classeB));
    for (const bouton of ["lecture-repondre", "lecture-repondre-a-tous", "lecture-transferer"]) {
      verifier(`bouton ${bouton} visible`, await present(`[data-testid=${bouton}]`));
    }
    const dock = await texteDe("[data-testid=barre-actions]");
    verifier("dock : Nouveau mail et Saisir du temps", dock.includes("Nouveau mail") && dock.includes("Saisir du temps"), dock);
    verifier("aucune rédaction ouverte avant le clic", !(await present("[data-testid=mails-redaction]")));
    const genres = { "lecture-repondre": "reponse", "lecture-repondre-a-tous": "reponse_a_tous", "lecture-transferer": "transfert" };
    for (const [bouton, genre] of Object.entries(genres)) {
      await cliquer(`[data-testid=${bouton}]`);
      await attendre(`rédaction « ${genre} »`, () => evaluate(send, `document.querySelector("[data-testid=mails-redaction]")?.getAttribute("data-genre") ?? null`), (g) => g === genre, 20_000);
      verifier(`${genre} : la rédaction remplace la lecture`, !(await present("[data-testid=mails-lecture]")));
      await cliquer(ligne("classeB"));
      await attendre("retour à la lecture", () => present("[data-testid=mails-lecture]"), Boolean);
      essaiNegatif("la rédaction reste ouverte après le choix d'un mail", await present("[data-testid=mails-redaction]"));
    }
    await evaluate(send, `[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Nouveau mail"))?.click()`);
    await attendre("rédaction d'un message neuf", () => evaluate(send, `document.querySelector("[data-testid=mails-redaction]")?.getAttribute("data-genre") ?? null`), (g) => g === "nouveau", 20_000);
    essaiNegatif("le dock reste affiché pendant la rédaction", await present("[data-testid=barre-actions]"));
    await cliquer(ligne("classeB"));
    await attendre("retour à la lecture (2)", () => present("[data-testid=mails-lecture]"), Boolean);
    await cliquer("[data-testid=filtre-mails][data-filtre=nonlus]");
    await sleep(300);
    await cliquer("[data-testid=filtre-mails][data-filtre=tous]");
    verifier("« Ouvrir le dossier » pour un mail classé", dock.includes("Ouvrir le dossier"));
    await cliquer(ligne("autreSujet"));
    await attendre("lecture d'un mail non classé", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.autreSujet));
    essaiNegatif("« Ouvrir le dossier » pour un mail non classé", (await texteDe("[data-testid=barre-actions]")).includes("Ouvrir le dossier"));

    // 11. Recherche en tête de liste (hors ligne)
    await setField(send, "recherche-mails", motCle);
    await attendre("résultat de recherche", () => evaluate(send, `[...document.querySelectorAll("[data-testid=recherche-mail-hit]")].map((n) => n.textContent)`), (liste) => liste.some((t) => t.includes(objets.suggestion)), 30_000);
    verifier("la recherche remplace la liste par ses résultats", (await texteDe("[data-testid=liste-titre]")) === "Résultats");
    await setField(send, "recherche-mails", `absent${marque}zz`);
    await attendre("aucun résultat", () => compter("[data-testid=recherche-mail-hit]"), (n) => n === 0, 30_000);
    essaiNegatif("un mot absent trouve un mail", (await compter("[data-testid=recherche-mail-hit]")) > 0);
    await setField(send, "recherche-mails", "");
    ok("recherche hors ligne en tête de liste");

    // Captures du poste réel, jour et nuit
    await cliquer(ligne("invitation"));
    await sleep(500);
    await capturer("poste-reel-jour-invitation.png", "light");
    await cliquer("[data-testid=vue-a-classer]");
    await sleep(500);
    await capturer("poste-reel-jour-a-classer.png", "light");
    await capturer("poste-reel-nuit-a-classer.png", "dark");
    await evaluate(send, `document.documentElement.dataset.theme = "light"`);

    // « Ouvrir le dossier » ouvre le dossier où le mail est classé.
    await cliquer("[data-testid=dossier-imap][data-boite=perso][data-dossier=reception]");
    await attendre("réception (3)", () => present(ligne("classeB")), Boolean);
    await cliquer(ligne("classeB"));
    await attendre("lecture du mail classé (3)", () => texteDe("[data-testid=lecture-objet]"), (t) => t.includes(objets.classeB));
    await evaluate(send, `[...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => b.innerText.includes("Ouvrir le dossier"))?.click()`);
    await attendre(
      "dossier ouvert",
      () => evaluate(send, `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") ?? null`),
      (id) => id === dossierB,
      20_000,
    );
    ok("« Ouvrir le dossier » ouvre le dossier de classement du mail");
    page.ws.close();
  } finally {
    await stopApp(child);
  }
  ok("OK");
}

main()
  .catch((err) => {
    console.error(`j11-mails: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
