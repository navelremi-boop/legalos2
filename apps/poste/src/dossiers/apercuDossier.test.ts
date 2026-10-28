import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derniersElements, etapesProcedure, libelleJoursRestants, nonLusParDossier, resumeFacturation } from "./apercuDossier.ts";

describe("aperçu d'un dossier", () => {
  it("place l'étape courante entre les étapes faites et les suivantes", () => {
    const etapes = etapesProcedure("contentieux", "instruction");
    assert.deepEqual(
      etapes.map((etape) => [etape.libelle, etape.etat]),
      [
        ["Ouverture", "fait"],
        ["Instruction", "cours"],
        ["Plaidoirie", "futur"],
        ["Jugement", "futur"],
        ["Exécution", "futur"],
        ["Clos", "futur"],
      ],
    );
  });

  it("garde les trois éléments les plus récents", () => {
    const gardes = derniersElements([
      { id: "a", genre: "mail", titre: "Ancien", quand: "2026-01-01" },
      { id: "b", genre: "piece", titre: "Récent", quand: "2026-10-01" },
      { id: "c", genre: "facture", titre: "Milieu", quand: "2026-06-01" },
      { id: "d", genre: "mail", titre: "Dernier", quand: "2026-10-28" },
    ]);
    assert.deepEqual(
      gardes.map((element) => element.id),
      ["d", "b", "c"],
    );
  });

  it("compte les mails non lus d'un dossier, au singulier pour un jour", () => {
    assert.equal(libelleJoursRestants(1), "1 jour");
    assert.equal(libelleJoursRestants(9), "9 jours");
    const comptes = nonLusParDossier([
      { dossier_id: "a", lu: 0 },
      { dossier_id: "a", lu: 1 },
      { dossier_id: "a", lu: 0 },
      { dossier_id: null, lu: 0 },
    ]);
    assert.equal(comptes.get("a"), 2);
    assert.equal(comptes.has("b"), false);
  });

  it("sépare le temps non facturé du montant déjà facturé", () => {
    assert.deepEqual(
      resumeFacturation([
        { minutes: 45, htCentimes: 10_000, facture: false },
        { minutes: 60, htCentimes: 22_000, facture: true },
      ]),
      { nonFactureMinutes: 45, factureCentimes: 22_000 },
    );
  });
});
