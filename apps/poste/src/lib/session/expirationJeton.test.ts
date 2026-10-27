import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jetonExpireBientot } from "@/lib/session/expirationJeton";

function jeton(exp: number): string {
  const corps = btoa(JSON.stringify({ exp })).replace(/=+$/u, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `aa.${corps}.bb`;
}

describe("jeton d'accès bientôt expiré", () => {
  it("est frais loin de l'échéance", () => {
    assert.equal(jetonExpireBientot(jeton(1_000), 100_000, 60_000), false);
  });

  it("est à renouveler dans la marge, expiré, ou illisible", () => {
    assert.equal(jetonExpireBientot(jeton(130), 100_000, 60_000), true);
    assert.equal(jetonExpireBientot(jeton(50), 100_000, 60_000), true);
    assert.equal(jetonExpireBientot("pas-un-jeton", 100_000, 60_000), true);
  });
});
