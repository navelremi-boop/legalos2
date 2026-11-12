import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mentionAvecArticle, phraseMentions } from "./mentionsLecture.ts";

describe("phrase des mentions manquantes", () => {
  it("met l'article devant une mention seule", () => {
    assert.equal(phraseMentions([{ champ: "profession", libelle: "profession" }]), "la profession");
  });

  it("relie deux mentions par « et » et plusieurs par des virgules", () => {
    assert.equal(
      phraseMentions([
        { champ: "capital", libelle: "capital" },
        { champ: "representant", libelle: "organe représentant" },
      ]),
      "le capital et l'organe représentant",
    );
    assert.equal(
      phraseMentions([
        { champ: "civilite", libelle: "civilité" },
        { champ: "prenoms", libelle: "prénoms" },
        { champ: "nom", libelle: "nom" },
      ]),
      "la civilité, les prénoms et le nom",
    );
  });

  it("garde le libellé d'un champ inconnu et ne renvoie rien sans mention", () => {
    assert.equal(mentionAvecArticle({ champ: "inconnu", libelle: "autre mention" }), "autre mention");
    assert.equal(phraseMentions([]), "");
  });
});
