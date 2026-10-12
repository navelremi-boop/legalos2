import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apercuMail,
  ecartEnJours,
  extensionPiece,
  filtrerMails,
  groupesParJour,
  horodatageLecture,
  horodatageListe,
  listePieces,
  muralMail,
  normaliserHorodatage,
  paragraphes,
  trierParDate,
} from "./listeMails.ts";
import type { MailLocal } from "./typesMails.ts";

// Vendredi 9 octobre 2026, 10 h à Paris (heure d'été, UTC+2).
const MAINTENANT = new Date("2026-10-09T10:00:00+02:00");

function mail(id: string, cree_le: string, extra: Partial<MailLocal> = {}): MailLocal {
  return {
    id,
    objet: `Objet ${id}`,
    expediteur: "x@example.com",
    etat_classement: "classe",
    dossier_id: null,
    suggestion_dossier_id: null,
    cree_le,
    ...extra,
  };
}

describe("horodatages Postgres", () => {
  it("normalise le format texte de Postgres (espace, décalage sur deux chiffres)", () => {
    assert.equal(normaliserHorodatage("2026-10-12 09:12:34.123456+00"), "2026-10-12T09:12:34.123456+00:00");
    assert.equal(normaliserHorodatage("2026-10-12 09:12:34+02"), "2026-10-12T09:12:34+02:00");
    assert.equal(normaliserHorodatage("2026-10-12T09:12:34Z"), "2026-10-12T09:12:34Z");
    assert.equal(normaliserHorodatage("2026-10-12T09:15:00"), "2026-10-12T09:15:00");
  });
  it("lit l'heure de Paris : été (UTC+2) et hiver (UTC+1)", () => {
    assert.deepEqual(muralMail("2026-10-12 07:12:34+00"), { jour: "2026-10-12", heure: 9, minute: 12 });
    assert.deepEqual(muralMail("2026-12-12 08:00:00+00"), { jour: "2026-12-12", heure: 9, minute: 0 });
  });
  it("une valeur sans décalage est déjà l'heure murale", () => {
    assert.deepEqual(muralMail("2026-10-12T09:15:00"), { jour: "2026-10-12", heure: 9, minute: 15 });
  });
  it("essai négatif : l'heure UTC n'est pas prise pour l'heure de Paris", () => {
    const mur = muralMail("2026-10-12 07:12:34+00");
    assert.notEqual(mur?.heure, 7);
  });
  it("illisible ou absent : null", () => {
    assert.equal(muralMail(null), null);
    assert.equal(muralMail("n'importe quoi"), null);
  });
});

describe("groupesParJour", () => {
  const mails = [
    mail("auj-1", "2026-10-09T09:12:00+02:00"),
    mail("auj-2", "2026-10-09T08:40:00+02:00"),
    mail("hier", "2026-10-08T17:20:00+02:00"),
    mail("semaine", "2026-10-05T07:30:00+02:00"),
    mail("mois", "2026-10-01T18:42:00+02:00"),
    mail("sept", "2026-09-20T10:00:00+02:00"),
    mail("sans-date", "illisible"),
  ];
  it("groupe par jour, du plus récent au plus ancien", () => {
    const groupes = groupesParJour(mails, MAINTENANT);
    assert.deepEqual(
      groupes.map((g) => [g.cle, g.titre, g.mails.map((m) => m.id)]),
      [
        ["aujourdhui", "Aujourd'hui", ["auj-1", "auj-2"]],
        ["hier", "Hier", ["hier"]],
        ["semaine", "Cette semaine", ["semaine"]],
        ["mois", "Ce mois-ci", ["mois"]],
        ["2026-09", "Septembre 2026", ["sept"]],
        ["sans-date", "Sans date", ["sans-date"]],
      ],
    );
  });
  it("trie même quand la liste arrive dans le désordre", () => {
    const desordre = [mails[2], mails[0], mails[1]].filter((m): m is MailLocal => m !== undefined);
    assert.deepEqual(
      trierParDate(desordre).map((m) => m.id),
      ["auj-1", "auj-2", "hier"],
    );
  });
  it("le jour est celui de Paris : 00 h 30 à Paris, la veille en UTC, est « aujourd'hui »", () => {
    const groupes = groupesParJour([mail("minuit", "2026-10-08 22:30:00+00")], MAINTENANT);
    assert.equal(groupes[0]?.cle, "aujourdhui");
  });
  it("essai négatif : 23 h 59 à Paris la veille n'est pas « aujourd'hui »", () => {
    const veille = groupesParJour([mail("hier", "2026-10-08 21:59:00+00")], MAINTENANT);
    assert.equal(veille[0]?.cle, "hier");
    const minuit = groupesParJour([mail("minuit", "2026-10-08 22:00:00+00")], MAINTENANT);
    assert.equal(minuit[0]?.cle, "aujourdhui");
  });
  it("écart en jours civils", () => {
    assert.equal(ecartEnJours("2026-10-08", "2026-10-09"), 1);
    assert.equal(ecartEnJours("2026-09-30", "2026-10-01"), 1);
    assert.equal(ecartEnJours("2026-10-09", "2026-10-09"), 0);
  });
});

