import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sirenSaisi } from "./sirenFiche.ts";

describe("SIREN", () => {
  it("accepte la clé de Luhn, retire les espaces, et refuse un numéro incohérent", () => {
    assert.deepEqual(sirenSaisi(null, "   "), { valeur: null, message: null });
    assert.deepEqual(sirenSaisi(null, "100 000 009"), { valeur: "100000009", message: null });
    assert.equal(sirenSaisi(null, "123456789").message, "SIREN invalide.");
    assert.equal(sirenSaisi(null, "123456789").valeur, null);
    assert.deepEqual(sirenSaisi("FR88100000009", "100000009"), { valeur: "100000009", message: null });
    assert.equal(sirenSaisi("FR00100000009", "100000009").message, "Numéro de TVA invalide.");
  });
});
