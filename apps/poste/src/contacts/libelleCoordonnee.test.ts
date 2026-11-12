import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libelleCoordonnee } from "./libelleCoordonnee.ts";

describe("libelleCoordonnee", () => {
  it("nomme les adresses par leur usage, comme la maquette", () => {
    assert.equal(libelleCoordonnee("adresse", "siege"), "Siège");
    assert.equal(libelleCoordonnee("adresse", "facturation"), "Adresse de facturation");
    assert.equal(libelleCoordonnee("adresse", "domicile"), "Domicile");
    assert.equal(libelleCoordonnee("adresse", "autre"), "Adresse");
  });

  it("n'ajoute pas de précision quand l'usage est autre", () => {
    assert.equal(libelleCoordonnee("telephone", "autre"), "Téléphone");
    assert.equal(libelleCoordonnee("email", "autre"), "E-mail");
  });

  it("précise l'usage entre parenthèses pour un téléphone ou un e-mail rangé ailleurs", () => {
    assert.equal(libelleCoordonnee("telephone", "cabinet"), "Téléphone (cabinet)");
    assert.equal(libelleCoordonnee("email", "etude"), "E-mail (étude)");
  });
});
