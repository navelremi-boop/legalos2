import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDateJourMois, formatDuree, formatMontant, formatMontantRond } from "./format.ts";

const lisible = (texte: string) => texte.replace(/[\u00a0\u202f]/gu, " ");

describe("formatDuree", () => {
  it("omet les minutes nulles et n'écrit pas les secondes", () => {
    assert.equal(lisible(formatDuree(3600)), "1 h");
    assert.equal(lisible(formatDuree(45 * 60)), "0 h 45");
    assert.equal(lisible(formatDuree(105 * 60)), "1 h 45");
    assert.equal(lisible(formatDuree(0)), "0 h");
    assert.equal(lisible(formatDuree(12 * 60 + 4)), "0 h 12");
    assert.equal(lisible(formatDuree(3600)).includes("1 h 0"), false);
    assert.equal(lisible(formatDuree(0)).includes("0 h 0"), false);
  });
});

describe("formatDateJourMois", () => {
  it("omet l'année courante et la garde pour une autre année", () => {
    assert.equal(formatDateJourMois("2026-10-27", 2026), "27 octobre");
    assert.equal(formatDateJourMois("2026-10-01T08:30:00Z", 2026), "1er octobre");
    assert.equal(formatDateJourMois("2025-10-14", 2026), "14 octobre 2025");
    assert.equal(formatDateJourMois("illisible", 2026), "");
  });
});

describe("formatMontantRond", () => {
  it("écrit un montant sans centimes quand il est rond, avec centimes seulement s'ils existent", () => {
    assert.equal(lisible(formatMontantRond(5_000_000)), "50 000 €");
    assert.equal(lisible(formatMontantRond(240_000)), "2 400 €");
    assert.equal(lisible(formatMontantRond(240_050)), "2 400,50 €");
    assert.equal(lisible(formatMontantRond(240_005)), "2 400,05 €");
    assert.equal(lisible(formatMontantRond(0)), "0 €");
    assert.equal(lisible(formatMontantRond(8_400_000_000)), "84 000 000 €");
    assert.equal(lisible(formatMontantRond(99)), "0,99 €");
  });

  it("garde le code de la monnaie étrangère", () => {
    assert.equal(lisible(formatMontantRond(1_000_000, "CHF")), "10 000 CHF");
  });

  it("laisse le formateur de la facturation inchangé : toujours deux décimales", () => {
    assert.equal(lisible(formatMontant(240_000)), "2 400,00 €");
    assert.equal(lisible(formatMontant(240_050)), "2 400,50 €");
  });
});
