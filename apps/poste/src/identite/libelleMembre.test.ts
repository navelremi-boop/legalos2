import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  identiteVide,
  indexerMembres,
  inviterACompleter,
  libelleDuMembre,
  libelleMembre,
  membresActifs,
  type LigneUtilisateur,
} from "./libelleMembre.ts";

const ligne = (id: string, reste: Partial<LigneUtilisateur>): LigneUtilisateur => ({
  id,
  email: null,
  civilite: null,
  prenom: null,
  nom: null,
  qualite: null,
  actif: 1,
  ...reste,
});

describe("libellé d'un membre du cabinet", () => {
  it("un avocat est « Me Prénom Nom »", () => {
    assert.equal(
      libelleMembre({ civilite: "monsieur", prenom: "Julien", nom: "Marchal", qualite: "avocat" }),
      "Me Julien Marchal",
    );
  });

  it("une avocate est « Me » comme un avocat, la civilité ne change rien", () => {
    assert.equal(
      libelleMembre({ civilite: "madame", prenom: "Claire", nom: "Roux", qualite: "avocat" }),
      "Me Claire Roux",
    );
    assert.equal(
      libelleMembre({ civilite: "madame", prenom: "Claire", nom: "Roux", qualite: "avocat_collaborateur" }),
      "Me Claire Roux",
    );
  });

  it("un avocat sans civilité est tout de même « Me »", () => {
    assert.equal(libelleMembre({ prenom: "Paul", nom: "Vidal", qualite: "avocat_collaborateur" }), "Me Paul Vidal");
  });

  it("un autre membre prend sa civilité : « Mme » ou « M. »", () => {
    assert.equal(
      libelleMembre({ civilite: "madame", prenom: "Inès", nom: "Garnier", qualite: "juriste" }),
      "Mme Inès Garnier",
    );
    assert.equal(
      libelleMembre({ civilite: "monsieur", prenom: "Hugo", nom: "Perrin", qualite: "assistant" }),
      "M. Hugo Perrin",
    );
    assert.equal(
      libelleMembre({ civilite: "madame", prenom: "Léa", nom: "Blanc", qualite: "autre" }),
      "Mme Léa Blanc",
    );
  });

  it("une qualité non saisie suit la civilité", () => {
    assert.equal(libelleMembre({ civilite: "monsieur", prenom: "Hugo", nom: "Perrin" }), "M. Hugo Perrin");
  });

  it("une civilité absente avec un nom donne « Prénom Nom » sans civilité", () => {
    assert.equal(libelleMembre({ prenom: "Hugo", nom: "Perrin", qualite: "juriste" }), "Hugo Perrin");
    assert.equal(libelleMembre({ civilite: "", prenom: "Hugo", nom: "Perrin", qualite: null }), "Hugo Perrin");
  });

  it("une civilité inconnue n'est pas reprise", () => {
    assert.equal(
      libelleMembre({ civilite: "docteur", prenom: "Hugo", nom: "Perrin", qualite: "juriste" }),
      "Hugo Perrin",
    );
  });

  it("sans identité, l'adresse e-mail seule, jamais une valeur déduite d'elle", () => {
    assert.equal(libelleMembre({ email: "demo@cabinet.example" }), "demo@cabinet.example");
    assert.equal(
      libelleMembre({ email: "jean.dupont@cabinet.example", civilite: "monsieur", qualite: "avocat" }),
      "jean.dupont@cabinet.example",
    );
    assert.equal(libelleMembre({ email: "  ", prenom: " ", nom: null }), "");
  });

  it("un prénom seul ou un nom seul se compose avec ce qui existe", () => {
    assert.equal(libelleMembre({ nom: "Marchal", qualite: "avocat" }), "Me Marchal");
    assert.equal(libelleMembre({ prenom: "Julien", civilite: "monsieur" }), "M. Julien");
  });

  it("rogne les espaces et ne touche pas à la casse saisie", () => {
    assert.equal(
      libelleMembre({ prenom: "  Jean-Paul ", nom: " de La  Fontaine ", qualite: "avocat" }),
      "Me Jean-Paul de La Fontaine",
    );
    assert.equal(libelleMembre({ prenom: "jean", nom: "DUPONT", qualite: "juriste" }), "jean DUPONT");
  });
});

describe("invitation « Complétez votre profil »", () => {
  it("s'affiche tant que prénom et nom sont vides", () => {
    assert.equal(inviterACompleter({ email: "demo@cabinet.example" }), true);
    assert.equal(inviterACompleter({ email: "a@b.example", civilite: "madame", qualite: "avocat" }), true);
    assert.equal(inviterACompleter({ prenom: "  ", nom: "" }), true);
    assert.equal(identiteVide({}), true);
  });

  it("disparaît dès qu'un prénom ou un nom est saisi", () => {
    assert.equal(inviterACompleter({ prenom: "Julien" }), false);
    assert.equal(inviterACompleter({ nom: "Marchal" }), false);
    assert.equal(inviterACompleter({ prenom: "Julien", nom: "Marchal", qualite: "avocat" }), false);
  });
});

describe("lecture depuis la table locale utilisateurs", () => {
  const lignes = [
    ligne("u1", { email: "a@c.example", civilite: "monsieur", prenom: "Julien", nom: "Marchal", qualite: "avocat" }),
    ligne("u2", { email: "b@c.example" }),
    ligne("u3", {
      email: "c@c.example",
      civilite: "madame",
      prenom: "Inès",
      nom: "Garnier",
      qualite: "juriste",
      actif: 0,
    }),
    ligne("u4", { email: "d@c.example", civilite: "madame", prenom: "Claire", nom: "Roux", qualite: "avocat" }),
  ];
  const index = indexerMembres(lignes);

  it("résout un identifiant d'auteur en libellé", () => {
    assert.equal(libelleDuMembre(index, "u1"), "Me Julien Marchal");
    assert.equal(libelleDuMembre(index, "u2"), "b@c.example");
  });

  it("ne rend rien pour un auteur inconnu ou absent", () => {
    assert.equal(libelleDuMembre(index, "inconnu"), null);
    assert.equal(libelleDuMembre(index, null), null);
  });

  it("ne garde que les membres actifs, par ordre alphabétique des libellés", () => {
    assert.deepEqual(
      membresActifs(lignes).map((membre) => membre.id),
      ["u2", "u4", "u1"],
    );
  });
});