describe("horodatageListe", () => {
  it("heure pour aujourd'hui et hier", () => {
    assert.equal(horodatageListe("2026-10-09T09:12:00+02:00", MAINTENANT), "9 h 12");
    assert.equal(horodatageListe("2026-10-08T17:20:00+02:00", MAINTENANT), "17 h 20");
  });
  it("jour de la semaine pour les cinq jours d'avant", () => {
    assert.equal(horodatageListe("2026-10-05T07:30:00+02:00", MAINTENANT), "lun.");
  });
  it("date courte au-delà, « 1er » pour le premier du mois", () => {
    assert.equal(horodatageListe("2026-10-01T18:42:00+02:00", MAINTENANT), "1er oct.");
    assert.equal(horodatageListe("2026-09-20T10:00:00+02:00", MAINTENANT), "20 sept.");
  });
  it("essai négatif : jamais de date AAAA-MM-JJ à l'écran", () => {
    for (const valeur of [
      "2026-10-09T09:12:00+02:00",
      "2026-10-05T07:30:00+02:00",
      "2026-10-01T18:42:00+02:00",
      "2026-09-20T10:00:00+02:00",
    ]) {
      assert.doesNotMatch(horodatageListe(valeur, MAINTENANT), /\d{4}-\d{2}-\d{2}/u);
    }
  });
});

describe("horodatageLecture", () => {
  it("aujourd'hui, hier, puis date longue en minuscules", () => {
    assert.equal(horodatageLecture("2026-10-09T08:40:00+02:00", MAINTENANT), "Aujourd'hui, 8 h 40");
    assert.equal(horodatageLecture("2026-10-08T17:20:00+02:00", MAINTENANT), "Hier, 17 h 20");
    assert.equal(horodatageLecture("2026-10-05T07:30:00+02:00", MAINTENANT), "lundi 5 octobre, 7 h 30");
    assert.equal(horodatageLecture("2026-10-01T18:42:00+02:00", MAINTENANT), "jeudi 1er octobre, 18 h 42");
  });
  it("sans heure : la date seule", () => {
    assert.equal(horodatageLecture("2026-10-05", MAINTENANT), "lundi 5 octobre");
  });
});

describe("filtres, pièces et aperçu", () => {
  const mails = [
    mail("a", "2026-10-09T09:00:00+02:00", { lu: 0, pieces_texte: "Avis.pdf" }),
    mail("b", "2026-10-09T08:00:00+02:00", { lu: 1, pieces_texte: "" }),
    mail("c", "2026-10-09T07:00:00+02:00", { lu: 0, pieces_texte: null }),
  ];
  it("Tous, Non lus, Pièces jointes", () => {
    assert.deepEqual(filtrerMails(mails, "tous").map((m) => m.id), ["a", "b", "c"]);
    assert.deepEqual(filtrerMails(mails, "nonlus").map((m) => m.id), ["a", "c"]);
    assert.deepEqual(filtrerMails(mails, "pj").map((m) => m.id), ["a"]);
  });
  it("liste les pièces, une par ligne", () => {
    assert.deepEqual(listePieces({ pieces_texte: "A.pdf\n\n B.docx \n" }), ["A.pdf", "B.docx"]);
    assert.deepEqual(listePieces({ pieces_texte: null }), []);
  });
  it("extension en capitales, vide au-delà de cinq caractères ou sans point", () => {
    assert.equal(extensionPiece("Avis.pdf"), "PDF");
    assert.equal(extensionPiece("Projet.docx"), "DOCX");
    assert.equal(extensionPiece("Sans-extension"), "");
    assert.equal(extensionPiece(".cache"), "");
    assert.equal(extensionPiece("archive.tres-long"), "");
  });
  it("aperçu : début du texte, une ligne, coupé à 90 caractères", () => {
    assert.equal(apercuMail({ debut_texte: "Bonjour,\n\n  merci.", extrait_texte: "autre" }), "Bonjour, merci.");
    assert.equal(apercuMail({ debut_texte: "", extrait_texte: "Extrait" }), "Extrait");
    const long = "x".repeat(120);
    assert.equal(apercuMail({ debut_texte: long, extrait_texte: null }), `${"x".repeat(90)}…`);
    assert.equal(apercuMail({ debut_texte: null, extrait_texte: null }), "");
  });
  it("paragraphes séparés par une ligne vide", () => {
    assert.deepEqual(paragraphes("Maître,\r\n\r\nPremier.\n\n\n\nSecond.\nSuite."), ["Maître,", "Premier.", "Second.\nSuite."]);
    assert.deepEqual(paragraphes("   "), []);
  });
});
