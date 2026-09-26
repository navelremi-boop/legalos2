#!/usr/bin/env node
/**
 * Encodage des fichiers texte suivis par git : UTF-8 valide, sans BOM.
 * Motif : deux incidents de même type (BOM dans du Rust bloquant rustfmt en CI ;
 * lignes ANSI écrites par PowerShell `Add-Content` dans JOURNAL.md).
 * Les fins de ligne sont normalisées par `.gitattributes` (LF) et ne sont pas contrôlées ici.
 * Usage : node tests/recette/encodage-texte.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const extensions = new Set([
  ".md",
  ".mdc",
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".html",
  ".typ",
  ".xml",
  ".sch",
  ".xsl",
  ".txt",
  ".sh",
  ".ps1",
  ".cmd",
  ".example",
]);
const nomsSansExtension = new Set(["Caddyfile", ".gitattributes", ".gitignore", ".cursorignore"]);

function estTexte(chemin) {
  const nom = basename(chemin);
  if (nomsSansExtension.has(nom) || nom.startsWith("Dockerfile")) return true;
  return extensions.has(extname(nom).toLowerCase());
}

const suivis = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((chemin) => chemin.length > 0 && estTexte(chemin));

const decodeur = new TextDecoder("utf-8", { fatal: true });
const ecarts = [];
let controles = 0;
for (const chemin of suivis) {
  let octets;
  try {
    octets = readFileSync(join(root, chemin));
  } catch {
    continue; // supprimé dans l'arbre de travail
  }
  controles += 1;
  if (octets.length >= 3 && octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf) {
    ecarts.push(`${chemin} : BOM UTF-8 en tête de fichier`);
    continue;
  }
  try {
    decodeur.decode(octets);
  } catch {
    ecarts.push(`${chemin} : octets hors UTF-8 (fichier écrit en ANSI ?)`);
  }
}

if (ecarts.length > 0) {
  for (const ecart of ecarts) console.error(`encodage-texte: — ${ecart}`);
  console.error(`encodage-texte: FAIL — ${ecarts.length} fichier(s) hors UTF-8 sans BOM`);
  process.exit(1);
}
console.log(`encodage-texte: OK — ${controles} fichiers texte en UTF-8 sans BOM`);
