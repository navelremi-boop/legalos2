#!/usr/bin/env node
/**
 * Consigne de l'architecte du 26/10/2026 (B20) : aucune recette ni aucun script ne supprime les dossiers temporaires
 * dont le nom commence par `legal-os` (le dossier des clichés de plantage du poste s'y appelait `legal-os-dumps`, et il a
 * disparu). Les suppressions du dépôt doivent viser un chemin exact, jamais un motif ni une liste du dossier temporaire.
 *
 * Interdits : parcourir le dossier temporaire (`readdirSync(tmpdir())`, `read_dir(temp_dir())`) pour y supprimer,
 * un joker dans le chemin d'une suppression, et un nom `legal-os-dumps` ou `CrashDumps` dans une suppression.
 * Essais négatifs : trois sources fautives, un contrôle positif (suppression ciblée).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = /\.(mjs|js|ts|rs|ps1|sh|cmd|yml)$/u;
const SUPPRESSION = /(rmSync|rmdirSync|unlinkSync|remove_dir_all|remove_file|Remove-Item|\brm\b\s+-)/u;

/** Écarts d'une source : suppression dans un parcours du dossier temporaire, joker, nom protégé. */
export function ecarts(nom, texte) {
  const trouves = [];
  const lignes = texte.split(/\r?\n/u);
  lignes.forEach((ligne, i) => {
    if (/^\s*(\/\/|#|\*)/u.test(ligne) || !SUPPRESSION.test(ligne)) return;
    if (/[*?]/u.test(ligne.replace(/\/\*|\*\/|\*\*/gu, "").replace(/=>|\*\s*\d|\d\s*\*/gu, "")) && /(tmpdir|temp_dir|TEMP|Temp)/u.test(ligne) && /["'`][^"'`]*\*[^"'`]*["'`]/u.test(ligne)) {
      trouves.push(`${nom}:${i + 1} : joker dans la suppression d'un chemin temporaire`);
    }
    if (/legal-os-dumps|CrashDumps|legal-os\*/u.test(ligne)) {
      trouves.push(`${nom}:${i + 1} : suppression visant le dossier des clichés ou un motif legal-os*`);
    }
  });
  // Un parcours du dossier temporaire dans une source qui supprime par ailleurs.
  if (/(readdirSync|read_dir|readdir)\(\s*(os\.)?(tmpdir|temp_dir)\(/u.test(texte) && SUPPRESSION.test(texte)) {
    trouves.push(`${nom} : parcourt le dossier temporaire et supprime`);
  }
  return trouves;
}

const erreurs = [];
const suivis = execFileSync("git", ["ls-files", "-z"], { cwd: racine, encoding: "utf8" })
  .split("\0")
  .filter((chemin) => EXTENSIONS.test(chemin) && !chemin.startsWith("apps/poste/src/") && chemin !== "tests/recette/suppressions-temp.mjs");
for (const chemin of suivis) {
  let texte = "";
  try {
    texte = readFileSync(join(racine, chemin), "utf8");
  } catch {
    continue;
  }
  erreurs.push(...ecarts(chemin, texte));
}

// Essais négatifs et contrôle positif.
const essais = [
  ["parcours puis suppression", 'for (const n of readdirSync(tmpdir())) rmSync(join(tmpdir(), n), { recursive: true });', true],
  ["joker", 'rmSync(join(tmpdir(), "legal-os-*"), { recursive: true });', true],
  ["dossier des clichés", 'Remove-Item "C:\\Users\\PC\\CrashDumps\\legal-os-poste" -Recurse', true],
  ["suppression ciblée", "rmSync(child.exeCopie, { force: true });", false],
  ["suppression d'un dossier créé par mkdtemp", "rmSync(dossier, { recursive: true, force: true });", false],
];
for (const [libelle, source, attendu] of essais) {
  const vus = ecarts("essai", source).length > 0;
  if (vus !== attendu) erreurs.push(`essai « ${libelle} » : ${attendu ? "écart attendu, aucun reçu" : "faux positif"}`);
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`suppressions-temp: FAIL — ${e}`);
  process.exit(1);
}
console.log(`suppressions-temp: OK (${suivis.length} fichiers contrôlés, 5 essais)`);
