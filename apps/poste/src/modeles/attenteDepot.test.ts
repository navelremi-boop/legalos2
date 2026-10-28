import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lireAttente, memoriserAttente, oublierAttente } from "./attenteDepot.ts";

function memoire(): Storage {
  const donnees = new Map<string, string>();
  return {
    get length() {
      return donnees.size;
    },
    clear() {
      donnees.clear();
    },
    getItem(cle: string) {
      return donnees.get(cle) ?? null;
    },
    key(index: number) {
      return [...donnees.keys()][index] ?? null;
    },
    removeItem(cle: string) {
      donnees.delete(cle);
    },
    setItem(cle: string, valeur: string) {
      donnees.set(cle, valeur);
    },
  };
}

describe("file des documents produits hors ligne", () => {
  it("retient un dépôt puis l'oublie une fois versé", () => {
    const stock = memoire();
    memoriserAttente(stock, {
      documentId: "doc-1",
      dossierId: "dos-1",
      nom: "Courrier.docx",
      empreinte: "ab",
      chemin: "cache/Courrier.docx",
    });
    assert.equal(lireAttente(stock).length, 1);
    oublierAttente(stock, "doc-1");
    assert.deepEqual(lireAttente(stock), []);
  });

  it("ne double pas le même document", () => {
    const stock = memoire();
    const entree = {
      documentId: "doc-1",
      dossierId: "dos-1",
      nom: "Acte.docx",
      empreinte: "cd",
      chemin: "cache/Acte.docx",
    };
    memoriserAttente(stock, entree);
    memoriserAttente(stock, { ...entree, empreinte: "ef" });
    const liste = lireAttente(stock);
    assert.equal(liste.length, 1);
    assert.equal(liste[0]?.empreinte, "ef");
  });
});
