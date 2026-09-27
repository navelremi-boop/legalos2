#!/usr/bin/env node
/**
 * Cahier § 3.4 : migrations serveur « uniquement additives (on ajoute d'abord, on supprime
 * plusieurs versions plus tard) ». Refuse toute instruction qui retire, renomme ou retype un objet,
 * ou qui supprime des données. Seule exception : `SET NOT NULL` sur une colonne ajoutée dans le
 * même fichier (ajout, remplissage, puis contrainte). Une suppression différée relève d'une
 * décision de l'architecte (BLOCAGES.md), pas d'une exception locale.
 * Usage : node tests/recette/migrations-additives.mjs [répertoire des migrations]
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dossier = process.argv[2] ? resolve(process.argv[2]) : join(root, "crates/api/migrations");

const INTERDITS = [
  [/\bDROP\b/i, "retire un objet (DROP)"],
  [/\bRENAME\b/i, "renomme un objet (RENAME)"],
  [/\bALTER\s+COLUMN\s+[\w"]+\s+(?:SET\s+DATA\s+)?TYPE\b/i, "change le type d'une colonne"],
  [/\bTRUNCATE\b/i, "supprime des données (TRUNCATE)"],
  [/\bDELETE\s+FROM\b/i, "supprime des données (DELETE)"],
];
const SET_NOT_NULL = /\bALTER\s+COLUMN\s+([\w"]+)\s+SET\s+NOT\s+NULL\b/gi;
const ADD_COLUMN = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi;
const ALTER_TABLE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)/i;

/** Remplace commentaires, chaînes et corps entre dollars par des blancs, lignes conservées. */
function nettoyer(sql) {
  const blanc = (bloc) => bloc.replace(/[^\n]/g, " ");
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, blanc)
    .replace(/\/\*[\s\S]*?\*\//g, blanc)
    .replace(/--[^\n]*/g, blanc)
    .replace(/'(?:[^']|'')*'/g, blanc);
}

function nom(identifiant) {
  return identifiant.replace(/"/g, "").toLowerCase();
}

const fichiers = readdirSync(dossier).filter((f) => f.endsWith(".sql")).sort();
if (fichiers.length === 0) {
  console.error(`migrations-additives: FAIL — aucune migration dans ${dossier}`);
  process.exit(1);
}

const erreurs = [];
for (const fichier of fichiers) {
  const texte = nettoyer(readFileSync(join(dossier, fichier), "utf8"));
  const instructions = [];
  let debut = 0;
  for (const morceau of texte.split(";")) {
    instructions.push({ sql: morceau, ligne: texte.slice(0, debut).split("\n").length });
    debut += morceau.length + 1;
  }

  const ajoutees = new Set();
  for (const { sql } of instructions) {
    const table = ALTER_TABLE.exec(sql);
    if (!table) continue;
    for (const m of sql.matchAll(ADD_COLUMN)) ajoutees.add(`${nom(table[1])}.${nom(m[1])}`);
  }

  for (const { sql, ligne } of instructions) {
    const decalage = sql.length - sql.trimStart().length;
    const ligneInstruction = ligne + sql.slice(0, decalage).split("\n").length - 1;
    const chemin = relative(root, join(dossier, fichier)).replace(/\\/g, "/");
    for (const [motif, raison] of INTERDITS) {
      if (motif.test(sql)) erreurs.push(`${chemin}:${ligneInstruction} ${raison} — ${sql.trim().split("\n")[0]}`);
    }
    const table = ALTER_TABLE.exec(sql);
    for (const m of sql.matchAll(SET_NOT_NULL)) {
      const cle = table ? `${nom(table[1])}.${nom(m[1])}` : null;
      if (!cle || !ajoutees.has(cle)) {
        erreurs.push(`${chemin}:${ligneInstruction} SET NOT NULL sur une colonne qui n'est pas ajoutée dans ce fichier — ${sql.trim().split("\n")[0]}`);
      }
    }
  }
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`migrations-additives: FAIL — ${e}`);
  console.error("migrations-additives: une migration ajoute (table, colonne, index, contrainte) ; une suppression différée se décide avec l'architecte.");
  process.exit(1);
}
console.log(`migrations-additives: OK — ${fichiers.length} migrations, uniquement additives`);
