import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidatsLien } from "./candidatsLien.ts";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";

function contact(partiel: Partial<ContactListe> & Pick<ContactListe, "id" | "nom" | "nature">): ContactListe {
  return {
    siren: null,
    numeroTva: null,
    typeClient: "professionnel",
    professionReglementee: false,
    ...champsFicheVides(),
    ...partiel,
  };
}

const ANNUAIRE: ContactListe[] = [
  contact({ id: "p1", nom: "Ferrand", prenoms: "Antoine", nature: "physique" }),
  contact({ id: "p2", nom: "Ferrand", prenoms: "Claire", nature: "physique" }),
  contact({ id: "s1", nom: "Ferrand Métal", nature: "morale", siren: "100000009" }),
  contact({ id: "s2", nom: "Ferrand Ancien", nature: "morale", archivee: true }),
  contact({ id: "p3", nom: "Dupont", nature: "physique" }),
];

describe("contacts proposés sous le champ « Avec »", () => {
  it("ne propose rien tant que rien n'est saisi", () => {
    assert.deepEqual(candidatsLien(ANNUAIRE, "p1", "  "), []);
  });

  it("cherche par nom sans tenir compte des accents ni de la casse", () => {
    assert.deepEqual(
      candidatsLien(ANNUAIRE, "p3", "ferrand metal").map((entree) => entree.id),
      ["s1"],
    );
  });

  it("cherche par SIREN", () => {
    assert.deepEqual(
      candidatsLien(ANNUAIRE, "p3", "100 000 009").map((entree) => entree.id),
      ["s1"],
    );
  });

  it("écarte la fiche qui porte le lien et les fiches archivées", () => {
    assert.deepEqual(
      candidatsLien(ANNUAIRE, "p1", "ferrand").map((entree) => entree.id),
      ["p2", "s1"],
    );
  });

  it("borne la liste", () => {
    assert.equal(candidatsLien(ANNUAIRE, "p3", "ferrand", 2).length, 2);
  });
});
