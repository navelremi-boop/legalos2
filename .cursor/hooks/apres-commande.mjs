// Marque qu'une commande a été exécutée, pour le compteur du § 4.7 (continuer.mjs, Cursor).
// Sous Claude Code, la marque est écrite aussi : elle est sans effet, aucun hook Stop ne la lit.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dossierProjet, lireEntree, repondre } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  console.error(`hook apres-commande : ${lu.erreur}`);
}
const racine = dossierProjet();
mkdirSync(join(racine, ".mission"), { recursive: true });
writeFileSync(join(racine, ".mission", "derniere-commande"), `${Date.now()}\n`, "utf8");
repondre({});
