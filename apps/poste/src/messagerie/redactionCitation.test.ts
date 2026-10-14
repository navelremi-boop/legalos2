import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aUnHistorique,
  corpsDeDepart,
  dateCitation,
  destinatairesDepart,
  echapperHtml,
  filDeReponse,
  historiqueCite,
  mentionDOrigine,
  objetRedaction,
  paragraphesHtml,
  texteDeLaCitationServeur,
  type MessageCite,
} from "./citation.ts";
import { etatDeDepart } from "./etatRedaction.ts";
import { problemesHtml } from "./nettoyageHtml.ts";

const PROPRES = ["moi@cabinet.example", "contact@cabinet.example"];

const MESSAGE: MessageCite = {
  id: "11111111-1111-4111-8111-111111111111",
  message_id: "<orig-1@perrin-avocats.example>",
  objet: "Conclusions en réplique",
  expediteur: "Me Anne Perrin <a.perrin@perrin-avocats.example>",
  destinataires_texte: "moi@cabinet.example, Greffe <greffe@justice.example>, client@exemple.example",
  cree_le: "2026-10-08T10:12:00+02:00",
  texte: "Mon cher Confrère,\n\nVoici nos conclusions.\nBien confraternellement.",
  pieces: ["Conclusions.pdf", "Pièces 1 à 4.zip"],
};

describe("citation : objet", () => {
  it("réponse et transfert ajoutent leur préfixe une seule fois", () => {
    assert.equal(objetRedaction("reponse", "Audience"), "Re : Audience");
    assert.equal(objetRedaction("reponse_a_tous", "Audience"), "Re : Audience");
    assert.equal(objetRedaction("transfert", "Audience"), "Tr : Audience");
    assert.equal(objetRedaction("nouveau", " Audience "), "Audience");
  });

  it("essai négatif : un préfixe déjà présent n'est pas doublé, quelle que soit sa forme", () => {
    assert.equal(objetRedaction("reponse", "Re : Audience"), "Re : Audience");
    assert.equal(objetRedaction("reponse", "RE: Audience"), "RE: Audience");
    assert.equal(objetRedaction("transfert", "Fwd: Audience"), "Fwd: Audience");
    assert.equal(objetRedaction("transfert", "TR : Audience"), "TR : Audience");
    assert.equal(objetRedaction("reponse", "Reunion"), "Re : Reunion");
    assert.equal(objetRedaction("reponse", null), "Re :");
  });
});

describe("citation : destinataires de départ", () => {
  it("répondre écrit à l'expéditeur seul", () => {
    const { a, cc } = destinatairesDepart("reponse", MESSAGE, PROPRES);
    assert.deepEqual(a.map((d) => d.adresse), ["a.perrin@perrin-avocats.example"]);
    assert.deepEqual(cc, []);
  });

  it("répondre à tous : l'expéditeur en À, les autres en Cc, sans l'adresse du cabinet", () => {
    const { a, cc } = destinatairesDepart("reponse_a_tous", MESSAGE, PROPRES);
    assert.deepEqual(a.map((d) => d.adresse), ["a.perrin@perrin-avocats.example"]);
    assert.deepEqual(cc.map((d) => d.adresse), ["greffe@justice.example", "client@exemple.example"]);
  });

  it("essai négatif : ni l'expéditeur ni la boîte partagée ne se retrouvent en copie", () => {
    const message: MessageCite = {
      ...MESSAGE,
      destinataires_texte: "contact@cabinet.example, A.Perrin@perrin-avocats.example, tiers@exemple.example",
    };
    const { a, cc } = destinatairesDepart("reponse_a_tous", message, PROPRES);
    assert.deepEqual(a.map((d) => d.adresse), ["a.perrin@perrin-avocats.example"]);
    assert.deepEqual(cc.map((d) => d.adresse), ["tiers@exemple.example"]);
  });

  it("répondre à un message qu'on a écrit soi-même écrit à ses destinataires", () => {
    const message: MessageCite = { ...MESSAGE, expediteur: "Moi <moi@cabinet.example>", destinataires_texte: "x@exemple.example" };
    const { a } = destinatairesDepart("reponse", message, PROPRES);
    assert.deepEqual(a.map((d) => d.adresse), ["x@exemple.example"]);
  });

  it("transfert et message neuf : aucun destinataire", () => {
    assert.deepEqual(destinatairesDepart("transfert", MESSAGE, PROPRES), { a: [], cc: [] });
    assert.deepEqual(destinatairesDepart("nouveau", MESSAGE, PROPRES), { a: [], cc: [] });
  });
});

describe("citation : fil de discussion", () => {
  it("une réponse pose In-Reply-To et References sur l'identifiant du message", () => {
    assert.deepEqual(filDeReponse("reponse", MESSAGE), {
      enReponseA: "<orig-1@perrin-avocats.example>",
      references: ["<orig-1@perrin-avocats.example>"],
    });
    assert.equal(filDeReponse("reponse_a_tous", MESSAGE).enReponseA, "<orig-1@perrin-avocats.example>");
  });

  it("essai négatif : un transfert ou un message sans identifiant n'ouvre aucun fil", () => {
    assert.deepEqual(filDeReponse("transfert", MESSAGE), { enReponseA: null, references: [] });
    assert.deepEqual(filDeReponse("reponse", { message_id: null }), { enReponseA: null, references: [] });
  });
});

