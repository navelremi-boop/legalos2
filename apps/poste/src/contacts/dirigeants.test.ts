import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";
import { fichesDuDirigeant, lienDepuisDirigeant, type DirigeantRegistre } from "./dirigeants.ts";

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

  it("prépare un mandat sans représenter la société", () => {
    const camille = personne({});
    const lien = lienDepuisDirigeant({ id: "duclos", nom: "SARL Duclos Industrie" }, camille, CAMILLE, "lien-1");
    assert.equal(lien.sourceId, "anne");
    assert.equal(lien.cibleId, "duclos");
    assert.equal(lien.typeLien, "mandat_social");
    assert.equal(lien.fonction, "gerant");
    assert.equal(lien.representeSociete, false);
    const inconnu = lienDepuisDirigeant(
      { id: "duclos", nom: "SARL Duclos Industrie" },
      camille,
      { ...CAMILLE, qualite: "Commissaire aux comptes" },
      "lien-2",
    );
    assert.equal(inconnu.typeLien, "autre");
    assert.equal(inconnu.libelle, "Commissaire aux comptes");
    assert.equal(inconnu.representeSociete, false);
  });
});
