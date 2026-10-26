#!/usr/bin/env node
/**
 * D9 (consigne de l'architecte du 24/10/2026) : les types TypeScript du poste (`apps/poste/src/api/schema.d.ts`) sont
 * ceux que génère `openapi-typescript` (version figée dans `docs/versions.md`) depuis le contrat engagé
 * (`crates/api/openapi.json`, lui-même contrôlé contre le code par `cargo test -p legalos-api --test openapi_a_jour`).
 *
 * Essais négatifs : un type engagé modifié à la main, et un contrat qui perd une route, sont vus.
 * Usage : node tests/recette/types-api-a-jour.mjs   (régénérer : pnpm --filter @legal-os/poste gen:api)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(racine, "apps/poste/node_modules/openapi-typescript/bin/cli.js");
const contrat = join(racine, "crates/api/openapi.json");
const engage = join(racine, "apps/poste/src/api/schema.d.ts");
const erreurs = [];
const dossier = mkdtempSync(join(tmpdir(), "legalos-types-api-"));

function generer(source, sortie) {
  const r = spawnSync(process.execPath, [cli, source, "-o", sortie], { encoding: "utf8" });
  if (r.status !== 0) erreurs.push(`génération impossible : ${String(r.stderr).slice(0, 300)}`);
  return r.status === 0 ? readFileSync(sortie, "utf8").replace(/\r\n/g, "\n") : "";
}

try {
  const attendu = generer(contrat, join(dossier, "schema.d.ts"));
  const present = readFileSync(engage, "utf8").replace(/\r\n/g, "\n");
  if (attendu !== "" && present !== attendu) {
    erreurs.push("apps/poste/src/api/schema.d.ts n'est pas celui du contrat : pnpm --filter @legal-os/poste gen:api");
  }

  // Essai négatif 1 : un type engagé modifié à la main n'est plus celui du contrat.
  if (attendu !== "" && present.replace("export interface paths", "export interface chemins") === attendu) {
    erreurs.push("essai négatif : une modification manuelle du fichier engagé passerait");
  }

  // Essai négatif 2 : un contrat qui perd une route donne d'autres types que ceux engagés.
  const spec = JSON.parse(readFileSync(contrat, "utf8"));
  const premiere = Object.keys(spec.paths)[0];
  delete spec.paths[premiere];
  const reduit = join(dossier, "reduit.json");
  writeFileSync(reduit, JSON.stringify(spec), "utf8");
  const sansRoute = generer(reduit, join(dossier, "reduit.d.ts"));
  if (sansRoute !== "" && sansRoute === present) {
    erreurs.push("essai négatif : un contrat privé d'une route donnerait les mêmes types");
  }
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`types-api-a-jour: FAIL — ${e}`);
  process.exit(1);
}
console.log("types-api-a-jour: OK (types du poste = contrat engagé, 2 essais négatifs)");
