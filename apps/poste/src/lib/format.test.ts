import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDuree } from "./format.ts";

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
