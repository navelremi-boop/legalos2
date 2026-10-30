import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mailsDuContact, syntheseFactures, type MailFiche } from "./historiqueFiche.ts";

const MAIL: MailFiche = {
  id: "m1",
  objet: "Pièces",
  expediteur: "Camille Martin <camille@example.test>",
  destinataires: "contact@cabinet.example",
  etat: "classe",
};

describe("historique de la fiche", () => {
  it("calcule l'encours après encaissement", () => {
    const synthese = syntheseFactures([
      { id: "f1", libelle: "Honoraires", ttcCentimes: 120_000, encaisseCentimes: 50_000 },
      { id: "f2", libelle: "Provision", ttcCentimes: 10_000, encaisseCentimes: 10_000 },
    ]);
    assert.equal(synthese.encaisseCentimes, 60_000);
    assert.equal(synthese.encoursCentimes, 70_000);
  });

  it("ne garde que les mails classés dont une adresse est celle de la fiche", () => {
    const gardes = mailsDuContact(
      [
        MAIL,
        { ...MAIL, id: "m2", etat: "a_classer" },
        { ...MAIL, id: "m3", expediteur: "autre@example.test", destinataires: "personne@example.test" },
      ],
      ["camille@example.test"],
    );
    assert.deepEqual(gardes.map((mail) => mail.id), ["m1"]);
    assert.equal(mailsDuContact([MAIL], []).length, 0);
  });
});
