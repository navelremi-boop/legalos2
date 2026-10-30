import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estSituationFamiliale, libelleSituation } from "./situationFamiliale.ts";

describe("situation familiale", () => {
  it("accorde le libellé et refuse un code inconnu", () => {
    assert.equal(libelleSituation("marie", "feminin"), "Mariée");
    assert.equal(libelleSituation("marie", "masculin"), "Marié");
    assert.equal(libelleSituation("marie", null), "Marié(e)");
    assert.equal(libelleSituation("veuf", "feminin"), "Veuve");
    assert.equal(libelleSituation("celibataire", "masculin"), "Célibataire");
    assert.equal(libelleSituation("inconnu", "feminin"), "");
    assert.equal(estSituationFamiliale("pacse"), true);
    assert.equal(estSituationFamiliale("mademoiselle"), false);
  });
});
