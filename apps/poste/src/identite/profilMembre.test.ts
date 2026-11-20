import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliquerSaisie,
  corpsModificationProfil,
  messageErreurProfil,
  profilDepuisJson,
  profilsDepuisJson,
  saisieDepuisProfil,
  saisieNette,
  validerProfil,
  type ProfilMembre,
  type ProfilSaisie,
} from "./profilMembre.ts";

const PROFIL: ProfilMembre = {
  id: "u1",
  email: "demo@cabinet.example",
  role: "administrateur",
  actif: true,
  civilite: null,
  prenom: null,
  nom: null,
  qualite: null,
  barreau: null,
  toque: null,
  revision: 3,
};

const SAISIE_VIDE: ProfilSaisie = saisieDepuisProfil(PROFIL);

describe("profil d'un membre : lecture de l'API", () => {
  it("lit une réponse complète et laisse vides les champs non saisis", () => {
    const profil = profilDepuisJson({
      id: "u1",
      email: "a@c.example",
      role: "collaborateur",
      actif: true,
      civilite: "madame",
      prenom: " Claire ",
      nom: "Roux",
      qualite: "avocat",
      barreau: null,
      revision: 2,
    });
    assert.deepEqual(profil, {
      id: "u1",
      email: "a@c.example",
      role: "collaborateur",
      actif: true,
      civilite: "madame",
      prenom: "Claire",
      nom: "Roux",
      qualite: "avocat",
      barreau: null,
      toque: null,
      revision: 2,
    });
  });

  it("refuse une réponse sans identifiant, sans e-mail ou sans version", () => {
    assert.equal(profilDepuisJson({ email: "a@c.example", revision: 1 }), null);
    assert.equal(profilDepuisJson({ id: "u1", revision: 1 }), null);
    assert.equal(profilDepuisJson({ id: "u1", email: "a@c.example" }), null);
    assert.equal(profilDepuisJson(null), null);
    assert.deepEqual(profilsDepuisJson({ pas: "une liste" }), []);
  });
});

describe("profil d'un membre : contrôles avant l'envoi", () => {
  it("accepte une saisie vide : l'identité reste à compléter", () => {
    assert.deepEqual(validerProfil(SAISIE_VIDE), {});
  });

  it("refuse une civilité ou une qualité hors liste", () => {
    const erreurs = validerProfil({ ...SAISIE_VIDE, civilite: "docteur", qualite: "stagiaire" });
    assert.equal(erreurs.civilite, "Choisissez Madame ou Monsieur.");
    assert.equal(erreurs.qualite, "Choisissez une qualité de la liste.");
  });

  it("refuse un prénom, un nom et une toque trop longs", () => {
    const erreurs = validerProfil({
      ...SAISIE_VIDE,
      qualite: "avocat",
      prenom: "p".repeat(101),
      nom: "n".repeat(101),
      toque: "t".repeat(21),
    });
    assert.equal(erreurs.prenom, "Le prénom ne dépasse pas 100 caractères.");
    assert.equal(erreurs.nom, "Le nom ne dépasse pas 100 caractères.");
    assert.equal(erreurs.toque, "La toque ne dépasse pas 20 caractères.");
  });

  it("n'applique pas le barreau et la toque à une qualité qui n'est pas celle d'un avocat", () => {
    const nette = saisieNette({ ...SAISIE_VIDE, qualite: "juriste", barreau: "Lyon", toque: "T 12" });
    assert.equal(nette.barreau, "");
    assert.equal(nette.toque, "");
    assert.deepEqual(validerProfil({ ...SAISIE_VIDE, qualite: "juriste", toque: "t".repeat(40) }), {});
  });

  it("garde le barreau et la toque d'un avocat collaborateur", () => {
    const nette = saisieNette({ ...SAISIE_VIDE, qualite: "avocat_collaborateur", barreau: " Lyon ", toque: " 1234 " });
    assert.equal(nette.barreau, "Lyon");
    assert.equal(nette.toque, "1234");
  });
});

describe("profil d'un membre : corps de la modification", () => {
  it("n'envoie que les champs changés, avec la version lue et la clé d'idempotence", () => {
    const corps = corpsModificationProfil(
      PROFIL,
      { ...SAISIE_VIDE, civilite: "monsieur", prenom: " Julien ", nom: "Marchal" },
      "cle-1",
    );
    assert.deepEqual(corps, {
      base_revision: 3,
      idempotence_cle: "cle-1",
      civilite: "monsieur",
      prenom: "Julien",
      nom: "Marchal",
    });
  });

  it("n'envoie rien quand rien ne change", () => {
    assert.equal(corpsModificationProfil(PROFIL, SAISIE_VIDE, "cle-2"), null);
    assert.equal(corpsModificationProfil(PROFIL, { ...SAISIE_VIDE, prenom: "   " }, "cle-2"), null);
  });

  it("efface un champ vidé par null, et le barreau avec la qualité d'avocat", () => {
    const avocat: ProfilMembre = {
      ...PROFIL,
      qualite: "avocat",
      barreau: "Lyon",
      toque: "1234",
      prenom: "Julien",
      nom: "Marchal",
    };
    const corps = corpsModificationProfil(avocat, { ...saisieDepuisProfil(avocat), qualite: "juriste", prenom: "" }, "cle-3");
    assert.deepEqual(corps, {
      base_revision: 3,
      idempotence_cle: "cle-3",
      prenom: null,
      qualite: "juriste",
      barreau: null,
      toque: null,
    });
  });

  it("ne déduit jamais un nom de l'adresse e-mail", () => {
    const corps = corpsModificationProfil(PROFIL, { ...SAISIE_VIDE, qualite: "autre" }, "cle-4");
    assert.deepEqual(corps, { base_revision: 3, idempotence_cle: "cle-4", qualite: "autre" });
  });

  it("applique la saisie au profil affiché", () => {
    const profil = appliquerSaisie(PROFIL, { ...SAISIE_VIDE, prenom: " Julien ", qualite: "juriste", barreau: "Lyon" });
    assert.equal(profil.prenom, "Julien");
    assert.equal(profil.barreau, null);
    assert.equal(profil.email, "demo@cabinet.example");
  });
});

describe("profil d'un membre : messages d'erreur en français", () => {
  it("reprend le message de l'API pour un 400", () => {
    assert.equal(messageErreurProfil(400, { message: "Qualité inconnue" }), "Qualité inconnue");
  });

  it("explique un 403, une session expirée et un serveur injoignable", () => {
    assert.equal(messageErreurProfil(403, null), "La modification est réservée aux administrateurs du cabinet.");
    assert.equal(messageErreurProfil(401, null), "La session a expiré. Reconnectez-vous.");
    assert.equal(messageErreurProfil(0, null), "Le serveur du cabinet est injoignable. Réessayez en ligne.");
  });

  it("garde un texte français quand l'API ne donne pas de message", () => {
    assert.equal(messageErreurProfil(400, {}), "L'identité n'a pas été enregistrée : une valeur est refusée.");
    assert.equal(messageErreurProfil(500, null), "L'identité n'a pas pu être enregistrée.");
  });
});
