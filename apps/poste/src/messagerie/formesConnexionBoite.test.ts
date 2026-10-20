import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  champsVides,
  portImapParDefaut,
  problemeConnexion,
  requeteAjouterBoite,
  requeteReconnecterBoite,
  verificationTerminee,
  type ChampsConnexion,
} from "./formesConnexionBoite.ts";

function valides(extra: Partial<ChampsConnexion> = {}): ChampsConnexion {
  return {
    ...champsVides("j.marchal@cabinet.example"),
    hote: "imap.cabinet.example",
    utilisateur: "j.marchal",
    motDePasse: "MotDePasse-1!",
    ...extra,
  };
}

describe("validation de la saisie", () => {
  it("une saisie complète passe", () => {
    assert.equal(problemeConnexion(valides(), "ajout"), null);
    assert.equal(problemeConnexion(valides({ adresse: "" }), "reconnexion"), null);
  });

  it("l'adresse n'est exigée qu'à l'ajout", () => {
    assert.match(problemeConnexion(valides({ adresse: "pas une adresse" }), "ajout") ?? "", /adresse de la boîte/u);
    assert.match(problemeConnexion(valides({ adresse: "a@b" }), "ajout") ?? "", /adresse de la boîte/u);
  });

  it("serveur, port, identifiant et mot de passe sont requis", () => {
    assert.match(problemeConnexion(valides({ hote: " " }), "ajout") ?? "", /serveur IMAP/u);
    assert.match(problemeConnexion(valides({ hote: "imap exemple" }), "ajout") ?? "", /ni espace/u);
    assert.match(problemeConnexion(valides({ port: "0" }), "ajout") ?? "", /port IMAP/u);
    assert.match(problemeConnexion(valides({ port: "70000" }), "ajout") ?? "", /port IMAP/u);
    assert.match(problemeConnexion(valides({ port: "9a3" }), "ajout") ?? "", /port IMAP/u);
    assert.match(problemeConnexion(valides({ utilisateur: "" }), "ajout") ?? "", /identifiant/u);
    assert.match(problemeConnexion(valides({ motDePasse: "" }), "ajout") ?? "", /mot de passe/u);
  });

  it("un mot de passe avec espaces en bordure est conservé tel quel", () => {
    const corps = requeteReconnecterBoite("c1", valides({ motDePasse: " a b " })).corps;
    assert.equal(corps?.mot_de_passe, " a b ");
  });

  it("l'envoi SMTP est complet ou absent", () => {
    assert.match(problemeConnexion(valides({ smtpPort: "587" }), "ajout") ?? "", /serveur SMTP/u);
    assert.match(problemeConnexion(valides({ smtpMotDePasse: "x" }), "ajout") ?? "", /serveur SMTP/u);
    assert.equal(problemeConnexion(valides({ smtpHote: "smtp.cabinet.example", smtpPort: "587" }), "ajout"), null);
    assert.match(problemeConnexion(valides({ smtpHote: "smtp.cabinet.example", smtpPort: "x" }), "ajout") ?? "", /port SMTP/u);
  });

  it("l'adresse de réponse est une adresse", () => {
    assert.match(problemeConnexion(valides({ repondreA: "greffe" }), "ajout") ?? "", /adresse de réponse/u);
    assert.equal(problemeConnexion(valides({ repondreA: "greffe@cabinet.example" }), "ajout"), null);
  });
});

describe("corps des requêtes", () => {
  it("l'ajout envoie un identifiant neuf, l'adresse nettoyée et seulement les réglages saisis", () => {
    const requete = requeteAjouterBoite("id-1", valides({ adresse: "  j.marchal@cabinet.example ", hote: " imap.cabinet.example " }));
    assert.equal(requete.methode, "POST");
    assert.equal(requete.chemin, "/messagerie/comptes");
    assert.deepEqual(requete.corps, {
      id: "id-1",
      adresse: "j.marchal@cabinet.example",
      hote: "imap.cabinet.example",
      port: 993,
      utilisateur: "j.marchal",
      mot_de_passe: "MotDePasse-1!",
      tls: true,
    });
  });

  it("les réglages d'envoi ne partent que si un serveur SMTP est saisi", () => {
    const sans = requeteAjouterBoite("id", valides({ smtpPort: "" })).corps ?? {};
    assert.equal("smtp_hote" in sans, false);
    const avec = requeteAjouterBoite(
      "id",
      valides({ smtpHote: "smtp.cabinet.example", smtpPort: "587", smtpUtilisateur: "u", smtpMotDePasse: "s", repondreA: "g@cabinet.example" }),
    ).corps ?? {};
    assert.deepEqual(
      { h: avec.smtp_hote, p: avec.smtp_port, u: avec.smtp_utilisateur, s: avec.smtp_mot_de_passe, r: avec.repondre_a },
      { h: "smtp.cabinet.example", p: 587, u: "u", s: "s", r: "g@cabinet.example" },
    );
  });

  it("la reconnexion vise le compte, sans adresse ni identifiant dans le corps", () => {
    const requete = requeteReconnecterBoite("a/b", valides());
    assert.equal(requete.methode, "PUT");
    assert.equal(requete.chemin, "/messagerie/comptes/a%2Fb/connexion");
    assert.equal("id" in (requete.corps ?? {}), false);
    assert.equal("adresse" in (requete.corps ?? {}), false);
  });
});

describe("autres règles", () => {
  it("port par défaut selon le chiffrement", () => {
    assert.equal(portImapParDefaut(true), "993");
    assert.equal(portImapParDefaut(false), "143");
  });

  it("la vérification se termine sur connectée ou refusée, jamais sur inconnue", () => {
    assert.equal(verificationTerminee("connecte"), true);
    assert.equal(verificationTerminee("identifiants_refuses"), true);
    assert.equal(verificationTerminee("inconnu"), false);
    assert.equal(verificationTerminee(""), false);
  });
});
