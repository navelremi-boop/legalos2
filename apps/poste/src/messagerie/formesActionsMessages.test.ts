import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cheminAction,
  cheminDossiersImap,
  cheminRecherche,
  compteDeplacement,
  corpsAction,
  destinationsDeplacement,
  destinationsDepuisServeur,
  destinationsLocales,
  fusionnerResultats,
  lireAction,
  lireDossiersImap,
  lireRecherche,
  messageResultat,
  saisieRecherchable,
} from "./formesActionsMessages.ts";
import type { CompteLocal } from "./typesMails.ts";

const MOI = "u-moi";

describe("requête d'action", () => {
  it("le chemin protège l'identifiant", () => {
    assert.equal(cheminAction("a/b c"), "/messagerie/messages/a%2Fb%20c/actions");
  });

  it("la destination ne figure que pour déplacer, la clé d'idempotence toujours", () => {
    assert.deepEqual(corpsAction("archiver", "k1"), { genre: "archiver", idempotence_cle: "k1" });
    assert.deepEqual(corpsAction("deplacer", "k2", "Suivi"), {
      genre: "deplacer",
      destination: "Suivi",
      idempotence_cle: "k2",
    });
  });
});

describe("réponse d'action", () => {
  it("lit une action appliquée", () => {
    const action = lireAction({ id: "x", etat: "appliquee", erreur: null, dossier_final: "Archives", rejeu: false });
    assert.deepEqual(action, { id: "x", etat: "appliquee", erreur: null, dossierFinal: "Archives", rejeu: false });
  });

  it("une réponse illisible ne devient jamais un succès", () => {
    const action = lireAction("n'importe quoi");
    assert.equal(action.etat, "");
    assert.equal(messageResultat("archiver", action).texte.startsWith("Demande enregistrée"), true);
    assert.equal(lireAction(null).id, "");
  });

  it("dit ce qui s'est passé, et ne prétend pas qu'une action en attente est faite", () => {
    const fait = messageResultat("supprimer", { id: "x", etat: "appliquee", erreur: null, dossierFinal: null, rejeu: false });
    assert.deepEqual(fait, { ok: true, texte: "Déplacé dans la corbeille." });
    const attente = messageResultat("lu", { id: "x", etat: "en_attente", erreur: "connexion", dossierFinal: null, rejeu: false });
    assert.equal(attente.ok, true);
    assert.equal(attente.texte.includes("Marqué"), false);
    const echec = messageResultat("deplacer", { id: "x", etat: "echec", erreur: "message_absent", dossierFinal: null, rejeu: false });
    assert.equal(echec.ok, false);
  });
});

describe("destinations de « Déplacer »", () => {
  const mail = (dossier_imap: string | null, titulaire_id: string | null) => ({ dossier_imap, titulaire_id });

  it("réception et archives, plus les dossiers de ma boîte, sans le dossier actuel", () => {
    const tous = [mail("INBOX", MOI), mail("Suivi", MOI), mail("Archives", MOI), mail("Autre boîte", null), mail("Suivi", MOI)];
    assert.deepEqual(destinationsDeplacement(mail("INBOX", MOI), tous, MOI), ["Archives", "Suivi"]);
    assert.deepEqual(destinationsDeplacement(mail("Suivi", MOI), tous, MOI), ["Archives", "INBOX"]);
  });

  it("n'emprunte jamais un dossier d'une autre boîte", () => {
    const tous = [mail("INBOX", MOI), mail("Dossier du cabinet", null)];
    assert.equal(destinationsDeplacement(mail("INBOX", MOI), tous, MOI).includes("Dossier du cabinet"), false);
    assert.equal(destinationsDeplacement(mail("INBOX", null), tous, MOI).includes("Dossier du cabinet"), true);
  });

  it("un dossier vide vaut la réception", () => {
    assert.deepEqual(destinationsDeplacement(mail("", MOI), [], MOI), ["Archives"]);
  });
});

