import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deElide } from "./elision.ts";

describe("lieu précédé de « de »", () => {
  it("élide devant une voyelle ou un Y, y compris accentuée", () => {
    assert.equal(deElide("Aix-en-Provence"), "d'Aix-en-Provence");
    assert.equal(deElide("Agen"), "d'Agen");
    assert.equal(deElide("Orléans"), "d'Orléans");
    assert.equal(deElide("Évreux"), "d'Évreux");
    assert.equal(deElide("Yvetot"), "d'Yvetot");
  });

  it("garde « de » devant une consonne", () => {
    assert.equal(deElide("Lyon"), "de Lyon");
    assert.equal(deElide("Saint-Priest"), "de Saint-Priest");
    assert.equal(deElide("La Rochelle"), "de La Rochelle");
  });

  it("contracte l'article défini en tête", () => {
    assert.equal(deElide("Le Mans"), "du Mans");
    assert.equal(deElide("Le Havre"), "du Havre");
    assert.equal(deElide("Les Sables-d'Olonne"), "des Sables-d'Olonne");
  });

  it("rogne les espaces et rend vide ce qui est vide", () => {
    assert.equal(deElide("  Aix-en-Provence "), "d'Aix-en-Provence");
    assert.equal(deElide(""), "");
    assert.equal(deElide(null), "");
    assert.equal(deElide("   "), "");
  });
});
