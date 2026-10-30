import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centimesDepuisSaisie, saisieDepuisCentimes } from "./capitalFiche.ts";

describe("capital d'une société", () => {
  it("convertit le montant saisi en centimes", () => {
    assert.equal(centimesDepuisSaisie("10000"), 1_000_000);
    assert.equal(centimesDepuisSaisie("10 000,50"), 1_000_050);
    assert.equal(centimesDepuisSaisie(""), null);
    assert.equal(saisieDepuisCentimes(1_000_000), "10000");
    assert.equal(saisieDepuisCentimes(1_000_050), "10000,50");
    assert.throws(() => centimesDepuisSaisie("-1"), /Capital invalide/);
    assert.throws(() => centimesDepuisSaisie("10.5"), /Capital invalide/);
  });
});
