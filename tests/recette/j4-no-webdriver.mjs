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
  if (/webdriver/i.test(code) && !code.includes('cfg(feature = "test-webdriver")') && !code.includes("CARGO_FEATURE_TEST_WEBDRIVER")) {
    fail(`WebDriver hors feature de test : ${path}`);
  }
}

function u32be(buf, offset) {
  return buf.readUInt32BE(offset);
}

function u16be(buf, offset) {
  return buf.readUInt16BE(offset);
}

/** WOFF2 : signature, longueur déclarée, tables > 0 (cahier § 7.3 police embarquée). */
function assertWoff2(path, label) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 4).toString("ascii") !== "wOF2") {
    fail(`${label} n'est pas un woff2`);
  }
  if (buf.length < 1000) fail(`${label} trop petit pour une police embarquée`);
  if (buf.length < 44) fail(`${label} en-tête woff2 tronqué`);
  const declared = u32be(buf, 8);
  if (declared !== buf.length) {
    fail(`${label} longueur woff2 déclarée ${declared} ≠ fichier ${buf.length}`);
  }
  const numTables = u16be(buf, 12);
  if (numTables < 1) fail(`${label} aucune table sfnt`);
  const reserved = u16be(buf, 14);
  if (reserved !== 0) fail(`${label} reserved woff2 ≠ 0`);
  return buf;
}

const fonts = [
  "AtkinsonHyperlegibleNext-Regular.woff2",
  "AtkinsonHyperlegibleNext-Bold.woff2",
];
const publicFontDir = join(root, "apps/poste/public/fonts/atkinson-hyperlegible-next");
const distFontDir = join(root, "apps/poste/dist/fonts/atkinson-hyperlegible-next");
const publicHashes = new Map();
for (const name of fonts) {
  const buf = assertWoff2(join(publicFontDir, name), `public/${name}`);
  publicHashes.set(name, buf);
}

let distChecked = false;
try {
  for (const name of fonts) {
    const distBuf = assertWoff2(join(distFontDir, name), `dist/${name}`);
    const pub = publicHashes.get(name);
    if (!pub.equals(distBuf)) {
      fail(`dist/${name} diffère de public/${name}`);
    }
  }
  distChecked = true;
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    console.log("j4: dist/fonts absent — saut de la parité public/dist (pas de build frontend)");
  } else {
    throw err;
  }
}

const indexCss = readFileSync(join(root, "apps/poste/src/index.css"), "utf8");
if (!indexCss.includes("design/tokens.css")) fail("index.css n'importe pas les jetons");
const tokens = readFileSync(join(root, "design/tokens.css"), "utf8");
if (!tokens.includes("Atkinson Hyperlegible Next")) fail("police absente des jetons");
if (/fonts\.googleapis\.com/.test(tokens)) fail("jetons : police distante");
if (!/@font-face/.test(tokens)) fail("jetons : pas de @font-face pour la police embarquée");

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
  for (const name of fonts) {
    if (!latin.includes(name)) {
      fail(`binaire release sans police embarquée référencée : ${name}`);
    }
  }
  console.log(`j4: binaire release sans WebDriver, polices référencées (${bin.length} octets)`);
}

console.log(
  `j4: OK — pas de WebDriver par défaut, jetons et woff2 présents${distChecked ? ", dist=public" : ""}`,
);
