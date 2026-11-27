import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enHeureDeParis, heureDeParisDepuisEntete, instantDepuisEntete } from "./dateEntete.ts";
import { formatDateHeureParis } from "./format.ts";

const lisible = (texte: string) => texte.replace(/[  ]/gu, " ");

function parisDe(entete: string): string {
  const paris = heureDeParisDepuisEntete(entete);
  return paris === null ? "null" : `${paris.jour} ${String(paris.heure)}:${String(paris.minute).padStart(2, "0")}`;
}

describe("date d'en-tête en heure de Paris", () => {
  it("lit les décalages de la RFC 2822 : +0000, +0100, +0200, -0500", () => {
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 +0000"), "2025-10-14 11:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 +0200"), "2025-10-14 9:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 +0100"), "2025-10-14 10:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 -0500"), "2025-10-14 16:30");
    assert.equal(parisDe("Mon, 10 Nov 2025 23:30:00 -0500"), "2025-11-11 5:30");
  });

  it("lit les noms de fuseau d'usage, le jour de la semaine absent et le commentaire final", () => {
    assert.equal(parisDe("14 Oct 2025 09:30:00 GMT"), "2025-10-14 11:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30 UT"), "2025-10-14 11:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 EST"), "2025-10-14 16:30");
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00 +0200 (CEST)"), "2025-10-14 9:30");
    assert.equal(parisDe("Tue, 14 October 2025 09:30:00 +0200"), "2025-10-14 9:30");
  });

  it("lit une année à deux chiffres selon la RFC 2822", () => {
    assert.equal(parisDe("Tue, 14 Oct 25 09:30:00 +0200"), "2025-10-14 9:30");
    assert.equal(parisDe("Thu, 14 Oct 99 09:30:00 +0200").startsWith("1999-10-14"), true);
  });

  it("sans fuseau, lit la date en UTC, jamais en heure du poste", () => {
    assert.equal(parisDe("Tue, 14 Oct 2025 09:30:00"), "2025-10-14 11:30");
    assert.equal(parisDe("2025-10-14 09:30:00"), "2025-10-14 11:30");
    assert.equal(parisDe("2025-01-14 09:30:00"), "2025-01-14 10:30");
  });

  it("lit l'horodatage tel que la base locale le porte (Postgres) et l'ISO 8601", () => {
    assert.equal(parisDe("2026-10-27 09:12:00+00"), "2026-10-27 10:12");
    assert.equal(parisDe("2026-10-27 09:12:00.123456+00"), "2026-10-27 10:12");
    assert.equal(parisDe("2026-10-27T08:41:00+01:00"), "2026-10-27 8:41");
    assert.equal(parisDe("2026-10-27T08:41:00Z"), "2026-10-27 9:41");
    assert.equal(parisDe("2026-10-27 08:41:00+0530"), "2026-10-27 4:11");
  });

  it("passe à l'heure d'été le 29 mars 2026 et en revient le 25 octobre 2026", () => {
    // Le 29 mars 2026 à 01 h 00 UTC, Paris passe de UTC+1 à UTC+2 : 01 h 59 UTC+1 puis 03 h 00 UTC+2.
    assert.equal(parisDe("2026-03-29T00:59:00Z"), "2026-03-29 1:59");
    assert.equal(parisDe("2026-03-29T01:00:00Z"), "2026-03-29 3:00");
    // Le 25 octobre 2026 à 01 h 00 UTC, Paris repasse de UTC+2 à UTC+1 : 02 h 59 UTC+2 puis 02 h 00 UTC+1.
    assert.equal(parisDe("2026-10-25T00:59:00Z"), "2026-10-25 2:59");
    assert.equal(parisDe("2026-10-25T01:00:00Z"), "2026-10-25 2:00");
    assert.equal(parisDe("2026-10-24T22:30:00Z"), "2026-10-25 0:30");
    assert.equal(parisDe("2026-06-30T22:30:00Z"), "2026-07-01 0:30");
  });

  it("change de jour quand l'heure de Paris dépasse minuit", () => {
    assert.equal(parisDe("Wed, 31 Dec 2025 23:30:00 +0000"), "2026-01-01 0:30");
  });

  it("refuse une date absente ou illisible, jamais une date inventée", () => {
    for (const entete of [
      null,
      undefined,
      "",
      "   ",
      "hier soir",
      "Tue, 31 Feb 2025 09:30:00 +0200",
      "Tue, 14 Foo 2025 09:30:00 +0200",
      "Tue, 14 Oct 2025 25:30:00 +0200",
      "Tue, 14 Oct 2025 09:61:00 +0200",
      "Tue, 14 Oct 2025 09:30:00 +2575",
      "Tue, 14 Oct 2025 09:30:00 XYZ",
      "2025-13-01 09:30:00+00",
      "2025-02-30T09:30:00Z",
    ]) {
      assert.equal(instantDepuisEntete(entete), null, String(entete));
    }
  });

  it("donne le même instant quel que soit le décalage écrit", () => {
    const a = instantDepuisEntete("Tue, 14 Oct 2025 09:30:00 +0200");
    const b = instantDepuisEntete("Tue, 14 Oct 2025 07:30:00 +0000");
    const c = instantDepuisEntete("2025-10-14 02:30:00-05");
    assert.equal(a?.getTime(), b?.getTime());
    assert.equal(a?.getTime(), c?.getTime());
    assert.deepEqual(enHeureDeParis(new Date(Date.UTC(2025, 9, 14, 7, 30))), { jour: "2025-10-14", heure: 9, minute: 30 });
  });
});

describe("date et heure de Paris au format de l'écran", () => {
  it("écrit « 27 octobre à 10 h 12 » pour l'année courante et garde l'année sinon", () => {
    assert.equal(lisible(formatDateHeureParis("2026-10-27 09:12:00+00", 2026)), "27 octobre à 10 h 12");
    assert.equal(lisible(formatDateHeureParis("Tue, 14 Oct 2025 09:05:00 +0200", 2026)), "14 octobre 2025 à 9 h 05");
    assert.equal(lisible(formatDateHeureParis("Thu, 01 Oct 2026 00:10:00 +0000", 2026)), "1er octobre à 2 h 10");
  });

  it("renvoie une chaîne vide pour une date absente ou illisible", () => {
    assert.equal(formatDateHeureParis(null, 2026), "");
    assert.equal(formatDateHeureParis("illisible", 2026), "");
  });
});
