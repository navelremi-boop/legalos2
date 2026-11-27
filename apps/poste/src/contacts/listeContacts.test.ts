import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliquerCoordonnees,
  contactsProposables,
  compteursFiltres,
  filtrerContacts,
  grouperAlphabetique,
  initialesListeContact,
  libelleCapital,
  libelleListeContact,
  metaListeContact,
  natureEtiquetteFiche,
  ongletsFiche,
  sirenListeContact,
  sousTitreFiche,
  tronquerGroupes,
  type ContactListe,
} from "./listeContacts.ts";
import { formatMontantRond } from "../lib/format.ts";

function contact(partiel: Partial<ContactListe> & Pick<ContactListe, "id" | "nom" | "nature">): ContactListe {
  return {
    siren: null,
    numeroTva: null,
    typeClient: "professionnel",
    professionReglementee: false,
    civilite: null,
    accordSaisi: null,
    prenoms: null,
    nomNaissance: null,
    dateNaissance: null,
    lieuNaissance: null,
    nationalite: null,
    profession: null,
    adresseDomicile: null,
    forme: null,
    capitalLibelle: null,
    greffe: null,
    adresseSiege: null,
    activite: null,
    representant: null,
    professionCode: null,
    barreau: null,
    specialite: null,
    courAppel: null,
    ...partiel,
    situationFamiliale: partiel.situationFamiliale ?? null,
    capitalCentimes: partiel.capitalCentimes ?? null,
    monnaie: partiel.monnaie ?? null,
    toque: partiel.toque ?? null,
  };
}

const JEU: ContactListe[] = [
  contact({ id: "1", nom: "Morel", nature: "physique" }),
  contact({ id: "2", nom: "Martin", nature: "physique", professionReglementee: true }),
  contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale", siren: "123 456 789" }),
  contact({ id: "4", nom: "Étienne Blanc", nature: "physique" }),
];

