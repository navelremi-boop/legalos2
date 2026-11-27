import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anneeFacturation,
  colonnesFactures,
  etatVideDossiers,
  etatVideLiens,
  etatVideMails,
  etatVideNotes,
  MENTION_MAILS,
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
        ["Facturé en 2026", "6 000 €"],
        ["Encaissé", "2 400 €"],
        ["Encours", "3 600 €"],
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
    assert.equal(lisible(tuiles[0]?.montant ?? ""), "1 300 €");
    assert.equal(anneeFacturation([]), null);
  });

  it("déduit le statut des encaissements : Payée, Partiellement payée, En attente, et Brouillon", () => {
    assert.equal(statutFacture(FACTURE), "payee");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 250_000 }), "payee");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 239_999 }), "partielle");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 100 }), "partielle");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 0 }), "attente");
    assert.equal(statutFacture({ ...FACTURE, encaisseCentimes: 0, ttcCentimes: 0 }), "attente");
    assert.equal(statutFacture({ ...FACTURE, brouillon: true, encaisseCentimes: 240_000 }), "brouillon");
    assert.deepEqual(
      lignesFactures([
        { ...FACTURE, id: "a", reference: "1", encaisseCentimes: 240_000 },
        { ...FACTURE, id: "b", reference: "2", encaisseCentimes: 100 },
        { ...FACTURE, id: "c", reference: "3", encaisseCentimes: 0 },
        { ...FACTURE, id: "d", reference: "4", brouillon: true, encaisseCentimes: 0 },
      ]).map((ligne) => ligne.statutLibelle),
      ["Payée", "Partiellement payée", "En attente", "Brouillon"],
    );
  });

  it("ne compte les brouillons ni dans le facturé ni dans l'encours, ni dans l'encaissé, et les garde listés", () => {
    const factures: FactureFiche[] = [
      { ...FACTURE, id: "payee", reference: "1", ttcCentimes: 100_000, encaisseCentimes: 100_000 },
      { ...FACTURE, id: "partielle", reference: "2", ttcCentimes: 90_050, encaisseCentimes: 30_000 },
      { ...FACTURE, id: "attente", reference: "3", ttcCentimes: 30_000, encaisseCentimes: 0 },
      { ...FACTURE, id: "brouillon", reference: "4", ttcCentimes: 120_000, encaisseCentimes: 40_000, brouillon: true, dateIso: null },
    ];
    const synthese = syntheseFactures(factures);
    assert.equal(synthese.factureCentimes, 220_050);
    assert.equal(synthese.encaisseCentimes, 130_000);
    assert.equal(synthese.encoursCentimes, 90_050);
    assert.equal(synthese.annee, 2026);
    assert.deepEqual(
      tuilesFactures(factures).map((tuile) => [tuile.libelle, lisible(tuile.montant)]),
      [
        ["Facturé en 2026", "2 200,50 €"],
        ["Encaissé", "1 300 €"],
        ["Encours", "900,50 €"],
      ],
    );
    assert.equal(lignesFactures(factures).length, 4);
    assert.equal(lignesFactures(factures).find((ligne) => ligne.id === "brouillon")?.statutLibelle, "Brouillon");
  });

  it("avec un seul brouillon, les trois tuiles sont à zéro", () => {
    const tuiles = tuilesFactures([{ ...FACTURE, brouillon: true, encaisseCentimes: 0 }]);
    assert.deepEqual(
      tuiles.map((tuile) => lisible(tuile.montant)),
      ["0 €", "0 €", "0 €"],
    );
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

  it("met en forme la ligne : date à la française, montant sans centimes s'il est rond, statut", () => {
    const [ligne] = lignesFactures([FACTURE]);
    assert.equal(ligne?.date, "3 septembre 2026");
    assert.equal(lisible(ligne?.montant ?? ""), "2 400 €");
    const [centimes] = lignesFactures([{ ...FACTURE, ttcCentimes: 240_050 }]);
    assert.equal(lisible(centimes?.montant ?? ""), "2 400,50 €");
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

  it("« De : » l'expéditeur pour un mail reçu, « À : » les destinataires pour un mail envoyé par le cabinet", () => {
    const gardes = mailsDuContact(
      [
        MAIL,
        { ...MAIL, id: "m2", expediteur: "compta@example.test", destinataires: "camille@example.test" },
        {
          ...MAIL,
          id: "m3",
          expediteur: "Cabinet <Cabinet@Example.test>",
          destinataires: "camille@example.test, Autre@example.test, camille@example.test",
        },
      ],
      ["camille@example.test"],
      ["cabinet@example.test"],
    );
    const sens = Object.fromEntries(gardes.map((mail) => [mail.id, mail.sens]));
    assert.deepEqual(sens, { m1: "recu", m2: "recu", m3: "envoye" });
    const lignes = Object.fromEntries(lignesMails(gardes, 2026).map((ligne) => [ligne.id, ligne.correspondants]));
    assert.deepEqual(lignes, {
      m1: "De : Camille Martin",
      m2: "De : compta@example.test",
      m3: "À : camille@example.test, autre@example.test",
    });
  });

  it("écrit le nom de l'annuaire à la place de l'adresse quand il est connu", () => {
    const noms = new Map([
      ["camille@example.test", "Mme Camille Martin"],
      ["autre@example.test", "M. Paul Autre"],
    ]);
    const gardes = mailsDuContact(
      [
        MAIL,
        { ...MAIL, id: "m3", expediteur: "cabinet@example.test", destinataires: "camille@example.test, autre@example.test, x@example.test" },
      ],
      ["camille@example.test"],
      ["cabinet@example.test"],
      noms,
    );
    const lignes = Object.fromEntries(lignesMails(gardes, 2026).map((ligne) => [ligne.id, ligne.correspondants]));
    assert.deepEqual(lignes, {
      m1: "De : Mme Camille Martin",
      m3: "À : Mme Camille Martin, M. Paul Autre, x@example.test",
    });
  });

  it("ne rattache pas à la fiche un mail envoyé sans destinataire, et n'invente aucun destinataire", () => {
    const [mail] = mailsDuContact(
      [{ ...MAIL, expediteur: "cabinet@example.test", destinataires: "" }],
      ["camille@example.test"],
      ["cabinet@example.test"],
    );
    assert.equal(mail, undefined);
    const [sans] = lignesMails([{ id: "m", objet: "O", sens: "envoye", personnes: [], dateIso: null }], 2026);
    assert.equal(sans?.correspondants, "À : destinataire non enregistré");
  });

  it("trie du plus récent au plus ancien par instant, quel que soit le décalage écrit, les mails sans date en dernier", () => {
    const gardes = mailsDuContact(
      [
        { ...MAIL, id: "sans-date", dateIso: null },
        { ...MAIL, id: "illisible", dateIso: "hier soir" },
        // 14 h 00 à Paris le 9 octobre 2026 (heure d'été) : 12 h 00 UTC.
        { ...MAIL, id: "ancien", dateIso: "Fri, 09 Oct 2026 14:00:00 +0200" },
        // Plus récent en instant (12 h 30 UTC) bien que l'heure écrite (08 h 30) soit plus petite.
        { ...MAIL, id: "recent", dateIso: "Fri, 09 Oct 2026 08:30:00 -0400" },
      ],
      ["camille@example.test"],
    );
    assert.deepEqual(
      gardes.map((mail) => mail.id),
      ["recent", "ancien", "sans-date", "illisible"],
    );
  });

  it("écrit la date et l'heure de Paris de l'en-tête, sans l'année courante, et laisse vide une date absente ou illisible", () => {
    const base = { id: "m1", objet: "Pièces", sens: "recu" as const, personnes: ["Vous"] };
    const [ligne] = lignesMails([{ ...base, dateIso: "2026-10-27 09:12:00+00" }], 2026);
    assert.equal(lisible(ligne?.date ?? ""), "27 octobre à 10 h 12");
    const [autreAnnee] = lignesMails([{ ...base, dateIso: "Tue, 14 Oct 2025 09:05:00 +0200" }], 2026);
    assert.equal(lisible(autreAnnee?.date ?? ""), "14 octobre 2025 à 9 h 05");
    const [absente] = lignesMails([{ ...base, dateIso: null }], 2026);
    assert.equal(absente?.date, null);
    const [illisible] = lignesMails([{ ...base, dateIso: "n'importe quoi" }], 2026);
    assert.equal(illisible?.date, null);
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

  it("donne le titre en gras et la phrase d'aide des états vides Liens, Notes et Mails", () => {
    assert.deepEqual(etatVideLiens(), {
      titre: "Aucun lien",
      phrase:
        "Reliez ce contact à ses dirigeants, à sa société, à sa famille ou à ses conseils. Pour une société, « Mettre à jour depuis le registre » propose ses dirigeants.",
    });
    assert.deepEqual(etatVideNotes(), {
      titre: "Aucune note",
      phrase: "Ce que le cabinet doit savoir de ce contact et qui n'a pas sa place ailleurs.",
    });
    assert.deepEqual(etatVideMails(), { titre: "Aucun mail", phrase: MENTION_MAILS });
  });
});
