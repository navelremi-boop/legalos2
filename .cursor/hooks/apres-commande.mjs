// Marque qu'une commande a été exécutée, pour le compteur du § 4.7 (continuer.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lireEntree, repondre } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  console.error(`hook apres-commande : ${lu.erreur}`);
}
const racine = process.env.CURSOR_PROJECT_DIR || process.cwd();
mkdirSync(join(racine, ".mission"), { recursive: true });
writeFileSync(join(racine, ".mission", "derniere-commande"), `${Date.now()}\n`, "utf8");
repondre({});