describe("liste des contacts", () => {
  it("filtre les personnes, les sociétés et les professions", () => {
    assert.deepEqual(
      filtrerContacts(JEU, "personnes", "").map((ligne) => ligne.id),
      ["1", "2", "4"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "societes", "").map((ligne) => ligne.id),
      ["3"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "professions", "").map((ligne) => ligne.id),
      ["2"],
    );
  });

  it("cherche le nom sans accent et le SIREN sans espaces", () => {
    assert.deepEqual(
      filtrerContacts(JEU, "tous", "etienne").map((ligne) => ligne.id),
      ["4"],
    );
    assert.deepEqual(
      filtrerContacts(JEU, "tous", "123456789").map((ligne) => ligne.id),
      ["3"],
    );
  });

  it("regroupe par lettre après un tri français", () => {
    const groupes = grouperAlphabetique(filtrerContacts(JEU, "tous", ""));
    assert.deepEqual(
      groupes.map((groupe) => [groupe.lettre, groupe.contacts.map((ligne) => ligne.nom)]),
      [
        ["É", ["Étienne Blanc"]],
        ["M", ["Martin", "Morel"]],
        ["S", ["SARL Duclos Industrie"]],
      ],
    );
  });

  it("compte chaque filtre sur le jeu entier", () => {
    assert.deepEqual(compteursFiltres(JEU), {
      tous: 4,
      personnes: 3,
      societes: 1,
      professions: 1,
    });
  });

  it("reprend l'adresse principale du domicile et du siège", () => {
    const avecAdresse = appliquerCoordonnees(
      [contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })],
      [
        {
          contactId: "3",
          genre: "adresse",
          usage: "siege",
          valeur: "8 quai Saint-Vincent",
          principale: true,
          creeLe: "2026-10-30T12:00:00Z",
        },
        {
          contactId: "3",
          genre: "adresse",
          usage: "domicile",
          valeur: "ignorée",
          principale: false,
          creeLe: "2026-10-01T00:00:00Z",
        },
      ],
    );
    assert.equal(avecAdresse[0]?.adresseSiege, "8 quai Saint-Vincent");
    assert.equal(avecAdresse[0]?.adresseDomicile, null);
  });

  it("ne propose plus une fiche archivée à la saisie", () => {
    const proposables = contactsProposables([
      contact({ id: "1", nom: "Morel", nature: "physique" }),
      contact({ id: "2", nom: "Archivé", nature: "physique", archivee: true }),
    ]);
    assert.deepEqual(proposables.map((fiche) => fiche.id), ["1"]);
  });

  it("compose l'étiquette de nature pour la fiche", () => {
    assert.equal(natureEtiquetteFiche(contact({ id: "1", nom: "Martin", nature: "physique" })), "Personne physique");
    assert.equal(
      natureEtiquetteFiche(
        contact({
          id: "1",
          nom: "Martin",
          nature: "physique",
          professionCode: "avocat",
          professionReglementee: true,
        }),
      ),
      "Personne physique, avocat",
    );
    assert.equal(
      natureEtiquetteFiche(
        contact({
          id: "2",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
        }),
      ),
      "Personne physique, avocate",
    );
    assert.equal(
      natureEtiquetteFiche(contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })),
      "Personne morale",
    );
  });

  it("compose le libellé, les initiales et la meta de la liste", () => {
    assert.equal(
      libelleListeContact(contact({ id: "1", nom: "Martin", nature: "physique", civilite: "Madame", prenoms: "Camille" })),
      "Camille Martin",
    );
    assert.equal(
      libelleListeContact(
        contact({ id: "2", nom: "Ferrand", nature: "physique", civilite: "Monsieur", prenoms: "Antoine Louis" }),
      ),
      "Antoine Ferrand",
    );
    assert.equal(
      libelleListeContact(contact({ id: "4", nom: "Perrin", nature: "physique", civilite: "Maître", prenoms: "Anne" })),
      "Me Anne Perrin",
    );
    assert.equal(
      metaListeContact(
        contact({
          id: "4",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
          barreau: "Lyon",
        }),
        "Lyon",
      ),
      "Avocate, barreau de Lyon",
    );
    assert.equal(
      metaListeContact(contact({ id: "5", nom: "Ferrand", nature: "physique", prenoms: "Hugo" }), "Lyon"),
      "Profession à compléter, Lyon",
    );
    assert.equal(
      libelleListeContact(contact({ id: "3", nom: "SARL Duclos Industrie", nature: "morale" })),
      "SARL Duclos Industrie",
    );
    assert.equal(
      libelleListeContact(contact({ id: "6", nom: "Ferrand Métal", nature: "morale", forme: "5710" })),
      "SAS Ferrand Métal",
    );
    assert.equal(
      libelleListeContact(contact({ id: "7", nom: "SARL Duclos Industrie", nature: "morale", forme: "5499" })),
      "SARL Duclos Industrie",
    );
    assert.equal(
      initialesListeContact(contact({ id: "1", nom: "Martin", nature: "physique", prenoms: "Camille" })),
      "CM",
    );
    assert.equal(sirenListeContact("123456789"), "123 456 789");
    assert.equal(
      metaListeContact(
        contact({
          id: "1",
          nom: "Martin",
          nature: "physique",
          professionCode: "avocat",
          professionReglementee: true,
        }),
        "Lyon",
      ),
      "Avocat, Lyon",
    );
    assert.equal(
      metaListeContact(
        contact({
          id: "3",
          nom: "SARL Duclos Industrie",
          nature: "morale",
          forme: "5499",
          siren: "123456789",
        }),
        "Lyon",
      ),
      "Lyon, SIREN 123 456 789",
    );
  });

  it("compose le sous-titre de la tête de fiche", () => {
    assert.equal(
      sousTitreFiche(
        contact({
          id: "6",
          nom: "SAS Ferrand Métal",
          nature: "morale",
          forme: "5710",
          capitalCentimes: 5_000_000,
          monnaie: "EUR",
        }),
        "Lyon",
      ),
      `Société par actions simplifiée au capital de ${formatMontantRond(5_000_000)}, Lyon`,
    );
    assert.equal(
      sousTitreFiche(
        contact({
          id: "4",
          nom: "Perrin",
          nature: "physique",
          civilite: "Maître",
          accordSaisi: "feminin",
          professionCode: "avocat",
          professionReglementee: true,
          barreau: "Lyon",
        }),
        "Lyon",
      ),
      "Avocate au barreau de Lyon",
    );
    assert.equal(
      sousTitreFiche(
        contact({ id: "2", nom: "Ferrand", nature: "physique", profession: "chef d'entreprise" }),
        "Craponne",
      ),
      "Chef d'entreprise, Craponne",
    );
  });

  it("élide « de » devant une voyelle dans le barreau et la cour d'appel, jamais « de Aix »", () => {
    const aix = contact({
      id: "7",
      nom: "Vasseur",
      nature: "physique",
      civilite: "Maître",
      accordSaisi: "masculin",
      professionCode: "avocat",
      professionReglementee: true,
      barreau: "Aix-en-Provence",
    });
    assert.equal(sousTitreFiche(aix, "Aix-en-Provence"), "Avocat au barreau d'Aix-en-Provence");
    assert.equal(metaListeContact(aix, "Aix-en-Provence"), "Avocat, barreau d'Aix-en-Provence");
    const expert = contact({
      id: "8",
      nom: "Garnier",
      nature: "physique",
      civilite: "Madame",
      professionCode: "expert_judiciaire",
      professionReglementee: true,
      courAppel: "Aix-en-Provence",
    });
    assert.equal(sousTitreFiche(expert, ""), "Experte judiciaire, ressort de la cour d'appel d'Aix-en-Provence");
    const lyon = contact({ ...expert, id: "9", courAppel: "Lyon" });
    assert.equal(sousTitreFiche(lyon, ""), "Experte judiciaire, ressort de la cour d'appel de Lyon");
    for (const texte of [sousTitreFiche(expert, ""), sousTitreFiche(aix, ""), metaListeContact(aix, "")]) {
      assert.equal(texte.includes(" de Aix"), false);
    }
  });

  it("écrit le capital sans centimes quand il est rond, avec centimes seulement s'ils existent", () => {
    const lisible = (texte: string) => texte.replace(/[\u00a0\u202f]/gu, " ");
    assert.equal(lisible(libelleCapital(5_000_000, "EUR")), "au capital de 50 000 €");
    assert.equal(lisible(libelleCapital(8_400_000_000, null)), "au capital de 84 000 000 €");
    assert.equal(lisible(libelleCapital(1_000_050, "EUR")), "au capital de 10 000,50 €");
    assert.equal(lisible(libelleCapital(1_000_000, "CHF")), "au capital de 10 000 CHF");
    assert.equal(lisible(libelleCapital(1_000_050, "CHF")), "au capital de 10 000,50 CHF");
  });
});

