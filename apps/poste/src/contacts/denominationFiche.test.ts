import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normaliserDenomination } from "./denominationFiche.ts";

describe("dénomination d'une société", () => {
  it("retire les espaces et refuse une dénomination vide", () => {
    assert.equal(normaliserDenomination("  SAS Duclos  "), "SAS Duclos");
    assert.equal(normaliserDenomination("   "), null);
  });
});
