import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, type ContactListe } from "./listeContacts.ts";
import type { LienAffiche } from "./liensContacts.ts";
import { accordDe, civiliteRefusee, designationActe } from "./designation.ts";

function lienMandat(partiel: Partial<LienAffiche> & Pick<LienAffiche, "fonction">): LienAffiche {
  return {
    id: "lien",
    sourceId: "anne",
    cibleId: "duclos",
    sourceCivilite: "Madame",
    sourcePrenoms: "Camille",
    sourceNom: "Martin",
    cibleNom: "SARL Duclos Industrie",
    typeLien: "mandat_social",
    libelle: null,
    representeSociete: true,
    debut: "2018-06-01",
    fin: null,
    ...partiel,
  };
}

function fiche(partiel: Partial<ContactListe> & Pick<ContactListe, "nature" | "nom">): ContactListe {
  return {
    id: "fiche",
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: false,
    ...champsFicheVides(),
    ...partiel,
  };
}

const PERSONNE = fiche({
  nature: "physique",
  civilite: "Madame",
  prenoms: "Camille",
  nom: "Martin",
  nomNaissance: "Dupont",
  dateNaissance: "1980-03-14",
  lieuNaissance: "Lyon",
  nationalite: "française",
  profession: "avocate",
  adresseDomicile: "12 rue des Lilas, 69001 Lyon",
});

