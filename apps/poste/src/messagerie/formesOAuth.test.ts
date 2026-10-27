import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adresseAutorisationOuvrable,
  libelleEtape,
  libelleFournisseur,
  lireDebut,
  lireEchange,
  lireApplicationOAuth,
  lireFournisseurs,
  lireRetourBouclage,
  messageEchecAppel,
  messageErreurRetour,
  redirectionBouclage,
  corpsEcrireApplicationOAuth,
  requeteApplicationOAuth,
  requeteDebut,
  requeteEchange,
  validerRetour,
} from "./formesOAuth.ts";

describe("identifiants d'application (D8)", () => {
  it("lit la présence, ignore une valeur d'identifiant", () => {
    assert.deepEqual(lireApplicationOAuth({ microsoft: true, gmail: false, client_secret: "x" }), {
      microsoft: true,
      gmail: false,
    });
    assert.equal(lireApplicationOAuth({ microsoft: true }), null);
    assert.equal(lireApplicationOAuth({}), null);
  });

  it("adresse la route d'application", () => {
    assert.deepEqual(requeteApplicationOAuth(), { methode: "GET", chemin: "/messagerie/oauth/application" });
  });

  it("le corps d'écriture n'envoie pas de secret vide", () => {
    assert.deepEqual(
      corpsEcrireApplicationOAuth({ fournisseur: "gmail", clientId: " id ", clientSecret: "  ", tenant: "x" }),
      { fournisseur: "gmail", client_id: "id", client_secret: null, tenant: null },
    );
  });
});

describe("fournisseurs proposés", () => {
  it("garde Microsoft 365 et Gmail annoncés par l'instance, avec les libellés du poste", () => {
    assert.deepEqual(
      lireFournisseurs({
        fournisseurs: [
          { id: "gmail", libelle: "texte venu du réseau" },
          { id: "microsoft", libelle: "<b>x</b>" },
        ],
      }),
      [
        { id: "microsoft", libelle: "Microsoft 365" },
        { id: "gmail", libelle: "Gmail" },
      ],
    );
  });

  it("ne propose jamais le simulateur ni un fournisseur inconnu, ni un doublon", () => {
    assert.deepEqual(
      lireFournisseurs({ fournisseurs: [{ id: "simulateur" }, { id: "yahoo" }, { id: "gmail" }, { id: "gmail" }, 3, null] }),
      [{ id: "gmail", libelle: "Gmail" }],
    );
  });

  it("une réponse vide ou illisible donne une liste vide", () => {
    assert.deepEqual(lireFournisseurs({ fournisseurs: [] }), []);
    assert.deepEqual(lireFournisseurs(null), []);
    assert.deepEqual(lireFournisseurs("x"), []);
    assert.deepEqual(lireFournisseurs({ fournisseurs: "microsoft" }), []);
  });

  it("libellés", () => {
    assert.equal(libelleFournisseur("microsoft"), "Microsoft 365");
    assert.equal(libelleFournisseur("gmail"), "Gmail");
    assert.equal(libelleFournisseur("autre"), "autre");
    assert.equal(libelleFournisseur(null), "");
  });
});

describe("demande de début", () => {
  it("la redirection est exactement l'adresse de bouclage du port écouté", () => {
    assert.equal(redirectionBouclage(50_123), "http://127.0.0.1:50123/");
    assert.equal(redirectionBouclage(1024), "http://127.0.0.1:1024/");
    assert.equal(redirectionBouclage(80), null);
    assert.equal(redirectionBouclage(0), null);
    assert.equal(redirectionBouclage(70_000), null);
    assert.equal(redirectionBouclage(1.5), null);
    assert.equal(redirectionBouclage(Number.NaN), null);
  });

  it("le corps porte l'identifiant, l'adresse nettoyée, le fournisseur et la redirection", () => {
    const requete = requeteDebut({
      id: "9b2f6c0e-0000-4000-8000-000000000001",
      adresse: "  j.marchal@cabinet.example ",
      fournisseur: "microsoft",
      redirection: "http://127.0.0.1:50123/",
    });
    assert.equal(requete.methode, "POST");
    assert.equal(requete.chemin, "/messagerie/oauth/debut");
    assert.deepEqual(requete.corps, {
      id: "9b2f6c0e-0000-4000-8000-000000000001",
      adresse: "j.marchal@cabinet.example",
      fournisseur: "microsoft",
      redirection: "http://127.0.0.1:50123/",
    });
  });

  it("le supplément de recette s'ajoute sans jamais remplacer les champs du contrat", () => {
    const requete = requeteDebut({
      id: "i",
      adresse: "a@b.example",
      fournisseur: "simulateur",
      redirection: "http://127.0.0.1:50123/",
      supplement: { auth_url: "http://127.0.0.1:1/authorize", fournisseur: "microsoft", redirection: "http://evil.example/" },
    });
    assert.equal((requete.corps as Record<string, unknown>).auth_url, "http://127.0.0.1:1/authorize");
    assert.equal((requete.corps as Record<string, unknown>).fournisseur, "simulateur");
    assert.equal((requete.corps as Record<string, unknown>).redirection, "http://127.0.0.1:50123/");
  });

  it("lit la réponse du début, refuse une réponse incomplète", () => {
    assert.deepEqual(lireDebut({ state: "s", url: "https://login.example/authorize?x=1" }), {
      state: "s",
      url: "https://login.example/authorize?x=1",
    });
    assert.equal(lireDebut({ state: "", url: "https://x.example/" }), null);
    assert.equal(lireDebut({ state: "s" }), null);
    assert.equal(lireDebut(null), null);
  });

  it("l'adresse d'autorisation est en https ; http seulement en recette", () => {
    assert.equal(adresseAutorisationOuvrable("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1", false), true);
    assert.equal(adresseAutorisationOuvrable("http://127.0.0.1:18766/authorize", false), false);
    assert.equal(adresseAutorisationOuvrable("http://127.0.0.1:18766/authorize", true), true);
    for (const mauvaise of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-msdt:/id", "https://u:p@x.example/", "pas une adresse", ""]) {
      assert.equal(adresseAutorisationOuvrable(mauvaise, true), false, mauvaise);
    }
  });
});

