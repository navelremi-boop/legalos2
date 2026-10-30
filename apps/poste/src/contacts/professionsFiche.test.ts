import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsDeProfession, PROFESSIONS_FICHE, retenirMentions } from "./professionsFiche.ts";

describe("professions réglementées", () => {
  it("donne le barreau et la toque à l'avocat, la spécialité et la cour à l'expert", () => {
    assert.equal(PROFESSIONS_FICHE.length, 8);
    assert.deepEqual(champsDeProfession("avocat"), ["barreau", "toque"]);
    assert.deepEqual(champsDeProfession("expert_judiciaire"), ["specialite", "cour_appel"]);
    assert.deepEqual(champsDeProfession("notaire"), []);
    assert.deepEqual(champsDeProfession(null), []);
    assert.deepEqual(
      retenirMentions({
        code: "notaire",
        barreau: "Lyon",
        toque: "142",
        specialite: "bâtiment",
        courAppel: "Lyon",
      }),
      { code: "notaire", barreau: null, toque: null, specialite: null, courAppel: null },
    );
  });
});
