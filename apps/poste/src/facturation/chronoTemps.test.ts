import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basculerPause,
  chronoArrete,
  demarrerChrono,
  demanderArret,
  minutesConfirmees,
  reprendreChrono,
  ticChrono,
} from "./chronoTemps.ts";
import { filtrerSaisies, grouperParJour, resumeTemps, type SaisieTemps } from "./listeTemps.ts";

describe("chronomètre", () => {
  it("passe en pause, puis confirme l'arrêt en minutes", () => {
    let etat = demarrerChrono("d1");
    etat = ticChrono(etat);
    etat = ticChrono(etat);
    etat = basculerPause(etat);
    assert.equal(etat.phase, "pause");
    assert.equal(ticChrono(etat).secondes, 2);
    etat = demanderArret(etat);
    assert.equal(etat.phase, "confirmation");
    assert.equal(minutesConfirmees({ ...etat, secondes: 30 }), 1);
    assert.equal(minutesConfirmees({ ...etat, secondes: 90 }), 2);
    assert.equal(reprendreChrono(etat).phase, "en-cours");
    assert.equal(chronoArrete().phase, "arrete");
  });
});

function saisie(partiel: Partial<SaisieTemps> & Pick<SaisieTemps, "id" | "jour">): SaisieTemps {
  return {
    minutes: 30,
    libelle: "note",
    dossierId: "d",
    dossierNom: "Dossier",
    intervenantId: "moi",
    tauxCentimesHeure: 22_000,
    htCentimes: 11_000,
    facturee: false,
    ...partiel,
  };
}

describe("liste des saisies", () => {
  const lignes = [
    saisie({ id: "a", jour: "2026-10-28", facturee: true, intervenantId: "autre" }),
    saisie({ id: "b", jour: "2026-10-28", facturee: false }),
    saisie({ id: "c", jour: "2026-10-20", facturee: false }),
  ];

  it("filtre facturées, non facturées et mes temps", () => {
    assert.deepEqual(
      filtrerSaisies(lignes, "facturees", "cabinet", "moi").map((l) => l.id),
      ["a"],
    );
    assert.deepEqual(
      filtrerSaisies(lignes, "non-facturees", "moi", "moi").map((l) => l.id),
      ["b", "c"],
    );
  });

  it("groupe par jour et résume les sept derniers jours", () => {
    const groupes = grouperParJour(filtrerSaisies(lignes, "toutes", "cabinet", "moi"));
    assert.equal(groupes[0]?.jour, "2026-10-28");
    assert.equal(groupes[0]?.minutes, 60);
    assert.deepEqual(resumeTemps(lignes, "2026-10-28"), {
      nonFactureMinutes: 60,
      septJoursMinutes: 60,
    });
  });
});
