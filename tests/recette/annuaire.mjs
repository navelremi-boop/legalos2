#!/usr/bin/env node
/**
 * Annuaire — écran de l'app Tauri.
 * Navigation Contacts entre Dossiers et Mails, filtres, onglets, fiche personne, fiche société.
 * La reprise, la recherche des 10 000 contacts, la fusion et les conflits restent dans leurs recettes.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const ui = creerSession("annuaire");
const { api, fail, ok, resetPostes, startApp, stopApp, waitCdp, connectCdp, login, evaluate, fermer } = ui;

function cliquer(send, selecteur) {
  return evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.click()`);
}

async function attendre(send, selecteur) {
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    const present = Boolean(await evaluate(send, `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`));
    if (present) return;
    await sleep(250);
  }
  fail(`absent : ${selecteur}`);
}

async function attendreSqlite(id, sql, predicat) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < 120_000) {
    try {
      dernier = await sqliteLocal(id, sql);
      if (predicat(dernier)) return;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`SQLite : ${dernier}`);
}

const posteId = "annuaire";
let app = null;

try {
  await ui.assurerInstance();
  const marque = ui.marque;
  const jeton = await demoAccessToken(api, `annuaire-${marque}`);
  const personneId = randomUUID();
  const societeId = randomUUID();
  const personne = await ui.apiJson(jeton, "POST", "/contacts", {
    id: personneId,
    idempotence_cle: `annuaire-personne-${marque}`,
    nature: "physique",
    nom: `Martin ${marque}`,
    prenoms: "Camille",
    civilite: "Madame",
    type_client: "particulier",
    nom_naissance: "Dupont",
    date_naissance: "1980-03-14",
    lieu_naissance: "Lyon",
    nationalite: "française",
    profession: "avocate",
    situation_familiale: "marie",
  });
  if (personne.status !== 200) fail(`personne ${personne.status} ${personne.texte.slice(0, 180)}`);
  const societe = await ui.apiJson(jeton, "POST", "/contacts", {
    id: societeId,
    idempotence_cle: `annuaire-societe-${marque}`,
    nature: "morale",
    nom: `Duclos ${marque}`,
    type_client: "professionnel",
    siren: "100000009",
    numero_tva: "FR88100000009",
    forme: "5499",
    capital_centimes: 1_000_000,
    monnaie: "EUR",
    greffe_rcs: "RCS de Lyon",
    activite: "Metallurgie",
  });
  if (societe.status !== 200) fail(`société ${societe.status} ${societe.texte.slice(0, 180)}`);
  await sqlServeur(
    `UPDATE contacts SET prenoms = 'Camille', civilite = 'Madame', nom_naissance = 'Dupont',
       date_naissance = '1980-03-14', lieu_naissance = 'Lyon', nationalite = 'française',
       profession = 'avocate', situation_familiale = 'marie' WHERE id = '${personneId}'`,
  );
  await sqlServeur(
    `UPDATE contacts SET forme = '5499', capital_centimes = 1000000, monnaie = 'EUR',
       greffe_rcs = 'RCS de Lyon', activite = 'Metallurgie', numero_tva = 'FR88100000009'
     WHERE id = '${societeId}'`,
  );
  const dossierId = randomUUID();
  const dossier = await ui.apiJson(jeton, "POST", "/dossiers", {
    id: dossierId,
    idempotence_cle: `annuaire-dossier-${marque}`,
    nom: `Dossier ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-ANNU-${marque}`,
    restreint: false,
  });
  if (dossier.status !== 200) fail(`dossier ${dossier.status} ${dossier.texte.slice(0, 180)}`);
  const email = `camille-${marque}@example.test`;
  const intervenantId = randomUUID();
  const coordId = randomUUID();
  const factureId = randomUUID();
  const messageId = randomUUID();
  await sqlServeur(
    `INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite, revision)
     SELECT '${intervenantId}', c.cabinet_id, '${dossierId}', c.id, q.id, 'public', 1
     FROM contacts c
     JOIN qualites q ON q.cabinet_id = c.cabinet_id AND q.code = 'client'
     WHERE c.id = '${personneId}'`,
  );
  await sqlServeur(
    `INSERT INTO contact_coordonnees (id, cabinet_id, contact_id, genre, usage, valeur, principale)
     SELECT '${coordId}', cabinet_id, id, 'email', 'domicile', '${email}', TRUE
     FROM contacts WHERE id = '${personneId}'`,
  );
  await sqlServeur(
    `INSERT INTO factures (
       id, cabinet_id, dossier_id, contact_id, type, statut,
       montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp
     )
     SELECT '${factureId}', cabinet_id, '${dossierId}', id, 'facture', 'brouillon',
            10000, 2000, 12000, 2000
     FROM contacts WHERE id = '${personneId}'`,
  );
  let compte = (
    await sqlServeur(
      `SELECT id FROM comptes_mail WHERE type_compte = 'classement' AND cabinet_id = (SELECT cabinet_id FROM contacts WHERE id = '${personneId}') LIMIT 1`,
    )
  ).trim();
  if (compte === "") {
    compte = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref)
       SELECT '${compte}', cabinet_id, 'classement', 'classement@cabinet.example', 'srv:annuaire'
       FROM contacts WHERE id = '${personneId}'`,
    );
  }
  const uid = Date.now() % 1_000_000_000;
  await sqlServeur(
    `INSERT INTO messages (
       id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement, visibilite, restreint
     )
     SELECT '${messageId}', cabinet_id, '${compte}', '${dossierId}',
            '<annuaire-${marque}@cabinet.example>', 1, ${uid},
            'Courrier ${marque}', '${email}', 'classe', 'public', FALSE
     FROM contacts WHERE id = '${personneId}'`,
  );
  ok("fiches créées");

  spawnSync("docker", ["restart", "legalos-instance-powersync-1"], { stdio: "inherit" });
  await sleep(8000);

  resetPostes([posteId]);
  app = startApp(posteId, 9356);
  await waitCdp(app);
  const cdp = await connectCdp(app.port);
  await login(cdp.send, demoEmail, demoPassword, totpSecretB32, `Annuaire ${marque}`);
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM contacts WHERE id = '${personneId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM dossier_intervenants WHERE id = '${intervenantId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM factures WHERE id = '${factureId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM messages WHERE id = '${messageId}'`, (v) => v === "1");
  ok("synchronisé");

  const ordre = await evaluate(
    cdp.send,
    `(() => {
      const ids = ["dossiers", "contacts", "mails"].map((id) => document.querySelector("[data-testid=nav-" + id + "]"));
      if (ids.some((el) => el === null)) return "nav absente";
      if ((ids[0].compareDocumentPosition(ids[1]) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return "Contacts n'est pas après Dossiers";
      if ((ids[1].compareDocumentPosition(ids[2]) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return "Mails n'est pas après Contacts";
      return "";
    })()`,
  );
  if (ordre) fail(String(ordre));

  await cliquer(cdp.send, "[data-testid=nav-contacts]");
  await attendre(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${personneId}"]`);
  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${personneId}"]`);
  await sleep(400);
  const personneEcran = await evaluate(
    cdp.send,
    `(() => {
      const boutons = [...document.querySelectorAll("button")].map((el) => el.textContent.replace(/\\s+/g, " ").trim());
      const civilite = document.querySelector("[data-testid=contacts-civilite]");
      const options = civilite ? [...civilite.options].map((o) => o.textContent.trim()) : [];
      const fax = /fax/i.test(document.body.innerText);
      const sexe = [...document.querySelectorAll("label, span")].some((el) => el.textContent.trim() === "Sexe");
      return {
        filtres: ["Tous", "Personnes", "Sociétés", "Professions"].every((mot) => boutons.some((b) => b.startsWith(mot))),
        onglets: ["Général", "Liens", "Dossiers", "Factures", "Mails", "Notes"].every((mot) => boutons.includes(mot)),
        options,
        fax,
        sexe,
        designation: document.querySelector("[data-testid=contacts-designation]")?.textContent ?? "",
        mademoiselle: options.some((o) => /mademoiselle/i.test(o)),
      };
    })()`,
  );
  if (!personneEcran.filtres) fail("filtres absents");
  if (!personneEcran.onglets) fail("onglets absents");
  if (personneEcran.fax) fail("un champ fax est présent");
  if (personneEcran.sexe) fail("un champ sexe est présent");
  if (personneEcran.mademoiselle) fail("Mademoiselle est proposée");
  if (!personneEcran.options.includes("Madame") || !personneEcran.options.includes("Maître")) fail("civilités de départ absentes");
  if (!personneEcran.designation.includes("Camille")) fail(`désignation : ${personneEcran.designation.slice(0, 120)}`);
  ok("fiche personne");

  async function attendreTexte(selecteur, morceau) {
    const debut = Date.now();
    while (Date.now() - debut < 20_000) {
      const lu = String(
        (await evaluate(cdp.send, `document.querySelector(${JSON.stringify(selecteur)})?.textContent ?? ""`)) ?? "",
      ).replace(/[\u00a0\u202f]/g, " ");
      if (lu.includes(morceau)) return;
      await sleep(400);
    }
    fail(`texte absent (${selecteur}) : ${morceau}`);
  }

  await cliquer(cdp.send, "[data-testid=contacts-onglet-dossiers]");
  await attendreTexte("[data-testid=contacts-dossiers]", `Dossier ${marque}`);
  await attendreTexte("[data-testid=contacts-dossiers]", "client");
  await cliquer(cdp.send, "[data-testid=contacts-onglet-factures]");
  await attendreTexte("[data-testid=contacts-factures]", "120,00");
  await attendreTexte("[data-testid=contacts-facture-encaisse]", "Encaissé");
  await attendreTexte("[data-testid=contacts-facture-encours]", "Encours");
  await cliquer(cdp.send, "[data-testid=contacts-onglet-mails]");
  await attendreTexte("[data-testid=contacts-mails]", `Courrier ${marque}`);
  ok("historique");

  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${societeId}"]`);
  await sleep(400);
  const societeEcran = await evaluate(
    cdp.send,
    `(() => {
      const valeur = (id) => document.querySelector("[data-testid=" + JSON.stringify(id) + "]")?.value ?? "";
      const designation = document.querySelector("[data-testid=contacts-designation]")?.textContent ?? "";
      return {
        denomination: valeur("contacts-denomination-nom"),
        siren: valeur("contacts-siren"),
        tva: valeur("contacts-tva"),
        greffe: valeur("contacts-greffe"),
        activite: valeur("contacts-activite"),
        forme: Boolean(document.querySelector("[data-testid=contacts-forme]")),
        capital: Boolean(document.querySelector("[data-testid=contacts-capital]")),
        designation,
      };
    })()`,
  );
  if (!societeEcran.denomination.includes(marque)) fail(`dénomination : ${societeEcran.denomination}`);
  if (societeEcran.siren !== "100000009") fail(`SIREN : ${societeEcran.siren}`);
  if (societeEcran.tva !== "FR88100000009") fail(`TVA : ${societeEcran.tva}`);
  if (societeEcran.greffe !== "RCS de Lyon") fail(`greffe : ${societeEcran.greffe}`);
  if (societeEcran.activite !== "Metallurgie") fail(`activité : ${societeEcran.activite}`);
  if (!societeEcran.forme || !societeEcran.capital) fail("forme ou capital absent");
  if (!societeEcran.designation.includes("100000009")) fail("la désignation ne reprend pas le SIREN");
  ok("fiche société");

  await cliquer(cdp.send, "[data-testid=nav-dossiers]");
  await sleep(300);
  await cliquer(cdp.send, "[aria-label='Palette de commandes']");
  await attendre(cdp.send, "[data-testid=palette-contacts]");
  await cliquer(cdp.send, "[data-testid=palette-contacts]");
  await attendre(cdp.send, "[data-testid=ecran-contacts]");
  ok("palette");
  ok("OK");
} catch (err) {
  if (app) console.error(app.logTail?.() ?? "");
  if (!(err instanceof Error) || !String(err.message).includes("FAIL")) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
} finally {
  if (app) await stopApp(app);
  fermer();
}
