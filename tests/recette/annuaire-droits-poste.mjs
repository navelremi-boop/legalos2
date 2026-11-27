#!/usr/bin/env node
/**
 * Contrôleur — Annuaire, droits sur l'app Tauri (critère « Droits » du PLAN).
 * Poste du titulaire (A) et poste d'un collaborateur sans accès au dossier restreint (B), sur l'instance des recettes :
 * la fiche est visible chez B ; le dossier restreint, son intervenant, sa facture, son encaissement et son mail
 * sont absents du SQLite de B et de la fiche (onglets Dossiers et Factures) ; chez A, ils sont présents (témoin).
 * Usage : node tests/recette/annuaire-droits-poste.mjs
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const collabEmail = "collab-j5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

const ui = creerSession("annuaire-droits");
const { api, fail, ok, resetPostes, startApp, stopApp, waitCdp, connectCdp, login, evaluate, fermer } = ui;

async function attendreSqlite(id, sql, predicat, delai = 120_000) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < delai) {
    try {
      dernier = await sqliteLocal(id, sql);
      if (predicat(dernier)) return dernier;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`SQLite ${id} : ${dernier} (${sql})`);
  return dernier;
}

async function attendre(send, selecteur) {
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    if (await evaluate(send, `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`)) return;
    await sleep(250);
  }
  fail(`absent : ${selecteur}`);
}

function cliquer(send, selecteur) {
  return evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.click()`);
}

async function texte(send, selecteur) {
  return String((await evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.textContent ?? ""`)) ?? "")
    .replace(/[\u00a0\u202f]/g, " ");
}

let app = null;
try {
  await ui.assurerInstance();
  const marque = ui.marque;
  const jeton = await demoAccessToken(api, `droits-${marque}`);

  const existe = (await sqlServeur(`SELECT COUNT(*) FROM utilisateurs WHERE email = '${collabEmail}'`)).trim();
  if (existe === "0") {
    const creation = await fetch(`${api}/collaborateurs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ email: collabEmail, password: collabPassword, totp_secret_base32: collabTotp }),
    });
    if (!creation.ok) fail(`collaborateur ${creation.status}`);
  }

  const contactId = randomUUID();
  const contact = await ui.apiJson(jeton, "POST", "/contacts", {
    id: contactId,
    idempotence_cle: `droits-contact-${marque}`,
    nature: "physique",
    nom: `Droitsfiche${marque}`,
    prenoms: "Claire",
    civilite: "Madame",
    type_client: "particulier",
  });
  if (contact.status !== 200) fail(`contact ${contact.status} ${contact.texte.slice(0, 160)}`);

  const publicId = randomUUID();
  const restreintId = randomUUID();
  for (const [id, nom, restreint] of [
    [publicId, `DossierPublic${marque}`, false],
    [restreintId, `DossierSecret${marque}`, true],
  ]) {
    const r = await ui.apiJson(jeton, "POST", "/dossiers", {
      id,
      idempotence_cle: `droits-dossier-${id}`,
      nom,
      chemise: "kraft",
      juridiction: "TJ fictif",
      numero_rg: `RG-DROITS-${id.slice(0, 8)}`,
      restreint,
    });
    if (r.status !== 200) fail(`dossier ${nom} ${r.status} ${r.texte.slice(0, 160)}`);
  }

  const ids = {
    intPublic: randomUUID(),
    intRestreint: randomUUID(),
    facPublique: randomUUID(),
    facRestreinte: randomUUID(),
    encRestreint: randomUUID(),
    message: randomUUID(),
  };
  for (const [intId, dossierId] of [
    [ids.intPublic, publicId],
    [ids.intRestreint, restreintId],
  ]) {
    await sqlServeur(
      `INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite, revision)
       SELECT '${intId}', c.cabinet_id, '${dossierId}', c.id, q.id, 'public', 1
       FROM contacts c JOIN qualites q ON q.cabinet_id = c.cabinet_id AND q.code = 'client'
       WHERE c.id = '${contactId}'`,
    );
  }
  const numero = 9_500_000 + Number(marque) * 10;
  for (const [facId, dossierId, ttc, n] of [
    [ids.facPublique, publicId, 5000, numero + 1],
    [ids.facRestreinte, restreintId, 7700, numero + 2],
  ]) {
    const ht = Math.round((ttc * 5) / 6);
    await sqlServeur(
      `INSERT INTO factures (id, cabinet_id, dossier_id, contact_id, type, statut, numero,
         montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp)
       SELECT '${facId}', cabinet_id, '${dossierId}', id, 'facture', 'validee', ${n}, ${ht}, ${ttc - ht}, ${ttc}, 2000
       FROM contacts WHERE id = '${contactId}'`,
    );
  }
  await sqlServeur(
    `INSERT INTO facture_encaissements (id, facture_id, montant_centimes, cle_idempotence)
     VALUES ('${ids.encRestreint}', '${ids.facRestreinte}', 1000, 'droits-enc-${marque}')`,
  );
  const compte = (
    await sqlServeur(
      `SELECT id FROM comptes_mail WHERE cabinet_id = (SELECT cabinet_id FROM contacts WHERE id = '${contactId}') ORDER BY cree_le LIMIT 1`,
    )
  ).trim();
  if (compte !== "") {
    await sqlServeur(
      `INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
         objet, expediteur, etat_classement, visibilite, restreint, date_entete)
       SELECT '${ids.message}', cabinet_id, '${compte}', '${restreintId}', '<droits-${marque}@cabinet.example>', 1,
              ${Date.now() % 1_000_000_000}, 'CourrierSecret${marque}', 'claire-${marque}@example.test', 'classe',
              'restreint', TRUE, '2026-10-27 09:12:00+00'
       FROM contacts WHERE id = '${contactId}'`,
    );
  }
  const serveur = (
    await sqlServeur(
      `SELECT (SELECT COUNT(*) FROM dossier_intervenants WHERE id = '${ids.intRestreint}' AND groupe_acces IS NOT NULL) || '|' ||
              (SELECT COUNT(*) FROM factures WHERE id = '${ids.facRestreinte}' AND groupe_acces IS NOT NULL) || '|' ||
              (SELECT visibilite FROM dossier_intervenants WHERE id = '${ids.intRestreint}')`,
    )
  ).trim();
  ok(`serveur : intervenant et facture du dossier restreint dans un groupe d'accès (${serveur})`);
  if (!serveur.startsWith("1|1|")) fail(`le serveur ne range pas les enfants du dossier restreint dans un groupe : ${serveur}`);

  async function poste(id, port, email, password, secret, verifier) {
    resetPostes([id]);
    app = startApp(id, port);
    try {
      await waitCdp(app);
      const cdp = await connectCdp(app.port);
      await login(cdp.send, email, password, secret, `Droits ${id} ${marque}`);
      await verifier(cdp.send, id);
      cdp.ws.close();
    } finally {
      await stopApp(app);
      app = null;
    }
  }

  async function ouvrirFiche(send) {
    await cliquer(send, "[data-testid=nav-contacts]");
    const ligne = `[data-testid=contacts-ligne][data-contact-id="${contactId}"]`;
    await attendre(send, ligne);
    await cliquer(send, ligne);
    await attendre(send, "[data-testid=contacts-onglet-dossiers]");
  }

  // Poste du collaborateur sans accès (B).
  await poste("droitsb", 9371, collabEmail, collabPassword, collabTotp, async (send, id) => {
    await attendreSqlite(id, `SELECT COUNT(*) FROM contacts WHERE id = '${contactId}'`, (v) => v === "1");
    await attendreSqlite(id, `SELECT COUNT(*) FROM dossiers WHERE id = '${publicId}'`, (v) => v === "1");
    await attendreSqlite(id, `SELECT COUNT(*) FROM dossier_intervenants WHERE id = '${ids.intPublic}'`, (v) => v === "1");
    await attendreSqlite(id, `SELECT COUNT(*) FROM factures WHERE id = '${ids.facPublique}'`, (v) => v === "1");
    await sleep(15_000); // laisse arriver ce qui aurait pu fuir
    const absents = [
      ["dossiers", restreintId],
      ["dossier_intervenants", ids.intRestreint],
      ["factures", ids.facRestreinte],
      ["facture_encaissements", ids.encRestreint],
      ["messages", ids.message],
    ];
    for (const [table, enr] of absents) {
      const n = await sqliteLocal(id, `SELECT COUNT(*) FROM ${table} WHERE id = '${enr}'`);
      if (n !== "0") fail(`SQLite de B : ${table} contient l'enregistrement du dossier restreint (${n})`);
    }
    const parContact = await sqliteLocal(id, `SELECT COUNT(*) FROM factures WHERE contact_id = '${contactId}'`);
    if (parContact !== "1") fail(`SQLite de B : factures du contact = ${parContact} (attendu 1)`);
    ok("B : fiche présente, dossier restreint, intervenant, facture, encaissement et mail absents du SQLite");

    await ouvrirFiche(send);
    await cliquer(send, "[data-testid=contacts-onglet-dossiers]");
    await sleep(800);
    let onglet = await texte(send, "[data-testid=contacts-onglet-dossiers]");
    for (let i = 0; i < 20 && !/\d/.test(onglet); i += 1) {
      await sleep(500);
      onglet = await texte(send, "[data-testid=contacts-onglet-dossiers]");
    }
    const dossiers = await texte(send, "[data-testid=contacts-dossiers]");
    if (!dossiers.includes(`DossierPublic${marque}`)) fail(`B : dossier public absent de l'onglet : ${dossiers.slice(0, 200)}`);
    if (dossiers.includes(`DossierSecret${marque}`)) fail("B : le dossier restreint apparaît dans l'onglet Dossiers");
    if (!/1/.test(onglet) || /2/.test(onglet)) fail(`B : compteur de l'onglet Dossiers « ${onglet} » (attendu 1)`);
    await cliquer(send, "[data-testid=contacts-onglet-factures]");
    await sleep(800);
    const factures = await texte(send, "[data-testid=contacts-factures]");
    if (/77/.test(factures) || /DossierSecret/.test(factures)) fail(`B : la facture du dossier restreint apparaît : ${factures.slice(0, 300)}`);
    if (!/50/.test(factures)) fail(`B : la facture publique est absente : ${factures.slice(0, 300)}`);
    const corps = String((await evaluate(send, "document.body.innerText")) ?? "");
    if (corps.includes(`DossierSecret${marque}`) || corps.includes(`CourrierSecret${marque}`)) {
      fail("B : une mention du dossier restreint est visible sur la fiche");
    }
    ok(`B : onglet Dossiers « ${onglet.trim()} » sans le dossier restreint, onglet Factures sans sa facture`);
  });

  // Témoin : le titulaire (A) a bien les enfants du dossier restreint.
  await poste("droitsa", 9372, demoEmail, demoPassword, totpSecretB32, async (send, id) => {
    await attendreSqlite(id, `SELECT COUNT(*) FROM dossier_intervenants WHERE id = '${ids.intRestreint}'`, (v) => v === "1");
    await attendreSqlite(id, `SELECT COUNT(*) FROM factures WHERE id = '${ids.facRestreinte}'`, (v) => v === "1");
    await attendreSqlite(id, `SELECT COUNT(*) FROM dossiers WHERE id = '${restreintId}'`, (v) => v === "1");
    await ouvrirFiche(send);
    await cliquer(send, "[data-testid=contacts-onglet-dossiers]");
    await sleep(800);
    const dossiers = await texte(send, "[data-testid=contacts-dossiers]");
    if (!dossiers.includes(`DossierSecret${marque}`) || !dossiers.includes(`DossierPublic${marque}`)) {
      fail(`A : témoin, les deux dossiers devraient apparaître : ${dossiers.slice(0, 200)}`);
    }
    ok("A (témoin) : intervenant, facture et dossier restreint présents, les deux dossiers sur la fiche");
  });

  ok("OK");
} catch (err) {
  if (app) console.error(app.logTail?.() ?? "");
  if (!(err instanceof Error) || !String(err.message).includes("FAIL")) {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
} finally {
  if (app) await stopApp(app);
  fermer();
}
