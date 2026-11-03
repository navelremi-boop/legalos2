import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactDepuisSociete, corpsCreationSociete, preparerCreation } from "./creerSociete.ts";

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

  it("assemble le siège, accepte les milliers espacés et contrôle le numéro de TVA", () => {
    const base = {
      siren: "812345676",
      denomination: "FERRAND MÉTAL",
      forme: "5710",
      activite: "",
      adresse: "14 rue de la Forge",
      codePostal: "69007",
      commune: "",
      greffe: "Lyon",
      capitalEuros: "50 000",
      depuisRegistre: false,
    };
    const fiche = preparerCreation({ ...base, tva: "" });
    assert.equal(fiche.adresseSiege, "14 rue de la Forge, 69007 LYON 07");
    assert.equal(fiche.capitalCentimes, 5_000_000);
    assert.equal(fiche.numeroTva, null);
    assert.throws(() => preparerCreation({ ...base, tva: "FR00812345676" }), /TVA invalide/);
  });

  it("construit la ligne de liste et le corps de l'API à partir de la même fiche", () => {
    const fiche = preparerCreation({
      siren: "100000009",
      denomination: "DUCLOS INDUSTRIE",
      forme: "5710",
      activite: "",
      adresse: "",
      greffe: "",
      capitalEuros: "10000",
      depuisRegistre: false,
    });
    const contact = contactDepuisSociete(fiche, "id-1");
    assert.equal(contact.nature, "morale");
    assert.equal(contact.capitalCentimes, 1_000_000);
    assert.equal(contact.monnaie, "EUR");
    const corps = corpsCreationSociete(fiche, "id-1", "cle-1");
    assert.equal(corps.capital_centimes, 1_000_000);
    assert.equal(corps.monnaie, "EUR");
    assert.equal(corps.depuis_registre, false);
  });
});
