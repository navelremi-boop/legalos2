import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accordMandataire, groupesLiens, libelleLien, titreLien, type LienAffiche } from "./liensContacts.ts";

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

  it("accorde la fonction d'un mandat au féminin quand le mandataire est une femme", () => {
    const directrice: LienAffiche = {
      ...LIEN,
      id: "l5",
      sourceId: "claire",
      sourceCivilite: "Madame",
      sourcePrenoms: "Claire",
      fonction: "directeur_general",
    };
    assert.equal(libelleLien(directrice, "claire").texte, "Directrice générale de SAS Ferrand Métal");
    assert.equal(libelleLien(directrice, "ferrand").texte, "Directrice générale : Mme Claire Ferrand");
    assert.equal(groupesLiens([directrice], "ferrand")[0]?.lignes[0]?.titre, "Directrice générale");
    assert.equal(groupesLiens([directrice], "claire")[0]?.lignes[0]?.titre, "Directrice générale");
    // « Madame » seule suffit ; une civilité sans accord connu garde le masculin ; membre du directoire ne change pas.
    assert.equal(titreLien({ typeLien: "mandat_social", fonction: "gerant", libelle: null }, accordMandataire("Mme")), "Gérante");
    assert.equal(titreLien({ typeLien: "mandat_social", fonction: "gerant", libelle: null }, accordMandataire("Maître")), "Gérant");
    assert.equal(
      titreLien({ typeLien: "mandat_social", fonction: "membre_directoire", libelle: null }, "feminin"),
      "Membre du directoire",
    );
    assert.equal(titreLien({ typeLien: "mandat_social", fonction: "inconnue", libelle: null }, "feminin"), "inconnue");
    // Le type « Conjoint ou partenaire de PACS » ne change pas.
    assert.equal(titreLien({ typeLien: "conjoint_pacs", fonction: null, libelle: null }, "feminin"), "Conjoint ou partenaire de PACS");
  });

  it("écrit l'année seule d'un début de lien et met « de » en gras avec la profession", () => {
    const comptable: LienAffiche = {
      ...LIEN,
      id: "l6",
      sourceId: "rivegauche",
      sourceCivilite: null,
      sourcePrenoms: null,
      sourceNom: "Rive Gauche Expertise",
      cibleId: "ferrand",
      cibleNom: "SAS Ferrand Métal",
      typeLien: "expert_comptable",
      fonction: null,
      representeSociete: false,
      debut: "2019",
      source: "Lettre de mission",
    };
    const depuisComptable = groupesLiens([comptable], "rivegauche")[0]?.lignes[0];
    assert.equal(depuisComptable?.titre, "Expert-comptable de");
    assert.equal(depuisComptable?.liaison, "titre");
    assert.equal(depuisComptable?.periode, "depuis 2019");
    assert.equal(depuisComptable?.source, "Lettre de mission");
    const depuisSociete = groupesLiens([comptable], "ferrand")[0]?.lignes[0];
    assert.equal(depuisSociete?.titre, "Expert-comptable");
    assert.equal(depuisSociete?.liaison, ":");
    assert.equal(groupesLiens([{ ...comptable, fin: "2022" }], "ferrand")[0]?.lignes[0]?.periode, "du 2019 au 2022");
  });
});
