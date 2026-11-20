import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexerMembres, type LigneUtilisateur } from "../identite/libelleMembre.ts";
import { notesAffichees, signatureNote, type NoteLue } from "./signatureNote.ts";

const membre = (id: string, reste: Partial<LigneUtilisateur>): LigneUtilisateur => ({
  id,
  email: `${id}@cabinet.example`,
  civilite: null,
  prenom: null,
  nom: null,
  qualite: null,
  actif: 1,
  ...reste,
});

const MEMBRES = indexerMembres([
  membre("julien", { civilite: "monsieur", prenom: "Julien", nom: "Marchal", qualite: "avocat" }),
  membre("ines", { civilite: "madame", prenom: "Inès", nom: "Garnier", qualite: "juriste" }),
  membre("demo", {}),
]);

const note = (reste: Partial<NoteLue>): NoteLue => ({
  id: "n1",
  texte: "Joignable le matin.",
  auteur_id: "julien",
  modifie_le: "2026-10-14T09:12:00.000Z",
  cree_le: "2026-10-02T09:12:00.000Z",
  ...reste,
});

describe("signature d'une note", () => {
  it("nomme l'auteur par le module de libellé et écrit la date en toutes lettres", () => {
    assert.equal(signatureNote(note({}), MEMBRES), "Modifié par Me Julien Marchal le 14 octobre 2026");
    assert.equal(
      signatureNote(note({ auteur_id: "ines" }), MEMBRES),
      "Modifié par Mme Inès Garnier le 14 octobre 2026",
    );
  });

  it("un auteur sans identité est nommé par son adresse e-mail", () => {
    assert.equal(
      signatureNote(note({ auteur_id: "demo" }), MEMBRES),
      "Modifié par demo@cabinet.example le 14 octobre 2026",
    );
  });

  it("compte la date au jour civil de Paris", () => {
    assert.equal(
      signatureNote(note({ modifie_le: "2026-10-14T23:30:00.000Z" }), MEMBRES),
      "Modifié par Me Julien Marchal le 15 octobre 2026",
    );
    assert.equal(
      signatureNote(note({ modifie_le: "2026-11-01T08:00:00+00" }), MEMBRES),
      "Modifié par Me Julien Marchal le 1er novembre 2026",
    );
  });

  it("n'invente aucun nom : auteur inconnu ou note antérieure à l'identité", () => {
    assert.equal(signatureNote(note({ auteur_id: "parti" }), MEMBRES), "Modifié le 14 octobre 2026");
    assert.equal(signatureNote(note({ auteur_id: null }), MEMBRES), "Modifié le 14 octobre 2026");
  });

  it("retombe sur la date de création, puis sur rien", () => {
    assert.equal(
      signatureNote(note({ modifie_le: null }), MEMBRES),
      "Modifié par Me Julien Marchal le 2 octobre 2026",
    );
    assert.equal(signatureNote(note({ modifie_le: null, cree_le: null }), MEMBRES), "Modifié par Me Julien Marchal");
    assert.equal(signatureNote(note({ auteur_id: null, modifie_le: null, cree_le: null }), MEMBRES), null);
  });

  it("compose les notes d'une fiche avec leur signature", () => {
    const notes = notesAffichees(
      [note({ id: "a" }), note({ id: "b", auteur_id: "ines", modifie_le: "2026-10-15T08:00:00.000Z" })],
      MEMBRES,
    );
    assert.deepEqual(
      notes.map((entree) => [entree.id, entree.signature]),
      [
        ["a", "Modifié par Me Julien Marchal le 14 octobre 2026"],
        ["b", "Modifié par Mme Inès Garnier le 15 octobre 2026"],
      ],
    );
  });
});
