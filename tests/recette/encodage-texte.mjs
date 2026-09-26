#!/usr/bin/env node
/**
 * Encodage des fichiers texte suivis par git : UTF-8 valide, sans BOM.
 * Motif : deux incidents de même type (BOM dans du Rust bloquant rustfmt en CI ;
 * lignes ANSI écrites par PowerShell `Add-Content` dans JOURNAL.md).
 * Fins de ligne : le dépôt est en LF (`.gitattributes`), mais sous Windows l'arbre de travail peut
 * rester en CRLF (extraction antérieure à `eol=lf`), et les images Docker comme les compilations
 * locales partent de cet arbre (sqlx::migrate! calcule ses sommes de contrôle sur les octets ;
 * deux incidents : migrations 014 et 016). Contrôles outillés :
 *   - les Dockerfiles qui compilent ou exécutent du texte copié le ramènent en LF ;
 *   - aucun fichier déclaré `eol=lf` n'est en CRLF dans l'arbre de travail (utile en local,
 *     l'extraction de la CI étant toujours en LF). `--corriger` les ramène en LF : contenu
 *     identique au commit, `git status` inchangé.
 * Usage : node tests/recette/encodage-texte.mjs [--corriger]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

// Images construites depuis l'arbre de travail : retour au LF avant compilation / exécution.
const normalisations = [
  {
    fichier: "instance/Dockerfile.api",
    motif: /find crates[^\n]*\n?[^\n]*-name '\*\.sql'[\s\S]*?sed -i 's\/\\r\$\/\/'[\s\S]*?RUN cargo build/,
    attendu: "normalisation LF des migrations et sources avant `cargo build`",
  },
  {
    fichier: "instance/postgres/Dockerfile",
    motif: /sed -i 's\/\\r\$\/\/' \/docker-entrypoint-initdb\.d\/\*\.sh/,
    attendu: "normalisation LF des scripts d'initialisation",
  },
];
for (const { fichier, motif, attendu } of normalisations) {
  let texte = "";
  try {
    texte = readFileSync(join(root, fichier), "utf8");
  } catch {
    ecarts.push(`${fichier} : introuvable`);
    continue;
  }
  if (!motif.test(texte)) ecarts.push(`${fichier} : ${attendu} absente`);
}

// Arbre de travail : fichiers déclarés LF mais extraits en CRLF.
const corriger = process.argv.includes("--corriger");
const enCrlf = execFileSync("git", ["ls-files", "--eol", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((entree) => {
    const [meta, chemin] = entree.split("\t");
    return { meta, chemin };
  })
  .filter(({ meta }) => /\bw\/crlf\b/.test(meta) && /\beol=lf\b/.test(meta));
if (corriger) {
  for (const { chemin } of enCrlf) {
    const texte = readFileSync(join(root, chemin), "utf8");
    writeFileSync(join(root, chemin), texte.replace(/\r\n/g, "\n"), "utf8");
  }
  if (enCrlf.length > 0) {
    console.log(`encodage-texte: ${enCrlf.length} fichier(s) ramené(s) en LF dans l'arbre de travail`);
    console.log("encodage-texte: si git status les liste encore, `git add` sur ces seuls fichiers rafraîchit l'index sans rien indexer");
  }
} else {
  for (const { chemin } of enCrlf.slice(0, 10)) {
    ecarts.push(`${chemin} : CRLF dans l'arbre de travail (déclaré LF)`);
  }
  if (enCrlf.length > 10) ecarts.push(`… et ${enCrlf.length - 10} autre(s) en CRLF`);
  if (enCrlf.length > 0) {
    ecarts.push("correction : node tests/recette/encodage-texte.mjs --corriger");
  }
}

if (ecarts.length > 0) {
  for (const ecart of ecarts) console.error(`encodage-texte: — ${ecart}`);
  console.error(`encodage-texte: FAIL — ${ecarts.length} écart(s) d'encodage ou de fins de ligne`);
  process.exit(1);
}
console.log(
  `encodage-texte: OK — ${controles} fichiers texte en UTF-8 sans BOM, arbre de travail en LF, images Docker ramenées en LF`,
);
