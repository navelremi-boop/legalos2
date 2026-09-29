#!/usr/bin/env node
/**
 * Lance le contrôle du fuseau (TypeScript du poste) sans flag sur la commande du plan.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const run = spawnSync(
  process.execPath,
  ["--experimental-strip-types", join(ici, "agenda-fuseau.run.ts")],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
