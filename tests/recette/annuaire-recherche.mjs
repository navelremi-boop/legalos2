/**
 * Recherche FTS5 de l'annuaire. Mesure sur 10 000 contacts.
 * Usage : node --import ./tests/recette/lib/enregistrer-alias.mjs tests/recette/annuaire-recherche.mjs
 */
import { IndexAnnuaire } from "../../apps/poste/src/contacts/indexAnnuaireFts.ts";

function fail(message) {
  console.error(`annuaire-recherche: FAIL — ${message}`);
  process.exit(1);
}

const index = await IndexAnnuaire.ouvrir();
index.remplacer([
  { id: "anne", corps: "Camille Martin 100000009 camille@example.test 0612345678 Lyon" },
  { id: "autre", corps: "Paul Renard Paris" },
]);
const parNom = index.chercher("Éléonore");
if (parNom === null || parNom.length !== 0) fail("Éléonore ne doit rien ramener");
const parVille = index.chercher("lyon");
if (!parVille?.includes("anne")) fail(`ville : ${String(parVille)}`);
const parTel = index.chercher("06 12");
if (!parTel?.includes("anne")) fail(`téléphone : ${String(parTel)}`);

const lignes = [];
for (let i = 0; i < 10_000; i += 1) {
  lignes.push({ id: `c${String(i)}`, corps: `Contact ${String(i)} Paris 0102030405` });
}
lignes.push({ id: "aiguille", corps: "zzzyyy999 Lyon 0699887766" });
index.remplacer(lignes);
const debut = performance.now();
const trouves = index.chercher("zzzyyy999");
const duree = performance.now() - debut;
if (!trouves?.includes("aiguille")) fail("l'aiguille est absente");
if (duree >= 300) fail(`requête en ${duree.toFixed(1)} ms (seuil 300)`);
console.log(`annuaire-recherche: OK — 10 000 contacts, requête en ${duree.toFixed(1)} ms`);
index.fermer();
