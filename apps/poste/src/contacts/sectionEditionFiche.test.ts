import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sectionPourChamp, titreSectionEdition } from "./sectionEditionFiche.ts";

describe("section d'édition de la fiche", () => {
  it("relie chaque champ manquant à la bonne section du panneau", () => {
    assert.equal(sectionPourChamp("civilite"), "identite");
    assert.equal(sectionPourChamp("profession"), "identite");
    assert.equal(sectionPourChamp("denomination"), "denomination");
    assert.equal(sectionPourChamp("capital"), "capital");
    assert.equal(sectionPourChamp("barreau"), "profession");
    assert.equal(sectionPourChamp("adresse_siege"), "coordonnee");
    assert.equal(sectionPourChamp("inconnu"), "identite");
  });

  it("donne un titre d'action pour chaque section", () => {
    assert.equal(titreSectionEdition("coordonnee"), "Ajouter une coordonnée");
    assert.equal(titreSectionEdition("identite"), "Modifier l'identité");
  });
});
