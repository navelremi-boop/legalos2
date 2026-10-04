#!/usr/bin/env node
/**
 * Montée PowerSync 0.1 : crates 0.1.x, plus d'exceptions RustSec de la chaîne
 * http-client, rustines time-macros retirées, rand 0.7.3 absent, Playwright 1.63.0.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXCEPTIONS = [
  "RUSTSEC-2025-0052",
  "RUSTSEC-2021-0060",
  "RUSTSEC-2021-0064",
  "RUSTSEC-2026-0174",
];

function fail(message) {
  console.error(`powersync-0-1: FAIL — ${message}`);
  process.exit(1);
}

function ecarts({ cargo, deny, verrou, manifeste, versions, audit }) {
  const trouves = [];
  if (!/tauri-plugin-powersync\s*=\s*"0\.1\./.test(cargo)) {
    trouves.push("tauri-plugin-powersync n'est pas en 0.1.x");
  }
  if (!/^powersync\s*=\s*"0\.1\./m.test(cargo)) {
    trouves.push("crate powersync n'est pas en 0.1.x");
  }
  if (/time-macros/.test(cargo)) trouves.push("rustine time-macros encore déclarée");
  for (const id of EXCEPTIONS) {
    if (deny.includes(id)) trouves.push(`exception ${id} encore présente`);
  }
  if (/name = "rand"\r?\nversion = "0\.7\.3"/.test(verrou)) {
    trouves.push("rand 0.7.3 encore dans Cargo.lock");
  }
  if (!/"playwright": "1\.63\.0"/.test(manifeste)) {
    trouves.push("Playwright n'est pas en 1.63.0");
  }
  if (!/tauri-plugin-powersync \| \*\*0\.1\.0\*\*/.test(versions)) {
    trouves.push("docs/versions.md ne fige pas tauri-plugin-powersync 0.1.0");
  }
  if (!/0\.1\.0 retire la chaîne http-client/.test(audit)) {
    trouves.push("docs/audit-dependances.md ne constate pas le retrait de la chaîne");
  }
  return trouves;
}

const negatif = ecarts({
  cargo: 'tauri-plugin-powersync = "0.0.6"\npowersync = "0.0.7"\ntime-macros = { path = "patches/time-macros" }\n',
  deny: "RUSTSEC-2025-0052",
  verrou: 'name = "rand"\nversion = "0.7.3"\n',
  manifeste: '"playwright": "1.50.1"',
  versions: "tauri-plugin-powersync | **0.0.6**",
  audit: "exceptions maintenues",
});
if (negatif.length < 6) fail(`essai négatif muet (${negatif.join(" ; ")})`);

const francais = ecarts({
  cargo: 'tauri-plugin-powersync = "0.1.0"\npowersync = "0.1.0"\n',
  deny: "ignore = []",
  verrou: 'name = "rand"\nversion = "0.9.5"\n',
  manifeste: '"playwright": "1.63.0"',
  versions: "tauri-plugin-powersync | **0.1.0**",
  audit: "0.1.0 retire la chaîne http-client",
});
if (francais.length !== 0) fail(`essai négatif : faux positif (${francais.join(" ; ")})`);

const reel = ecarts({
  cargo: readFileSync(join(root, "apps/poste/src-tauri/Cargo.toml"), "utf8"),
  deny: readFileSync(join(root, "apps/poste/src-tauri/deny.toml"), "utf8"),
  verrou: readFileSync(join(root, "apps/poste/src-tauri/Cargo.lock"), "utf8"),
  manifeste: readFileSync(join(root, "package.json"), "utf8"),
  versions: readFileSync(join(root, "docs/versions.md"), "utf8"),
  audit: readFileSync(join(root, "docs/audit-dependances.md"), "utf8"),
});
if (reel.length !== 0) fail(reel.join(" ; "));

for (const nom of ["time-macros", "time-macros-impl"]) {
  if (existsSync(join(root, "apps/poste/src-tauri/patches", nom))) {
    fail(`répertoire patches/${nom} encore présent`);
  }
}

console.log("powersync-0-1: OK");
