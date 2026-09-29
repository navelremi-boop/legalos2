#!/usr/bin/env node
/**
 * Contrôle statique du contrat d'envoi (miroir TypeScript du connecteur).
 * Usage : node --experimental-strip-types tests/recette/upload-contrat-poste.mjs
 */
import assert from "node:assert/strict";
import {
  CHAMP_SEUL_PAR_TABLE,
  CHAMPS_PAR_TABLE,
  TABLES_MODIFIABLES,
  cheminPatch,
  estRefusDefinitif,
  estTableModifiable,
  filtrerChampsModifies,
} from "../../apps/poste/src/sync/uploadContrat.ts";

assert.equal(TABLES_MODIFIABLES.length, 7);
assert.ok(estTableModifiable("dossiers"));
assert.ok(estTableModifiable("intercalaires_personnalises"));
assert.equal(estTableModifiable("inconnue"), false);

for (const table of TABLES_MODIFIABLES) {
  const seul = CHAMP_SEUL_PAR_TABLE[table];
  assert.ok(CHAMPS_PAR_TABLE[table].includes(seul), `${table}: champ seul hors liste`);
  assert.ok(cheminPatch(table, "id-x").startsWith("/api/"), `${table}: chemin`);
}

const filtre = filtrerChampsModifies("dossiers", {
  juridiction: "TJ",
  nom: "N",
  revision: 2,
  cabinet_id: "c",
});
assert.deepEqual(filtre, { juridiction: "TJ", nom: "N" });

assert.equal(estRefusDefinitif(400), true);
assert.equal(estRefusDefinitif(403), true);
assert.equal(estRefusDefinitif(404), true);
assert.equal(estRefusDefinitif(409), true);
assert.equal(estRefusDefinitif(500), false);

console.log("upload-contrat-poste: OK");
