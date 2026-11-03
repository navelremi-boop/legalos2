import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupesLiens, libelleLien, type LienAffiche } from "./liensContacts.ts";

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
  representeSociete: true,
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

  it("groupe les liens comme la maquette : mandats, dirigeants, famille, professionnels", () => {
    const conjoint: LienAffiche = {
      ...LIEN,
      id: "l2",
      cibleId: "claire",
      cibleNom: "Ferrand",
      typeLien: "conjoint_pacs",
      fonction: null,
      representeSociete: false,
      debut: null,
    };
    const parent: LienAffiche = { ...conjoint, id: "l3", cibleId: "hugo", typeLien: "parent" };
    const comptable: LienAffiche = {
      ...conjoint,
      id: "l4",
      sourceId: "rivegauche",
      sourceCivilite: null,
      sourcePrenoms: null,
      sourceNom: "Rive Gauche Expertise",
      cibleId: "ferrand",
      cibleNom: "Ferrand Métal",
      typeLien: "expert_comptable",
    };
    const liens = [{ ...LIEN, source: "Kbis du 2 octobre 2026" }, conjoint, parent, comptable];
    const noms: Record<string, string> = { claire: "Mme Claire Ferrand", hugo: "M. Hugo Ferrand" };

    const antoine = groupesLiens(liens, "antoine", (id) => noms[id] ?? null);
    assert.deepEqual(
      antoine.map((entree) => entree.groupe),
      ["Mandats sociaux", "Famille"],
    );
    const mandat = antoine[0]?.lignes[0];
    assert.equal(mandat?.titre, "Président");
    assert.equal(mandat?.liaison, "de");
    assert.equal(mandat?.autreNom, "SAS Ferrand Métal");
    assert.equal(mandat?.source, "Kbis du 2 octobre 2026");
    assert.equal(mandat?.periode, "depuis le 1er janvier 2020");
    assert.equal(antoine[1]?.lignes[0]?.autreNom, "Mme Claire Ferrand");

    const ferrand = groupesLiens(liens, "ferrand");
    assert.deepEqual(
      ferrand.map((entree) => entree.groupe),
      ["Dirigeants", "Professionnels de la société"],
    );
    assert.equal(ferrand[0]?.lignes[0]?.liaison, ":");
    assert.equal(ferrand[0]?.lignes[0]?.autreNom, "M. Antoine Ferrand");

    const hugo = groupesLiens(liens, "hugo");
    assert.equal(hugo[0]?.lignes[0]?.titre, "Enfant");
    assert.equal(hugo[0]?.lignes[0]?.liaison, "de");
  });
});
