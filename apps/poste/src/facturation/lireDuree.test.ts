import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lireDuree } from "./lireDuree.ts";

describe("lireDuree", () => {
  it("lit les formes demandées", () => {
    assert.equal(lireDuree("1 h 30"), 90);
    assert.equal(lireDuree("45 min"), 45);
    assert.equal(lireDuree("0,75"), 45);
  });

  it("garde les minutes entières déjà saisies par les recettes", () => {
    assert.equal(lireDuree("60"), 60);
    assert.equal(lireDuree("  15  "), 15);
  });

  it("refuse les cas limites", () => {
    assert.equal(lireDuree(""), null);
    assert.equal(lireDuree("0"), null);
    assert.equal(lireDuree("0 min"), null);
    assert.equal(lireDuree("0,0"), null);
    assert.equal(lireDuree("-5"), null);
    assert.equal(lireDuree("1 h 60"), null);
    assert.equal(lireDuree("abc"), null);
    assert.equal(lireDuree("1 h 30 et plus"), null);
  });

  it("accepte une fraction d'heure explicite", () => {
    assert.equal(lireDuree("1,5 h"), 90);
    assert.equal(lireDuree("2 h"), 120);
  });
});
