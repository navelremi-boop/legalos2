import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliquerCoordonnees,
  contactsProposables,
  compteursFiltres,
  filtrerContacts,
  grouperAlphabetique,
  initialesListeContact,
  libelleListeContact,
  metaListeContact,
  natureEtiquetteFiche,
  sirenListeContact,
  sousTitreFiche,
  type ContactListe,
} from "./listeContacts.ts";
import { formatMontant } from "../lib/format.ts";

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
    activite: null,
    representant: null,
    professionCode: null,
    barreau: null,
    specialite: null,
    courAppel: null,
    ...partiel,
    situationFamiliale: partiel.situationFamiliale ?? null,
    capitalCentimes: partiel.capitalCentimes ?? null,
    monnaie: partiel.monnaie ?? null,
    toque: partiel.toque ?? null,
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

  it("reprend l'adresse principale du domicile et du siège", () => {
    const avecAdresse = appliquerCoordonnees(
      [contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })],
      [
        {
          contactId: "3",
          genre: "adresse",
          usage: "siege",
          valeur: "8 quai Saint-Vincent",
          principale: true,
          creeLe: "2026-10-30T12:00:00Z",
        },
        {
          contactId: "3",
          genre: "adresse",
          usage: "domicile",
          valeur: "ignorée",
          principale: false,
          creeLe: "2026-10-01T00:00:00Z",
        },
      ],
    );
    assert.equal(avecAdresse[0]?.adresseSiege, "8 quai Saint-Vincent");
    assert.equal(avecAdresse[0]?.adresseDomicile, null);
  });

  it("ne propose plus une fiche archivée à la saisie", () => {
    const proposables = contactsProposables([
      contact({ id: "1", nom: "Morel", nature: "physique" }),
      contact({ id: "2", nom: "Archivé", nature: "physique", archivee: true }),
    ]);
    assert.deepEqual(proposables.map((fiche) => fiche.id), ["1"]);
  });

  it("compose l'étiquette de nature pour la fiche", () => {
    assert.equal(natureEtiquetteFiche(contact({ id: "1", nom: "Martin", nature: "physique" })), "Personne physique");
    assert.equal(
      natureEtiquetteFiche(
        contact({
          id: "1",
          nom: "Martin",
          nature: "physique",
          professionCode: "avocat",
          professionReglementee: true,
        }),
      ),
      "Personne physique, avocat",
    );
    assert.equal(
      natureEtiquetteFiche(
        contact({
          id: "2",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
        }),
      ),
      "Personne physique, avocate",
    );
    assert.equal(
      natureEtiquetteFiche(contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })),
      "Personne morale",
    );
  });

  it("compose le libellé, les initiales et la meta de la liste", () => {
    assert.equal(
      libelleListeContact(contact({ id: "1", nom: "Martin", nature: "physique", civilite: "Madame", prenoms: "Camille" })),
      "Camille Martin",
    );
    assert.equal(
      libelleListeContact(
        contact({ id: "2", nom: "Ferrand", nature: "physique", civilite: "Monsieur", prenoms: "Antoine Louis" }),
      ),
      "Antoine Ferrand",
    );
    assert.equal(
      libelleListeContact(contact({ id: "4", nom: "Perrin", nature: "physique", civilite: "Maître", prenoms: "Anne" })),
      "Me Anne Perrin",
    );
    assert.equal(
      metaListeContact(
        contact({
          id: "4",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
          barreau: "Lyon",
        }),
        "Lyon",
      ),
      "Avocate, barreau de Lyon",
    );
    assert.equal(
      metaListeContact(contact({ id: "5", nom: "Ferrand", nature: "physique", prenoms: "Hugo" }), "Lyon"),
      "Profession à compléter, Lyon",
    );
    assert.equal(
      libelleListeContact(contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })),
      "SARL Duclos Industrie",
    );
    assert.equal(
      libelleListeContact(contact({ id: "6", nom: "Ferrand Métal", nature: "morale", forme: "5710" })),
      "SAS Ferrand Métal",
    );
    assert.equal(
      libelleListeContact(contact({ id: "7", nom: "SARL Duclos Industrie", nature: "morale", forme: "5499" })),
      "SARL Duclos Industrie",
    );
    assert.equal(
      initialesListeContact(contact({ id: "1", nom: "Martin", nature: "physique", prenoms: "Camille" })),
      "CM",
    );
    assert.equal(sirenListeContact("123456789"), "123 456 789");
    assert.equal(
      metaListeContact(
        contact({
          id: "1",
          nom: "Martin",
          nature: "physique",
          professionCode: "avocat",
          professionReglementee: true,
        }),
        "Lyon",
      ),
      "Avocat, Lyon",
    );
    assert.equal(
      metaListeContact(
        contact({
          id: "3",
          nom: "SARL Duclos Industrie",
          nature: "morale",
          forme: "5499",
          siren: "123456789",
        }),
        "Lyon",
      ),
      "Lyon, SIREN 123 456 789",
    );
  });

  it("compose le sous-titre de la tête de fiche", () => {
    assert.equal(
      sousTitreFiche(
        contact({
          id: "6",
          nom: "SAS Ferrand Métal",
          nature: "morale",
          forme: "5710",
          capitalCentimes: 5_000_000,
          monnaie: "EUR",
        }),
        "Lyon",
      ),
      `Société par actions simplifiée au capital de ${formatMontant(5_000_000)}, Lyon`,
    );
    assert.equal(
      sousTitreFiche(
        contact({
          id: "4",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
          barreau: "Lyon",
        }),
        "Lyon",
      ),
      "Avocate au barreau de Lyon",
    );
    assert.equal(
      sousTitreFiche(
        contact({ id: "2", nom: "Ferrand", nature: "physique", profession: "chef d'entreprise" }),
        "Craponne",
      ),
      "Chef d'entreprise, Craponne",
    );
  });
});
