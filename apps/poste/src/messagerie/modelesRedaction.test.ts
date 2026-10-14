import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cacheVersTexte, cacheVide, lireCache, lireCacheDepuisTexte, majCache, type StockageTexte } from "./cacheRedaction.ts";
import { avecSignature, phraseConfirmationModele, planModele, SEPARATEUR_SIGNATURE, type ModeleMessage } from "./corpsRedaction.ts";
import {
  libelleTypeCompte,
  lireCompteDeComposition,
  lireComptes,
  lireModele,
  lireModeles,
  lireSignature,
  problemeModele,
  requeteCompteDeComposition,
  requeteComptes,
  requeteCreerModele,
  requeteEcrireSignature,
  requeteLireSignature,
  requeteModeles,
  requeteModifierModele,
  requeteSupprimerModele,
} from "./formesApiRedaction.ts";

const MODELE: ModeleMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  nom: "Accusé de réception fictif",
  objet: "Accusé de réception de vos pièces",
  corpsHtml: "<p>Maître,</p><p>Nous accusons réception de vos pièces.</p>",
};

const SIGNATURE = "<p>Me Fictif</p>";

describe("modèle de message : insertion dans le message en cours", () => {
  it("message neuf vide : l'objet et le corps du modèle entrent, sans confirmation", () => {
    const plan = planModele({ genre: "nouveau", objet: "", corpsHtml: "<p></p>" }, MODELE);
    assert.equal(plan.confirmation, false);
    assert.equal(plan.objet, MODELE.objet);
    assert.equal(plan.corpsHtml, MODELE.corpsHtml);
  });

  it("le corps du modèle prend la place de la saisie, sous la signature et avant l'historique : ceux-ci restent en place", () => {
    const courant = avecSignature("<p></p><blockquote><p>Le jeudi, Me Tiers a écrit :</p></blockquote>", SIGNATURE);
    const plan = planModele({ genre: "reponse", objet: "Re : Convocation", corpsHtml: courant }, MODELE);
    assert.equal(plan.confirmation, false);
    assert.equal(plan.objet, "Re : Convocation");
    assert.equal(
      plan.corpsHtml,
      `${MODELE.corpsHtml}${SEPARATEUR_SIGNATURE}${SIGNATURE}<blockquote><p>Le jeudi, Me Tiers a écrit :</p></blockquote>`,
    );
  });

  it("l'objet d'une réponse ou d'un transfert est celui du fil : le modèle n'y touche pas", () => {
    for (const genre of ["reponse", "reponse_a_tous", "transfert"]) {
      const plan = planModele({ genre, objet: "Re : fil", corpsHtml: "<p></p>" }, MODELE);
      assert.equal(plan.objet, "Re : fil", genre);
      assert.equal(plan.confirmation, false, genre);
    }
  });

  it("essai négatif : du texte déjà écrit n'est jamais remplacé sans confirmation", () => {
    const plan = planModele({ genre: "nouveau", objet: "", corpsHtml: "<p>Bonjour, je commence à écrire.</p>" }, MODELE);
    assert.equal(plan.confirmation, true);
    assert.deepEqual(plan.remplace, ["texte"]);
  });

  it("essai négatif : un objet déjà saisi et différent demande confirmation, le même objet non", () => {
    const autre = planModele({ genre: "nouveau", objet: "Mon objet", corpsHtml: "<p></p>" }, MODELE);
    assert.equal(autre.confirmation, true);
    assert.deepEqual(autre.remplace, ["objet"]);
    const meme = planModele({ genre: "nouveau", objet: MODELE.objet, corpsHtml: "<p></p>" }, MODELE);
    assert.equal(meme.confirmation, false);
  });

  it("texte et objet à la fois : la confirmation les nomme tous les deux", () => {
    const plan = planModele({ genre: "nouveau", objet: "Mon objet", corpsHtml: "<p>Mon texte</p>" }, MODELE);
    assert.deepEqual(plan.remplace, ["texte", "objet"]);
    assert.equal(phraseConfirmationModele(MODELE.nom, plan.remplace), `Le modèle « ${MODELE.nom} » remplacera votre texte et votre objet.`);
  });

  it("un modèle sans corps ne vide pas ce que l'utilisateur a écrit", () => {
    const vide: ModeleMessage = { ...MODELE, corpsHtml: "<p></p>", objet: "Objet seul" };
    const plan = planModele({ genre: "nouveau", objet: "", corpsHtml: "<p>Mon texte</p>" }, vide);
    assert.equal(plan.corpsHtml, "<p>Mon texte</p>");
    assert.equal(plan.confirmation, false);
    assert.equal(plan.objet, "Objet seul");
  });

  it("le corps d'un modèle est nettoyé avant d'entrer dans le message", () => {
    const plan = planModele(
      { genre: "nouveau", objet: "", corpsHtml: "<p></p>" },
      { ...MODELE, corpsHtml: '<p onclick="x()">Texte <script>mal()</script></p>' },
    );
    assert.ok(!/script|onclick/iu.test(plan.corpsHtml), plan.corpsHtml);
    assert.ok(plan.corpsHtml.includes("Texte"));
  });
});

