#!/usr/bin/env node
/**
 * Dossiers et contacts complets — API Postgres, puis app Tauri.
 * Le dossier porte client, adversaires, confrères, juridiction, n° RG, type et étape.
 * Les liens se lisent dans les deux sens. Le contact a une nature, un rôle, un historique,
 * un SIREN, un n° TVA et un type_client (professionnel, particulier, étranger — F8).
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur, sqliteLocal } from "./lib/poste-session.mjs";

const session = creerSession("dossiers-contacts");
const { fail, ok, apiJson, assurerInstance, instanceUrl } = session;
const collabEmail = "collab-j5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

await assurerInstance();
const table = await sqlServeur(
  `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contacts'`,
).catch(() => "");
if (table !== "1") fail("table contacts absente (migration 021 — reconstruire l'API)");

const jeton = await demoAccessToken(`${instanceUrl}/api`, `dossiers-contacts-${session.marque}`);

async function creer(chemin, corps) {
  const reponse = await apiJson(jeton, "POST", chemin, corps);
  if (reponse.status !== 200) fail(`${chemin} → ${reponse.status} ${reponse.texte.slice(0, 180)}`);
  return reponse.json;
}

const dossierA = randomUUID();
const dossierB = randomUUID();
const dossierR = randomUUID();
const contactMoral = randomUUID();
const contactPhys = randomUUID();
const contactEtr = randomUUID();
const rgA = `26/${session.marque}1`;
const rgB = `26/${session.marque}2`;

await creer("/dossiers", {
  id: dossierA,
  idempotence_cle: `dc-a-${dossierA}`,
  nom: `Dossier API ${session.marque}`,
  chemise: "kraft",
  juridiction: "TJ Nanterre",
  numero_rg: rgA,
  restreint: false,
  type_dossier: "contentieux",
  etape: "instruction",
});
await creer("/dossiers", {
  id: dossierB,
  idempotence_cle: `dc-b-${dossierB}`,
  nom: `Dossier lié ${session.marque}`,
  chemise: "bleu-classeur",
  juridiction: "CA Versailles",
  numero_rg: rgB,
  restreint: false,
  type_dossier: "conseil",
  etape: "ouverture",
});
await creer("/dossiers", {
  id: dossierR,
  idempotence_cle: `dc-r-${dossierR}`,
  nom: `Dossier restreint ${session.marque}`,
  chemise: "gris-perle",
  juridiction: "TJ Paris",
  numero_rg: `26/${session.marque}R`,
  restreint: true,
});

const refuse = await apiJson(jeton, "POST", "/contacts", {
  id: randomUUID(),
  idempotence_cle: `dc-mauvais-${session.marque}`,
  nature: "morale",
  nom: "Mauvais type",
  type_client: "chorus",
});
if (refuse.status !== 400) fail(`type_client hors F8 accepté (${refuse.status})`);

const moral = await creer("/contacts", {
  id: contactMoral,
  idempotence_cle: `dc-cm-${contactMoral}`,
  nature: "morale",
  nom: `Societe ${session.marque}`,
  siren: "100000009",
  numero_tva: "FR88100000009",
  type_client: "professionnel",
});
if (moral.siren !== "100000009" || moral.type_client !== "professionnel") {
  fail("SIREN ou type professionnel non renvoyé");
}
await creer("/contacts", {
  id: contactPhys,
  idempotence_cle: `dc-cp-${contactPhys}`,
  nature: "physique",
  nom: `Camille ${session.marque}`,
  type_client: "particulier",
});
await creer("/contacts", {
  id: contactEtr,
  idempotence_cle: `dc-ce-${contactEtr}`,
  nature: "morale",
  nom: `Counsel ${session.marque}`,
  type_client: "etranger",
});

const partieClient = randomUUID();
await creer(`/dossiers/${dossierA}/parties`, {
  id: partieClient,
  idempotence_cle: `dc-pc-${partieClient}`,
  role: "client",
  nom: `Societe ${session.marque}`,
  contact_id: contactMoral,
});
for (const nom of [`Adverse un ${session.marque}`, `Adverse deux ${session.marque}`]) {
  const id = randomUUID();
  await creer(`/dossiers/${dossierA}/parties`, {
    id,
    idempotence_cle: `dc-pa-${id}`,
    role: "adversaire",
    nom,
  });
}
for (const [nom, contact] of [
  [`Confrere un ${session.marque}`, contactPhys],
  [`Confrere deux ${session.marque}`, contactEtr],
]) {
  const id = randomUUID();
  await creer(`/dossiers/${dossierA}/parties`, {
    id,
    idempotence_cle: `dc-pf-${id}`,
    role: "confrere",
    nom,
    contact_id: contact,
  });
}
const partieRestreinte = randomUUID();
await creer(`/dossiers/${dossierR}/parties`, {
  id: partieRestreinte,
  idempotence_cle: `dc-pr-${partieRestreinte}`,
  role: "client",
  nom: `Client restreint ${session.marque}`,
});

const roles = await sqlServeur(
  `SELECT string_agg(role, ',' ORDER BY role) FROM parties WHERE dossier_id = '${dossierA}'`,
);
if (roles !== "adversaire,adversaire,client,confrere,confrere") fail(`rôles API inattendus (${roles})`);
const fiche = await sqlServeur(
  `SELECT juridiction || '|' || numero_rg || '|' || type_dossier || '|' || etape FROM dossiers WHERE id = '${dossierA}'`,
);
if (fiche !== `TJ Nanterre|${rgA}|contentieux|instruction`) fail(`fiche dossier (${fiche})`);

const lien = await creer(`/dossiers/${dossierA}/liens`, {
  id: randomUUID(),
  idempotence_cle: `dc-lien-${dossierA}`,
  lie_a_id: dossierB,
});
if (!lien.id_inverse) fail("lien sans sens inverse");
const sens = await sqlServeur(
  `SELECT COUNT(*) FROM dossier_liens
   WHERE (dossier_id = '${dossierA}' AND lie_a_id = '${dossierB}')
      OR (dossier_id = '${dossierB}' AND lie_a_id = '${dossierA}')`,
);
if (sens !== "2") fail(`lien non réciproque (${sens})`);
await creer(`/dossiers/${dossierA}/liens`, {
  id: randomUUID(),
  idempotence_cle: `dc-lien-r-${dossierR}`,
  lie_a_id: dossierR,
});

const histo = await apiJson(jeton, "GET", `/contacts/${contactMoral}/historique`);
if (histo.status !== 200) fail(`historique ${histo.status}`);
const lignes = Array.isArray(histo.json) ? histo.json : [];
if (!lignes.some((l) => l.champ === "role" && l.valeur_appliquee === "client")) {
  fail("historique sans rôle client");
}

const contraintes = await sqlServeur(
  `SELECT
     (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'contacts_type_client_check')
     || '|' ||
     (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'factures_type_client_check')`,
);
for (const mot of ["professionnel", "particulier", "etranger"]) {
  const parts = contraintes.split("|");
  if (!parts[0]?.includes(mot) || !parts[1]?.includes(mot)) fail(`type_client F8 absent (${mot})`);
}
ok("API : fiche, rôles, lien réciproque, historique, SIREN, TVA, type_client");

const creation = await fetch(`${instanceUrl}/api/collaborateurs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
  body: JSON.stringify({
    email: collabEmail,
    password: collabPassword,
    totp_secret_base32: collabTotp,
  }),
});
if (!creation.ok && creation.status !== 409 && creation.status !== 400) {
  const deja = await sqlServeur(
    `SELECT 1 FROM utilisateurs WHERE email = '${collabEmail}'`,
  ).catch(() => "");
  if (deja !== "1") fail(`collaborateur ${creation.status}`);
}

session.resetPostes(["dca", "dcb"]);
const posteA = session.startApp("dca", "9271", "dev");
try {
  await session.waitCdp(posteA);
  const a = await session.connectCdp(posteA.port);
  await session.login(a.send, demoEmail, demoPassword, totpSecretB32, `DC A ${session.marque}`);
  ok("poste A connecté");

  const idUi = await session.creerDossier(a.send, {
    nom: `Dossier UI ${session.marque}`,
    juridiction: "TJ Lyon",
    rg: `RG${session.marque}`,
    partie: `Client UI ${session.marque}`,
    typeDossier: "contentieux",
    etape: "plaidoirie",
  });
  await session.ouvrirDossier(a.send, idUi);
  const debutFiche = Date.now();
  let ficheUi = "";
  while (Date.now() - debutFiche < 20_000) {
    ficheUi = await session.texte(a.send, "dossier-type-affiche");
    const etapeUi = await session.texte(a.send, "dossier-etape-affiche");
    const clientUi = await session.texte(a.send, "dossier-client");
    if (ficheUi.includes("Contentieux") && etapeUi.includes("Plaidoirie") && clientUi.includes("Client UI")) {
      break;
    }
    await sleep(300);
  }
  const etapeUi = await session.texte(a.send, "dossier-etape-affiche");
  const clientUi = await session.texte(a.send, "dossier-client");
  const infos = await session.texte(a.send, "infos-dossier");
  if (!ficheUi.includes("Contentieux") || !etapeUi.includes("Plaidoirie")) {
    fail(`type ou étape absents de l'écran (${ficheUi} / ${etapeUi})`);
  }
  if (!clientUi.includes("Client UI") || !infos.includes("TJ Lyon") || !infos.includes(`RG${session.marque}`)) {
    fail("client, juridiction ou n° RG absents de l'écran");
  }

  async function ajouterPartie(role, nom, contactNom, nature, typeClient, siren, tva) {
    await session.setField(a.send, "partie-role", role);
    await session.setField(a.send, "partie-nom", nom);
    if (contactNom) {
      await session.setField(a.send, "contact-nature", nature);
      await session.setField(a.send, "contact-nom", contactNom);
      await session.setField(a.send, "contact-siren", siren ?? "");
      await session.setField(a.send, "contact-tva", tva ?? "");
      await session.setField(a.send, "contact-type", typeClient);
    } else {
      await session.setField(a.send, "contact-nom", "");
    }
    await session.evaluate(a.send, `document.getElementById("partie-nom")?.closest("form")?.requestSubmit()`);
    await sleep(400);
  }
  await ajouterPartie("adversaire", `Adverse UI 1 ${session.marque}`);
  await ajouterPartie("adversaire", `Adverse UI 2 ${session.marque}`);
  await ajouterPartie(
    "confrere",
    `Confrere UI ${session.marque}`,
    `Contact UI ${session.marque}`,
    "morale",
    "professionnel",
    "100000025",
    "FR39100000025",
  );
  await ajouterPartie(
    "confrere",
    `Confrere etranger ${session.marque}`,
    `Etranger UI ${session.marque}`,
    "physique",
    "etranger",
  );

  const debutParties = Date.now();
  while (Date.now() - debutParties < 15_000) {
    const adv = await session.texte(a.send, "dossier-adversaire");
    const conf = await session.texte(a.send, "dossier-confrere");
    if (adv.includes("Adverse UI 1") && adv.includes("Adverse UI 2") && conf.includes("Confrere UI")) break;
    await sleep(300);
  }
  const adv = await session.texte(a.send, "dossier-adversaire");
  const conf = await session.texte(a.send, "dossier-confrere");
  if (!adv.includes("Adverse UI 1") || !adv.includes("Adverse UI 2")) fail(`adversaires écran (${adv})`);
  if (!conf.includes("Confrere UI") || !conf.includes("etranger")) fail(`confrères écran (${conf})`);

  const contactLocal = await session.evaluate(
    a.send,
    `(async () => window.__legalosRecette.lireSqlite(
      "SELECT nature, siren, numero_tva, type_client FROM contacts WHERE nom = ?",
      [${JSON.stringify(`Contact UI ${session.marque}`)}],
    ))()`,
  );
  const ligneContact = Array.isArray(contactLocal) ? contactLocal[0] : null;
  if (!ligneContact || ligneContact.nature !== "morale" || ligneContact.siren !== "100000025") {
    fail(`contact local incomplet (${JSON.stringify(ligneContact)})`);
  }
  if (ligneContact.type_client !== "professionnel" || ligneContact.numero_tva !== "FR39100000025") {
    fail(`facturation locale (${JSON.stringify(ligneContact)})`);
  }
  const etrangerLocal = await session.evaluate(
    a.send,
    `(async () => window.__legalosRecette.lireSqlite(
      "SELECT nature, type_client FROM contacts WHERE nom = ?",
      [${JSON.stringify(`Etranger UI ${session.marque}`)}],
    ))()`,
  );
  if (etrangerLocal?.[0]?.nature !== "physique" || etrangerLocal?.[0]?.type_client !== "etranger") {
    fail("personne physique étrangère absente");
  }

  const idB = await session.creerDossier(a.send, {
    nom: `Lie UI ${session.marque}`,
    juridiction: "CA Paris",
    rg: `LB${session.marque}`,
    partie: `Client lie ${session.marque}`,
    typeDossier: "conseil",
    etape: "ouverture",
    precedent: idUi,
  });
  await session.ouvrirDossier(a.send, idUi);
  await session.setField(a.send, "lien-cible", idB);
  await session.evaluate(a.send, `document.getElementById("lien-cible")?.closest("form")?.requestSubmit()`);
  const debutLien = Date.now();
  while (Date.now() - debutLien < 15_000) {
    const liens = await session.texte(a.send, "dossier-liens");
    if (liens.includes(`Lie UI ${session.marque}`)) break;
    await sleep(300);
  }
  if (!(await session.texte(a.send, "dossier-liens")).includes(`Lie UI ${session.marque}`)) {
    fail("lien absent du dossier source");
  }
  await session.ouvrirDossier(a.send, idB);
  const debutInverse = Date.now();
  while (Date.now() - debutInverse < 15_000) {
    const liens = await session.texte(a.send, "dossier-liens");
    if (liens.includes(`Dossier UI ${session.marque}`)) break;
    await sleep(300);
  }
  if (!(await session.texte(a.send, "dossier-liens")).includes(`Dossier UI ${session.marque}`)) {
    fail("lien absent dans l'autre sens");
  }
  ok("écran : fiche, parties, contact, lien dans les deux sens");

  await session.ouvrirDossier(a.send, idUi);
  const debutHisto = Date.now();
  let histoUi = "";
  while (Date.now() - debutHisto < 90_000) {
    histoUi = await session.texte(a.send, "contact-historique");
    if (histoUi.includes("role") && histoUi.includes("confrere")) break;
    await sleep(1_000);
  }
  if (!histoUi.includes("role")) fail(`historique absent de l'écran (${histoUi.slice(0, 120)})`);
  ok("historique du rôle visible");
} finally {
  await session.stopApp(posteA);
}

const posteB = session.startApp("dcb", "9272", "dev");
try {
  await session.waitCdp(posteB);
  const b = await session.connectCdp(posteB.port);
  await session.login(b.send, collabEmail, collabPassword, collabTotp, `DC B ${session.marque}`);
  const debutSync = Date.now();
  let publicVu = false;
  while (Date.now() - debutSync < 120_000) {
    const n = Number(
      await session.evaluate(
        b.send,
        `(async () => {
          const rows = await window.__legalosRecette.lireSqlite(
            "SELECT COUNT(*) AS n FROM dossiers WHERE id = ?",
            [${JSON.stringify(dossierA)}],
          );
          return Number(rows?.[0]?.n ?? 0);
        })()`,
      ),
    );
    if (n === 1) {
      publicVu = true;
      break;
    }
    await sleep(500);
  }
  if (!publicVu) fail("dossier public absent du poste non concerné par le restreint (sync non prouvée)");
  const partiesR = Number(await sqliteLocal("dcb", `SELECT COUNT(*) FROM parties WHERE dossier_id = '${dossierR}'`));
  const liensR = Number(
    await sqliteLocal(
      "dcb",
      `SELECT COUNT(*) FROM dossier_liens WHERE dossier_id = '${dossierR}' OR lie_a_id = '${dossierR}'`,
    ),
  );
  const dossierRestreint = Number(await sqliteLocal("dcb", `SELECT COUNT(*) FROM dossiers WHERE id = '${dossierR}'`));
  if (partiesR !== 0 || liensR !== 0 || dossierRestreint !== 0) {
    fail(`S5 : restreint visible (dossier ${dossierRestreint}, parties ${partiesR}, liens ${liensR})`);
  }
  ok("S5 : dossier restreint, partie et lien absents du poste non autorisé");
} finally {
  await session.stopApp(posteB);
}

ok("tous les critères");
session.fermer();
