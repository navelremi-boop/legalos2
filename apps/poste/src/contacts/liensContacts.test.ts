import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libelleLien, type LienAffiche } from "./liensContacts.ts";

const LIEN: LienAffiche = {
  id: "l1",
  sourceId: "antoine",
  cibleId: "ferrand",
  sourceCivilite: "Monsieur",
  sourcePrenoms: "Antoine",
  sourceNom: "Ferrand",
  cibleNom: "SAS Ferrand Métal",
  typeLien: "mandat_social",
  fonction: "president",
  libelle: null,
  debut: "2020-01-01",
  fin: null,
};

describe("liens entre contacts", () => {
  it("s'affiche dans les deux sens", () => {
    assert.equal(libelleLien(LIEN, "antoine").texte, "Président de SAS Ferrand Métal");
    assert.equal(libelleLien(LIEN, "ferrand").texte, "Président : M. Antoine Ferrand");
    assert.equal(libelleLien(LIEN, "antoine").periode, null);
  });

  it("conserve un lien terminé avec ses dates", () => {
    const fini = libelleLien({ ...LIEN, fin: "2024-03-14" }, "antoine");
    assert.equal(fini.periode, "du 1er janvier 2020 au 14 mars 2024");
  });
});
