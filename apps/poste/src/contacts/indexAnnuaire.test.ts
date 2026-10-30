import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expressionFts, ligneIndex, villeDepuisAdresse } from "./indexAnnuaire.ts";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";

describe("index de l'annuaire", () => {
  it("tire la ville du code postal", () => {
    assert.equal(villeDepuisAdresse("12 rue des Lilas, 69001 Lyon"), "Lyon");
    assert.equal(villeDepuisAdresse("8 quai Saint-Vincent, 69001 Lyon"), "Lyon");
  });

  it("met dans le document le SIREN, le téléphone sans espaces et la ville", () => {
    const contact: ContactListe = {
      id: "anne",
      nature: "physique",
      nom: "Martin",
      siren: "100 000 009",
      numeroTva: null,
      typeClient: "particulier",
      professionReglementee: false,
      ...champsFicheVides(),
      prenoms: "Camille",
      adresseDomicile: "12 rue des Lilas, 69001 Lyon",
    };
    const corps = ligneIndex(contact, [
      {
        contactId: "anne",
        genre: "telephone",
        usage: "domicile",
        valeur: "06 12 34 56 78",
        principale: true,
        creeLe: "",
      },
      {
        contactId: "anne",
        genre: "email",
        usage: "correspondance",
        valeur: "Camille@Example.test",
        principale: true,
        creeLe: "",
      },
    ]).corps;
    assert.match(corps, /100000009/);
    assert.match(corps, /0612345678/);
    assert.match(corps, /camille@example\.test/);
    assert.match(corps, /Lyon/);
  });

  it("cherche en préfixe, chiffres collés", () => {
    assert.equal(expressionFts("  "), null);
    assert.equal(expressionFts("Éléonore"), '"eleonore"*');
    assert.match(expressionFts("06 12") ?? "", /"0612"\*/);
  });
});
