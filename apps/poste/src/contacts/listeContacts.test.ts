import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compteursFiltres,
  filtrerContacts,
  grouperAlphabetique,
  type ContactListe,
} from "./listeContacts.ts";

function contact(partiel: Partial<ContactListe> & Pick<ContactListe, "id" | "nom" | "nature">): ContactListe {
  return {
    siren: null,
    numeroTva: null,
    typeClient: "professionnel",
    professionReglementee: false,
    civilite: null,
    accordSaisi: null,
    prenoms: null,
    nomNaissance: null,
    dateNaissance: null,
    lieuNaissance: null,
    nationalite: null,
    profession: null,
    adresseDomicile: null,
    forme: null,
    capitalLibelle: null,
    greffe: null,
    adresseSiege: null,
    representant: null,
    professionCode: null,
    barreau: null,
    specialite: null,
    courAppel: null,
    ...partiel,
  };
}

const JEU: ContactListe[] = [
  contact({ id: "1", nom: "Morel", nature: "physique" }),
  contact({ id: "2", nom: "Martin", nature: "physique", professionReglementee: true }),
  contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale", siren: "123 456 789" }),
  contact({ id: "4", nom: "Étienne Blanc", nature: "physique" }),
];

describe("liste des contacts", () => {
  it("filtre les personnes, les sociétés et les professions", () => {
    assert.deepEqual(
      filtrerContacts(JEU, "personnes", "").map((ligne) => ligne.id),
      ["1", "2", "4"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "societes", "").map((ligne) => ligne.id),
      ["3"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "professions", "").map((ligne) => ligne.id),
      ["2"],
    );
  });

  it("cherche le nom sans accent et le SIREN sans espaces", () => {
    assert.deepEqual(
      filtrerContacts(JEU, "tous", "etienne").map((ligne) => ligne.id),
      ["4"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "tous", "123456789").map((ligne) => ligne.id),
      ["3"],
    );
  });

  it("regroupe par lettre après un tri français", () => {
    const groupes = grouperAlphabetique(filtrerContacts(JEU, "tous", ""));
    assert.deepEqual(
      groupes.map((groupe) => [groupe.lettre, groupe.contacts.map((ligne) => ligne.nom)]),
      [
        ["É", ["Étienne Blanc"]],
        ["M", ["Martin", "Morel"]],
        ["S", ["SARL Duclos Industrie"]],
      ],
    );
  });

  it("compte chaque filtre sur le jeu entier", () => {
    assert.deepEqual(compteursFiltres(JEU), {
      tous: 4,
      personnes: 3,
      societes: 1,
      professions: 1,
    });
  });
});
