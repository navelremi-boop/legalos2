#!/usr/bin/env node
/**
 * Galerie de démonstration absente du build distribué (jalon Coque).
 * Vérifie le bundle produit par `vite build`, pas seulement import.meta.env.DEV dans les sources.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const poste = join(root, "apps/poste");
const dist = join(poste, "dist");

function fail(msg) {
  console.error(`galerie-absente: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`galerie-absente: ${msg}`);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(js|css|html|mjs|map)$/u.test(name)) acc.push(path);
  }
  return acc;
}

const build = spawnSync("pnpm", ["--filter", "@legal-os/poste", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "production" },
});
if (build.status !== 0) fail(`build exit ${build.status ?? 1}`);

if (!existsSync(dist)) fail("apps/poste/dist absent après build");

const fichiers = walk(dist);
if (fichiers.length < 2) fail(`dist trop vide (${fichiers.length} fichiers)`);

const INTERDITS = [
  "GalerieDemo",
  "Galerie de démonstration",
  "galerie-demo",
  "galerie-commandes",
  "galerie-scene",
  "?galerie=1",
];

const fautes = [];
for (const path of fichiers) {
  const texte = readFileSync(path, "utf8");
  for (const motif of INTERDITS) {
    if (texte.includes(motif)) {
      fautes.push(`${relative(root, path).replaceAll("\\", "/")} contient « ${motif} »`);
    }
  }
}

if (fautes.length > 0) {
  for (const f of fautes) console.error(`galerie-absente: FAIL — ${f}`);
  process.exit(1);
}

ok(`build distribué sans galerie (${fichiers.length} fichiers examinés)`);
console.log("galerie-absente: OK");
