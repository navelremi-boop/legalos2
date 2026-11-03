import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contactDepuisPersonne,
  corpsCreationPersonne,
  preparerCreationPersonne,
  type SaisiePersonne,
} from "./creerPersonne.ts";

const BASE: SaisiePersonne = {
  civilite: "Madame",
  accord: "",
  prenoms: "Camille",
  nom: "Vasseur",
  nomNaissance: "",
  dateNaissance: "1984-03-12",
  lieuNaissance: "Lyon (69)",
  nationalite: "Française",
  profession: "Ingénieure",
  professionReglementee: "",
  voie: "3 rue des Fleurs",
  codePostal: "69001",
  commune: "",
};

describe("création d'une personne physique", () => {
  it("garde l'identité saisie, la première commune du code postal et aucune profession réglementée", () => {
    const fiche = preparerCreationPersonne(BASE);
    assert.equal(fiche.identite.nom, "Vasseur");
    assert.equal(fiche.identite.civilite, "Madame");
    assert.equal(fiche.identite.nomNaissance, null);
    assert.equal(fiche.professionCode, null);
    assert.equal(fiche.adresseDomicile, "3 rue des Fleurs, 69001 LYON 01");
  });

  it("refuse un nom vide, une date illisible et la civilité Mademoiselle", () => {
    assert.throws(() => preparerCreationPersonne({ ...BASE, nom: " " }), /nom est requis/);
    assert.throws(() => preparerCreationPersonne({ ...BASE, dateNaissance: "2026-02-31" }), /date de naissance/);
    assert.throws(() => preparerCreationPersonne({ ...BASE, civilite: "Mademoiselle" }), /civilité/);
  });

  it("retient l'accord d'une civilité qui le demande et la profession réglementée choisie", () => {
    const fiche = preparerCreationPersonne({
      ...BASE,
      civilite: "Maître",
      accord: "feminin",
      professionReglementee: "avocat",
    });
    assert.equal(fiche.identite.accord, "feminin");
    assert.equal(fiche.professionCode, "avocat");
    const contact = contactDepuisPersonne(fiche, "id-1");
    assert.equal(contact.nature, "physique");
    assert.equal(contact.professionReglementee, true);
    assert.equal(contact.professionCode, "avocat");
    const sansAccord = preparerCreationPersonne({ ...BASE, civilite: "Madame", accord: "masculin" });
    assert.equal(sansAccord.identite.accord, null);
  });

  it("envoie à l'API les champs de la fiche, l'adresse étant une coordonnée à part", () => {
    const fiche = preparerCreationPersonne(BASE);
    const corps = corpsCreationPersonne(fiche, "id-1", "cle-1");
    assert.equal(corps.nature, "physique");
    assert.equal(corps.type_client, "particulier");
    assert.equal(corps.date_naissance, "1984-03-12");
    assert.equal(corps.profession_reglementee, null);
    assert.equal(corps.idempotence_cle, "cle-1");
    assert.ok(!("adresse" in corps));
  });
});
