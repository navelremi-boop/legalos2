import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ecranDuPoste } from "./ecranDuPoste.ts";

const base = {
  ecranPret: true,
  authenticated: true,
  localReady: false,
  forceLogin: false,
  syncDone: false,
  aUnJeton: true,
};

describe("écran du poste déjà synchronisé", () => {
  it("ouvre la coque sur les données locales, même si la sync n'est pas marquée finie", () => {
    assert.equal(ecranDuPoste({ ...base, localReady: true }), "coque");
  });

  it("essai négatif : sans donnée locale, la première synchronisation reste affichée", () => {
    assert.equal(ecranDuPoste(base), "sync-initiale");
  });

  it("hors ligne avec données locales : la coque, sans redemander la connexion", () => {
    assert.equal(
      ecranDuPoste({ ...base, authenticated: false, localReady: true, aUnJeton: false }),
      "coque",
    );
  });
});
