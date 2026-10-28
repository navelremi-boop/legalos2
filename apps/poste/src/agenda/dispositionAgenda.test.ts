import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grilleMois } from "./navigationAgenda.ts";
import {
  categorieAgenda,
  sousTitrePeriode,
  placerSimultanes,
  positionGrille,
  prochainesEcheances,
  HAUTEUR_HEURE,
} from "./dispositionAgenda.ts";

describe("grille du mois", () => {
  it("commence un lundi et couvre octobre 2026", () => {
    const cases = grilleMois("2026-10-14");
    assert.equal(cases[0]?.jour, "2026-09-28");
    assert.equal(cases[0]?.dansMois, false);
    assert.equal(cases.find((c) => c.jour === "2026-10-01")?.dansMois, true);
    assert.equal(cases.at(-1)?.jour, "2026-11-01");
    assert.equal(cases.at(-1)?.dansMois, false);
  });
});

describe("éléments simultanés", () => {
  it("laisse toute la largeur à des horaires séparés", () => {
    const places = placerSimultanes([
      { id: "a", debutMinute: 9 * 60, dureeMinute: 60 },
      { id: "b", debutMinute: 11 * 60, dureeMinute: 30 },
    ]);
    assert.deepEqual(
      places.map((p) => [p.id, p.colonne, p.colonnes]),
      [
        ["a", 0, 1],
        ["b", 0, 1],
      ],
    );
  });

  it("met côte à côte deux audiences qui se recouvrent", () => {
    const places = placerSimultanes([
      { id: "a", debutMinute: 9 * 60, dureeMinute: 60 },
      { id: "b", debutMinute: 9 * 60 + 30, dureeMinute: 60 },
    ]);
    assert.equal(places.find((p) => p.id === "a")?.colonne, 0);
    assert.equal(places.find((p) => p.id === "b")?.colonne, 1);
    assert.equal(places[0]?.colonnes, 2);
    assert.equal(places[1]?.colonnes, 2);
  });
});

describe("grille horaire", () => {
  it("place 9 h 30 à une heure et demie sous 8 h", () => {
    const place = positionGrille(9 * 60 + 30, 60);
    assert.equal(place?.top, 1.5 * HAUTEUR_HEURE);
    assert.equal(place?.hauteur, HAUTEUR_HEURE - 4);
  });

  it("écarte un élément entièrement avant 8 h", () => {
    assert.equal(positionGrille(6 * 60, 30), null);
  });
});

describe("filtres et prochaines échéances", () => {
  it("résume la période, au singulier", () => {
    assert.equal(
      sousTitrePeriode({ audience: 1, rendez_vous: 1, echeance: 0 }, "aujourd'hui"),
      "1 audience, 1 rendez-vous aujourd'hui",
    );
    assert.equal(
      sousTitrePeriode({ audience: 0, rendez_vous: 0, echeance: 0 }, "cette semaine"),
      "Rien de prévu cette semaine",
    );
  });

  it("range une échéance calculée à part de son type", () => {
    assert.equal(categorieAgenda("audience", "2026-01-06"), "echeance");
    assert.equal(categorieAgenda("rendez_vous", null), "rendez_vous");
  });

  it("garde les cinq dates les plus proches, aujourd'hui compris", () => {
    const lignes = [
      { id: "loin", jour: "2026-12-01", debutMinute: 0 },
      { id: "passe", jour: "2026-10-01", debutMinute: 0 },
      { id: "aujourd", jour: "2026-10-09", debutMinute: 600 },
      { id: "matin", jour: "2026-10-09", debutMinute: 540 },
      { id: "demain", jour: "2026-10-10", debutMinute: 0 },
    ];
    assert.deepEqual(
      prochainesEcheances(lignes, "2026-10-09", 3).map((l) => l.id),
      ["matin", "aujourd", "demain"],
    );
  });
});
