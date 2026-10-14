import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compteNominatifDuMessage } from "./boitesMail.ts";
import { corpsDeDepart, type MessageCite } from "./citation.ts";
import {
  assemblerCorps,
  avecSignature,
  blocsSignature,
  decouperBlocs,
  separerCorps,
  SEPARATEUR_SIGNATURE,
} from "./corpsRedaction.ts";
import { corpsNonTouche, etatDeDepart } from "./etatRedaction.ts";

const MESSAGE: MessageCite = {
  id: "m1",
  message_id: "<origine-fictif@example.com>",
  objet: "Convocation fictive",
  expediteur: "Me Tiers Fictif <tiers@example.com>",
  destinataires_texte: "cabinet@example.com",
  cree_le: "2026-10-08 10:12:00",
  texte: "Bonjour, merci de confirmer le créneau.\n\nBien cordialement.",
  pieces: [],
};

const SIGNATURE_A = "<p><strong>Me Fictif A</strong><br>Avocat au Barreau de Lyon</p>";
const SIGNATURE_B = "<p>Cabinet Fictif B</p><p>14 rue Fictive, 69001 Lyon</p>";

describe("découpe du corps d'un message en blocs", () => {
  it("les listes et les citations restent des blocs entiers", () => {
    const html = "<p>a</p><ul><li><p>un</p></li><li><p>deux</p></li></ul><blockquote><p>cité</p></blockquote>";
    assert.deepEqual(decouperBlocs(html), [
      "<p>a</p>",
      "<ul><li><p>un</p></li><li><p>deux</p></li></ul>",
      "<blockquote><p>cité</p></blockquote>",
    ]);
    assert.equal(assemblerCorps(separerCorps(html)), html);
  });

  it("l'historique est le dernier bloc quand c'est une citation, la signature commence au séparateur", () => {
    const html = `<p>texte</p>${SEPARATEUR_SIGNATURE}<p>Sig</p><blockquote><p>cité</p></blockquote>`;
    const parties = separerCorps(html);
    assert.deepEqual(parties.saisie, ["<p>texte</p>"]);
    assert.deepEqual(parties.signature, [SEPARATEUR_SIGNATURE, "<p>Sig</p>"]);
    assert.deepEqual(parties.historique, ["<blockquote><p>cité</p></blockquote>"]);
  });
});

