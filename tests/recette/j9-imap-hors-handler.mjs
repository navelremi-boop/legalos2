#!/usr/bin/env node
/**
 * Étape 3 : pas de synchronisation IMAP dans une requête HTTP,
 * et pas une requête SQL par message dans le lot du moteur.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(message) {
  console.error(`j9-imap-hors-handler: FAIL — ${message}`);
  process.exit(1);
}

const synchro = readFileSync(join(root, "crates/api/src/routes/synchro.rs"), "utf8");
if (/relever_entetes|synchroniser_dossier|SessionActions::connecter|VeilleReception::ouvrir/.test(synchro)) {
  fail("la route de relève appelle encore IMAP");
}
if (/SELECT COUNT\(\*\) FROM messages WHERE compte_id/.test(synchro)) {
  fail("requête SQL par message dans la relève HTTP");
}

const moteur = readFileSync(join(root, "crates/api/src/moteur_mail.rs"), "utf8");
if (!moteur.includes("spawn_blocking")) fail("le moteur n'isole pas IMAP");
if (!moteur.includes("unnest")) fail("le lot n'est pas une écriture groupée");
if (/for etat in etats[\s\S]{0,400}sqlx::query/.test(moteur)) {
  fail("requête SQL dans la boucle des messages");
}

console.log("j9-imap-hors-handler: OK");
