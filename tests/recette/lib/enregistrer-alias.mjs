/**
 * Précharge l'alias « @/ » du poste pour les tests unitaires lancés par `node --test`
 * (`node --import ./tests/recette/lib/enregistrer-alias.mjs --test …`).
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "alias-poste.mjs")));
