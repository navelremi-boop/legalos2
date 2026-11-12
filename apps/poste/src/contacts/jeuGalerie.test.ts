import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPTES_DOSSIERS_GALERIE,
  CONTACTS_DEMO,
  HISTORIQUES_GALERIE,
  incoherencesGalerie,
} from "./jeuGalerie.ts";

describe("cohérence de la galerie de Contacts", () => {
  it("affiche le même nombre de dossiers dans la liste et dans l'onglet de chaque fiche", () => {
    assert.deepEqual(incoherencesGalerie(CONTACTS_DEMO, COMPTES_DOSSIERS_GALERIE, HISTORIQUES_GALERIE), []);
  });

  it("ne donne un historique et un compte qu'à des fiches de la galerie", () => {
    const ids = new Set(CONTACTS_DEMO.map((contact) => contact.id));
    for (const fixe of HISTORIQUES_GALERIE) assert.ok(ids.has(fixe.contactId), fixe.contactId);
    for (const id of Object.keys(COMPTES_DOSSIERS_GALERIE)) assert.ok(ids.has(id), id);
  });

  it("donne à chaque fiche comptée un dossier nommé avec sa qualité", () => {
    for (const fixe of HISTORIQUES_GALERIE) {
      for (const dossier of fixe.dossiers) {
        assert.ok(dossier.id !== "" && dossier.nom !== "" && dossier.qualite !== "", fixe.contactId);
      }
    }
  });

  it("signale une fiche dont la liste dit 1 et l'historique 0", () => {
    const sansHistorique = HISTORIQUES_GALERIE.filter((fixe) => fixe.contactId !== "moreau");
    assert.deepEqual(incoherencesGalerie(CONTACTS_DEMO, COMPTES_DOSSIERS_GALERIE, sansHistorique), [
      { contactId: "moreau", liste: 1, onglet: 0 },
    ]);
  });

  it("signale une fiche dont l'historique a un dossier que la liste ne compte pas", () => {
    const sansCompte = { ...COMPTES_DOSSIERS_GALERIE, moreau: 0 };
    assert.deepEqual(incoherencesGalerie(CONTACTS_DEMO, sansCompte, HISTORIQUES_GALERIE), [
      { contactId: "moreau", liste: 0, onglet: 1 },
    ]);
  });
});
