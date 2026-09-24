#!/usr/bin/env node
/**
 * Recette J0 sans Rust : contrats + typecheck/build poste.
 * Usage : node scripts/check-j0.mjs
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "design/tokens.css",
  "docs/sync-rules.md",
  "docs/versions.md",
  "apps/poste/src/sync/AppSchema.ts",
  "crates/api/migrations/001_cabinets.sql",
  "instance/docker-compose.yml",
  "PLAN.md",
  "JOURNAL.md",
  "BLOCAGES.md",
  ".github/workflows/ci.yml",
];

for (const rel of required) {
  if (!existsSync(join(root, rel))) {
    console.error(`missing: ${rel}`);
    process.exit(1);
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["--filter", "@legal-os/poste", "typecheck"]);
run("pnpm", ["--filter", "@legal-os/poste", "build"]);
console.log("check-j0: OK");
