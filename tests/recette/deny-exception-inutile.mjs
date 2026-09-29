#!/usr/bin/env node
/**
 * Essai négatif : une exception d'avis devenue inutile fait échouer cargo-deny
 * (`unused-ignored-advisory = "deny"` dans apps/poste/src-tauri/deny.toml).
 * La configuration réelle du dépôt ne contient pas cet identifiant fictif.
 * Usage : node tests/recette/deny-exception-inutile.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const configReelle = join(root, "apps/poste/src-tauri/deny.toml");
const identifiantInutile = "RUSTSEC-2099-0001";

function fail(message) {
  console.error(`deny-exception-inutile: FAIL — ${message}`);
  process.exit(1);
}

function cargoDeny(config) {
  const result = spawnSync(
    "cargo",
    [
      "deny",
      "--manifest-path",
      "apps/poste/src-tauri/Cargo.toml",
      "--config",
      config,
      "check",
      "advisories",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return {
    status: result.status,
    sortie: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    erreur: result.error,
  };
}

const source = readFileSync(configReelle, "utf8");
if (!source.includes('unused-ignored-advisory = "deny"')) {
  fail("unused-ignored-advisory n'est pas deny");
}
if (source.includes(identifiantInutile)) {
  fail("l'identifiant fictif est déjà dans deny.toml");
}

const dir = mkdtempSync(join(tmpdir(), "legalos-deny-"));
const configInutile = join(dir, "deny.toml");
try {
  if (!source.includes("ignore = [")) fail("liste ignore absente");
  writeFileSync(
    configInutile,
    source.replace(
      "ignore = [",
      `ignore = [\n    { id = "${identifiantInutile}", reason = "essai negatif : exception devenue inutile" },`,
    ),
    "utf8",
  );

  const avec = cargoDeny(configInutile);
  if (avec.erreur) fail(avec.erreur.message);
  if (avec.status === 0) fail("cargo deny a réussi malgré une exception inutile");
  const lignes = avec.sortie
    .split(/\r?\n/)
    .filter((ligne) => ligne.includes(identifiantInutile) || /ignor/i.test(ligne));
  if (!avec.sortie.includes(identifiantInutile) || lignes.length === 0) {
    fail(`exception inutile non signalée (${identifiantInutile})`);
  }
  if (!/not encountered|was not used|unused ignored|n'est pas utilisée|not used/i.test(avec.sortie)) {
    fail(`formulation inattendue :\n${lignes.slice(0, 12).join("\n")}`);
  }

  const sans = cargoDeny(configReelle);
  if (sans.erreur) fail(sans.erreur.message);
  if (sans.sortie.includes(identifiantInutile)) {
    fail("la configuration réelle mentionne l'identifiant fictif");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  "deny-exception-inutile: OK — une exception absente du graphe fait échouer cargo deny",
);
