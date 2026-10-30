import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avecCommune, communesDuCode, estAdresseFrance, nombreDeCodesPostaux } from "./codesPostaux.ts";

describe("codes postaux", () => {
  it("propose la commune, ou les communes, d'un code français", () => {
    assert.ok(nombreDeCodesPostaux() > 6000);
    assert.deepEqual(communesDuCode("69001"), ["LYON 01"]);
    assert.deepEqual(communesDuCode("12 rue des Lilas 69001"), ["LYON 01"]);
    const plusieurs = communesDuCode("01400");
    assert.ok(plusieurs.includes("L ABERGEMENT CLEMENCIAT"));
    assert.ok(plusieurs.includes("CHATILLON SUR CHALARONNE"));
    assert.ok(plusieurs.length > 1);
    assert.deepEqual(communesDuCode("00000"), []);
    assert.deepEqual(communesDuCode("6900"), []);
  });

  it("laisse l'étranger en saisie libre", () => {
    assert.equal(estAdresseFrance(""), true);
    assert.equal(estAdresseFrance("France"), true);
    assert.equal(estAdresseFrance("FR"), true);
    assert.equal(estAdresseFrance("Belgique"), false);
    assert.equal(avecCommune("69001", "LYON 01"), "69001 LYON 01");
    assert.equal(avecCommune("69001 LYON 01", "LYON 01"), "69001 LYON 01");
  });
});
