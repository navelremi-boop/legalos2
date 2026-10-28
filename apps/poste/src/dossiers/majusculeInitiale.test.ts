import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { majusculeInitiale } from "./majusculeInitiale.ts";

describe("majuscule initiale", () => {
  it("met une capitale au début de chaque mot", () => {
    assert.equal(majusculeInitiale("sas ferrand métal"), "Sas Ferrand Métal");
    assert.equal(majusculeInitiale("Adverse UI 1"), "Adverse UI 1");
  });
});
