import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { champsFicheVides, libelleCapital, type ContactListe } from "./listeContacts.ts";
import type { LienAffiche } from "./liensContacts.ts";
import { accordDe, civiliteRefusee, designationActe } from "./designation.ts";

// Les montants et « Me » portent des espaces insécables : les comparaisons passent par des espaces ordinaires.
const lisible = (texte: string) => texte.replace(/[  ]/gu, " ");

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

const ANTOINE = fiche({
  id: "antoine",
  nature: "physique",
  civilite: "Monsieur",
  prenoms: "Antoine Louis",
  nom: "Ferrand",
  dateNaissance: "1972-02-03",
  lieuNaissance: "Saint-Étienne (Loire)",
  nationalite: "français",
  profession: "chef d'entreprise",
  adresseDomicile: "8 chemin des Vignes, 69290 Craponne",
});

const FERRAND_METAL = fiche({
  id: "ferrand",
  nature: "morale",
  nom: "Ferrand Métal",
  forme: "5710",
  capitalLibelle: libelleCapital(5_000_000, "EUR"),
  greffe: "RCS de Lyon",
  siren: "812345676",
  adresseSiege: "14 rue de la Forge, 69007 Lyon",
});

function mandatDe(societeId: string, fonction: string, personne: ContactListe): LienAffiche {
  return lienMandat({
    cibleId: societeId,
    fonction,
    sourceId: personne.id,
    sourceCivilite: personne.civilite,
    sourcePrenoms: personne.prenoms,
    sourceNom: personne.nom,
  });
}

describe("désignation dans les actes, personne physique", () => {
  it("déduit l'accord de Madame et de Monsieur, et le demande sinon", () => {
    assert.equal(accordDe("Madame", null), "feminin");
    assert.equal(accordDe("Monsieur", "feminin"), "masculin");
    assert.equal(accordDe("Maître", null), null);
    assert.equal(accordDe("Maître", "feminin"), "feminin");
    assert.equal(accordDe("Docteur", "masculin"), "masculin");
    assert.equal(civiliteRefusee("Mademoiselle"), true);
    assert.equal(accordDe("Mademoiselle", "feminin"), null);
  });

  it("écrit la désignation féminine : Mme, née, nom de naissance, de nationalité, demeurant, point final", () => {
    const acte = designationActe(PERSONNE);
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      acte.texte,
      "Mme Camille Martin, née Dupont le 14 mars 1980 à Lyon, de nationalité française, avocate, demeurant 12 rue des Lilas, 69001 Lyon.",
    );
  });

  it("écrit la désignation masculine, tous les prénoms, lieu avec département", () => {
    const acte = designationActe(ANTOINE);
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      acte.texte,
      "M. Antoine Louis Ferrand, né le 3 février 1972 à Saint-Étienne (Loire), de nationalité française, chef d'entreprise, demeurant 8 chemin des Vignes, 69290 Craponne.",
    );
  });

  it("omet le nom de naissance lorsqu'il ne diffère pas, et écrit 1er pour le premier du mois", () => {
    const acte = designationActe(
      fiche({
        ...ANTOINE,
        prenoms: "Antoine",
        nomNaissance: "Ferrand",
        dateNaissance: "1975-10-01",
        lieuNaissance: "Paris",
        profession: "ingénieur",
      }),
    );
    assert.equal(
      acte.texte,
      "M. Antoine Ferrand, né le 1er octobre 1975 à Paris, de nationalité française, ingénieur, demeurant 8 chemin des Vignes, 69290 Craponne.",
    );
  });

  it("écrit « de nationalité » au féminin pour un homme comme pour une femme, quelle que soit la saisie", () => {
    const cas: [string, string][] = [
      ["français", "française"],
      ["Française", "française"],
      ["italien", "italienne"],
      ["espagnol", "espagnole"],
      ["allemand", "allemande"],
      ["portugais", "portugaise"],
      ["turc", "turque"],
      ["belge", "belge"],
      ["britannique", "britannique"],
      ["franco-marocain", "franco-marocaine"],
      ["française et marocain", "française et marocaine"],
    ];
    for (const [saisie, attendu] of cas) {
      for (const personne of [PERSONNE, ANTOINE]) {
        const acte = designationActe(fiche({ ...personne, nationalite: saisie }));
        assert.equal(acte.texte.includes(`, de nationalité ${attendu}, `), true, `${saisie} pour ${personne.nom}`);
      }
    }
  });

  it("accorde « née » avec Maître et un accord féminin saisi, « né » avec un accord masculin", () => {
    const feminin = designationActe(fiche({ ...PERSONNE, civilite: "Maître", accordSaisi: "feminin" }));
    assert.equal(feminin.mentions.length, 0);
    assert.equal(feminin.texte.startsWith("Me Camille Martin, née Dupont le 14 mars 1980 à Lyon, "), true);
    const masculin = designationActe(
      fiche({ ...ANTOINE, civilite: "Maître", accordSaisi: "masculin", nomNaissance: null }),
    );
    assert.equal(masculin.texte.startsWith("Me Antoine Louis Ferrand, né le 3 février 1972 "), true);
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
    assert.equal(acte.texte.includes(" né "), false);
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

  it("nomme la seule profession absente et n'invente rien à sa place", () => {
    const acte = designationActe(fiche({ ...ANTOINE, profession: null }));
    assert.deepEqual(
      acte.mentions.map((mention) => mention.libelle),
      ["profession"],
    );
    assert.equal(acte.texte.includes("[profession]"), false);
  });

  it("refuse Mademoiselle et ne l'écrit pas", () => {
    const acte = designationActe(fiche({ ...PERSONNE, civilite: "Mademoiselle" }));
    assert.equal(
      acte.mentions.some((mention) => mention.libelle === "civilité"),
      true,
    );
    assert.equal(acte.texte.includes("Mademoiselle"), false);
  });
});

