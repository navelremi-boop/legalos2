import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPTES_DOSSIERS_GALERIE,
  CONTACTS_DEMO,
  HISTORIQUES_GALERIE,
  incoherencesGalerie,
  LIENS_CONTACTS_DEMO,
} from "./jeuGalerie.ts";
import { groupesLiens } from "./liensContacts.ts";
import { tuilesFactures } from "./historiqueFiche.ts";

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

  it("porte la référence et la chemise de chaque dossier, comme la maquette", () => {
    for (const fixe of HISTORIQUES_GALERIE) {
      for (const dossier of fixe.dossiers) {
        assert.match(dossier.reference ?? "", /^[0-9]{4}-[0-9]{3}$/u, fixe.contactId);
        assert.ok(dossier.chemise !== null && dossier.chemise !== "", fixe.contactId);
      }
    }
    const perrache = HISTORIQUES_GALERIE.find((fixe) => fixe.contactId === "perrache");
    assert.equal(perrache?.dossiers[0]?.reference, "2026-021");
  });

  it("donne à Ferrand Métal les trois tuiles de la maquette", () => {
    const ferrand = HISTORIQUES_GALERIE.find((fixe) => fixe.contactId === "ferrand");
    const tuiles = tuilesFactures(ferrand?.factures ?? []).map((tuile) => [
      tuile.libelle,
      tuile.montant.replaceAll(" ", " ").replaceAll(" ", " "),
    ]);
    assert.deepEqual(tuiles, [
      ["Facturé en 2026", "6 000,00 €"],
      ["Encaissé", "2 400,00 €"],
      ["Encours", "3 600,00 €"],
    ]);
  });

  it("donne aux liens le début et la pièce source de la maquette", () => {
    const lignes = (id: string) => groupesLiens(LIENS_CONTACTS_DEMO, id).flatMap((groupe) => groupe.lignes);
    const perrache = lignes("perrache")[0];
    assert.equal(perrache?.periode, "depuis le 1er juillet 2022");
    assert.equal(perrache?.source, "Kbis du 6 septembre 2026");
    const comptable = lignes("rivegauche")[0];
    assert.equal(comptable?.periode, "depuis 2019");
    assert.equal(comptable?.source, "Lettre de mission");
    const ferrand = lignes("ferrand");
    assert.deepEqual(
      ferrand.map((ligne) => [ligne.titre, ligne.periode]),
      [
        ["Président", "depuis le 4 avril 2019"],
        ["Directrice générale", "du 4 avril 2019 au 12 mars 2025"],
        ["Expert-comptable", "depuis 2019"],
      ],
    );
  });
});
