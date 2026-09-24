#!/usr/bin/env node
/**
 * J2 — parité migration 004 / compte fictif recette (sans Postgres).
 * Le secret TOTP chiffré en base doit correspondre à LEGALOS_DEMO_TOTP_SECRET_BASE32
 * et à SECRETS_CHIFFREMENT_KEY dev (nonce fixe migration demo).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = join(root, "crates/api/migrations/004_demo_fictif.sql");

const demoTotpB32 =
  process.env.LEGALOS_DEMO_TOTP_SECRET_BASE32 ?? "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO";
const cipherKey = process.env.SECRETS_CHIFFREMENT_KEY ?? "legalos_demo_chiffrement_32oct!!";

/** Valeur attendue : `cargo test -p legalos-api --test demo_migration_assets -- --nocapture` */
const EXPECTED_TOTP_CIPHERTEXT =
  "bGVnYWxvcy1kZW1vaN5wGHZGUzOAk20UHXmNR4HEPpOKaY7St3edVKzmtW2h4U1TP4NJKB/QL/SXCuuuuQ==";

function fail(msg) {
  console.error(`j2-demo-migration-parity: FAIL — ${msg}`);
  process.exit(1);
}

const sql = readFileSync(migrationPath, "utf8");
const match = sql.match(/'bGVnYWxvcy[^']+'/);
if (!match) fail("totp_secret_chiffre (base64 demo) introuvable dans 004_demo_fictif.sql");
const storedB64 = match[0].slice(1, -1);

if (storedB64 !== EXPECTED_TOTP_CIPHERTEXT) {
  fail(
    `totp_secret_chiffre SQL ≠ valeur attendue (demo_migration_assets / ${demoTotpB32}). ` +
      "Instance Postgres fraîche (CI S1) : TOTP recette incohérent.",
  );
}

console.log("j2-demo-migration-parity: OK");
