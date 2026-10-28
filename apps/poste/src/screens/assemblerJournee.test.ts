import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ligneDelai, ligneMail, ligneTemps } from "./assemblerJournee.ts";

describe("la journée", () => {
  it("marque Calculé seulement les délais du moteur", () => {
    assert.equal(ligneDelai({ id: "1", titre: "Conclusions", origineCalcul: "2026-01-06" }).calcule, true);
    assert.equal(ligneDelai({ id: "1", titre: "Conclusions", origineCalcul: "2026-01-06" }).meta, "Calculé");
    assert.equal(ligneDelai({ id: "2", titre: "Note", origineCalcul: null }).calcule, false);
  });

  it("propose le classement en un clic quand un dossier est suggéré", () => {
    const avec = ligneMail({
      id: "m1",
      objet: "Pièces",
      expediteur: "a@example.com",
      suggestionDossierId: "d1",
    });
    assert.deepEqual(avec.classer, { messageId: "m1", dossierId: "d1" });
    const sans = ligneMail({
      id: "m2",
      objet: "Autre",
      expediteur: "b@example.com",
      suggestionDossierId: null,
    });
    assert.equal(sans.classer, undefined);
  });

  it("distingue le temps tiré d'un mail de celui tiré de l'agenda", () => {
    assert.equal(ligneTemps({ id: "t1", libelle: "Lecture", minutes: 6, origine: "mail" }).meta, "Relevé sur vos mails");
    assert.equal(
      ligneTemps({ id: "t2", libelle: "Audience", minutes: 30, origine: "agenda" }).meta,
      "Relevé sur votre agenda",
    );
  });
});
