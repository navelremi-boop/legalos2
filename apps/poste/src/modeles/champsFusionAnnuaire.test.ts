import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, type ContactListe } from "../contacts/listeContacts.ts";
import type { LienAffiche } from "../contacts/liensContacts.ts";
import { champsAnnuaireFusion } from "./champsFusionAnnuaire.ts";

function fiche(partiel: Partial<ContactListe> & Pick<ContactListe, "id" | "nature" | "nom">): ContactListe {
  return {
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: false,
    ...champsFicheVides(),
    ...partiel,
  };
}

function mandat(): LienAffiche {
  return {
    id: "lien",
    sourceId: "camille",
    cibleId: "duclos",
    sourceCivilite: "Madame",
    sourcePrenoms: "Camille",
    sourceNom: "Martin",
    cibleNom: "SARL Duclos Industrie",
    typeLien: "mandat_social",
    fonction: "gerant",
    libelle: null,
    representeSociete: true,
    debut: "2018-06-01",
    fin: null,
  };
}

const CAMILLE = fiche({
  id: "camille",
  nature: "physique",
  civilite: "Madame",
  prenoms: "Camille",
  nom: "Martin",
  nomNaissance: "Dupont",
  dateNaissance: "1980-03-14",
  lieuNaissance: "Lyon",
  nationalite: "française",
  profession: "avocate",
  adresseDomicile: "12 rue des Lilas, 69001 Lyon",
});

const DUCLOS = fiche({
  id: "duclos",
  nature: "morale",
  nom: "SARL Duclos Industrie",
  forme: "société à responsabilité limitée",
  capitalLibelle: "au capital de 10 000 €",
  greffe: "RCS de Lyon",
  siren: "123456789",
  adresseSiege: "8 quai Saint-Vincent, 69001 Lyon",
});

describe("champs de fusion de l'annuaire", () => {
  it("remplit la désignation du client, de son représentant et de l'adversaire, et la boucle", () => {
    const adversaire = fiche({ id: "adv", nature: "physique", nom: "Durand" });
    const champs = champsAnnuaireFusion({
      parties: [
        { role: "client", contactId: "duclos" },
        { role: "adversaire", contactId: "adv" },
      ],
      intervenants: [
        { id: "i-societe", contactId: "duclos", code: "client", rattacheA: null },
        { id: "i-avocat", contactId: "camille", code: "avocat", rattacheA: "i-societe" },
      ],
      codes: ["client", "avocat", "adversaire"],
      contacts: [DUCLOS, CAMILLE, adversaire],
      liens: [mandat()],
    });

    assert.equal(
      champs.client_designation,
      "SARL Duclos Industrie, société à responsabilité limitée, au capital de 10 000 €, RCS de Lyon, numéro 123456789, 8 quai Saint-Vincent, 69001 Lyon, prise en la personne de son gérante en exercice, Madame Camille Martin, domiciliée en cette qualité audit siège",
    );
    assert.equal(champs.client_adresse, "8 quai Saint-Vincent, 69001 Lyon");
    assert.equal(
      champs.client_representant_designation,
      "Madame Camille Martin, née Dupont le 14 mars 1980 à Lyon, française, avocate, 12 rue des Lilas, 69001 Lyon",
    );
    assert.equal(champs.adversaire_designation, "");
    assert.deepEqual(champs.intervenants_avocat, [
      {
        nom: "Martin",
        designation:
          "Madame Camille Martin, née Dupont le 14 mars 1980 à Lyon, française, avocate, 12 rue des Lilas, 69001 Lyon",
        adresse: "12 rue des Lilas, 69001 Lyon",
        rattache_a: "SARL Duclos Industrie",
      },
    ]);
    assert.deepEqual(champs.intervenants_adversaire, []);
    assert.equal("client_nom" in champs, false);
  });
});
