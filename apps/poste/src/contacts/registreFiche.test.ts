import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateImmatriculation,
  jourCivilParis,
  libelleGreffe,
  libelleSourceImport,
  ligneSourceFiche,
} from "./registreFiche.ts";

describe("registreFiche", () => {
  it("nomme la source d'import connue et ignore l'inconnue", () => {
    assert.equal(libelleSourceImport("recherche-entreprises"), "Registre national des entreprises");
    assert.equal(libelleSourceImport("autre"), null);
    assert.equal(libelleSourceImport(null), null);
  });

  it("ramène un instant à son jour civil à Paris", () => {
    assert.equal(jourCivilParis("2026-10-02 09:12:00+00"), "2026-10-02");
    assert.equal(jourCivilParis("2026-10-02T22:30:00Z"), "2026-10-03");
    assert.equal(jourCivilParis("2026-10-02"), "2026-10-02");
    assert.equal(jourCivilParis("pas une date"), null);
  });

  it("compose la ligne de source avec l'import et le capital", () => {
    assert.equal(
      (ligneSourceFiche({
        sourceImport: "recherche-entreprises",
        importeLe: "2026-10-02 09:12:00+00",
        sourceCapital: "le procès-verbal du 12 mars 2025",
      }) ?? "").replace(/ /g, " "),
      "Registre national des entreprises, importé le 2 octobre 2026. Capital saisi d'après le procès-verbal du 12 mars 2025.",
    );
  });

  it("n'affiche que ce qui existe dans la ligne de source", () => {
    assert.equal(ligneSourceFiche({}), null);
    assert.equal(
      ligneSourceFiche({ sourceImport: "recherche-entreprises", importeLe: null }),
      "Registre national des entreprises.",
    );
    assert.equal(
      ligneSourceFiche({ sourceCapital: "le procès-verbal du 12 mars 2025" }),
      "Capital saisi d'après le procès-verbal du 12 mars 2025.",
    );
  });

  it("écrit la date d'immatriculation en toutes lettres", () => {
    assert.equal((dateImmatriculation("2019-04-04") ?? "").replace(/ /g, " "), "4 avril 2019");
    assert.equal(dateImmatriculation(null), null);
    assert.equal(dateImmatriculation(""), null);
  });

  it("retire « RCS de » devant le greffe en lecture", () => {
    assert.equal(libelleGreffe("RCS de Lyon"), "Lyon");
    assert.equal(libelleGreffe("RCS de Villefranche-Tarare"), "Villefranche-Tarare");
    assert.equal(libelleGreffe("RCS d'Annecy"), "Annecy");
    assert.equal(libelleGreffe("Lyon"), "Lyon");
    assert.equal(libelleGreffe("  "), null);
    assert.equal(libelleGreffe(null), null);
  });
});
