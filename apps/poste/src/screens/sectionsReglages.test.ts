import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sectionsVisibles } from "./sectionsReglages.ts";

describe("sections des réglages", () => {
  it("n'affiche pas une section dont la fonction n'existe pas encore", () => {
    const titres = sectionsVisibles().map((section) => section.titre);
    for (const absent of [
      "Collaborateurs et droits",
      "Taux et facturation",
      "Postes et sécurité",
    ]) {
      assert.equal(titres.includes(absent), false, absent);
    }
  });

  it("affiche les sections déjà livrées", () => {
    const ids = sectionsVisibles().map((section) => section.id);
    for (const present of ["cabinet", "messagerie", "apparence", "reference", "modeles"]) {
      assert.equal(ids.includes(present), true, present);
    }
  });
});
