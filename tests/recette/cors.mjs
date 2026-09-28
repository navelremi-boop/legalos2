#!/usr/bin/env node
/**
 * Dette CORS (Coque) : `tauri://localhost` toujours autorisé ;
 * `localhost:1420` / `127.0.0.1:1420` seulement si LEGALOS_MODE=development.
 * Preuve : test d'intégration qui exerce la couche CorsLayer (OPTIONS), sans Postgres.
 * Usage : node tests/recette/cors.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`cors: FAIL — ${msg}`);
  process.exit(1);
}

const env = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
};

const result = spawnSync(
  "cargo",
  ["test", "-p", "legalos-api", "--test", "cors", "--", "--nocapture"],
  { cwd: root, encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  fail(`cargo test --test cors exit ${result.status}`);
}

const sortie = `${result.stdout ?? ""}${result.stderr ?? ""}`;
for (const nom of [
  "developpement_autorise_vite_et_tauri",
  "hors_developpement_refuse_vite_autorise_tauri",
]) {
  if (!new RegExp(`test\\s+${nom}\\s+\\.\\.\\.\\s+ok`).test(sortie)) {
    fail(`preuve manquante pour ${nom}`);
  }
}

console.log(
  "cors: OK — développement autorise :1420 et tauri://localhost ; hors développement refuse :1420 et autorise tauri://localhost",
);
process.exit(0);
