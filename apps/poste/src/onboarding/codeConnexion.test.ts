import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chiffresCode, messageConnexion, repartirCode } from "./codeConnexion.ts";

describe("code de double authentification", () => {
  it("répartit un collage sur six chiffres", () => {
    assert.equal(repartirCode("12 34-56"), "123456");
    assert.equal(repartirCode("abc1234567"), "123456");
    assert.deepEqual(chiffresCode("123"), ["1", "2", "3", "", "", ""]);
  });

  it("nomme l'adresse et le mot de passe ensemble", () => {
    const texte = messageConnexion("Identifiants invalides");
    assert.equal(texte, "Adresse ou mot de passe incorrect");
    assert.equal(messageConnexion("Instance injoignable"), "Instance injoignable");
  });
});
