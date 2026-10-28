#!/usr/bin/env node
/**
 * Consigne de l'architecte du 26/10/2026 : chaque recette supprime, en fin de passe et même en cas d'échec, les boîtes
 * qu'elle a créées (leurs restes alourdissaient les connexions de `capa` des recettes suivantes).
 *
 * Contrôle statique : une recette qui crée une boîte (`INSERT INTO comptes_mail`, ou `POST /messagerie/comptes`) contient
 * aussi sa suppression (`DELETE FROM comptes_mail` ou `retirerBoites…`) dans un bloc `finally`, un `.finally(` ou une
 * fonction de nettoyage appelée par l'un d'eux. Exception justifiée : la boîte de classement du cabinet est partagée
 * par toutes les recettes (créée si absente, jamais retirée).
 * Essais négatifs : une recette qui crée sans supprimer, et une qui supprime hors de tout `finally`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Recettes qui ne créent que la boîte de classement du cabinet (partagée, jamais retirée). */
const EXEMPTEES = new Map([
  ["tests/recette/j10-ecrans-tauri.mjs", "crée seulement la boîte de classement du cabinet, partagée"],
  ["tests/recette/tenue-demo.mjs", "crée seulement la boîte de classement du cabinet sur l'instance de démonstration, partagée par le jeu"],
]);

const CREATION = /INSERT INTO comptes_mail|["'`]\/messagerie\/comptes["'`]\s*,\s*[^)]*["']POST["']|POST["'`]?\s*,?\s*["'`]\/messagerie\/comptes["'`]/u;
const SUPPRESSION = /DELETE FROM comptes_mail|retirerBoites(?:ParAdresse|SansEchec)|retirerComptes\s*\(/u;

/** Écart d'une recette, ou `null`. */
export function ecart(chemin, texte) {
  if (!CREATION.test(texte) && !/\bboite\(|json\(\s*["'`]\/messagerie\/comptes["'`]/u.test(texte)) return null;
  if (!CREATION.test(texte) && !/["'`]\/messagerie\/comptes["'`][^;]{0,80}POST|POST[^;]{0,80}["'`]\/messagerie\/comptes["'`]/u.test(texte)) return null;
  if (!SUPPRESSION.test(texte)) return `${chemin} : crée des boîtes sans jamais les supprimer`;
  if (!/\bfinally\b/u.test(texte)) return `${chemin} : supprime ses boîtes hors de tout bloc finally (pas en cas d'échec)`;
  return null;
}

const erreurs = [];
const recettes = execFileSync("git", ["ls-files", "tests/recette"], { cwd: racine, encoding: "utf8" })
  .split(/\r?\n/u)
  .filter((c) => c.endsWith(".mjs") && !c.includes("/lib/") && c !== "tests/recette/recettes-nettoient-leurs-boites.mjs");
let controlees = 0;
for (const chemin of recettes) {
  const texte = readFileSync(join(racine, chemin), "utf8");
  const trouve = ecart(chemin, texte);
  if (trouve !== null) {
    if (EXEMPTEES.has(chemin)) continue;
    erreurs.push(trouve);
  }
  if (/INSERT INTO comptes_mail|\/messagerie\/comptes/u.test(texte)) controlees += 1;
}

// Essais négatifs et contrôle positif.
const essais = [
  ["crée sans supprimer", "await sqlServeur(`INSERT INTO comptes_mail (id) VALUES ('x')`);", true],
  ["supprime hors finally", "await sqlServeur(`INSERT INTO comptes_mail (id) VALUES ('x')`);\nawait sqlServeur(`DELETE FROM comptes_mail WHERE id = 'x'`);", true],
  ["crée et supprime dans un finally", "try { await sqlServeur(`INSERT INTO comptes_mail (id) VALUES ('x')`); } finally { await sqlServeur(`DELETE FROM comptes_mail WHERE id = 'x'`); }", false],
  ["ne crée aucune boîte", "await sqlServeur(`SELECT 1`);", false],
];
for (const [libelle, source, attendu] of essais) {
  const vu = ecart("essai.mjs", source) !== null;
  if (vu !== attendu) erreurs.push(`essai « ${libelle} » : ${attendu ? "écart attendu, aucun reçu" : "faux positif"}`);
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`recettes-nettoient-leurs-boites: FAIL — ${e}`);
  process.exit(1);
}
console.log(`recettes-nettoient-leurs-boites: OK (${controlees} recettes qui touchent des boîtes, ${EXEMPTEES.size} exemptée, 4 essais)`);
