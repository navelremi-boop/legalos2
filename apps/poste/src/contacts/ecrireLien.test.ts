import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creerFicheEtLien, creerLien, modifierLien, SOURCE_REGISTRE, type BaseLiens, type LienAEcrire } from "./ecrireLien.ts";

type Ecriture = { sql: string; valeurs: unknown[] };

/** Base locale fictive : mémorise les écritures, dans l'ordre, et le nombre de transactions. */
function baseFictive(cabinet = true) {
  const ecritures: Ecriture[] = [];
  const transactions: Ecriture[][] = [];
  const base: BaseLiens = {
    getAll: ((sql: string) => {
      if (sql.includes("FROM cabinets")) return Promise.resolve(cabinet ? [{ id: "cabinet-1" }] : []);
      return Promise.resolve([]);
    }) as BaseLiens["getAll"],
    writeTransaction: ((travail: (tx: { execute: (sql: string, valeurs: unknown[]) => Promise<void> }) => Promise<unknown>) => {
      const courante: Ecriture[] = [];
      transactions.push(courante);
      return travail({
        execute: (sql, valeurs) => {
          ecritures.push({ sql, valeurs });
          courante.push({ sql, valeurs });
          return Promise.resolve();
        },
      });
    }) as unknown as BaseLiens["writeTransaction"],
  };
  return { base, ecritures, transactions };
}

const MANDAT: LienAEcrire = {
  sourceId: "dirigeant",
  cibleId: "societe",
  typeLien: "mandat_social",
  fonction: "gerant",
  libelle: null,
  representeSociete: true,
  debut: "2020-01-01",
  fin: null,
  source: "Kbis",
  note: null,
};

describe("écriture locale d'un lien", () => {
  it("insère le lien dans contact_liens avec la représentation en 0 ou 1", async () => {
    const { base, ecritures } = baseFictive();
    const id = await creerLien(base, MANDAT, new Date("2026-11-20T10:00:00.000Z"));
    assert.equal(ecritures.length, 1);
    const ecriture = ecritures[0];
    assert.ok(ecriture?.sql.includes("INSERT INTO contact_liens"));
    assert.deepEqual(ecriture?.valeurs, [
      id,
      "cabinet-1",
      "dirigeant",
      "societe",
      "mandat_social",
      "gerant",
      null,
      1,
      "2020-01-01",
      null,
      "Kbis",
      null,
      "2026-11-20T10:00:00.000Z",
    ]);
  });

  it("refuse d'écrire sans cabinet synchronisé", async () => {
    const { base, ecritures } = baseFictive(false);
    await assert.rejects(() => creerLien(base, MANDAT), /Aucun cabinet synchronisé/);
    assert.equal(ecritures.length, 0);
  });
});

describe("fiche du dirigeant et lien vers la société", () => {
  it("écrit la fiche puis le lien dans une seule transaction, la fiche d'abord", async () => {
    const { base, transactions } = baseFictive();
    const { contactId, lienId } = await creerFicheEtLien(
      base,
      { nature: "physique", nom: " Renard ", prenoms: "Paul", siren: null },
      { ...MANDAT, cibleId: "societe" },
      new Date("2026-11-20T10:00:00.000Z"),
    );
    assert.equal(transactions.length, 1);
    const [fiche, lien] = transactions[0] ?? [];
    assert.ok(fiche?.sql.includes("INSERT INTO contacts"));
    assert.ok(lien?.sql.includes("INSERT INTO contact_liens"));
    assert.equal(fiche?.valeurs[0], contactId);
    assert.equal(fiche?.valeurs[3], "Renard");
    assert.equal(fiche?.valeurs[4], "Paul");
    assert.equal(fiche?.valeurs[6], "particulier");
    assert.equal(fiche?.valeurs[7], SOURCE_REGISTRE);
    assert.equal(lien?.valeurs[0], lienId);
    // Le lien part de la fiche qui vient d'être créée, vers la société.
    assert.equal(lien?.valeurs[2], contactId);
    assert.equal(lien?.valeurs[3], "societe");
  });

  it("une société dirigeante garde son SIREN de neuf chiffres et le type professionnel", async () => {
    const { base, transactions } = baseFictive();
    await creerFicheEtLien(
      base,
      { nature: "morale", nom: "Holding Exemple", prenoms: null, siren: "100 000 009" },
      { ...MANDAT, typeLien: "mandat_social", fonction: "president", representeSociete: false },
    );
    const fiche = transactions[0]?.[0];
    assert.equal(fiche?.valeurs[5], "100000009");
    assert.equal(fiche?.valeurs[6], "professionnel");
    assert.equal(fiche?.valeurs[4], null);
  });

  it("refuse un dirigeant sans nom, sans rien écrire", async () => {
    const { base, ecritures } = baseFictive();
    await assert.rejects(
      () => creerFicheEtLien(base, { nature: "physique", nom: "  ", prenoms: null, siren: null }, MANDAT),
      /Nom du dirigeant requis/,
    );
    assert.equal(ecritures.length, 0);
  });
});

describe("modification locale d'un lien", () => {
  it("pose la date de fin seule", async () => {
    const { base, ecritures } = baseFictive();
    assert.equal(await modifierLien(base, "l1", { fin: "2025-06-30" }), true);
    assert.deepEqual(ecritures, [{ sql: "UPDATE contact_liens SET fin = ? WHERE id = ?", valeurs: ["2025-06-30", "l1"] }]);
  });

  it("efface une valeur par null et ne touche que les champs donnés", async () => {
    const { base, ecritures } = baseFictive();
    await modifierLien(base, "l1", { fin: null, source: "Statuts" });
    assert.deepEqual(ecritures, [
      { sql: "UPDATE contact_liens SET fin = ?, source = ? WHERE id = ?", valeurs: [null, "Statuts", "l1"] },
    ]);
  });

  it("n'écrit rien quand rien ne change", async () => {
    const { base, ecritures } = baseFictive();
    assert.equal(await modifierLien(base, "l1", {}), false);
    assert.equal(ecritures.length, 0);
  });
});
