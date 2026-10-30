/**
 * Compacte le CSV de la base officielle des codes postaux (La Poste, Licence Ouverte 2.0)
 * en une table code → communes. Le fichier source n'est pas versionné.
 *
 * Usage : node scripts/codes-postaux.mjs <hexasmal.csv> <codesPostaux.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const source = process.argv[2];
const dest = process.argv[3];
if (source === undefined || dest === undefined) {
  console.error("usage: node scripts/codes-postaux.mjs <hexasmal.csv> <codesPostaux.json>");
  process.exit(1);
}

const texte = readFileSync(source, "utf8").replace(/^\uFEFF/, "");
const lignes = texte.split(/\r?\n/);
const entetes = (lignes[0] ?? "").replace(/^#/, "").split(";");
const iCode = entetes.indexOf("Code_postal");
const iNom = entetes.indexOf("Nom_de_la_commune");
if (iCode < 0 || iNom < 0) {
  console.error("colonnes absentes");
  process.exit(1);
}

const parCode = new Map();
for (const ligne of lignes.slice(1)) {
  if (ligne === "") continue;
  const colonnes = ligne.split(";");
  const code = colonnes[iCode] ?? "";
  const nom = colonnes[iNom] ?? "";
  if (!/^\d{5}$/.test(code) || nom === "") continue;
  const noms = parCode.get(code) ?? new Set();
  noms.add(nom);
  parCode.set(code, noms);
}

const table = {};
for (const code of [...parCode.keys()].sort()) {
  table[code] = [...parCode.get(code)].sort((a, b) => a.localeCompare(b, "fr"));
}

writeFileSync(dest, `${JSON.stringify(table)}\n`, "utf8");
console.log(`codes postaux : ${Object.keys(table).length}`);
