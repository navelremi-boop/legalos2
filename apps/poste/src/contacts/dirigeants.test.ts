import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";
import { fichesDuDirigeant, type DirigeantRegistre } from "./dirigeants.ts";

function personne(partiel: Partial<ContactListe>): ContactListe {
  return {
    id: "anne",
    nature: "physique",
    nom: "Martin",
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: false,
    ...champsFicheVides(),
    prenoms: "Camille",
    dateNaissance: "1980-03-14",
    ...partiel,
  };
}

const CAMILLE: DirigeantRegistre = {
  nature: "physique",
  nom: "Martin",
  prenoms: "Camille",
  naissance: "1980-03",
  siren: null,
  qualite: "Gérante",
};

describe("dirigeants du registre", () => {
  it("rapproche le mois et l'année, pas le jour, et ne crée rien", () => {
    const trouves = fichesDuDirigeant(CAMILLE, [personne({})]);
    assert.equal(trouves.length, 1);
    assert.equal(trouves[0]?.id, "anne");
    const autreMois = fichesDuDirigeant(CAMILLE, [personne({ dateNaissance: "1980-04-14" })]);
    assert.equal(autreMois.length, 0);
    const sansMois = fichesDuDirigeant({ ...CAMILLE, naissance: "1980" }, [personne({})]);
    assert.equal(sansMois.length, 0);
  });

  it("rapproche une personne morale par le SIREN", () => {
    const holding = personne({
      id: "holding",
      nature: "morale",
      nom: "Holding Duclos",
      siren: "552 100 554",
      prenoms: null,
      dateNaissance: null,
    });
    const trouves = fichesDuDirigeant(
      {
        nature: "morale",
        nom: "HOLDING DUCLOS",
        prenoms: null,
        naissance: null,
        siren: "552100554",
        qualite: "Président",
      },
      [holding, personne({})],
    );
    assert.deepEqual(trouves.map((fiche) => fiche.id), ["holding"]);
  });
});
