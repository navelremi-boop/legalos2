import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tvaSaisie } from "./tvaFiche.ts";

describe("numéro de TVA", () => {
  it("accepte la clé FR du même SIREN et refuse une clé ou un SIREN différents", () => {
    assert.deepEqual(tvaSaisie("100000009", "  "), { valeur: null, message: null });
    assert.deepEqual(tvaSaisie("100000009", "FR 88 100000009"), {
      valeur: "FR88100000009",
      message: null,
    });
    assert.equal(tvaSaisie("100000009", "FR00100000009").message, "Numéro de TVA invalide.");
    assert.equal(tvaSaisie("123456789", "FR88100000009").valeur, null);
    assert.equal(tvaSaisie("123456789", "FR88100000009").message, "Numéro de TVA invalide.");
  });
});
