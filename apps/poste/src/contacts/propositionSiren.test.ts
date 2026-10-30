import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsRetenus, lignesProposition, type PropositionSiren } from "./propositionSiren.ts";

const PROPOSITION: PropositionSiren = {
  siren: "100000009",
  denomination: "DUCLOS INDUSTRIE",
  forme: "5499",
  adresseSiege: "8 QUAI SAINT-VINCENT 69001 LYON",
  activite: "25.11Z",
};

describe("proposition d'import par SIREN", () => {
  it("garde l'ancienne valeur à côté de celle du registre", () => {
    const lignes = lignesProposition(
      {
        nom: "SARL Duclos Industrie",
        forme: "société à responsabilité limitée",
        adresseSiege: "8 quai Saint-Vincent, 69001 Lyon",
        activite: null,
      },
      PROPOSITION,
    );
    assert.equal(lignes[0]?.ancien, "SARL Duclos Industrie");
    assert.equal(lignes[0]?.registre, "DUCLOS INDUSTRIE");
    assert.equal(lignes[3]?.ancien, "—");
    assert.equal(lignes[3]?.registre, "25.11Z");
  });

  it("à la création, l'ancienne valeur est vide", () => {
    const lignes = lignesProposition(
      { nom: "", forme: null, adresseSiege: null, activite: null },
      PROPOSITION,
    );
    assert.equal(lignes[0]?.ancien, "—");
    assert.equal(lignes[0]?.registre, "DUCLOS INDUSTRIE");
    assert.equal(lignes[2]?.ancien, "—");
    assert.equal(lignes[2]?.registre, "8 QUAI SAINT-VINCENT 69001 LYON");
  });

  it("ne retient que les champs cochés", () => {
    const retenus = champsRetenus(PROPOSITION, {
      denomination: true,
      forme: false,
      adresseSiege: false,
      activite: true,
    });
    assert.deepEqual(retenus, { denomination: "DUCLOS INDUSTRIE", activite: "25.11Z" });
  });
});