describe("ongletsFiche", () => {
  it("retire Factures quand le contact n'a aucune facture, comme la maquette", () => {
    const ids = ongletsFiche({ liens: 5, dossiers: 1, factures: 0, mails: 1 }).map((entree) => entree.id);
    assert.deepEqual(ids, ["general", "liens", "dossiers", "mails", "notes"]);
  });

  it("garde Factures quand le contact a au moins une facture", () => {
    const ids = ongletsFiche({ factures: 2 }).map((entree) => entree.id);
    assert.deepEqual(ids, ["general", "liens", "dossiers", "factures", "mails", "notes"]);
  });

  it("retire Factures tant que les compteurs ne sont pas connus", () => {
    assert.equal(ongletsFiche({}).some((entree) => entree.id === "factures"), false);
  });
});

describe("liste rendue par lots", () => {
  const contacts = (lettre: string, n: number): ContactListe[] =>
    Array.from({ length: n }, (_, i) => contact({ id: `${lettre}${String(i)}`, nom: `${lettre}nom${String(i)}`, nature: "physique" }));
  const groupes = [
    { lettre: "A", contacts: contacts("A", 3) },
    { lettre: "B", contacts: contacts("B", 4) },
    { lettre: "C", contacts: contacts("C", 2) },
  ];

  it("garde les premières lignes, groupes et ordre conservés, et coupe un groupe au milieu", () => {
    const gardes = tronquerGroupes(groupes, 5);
    assert.deepEqual(
      gardes.map((groupe) => [groupe.lettre, groupe.contacts.length]),
      [
        ["A", 3],
        ["B", 2],
      ],
    );
    assert.equal(gardes[1]?.contacts[1]?.id, "B1");
  });

  it("rend tout quand le maximum couvre la liste, rien quand il est nul", () => {
    assert.equal(tronquerGroupes(groupes, 100).reduce((somme, groupe) => somme + groupe.contacts.length, 0), 9);
    assert.deepEqual(tronquerGroupes(groupes, 0), []);
    assert.deepEqual(tronquerGroupes([], 10), []);
  });

  it("garde le groupe entier quand le maximum tombe pile sur sa fin", () => {
    const gardes = tronquerGroupes(groupes, 3);
    assert.deepEqual(
      gardes.map((groupe) => groupe.lettre),
      ["A"],
    );
  });

  it("trie dix mille noms sans créer un collateur par comparaison", () => {
    const tous = Array.from({ length: 10_000 }, (_, i) => contact({ id: String(i), nom: `Nom${String((i * 7919) % 10_000)}`, nature: "physique" }));
    const debut = performance.now();
    const groupesTries = grouperAlphabetique(tous);
    const duree = performance.now() - debut;
    assert.equal(groupesTries.reduce((somme, groupe) => somme + groupe.contacts.length, 0), 10_000);
    assert.equal(duree < 500, true, `tri en ${duree.toFixed(0)} ms`);
  });
});