describe("désignation dans les actes, société", () => {
  const ANTOINE_REPRESENTANT = ANTOINE;
  const contexteFerrand = {
    liens: [mandatDe("ferrand", "president", ANTOINE_REPRESENTANT)],
    contacts: [ANTOINE_REPRESENTANT],
  };

  it("écrit la formule des sociétés de la maquette, prénom usuel et SIREN par groupes de trois", () => {
    const acte = designationActe(FERRAND_METAL, contexteFerrand);
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      lisible(acte.texte),
      "La société Ferrand Métal, société par actions simplifiée au capital de 50 000 €, immatriculée au registre du commerce et des sociétés de Lyon sous le numéro 812 345 676, dont le siège social est situé 14 rue de la Forge, 69007 Lyon, prise en la personne de son président en exercice, M. Antoine Ferrand, domicilié en cette qualité audit siège.",
    );
  });

  it("écrit la forme sans précision entre parenthèses et sans sigle en tête", () => {
    const sarl = designationActe(
      fiche({ ...FERRAND_METAL, nom: "AF Participations", forme: "5499", capitalLibelle: libelleCapital(1_000_000, "EUR") }),
      { liens: [mandatDe("ferrand", "gerant", ANTOINE)], contacts: [ANTOINE] },
    );
    assert.equal(
      lisible(sarl.texte).startsWith(
        "La société AF Participations, société à responsabilité limitée au capital de 10 000 €, immatriculée",
      ),
      true,
    );
    const sa = designationActe(fiche({ ...FERRAND_METAL, forme: "5599" }), contexteFerrand);
    assert.equal(lisible(sa.texte).includes(", SA à conseil d'administration au capital de 50 000 €,"), true);
  });

  it("garde les centimes du capital s'ils existent", () => {
    const acte = designationActe(fiche({ ...FERRAND_METAL, capitalLibelle: libelleCapital(1_000_050, "EUR") }), contexteFerrand);
    assert.equal(lisible(acte.texte).includes("société par actions simplifiée au capital de 10 000,50 €, "), true);
  });

  it("écrit le greffe sans « RCS de », avec l'élision et l'article contracté", () => {
    const cas: [string, string][] = [
      ["RCS de Lyon", "de Lyon"],
      ["Lyon", "de Lyon"],
      ["RCS d'Aix-en-Provence", "d'Aix-en-Provence"],
      ["Aix-en-Provence", "d'Aix-en-Provence"],
      ["RCS Le Mans", "du Mans"],
      ["Villefranche-Tarare", "de Villefranche-Tarare"],
    ];
    for (const [greffe, attendu] of cas) {
      const acte = designationActe(fiche({ ...FERRAND_METAL, greffe }), contexteFerrand);
      assert.equal(
        lisible(acte.texte).includes(`registre du commerce et des sociétés ${attendu} sous le numéro 812 345 676,`),
        true,
        greffe,
      );
    }
  });

  it("accorde au féminin : sa gérante, domiciliée", () => {
    const camille = fiche({ id: "anne", nature: "physique", civilite: "Madame", prenoms: "Camille Anne", nom: "Martin" });
    const societe = fiche({ ...FERRAND_METAL, id: "duclos", nom: "Duclos Industrie", forme: "5499" });
    const acte = designationActe(societe, {
      liens: [lienMandat({ fonction: "gerant" })],
      contacts: [camille],
    });
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      lisible(acte.texte).endsWith(
        "prise en la personne de sa gérante en exercice, Mme Camille Martin, domiciliée en cette qualité audit siège.",
      ),
      true,
    );
  });

  it("garde « son » pour une fonction qui ne change pas au féminin", () => {
    const camille = fiche({ id: "anne", nature: "physique", civilite: "Madame", prenoms: "Camille", nom: "Martin" });
    const societe = fiche({ ...FERRAND_METAL, id: "duclos" });
    const directoire = designationActe(societe, {
      liens: [lienMandat({ fonction: "membre_directoire" })],
      contacts: [camille],
    });
    assert.equal(
      lisible(directoire.texte).includes("prise en la personne de son membre du directoire en exercice, Mme Camille Martin, domiciliée"),
      true,
    );
    const generale = designationActe(societe, {
      liens: [lienMandat({ fonction: "directeur_general" })],
      contacts: [camille],
    });
    assert.equal(lisible(generale.texte).includes("prise en la personne de sa directrice générale en exercice,"), true);
  });

  it("une société exerçant une profession réglementée suit la formule des sociétés, pas celle d'une personne", () => {
    const garnier = fiche({ id: "ines", nature: "physique", civilite: "Madame", prenoms: "Inès", nom: "Garnier" });
    const rive = fiche({
      id: "rive",
      nature: "morale",
      nom: "Rive Gauche Expertise",
      forme: "5499",
      capitalLibelle: libelleCapital(2_000_000, "EUR"),
      greffe: "RCS de Lyon",
      siren: "837650118",
      adresseSiege: "31 cours Gambetta, 69003 Lyon",
      professionReglementee: true,
      professionCode: "expert_comptable",
    });
    const acte = designationActe(rive, { liens: [mandatDe("rive", "gerant", garnier)], contacts: [garnier] });
    assert.deepEqual(acte.mentions, []);
    assert.equal(
      lisible(acte.texte),
      "La société Rive Gauche Expertise, société à responsabilité limitée au capital de 20 000 €, immatriculée au registre du commerce et des sociétés de Lyon sous le numéro 837 650 118, dont le siège social est situé 31 cours Gambetta, 69003 Lyon, prise en la personne de sa gérante en exercice, Mme Inès Garnier, domiciliée en cette qualité audit siège.",
    );
    const sansRepresentant = designationActe(rive);
    assert.deepEqual(
      sansRepresentant.mentions.map((mention) => mention.libelle),
      ["organe représentant"],
    );
  });

  it("signale « organe représentant » pour une société sans mandat représentant, et arrête la désignation complète", () => {
    const sans = designationActe(FERRAND_METAL);
    assert.deepEqual(
      sans.mentions.map((mention) => mention.libelle),
      ["organe représentant"],
    );
    for (const liens of [
      [lienMandat({ cibleId: "ferrand", fonction: "president", fin: "2024-03-14" })],
      [lienMandat({ cibleId: "ferrand", fonction: "president", representeSociete: false })],
    ]) {
      const acte = designationActe(FERRAND_METAL, { liens, contacts: [ANTOINE] });
      assert.equal(
        acte.mentions.some((mention) => mention.libelle === "organe représentant"),
        true,
      );
      assert.equal(acte.texte.includes("Camille"), false);
    }
  });

  it("nomme la mention du représentant quand sa fiche est incomplète", () => {
    const incomplet = fiche({ id: "antoine", nature: "physique", nom: "Ferrand", civilite: "Monsieur" });
    const acte = designationActe(FERRAND_METAL, {
      liens: [mandatDe("ferrand", "president", incomplet)],
      contacts: [incomplet],
    });
    assert.deepEqual(
      acte.mentions.map((mention) => mention.libelle),
      ["prénoms"],
    );
  });

  it("nomme le capital, le greffe, le numéro et le siège absents d'une société", () => {
    const acte = designationActe(fiche({ nature: "morale", nom: "SCI Les Tilleuls" }));
    assert.deepEqual(
      acte.mentions.map((mention) => mention.libelle),
      ["forme", "capital", "greffe du RCS", "numéro du RCS", "adresse du siège", "organe représentant"],
    );
  });
});

