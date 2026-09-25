#!/usr/bin/env node
/**
 * S8 — jeu de cas de la computation des délais (CPC 640 à 644).
 * Les règles sont dans docs/hypotheses-delais.md.
 */
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

attendre(
  "15 jours, jour de l'acte exclu",
  calculerEcheance({ origine: "2024-01-10", jours: 15 }),
  "2024-01-25",
);
attendre(
  "échéance un samedi, report au lundi",
  calculerEcheance({ origine: "2024-03-15", jours: 1 }),
  "2024-03-18",
);
attendre(
  "1er mai férié, report au 2 mai",
  calculerEcheance({ origine: "2024-04-30", jours: 1 }),
  "2024-05-02",
);
attendre(
  "dimanche puis lundi de Pâques",
  calculerEcheance({ origine: "2024-03-30", jours: 1 }),
  "2024-04-02",
);
attendre(
  "31 janvier, un mois, année bissextile",
  calculerEcheance({ origine: "2024-01-31", mois: 1 }),
  "2024-02-29",
);
attendre(
  "31 janvier, un mois, année non bissextile",
  calculerEcheance({ origine: "2023-01-31", mois: 1 }),
  "2023-02-28",
);
attendre(
  "un mois, même quantième",
  calculerEcheance({ origine: "2024-03-15", mois: 1 }),
  "2024-04-15",
);
attendre(
  "un mois et dix jours, puis dimanche",
  calculerEcheance({ origine: "2024-01-15", mois: 1, jours: 10 }),
  "2024-02-26",
);
attendre(
  "deux mois de distance ajoutés au mois",
  calculerEcheance({ origine: "2024-01-10", mois: 1, moisDistance: 2 }),
  "2024-04-10",
);
attendre(
  "un mois de distance après quinze jours",
  calculerEcheance({ origine: "2024-01-10", jours: 15, moisDistance: 1 }),
  "2024-02-26",
);

console.log("s8: OK — jeu de cas des délais");