describe("citation : historique cité", () => {
  it("la date de la mention est en français, à l'heure de Paris", () => {
    assert.match(dateCitation("2026-10-08T10:12:00+02:00"), /^jeudi 8 octobre 2026 à 10\s?h\s?12$/u);
    assert.equal(dateCitation(null), "");
    assert.match(mentionDOrigine(MESSAGE), /^Le jeudi 8 octobre 2026 à 10\s?h\s?12, Me Anne Perrin <a\.perrin@perrin-avocats\.example> a écrit :$/u);
  });

  it("une réponse cite le message dans un bloc de citation, après la mention d'origine", () => {
    const html = historiqueCite("reponse", MESSAGE);
    assert.ok(html.startsWith("<blockquote><p>Le jeudi 8 octobre 2026"));
    assert.match(html, /a écrit :<\/p><p>Mon cher Confrère,<\/p><p>Voici nos conclusions\.<br>Bien confraternellement\.<\/p><\/blockquote>$/u);
    assert.equal(aUnHistorique(`<p></p>${html}`), true);
    assert.equal(aUnHistorique("<p>Bonjour</p>"), false);
  });

  it("un transfert cite l'en-tête du message d'origine (de, date, objet, à), puis son texte", () => {
    const html = historiqueCite("transfert", MESSAGE);
    assert.ok(html.includes("---------- Message transféré ----------"));
    assert.ok(html.includes("De : Me Anne Perrin &lt;a.perrin@perrin-avocats.example&gt;"));
    assert.ok(html.includes("Objet : Conclusions en réplique"));
    assert.ok(html.includes("À : moi@cabinet.example, Greffe &lt;greffe@justice.example&gt;, client@exemple.example"));
    assert.ok(html.includes("Voici nos conclusions."));
  });

  it("essai négatif : le texte d'un tiers n'est jamais du balisage", () => {
    const hostile: MessageCite = {
      ...MESSAGE,
      objet: "<img src=http://distant.example/a.png onerror=alert(1)>",
      expediteur: '"<script>alert(1)</script>" <x@exemple.example>',
      texte: "<script>alert(1)</script>\n\n<img src=http://distant.example/pixel.gif>\n\n<a href=\"javascript:alert(1)\">clic</a>",
    };
    for (const genre of ["reponse", "transfert"] as const) {
      const html = corpsDeDepart(genre, hostile);
      assert.deepEqual(problemesHtml(html), [], genre);
      assert.equal(/<script|<img|<a\b/iu.test(html), false, genre);
    }
  });

  it("échappement du HTML et paragraphes", () => {
    assert.equal(echapperHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
    assert.equal(paragraphesHtml("a\nb\n\nc"), "<p>a<br>b</p><p>c</p>");
    assert.equal(paragraphesHtml("  \n\n "), "");
  });

  it("le document de départ ouvre sur un paragraphe vide à écrire, avant l'historique", () => {
    assert.equal(corpsDeDepart("nouveau", null), "<p></p>");
    assert.ok(corpsDeDepart("reponse", MESSAGE).startsWith("<p></p><blockquote>"));
  });
});

describe("état de départ d'une rédaction", () => {
  it("réponse à tous : destinataires, objet, fil, historique, dossier et origine", () => {
    const etat = etatDeDepart({
      id: "22222222-2222-4222-8222-222222222222",
      genre: "reponse_a_tous",
      message: MESSAGE,
      adressesPropres: PROPRES,
      dossierId: "d-1",
    });
    assert.equal(etat.genre, "reponse_a_tous");
    assert.equal(etat.origineMessageId, MESSAGE.id);
    assert.equal(etat.objet, "Re : Conclusions en réplique");
    assert.deepEqual(etat.a.map((d) => d.adresse), ["a.perrin@perrin-avocats.example"]);
    assert.deepEqual(etat.cc.map((d) => d.adresse), ["greffe@justice.example", "client@exemple.example"]);
    assert.equal(etat.enReponseA, "<orig-1@perrin-avocats.example>");
    assert.equal(etat.dossierId, "d-1");
    assert.ok(aUnHistorique(etat.corpsHtml));
  });

  it("message neuf : tout est vide, rien n'est cité", () => {
    const etat = etatDeDepart({ id: "x", genre: "nouveau", message: null, adressesPropres: PROPRES });
    assert.deepEqual([etat.a, etat.cc, etat.cci], [[], [], []]);
    assert.equal(etat.objet, "");
    assert.equal(etat.origineMessageId, null);
    assert.equal(aUnHistorique(etat.corpsHtml), false);
  });
});

describe("citation : texte lu par le serveur quand le poste n'a pas le corps", () => {
  it("la mention du serveur est retirée, le texte du message reste", () => {
    const html = "<p>Signature</p><blockquote><p>Me X &lt;x@exemple.example&gt; a écrit :</p><p>Bonjour,</p><p>Merci de confirmer.<br>Cordialement.</p></blockquote>";
    assert.equal(texteDeLaCitationServeur(html), "Bonjour,\n\nMerci de confirmer.\nCordialement.");
  });

  it("essai négatif : sans citation ou avec du contenu actif, rien d'actif ne passe", () => {
    assert.equal(texteDeLaCitationServeur("<p>Pas de citation</p>"), "");
    assert.equal(texteDeLaCitationServeur(""), "");
    const hostile = '<blockquote><p>a écrit :</p><p>texte</p><script>alert(1)</script><img src="http://distant.example/p.gif"></blockquote>';
    assert.equal(texteDeLaCitationServeur(hostile), "texte");
  });
});
