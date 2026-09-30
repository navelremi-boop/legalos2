#!/usr/bin/env node
/**
 * S8 — jeu de cas de la computation des délais (CPC 640 à 645, 908, 915-4).
 * Les règles sont dans docs/hypotheses-delais.md (à valider par l'avocat).
 * Cas = hypothèses H2–H13 + tableau final du document.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIBLIOTHEQUE_DELAIS,
  calculerChaineAppelConclusions,
  calculerDelaiComplet,
  calculerEcheance,
  dimancheDePaques,
  ecrireDate,
  joursFeriesMetropole,
  moisAugmentationDistance,
} from "../../apps/poste/src/delais/moteur.ts";

function fail(message) {
  console.error(`s8: FAIL — ${message}`);
  process.exit(1);
}

function attendre(libelle, obtenu, voulu) {
  if (obtenu !== voulu) fail(`${libelle} : ${obtenu} ≠ ${voulu}`);
}

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hypotheses = readFileSync(join(racine, "docs", "hypotheses-delais.md"), "utf8");
const marqueur = /à valider par l'avocat/i;
if (!marqueur.test(hypotheses)) {
  fail("docs/hypotheses-delais.md sans marqueur « à valider par l'avocat » en tête");
}
for (const id of [
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
  "H9",
  "H10",
  "H11",
  "H12",
  "H13",
]) {
  if (!hypotheses.includes(`## ${id}`)) {
    fail(`hypothèse ${id} absente de docs/hypotheses-delais.md`);
  }
}

const paques = {
  2024: "2024-03-31",
  2025: "2025-04-20",
  2026: "2026-04-05",
  2020: "2020-04-12",
};
for (const [annee, iso] of Object.entries(paques)) {
  attendre(`Pâques ${annee}`, ecrireDate(dimancheDePaques(Number(annee))), iso);
}

const feries2024 = joursFeriesMetropole(2024);
for (const iso of [
  "2024-01-01",
  "2024-04-01",
  "2024-05-01",
  "2024-05-08",
  "2024-05-09",
  "2024-05-20",
  "2024-07-14",
  "2024-08-15",
  "2024-11-01",
  "2024-11-11",
  "2024-12-25",
]) {
  if (!feries2024.has(iso)) fail(`férié absent ${iso}`);
}
if (feries2024.size !== 11) fail(`onze fériés attendus, ${feries2024.size}`);

if (!BIBLIOTHEQUE_DELAIS.some((t) => t.id === "appel-538" && t.augmentationDistance === "oui")) {
  fail("bibliothèque : appel art. 538 manquant");
}
if (
  !BIBLIOTHEQUE_DELAIS.some(
    (t) => t.id === "conclusions-908" && t.augmentationDistance === "regime-special",
  )
) {
  fail("bibliothèque : conclusions art. 908 régime spécial manquant");
}

// H2 — art. 641 al. 1 : jour de l'acte exclu
attendre(
  "H2 15 jours, jour de l'acte exclu",
  calculerEcheance({ origine: "2024-01-10", jours: 15 }),
  "2024-01-25",
);
// H6 — art. 642 al. 2 : samedi → lundi
attendre(
  "H6 échéance un samedi, report au lundi",
  calculerEcheance({ origine: "2024-03-15", jours: 1 }),
  "2024-03-18",
);
// H6 + H7 — 1er mai
attendre(
  "H6/H7 1er mai férié, report au 2 mai",
  calculerEcheance({ origine: "2024-04-30", jours: 1 }),
  "2024-05-02",
);
// H6 + H7 — dimanche de Pâques puis lundi de Pâques
attendre(
  "H6/H7 dimanche puis lundi de Pâques",
  calculerEcheance({ origine: "2024-03-30", jours: 1 }),
  "2024-04-02",
);
// H3 — art. 641 al. 2 : quantième / 31 janvier
attendre(
  "H3 31 janvier, un mois, année bissextile",
  calculerEcheance({ origine: "2024-01-31", mois: 1 }),
  "2024-02-29",
);
attendre(
  "H3 31 janvier, un mois, année non bissextile",
  calculerEcheance({ origine: "2023-01-31", mois: 1 }),
  "2023-02-28",
);
attendre(
  "H3 un mois, même quantième",
  calculerEcheance({ origine: "2024-03-15", mois: 1 }),
  "2024-04-15",
);
// H4 — art. 641 al. 3 : mois puis jours, puis report H6
attendre(
  "H4 un mois et dix jours, puis dimanche",
  calculerEcheance({ origine: "2024-01-15", mois: 1, jours: 10 }),
  "2024-02-26",
);
// H8 — art. 643-644 : mois de distance avant jours et report (rétrocompat moisDistance)
attendre(
  "H8 deux mois de distance ajoutés au mois",
  calculerEcheance({ origine: "2024-01-10", mois: 1, moisDistance: 2 }),
  "2024-04-10",
);
attendre(
  "H8 un mois de distance après quinze jours",
  calculerEcheance({ origine: "2024-01-10", jours: 15, moisDistance: 1 }),
  "2024-02-26",
);

// --- Tableau final (hypotheses-delais.md) ---

// 1. 20 février 2018 + 3 mois → mardi 22 mai 2018 (dimanche puis lundi de Pentecôte)
attendre(
  "cas 1 Pentecôte 2018 (Cass. 3e civ. 21 janv. 2021)",
  calculerEcheance({ origine: "2018-02-20", mois: 3 }),
  "2018-05-22",
);

// 2. Appelant à l'étranger, signification 2025-01-10
{
  const chaine = calculerChaineAppelConclusions({
    origine: "2025-01-10",
    siegeJuridiction: "metropole",
    lieuPartie: "etranger",
  });
  attendre("cas 2 échéance d'appel", chaine.appel.echeance, "2025-04-10");
  attendre("cas 2 mois d'augmentation appel (art. 643)", chaine.appel.moisAugmentation, 2);
  attendre("cas 2 source appel", chaine.appel.sourceAugmentation, "art. 643");
  attendre(
    "cas 2 conclusions : 5 mois à compter de la déclaration d'appel",
    chaine.moisConclusions,
    5,
  );
  attendre("cas 2 source conclusions (915-4)", chaine.conclusions.sourceAugmentation, "art. 915-4");
  attendre(
    "cas 2 échéance conclusions si appel le dernier jour",
    chaine.conclusions.echeance,
    "2025-09-10",
  );
}

// 3. Partie Mayotte, juridiction métropole → appel 1+1 ; conclusions 3+1
{
  const chaine = calculerChaineAppelConclusions({
    origine: "2025-01-10",
    siegeJuridiction: "metropole",
    lieuPartie: "outre-mer",
    departement: "976",
  });
  attendre("cas 3 appel mois base+aug = 2", 1 + chaine.appel.moisAugmentation, 2);
  attendre("cas 3 appel augmentation", chaine.appel.moisAugmentation, 1);
  attendre("cas 3 conclusions mois = 4", chaine.moisConclusions, 4);
  attendre("cas 3 conclusions augmentation", chaine.conclusions.moisAugmentation, 1);
}

// 4. Partie Saint-Barthélemy, cour Basse-Terre (dép. siège 971) → +1 mois
{
  const aug = moisAugmentationDistance({
    siegeJuridiction: "collectivite-644",
    departementSiege: "971",
    lieuPartie: "outre-mer",
    departement: "977",
    augmentationDistance: "oui",
  });
  attendre("cas 4 Saint-Barthélemy hors dép. 971", aug.mois, 1);
  attendre("cas 4 source art. 644", aug.source, "art. 644");
  const resultat = calculerDelaiComplet({
    origine: "2025-01-10",
    mois: 1,
    siegeJuridiction: "collectivite-644",
    departementSiege: "971",
    lieuPartie: "outre-mer",
    departement: "977",
    typeDelai: { augmentationDistance: "oui" },
  });
  attendre("cas 4 échéance appel 1+1 mois", resultat.echeance, "2025-03-10");
  attendre("cas 4 moisAugmentation", resultat.moisAugmentation, 1);
}

// 5. Intimé en métropole, appelant à l'étranger → aucune augmentation pour l'intimé
{
  const intimé = calculerDelaiComplet({
    origine: "2025-01-10",
    mois: 1,
    siegeJuridiction: "metropole",
    lieuPartie: "metropole",
    typeDelai: { augmentationDistance: "oui" },
  });
  attendre("cas 5 intimé métropole : aucune augmentation", intimé.moisAugmentation, 0);
  attendre("cas 5 intimé source vide", intimé.sourceAugmentation, "");
  attendre("cas 5 intimé échéance 1 mois", intimé.echeance, "2025-02-10");
}

// H11 — double date : expéditeur vs destinataire
attendre(
  "H11 origine = expédition pour l'expéditeur",
  calculerDelaiComplet({
    origine: "2025-01-01",
    dateExpedition: "2025-02-01",
    dateRemise: "2025-03-01",
    rolePartie: "expediteur",
    mois: 1,
    typeDelai: { augmentationDistance: "non" },
  }).echeance,
  "2025-03-03",
);
attendre(
  "H11 origine = remise pour le destinataire",
  calculerDelaiComplet({
    origine: "2025-01-01",
    dateExpedition: "2025-02-01",
    dateRemise: "2025-03-01",
    rolePartie: "destinataire",
    mois: 1,
    typeDelai: { augmentationDistance: "non" },
  }).echeance,
  "2025-04-01",
);

// H8 — augmentationDistance = non
attendre(
  "H8 type sans augmentation",
  calculerDelaiComplet({
    origine: "2024-01-10",
    mois: 1,
    lieuPartie: "etranger",
    siegeJuridiction: "metropole",
    typeDelai: { augmentationDistance: "non" },
  }).moisAugmentation,
  0,
);

console.log("s8: OK — jeu de cas des délais");
