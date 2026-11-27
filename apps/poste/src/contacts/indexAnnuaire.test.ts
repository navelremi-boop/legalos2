import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expressionFts, ligneIndex, lignesIndex, villeDepuisAdresse, villesParContact } from "./indexAnnuaire.ts";
import { appliquerCoordonnees, champsFicheVides, type ContactListe, type CoordonneeLue } from "./listeContacts.ts";

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

describe("calculs sur tout l'annuaire en une passe", () => {
  function fiche(id: string, nom: string): ContactListe {
    return {
      id,
      nature: "physique",
      nom,
      siren: null,
      numeroTva: null,
      typeClient: "particulier",
      professionReglementee: false,
      ...champsFicheVides(),
    };
  }
  const contacts = [fiche("a", "Abrial"), fiche("b", "Belmont"), fiche("c", "Cazeneuve")];
  const coords: CoordonneeLue[] = [
    { contactId: "a", genre: "email", usage: "domicile", valeur: "A@Example.test", principale: true, creeLe: "" },
    { contactId: "a", genre: "adresse", usage: "domicile", valeur: "1 rue du Port, 69001 Lyon", principale: true, creeLe: "" },
    { contactId: "b", genre: "adresse", usage: "domicile", valeur: "2 rue du Port, 75011 Paris", principale: true, creeLe: "" },
    { contactId: "b", genre: "telephone", usage: "domicile", valeur: "06 12 34 56 78", principale: true, creeLe: "" },
  ];

  it("donne les mêmes lignes d'index que le calcul fiche par fiche", () => {
    const parFiche = contacts.map((contact) => ligneIndex(contact, coords));
    assert.deepEqual(lignesIndex(contacts, coords), parFiche);
  });

  it("donne la ville de chaque fiche, vide sans adresse", () => {
    const villes = villesParContact(contacts, coords);
    assert.equal(villes.get("a"), "Lyon");
    assert.equal(villes.get("b"), "Paris");
    assert.equal(villes.get("c"), "");
  });

  it("reprend l'adresse du domicile par fiche sans croiser les fiches", () => {
    const avecAdresses = appliquerCoordonnees(contacts, coords);
    assert.equal(avecAdresses[0]?.adresseDomicile, "1 rue du Port, 69001 Lyon");
    assert.equal(avecAdresses[1]?.adresseDomicile, "2 rue du Port, 75011 Paris");
    assert.equal(avecAdresses[2]?.adresseDomicile, null);
  });
});
