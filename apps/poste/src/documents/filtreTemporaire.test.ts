import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estFichierIgnorePourVersion } from "./filtreTemporaire.ts";

describe("estFichierIgnorePourVersion", () => {
  it("ignore les verrous Word ~$", () => {
    assert.equal(estFichierIgnorePourVersion("~$conclusions.docx"), true);
    assert.equal(estFichierIgnorePourVersion("C:\\cache\\~$note.docx"), true);
  });

  it("ignore .tmp et .asd", () => {
    assert.equal(estFichierIgnorePourVersion("brouillon.tmp"), true);
    assert.equal(estFichierIgnorePourVersion("piece.ASD"), true);
  });

  it("ignore AutoRecovery", () => {
    assert.equal(estFichierIgnorePourVersion("AutoRecovery save of note.asd"), true);
    assert.equal(estFichierIgnorePourVersion("fichierAutoRecovery.docx"), true);
  });

  it("laisse passer un document nominal", () => {
    assert.equal(estFichierIgnorePourVersion("conclusions.docx"), false);
    assert.equal(estFichierIgnorePourVersion("piece.pdf"), false);
  });
});
