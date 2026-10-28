import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compteurs,
  filtrer,
  grouper,
  panneauDroit,
  vueDossier,
  type DossierBrut,
} from "./listeDossiers.ts";

const AUJOURDHUI = "2026-10-09";

function dossier(partiel: Partial<DossierBrut> & Pick<DossierBrut, "id" | "nom">): DossierBrut {
  return {
    chemise: "kraft",
    reference: null,
    typeDossier: "contentieux",
    etape: "instruction",
    juridiction: null,
    numeroRg: null,
    restreint: false,
    creeLe: "2026-10-01T00:00:00Z",
    echeance: null,
    echeanceTitre: null,
    parties: "",
    ...partiel,
  };
}

describe("liste des dossiers", () => {
  const actif = vueDossier(
    dossier({
      id: "a",
      nom: "SCI Les Tilleuls",
      reference: "2026-042",
      numeroRg: "25/04417",
      echeance: "2026-10-14",
      echeanceTitre: "Conclusions",
      parties: "Banque Rhodanienne",
    }),
    AUJOURDHUI,
  );
  const loin = vueDossier(
    dossier({
      id: "b",
      nom: "Holding Perrache",
      reference: "2026-021",
      echeance: "2026-11-20",
      restreint: true,
      parties: "Olivier Perrache",
    }),
    AUJOURDHUI,
  );
  const sans = vueDossier(dossier({ id: "c", nom: "Bail commercial", reference: "2026-038" }), AUJOURDHUI);
  const clos = vueDossier(
    dossier({
      id: "d",
      nom: "Association Les Jardins",
      reference: "2025-118",
      etape: "clos",
      numeroRg: "RG-CLOS",
    }),
    AUJOURDHUI,
  );
  const passe = vueDossier(
    dossier({ id: "e", nom: "Échéance passée", echeance: "2026-10-01" }),
    AUJOURDHUI,
  );
  const tous = [actif, loin, sans, clos, passe];

  it("compte les actifs, l'échéance proche, les restreints et les clos", () => {
    assert.deepEqual(compteurs(tous), { actifs: 4, proche: 1, restreints: 1, clos: 1 });
  });

  it("une échéance passée n'est pas une prochaine échéance", () => {
    assert.equal(passe.jours, null);
    assert.equal(actif.jours, 5);
  });

  it("groupe par prochaine échéance", () => {
    const titres = grouper(filtrer(tous, "actifs", ""), "echeance").map((g) => g.titre);
    assert.deepEqual(titres, ["Cette semaine", "Dans les semaines qui viennent", "Sans échéance"]);
  });

  it("la recherche inclut les dossiers clos et ignore le filtre", () => {
    const trouves = filtrer(tous, "actifs", "rg-clos");
    assert.deepEqual(
      trouves.map((d) => d.id),
      ["d"],
    );
    const parNom = filtrer(tous, "clos", "tilleuls");
    assert.deepEqual(
      parNom.map((d) => d.id),
      ["a"],
    );
  });

  it("la création laisse la liste visible et change seulement le panneau", () => {
    assert.equal(panneauDroit(false), "apercu");
    assert.equal(panneauDroit(true), "creation");
  });
});
