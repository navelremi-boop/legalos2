import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONDITION_SQL_A_CLASSER,
  compterAClasser,
  compterNonLus,
  encartClassement,
  estAClasser,
  etiquetteDossier,
  sousTitreEcran,
  type DossierClassement,
} from "./classement.ts";

const tilleuls: DossierClassement = { id: "d1", nom: "SCI Les Tilleuls", chemise: "kraft", reference: "2026-042" };
const dossiers = new Map<string, DossierClassement>([[tilleuls.id, tilleuls]]);

describe("estAClasser", () => {
  it("un mail suggéré ou sans suggestion est à classer", () => {
    assert.equal(estAClasser("suggestion"), true);
    assert.equal(estAClasser("a_classer"), true);
  });
  it("essai négatif : un mail classé, absent ou inconnu n'est pas à classer", () => {
    assert.equal(estAClasser("classe"), false);
    assert.equal(estAClasser(null), false);
    assert.equal(estAClasser(undefined), false);
    assert.equal(estAClasser("autre"), false);
  });
  it("la condition SQL du badge nomme les deux états", () => {
    assert.match(CONDITION_SQL_A_CLASSER, /'a_classer'/u);
    assert.match(CONDITION_SQL_A_CLASSER, /'suggestion'/u);
    assert.doesNotMatch(CONDITION_SQL_A_CLASSER, /'classe'/u);
  });
});

describe("compteurs", () => {
  const mails = [
    { id: "a", etat_classement: "suggestion", lu: 0 },
    { id: "b", etat_classement: "a_classer", lu: 1 },
    { id: "c", etat_classement: "classe", lu: 0 },
  ];
  it("compte les mails à classer", () => {
    assert.equal(compterAClasser(mails), 2);
  });
  it("retire un mail dont le classement est demandé et pas encore synchronisé", () => {
    assert.equal(compterAClasser(mails, new Set(["a"])), 1);
  });
  it("essai négatif : un classement local d'un mail déjà classé ne fait pas baisser le compteur", () => {
    assert.equal(compterAClasser(mails, new Set(["c"])), 2);
  });
  it("compte les non lus (entier ou booléen)", () => {
    assert.equal(compterNonLus(mails), 2);
    assert.equal(compterNonLus([{ etat_classement: "classe", lu: true }]), 0);
    assert.equal(compterNonLus([{ etat_classement: "classe", lu: null }]), 1);
  });
});

describe("sousTitreEcran", () => {
  it("accorde au singulier et au pluriel", () => {
    assert.equal(sousTitreEcran(2, 2), "2 mails à classer, 2 non lus");
    assert.equal(sousTitreEcran(1, 1), "1 mail à classer, 1 non lu");
    assert.equal(sousTitreEcran(3, 0), "3 mails à classer, 0 non lu");
  });
  it("dit que tout est classé quand rien n'est à classer", () => {
    assert.equal(sousTitreEcran(0, 4), "Tout est classé");
  });
});

describe("encartClassement", () => {
  it("mail classé : le dossier du mail", () => {
    const encart = encartClassement(
      { etat_classement: "classe", dossier_id: "d1", suggestion_dossier_id: null },
      dossiers,
    );
    assert.deepEqual(encart, { genre: "classe", dossier: tilleuls });
  });
  it("mail suggéré : la suggestion avec son dossier", () => {
    const encart = encartClassement(
      { etat_classement: "suggestion", dossier_id: null, suggestion_dossier_id: "d1" },
      dossiers,
    );
    assert.deepEqual(encart, { genre: "suggestion", dossier: tilleuls, dossierId: "d1" });
  });
  it("mail sans suggestion : hors dossier", () => {
    const encart = encartClassement(
      { etat_classement: "a_classer", dossier_id: null, suggestion_dossier_id: null },
      dossiers,
    );
    assert.deepEqual(encart, { genre: "hors-dossier" });
  });
  it("classement demandé et pas encore synchronisé : classé dans le dossier choisi", () => {
    const encart = encartClassement(
      { etat_classement: "suggestion", dossier_id: null, suggestion_dossier_id: "d1" },
      dossiers,
      "d1",
    );
    assert.equal(encart.genre, "classe");
  });
  it("dossier classé non synchronisé : l'encart reste « classé », sans dossier", () => {
    const encart = encartClassement(
      { etat_classement: "classe", dossier_id: "inconnu", suggestion_dossier_id: null },
      dossiers,
    );
    assert.deepEqual(encart, { genre: "classe", dossier: null });
  });
});

describe("etiquetteDossier", () => {
  it("la référence, à défaut le nom", () => {
    assert.equal(etiquetteDossier(tilleuls), "2026-042");
    assert.equal(etiquetteDossier({ nom: "Sans référence", reference: null }), "Sans référence");
    assert.equal(etiquetteDossier({ nom: "Vide", reference: "  " }), "Vide");
  });
});
