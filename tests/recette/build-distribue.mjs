#!/usr/bin/env node
/**
 * Dette avant J14 : le build distribué n'a ni outils de développement
 * ni débogage distant. La feature devtools de Tauri est absente,
 * la fenêtre ne l'active pas, le source du poste ne pose pas de port distant.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  console.error(`build-distribue: FAIL — ${message}`);
  process.exit(1);
}

function featuresTauri(toml) {
  const bloc = toml.match(/^\s*tauri\s*=\s*\{[^}]*\}/m);
  if (!bloc) return null;
  const features = bloc[0].match(/features\s*=\s*\[([^\]]*)\]/);
  return features ? features[1] : "";
}

const manifeste = readFileSync(join(root, "apps/poste/src-tauri/Cargo.toml"), "utf8");
const features = featuresTauri(manifeste);
if (features === null) fail("dépendance tauri illisible");
if (/\bdevtools\b/.test(features)) fail("feature devtools dans le build distribué");
if (!/^\s*default\s*=\s*\[\s*\]/m.test(manifeste)) fail("des features sont activées par défaut");
if (!/strip\s*=\s*true/.test(manifeste)) fail("le profil release ne retire pas les symboles");

const essai = featuresTauri('tauri = { version = "2", features = ["devtools"] }');
if (!essai || !/\bdevtools\b/.test(essai)) fail("essai négatif muet");

const conf = JSON.parse(readFileSync(join(root, "apps/poste/src-tauri/tauri.conf.json"), "utf8"));
const fenetres = conf.app?.windows ?? [];
if (fenetres.length === 0) fail("aucune fenêtre");
for (const fenetre of fenetres) {
  if (fenetre.devtools === true) fail("devtools activés sur une fenêtre");
}
if (!fenetres.every((fenetre) => fenetre.devtools === false)) {
  fail("devtools doit être explicitement faux");
}

function walk(dir) {
  const fichiers = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) fichiers.push(...walk(chemin));
    else if (nom.endsWith(".rs") || nom.endsWith(".json")) fichiers.push(chemin);
  }
  return fichiers;
}

const interdit = /remote-debugging-port|WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS|devtools\s*:\s*true/;
for (const chemin of walk(join(root, "apps/poste/src-tauri"))) {
  if (chemin.endsWith("tauri.conf.json")) continue;
  const code = readFileSync(chemin, "utf8");
  if (interdit.test(code) && !code.includes('cfg(feature = "test-webdriver")')) {
    fail(`débogage distant dans ${chemin}`);
  }
}

const exeFlag = process.argv.indexOf("--exe");
if (exeFlag !== -1) {
  const exe = process.argv[exeFlag + 1];
  if (!exe) fail("--exe sans chemin");
  const latin = readFileSync(exe).toString("latin1");
  for (const aiguille of ["remote-debugging-port", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"]) {
    if (latin.includes(aiguille)) fail(`binaire release contient ${aiguille}`);
  }
}

console.log("build-distribue: OK — pas de devtools ni de débogage distant");
