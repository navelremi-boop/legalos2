import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accordDemande, normaliserIdentite, optionsCivilite, type IdentiteSaisie } from "./identiteFiche.ts";

const VIDE: IdentiteSaisie = {
  civilite: null,
  accord: null,
  prenoms: null,
  nom: "Martin",
  nomNaissance: null,
  dateNaissance: null,
  lieuNaissance: null,
  nationalite: null,
  profession: null,
};

describe("identité d'une personne", () => {
  it("déduit l'accord de Madame et de Monsieur, et le demande pour Maître", () => {
    assert.equal(accordDemande("Madame"), false);
    assert.equal(accordDemande("Monsieur"), false);
    assert.equal(accordDemande("Maître"), true);
    assert.equal(accordDemande(null), false);
    const maitre = normaliserIdentite({ ...VIDE, civilite: "Maître", accord: "feminin" });
    assert.equal(maitre?.accord, "feminin");
    const madame = normaliserIdentite({ ...VIDE, civilite: "Madame", accord: "masculin" });
    assert.equal(madame?.accord, null);
  });

  it("refuse Mademoiselle, un nom vide et une date illisible", () => {
    assert.equal(normaliserIdentite({ ...VIDE, civilite: "Mademoiselle" }), null);
    assert.equal(normaliserIdentite({ ...VIDE, nom: "  " }), null);
    assert.equal(normaliserIdentite({ ...VIDE, dateNaissance: "14/03/1980" }), null);
    assert.equal(normaliserIdentite({ ...VIDE, dateNaissance: "1980-03-14" })?.dateNaissance, "1980-03-14");
    assert.deepEqual(optionsCivilite("Docteur"), ["Madame", "Monsieur", "Maître", "Docteur"]);
    assert.deepEqual(optionsCivilite("Mademoiselle"), ["Madame", "Monsieur", "Maître"]);
  });
});
