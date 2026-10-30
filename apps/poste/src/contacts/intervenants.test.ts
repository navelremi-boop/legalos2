import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { QUALITES_LIVREES, grouperIntervenants } from "./intervenants.ts";

describe("intervenants d'un dossier", () => {
  it("aligne la liste livrée sur la migration", () => {
    const racine = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const sql = readFileSync(join(racine, "crates/api/migrations/056_qualites_intervenants.sql"), "utf8");
    assert.equal(QUALITES_LIVREES.length, 28);
    for (const qualite of QUALITES_LIVREES) {
      const drapeau = qualite.admetRattachement ? "TRUE" : "FALSE";
      const libelleSql = qualite.libelle.replaceAll("'", "''");
      assert.equal(sql.includes(`('${qualite.code}', '${libelleSql}', ${drapeau})`), true, qualite.code);
    }
  });

  it("place l'avocate en retrait sous sa partie", () => {
    const groupes = grouperIntervenants([
      {
        id: "societe",
        codeQualite: "client",
        libelleQualite: "client",
        prenoms: null,
        nom: "SARL Duclos Industrie",
        accord: null,
        rattacheA: null,
      },
      {
        id: "anne",
        codeQualite: "avocat",
        libelleQualite: "avocat",
        prenoms: "Anne",
        nom: "Perrin",
        accord: "feminin",
        rattacheA: "societe",
      },
    ]);
    assert.equal(groupes.length, 1);
    assert.equal(groupes[0]?.qualite, "client");
    assert.equal(groupes[0]?.entrees[0]?.texte, "SARL Duclos Industrie");
    assert.deepEqual(groupes[0]?.entrees[0]?.enfants, [
      { id: "anne", texte: "Me Anne Perrin, avocate de SARL Duclos Industrie" },
    ]);
  });
});
