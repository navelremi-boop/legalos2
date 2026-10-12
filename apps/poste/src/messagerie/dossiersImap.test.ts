import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dossierImap } from "./dossiersImap.ts";

describe("dossierImap : noms français des dossiers IMAP", () => {
  const cas: [string, string, string][] = [
    ["INBOX", "reception", "Boîte de réception"],
    ["inbox", "reception", "Boîte de réception"],
    ["Sent", "envoyes", "Envoyés"],
    ["Envoyés", "envoyes", "Envoyés"],
    ["Éléments envoyés", "envoyes", "Envoyés"],
    ["Sent Items", "envoyes", "Envoyés"],
    ["INBOX.Sent", "envoyes", "Envoyés"],
    ["[Gmail]/Sent Mail", "envoyes", "Envoyés"],
    ["Drafts", "brouillons", "Brouillons"],
    ["Brouillons", "brouillons", "Brouillons"],
    ["INBOX/Drafts", "brouillons", "Brouillons"],
    ["Archive", "archives", "Archives"],
    ["Archives", "archives", "Archives"],
    ["[Gmail]/All Mail", "archives", "Archives"],
    ["Trash", "corbeille", "Corbeille"],
    ["Corbeille", "corbeille", "Corbeille"],
    ["Deleted Items", "corbeille", "Corbeille"],
    ["Junk", "indesirables", "Courrier indésirable"],
    ["Spam", "indesirables", "Courrier indésirable"],
    ["Junk E-mail", "indesirables", "Courrier indésirable"],
  ];
  for (const [nom, cle, libelle] of cas) {
    it(`${nom} devient « ${libelle} »`, () => {
      const dossier = dossierImap(nom);
      assert.equal(dossier.cle, cle);
      assert.equal(dossier.libelle, libelle);
      assert.equal(dossier.connu, true);
    });
  }

  it("un nom absent ou vide est la boîte de réception", () => {
    assert.equal(dossierImap(null).cle, "reception");
    assert.equal(dossierImap(undefined).libelle, "Boîte de réception");
    assert.equal(dossierImap("   ").cle, "reception");
  });

  it("un dossier inconnu garde son nom, sans le chemin qui le précède", () => {
    const dossier = dossierImap("INBOX.Clients");
    assert.equal(dossier.libelle, "Clients");
    assert.equal(dossier.connu, false);
  });

  it("essai négatif : aucun libellé français ne reste un nom IMAP brut", () => {
    for (const [nom] of cas) {
      const { libelle } = dossierImap(nom);
      assert.doesNotMatch(libelle, /^(INBOX|Sent|Drafts|Trash|Junk|Spam|Archive)$/u);
    }
  });
});
