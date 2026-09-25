#!/usr/bin/env node
/**
 * S8 — jeu de cas de la computation des délais (CPC 640 à 644).
 * Les règles sont dans docs/hypotheses-delais.md.
 * Cas = hypothèses H2–H8 (jour de l'acte exclu, quantième, 31 janv.,
 * samedi, 1er mai, lundi de Pâques, mois puis jours, mois de distance).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculerEcheance,
  dimancheDePaques,
  ecrireDate,
  joursFeriesMetropole,
} from "../../apps/poste/src/delais/moteur.mjs";

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
  fail("docs/hypotheses-delais.md sans marqueur « à valider par l'avocat »");
}
for (const id of ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"]) {
  const debut = hypotheses.indexOf(`## ${id}`);
  if (debut < 0) fail(`hypothèse ${id} absente de docs/hypotheses-delais.md`);
  const fin = hypotheses.indexOf("\n## ", debut + 1);
  const section = fin < 0 ? hypotheses.slice(debut) : hypotheses.slice(debut, fin);
  if (!marqueur.test(section)) {
    fail(`${id} sans marqueur « à valider par l'avocat »`);
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
for (const iso of ["2024-01-01", "2024-04-01", "2024-05-01", "2024-05-08", "2024-05-09", "2024-05-20", "2024-07-14", "2024-08-15", "2024-11-01", "2024-11-11", "2024-12-25"]) {
  if (!feries2024.has(iso)) fail(`férié absent ${iso}`);
}
if (feries2024.size !== 11) fail(`onze fériés attendus, ${feries2024.size}`);

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
// H8 — art. 643-644 : mois de distance avant jours et report
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

console.log("s8: OK — jeu de cas des délais");
