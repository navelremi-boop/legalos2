import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOURNEE_DEMO } from "./journeeDemo.ts";
import { delaiAffiche, libelleEcart } from "./assemblerJournee.ts";
import { decalerJour } from "@/agenda/navigationAgenda";

describe("galerie de La journée", () => {
  it("propose Classer sur chaque mail déjà suggéré", () => {
    const suggeres = JOURNEE_DEMO.mails.filter((mail) => mail.meta.startsWith("Suggéré"));
    assert.equal(suggeres.length, 2);
    for (const mail of suggeres) {
      const classer = mail.classer;
      if (!classer) throw new Error("classement absent");
      assert.equal(classer.messageId, mail.id);
      assert.notEqual(classer.dossierId, "");
    }
  });

  it("aligne le libellé d'échéance et le compte à rebours sur le 28 octobre", () => {
    const page = "2026-10-28";
    const appel = JOURNEE_DEMO.delais.find((ligne) => ligne.titre === "Appel incident");
    if (!appel || appel.jours === undefined) throw new Error("délai absent");
    const date = decalerJour(page, appel.jours);
    const affiche = delaiAffiche(page, date);
    assert.equal(affiche?.jours, appel.jours);
    assert.equal(appel.meta, affiche?.libelle);
    assert.equal(libelleEcart(appel.jours), "dans 2 jours");
    assert.equal(affiche?.libelle, "échéance le 30 oct.");
    assert.equal(JOURNEE_DEMO.jourPage, page);
  });
});
