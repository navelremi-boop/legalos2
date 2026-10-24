#!/usr/bin/env node
/**
 * J11 étape 4 partie A — logique de l'écran Mails (modules TypeScript du poste), sans application ni service :
 * noms de dossiers IMAP en français, classement, groupes par jour, rail, file d'envoi, invitations, relève,
 * notification d'arrivée ; et, côté Agenda, invitations affichées (fuseaux, mise à jour, annulation) et repères de jours.
 * Tests `node:test` des fichiers `apps/poste/src/messagerie/*.test.ts`, `apps/poste/src/agenda/*.test.ts` et
 * `apps/poste/src/lib/*.test.ts` (journal d'erreurs du poste, D4).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dossiers = [
  join(racine, "apps", "poste", "src", "messagerie"),
  join(racine, "apps", "poste", "src", "agenda"),
  join(racine, "apps", "poste", "src", "lib"),
];
const fichiers = dossiers.flatMap((dossier) =>
  readdirSync(dossier)
    .filter((nom) => nom.endsWith(".test.ts"))
    .map((nom) => join(dossier, nom)),
);

if (fichiers.length === 0) {
  console.error("j11-mails-logique: FAIL — aucun test trouvé");
  process.exit(1);
}

const resultat = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import",
    pathToFileURL(join(racine, "tests", "recette", "lib", "enregistrer-alias.mjs")).href,
    "--test",
    ...fichiers,
  ],
  { cwd: racine, stdio: "inherit" },
);
if (resultat.status !== 0) {
  console.error(`j11-mails-logique: FAIL — exit ${String(resultat.status ?? 1)}`);
  process.exit(resultat.status ?? 1);
}
console.log(`j11-mails-logique: OK (${String(fichiers.length)} fichiers de tests)`);
