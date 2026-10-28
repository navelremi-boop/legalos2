import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alerteConventionActive, type LeveeAlerte } from "./alerteConvention.ts";

const urgence = (le: string): LeveeAlerte => ({ motif: "urgence", le });

describe("alerte de convention non signée", () => {
  it("s'affiche tant que rien n'est signé ni levé", () => {
    assert.equal(alerteConventionActive({ signee: false, levee: null, aujourdhui: "2026-10-28" }), true);
  });

  it("disparaît dès qu'une convention est signée", () => {
    assert.equal(
      alerteConventionActive({ signee: true, levee: urgence("2026-01-01"), aujourdhui: "2026-10-28" }),
      false,
    );
  });

  it("revient 30 jours après une levée pour urgence", () => {
    assert.equal(
      alerteConventionActive({ signee: false, levee: urgence("2026-10-01"), aujourdhui: "2026-10-30" }),
      false,
    );
    assert.equal(
      alerteConventionActive({ signee: false, levee: urgence("2026-10-01"), aujourdhui: "2026-10-31" }),
      true,
    );
  });

  it("exige la date d'une convention signée hors de l'application", () => {
    assert.equal(
      alerteConventionActive({
        signee: false,
        levee: { motif: "hors_application", le: "2026-10-01" },
        aujourdhui: "2026-12-01",
      }),
      true,
    );
    assert.equal(
      alerteConventionActive({
        signee: false,
        levee: { motif: "hors_application", le: "2026-10-01", dateHorsApplication: "2026-09-15" },
        aujourdhui: "2026-12-01",
      }),
      false,
    );
  });

  it("reste levée pour l'aide juridictionnelle, le premier rendez-vous et le dossier interne", () => {
    for (const motif of ["aide_juridictionnelle", "premier_rendez_vous", "dossier_interne"] as const) {
      assert.equal(
        alerteConventionActive({
          signee: false,
          levee: { motif, le: "2026-01-01" },
          aujourdhui: "2027-01-01",
        }),
        false,
      );
    }
  });
});