describe("forme des appels à l'API : signatures, modèles, compte de composition", () => {
  const compteId = "00000000-0000-4000-8000-0000000000c1";

  it("signature : lecture et écriture sur la route du compte, HTML seul dans le corps", () => {
    assert.deepEqual(requeteLireSignature(compteId), { methode: "GET", chemin: `/messagerie/comptes/${compteId}/signature` });
    assert.deepEqual(requeteEcrireSignature(compteId, "<p>Sig</p>"), {
      methode: "PUT",
      chemin: `/messagerie/comptes/${compteId}/signature`,
      corps: { html: "<p>Sig</p>" },
    });
  });

  it("modèles : liste, création avec identifiant du client, modification partielle, suppression", () => {
    assert.deepEqual(requeteModeles(), { methode: "GET", chemin: "/messagerie/modeles" });
    assert.deepEqual(requeteCreerModele(MODELE.id, { nom: MODELE.nom, objet: MODELE.objet, corpsHtml: MODELE.corpsHtml }), {
      methode: "POST",
      chemin: "/messagerie/modeles",
      corps: { id: MODELE.id, nom: MODELE.nom, objet: MODELE.objet, corps_html: MODELE.corpsHtml, ordre: 0 },
    });
    assert.deepEqual(requeteModifierModele(MODELE.id, { nom: "Nouveau nom" }), {
      methode: "PATCH",
      chemin: `/messagerie/modeles/${MODELE.id}`,
      corps: { nom: "Nouveau nom" },
    });
    assert.deepEqual(requeteModifierModele(MODELE.id, { objet: "", corpsHtml: "<p>x</p>" }).corps, { objet: "", corps_html: "<p>x</p>" });
    assert.deepEqual(requeteSupprimerModele(MODELE.id), { methode: "DELETE", chemin: `/messagerie/modeles/${MODELE.id}` });
  });

  it("comptes et compte de composition", () => {
    assert.deepEqual(requeteComptes(), { methode: "GET", chemin: "/messagerie/comptes" });
    assert.deepEqual(requeteCompteDeComposition("nouveau", null), { methode: "POST", chemin: "/messagerie/composition", corps: { genre: "nouveau" } });
    assert.deepEqual(requeteCompteDeComposition("reponse", "m1"), {
      methode: "POST",
      chemin: "/messagerie/composition",
      corps: { genre: "reponse", message_id: "m1" },
    });
  });

  it("lecture des réponses de l'API", () => {
    assert.deepEqual(lireSignature({ compte_id: compteId, texte: "", html: "<p>Sig</p>", revision: 3 }, compteId), {
      compteId,
      html: "<p>Sig</p>",
      revision: 3,
    });
    // Une signature écrite sans mise en forme (texte seul) devient des paragraphes, échappés.
    assert.equal(lireSignature({ texte: "Me <Fictif>\n\nLyon", html: "" }, compteId).html, "<p>Me &lt;Fictif&gt;</p><p>Lyon</p>");
    assert.equal(lireSignature({ texte: "", html: "" }, compteId).html, "");
    assert.equal(lireSignature(null, compteId).compteId, compteId);
    assert.equal(lireCompteDeComposition({ compte_id: compteId, html: "" }), compteId);
    assert.equal(lireCompteDeComposition({}), null);
    assert.deepEqual(lireModele({ id: MODELE.id, nom: MODELE.nom, objet: MODELE.objet, corps_html: MODELE.corpsHtml, actif: true }), MODELE);
    assert.equal(lireModele({ nom: "sans id" }), null);
    assert.deepEqual(lireModeles([{ id: "a", nom: "A", objet: "", corps_html: "" }, 3, { nom: "sans id" }]), [{ id: "a", nom: "A", objet: "", corpsHtml: "" }]);
    assert.deepEqual(lireModeles("pas une liste"), []);
    assert.deepEqual(lireComptes([{ id: "c1", adresse: "a@example.com", type_compte: "classement" }, { adresse: "sans id" }]), [
      { id: "c1", adresse: "a@example.com", typeCompte: "classement" },
    ]);
    assert.equal(libelleTypeCompte("classement").titre, "Boîte du cabinet");
    assert.equal(libelleTypeCompte("partage").titre, "Boîte partagée");
    assert.equal(libelleTypeCompte("nominatif").titre, "Ma boîte");
  });

  it("essai négatif : un modèle sans nom, avec un retour à la ligne ou trop long est refusé avant l'appel", () => {
    assert.equal(problemeModele({ nom: "  ", objet: "", corpsHtml: "" }), "Donnez un nom au modèle.");
    assert.match(problemeModele({ nom: "Nom\nsuite", objet: "", corpsHtml: "" }) ?? "", /retour à la ligne/u);
    assert.match(problemeModele({ nom: "Nom", objet: "Objet\r\nBcc: x@example.com", corpsHtml: "" }) ?? "", /retour à la ligne/u);
    assert.match(problemeModele({ nom: "x".repeat(121), objet: "", corpsHtml: "" }) ?? "", /120 caractères/u);
    assert.match(problemeModele({ nom: "Nom", objet: "o".repeat(301), corpsHtml: "" }) ?? "", /300 caractères/u);
    assert.equal(problemeModele({ nom: "x".repeat(120), objet: "o".repeat(300), corpsHtml: "" }), null);
  });
});

