import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { empreinte } from "./empreinte.ts";

describe("empreinte d'une lecture de l'annuaire", () => {
  it("donne la même empreinte à deux lectures identiques", () => {
    const lecture = () => [{ id: "a", nom: "Martin", coordonnees: [{ valeur: "x@example.test" }] }, [["a", 2]]];
    assert.equal(empreinte(lecture()), empreinte(lecture()));
  });

  it("change dès qu'une valeur change, même d'un seul caractère", () => {
    const avant = empreinte([{ id: "a", nom: "Martin" }]);
    assert.notEqual(empreinte([{ id: "a", nom: "Martins" }]), avant);
    assert.notEqual(empreinte([{ id: "a", nom: "Martan" }]), avant);
    assert.notEqual(empreinte([{ id: "a", nom: "Martin" }, { id: "b", nom: "Durand" }]), avant);
  });

  it("accepte une valeur vide", () => {
    assert.equal(typeof empreinte([]), "string");
    assert.equal(empreinte([]), empreinte([]));
  });
});
