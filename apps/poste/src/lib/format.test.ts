import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDateJourMois, formatDuree } from "./format.ts";

const lisible = (texte: string) => texte.replaceAll("\u00a0", " ");

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
