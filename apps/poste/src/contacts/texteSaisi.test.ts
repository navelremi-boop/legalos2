import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { texteSaisi } from "./texteSaisi.ts";

describe("texte saisi", () => {
  it("retire les blancs et traite le vide comme absent", () => {
    assert.equal(texteSaisi("  RCS de Lyon  "), "RCS de Lyon");
    assert.equal(texteSaisi("   "), null);
    assert.equal(texteSaisi(""), null);
  });
});