describe("recherche sur le serveur", () => {
  it("le chemin encode la saisie", () => {
    assert.equal(cheminRecherche(" bail commercial "), "/messagerie/recherche?q=bail%20commercial&limite=50");
    assert.equal(cheminRecherche("a&b=c#d"), "/messagerie/recherche?q=a%26b%3Dc%23d&limite=50");
  });

  it("lit les résultats, écarte ceux sans identifiant", () => {
    const lu = lireRecherche({
      resultats: [{ id: "m1", objet: "Bail", dossier_imap: "INBOX" }, { objet: "sans id" }, "x"],
      a_suivre: true,
    });
    assert.deepEqual(lu, { resultats: [{ id: "m1", objet: "Bail", dossierImap: "INBOX" }], aSuivre: true });
    assert.deepEqual(lireRecherche(undefined), { resultats: [], aSuivre: false });
  });

  it("une saisie sans mot de deux caractères n'est pas envoyée", () => {
    assert.equal(saisieRecherchable("a"), false);
    assert.equal(saisieRecherchable("  % _ "), false);
    assert.equal(saisieRecherchable("a b"), false);
    assert.equal(saisieRecherchable("ab"), true);
    assert.equal(saisieRecherchable("bail 12"), true);
  });

  it("fusionne les trouvés du poste puis du serveur, sans doublon", () => {
    assert.deepEqual(
      fusionnerResultats([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((r) => r.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(fusionnerResultats([], []), []);
  });
});

describe("liste des dossiers IMAP du serveur (Déplacer)", () => {
  const reponse = {
    dossiers: [
      { nom: "INBOX", libelle: "Réception", role: "reception", existe: true },
      { nom: "Archive", libelle: "Archives", role: "archives", existe: true },
      { nom: "Trash", libelle: "Corbeille", role: "corbeille", existe: false },
      { nom: "Clients/Suivi", libelle: "Clients/Suivi", role: null, existe: true },
    ],
  };

  it("le chemin protège l'identifiant du compte", () => {
    assert.equal(cheminDossiersImap("a/b"), "/messagerie/comptes/a%2Fb/dossiers");
  });

  it("la réponse de l'API est lue avec ses noms français et ses rôles", () => {
    const liste = lireDossiersImap(reponse);
    assert.equal(liste.length, 4);
    assert.deepEqual(liste[1], { nom: "Archive", libelle: "Archives", role: "archives", existe: true });
    assert.equal(liste[2]?.existe, false);
    assert.equal(liste[3]?.role, null);
  });

  it("essai négatif : une réponse illisible ne donne aucun dossier, un dossier sans nom est ignoré", () => {
    assert.deepEqual(lireDossiersImap(null), []);
    assert.deepEqual(lireDossiersImap({ dossiers: "x" }), []);
    assert.deepEqual(lireDossiersImap({ dossiers: [{ libelle: "Sans nom" }, { nom: "Suivi" }] }), [
      { nom: "Suivi", libelle: "Suivi", role: null, existe: true },
    ]);
  });

  it("« Déplacer » propose les dossiers du serveur, dans son ordre, sans le dossier où se trouve le message", () => {
    const liste = lireDossiersImap(reponse);
    const noms = (dossierImap: string | null) => destinationsDepuisServeur(liste, { dossier_imap: dossierImap }).map((d) => d.nom);
    assert.deepEqual(noms("INBOX"), ["Archive", "Trash", "Clients/Suivi"]);
    assert.deepEqual(noms(null), ["Archive", "Trash", "Clients/Suivi"]);
    assert.deepEqual(noms("Clients/Suivi"), ["INBOX", "Archive", "Trash"]);
    assert.equal(destinationsDepuisServeur(liste, { dossier_imap: "INBOX" })[0]?.libelle, "Archives");
  });

  it("essai négatif : le nom IMAP du serveur est envoyé tel quel, jamais son libellé français", () => {
    const liste = lireDossiersImap(reponse);
    const archive = destinationsDepuisServeur(liste, { dossier_imap: "INBOX" }).find((d) => d.libelle === "Archives");
    assert.equal(archive?.nom, "Archive");
    assert.notEqual(archive?.nom, "Archives");
  });

  it("sans réponse du serveur, les dossiers du poste restent proposés, avec leurs libellés français", () => {
    const locales = destinationsLocales({ dossier_imap: "INBOX", titulaire_id: MOI }, [{ dossier_imap: "Suivi", titulaire_id: MOI }], MOI);
    assert.deepEqual(locales.map((d) => d.nom), ["Archives", "Suivi"]);
  });
});

describe("compte dont on demande les dossiers", () => {
  const nominatif: CompteLocal = { id: "c1", adresse: "moi@cabinet.example", type_compte: "nominatif", titulaire_id: MOI };
  const partage: CompteLocal = { id: "c2", adresse: "contact@cabinet.example", type_compte: "partage" };
  const autrePartage: CompteLocal = { id: "c3", adresse: "greffe@cabinet.example", type_compte: "partage" };

  it("message de l'utilisateur : sa boîte nominative", () => {
    assert.equal(compteDeplacement({ dossier_imap: "INBOX", titulaire_id: MOI }, [nominatif, partage], MOI), "c1");
  });
  it("message d'une boîte partagée : l'unique boîte partagée", () => {
    assert.equal(compteDeplacement({ dossier_imap: "INBOX", titulaire_id: null }, [nominatif, partage], MOI), "c2");
  });
  it("essai négatif : plusieurs boîtes partagées, le poste ne devine pas le compte", () => {
    assert.equal(compteDeplacement({ dossier_imap: "INBOX", titulaire_id: null }, [nominatif, partage, autrePartage], MOI), null);
  });
  it("essai négatif : le message d'un confrère n'ouvre la liste d'aucun compte", () => {
    assert.equal(compteDeplacement({ dossier_imap: "INBOX", titulaire_id: "u-autre" }, [nominatif, partage], MOI), null);
  });
});
