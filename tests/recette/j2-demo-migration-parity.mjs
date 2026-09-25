#!/usr/bin/env node
/**
 * Les migrations ne chargent aucun compte (exception 2026-09-25, puis règle définitive).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = join(root, "crates/api/migrations");

function fail(msg) {
  console.error(`migrations-sans-compte: FAIL — ${msg}`);
  process.exit(1);
}

for (const name of readdirSync(dir)) {
  if (!name.endsWith(".sql")) continue;
  const sql = readFileSync(join(dir, name), "utf8");
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (/INSERT\s+INTO\s+utilisateurs/i.test(code) || /INSERT\s+INTO\s+cabinets/i.test(code)) {
    fail(`${name} insère encore des données`);
  }
}

console.log("migrations-sans-compte: OK");
