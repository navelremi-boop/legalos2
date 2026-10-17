import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cheminAction,
  cheminRecherche,
  corpsAction,
  destinationsDeplacement,
  fusionnerResultats,
  lireAction,
  lireRecherche,
  messageResultat,
  saisieRecherchable,
} from "./formesActionsMessages.ts";

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
