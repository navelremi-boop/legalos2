#!/usr/bin/env node
/**
 * Hors développement, l'API refuse chaque secret publié dans les fichiers d'exemple.
 * La liste fait foi dans crates/api/src/config.rs (SECRETS_PUBLIES).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const config = readFileSync(join(root, "crates/api/src/config.rs"), "utf8");

function fail(msg) {
  console.error(`secrets-publies: FAIL — ${msg}`);
  process.exit(1);
}

function estSecret(cle) {
  return (
    cle.endsWith("PASSWORD") ||
    cle.endsWith("_SECRET") ||
    cle.endsWith("_TOKEN") ||
    cle === "SECRETS_CHIFFREMENT_KEY" ||
    cle.includes("TOTP") ||
    cle === "DATABASE_URL" ||
    (cle.startsWith("PS_") && cle.endsWith("_URI"))
  );
}

if (!config.includes("fn refuser_secrets_publies_hors_developpement")) {
  fail("le refus au démarrage est absent de config.rs");
}

for (const nom of [".env.example", ".env.development.example"]) {
  const texte = readFileSync(join(root, nom), "utf8");
  let compte = 0;
  for (const ligne of texte.split(/\n/)) {
    if (ligne.startsWith("#") || !ligne.includes("=")) continue;
    const [cle, valeur] = ligne.split("=", 2);
    if (!valeur || !estSecret(cle)) continue;
    compte += 1;
    if (!config.includes(JSON.stringify(valeur))) {
      fail(`${nom} : ${cle} n'est pas refusé`);
    }
  }
  if (compte === 0) fail(`${nom} : aucun secret`);
}

console.log("secrets-publies: OK");
