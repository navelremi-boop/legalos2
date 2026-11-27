import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { casseAdresse, casseCommune, casseRegistre } from "./casseRegistre.ts";

describe("casse normale des communes du registre", () => {
  it("met la majuscule à chaque mot et chaque élément d'un mot composé", () => {
    assert.equal(casseCommune("SAINT-PRIEST"), "Saint-Priest");
    assert.equal(casseCommune("LYON"), "Lyon");
    assert.equal(casseCommune("SAINT-JEAN-DE-LUZ"), "Saint-Jean-de-Luz");
    assert.equal(casseCommune("NEUILLY-SUR-SEINE"), "Neuilly-sur-Seine");
    assert.equal(casseCommune("AIX-EN-PROVENCE"), "Aix-en-Provence");
  });

  it("garde les particules en minuscules sauf en tête d'un nom", () => {
    assert.equal(casseCommune("VILLEFRANCHE-SUR-SAÔNE"), "Villefranche-sur-Saône");
    assert.equal(casseCommune("CHÂTEAU-DU-LOIR"), "Château-du-Loir");
    assert.equal(casseCommune("LE MANS"), "Le Mans");
    assert.equal(casseCommune("LA ROCHELLE"), "La Rochelle");
    assert.equal(casseCommune("LES SABLES-D'OLONNE"), "Les Sables-d'Olonne");
    assert.equal(casseCommune("SAINT-JEAN-D'ANGÉLY"), "Saint-Jean-d'Angély");
  });

  it("ne retouche jamais un texte qui contient déjà une minuscule (saisi par l'utilisateur)", () => {
    assert.equal(casseCommune("Saint-Priest"), "Saint-Priest");
    assert.equal(casseCommune("lyon"), "lyon");
    assert.equal(casseCommune("Villefranche-sur-Saône"), "Villefranche-sur-Saône");
    assert.equal(casseAdresse("5 AVENUE de l'Industrie"), "5 AVENUE de l'Industrie");
  });

  it("rend null pour null et laisse le vide tel quel", () => {
    assert.equal(casseRegistre(null), null);
    assert.equal(casseRegistre(undefined), null);
    assert.equal(casseRegistre(""), "");
    assert.equal(casseRegistre("69001"), "69001");
  });
});

describe("casse normale des adresses du registre", () => {
  it("écrit le type de voie en minuscules, les particules en minuscules, le nom propre en capitales initiales", () => {
    assert.equal(casseAdresse("5 AVENUE DE L'INDUSTRIE"), "5 avenue de l'Industrie");
    assert.equal(casseAdresse("5 AVENUE DE L'INDUSTRIE 69800 SAINT-PRIEST"), "5 avenue de l'Industrie 69800 Saint-Priest");
    assert.equal(casseAdresse("8 QUAI SAINT-VINCENT 69001 LYON"), "8 quai Saint-Vincent 69001 Lyon");
    assert.equal(casseAdresse("14 RUE DE LA FORGE, 69007 LYON"), "14 rue de la Forge, 69007 Lyon");
    assert.equal(
      casseAdresse("120 RUE DE LA RÉPUBLIQUE 69400 VILLEFRANCHE-SUR-SAÔNE"),
      "120 rue de la République 69400 Villefranche-sur-Saône",
    );
  });

  it("couvre les types de voie de la consigne", () => {
    const types = ["rue", "avenue", "boulevard", "chemin", "place", "impasse", "allée", "route", "quai", "cours", "zone"];
    for (const type of types) {
      assert.equal(casseAdresse(`12 ${type.toLocaleUpperCase("fr")} DES TILLEULS`), `12 ${type} des Tilleuls`, type);
    }
  });

  it("garde le suffixe de numéro en minuscules et la lettre de numéro en capitale", () => {
    assert.equal(casseAdresse("12 BIS RUE DU PORT"), "12 bis rue du Port");
    assert.equal(casseAdresse("12B RUE DU PORT"), "12B rue du Port");
  });

  it("met la majuscule à un nom de lieu en tête et à une commune qui commence par un article", () => {
    assert.equal(casseAdresse("ZONE INDUSTRIELLE DES ALOUETTES 38000 GRENOBLE"), "Zone Industrielle des Alouettes 38000 Grenoble");
    assert.equal(casseAdresse("3 RUE DU PORT 72000 LE MANS"), "3 rue du Port 72000 Le Mans");
    assert.equal(casseAdresse("LE BOURG 01000 BOURG-EN-BRESSE"), "Le Bourg 01000 Bourg-en-Bresse");
  });

  it("garde les sigles et les chiffres romains", () => {
    assert.equal(casseAdresse("BP 3021 69341 LYON CEDEX 07"), "BP 3021 69341 Lyon CEDEX 07");
    assert.equal(casseAdresse("1 AVENUE JEAN XXIII 69008 LYON"), "1 avenue Jean XXIII 69008 Lyon");
    assert.equal(casseAdresse("ZAC DES PRÉS 69800 SAINT-PRIEST"), "ZAC des Prés 69800 Saint-Priest");
  });

  it("ne confond pas un mot ordinaire avec un chiffre romain", () => {
    assert.equal(casseAdresse("4 RUE DU MIDI 13001 MARSEILLE"), "4 rue du Midi 13001 Marseille");
    assert.equal(casseAdresse("2 RUE DIX 75001 PARIS"), "2 rue Dix 75001 Paris");
  });
});
