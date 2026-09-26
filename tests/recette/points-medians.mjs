#!/usr/bin/env node
/**
 * Consigne de l'architecte du 26/09 (La journée, B9) : aucun point médian « · » dans un texte
 * d'interface ; séparer par une virgule (« TJ Nanterre, 9 h 30 »). Les caractères qui lui
 * ressemblent sont refusés aussi, pour qu'un remplacement ne contourne pas la règle.
 * Portée : sources de l'interface du poste (apps/poste/src et apps/poste/index.html).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = /\.(tsx?|jsx?|mjs|css|html|json)$/;
const INTERDITS = new Map([
  ["\u00B7", "point médian"],
  ["\u2022", "puce"],
  ["\u2027", "point de coupure"],
  ["\u2219", "opérateur puce"],
  ["\u22C5", "opérateur point"],
  ["\u30FB", "point médian katakana"],
  ["\uFF65", "point médian demi-chasse"],
]);

function fichiers(dossier, acc = []) {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom !== "node_modules" && nom !== "dist") fichiers(chemin, acc);
    } else if (EXTENSIONS.test(nom)) {
      acc.push(chemin);
    }
  }
  return acc;
}

const cibles = fichiers(join(root, "apps/poste/src"));
const indexHtml = join(root, "apps/poste/index.html");
if (existsSync(indexHtml)) cibles.push(indexHtml);
if (cibles.length < 10) {
  console.error(`points-medians: FAIL — seulement ${cibles.length} fichiers examinés`);
  process.exit(1);
}

const occurrences = [];
for (const chemin of cibles) {
  const lignes = readFileSync(chemin, "utf8").split("\n");
  lignes.forEach((ligne, i) => {
    [...ligne].forEach((c, colonne) => {
      const nom = INTERDITS.get(c);
      if (nom) {
        const fichier = relative(root, chemin).replace(/\\/g, "/");
        occurrences.push(`${fichier}:${i + 1}:${colonne + 1} ${nom} — ${ligne.trim().slice(0, 100)}`);
      }
    });
  });
}

if (occurrences.length > 0) {
  for (const o of occurrences) console.error(`points-medians: FAIL — ${o}`);
  console.error("points-medians: séparer par une virgule, comme « TJ Nanterre, 9 h 30 ».");
  process.exit(1);
}
console.log(`points-medians: OK — ${cibles.length} fichiers d'interface sans point médian`);
