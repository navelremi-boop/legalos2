#!/usr/bin/env node
/**
 * J4 — le build distribué n'embarque pas de serveur WebDriver.
 * La feature Cargo `test-webdriver` ne fait pas partie des features par défaut.
 * Usage : node tests/recette/j4-no-webdriver.mjs [--exe chemin]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = join(root, "apps/poste/src-tauri/Cargo.toml");
const srcDir = join(root, "apps/poste/src-tauri/src");

function fail(msg) {
  console.error(`j4: FAIL — ${msg}`);
  process.exit(1);
}

const cargoToml = readFileSync(manifest, "utf8");
const defaultLine = cargoToml.split(/\r?\n/).find((line) => /^\s*default\s*=/.test(line));
if (!defaultLine) fail("feature default absente de Cargo.toml");
if (defaultLine.includes("test-webdriver")) {
  fail("test-webdriver est activé par défaut");
}

const meta = spawnSync(
  "cargo",
  ["metadata", "--manifest-path", manifest, "--format-version", "1"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (meta.status !== 0) {
  fail(`cargo metadata exit ${meta.status} ${meta.stderr?.slice(-400) ?? ""}`);
}
const resolved = JSON.parse(meta.stdout);
for (const pkg of resolved.packages) {
  if (/webdriver/i.test(pkg.name)) fail(`dépendance WebDriver : ${pkg.name}`);
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walkRs(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walkRs(path));
    else if (name.endsWith(".rs")) files.push(path);
  }
  return files;
}

for (const path of walkRs(srcDir)) {
  const code = stripComments(readFileSync(path, "utf8"));
  if (/webdriver/i.test(code) && !code.includes('cfg(feature = "test-webdriver")')) {
    fail(`WebDriver hors feature de test : ${path}`);
  }
}

const fonts = [
  "AtkinsonHyperlegibleNext-Regular.woff2",
  "AtkinsonHyperlegibleNext-Bold.woff2",
];
for (const name of fonts) {
  const buf = readFileSync(
    join(root, "apps/poste/public/fonts/atkinson-hyperlegible-next", name),
  );
  if (buf.subarray(0, 4).toString("ascii") !== "wOF2") fail(`${name} n'est pas un woff2`);
  if (buf.length < 1000) fail(`${name} trop petit pour une police embarquée`);
}

const indexCss = readFileSync(join(root, "apps/poste/src/index.css"), "utf8");
if (!indexCss.includes('design/tokens.css')) fail("index.css n'importe pas les jetons");
const tokens = readFileSync(join(root, "design/tokens.css"), "utf8");
if (!tokens.includes("Atkinson Hyperlegible Next")) fail("police absente des jetons");
if (/fonts\.googleapis\.com/.test(tokens)) fail("jetons : police distante");

const conf = readFileSync(join(root, "apps/poste/src-tauri/tauri.conf.json"), "utf8");
if (!conf.includes("font-src 'self'")) fail("CSP : police non limitée à l'app");
if (/font-src[^;]*https?:/i.test(conf)) fail("CSP : police chargée depuis Internet");

const exeFlag = process.argv.indexOf("--exe");
if (exeFlag !== -1) {
  const exe = process.argv[exeFlag + 1];
  if (!exe) fail("--exe sans chemin");
  const bin = readFileSync(exe);
  const latin = bin.toString("latin1");
  for (const needle of ["WebDriver", "tauri-driver", "msedgedriver"]) {
    if (latin.includes(needle)) fail(`binaire release contient ${needle}`);
  }
  console.log(`j4: binaire release sans WebDriver (${bin.length} octets)`);
}

console.log("j4: OK — pas de WebDriver par défaut, jetons et woff2 présents");
