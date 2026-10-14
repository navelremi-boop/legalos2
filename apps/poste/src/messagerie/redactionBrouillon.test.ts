import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appliquerDepartServeur, etatDeDepart, champsEcrits, colonnesModifiees, estIntact, etatDepuisLigne, libelleStatut, titreRedaction, verifierEnvoi, type LigneBrouillon } from "./etatRedaction.ts";
import { brouillonVersMail, debutDeSaisie, nomLigneBrouillon } from "./listeBrouillons.ts";
import {
  annonceTailleMax,
  formatTaille,
  lirePiecesBrouillon,
  nomPieceValide,
  NOMBRE_MAX_PIECES,
  piecesAffichees,
  TAILLE_MAX_CUMULEE,
  verifierAjout,
} from "./piecesRedaction.ts";
import { corpsBrouillon } from "../sync/uploadBrouillon.ts";

const MO = 1024 * 1024;

describe("pièces jointes : taille maximale annoncée et vérifiée avant l'envoi d'octets", () => {
  it("25 Mio cumulés, annoncés à l'écran", () => {
    assert.equal(TAILLE_MAX_CUMULEE, 25 * MO);
    assert.match(annonceTailleMax(), /25\s?Mio au plus par message/u);
  });

  it("un fichier qui tient est accepté, au plafond exact comme en dessous", () => {
    assert.deepEqual(verifierAjout([], { nom: "a.pdf", taille: 25 * MO }), { ok: true });
    assert.deepEqual(verifierAjout([{ taille: 20 * MO }], { nom: "b.pdf", taille: 5 * MO }), { ok: true });
  });

  it("essai négatif : un octet de trop, le fichier est refusé avec une phrase qui nomme la limite", () => {
    const verdict = verifierAjout([{ taille: 20 * MO }], { nom: "gros.zip", taille: 5 * MO + 1 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? "" : verdict.message, /« gros\.zip » dépasse la taille maximale : 25\s?Mio cumulés par message/u);
  });

  it("essai négatif : fichier vide, nom invalide, trop de pièces", () => {
    assert.equal(verifierAjout([], { nom: "vide.txt", taille: 0 }).ok, false);
    assert.equal(verifierAjout([], { nom: "../secret.txt", taille: 5 }).ok, false);
    assert.equal(verifierAjout([], { nom: "a\\b.txt", taille: 5 }).ok, false);
    assert.equal(verifierAjout([], { nom: "x".repeat(256), taille: 5 }).ok, false);
    assert.equal(nomPieceValide("Conclusions 2026.pdf"), true);
    assert.equal(nomPieceValide("a\nb.txt"), false);
    const nombreMax = Array.from({ length: NOMBRE_MAX_PIECES }, () => ({ taille: 1 }));
    assert.equal(verifierAjout(nombreMax, { nom: "z.txt", taille: 1 }).ok, false);
  });

  it("tailles lisibles en français", () => {
    assert.equal(formatTaille(512), "512 o");
    assert.equal(formatTaille(850 * 1024), "850 Kio");
    assert.equal(formatTaille(Math.round(2.4 * MO)), "2,4 Mio");
    assert.equal(formatTaille(25 * MO), "25 Mio");
  });

  it("le résumé des pièces est lu avec prudence", () => {
    assert.deepEqual(lirePiecesBrouillon('[{"id":"p1","nom":"a.pdf","type_mime":"application/pdf","taille":1200},{"nom":"sans id"},3]'), [
      { id: "p1", nom: "a.pdf", type_mime: "application/pdf", taille: 1200 },
    ]);
    assert.deepEqual(lirePiecesBrouillon("pas du json"), []);
    assert.deepEqual(lirePiecesBrouillon(null), []);
    assert.deepEqual(lirePiecesBrouillon('{"a":1}'), []);
  });

  it("un transfert dont le serveur n'a pas encore résumé les pièces montre celles du message d'origine comme conservées", () => {
    const affichees = piecesAffichees([], "transfert", ["Avis.pdf", "Pièce 2.docx"], []);
    assert.deepEqual(affichees.map((p) => [p.nom, p.etat]), [["Avis.pdf", "conservee"], ["Pièce 2.docx", "conservee"]]);
    assert.deepEqual(piecesAffichees([], "reponse", ["Avis.pdf"], []), []);
    const serveur = [{ id: "p1", nom: "Avis.pdf", type_mime: "application/pdf", taille: 10 }];
    assert.deepEqual(piecesAffichees(serveur, "transfert", ["Avis.pdf"], []).map((p) => p.etat), ["jointe"]);
  });
});

const LIGNE: LigneBrouillon = {
  id: "33333333-3333-4333-8333-333333333333",
  compte_id: null,
  genre: "reponse",
  origine_message_id: "11111111-1111-4111-8111-111111111111",
  dossier_id: null,
  a: "Me Anne Perrin <a.perrin@perrin-avocats.example>",
  cc: "",
  cci: "",
  objet: "Re : Conclusions",
  corps_html: "<p>Bien reçu.</p><blockquote><p>Le jeudi, Anne a écrit :</p><p>Texte cité.</p></blockquote>",
  corps: "Bien reçu.",
  en_reponse_a: "<orig-1@perrin-avocats.example>",
  references_texte: "<orig-1@perrin-avocats.example>",
  pieces_texte: "[]",
  modifie_le: "2026-10-13 09:31:00+00",
  cree_le: "2026-10-13 09:30:00+00",
};

describe("brouillon : état et colonnes", () => {
  it("la relecture d'un brouillon redonne les mêmes colonnes (reprise sans écriture parasite)", () => {
    const etat = etatDepuisLigne(LIGNE);
    assert.equal(etat.genre, "reponse");
    assert.deepEqual(etat.a.map((d) => d.adresse), ["a.perrin@perrin-avocats.example"]);
    const colonnes = champsEcrits(etat);
    assert.deepEqual(colonnesModifiees(colonnes, champsEcrits(etatDepuisLigne(LIGNE))), {});
  });

  it("une modification n'écrit que la colonne qui a changé", () => {
    const etat = etatDepuisLigne(LIGNE);
    const avant = champsEcrits(etat);
    const apres = champsEcrits({ ...etat, objet: "Re : Autre objet" });
    assert.deepEqual(colonnesModifiees(avant, apres), { objet: "Re : Autre objet" });
    const avecCc = champsEcrits({ ...etat, cc: [{ adresse: "c@x.example", nom: "" }] });
    assert.deepEqual(colonnesModifiees(avant, avecCc), { cc: "c@x.example" });
  });

  it("le HTML écrit est nettoyé et le texte brut le suit", () => {
    const etat = etatDepuisLigne(LIGNE);
    const colonnes = champsEcrits({ ...etat, corpsHtml: '<p onclick="x()">Bonjour <img src="http://distant.example/p.gif"><script>x()</script></p>' });
    assert.equal(colonnes.corps_html, "<p>Bonjour </p>");
    assert.equal(colonnes.corps, "Bonjour");
  });

  it("essai négatif : un retour à la ligne dans l'objet ne part pas dans la colonne", () => {
    const etat = etatDepuisLigne(LIGNE);
    assert.equal(champsEcrits({ ...etat, objet: "Objet\r\nBcc: autre@x.example" }).objet.includes("\n"), false);
  });

  it("une réponse laissée intacte n'est pas un brouillon ; dès qu'on écrit, elle l'est", () => {
    const depart = etatDeDepart({
      id: "z",
      genre: "reponse",
      message: {
        id: "m",
        message_id: "<m@x.example>",
        objet: "Sujet",
        expediteur: "A <a@x.example>",
        destinataires_texte: "moi@cabinet.example",
        cree_le: "2026-10-08T10:00:00Z",
        texte: "Texte",
        pieces: [],
      },
      adressesPropres: ["moi@cabinet.example"],
    });
    assert.equal(estIntact(depart, depart), true);
    assert.equal(estIntact({ ...depart, corpsHtml: depart.corpsHtml.replace("<p></p>", "<p>Merci</p>") }, depart), false);
  });

  it("titres du volet", () => {
    assert.equal(titreRedaction("nouveau"), "Nouveau mail");
    assert.equal(titreRedaction("reponse"), "Répondre");
    assert.equal(titreRedaction("reponse_a_tous"), "Répondre à tous");
    assert.equal(titreRedaction("transfert"), "Transférer");
  });

  it("statut d'enregistrement : sur cet appareil, hors ligne, puis visible sur les autres appareils", () => {
    const a = new Date(2026, 9, 13, 9, 31);
    assert.match(libelleStatut({ genre: "local", a, enLigne: false }), /Brouillon enregistré à 9\s?h\s?31 sur cet appareil, disponible hors ligne/u);
    assert.match(libelleStatut({ genre: "local", a, enLigne: true }), /envoi au serveur en cours/u);
    assert.match(libelleStatut({ genre: "serveur", a }), /Brouillon enregistré à 9\s?h\s?31, visible sur vos autres appareils/u);
    assert.match(libelleStatut({ genre: "refuse", message: "Dossier introuvable." }), /Dossier introuvable\./u);
  });

  it("l'envoi exige un destinataire et aucune pièce en cours d'ajout", () => {
    const vide = { a: [], cc: [], cci: [] };
    assert.equal(verifierEnvoi(vide, false).ok, false);
    const cci = { a: [], cc: [], cci: [{ adresse: "a@x.example", nom: "" }] };
    assert.equal(verifierEnvoi(cci, false).ok, true);
    assert.equal(verifierEnvoi(cci, true).ok, false);
  });
});

describe("brouillons dans la liste des mails", () => {
  it("un brouillon est une ligne du dossier Brouillons de l'utilisateur, avec le début de ce qu'il a écrit", () => {
    const mail = brouillonVersMail(LIGNE, "u-1");
    assert.equal(mail.brouillon, true);
    assert.equal(mail.dossier_imap, "Drafts");
    assert.equal(mail.titulaire_id, "u-1");
    assert.equal(mail.debut_texte, "Bien reçu.");
    assert.equal(mail.expediteur, "Me Anne Perrin <a.perrin@perrin-avocats.example>");
    assert.equal(mail.cree_le, "2026-10-13 09:31:00+00");
    assert.equal(mail.etat_classement, null);
  });

  it("l'aperçu s'arrête avant l'historique cité", () => {
    assert.equal(debutDeSaisie("<p>Ma réponse</p><blockquote><p>cité</p></blockquote>"), "Ma réponse");
    assert.equal(debutDeSaisie(null), "");
    assert.equal(nomLigneBrouillon("Me Anne Perrin <a@x.example>"), "À Me Anne Perrin <a@x.example>");
    assert.equal(nomLigneBrouillon("  "), "Sans destinataire");
  });
});

describe("connecteur d'envoi : corps de l'écriture d'un brouillon (même fixture que le connecteur Rust)", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../tests/recette/fixtures/brouillon-upload.json", import.meta.url)), "utf8"),
  ) as { nom: string; colonnes: Record<string, unknown>; corps: Record<string, unknown> }[];

  for (const cas of fixture) {
    it(cas.nom, () => {
      assert.deepEqual(corpsBrouillon(cas.colonnes), cas.corps);
    });
  }

  it("les colonnes que le serveur pose ne partent jamais", () => {
    const corps = corpsBrouillon({ ...champsEcrits(etatDepuisLigne(LIGNE)), cabinet_id: "c", auteur_id: "a", pieces_texte: "[]", revision: 3, cree_le: "x", modifie_le: "y" });
    for (const nom of ["cabinet_id", "auteur_id", "pieces_texte", "revision", "cree_le", "modifie_le", "id"]) {
      assert.equal(nom in corps, false, nom);
    }
    assert.deepEqual(corps.a, ["Me Anne Perrin <a.perrin@perrin-avocats.example>"]);
    assert.deepEqual(corps.references, ["<orig-1@perrin-avocats.example>"]);
  });
});

