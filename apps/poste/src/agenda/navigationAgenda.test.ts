import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decalerJour, jourCivil, joursSemaineAffiches, semaineDe } from "./navigationAgenda.ts";

describe("jourCivil", () => {
  it("écrit AAAA-MM-JJ avec des zéros", () => {
    assert.equal(jourCivil(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(jourCivil(new Date(2026, 11, 31)), "2026-12-31");
  });
});

describe("decalerJour", () => {
  it("passe d'un mois et d'une année à l'autre", () => {
    assert.equal(decalerJour("2026-10-31", 1), "2026-11-01");
    assert.equal(decalerJour("2026-12-31", 1), "2027-01-01");
    assert.equal(decalerJour("2026-03-01", -1), "2026-02-28");
  });
  it("traverse le changement d'heure sans sauter ni répéter un jour", () => {
    assert.equal(decalerJour("2026-10-24", 1), "2026-10-25");
    assert.equal(decalerJour("2026-10-25", 1), "2026-10-26");
    assert.equal(decalerJour("2026-03-28", 1), "2026-03-29");
    assert.equal(decalerJour("2026-03-29", 1), "2026-03-30");
  });
  it("décale d'une semaine", () => {
    assert.equal(decalerJour("2026-10-14", 7), "2026-10-21");
    assert.equal(decalerJour("2026-10-14", -7), "2026-10-07");
  });
});

describe("joursSemaineAffiches", () => {
  it("garde le lundi au vendredi et le week-end seulement s'il est occupé", () => {
    const semaine = semaineDe("2026-10-14");
    assert.deepEqual(joursSemaineAffiches(semaine, new Set()), semaine.slice(0, 5));
    assert.deepEqual(joursSemaineAffiches(semaine, new Set(["2026-10-17"])), [
      ...semaine.slice(0, 5),
      "2026-10-17",
    ]);
  });
});

describe("semaineDe", () => {
  it("va du lundi au dimanche", () => {
    assert.deepEqual(semaineDe("2026-10-14"), [
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });
  it("un dimanche appartient à la semaine qui finit ce jour-là", () => {
    assert.equal(semaineDe("2026-10-18")[0], "2026-10-12");
    assert.equal(semaineDe("2026-10-18")[6], "2026-10-18");
  });
  it("un lundi ouvre sa semaine", () => {
    assert.equal(semaineDe("2026-10-12")[0], "2026-10-12");
  });
  it("la semaine du changement d'heure d'automne compte sept jours distincts", () => {
    const jours = semaineDe("2026-10-25");
    assert.equal(new Set(jours).size, 7);
    assert.equal(jours[6], "2026-10-25");
  });
});
