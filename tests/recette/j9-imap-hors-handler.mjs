#!/usr/bin/env node
/**
 * Étape 3 : pas de synchronisation IMAP dans une requête HTTP,
 * et pas une requête SQL par message dans le lot du moteur.
 *
 * `routes/synchro.rs` (relève nominative par HTTP) a été supprimé le 24/10/2026 avec les routes `/messagerie/nominatif/*` :
 * le contrôle porte maintenant sur tous les fichiers de `crates/api/src/routes/`. La seule relève par HTTP est celle de la
 * boîte de classement du cabinet, à la demande (`routes/messagerie.rs`, `relever_entetes`) ; aucune route ne synchronise
 * un dossier (`synchroniser_dossier`) ni n'arme une veille (`VeilleReception::ouvrir`) : c'est le travail du moteur.
 * Essais négatifs : trois sources de route fautives, un contrôle positif.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(message) {
  console.error(`j9-imap-hors-handler: FAIL — ${message}`);
  process.exit(1);
}

/** Écarts d'un fichier de route (`nom` : nom du fichier, sans dossier). */
export function ecartsRoute(nom, texte) {
  const ecarts = [];
  if (/synchroniser_dossier|VeilleReception::ouvrir/.test(texte)) {
    ecarts.push(`${nom} : une route synchronise un dossier ou arme une veille IMAP (travail du moteur)`);
  }
  if (nom !== "messagerie.rs" && /relever_entetes/.test(texte)) {
    ecarts.push(`${nom} : une route relève des en-têtes IMAP (seule la relève de classement, dans messagerie.rs, le peut)`);
  }
  if (/SELECT COUNT\(\*\) FROM messages WHERE compte_id/.test(texte)) {
    ecarts.push(`${nom} : requête SQL par message dans une route`);
  }
  return ecarts;
}

const dossierRoutes = join(root, "crates/api/src/routes");
const fichiers = readdirSync(dossierRoutes).filter((nom) => nom.endsWith(".rs"));
if (fichiers.length === 0) fail("aucune route trouvée dans crates/api/src/routes");
for (const nom of fichiers) {
  const ecarts = ecartsRoute(nom, readFileSync(join(dossierRoutes, nom), "utf8"));
  if (ecarts.length > 0) fail(ecarts[0]);
}

// Essais négatifs et contrôle positif.
const essais = [
  ["synchronisation dans une route", "routes.rs", "session.synchroniser_dossier(&d, 0)", true],
  ["relève d'en-têtes hors de la relève de classement", "dossiers.rs", "session.relever_entetes(\"INBOX\", None, None)", true],
  ["veille armée par une route", "boites.rs", "VeilleReception::ouvrir(&p)", true],
  ["relève de classement dans messagerie.rs", "messagerie.rs", "session.relever_entetes(\"INBOX\", apres, limite)", false],
];
for (const [libelle, nom, source, attendu] of essais) {
  if ((ecartsRoute(nom, source).length > 0) !== attendu) {
    fail(`essai « ${libelle} » : ${attendu ? "écart attendu, aucun reçu" : "faux positif"}`);
  }
}

const moteur = readFileSync(join(root, "crates/api/src/moteur_mail.rs"), "utf8");
if (!moteur.includes("spawn_blocking")) fail("le moteur n'isole pas IMAP");
if (!moteur.includes("unnest")) fail("le lot n'est pas une écriture groupée");
if (/for etat in etats[\s\S]{0,400}sqlx::query/.test(moteur)) {
  fail("requête SQL dans la boucle des messages");
}

console.log(`j9-imap-hors-handler: OK (${fichiers.length} fichiers de routes, 4 essais)`);
