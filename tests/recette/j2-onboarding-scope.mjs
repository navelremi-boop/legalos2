#!/usr/bin/env node
/**
 * J2 — parcours poste : auth réelle, pas de sync simulée dans FirstLaunchFlow.
 * (Sync PowerSync initiale = J3 ; voir apps/poste/src/sync/initialSync.ts.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const flowPath = join(root, "apps/poste/src/onboarding/FirstLaunchFlow.tsx");

function fail(msg) {
  console.error(`j2-onboarding-scope: FAIL — ${msg}`);
  process.exit(1);
}

const src = readFileSync(flowPath, "utf8");

if (/runInitialSync|from\s+["']@\/sync\/initialSync["']/.test(src)) {
  fail("FirstLaunchFlow ne doit pas invoquer runInitialSync (sync = J3)");
}

const required = ["connexion", "verifierTotp", "saveSessionTokens", "saveInstanceUrl"];
for (const needle of required) {
  if (!src.includes(needle)) {
    fail(`FirstLaunchFlow doit référencer ${needle} (parcours instance → TOTP → session)`);
  }
}

console.log("j2-onboarding-scope: OK");
