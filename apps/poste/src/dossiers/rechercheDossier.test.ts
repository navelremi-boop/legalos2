import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filtrerDossiers, type DossierChoix } from "./rechercheDossier.ts";

const DOSSIERS: DossierChoix[] = [
  { id: "a", nom: "Ferrand Métal", reference: "2026-042" },
  { id: "b", nom: "Martin c/ Assurances Loire", reference: "2026-031" },
  { id: "c", nom: "SCI des Lilas", reference: "2026-038" },
  { id: "d", nom: "Succession Moreau", reference: "2026-057" },
];

const ids = (liste: DossierChoix[]) => liste.map((dossier) => dossier.id);

describe("filtrerDossiers", () => {
  it("rend la liste sans saisie", () => {
    assert.deepEqual(ids(filtrerDossiers(DOSSIERS, "  ")), ["a", "b", "c", "d"]);
  });

  it("ignore accents et casse", () => {
    assert.deepEqual(ids(filtrerDossiers(DOSSIERS, "METAL")), ["a"]);
  });

  it("cherche aussi la référence", () => {
    assert.deepEqual(ids(filtrerDossiers(DOSSIERS, "2026-03")), ["b", "c"]);
  });

  it("exige chacun des mots", () => {
    assert.deepEqual(ids(filtrerDossiers(DOSSIERS, "loire martin")), ["b"]);
  });

  it("place d'abord les noms qui commencent par la saisie", () => {
    assert.deepEqual(ids(filtrerDossiers(DOSSIERS, "s")).slice(0, 2), ["c", "d"]);
  });

  it("respecte la limite", () => {
    assert.equal(filtrerDossiers(DOSSIERS, "", 2).length, 2);
  });
});
