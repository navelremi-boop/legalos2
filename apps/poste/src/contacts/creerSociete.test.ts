import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preparerCreation } from "./creerSociete.ts";

describe("création d'une société", () => {
  it("exige une dénomination et un SIREN valide, et garde le capital saisi", () => {
    assert.throws(() => preparerCreation({
      siren: "123456789",
      denomination: "DUCLOS",
      forme: "",
      activite: "",
      adresse: "",
      greffe: "",
      capitalEuros: "",
      depuisRegistre: true,
    }), /SIREN invalide/);
    const fiche = preparerCreation({
      siren: "100 000 009",
      denomination: "DUCLOS INDUSTRIE",
      forme: "5499",
      activite: "",
      adresse: "8 QUAI SAINT-VINCENT 69001 LYON",
      greffe: "RCS de Lyon",
      capitalEuros: "10000",
      depuisRegistre: true,
    });
    assert.equal(fiche.siren, "100000009");
    assert.equal(fiche.nom, "DUCLOS INDUSTRIE");
    assert.equal(fiche.forme, "5499");
    assert.equal(fiche.activite, null);
    assert.equal(fiche.capitalCentimes, 1_000_000);
    assert.equal(fiche.greffe, "RCS de Lyon");
    assert.equal(fiche.depuisRegistre, true);
  });
});
