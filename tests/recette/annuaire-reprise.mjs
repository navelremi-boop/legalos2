#!/usr/bin/env node
/**
 * Reprise des parties vers les intervenants (Postgres réel, 3 000 dossiers, deux exécutions).
 * Usage : node tests/recette/annuaire-reprise.mjs
 */
import { spawnSync } from "node:child_process";

const resultat = spawnSync(
  "cargo",
  ["test", "-p", "legalos-api", "--test", "annuaire_reprise", "--", "--test-threads=1"],
  { stdio: "inherit" },
);
process.exit(resultat.status ?? 1);
