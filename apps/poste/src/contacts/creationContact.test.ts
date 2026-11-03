import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifierSirenTva } from "../dossiers/identifiants.ts";
import {
  analyserAdresse,
  assemblerAdresse,
  capitalEnCentimes,
  champsDepuisProposition,
  communeRetenue,
  controleSiren,
  doublonSiren,
  optionsCommune,
  optionsForme,
  professionsCreation,
  tvaCalculee,
} from "./creationContact.ts";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";

function societe(id: string, nom: string, siren: string | null): ContactListe {
  return {
    id,
    nature: "morale",
    nom,
    siren,
    numeroTva: null,
    typeClient: "professionnel",
    professionReglementee: false,
    ...champsFicheVides(),
  };
}

describe("SIREN du formulaire de création", () => {
  it("refuse un numéro qui ne compte pas neuf chiffres, puis une clé de contrôle fausse", () => {
    assert.equal(controleSiren("8123"), "Un numéro SIREN compte 9 chiffres.");
    assert.equal(controleSiren(""), "Un numéro SIREN compte 9 chiffres.");
    assert.match(controleSiren("123456789") ?? "", /clé de contrôle/);
    assert.equal(controleSiren("812 345 676"), null);
  });

  it("calcule un numéro de TVA que la vérification de l'API accepte", () => {
    const tva = tvaCalculee("812 345 676");
    assert.ok(tva !== null && /^FR\d{11}$/u.test(tva));
    assert.doesNotThrow(() => {
      verifierSirenTva("812345676", tva);
    });
    assert.equal(tvaCalculee("123456789"), null);
    assert.equal(tvaCalculee("8123"), null);
  });

  it("repère la société déjà présente, sans se soucier des espaces", () => {
    const contacts = [societe("a", "Ferrand Métal", "812345676"), societe("b", "Autre", null)];
    assert.equal(doublonSiren("812 345 676", contacts)?.id, "a");
    assert.equal(doublonSiren("100000009", contacts), null);
    assert.equal(doublonSiren("8123", contacts), null);
  });
});

describe("adresse du formulaire de création", () => {
  it("sépare la voie, le code postal et la commune", () => {
    assert.deepEqual(analyserAdresse("8 QUAI SAINT-VINCENT 69001 LYON"), {
      voie: "8 QUAI SAINT-VINCENT",
      codePostal: "69001",
      commune: "LYON",
    });
    assert.deepEqual(analyserAdresse("12 rue du 8 mai 1945, 69003 Lyon"), {
      voie: "12 rue du 8 mai 1945",
      codePostal: "69003",
      commune: "Lyon",
    });
    assert.deepEqual(analyserAdresse("Rue sans code"), { voie: "Rue sans code", codePostal: "", commune: "" });
    assert.deepEqual(analyserAdresse(""), { voie: "", codePostal: "", commune: "" });
  });

  it("assemble l'adresse sur une ligne, ou rien si rien n'est saisi", () => {
    assert.equal(
      assemblerAdresse({ voie: "47 rue Paul Bert", codePostal: "69003", commune: "Lyon" }),
      "47 rue Paul Bert, 69003 Lyon",
    );
    assert.equal(assemblerAdresse({ voie: "", codePostal: "69003", commune: "" }), "69003");
    assert.equal(assemblerAdresse({ voie: " ", codePostal: "", commune: "" }), null);
  });

  it("propose les communes du code postal et garde celle du registre", () => {
    assert.deepEqual(optionsCommune("69001", ""), ["LYON 01"]);
    assert.deepEqual(optionsCommune("69001", "LYON"), ["LYON 01"]);
    assert.deepEqual(optionsCommune("69001", "Ailleurs"), ["Ailleurs", "LYON 01"]);
    assert.deepEqual(optionsCommune("690", ""), []);
    assert.deepEqual(optionsCommune("00000", "Quelque part"), []);
    assert.equal(communeRetenue("69001", ""), "LYON 01");
    assert.equal(communeRetenue("69001", "Lyon"), "LYON 01");
    assert.equal(communeRetenue("00000", " Quelque part "), "Quelque part");
  });
});

describe("proposition du registre dans le formulaire", () => {
  it("remplit les champs et laisse vides ceux que le registre ne donne pas", () => {
    const champs = champsDepuisProposition({
      siren: "903417566",
      denomination: "FERRAND LOGISTIQUE",
      forme: "5499",
      adresseSiege: "5 AVENUE DE L'INDUSTRIE 69800 SAINT-PRIEST",
      activite: "49.41A",
    });
    assert.equal(champs.denomination, "FERRAND LOGISTIQUE");
    assert.equal(champs.forme, "5499");
    assert.equal(champs.voie, "5 AVENUE DE L'INDUSTRIE");
    assert.equal(champs.codePostal, "69800");
    assert.equal(champs.commune, "SAINT-PRIEST");
    assert.equal(champs.activite, "49.41A");
    const vide = champsDepuisProposition({
      siren: "903417566",
      denomination: null,
      forme: null,
      adresseSiege: null,
      activite: null,
    });
    assert.deepEqual(vide, { denomination: "", forme: "", voie: "", codePostal: "", commune: "", activite: "" });
  });
});

describe("formes et professions proposées", () => {
  it("ajoute en tête la forme du registre quand elle n'est pas courante", () => {
    assert.equal(optionsForme("")[0]?.code, "5710");
    assert.equal(optionsForme("5710").length, optionsForme("").length);
    assert.equal(optionsForme("5785")[0]?.code, "5785");
  });

  it("propose les professions de la maquette, sans commissaire aux comptes", () => {
    const codes = professionsCreation().map((profession) => profession.code);
    assert.equal(codes.length, 7);
    assert.ok(codes.includes("avocat") && codes.includes("expert_comptable"));
    assert.ok(!codes.includes("commissaire_comptes"));
  });
});

describe("capital du formulaire de création", () => {
  it("accepte des euros entiers avec espaces de milliers, refuse le reste", () => {
    assert.equal(capitalEnCentimes(""), null);
    assert.equal(capitalEnCentimes("50 000"), 5_000_000);
    assert.equal(capitalEnCentimes("50 000"), 5_000_000);
    assert.throws(() => capitalEnCentimes("50,5"), /euros entiers/);
    assert.throws(() => capitalEnCentimes("beaucoup"), /euros entiers/);
  });
});