function stockageFictif(): StockageTexte {
  const valeurs = new Map<string, string>();
  return {
    getItem: (cle) => valeurs.get(cle) ?? null,
    setItem: (cle, valeur) => {
      valeurs.set(cle, valeur);
    },
  };
}

describe("copie locale de la signature et des modèles (hors ligne)", () => {
  it("elle est relue pour le même utilisateur", () => {
    const stockage = stockageFictif();
    majCache(stockage, "u1", (cache) => ({ ...cache, signatures: { c1: "<p>Sig</p>" }, compteNouveau: "c1", modeles: [MODELE] }));
    const relue = lireCache(stockage, "u1");
    assert.deepEqual(relue?.signatures, { c1: "<p>Sig</p>" });
    assert.equal(relue?.compteNouveau, "c1");
    assert.deepEqual(relue?.modeles, [MODELE]);
  });

  it("essai négatif : la copie d'un autre utilisateur n'est jamais lue", () => {
    const stockage = stockageFictif();
    majCache(stockage, "u1", (cache) => ({ ...cache, signatures: { c1: "<p>Sig de u1</p>" } }));
    assert.deepEqual(lireCache(stockage, "u2")?.signatures, {});
    assert.equal(lireCache(stockage, null), null);
  });

  it("essai négatif : une copie illisible vaut une copie vide, sans exception", () => {
    assert.deepEqual(lireCacheDepuisTexte("{pas du json", "u1"), cacheVide("u1"));
    assert.deepEqual(lireCacheDepuisTexte('{"utilisateurId":"u1","signatures":{"c1":3,"c2":"ok"},"modeles":[{"id":"m"},4]}', "u1").signatures, { c2: "ok" });
    assert.deepEqual(lireCacheDepuisTexte('{"utilisateurId":"u1","modeles":[{"id":"m","nom":"N"},4]}', "u1").modeles, [
      { id: "m", nom: "N", objet: "", corpsHtml: "" },
    ]);
    assert.equal(cacheVersTexte(cacheVide("u1")).includes('"u1"'), true);
  });

  it("sans stockage, la rédaction fonctionne : rien n'est lu ni écrit", () => {
    assert.doesNotThrow(() => {
      majCache(null, "u1", (cache) => cache);
    });
    assert.deepEqual(lireCache(null, "u1"), cacheVide("u1"));
  });
});
