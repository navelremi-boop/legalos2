import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anneeFacturation,
  colonnesFactures,
  etatVideDossiers,
  lignesDossiers,
  lignesFactures,
  lignesMails,
  mailsDuContact,
  regrouperDossiers,
  statutFacture,
  syntheseFactures,
  tuilesFactures,
  type DossierFiche,
  type FactureFiche,
  type MailBrut,
} from "./historiqueFiche.ts";

const lisible = (texte: string) => texte.replaceAll(" ", " ").replaceAll(" ", " ");

const MAIL: MailBrut = {
  id: "m1",
  objet: "Pièces",
  expediteur: "Camille Martin <camille@example.test>",
  destinataires: "contact@cabinet.example",
  etat: "classe",
  dateIso: "2026-10-27",
};

const FACTURE: FactureFiche = {
  id: "f1",
  reference: "2026-0131",
  dateIso: "2026-09-03",
  objet: "Provision sur honoraires",
  ttcCentimes: 240_000,
  encaisseCentimes: 240_000,
  brouillon: false,
};

const DOSSIER: DossierFiche = {
  id: "d1",
  nom: "SAS Ferrand Métal c/ SARL Duclos Industrie",
  qualite: "client",
  reference: "2026-031",
  chemise: "bleu-classeur",
};

describe("historique de la fiche, factures", () => {
  it("calcule l'encours après encaissement", () => {
    const synthese = syntheseFactures([
      { ...FACTURE, id: "f1", dateIso: null, ttcCentimes: 120_000, encaisseCentimes: 50_000 },
      { ...FACTURE, id: "f2", dateIso: null, ttcCentimes: 10_000, encaisseCentimes: 10_000 },
    ]);
    assert.equal(synthese.encaisseCentimes, 60_000);
    assert.equal(synthese.encoursCentimes, 70_000);
  });

  it("ne compte jamais un encours négatif", () => {
    const synthese = syntheseFactures([{ ...FACTURE, ttcCentimes: 10_000, encaisseCentimes: 12_000 }]);
    assert.equal(synthese.encoursCentimes, 0);
  });

  it("compose les trois tuiles de la maquette : facturé en 2026, encaissé, encours", () => {
    const tuiles = tuilesFactures([
      FACTURE,
      { ...FACTURE, id: "f2", reference: "2026-0158", dateIso: "2026-10-02", ttcCentimes: 360_000, encaisseCentimes: 0 },
    ]);
    assert.deepEqual(
      tuiles.map((tuile) => [tuile.libelle, lisible(tuile.montant)]),
      [
        ["Facturé en 2026", "6 000,00 €"],
        ["Encaissé", "2 400,00 €"],
        ["Encours", "3 600,00 €"],
      ],
    );
  });

  it("limite le facturé à l'année la plus récente quand toutes les dates sont connues", () => {
    const factures = [
      { ...FACTURE, id: "ancienne", dateIso: "2025-12-15", ttcCentimes: 100_000, encaisseCentimes: 100_000 },
      { ...FACTURE, id: "recente", dateIso: "2026-01-10", ttcCentimes: 50_000, encaisseCentimes: 0 },
    ];
    assert.equal(anneeFacturation(factures), 2026);
    const synthese = syntheseFactures(factures);
    assert.equal(synthese.factureCentimes, 50_000);
    assert.equal(synthese.encaisseCentimes, 100_000);
    assert.equal(synthese.encoursCentimes, 50_000);
  });

  it("n'invente pas de période : sans date, le libellé est « Facturé » et le total couvre toutes les factures", () => {
    const factures = [
      { ...FACTURE, id: "f1", dateIso: null, ttcCentimes: 120_000, encaisseCentimes: 50_000 },
      { ...FACTURE, id: "f2", dateIso: "2026-09-03", ttcCentimes: 10_000, encaisseCentimes: 0 },
    ];
    assert.equal(anneeFacturation(factures), null);
    const tuiles = tuilesFactures(factures);
    assert.equal(tuiles[0]?.libelle, "Facturé");
    assert.equal(lisible(tuiles[0]?.montant ?? ""), "1 300,00 €");
    assert.equal(anneeFacturation([]), null);
  });

  it("donne le statut Payée, En attente ou Brouillon", () => {
    assert.equal(statutFacture(FACTURE), "payee");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 100 }), "attente");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 0, ttcCentimes: 0 }), "attente");
    assert.equal(statutFacture({ ...FACTURE, brouillon: true, encaisseCentimes: 240_000 }), "brouillon");
  });

  it("trie par date puis par numéro, les factures sans date ou sans numéro en dernier", () => {
    const lignes = lignesFactures([
      { ...FACTURE, id: "sans-date", dateIso: null, reference: "9" },
      { ...FACTURE, id: "oct", dateIso: "2026-10-02", reference: "2026-0158" },
      { ...FACTURE, id: "sans-numero", dateIso: "2026-10-02", reference: null },
      { ...FACTURE, id: "sept", dateIso: "2026-09-03", reference: "2026-0131" },
    ]);
    assert.deepEqual(
      lignes.map((ligne) => ligne.id),
      ["sept", "oct", "sans-numero", "sans-date"],
    );
    assert.equal(lignes[2]?.reference, "Sans numéro");
  });

  it("trie les numéros sans date en ordre numérique", () => {
    const lignes = lignesFactures([
      { ...FACTURE, id: "dix", dateIso: null, reference: "10" },
      { ...FACTURE, id: "deux", dateIso: null, reference: "2" },
    ]);
    assert.deepEqual(
      lignes.map((ligne) => ligne.id),
      ["deux", "dix"],
    );
  });

  it("met en forme la ligne : date à la française, montant en centimes entiers, statut", () => {
    const [ligne] = lignesFactures([FACTURE]);
    assert.equal(ligne?.date, "3 septembre 2026");
    assert.equal(lisible(ligne?.montant ?? ""), "2 400,00 €");
    assert.equal(ligne?.statutLibelle, "Payée");
  });

  it("n'affiche les colonnes Date et Objet que si la base les porte", () => {
    assert.deepEqual(colonnesFactures(lignesFactures([FACTURE])), { date: true, objet: true });
    assert.deepEqual(colonnesFactures(lignesFactures([{ ...FACTURE, dateIso: null, objet: null }])), {
      date: false,
      objet: false,
    });
  });
});