describe("désignation dans les actes, professionnel", () => {
  it("écrit l'avocate au barreau et le commissaire de justice, avec Me", () => {
    const avocate = designationActe(
      fiche({
        ...PERSONNE,
        professionReglementee: true,
        professionCode: "avocat",
        barreau: "Lyon",
      }),
    );
    assert.deepEqual(avocate.mentions, []);
    assert.equal(avocate.texte, "Me Camille Martin, avocate au barreau de Lyon.");

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
    assert.equal(commissaire.texte, "Me Paul Renard, commissaire de justice.");
  });

  it("écrit l'élision du barreau et de la cour d'appel", () => {
    const avocat = designationActe(
      fiche({ ...ANTOINE, professionReglementee: true, professionCode: "avocat", barreau: "Aix-en-Provence" }),
    );
    assert.equal(avocat.texte, "Me Antoine Louis Ferrand, avocat au barreau d'Aix-en-Provence.");
    const expert = designationActe(
      fiche({
        ...ANTOINE,
        professionReglementee: true,
        professionCode: "expert_judiciaire",
        specialite: "bâtiment",
        courAppel: "Aix-en-Provence",
      }),
    );
    assert.equal(expert.texte, "M. Antoine Louis Ferrand, expert judiciaire, bâtiment, cour d'appel d'Aix-en-Provence.");
  });

  it("écrit l'experte-comptable avec sa civilité abrégée, pas Me", () => {
    const acte = designationActe(
      fiche({
        ...PERSONNE,
        professionReglementee: true,
        professionCode: "expert_comptable",
      }),
    );
    assert.deepEqual(acte.mentions, []);
    assert.equal(acte.texte, "Mme Camille Martin, experte-comptable.");
  });

  it("nomme le barreau absent d'un avocat", () => {
    const acte = designationActe(fiche({ ...PERSONNE, professionReglementee: true, professionCode: "avocat" }));
    assert.deepEqual(
      acte.mentions.map((mention) => mention.libelle),
      ["barreau"],
    );
  });
});
