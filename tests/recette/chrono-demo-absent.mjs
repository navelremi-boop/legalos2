#!/usr/bin/env node
/**
 * Le build distribué ne contient pas un titre du jeu CHRONO_DEMO.
 * Le job frontend construit déjà apps/poste/dist ; sinon ce script le construit.
 * Usage : node tests/recette/chrono-demo-absent.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "apps/poste/dist");
const TITRE = "Communication de pièces adverses n° 14 à 19";

function fail(message) {
  console.error(`chrono-demo-absent: FAIL — ${message}`);
  process.exit(1);
}

/** Vrai si un bundle publié contient encore un titre du jeu fictif. */
export function contientTitreChronoDemo(texte) {
  return texte.includes(TITRE);
}

if (!contientTitreChronoDemo(`préfixe ${TITRE} suffixe`)) {
  fail("essai négatif muet");
}
if (contientTitreChronoDemo("Aucun élément pour l'instant.")) {
  fail("essai négatif : faux positif");
}

if (!existsSync(join(dist, "index.html"))) {
  const build = spawnSync("pnpm", ["--filter", "@legal-os/poste", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (build.status !== 0) fail(`build exit ${build.status ?? 1}`);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(js|css|html|mjs|map)$/u.test(name)) acc.push(path);
  }
  return acc;
}

const fautes = [];
for (const path of walk(dist)) {
  if (contientTitreChronoDemo(readFileSync(path, "utf8"))) {
    fautes.push(relative(root, path).replaceAll("\\", "/"));
  }
}
if (fautes.length > 0) {
  fail(`titre CHRONO_DEMO dans le build : ${fautes.join(", ")}`);
}

console.log("chrono-demo-absent: OK — build distribué sans titre du jeu fictif");
