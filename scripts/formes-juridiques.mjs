/**
 * Compacte l'export TSV de la nomenclature des catégories juridiques (Insee).
 * Colonnes : niveau, code, libellé. Le classeur source n'est pas versionné.
 *
 * Usage : node scripts/formes-juridiques.mjs <cj.tsv> <formesJuridiques.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const source = process.argv[2];
const dest = process.argv[3];
if (source === undefined || dest === undefined) {
  console.error("usage: node scripts/formes-juridiques.mjs <cj.tsv> <formesJuridiques.json>");
  process.exit(1);
}

const table = {};
for (const ligne of readFileSync(source, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (ligne === "") continue;
  const [niveauTexte, code, ...reste] = ligne.split("\t");
  const libelle = reste.join("\t").trim();
  const niveau = Number(niveauTexte);
  if (!/^\d+$/.test(code ?? "") || libelle === "" || ![1, 2, 3].includes(niveau)) continue;
  const deja = table[code];
  if (deja !== undefined && deja.niveau > niveau) continue;
  table[code] = { libelle, niveau };
}

const codes = Object.keys(table).sort();
const trie = {};
for (const code of codes) trie[code] = table[code];
writeFileSync(dest, `${JSON.stringify(trie)}\n`, "utf8");
const niveau3 = codes.filter((code) => trie[code].niveau === 3).length;
console.log(`catégories juridiques : ${codes.length}, dont ${niveau3} au niveau III`);
