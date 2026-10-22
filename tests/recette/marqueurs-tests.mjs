#!/usr/bin/env node
/**
 * Règle `.claude/rules/40-tests.md` : aucun test désactivé (`#[ignore]`, `.skip`, `.only`, `xit`…).
 * Règle vérifiable = règle outillée : ce contrôle tourne en CI (job frontend) et avant de pousser.
 *
 * Il prouve d'abord son propre fonctionnement (essai négatif : un dossier de faux tests portant chaque marqueur
 * doit être refusé, un dossier propre accepté, avec contrôle positif), puis lit les fichiers suivis du dépôt.
 * Les documents (`.md`, `.mdc`) qui citent les marqueurs pour les interdire ne sont pas lus.
 *
 * Usage : node tests/recette/marqueurs-tests.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SELF = "tests/recette/marqueurs-tests.mjs";
const EXTENSIONS = /\.(rs|ts|tsx|js|jsx|mjs|cjs)$/u;

/** Marqueurs interdits, un motif par famille. */
const MOTIFS = [
  { nom: "#[ignore]", re: /#\[\s*ignore\b/u },
  { nom: ".skip / .only", re: /\b(?:it|test|describe|context|suite)\s*\.\s*(?:skip|only)\b/u },
  { nom: "méthode .skip( / .only(", re: /\.\s*(?:skip|only)\s*\(/u },
  { nom: "xit / xdescribe / xtest / fit / fdescribe", re: /\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/u },
];

export function marqueursDe(texte) {
  const trouves = [];
  texte.split("\n").forEach((ligne, i) => {
    for (const { nom, re } of MOTIFS) if (re.test(ligne)) trouves.push({ ligne: i + 1, nom });
  });
  return trouves;
}

function fichiersDuDossier(dossier) {
  const sortie = [];
  const parcourir = (d) => {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else sortie.push(chemin);
    }
  };
  parcourir(dossier);
  return sortie.map((c) => relative(dossier, c).replaceAll("\\", "/"));
}

function fichiersSuivis() {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: racine, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files exit ${r.status}`);
  return r.stdout.split("\0").filter(Boolean);
}

function analyser(base, chemins) {
  const refus = [];
  let lus = 0;
  for (const chemin of chemins) {
    if (chemin === SELF || !EXTENSIONS.test(chemin)) continue;
    lus += 1;
    for (const m of marqueursDe(readFileSync(join(base, chemin), "utf8"))) refus.push(`${chemin}:${m.ligne} ${m.nom}`);
  }
  return { refus, lus };
}

function fail(msg) {
  console.error(`marqueurs-tests: FAIL — ${msg}`);
  process.exit(1);
}

function essaisNegatifs() {
  const faux = mkdtempSync(join(tmpdir(), "marqueurs-tests-"));
  try {
    const sales = {
      "a.rs": '#[test]\n#[ignore = "raison"]\nfn t() {}\n',
      "b.test.ts": 'it.skip("x", () => {});\n',
      "c.test.ts": 'describe.only("x", () => {});\n',
      "d.test.ts": 'xit("x", () => {});\n',
      "e.mjs": 'test.skip("x", () => {});\n',
      "f.test.ts": 'suite.test("x", () => {}).skip();\n',
    };
    mkdirSync(join(faux, "sales"));
    for (const [nom, texte] of Object.entries(sales)) writeFileSync(join(faux, "sales", nom), texte, "utf8");
    const { refus } = analyser(join(faux, "sales"), fichiersDuDossier(join(faux, "sales")));
    for (const nom of Object.keys(sales)) {
      if (!refus.some((r) => r.startsWith(`${nom}:`))) fail(`essai négatif : le marqueur de ${nom} n'est pas détecté`);
    }
    // Contrôle positif : un test sain, des mots voisins (`skipped`, `budget(`) ne sont pas refusés.
    mkdirSync(join(faux, "propres"));
    writeFileSync(
      join(faux, "propres", "ok.rs"),
      '#[test]\nfn passe() { let skipped = 0; assert_eq!(skipped, 0); }\n#[allow(dead_code)]\nfn ignore_les_espaces() {}\n',
      "utf8",
    );
    writeFileSync(join(faux, "propres", "ok.test.ts"), 'it("passe", () => { const only = 1; expect(only).toBe(1); });\n', "utf8");
    const propre = analyser(join(faux, "propres"), fichiersDuDossier(join(faux, "propres")));
    if (propre.refus.length !== 0) fail(`contrôle positif : faux positif ${propre.refus.join(", ")}`);
    if (propre.lus !== 2) fail(`contrôle positif : ${propre.lus} fichiers lus au lieu de 2`);
    console.log(`marqueurs-tests: essais négatifs ${Object.keys(sales).length}/${Object.keys(sales).length} détectés, contrôle positif propre`);
  } finally {
    rmSync(faux, { recursive: true, force: true });
  }
}

essaisNegatifs();
const { refus, lus } = analyser(racine, fichiersSuivis());
if (lus < 100) fail(`seulement ${lus} fichiers de code lus : le contrôle ne lit plus le dépôt`);
if (refus.length > 0) fail(`test désactivé (40-tests.md) :\n${refus.join("\n")}`);
console.log(`marqueurs-tests: OK — ${lus} fichiers de code lus, aucun test désactivé`);