describe("signature insérée à la rédaction : sous la saisie, avant l'historique, une seule fois", () => {
  it("message neuf : un paragraphe pour écrire, puis la ligne « -- » et la signature", () => {
    const corps = avecSignature(corpsDeDepart("nouveau", null), SIGNATURE_A);
    assert.equal(corps, `<p></p>${SEPARATEUR_SIGNATURE}${SIGNATURE_A}`);
  });

  it("réponse : la signature précède l'historique cité, qui reste le dernier bloc", () => {
    const depart = corpsDeDepart("reponse", MESSAGE);
    const corps = avecSignature(depart, SIGNATURE_A);
    const blocs = decouperBlocs(corps);
    assert.equal(blocs[0], "<p></p>");
    assert.equal(blocs[1], SEPARATEUR_SIGNATURE);
    assert.equal(blocs[2], SIGNATURE_A);
    assert.match(blocs[blocs.length - 1] ?? "", /^<blockquote>.*a écrit/su);
    assert.ok(corps.indexOf("<strong>Me Fictif A</strong>") < corps.indexOf("<blockquote>"));
    assert.ok(corps.endsWith("</blockquote>"));
  });

  it("transfert : même disposition, la signature avant le message transféré", () => {
    const corps = avecSignature(corpsDeDepart("transfert", MESSAGE), SIGNATURE_A);
    assert.ok(corps.indexOf("Me Fictif A") < corps.indexOf("Message transféré"));
    assert.equal(separerCorps(corps).historique.length, 1);
  });

  it("une seule fois : insérer deux fois la même signature ne la double pas", () => {
    const une = avecSignature(corpsDeDepart("reponse", MESSAGE), SIGNATURE_A);
    const deux = avecSignature(une, SIGNATURE_A);
    assert.equal(deux, une);
    assert.equal(deux.split(SEPARATEUR_SIGNATURE).length - 1, 1);
    assert.equal(deux.split("Me Fictif A").length - 1, 1);
  });

  it("changement de compte avant d'avoir écrit : la signature du nouveau compte remplace l'ancienne", () => {
    const depart = corpsDeDepart("reponse", MESSAGE);
    const compteA = avecSignature(depart, SIGNATURE_A);
    const compteB = avecSignature(compteA, SIGNATURE_B);
    assert.equal(compteB, avecSignature(depart, SIGNATURE_B));
    assert.ok(!compteB.includes("Me Fictif A"));
    assert.ok(compteB.includes("Cabinet Fictif B") && compteB.includes("14 rue Fictive"));
    assert.equal(compteB.split(SEPARATEUR_SIGNATURE).length - 1, 1);
  });

  it("le nouveau compte n'a pas de signature : l'ancienne est retirée", () => {
    const depart = corpsDeDepart("reponse", MESSAGE);
    const sansSignature = avecSignature(avecSignature(depart, SIGNATURE_A), "");
    assert.equal(sansSignature, depart);
    assert.ok(!sansSignature.includes(SEPARATEUR_SIGNATURE));
  });

  it("ce que l'utilisateur a écrit est conservé quand la signature change", () => {
    const ecrit = avecSignature(corpsDeDepart("reponse", MESSAGE), SIGNATURE_A).replace("<p></p>", "<p>Bien reçu, merci.</p>");
    const change = avecSignature(ecrit, SIGNATURE_B);
    assert.ok(change.startsWith("<p>Bien reçu, merci.</p>"));
    assert.ok(!change.includes("Me Fictif A") && change.includes("Cabinet Fictif B"));
  });

  it("essai négatif : une signature sans texte n'ajoute rien, ni séparateur", () => {
    for (const vide of ["", "   ", "<p></p>", "<p><br></p>"]) {
      assert.deepEqual(blocsSignature(vide), [], JSON.stringify(vide));
      assert.equal(avecSignature(corpsDeDepart("nouveau", null), vide), "<p></p>");
    }
  });

  it("essai négatif : la signature ne porte ni script ni attribut venu du serveur", () => {
    const corps = avecSignature("<p></p>", '<p onclick="vol()">Sig <script>x()</script><img src="http://distant.example/p.gif"></p>');
    assert.ok(!/script|onclick|<img|distant\.example/iu.test(corps), corps);
    assert.ok(corps.includes("Sig"));
  });
});

describe("départ d'une rédaction : la signature n'est jamais réinsérée dans un corps modifié", () => {
  it("le corps n'est pas touché tant que son HTML est celui du départ, même si l'objet change", () => {
    const depart = etatDeDepart({ id: "b1", genre: "reponse", message: MESSAGE, adressesPropres: [] });
    assert.equal(corpsNonTouche(depart, depart), true);
    assert.equal(corpsNonTouche({ ...depart, objet: "Re : autre objet" }, depart), true);
    assert.equal(corpsNonTouche({ ...depart, corpsHtml: depart.corpsHtml.replace("<p></p>", "<p>Bonjour</p>") }, depart), false);
  });
});

describe("compte d'envoi connu du poste", () => {
  const comptes = [
    { id: "c-perso", adresse: "perso@example.com", type_compte: "nominatif", titulaire_id: "u1" },
    { id: "c-partage", adresse: "contact@example.com", type_compte: "partage", titulaire_id: null },
  ];

  it("un message de la boîte nominative de l'utilisateur vient de son compte nominatif", () => {
    assert.equal(compteNominatifDuMessage({ titulaire_id: "u1" }, comptes, "u1"), "c-perso");
  });

  it("essai négatif : boîte partagée ou boîte d'un confrère, le poste ne sait pas, le serveur désigne le compte", () => {
    assert.equal(compteNominatifDuMessage({ titulaire_id: null }, comptes, "u1"), null);
    assert.equal(compteNominatifDuMessage({ titulaire_id: "u2" }, comptes, "u1"), null);
    assert.equal(compteNominatifDuMessage({ titulaire_id: "u1" }, comptes, null), null);
  });
});
