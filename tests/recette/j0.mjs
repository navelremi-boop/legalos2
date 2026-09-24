#!/usr/bin/env node
/**
 * Acceptation jalon J0 (Phase 0) — contrats partagés + build/typecheck poste.
 * Spécification : PLAN.md J0, docs/ordre-operation.md §4.2 phase 0.
 * Usage : node tests/recette/j0.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const contractFiles = [
  "design/tokens.css",
  "docs/sync-rules.md",
  "docs/versions.md",
  "apps/poste/src/sync/AppSchema.ts",
  "crates/api/migrations/001_cabinets.sql",
  "crates/api/migrations/002_utilisateurs.sql",
  "crates/api/migrations/003_postes.sql",
  "instance/docker-compose.yml",
  "PLAN.md",
  "JOURNAL.md",
  "BLOCAGES.md",
  ".github/workflows/ci.yml",
];

function fail(msg) {
  console.error(`j0: FAIL — ${msg}`);
  process.exit(1);
}

for (const rel of contractFiles) {
  if (!existsSync(join(root, rel))) {
    fail(`missing contract: ${rel}`);
  }
}

const tokens = readFileSync(join(root, "design/tokens.css"), "utf8");
if (!/--chemise-bande/u.test(tokens) || !/--page:/u.test(tokens)) {
  fail("design/tokens.css must define chemise and page tokens (§7 cahier des charges)");
}

const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
if (!/AppSchema|schema/u.test(schema)) {
  fail("AppSchema.ts must export PowerSync client schema");
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited ${r.status ?? 1}`);
  }
}

run("pnpm", ["--filter", "@legal-os/poste", "typecheck"]);
run("pnpm", ["--filter", "@legal-os/poste", "build"]);

console.log("j0: OK (contrats + typecheck + build)");
