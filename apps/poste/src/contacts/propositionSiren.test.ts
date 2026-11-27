import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsRetenus, lignesProposition, propositionDepuisJson, type PropositionSiren } from "./propositionSiren.ts";

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

describe("réponse de l'instance, casse du registre", () => {
  it("met en casse normale les communes et adresses en capitales, sans toucher à la dénomination", () => {
    const lue = propositionDepuisJson({
      siren: "903417566",
      denomination: "FERRAND LOGISTIQUE",
      forme: "5499",
      adresse_siege: "5 AVENUE DE L'INDUSTRIE 69800 SAINT-PRIEST",
      activite: "49.41A",
    });
    assert.equal(lue?.denomination, "FERRAND LOGISTIQUE");
    assert.equal(lue?.adresseSiege, "5 avenue de l'Industrie 69800 Saint-Priest");
    const villefranche = propositionDepuisJson({
      siren: "494012305",
      adresse_siege: "120 RUE DE LA RÉPUBLIQUE 69400 VILLEFRANCHE-SUR-SAÔNE",
    });
    assert.equal(villefranche?.adresseSiege, "120 rue de la République 69400 Villefranche-sur-Saône");
  });

  it("ne retouche pas une adresse que le registre donne déjà en casse mixte", () => {
    const lue = propositionDepuisJson({ siren: "903417566", adresse_siege: "5 avenue de l'Industrie 69800 Saint-Priest" });
    assert.equal(lue?.adresseSiege, "5 avenue de l'Industrie 69800 Saint-Priest");
  });
});

describe("réponse de l'instance", () => {
  it("lit la proposition du registre et refuse une réponse sans SIREN", () => {
    const lue = propositionDepuisJson({
      siren: "100000009",
      denomination: "DUCLOS INDUSTRIE",
      forme: "5499",
      adresse_siege: "8 QUAI SAINT-VINCENT 69001 LYON",
      activite: null,
      dirigeants: [],
    });
    // La dénomination reste telle que le registre la donne ; l'adresse passe en casse normale.
    assert.equal(lue?.denomination, "DUCLOS INDUSTRIE");
    assert.equal(lue?.adresseSiege, "8 quai Saint-Vincent 69001 Lyon");
    assert.equal(lue?.activite, null);
    assert.equal(propositionDepuisJson({ denomination: "X" }), null);
    assert.equal(propositionDepuisJson(null), null);
  });
});
