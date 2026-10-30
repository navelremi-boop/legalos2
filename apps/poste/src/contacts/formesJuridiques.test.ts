import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formesFiltrees, libelleForme, nombreDeFormes, texteForme } from "./formesJuridiques.ts";

describe("catégories juridiques", () => {
  it("résout le code du registre et garde un libellé déjà saisi", () => {
    assert.ok(nombreDeFormes(3) >= 260);
    assert.equal(libelleForme("5499"), "Société à responsabilité limitée (sans autre indication)");
    assert.equal(libelleForme("5710"), "SAS, société par actions simplifiée");
    assert.equal(libelleForme("0000"), "Organisme de placement collectif en valeurs mobilières sans personnalité morale");
    assert.equal(libelleForme("société à responsabilité limitée"), "société à responsabilité limitée");
    assert.equal(
      texteForme("5499"),
      "5499 — Société à responsabilité limitée (sans autre indication)",
    );
    assert.equal(texteForme("société à responsabilité limitée"), "société à responsabilité limitée");
  });

  it("filtre la table hors ligne", () => {
    const sarl = formesFiltrees("responsabilite");
    assert.ok(sarl.some((forme) => forme.code === "5499"));
    assert.ok(formesFiltrees("5499").some((forme) => forme.code === "5499"));
    assert.ok(sarl.every((forme) => forme.niveau === 3));
    const garde = formesFiltrees("zzzz", "5499");
    assert.equal(garde[0]?.code, "5499");
  });
});
