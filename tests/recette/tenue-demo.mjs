#!/usr/bin/env node
/**
 * Jeu Tenue visuelle sur l'instance de démonstration (port 8188), jamais sur celle des recettes (8088).
 * Usage : node tests/recette/tenue-demo.mjs
 * Prérequis : docker compose -p legalos-demo --env-file .env.demo up -d, puis cargo xtask demo sur cette base.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const demoApi = process.env.LEGALOS_DEMO_API ?? "http://127.0.0.1:8188/api";
const recetteApi = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";

function fail(message) {
  console.error(`tenue-demo: FAIL — ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`tenue-demo: ${message}`);
}

function sql(requete) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", "legalos-demo-postgres-1", "psql", "-U", "legalos", "-d", "legalos", "-tAc", requete],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let sortie = "";
    let erreur = "";
    child.stdout.on("data", (morceau) => {
      sortie += morceau.toString();
    });
    child.stderr.on("data", (morceau) => {
      erreur += morceau.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(sortie.trim());
      else reject(new Error(erreur.slice(0, 200) || `psql ${code}`));
    });
  });
}

const NOMS = [
  ["Martin", "Durand"],
  ["Bernard", "Petit"],
  ["Dubois", "Laurent"],
  ["Thomas", "Simon"],
  ["Robert", "Michel"],
  ["Richard", "Leroy"],
  ["Moreau", "Roux"],
  ["Fournier", "Girard"],
  ["Mercier", "Blanc"],
  ["Faure", "Guerin"],
  ["Garnier", "Chevalier"],
  ["Boyer", "Colin"],
  ["Gauthier", "Perrin"],
  ["Robin", "Morin"],
  ["Nicolas", "Clement"],
  ["Henry", "Gautier"],
  ["Roussel", "Mathieu"],
  ["David", "Masson"],
  ["Bertrand", "Denis"],
  ["Lambert", "Morel"],
  ["Bonnet", "Girard"],
  ["Francois", "Lefebvre"],
  ["Legrand", "Garcia"],
  ["Rousseau", "Fontaine"],
  ["Vincent", "Chevallier"],
  ["Muller", "Roy"],
  ["Lefevre", "Andre"],
  ["Picard", "Meyer"],
  ["Gaillard", "Barbier"],
  ["Caron", "Roux"],
];
const CHEMISES = ["kraft", "bleu-classeur", "vert-amande", "jaune-paille", "rose-buvard", "lilas", "vert-eau", "gris-perle"];

if (new URL(demoApi).port === new URL(recetteApi).port) fail("l'instance de démonstration n'est pas distincte");
const santeDemo = await fetch(`${demoApi.replace(/\/api$/, "")}/health`).catch(() => null);
if (!santeDemo?.ok) fail("instance de démonstration absente (port 8188)");
const santeRecette = await fetch(`${recetteApi}/health`).catch(() => null);
if (!santeRecette?.ok) fail("l'instance des recettes ne répond plus");
ok("les deux instances répondent, sur des ports différents");

const deja = Number(await sql(`SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %'`));
if (deja > 0 && deja < NOMS.length) {
  await sql(`DELETE FROM brouillons_facture WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM temps_saisis WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM agenda_elements WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM parties WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM dossiers WHERE nom LIKE 'Tenue — %'`);
  await sql(`DELETE FROM upload_idempotence WHERE cle LIKE '%tenue-demo%'`);
  ok("jeu incomplet retiré");
}
const presents = Number(await sql(`SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %'`));
if (presents >= NOMS.length) {
  const parties = Number(await sql(`SELECT COUNT(*) FROM parties p JOIN dossiers d ON d.id = p.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  const agenda = Number(await sql(`SELECT COUNT(*) FROM agenda_elements a JOIN dossiers d ON d.id = a.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  const temps = Number(await sql(`SELECT COUNT(*) FROM temps_saisis t JOIN dossiers d ON d.id = t.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  if (parties < NOMS.length || agenda < NOMS.length || temps < NOMS.length) {
    fail(`jeu incomplet (parties ${parties}, agenda ${agenda}, temps ${temps})`);
  }
  ok(`jeu déjà chargé (${deja} dossiers)`);
  process.exit(0);
}

const jeton = await demoAccessToken(demoApi, "tenue-demo");
async function creer(chemin, corps) {
  const reponse = await fetch(`${demoApi}${chemin}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${chemin} → ${reponse.status} ${texte.slice(0, 180)}`);
  return texte ? JSON.parse(texte) : null;
}

for (let index = 0; index < NOMS.length; index += 1) {
  const [demandeur, adversaire] = NOMS[index];
  const nom = `Tenue — ${demandeur} c/ ${adversaire}`;
  const dossierId = randomUUID();
  await creer("/dossiers", {
    id: dossierId,
    idempotence_cle: `tenue-demo-${nom}`,
    nom,
    chemise: CHEMISES[index % CHEMISES.length],
    juridiction: "TJ Paris",
    numero_rg: `TD${String(index + 1).padStart(2, "0")}`,
    restreint: false,
    type_dossier: index % 2 === 0 ? "contentieux" : "conseil",
    etape: "instruction",
  });
  await creer(`/dossiers/${dossierId}/parties`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-client-${index}`,
    role: "client",
    nom: `Sas ${demandeur}`,
  });
  await creer(`/dossiers/${dossierId}/parties`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-adv-${index}`,
    role: "adversaire",
    nom: adversaire,
  });
  const jour = String((index % 21) + 1).padStart(2, "0");
  await creer(`/dossiers/${dossierId}/agenda`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-ag-${index}`,
    type_element: index % 3 === 0 ? "audience" : "rendez_vous",
    titre: index % 3 === 0 ? `Audience ${demandeur}` : `Rendez-vous ${demandeur}`,
    debut: `2026-10-${jour}T09:30:00.000Z`,
  });
  const tempsId = randomUUID();
  await creer("/temps", {
    id: tempsId,
    dossier_id: dossierId,
    minutes: 30 + index,
    libelle: `Lecture ${demandeur}`,
    taux_centimes_heure: 25_000,
    idempotence_cle: `tenue-demo-temps-${index}`,
  });
  await creer("/brouillons-facture", {
    id: randomUUID(),
    dossier_id: dossierId,
    temps_id: tempsId,
    libelle: `Lecture ${demandeur}`,
    ht_centimes: Math.round(((30 + index) * 25_000) / 60),
    taux_centimes_heure: 25_000,
    idempotence_cle: `tenue-demo-br-${index}`,
  });
}

const comptes = await sql(
  `SELECT (SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM parties p JOIN dossiers d ON d.id = p.dossier_id WHERE d.nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM agenda_elements a JOIN dossiers d ON d.id = a.dossier_id WHERE d.nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM temps_saisis t JOIN dossiers d ON d.id = t.dossier_id WHERE d.nom LIKE 'Tenue — %')`,
);
ok(`jeu chargé sur l'instance de démonstration (${comptes})`);
