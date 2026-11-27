import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, type ContactListe, type CoordonneeLue } from "./listeContacts.ts";
import { nomsParAdresse } from "./nomsAdresses.ts";

function contact(partiel: Partial<ContactListe> & Pick<ContactListe, "id" | "nature" | "nom">): ContactListe {
  return {
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: false,
    ...champsFicheVides(),
    ...partiel,
  };
}

function email(contactId: string, valeur: string): CoordonneeLue {
  return { contactId, genre: "email", usage: "travail", valeur, principale: true, creeLe: "2026-10-01" };
}

describe("noms des adresses de l'annuaire", () => {
  it("associe chaque adresse en minuscules au nom court de sa fiche", () => {
    const noms = nomsParAdresse(
      [
        contact({ id: "a", nature: "physique", nom: "Ferrand", civilite: "Monsieur", prenoms: "Antoine Louis" }),
        contact({ id: "s", nature: "morale", nom: "Ferrand Métal", forme: "5710" }),
      ],
      [
        email("a", "A.Ferrand@Example.test"),
        email("s", "direction@ferrand-metal.example"),
        { ...email("a", "0612345678"), genre: "telephone" },
        email("inconnu", "x@example.test"),
      ],
    );
    assert.equal(noms.get("a.ferrand@example.test"), "M. Antoine Ferrand");
    assert.equal(noms.get("direction@ferrand-metal.example"), "SAS Ferrand Métal");
    assert.equal(noms.has("0612345678"), false);
    assert.equal(noms.has("x@example.test"), false);
  });

  it("garde la première fiche quand une adresse est portée par deux fiches", () => {
    const noms = nomsParAdresse(
      [
        contact({ id: "a", nature: "physique", nom: "Ferrand", civilite: "Monsieur", prenoms: "Antoine" }),
        contact({ id: "b", nature: "physique", nom: "Ferrand", civilite: "Madame", prenoms: "Claire" }),
      ],
      [email("a", "famille@example.test"), email("b", "famille@example.test")],
    );
    assert.equal(noms.get("famille@example.test"), "M. Antoine Ferrand");
  });
});