describe("retour du navigateur", () => {
  it("un retour cohérent passe", () => {
    assert.deepEqual(validerRetour({ code: "le-code", state: "s1", erreur: null }, "s1"), {
      ok: true,
      code: "le-code",
      state: "s1",
    });
  });

  it("un state différent est refusé, sans rien à envoyer", () => {
    const verdict = validerRetour({ code: "le-code", state: "autre", erreur: null }, "s1");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.annule, false);
      assert.match(verdict.message, /ne correspond pas à la demande/u);
    }
  });

  it("un state attendu vide ne valide rien", () => {
    assert.equal(validerRetour({ code: "c", state: "", erreur: null }, "").ok, false);
    assert.equal(validerRetour({ code: "c", state: "s", erreur: null }, "").ok, false);
  });

  it("un code ou un state manquant est refusé", () => {
    assert.equal(validerRetour({ code: null, state: "s1", erreur: null }, "s1").ok, false);
    assert.equal(validerRetour({ code: "c", state: null, erreur: null }, "s1").ok, false);
  });

  it("un refus du fournisseur donne un message français, même avec un code et un state", () => {
    const verdict = validerRetour({ code: "c", state: "s1", erreur: "access_denied" }, "s1");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.match(verdict.message, /refusée dans le navigateur/u);
  });

  it("l'annulation et le délai sont distingués", () => {
    const annule = validerRetour({ code: null, state: null, erreur: "annule" }, "s1");
    assert.equal(annule.ok === false && annule.annule, true);
    const delai = validerRetour({ code: null, state: null, erreur: "delai_depasse" }, "s1");
    assert.equal(delai.ok === false && delai.annule, false);
    assert.match(messageErreurRetour("delai_depasse"), /délai est dépassé/u);
  });

  it("un code d'erreur inconnu reste un message français, sans reprendre un texte douteux", () => {
    assert.match(messageErreurRetour("invalid_scope"), /refusé la connexion \(invalid_scope\)/u);
    assert.equal(messageErreurRetour("<script>"), "Le fournisseur a refusé la connexion.");
    assert.match(messageErreurRetour("temporarily_unavailable"), /momentanément indisponible/u);
  });

  it("lit la réponse de la commande d'attente", () => {
    assert.deepEqual(lireRetourBouclage({ code: "c", state: "s" }), { code: "c", state: "s", erreur: null });
    assert.deepEqual(lireRetourBouclage({ erreur: "access_denied" }), { code: null, state: null, erreur: "access_denied" });
    assert.deepEqual(lireRetourBouclage(null), { code: null, state: null, erreur: null });
    assert.deepEqual(lireRetourBouclage({ code: 3, state: "" }), { code: null, state: null, erreur: null });
  });
});

describe("échange du code", () => {
  it("le corps ne porte que le state et le code", () => {
    assert.deepEqual(requeteEchange("s1", "le-code"), {
      methode: "POST",
      chemin: "/messagerie/oauth/echange",
      corps: { state: "s1", code: "le-code" },
    });
  });

  it("lit la réponse de l'échange", () => {
    assert.deepEqual(lireEchange({ id: "i", adresse: "a@b.example", fournisseur: "gmail", reconnexion: true }), {
      id: "i",
      adresse: "a@b.example",
      fournisseur: "gmail",
      reconnexion: true,
    });
    assert.equal(lireEchange({ adresse: "a@b.example" }), null);
    assert.equal(lireEchange(undefined), null);
  });

  it("messages d'échec en français", () => {
    assert.equal(messageEchecAppel("echange", 0, ""), "L'instance est injoignable.");
    assert.match(messageEchecAppel("echange", 404, "Élément introuvable."), /expiré ou a déjà été utilisée/u);
    assert.match(messageEchecAppel("echange", 400, "x"), /refusé d'échanger/u);
    assert.match(messageEchecAppel("echange", 500, ""), /n'a pas pu terminer/u);
    assert.match(messageEchecAppel("debut", 400, "Ce fournisseur n'est pas configuré."), /pas configuré/u);
    assert.match(messageEchecAppel("debut", 500, ""), /n'a pas pu préparer/u);
    assert.match(messageEchecAppel("debut", 401, ""), /session a expiré/u);
  });

  it("libellés d'étape", () => {
    assert.equal(libelleEtape("ouverture"), "Ouverture du navigateur…");
    assert.equal(libelleEtape("attente"), "En attente de l'autorisation dans le navigateur…");
    assert.equal(libelleEtape("echange"), "Finalisation de la connexion…");
  });
});
