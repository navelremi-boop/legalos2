import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  libelleEcart,
  libelleHeure,
  libelleProchainRendezVous,
  ligneDelai,
  ligneMail,
  ligneTemps,
  minutesDepuisLibelle,
  partAnneau,
} from "./assemblerJournee.ts";

describe("la journée", () => {
  it("marque Calculé seulement les délais du moteur", () => {
    const calcule = ligneDelai({ id: "1", titre: "Conclusions", origineCalcul: "2026-01-06", jours: 5 });
    assert.equal(calcule.calcule, true);
    assert.equal(calcule.jours, 5);
    assert.equal(libelleEcart(5), "dans 5 jours");
    assert.equal(libelleEcart(1), "dans 1 jour");
    assert.equal(ligneDelai({ id: "2", titre: "Note", origineCalcul: null }).calcule, false);
    assert.equal(libelleHeure(9, 30), "9 h 30");
    assert.equal(minutesDepuisLibelle("14 h 00"), 14 * 60);
    assert.equal(libelleProchainRendezVous(9 * 60, [14 * 60]), "Prochain rendez-vous dans 5 h 00");
    assert.equal(libelleProchainRendezVous(15 * 60, [9 * 60 + 30, 14 * 60]), "Plus de rendez-vous aujourd'hui");
    assert.ok(partAnneau(0) > partAnneau(30));
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
    assert.equal(
      ligneMail({ id: "m3", objet: "Pièces", expediteur: "c@example.com", suggestionDossierId: "d1", extrait: "  Jointes. " }).extrait,
      "Jointes.",
    );
    assert.equal(
      ligneMail({ id: "m4", objet: "Vide", expediteur: "d@example.com", suggestionDossierId: null, extrait: "   " }).extrait,
      undefined,
    );
  });

  it("distingue le temps tiré d'un mail de celui tiré de l'agenda", () => {
    assert.equal(ligneTemps({ id: "t1", libelle: "Lecture", minutes: 6, origine: "mail" }).meta, "Relevé sur vos mails");
    assert.equal(
      ligneTemps({ id: "t2", libelle: "Audience", minutes: 30, origine: "agenda" }).meta,
      "Relevé sur votre agenda",
    );
  });
});
