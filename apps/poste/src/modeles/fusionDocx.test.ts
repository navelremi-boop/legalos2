import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DELIMITEURS_FUSION,
  FusionIncomplete,
  balisesResiduelles,
  construireModele,
  fusionnerDocx,
  modeleLivre,
  stylesIdentiques,
} from "./fusionDocx.ts";

const donnees = {
  dossier_nom: "Ferrand Métal",
  dossier_reference: "2026-042",
  client_nom: "SAS Ferrand",
  cabinet_nom: "Cabinet fictif",
};

describe("fusion documentaire", () => {
  it("produit un courrier, une convention et un acte sans balise résiduelle", () => {
    for (const genre of ["courrier", "convention", "acte"] as const) {
      const modele = modeleLivre(genre);
      const produit = fusionnerDocx(modele, donnees);
      assert.equal(balisesResiduelles(produit), 0);
      assert.equal(stylesIdentiques(modele, produit), true);
      const texte = new TextDecoder().decode(produit);
      assert.equal(texte.includes("Ferrand"), true);
    }
  });

  it("arrête la génération et liste le champ vide ou absent", () => {
    const modele = modeleLivre("courrier");
    assert.throws(
      () => fusionnerDocx(modele, { ...donnees, client_nom: "  " }),
      (erreur: unknown) => erreur instanceof FusionIncomplete && erreur.champsManquants.includes("client_nom"),
    );
    assert.throws(
      () => fusionnerDocx(construireModele(["{champ_absent}"]), donnees),
      (erreur: unknown) => erreur instanceof FusionIncomplete && erreur.champsManquants.includes("champ_absent"),
    );
  });

  it("garde les délimiteurs du cœur gratuit, sans module payant", () => {
    assert.deepEqual(DELIMITEURS_FUSION, { start: "{", end: "}" });
    const paquet = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const noms = Object.keys(paquet.dependencies);
    assert.equal(noms.includes("docxtemplater"), true);
    assert.equal(noms.some((nom) => nom.startsWith("docxtemplater-")), false);
  });
});
