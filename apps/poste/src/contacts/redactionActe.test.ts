import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  civiliteActe,
  greffeSansRcs,
  minusculeInitiale,
  nationaliteAccordee,
  prenomUsuel,
  sirenEnGroupes,
} from "./redactionActe.ts";

describe("règles de rédaction des actes", () => {
  it("abrège la civilité : Monsieur, Madame, Maître", () => {
    assert.equal(civiliteActe("Monsieur"), "M.");
    assert.equal(civiliteActe("Madame"), "Mme");
    assert.equal(civiliteActe("Maître"), "Me");
    assert.equal(civiliteActe(" Docteur "), "Docteur");
    assert.equal(civiliteActe(null), "");
  });

  it("prend le premier prénom comme prénom usuel", () => {
    assert.equal(prenomUsuel("Antoine Louis"), "Antoine");
    assert.equal(prenomUsuel("Jean-Pierre Marc"), "Jean-Pierre");
    assert.equal(prenomUsuel("  Claire "), "Claire");
    assert.equal(prenomUsuel(null), "");
  });

  it("écrit le SIREN par groupes de trois chiffres", () => {
    assert.equal(sirenEnGroupes("812345676"), "812 345 676");
    assert.equal(sirenEnGroupes("812 345 676"), "812 345 676");
    assert.equal(sirenEnGroupes(""), "");
    assert.equal(sirenEnGroupes(null), "");
  });

  it("retire « RCS de » du greffe", () => {
    assert.equal(greffeSansRcs("RCS de Lyon"), "Lyon");
    assert.equal(greffeSansRcs("RCS d'Aix-en-Provence"), "Aix-en-Provence");
    assert.equal(greffeSansRcs("RCS Lyon"), "Lyon");
    assert.equal(greffeSansRcs("Villefranche-Tarare"), "Villefranche-Tarare");
    assert.equal(greffeSansRcs(null), "");
  });

  it("met la minuscule initiale sans casser un sigle", () => {
    assert.equal(minusculeInitiale("Société par actions simplifiée"), "société par actions simplifiée");
    assert.equal(minusculeInitiale("SARL coopérative de consommation"), "SARL coopérative de consommation");
    assert.equal(minusculeInitiale("SA à conseil d'administration"), "SA à conseil d'administration");
    assert.equal(minusculeInitiale("Consultante"), "consultante");
    assert.equal(minusculeInitiale(""), "");
  });

  it("accorde la nationalité au féminin, sans toucher au féminin déjà écrit", () => {
    const cas: [string, string][] = [
      ["français", "française"],
      ["française", "française"],
      ["Français", "française"],
      ["italien", "italienne"],
      ["algérien", "algérienne"],
      ["coréen", "coréenne"],
      ["marocain", "marocaine"],
      ["américain", "américaine"],
      ["sénégalais", "sénégalaise"],
      ["chinois", "chinoise"],
      ["allemand", "allemande"],
      ["espagnol", "espagnole"],
      ["nigérian", "nigériane"],
      ["turc", "turque"],
      ["grec", "grecque"],
      ["suisse", "suisse"],
      ["franco-marocain", "franco-marocaine"],
      ["française et italien", "française et italienne"],
      ["française, marocain", "française, marocaine"],
      ["  ", ""],
    ];
    for (const [saisie, attendu] of cas) assert.equal(nationaliteAccordee(saisie), attendu, saisie);
    assert.equal(nationaliteAccordee(null), "");
  });
});