describe("désignation dans les actes", () => {
  it("déduit l'accord de Madame et de Monsieur, et le demande sinon", () => {
    assert.equal(accordDe("Madame", null), "feminin");
    assert.equal(accordDe("Monsieur", "feminin"), "masculin");
    assert.equal(accordDe("Maître", null), null);
    assert.equal(accordDe("Maître", "feminin"), "feminin");
    assert.equal(accordDe("Docteur", "masculin"), "masculin");
    assert.equal(civiliteRefusee("Mademoiselle"), true);
    assert.equal(accordDe("Mademoiselle", "feminin"), null);
  });

  it("écrit la désignation féminine, nom de naissance compris", () => {
    const acte = designationActe(PERSONNE);
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      acte.texte,
      "Madame Camille Martin, née Dupont le 14 mars 1980 à Lyon, française, avocate, 12 rue des Lilas, 69001 Lyon",
    );
  });

  it("omet le nom de naissance lorsqu'il ne diffère pas, au masculin, 1er du mois", () => {
    const acte = designationActe(
      fiche({
        nature: "physique",
        civilite: "Monsieur",
        prenoms: "Antoine",
        nom: "Ferrand",
        nomNaissance: "Ferrand",
        dateNaissance: "1975-10-01",
        lieuNaissance: "Paris",
        nationalite: "français",
        profession: "ingénieur",
        adresseDomicile: "4 place Bellecour, 69002 Lyon",
      }),
    );
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      acte.texte,
      "Monsieur Antoine Ferrand, né le 1er octobre 1975 à Paris, français, ingénieur, 4 place Bellecour, 69002 Lyon",
    );
  });

  it("nomme l'accord grammatical quand la civilité ne le déduit pas", () => {
    const acte = designationActe(
      fiche({
        ...PERSONNE,
        civilite: "Maître",
        accordSaisi: null,
      }),
    );
    assert.equal(
      acte.mentions.some((mention) => mention.libelle === "accord grammatical"),
      true,
    );
    assert.equal(acte.texte.includes("née"), false);
    assert.equal(acte.texte.includes("né"), false);
  });

  it("nomme chaque mention absente d'une personne", () => {
    const acte = designationActe(fiche({ nature: "physique", nom: "Martin" }));
    assert.deepEqual(
      acte.mentions.map((mention) => mention.libelle),
      [
        "civilité",
        "prénoms",
        "date de naissance",
        "lieu de naissance",
        "nationalité",
        "profession",
        "adresse du domicile principal",
      ],
    );
  });

  it("refuse Mademoiselle et ne l'écrit pas", () => {
    const acte = designationActe(fiche({ ...PERSONNE, civilite: "Mademoiselle" }));
    assert.equal(
      acte.mentions.some((mention) => mention.libelle === "civilité"),
      true,
    );
    assert.equal(acte.texte.includes("Mademoiselle"), false);
  });

  it("écrit la société depuis le mandat en cours qui représente la société", () => {
    const societe = fiche({
      id: "duclos",
      nature: "morale",
      nom: "SARL Duclos Industrie",
      forme: "société à responsabilité limitée",
      capitalLibelle: "au capital de 10 000 €",
      greffe: "RCS de Lyon",
      siren: "123456789",
      adresseSiege: "8 quai Saint-Vincent, 69001 Lyon",
    });
    const camille = fiche({
      id: "anne",
      nature: "physique",
      civilite: "Madame",
      prenoms: "Camille",
      nom: "Martin",
    });
    const mandat = lienMandat({ fonction: "gerant", fin: null });
    const acte = designationActe(societe, { liens: [mandat], contacts: [camille] });
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      acte.texte,
      "SARL Duclos Industrie, société à responsabilité limitée, au capital de 10 000 €, RCS de Lyon, numéro 123456789, 8 quai Saint-Vincent, 69001 Lyon, prise en la personne de son gérante en exercice, Madame Camille Martin, domiciliée en cette qualité audit siège",
    );

    const termine = designationActe(societe, {
      liens: [lienMandat({ fonction: "gerant", fin: "2024-03-14" })],
      contacts: [camille],
    });
    assert.equal(
      termine.mentions.some((mention) => mention.libelle === "organe représentant"),
      true,
    );
    assert.equal(termine.texte.includes("Camille"), false);

    const sansMarque = designationActe(societe, {
      liens: [lienMandat({ fonction: "gerant", representeSociete: false })],
      contacts: [camille],
    });
    assert.equal(
      sansMarque.mentions.some((mention) => mention.libelle === "organe représentant"),
      true,
    );

    const president = designationActe(societe, {
      liens: [
        lienMandat({
          fonction: "president",
          sourceId: "antoine",
          sourceCivilite: "Monsieur",
          sourcePrenoms: "Antoine",
          sourceNom: "Ferrand",
        }),
      ],
      contacts: [
        fiche({
          id: "antoine",
          nature: "physique",
          civilite: "Monsieur",
          prenoms: "Antoine",
          nom: "Ferrand",
        }),
      ],
    });
    assert.equal(
      president.texte.endsWith(
        "prise en la personne de son président en exercice, Monsieur Antoine Ferrand, domicilié en cette qualité audit siège",
      ),
      true,
    );
  });

  it("nomme le capital absent d'une société", () => {
    const acte = designationActe(fiche({ nature: "morale", nom: "SCI Les Tilleuls" }));
    assert.equal(
      acte.mentions.some((mention) => mention.libelle === "capital"),
      true,
    );
  });

  it("écrit l'avocate au barreau et le commissaire de justice", () => {
    const avocate = designationActe(
      fiche({
        ...PERSONNE,
        professionReglementee: true,
        professionCode: "avocat",
        barreau: "Lyon",
      }),
    );
    assert.deepEqual(avocate.mentions, []);
    assert.equal(avocate.texte, "Me Camille Martin, avocate au barreau de Lyon");

    const commissaire = designationActe(
      fiche({
        nature: "physique",
        civilite: "Monsieur",
        prenoms: "Paul",
        nom: "Renard",
        professionReglementee: true,
        professionCode: "commissaire_justice",
      }),
    );
    assert.deepEqual(commissaire.mentions, []);
    assert.equal(commissaire.texte, "Me Paul Renard, commissaire de justice");
  });

  it("écrit l'experte-comptable avec sa civilité, pas Me", () => {
    const acte = designationActe(
      fiche({
        ...PERSONNE,
        professionReglementee: true,
        professionCode: "expert_comptable",
      }),
    );
    assert.deepEqual(acte.mentions, []);
    assert.equal(acte.texte, "Madame Camille Martin, experte-comptable");
  });
});
