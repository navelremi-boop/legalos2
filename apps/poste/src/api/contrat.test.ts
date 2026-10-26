import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CorpsRequete, Recu } from "@/api/contrat";
import { lireSante } from "@/messagerie/formesSanteMessagerie";

/**
 * D9 : les noms de clés lus ou envoyés par le poste viennent du contrat généré. Les directives `@ts-expect-error`
 * ci-dessous sont les essais négatifs : si une clé fausse était acceptée, la directive deviendrait inutile et `tsc`
 * (donc `pnpm build` et la CI, étape `typecheck`) échouerait.
 */
describe("contrat de l'API", () => {
  it("accepte les clés du contrat et refuse les autres, à la compilation", () => {
    const connue: Recu<"SanteCompte"> = { compte_id: "x", corps_indexes: 1 };
    // @ts-expect-error clé absente du contrat : une faute de frappe ou une clé renommée côté API doit casser tsc
    const inconnue: Recu<"SanteCompte"> = { compte_idx: "x" };
    assert.equal(Object.keys(connue).length, 2);
    assert.deepEqual(Object.keys(inconnue), ["compte_idx"]);
  });

  it("types exacts d'un corps de requête", () => {
    const action: CorpsRequete<"CreerActionRequest"> = { genre: "lu", idempotence_cle: "cle" };
    // @ts-expect-error `idempotence_cle` est obligatoire
    const sansCle: CorpsRequete<"CreerActionRequest"> = { genre: "lu" };
    assert.equal(action.genre, "lu");
    assert.equal(sansCle.genre, "lu");
  });

  it("un lecteur lit les noms du contrat (bout en bout sur la santé)", () => {
    const sante = lireSante({
      comptes: [{ compte_id: "c1", adresse: "a@b.fr", corps_indexes: 5, corps_restants: 2, corps_abandonnes: 1 }],
    });
    assert.equal(sante.comptes[0]?.compteId, "c1");
    assert.equal(sante.comptes[0]?.corpsIndexes, 5);
    assert.equal(sante.comptes[0]?.corpsRestants, 2);
    assert.equal(sante.comptes[0]?.corpsAbandonnes, 1);
  });
});