describe("départ d'une réponse complété par le serveur", () => {
  const depart = etatDeDepart({
    id: "z",
    genre: "reponse_a_tous",
    message: {
      id: "m",
      message_id: "<m@x.example>",
      objet: "Sujet",
      expediteur: "A <a@x.example>",
      destinataires_texte: "cabinet-partage@cabinet.example, tiers@x.example",
      cree_le: "2026-10-08T10:00:00Z",
      texte: "Texte",
      pieces: [],
    },
    adressesPropres: ["moi@cabinet.example"],
  });

  it("le serveur retire l'adresse de la boîte partagée que le poste ne connaît pas, et donne la chaîne complète du fil", () => {
    assert.deepEqual(depart.cc.map((d) => d.adresse), ["cabinet-partage@cabinet.example", "tiers@x.example"]);
    const complete = appliquerDepartServeur(depart, {
      a: [{ adresse: "a@x.example", nom: "A" }],
      cc: [{ adresse: "tiers@x.example", nom: "" }],
      enReponseA: "<m@x.example>",
      references: ["<racine@x.example>", "<m@x.example>"],
    });
    assert.deepEqual(complete.cc.map((d) => d.adresse), ["tiers@x.example"]);
    assert.deepEqual(complete.references, ["<racine@x.example>", "<m@x.example>"]);
    assert.equal(complete.corpsHtml, depart.corpsHtml);
  });

  it("essai négatif : une réponse du serveur sans destinataire ne remplace rien", () => {
    assert.equal(appliquerDepartServeur(depart, { a: [], cc: [], enReponseA: null, references: [] }), depart);
  });
});
