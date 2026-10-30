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

  it("restitue la désignation du client et de l'adversaire, et la boucle des intervenants", () => {
    const modele = construireModele([
      "Acte",
      "{client_nom}",
      "{client_designation}",
      "{client_adresse}",
      "{client_representant_designation}",
      "{adversaire_designation}",
      "{#intervenants_client}{nom} — {designation} — {adresse} — {rattache_a}{/intervenants_client}",
      "{#intervenants_adversaire}{nom} — {designation} — {adresse} — {rattache_a}{/intervenants_adversaire}",
    ]);
    const produit = fusionnerDocx(modele, {
      ...donnees,
      client_designation: "SAS Ferrand, société par actions simplifiée, au capital de 10 000 €",
      client_adresse: "4 place Bellecour, 69002 Lyon",
      client_representant_designation: "Monsieur Antoine Ferrand, né le 1er octobre 1975 à Paris",
      adversaire_designation: "SARL Duclos Industrie, société à responsabilité limitée",
      intervenants_client: [
        {
          nom: "SAS Ferrand",
          designation: "SAS Ferrand, société par actions simplifiée",
          adresse: "4 place Bellecour, 69002 Lyon",
          rattache_a: "—",
        },
      ],
      intervenants_adversaire: [
        {
          nom: "SARL Duclos Industrie",
          designation: "SARL Duclos Industrie, société à responsabilité limitée",
          adresse: "8 quai Saint-Vincent, 69001 Lyon",
          rattache_a: "—",
        },
      ],
    });
    assert.equal(balisesResiduelles(produit), 0);
    const texte = new TextDecoder().decode(produit);
    assert.equal(texte.includes("Monsieur Antoine Ferrand, né le 1er octobre 1975 à Paris"), true);
    assert.equal(texte.includes("SARL Duclos Industrie, société à responsabilité limitée"), true);
    assert.equal(texte.includes("8 quai Saint-Vincent, 69001 Lyon"), true);
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