describe("historique de la fiche, mails", () => {
  it("ne garde que les mails classés dont une adresse est celle de la fiche", () => {
    const gardes = mailsDuContact(
      [
        MAIL,
        { ...MAIL, id: "m2", etat: "a_classer" },
        { ...MAIL, id: "m3", expediteur: "autre@example.test", destinataires: "personne@example.test" },
      ],
      ["camille@example.test"],
    );
    assert.deepEqual(
      gardes.map((mail) => mail.id),
      ["m1"],
    );
    assert.equal(mailsDuContact([MAIL], []).length, 0);
  });

  it("nomme l'expéditeur, ou « Vous » quand c'est un compte mail du cabinet", () => {
    const gardes = mailsDuContact(
      [
        MAIL,
        { ...MAIL, id: "m2", expediteur: "compta@example.test", destinataires: "camille@example.test" },
        { ...MAIL, id: "m3", expediteur: "Cabinet <Cabinet@Example.test>", destinataires: "camille@example.test" },
      ],
      ["camille@example.test"],
      ["cabinet@example.test"],
    );
    const auteurs = Object.fromEntries(gardes.map((mail) => [mail.id, mail.auteur]));
    assert.deepEqual(auteurs, { m1: "Camille Martin", m2: "compta@example.test", m3: "Vous" });
  });

  it("trie du plus récent au plus ancien, les mails sans date en dernier", () => {
    const gardes = mailsDuContact(
      [
        { ...MAIL, id: "sans-date", dateIso: null },
        { ...MAIL, id: "ancien", dateIso: "2026-10-09" },
        { ...MAIL, id: "recent", dateIso: "2026-10-27" },
      ],
      ["camille@example.test"],
    );
    assert.deepEqual(
      gardes.map((mail) => mail.id),
      ["recent", "ancien", "sans-date"],
    );
  });

  it("écrit la date sans l'année courante et laisse vide une date absente", () => {
    const [ligne] = lignesMails([{ id: "m1", objet: "Pièces", auteur: "Vous", dateIso: "2026-10-27" }], 2026);
    assert.equal(ligne?.date, "27 octobre");
    const [autre] = lignesMails([{ id: "m1", objet: "Pièces", auteur: "Vous", dateIso: null }], 2026);
    assert.equal(autre?.date, null);
  });
});

describe("historique de la fiche, dossiers", () => {
  it("compose la ligne : référence du dossier, nom, qualité commençant par une majuscule", () => {
    const [ligne] = lignesDossiers([DOSSIER]);
    assert.equal(ligne?.reference, "2026-031");
    assert.equal(ligne?.qualite, "Client");
    assert.equal(ligne?.chemise, "bleu-classeur");
  });

  it("affiche « Référence en attente » tant que le serveur n'a pas attribué la référence", () => {
    const [ligne] = lignesDossiers([{ ...DOSSIER, reference: null }]);
    assert.equal(ligne?.reference, "Référence en attente");
  });

  it("regroupe en une ligne les qualités d'un même dossier et trie par nom", () => {
    const regroupes = regrouperDossiers([
      { ...DOSSIER, id: "d2", nom: "Succession Moreau", qualite: "cliente" },
      { ...DOSSIER, qualite: "client" },
      { ...DOSSIER, qualite: "demandeur" },
      { ...DOSSIER, qualite: "client" },
    ]);
    assert.deepEqual(
      regroupes.map((dossier) => [dossier.id, dossier.qualite]),
      [
        ["d1", "client, demandeur"],
        ["d2", "cliente"],
      ],
    );
  });

  it("donne le titre et la phrase de l'état vide de la maquette", () => {
    const vide = etatVideDossiers();
    assert.equal(vide.titre, "Aucun dossier");
    assert.equal(
      vide.phrase,
      "Ce contact n'intervient dans aucun dossier que vous pouvez consulter. « Ajouter à un dossier » le rattache avec une qualité.",
    );
  });
});
