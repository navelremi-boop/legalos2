import type { CorpsRequete, Recu } from "@/api/contrat";
import { estQualiteAvocat } from "@/identite/libelleMembre";

/**
 * Identité d'un membre du cabinet, telle que l'API la lit et l'écrit (`GET` et `PATCH /moi/profil`,
 * `GET /utilisateurs`, `PATCH /utilisateurs/{id}/profil`). Les contrôles ci-dessous préviennent l'utilisateur ;
 * l'API les refait. Aucune valeur n'est déduite de l'adresse e-mail.
 */

export type ProfilMembre = {
  id: string;
  email: string;
  role: string;
  actif: boolean;
  civilite: string | null;
  prenom: string | null;
  nom: string | null;
  qualite: string | null;
  barreau: string | null;
  toque: string | null;
  revision: number;
};

/** Valeurs d'un formulaire : texte brut, chaîne vide quand rien n'est saisi. */
export type ProfilSaisie = {
  civilite: string;
  prenom: string;
  nom: string;
  qualite: string;
  barreau: string;
  toque: string;
};

export const CIVILITES_MEMBRE: readonly { code: string; libelle: string }[] = [
  { code: "madame", libelle: "Madame" },
  { code: "monsieur", libelle: "Monsieur" },
];

export const QUALITES_MEMBRE: readonly { code: string; libelle: string }[] = [
  { code: "avocat", libelle: "Avocat" },
  { code: "avocat_collaborateur", libelle: "Avocat collaborateur" },
  { code: "juriste", libelle: "Juriste" },
  { code: "assistant", libelle: "Assistant" },
  { code: "autre", libelle: "Autre" },
];

export const LONGUEUR_MAX_IDENTITE = 100;
export const LONGUEUR_MAX_TOQUE = 20;

export function libelleQualite(code: string | null): string {
  return QUALITES_MEMBRE.find((qualite) => qualite.code === code)?.libelle ?? "";
}

export function libelleRole(role: string): string {
  return role === "administrateur" ? "Administrateur" : "Collaborateur";
}

/** Le barreau et la toque se saisissent seulement pour un avocat ou un avocat collaborateur. */
export function saisieBarreauToque(qualite: string): boolean {
  return estQualiteAvocat(qualite);
}

function texteNet(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const net = valeur.trim();
  return net === "" ? null : net;
}

/** Profil lu dans une réponse de l'API (valeurs lues sans confiance) ; `null` si l'identifiant ou la version manquent. */
export function profilDepuisJson(json: unknown): ProfilMembre | null {
  if (json === null || typeof json !== "object") return null;
  const brut = json as Recu<"ProfilMembreResponse">;
  const id = texteNet(brut.id);
  const email = texteNet(brut.email);
  const revision = typeof brut.revision === "number" ? brut.revision : null;
  if (id === null || email === null || revision === null) return null;
  return {
    id,
    email,
    role: texteNet(brut.role) ?? "collaborateur",
    actif: brut.actif !== false,
    civilite: texteNet(brut.civilite),
    prenom: texteNet(brut.prenom),
    nom: texteNet(brut.nom),
    qualite: texteNet(brut.qualite),
    barreau: texteNet(brut.barreau),
    toque: texteNet(brut.toque),
    revision,
  };
}

export function profilsDepuisJson(json: unknown): ProfilMembre[] {
  if (!Array.isArray(json)) return [];
  const lus: ProfilMembre[] = [];
  for (const entree of json) {
    const profil = profilDepuisJson(entree);
    if (profil !== null) lus.push(profil);
  }
  return lus;
}

export function saisieDepuisProfil(profil: ProfilMembre): ProfilSaisie {
  return {
    civilite: profil.civilite ?? "",
    prenom: profil.prenom ?? "",
    nom: profil.nom ?? "",
    qualite: profil.qualite ?? "",
    barreau: profil.barreau ?? "",
    toque: profil.toque ?? "",
  };
}

export type ChampProfil = keyof ProfilSaisie;

/** Saisie rognée ; barreau et toque vidés quand la qualité n'est pas celle d'un avocat. */
export function saisieNette(saisie: ProfilSaisie): ProfilSaisie {
  const nette: ProfilSaisie = {
    civilite: saisie.civilite.trim(),
    prenom: saisie.prenom.trim(),
    nom: saisie.nom.trim(),
    qualite: saisie.qualite.trim(),
    barreau: saisie.barreau.trim(),
    toque: saisie.toque.trim(),
  };
  if (!saisieBarreauToque(nette.qualite)) {
    nette.barreau = "";
    nette.toque = "";
  }
  return nette;
}

/** Erreurs par champ, en français ; objet vide quand la saisie est recevable. */
export function validerProfil(saisie: ProfilSaisie): Partial<Record<ChampProfil, string>> {
  const nette = saisieNette(saisie);
  const erreurs: Partial<Record<ChampProfil, string>> = {};
  if (nette.civilite !== "" && !CIVILITES_MEMBRE.some((civilite) => civilite.code === nette.civilite)) {
    erreurs.civilite = "Choisissez Madame ou Monsieur.";
  }
  if (nette.qualite !== "" && !QUALITES_MEMBRE.some((qualite) => qualite.code === nette.qualite)) {
    erreurs.qualite = "Choisissez une qualité de la liste.";
  }
  if (Array.from(nette.prenom).length > LONGUEUR_MAX_IDENTITE) {
    erreurs.prenom = `Le prénom ne dépasse pas ${String(LONGUEUR_MAX_IDENTITE)} caractères.`;
  }
  if (Array.from(nette.nom).length > LONGUEUR_MAX_IDENTITE) {
    erreurs.nom = `Le nom ne dépasse pas ${String(LONGUEUR_MAX_IDENTITE)} caractères.`;
  }
  if (Array.from(nette.barreau).length > LONGUEUR_MAX_IDENTITE) {
    erreurs.barreau = `Le barreau ne dépasse pas ${String(LONGUEUR_MAX_IDENTITE)} caractères.`;
  }
  if (Array.from(nette.toque).length > LONGUEUR_MAX_TOQUE) {
    erreurs.toque = `La toque ne dépasse pas ${String(LONGUEUR_MAX_TOQUE)} caractères.`;
  }
  return erreurs;
}

const CHAMPS: readonly ChampProfil[] = ["civilite", "prenom", "nom", "qualite", "barreau", "toque"];

/**
 * Corps de la modification : seuls les champs changés partent, `null` efface. `base_revision` est la version
 * lue juste avant ; `null` quand rien ne change (l'appelant n'envoie alors rien).
 */
export function corpsModificationProfil(
  profil: ProfilMembre,
  saisie: ProfilSaisie,
  idempotenceCle: string,
): CorpsRequete<"ModifierProfilRequest"> | null {
  const nette = saisieNette(saisie);
  const avant = saisieDepuisProfil(profil);
  const corps: CorpsRequete<"ModifierProfilRequest"> = {
    base_revision: profil.revision,
    idempotence_cle: idempotenceCle,
  };
  let change = false;
  for (const champ of CHAMPS) {
    if (nette[champ] === avant[champ]) continue;
    corps[champ] = nette[champ] === "" ? null : nette[champ];
    change = true;
  }
  return change ? corps : null;
}

/** Identité vue du poste après une modification acceptée, pour l'affichage avant l'arrivée du flux. */
export function appliquerSaisie(profil: ProfilMembre, saisie: ProfilSaisie): ProfilMembre {
  const nette = saisieNette(saisie);
  const vide = (valeur: string): string | null => (valeur === "" ? null : valeur);
  return {
    ...profil,
    civilite: vide(nette.civilite),
    prenom: vide(nette.prenom),
    nom: vide(nette.nom),
    qualite: vide(nette.qualite),
    barreau: vide(nette.barreau),
    toque: vide(nette.toque),
  };
}

/** Message affiché pour une réponse de l'API en erreur : le message de l'API (déjà en français) sinon un texte par code. */
export function messageErreurProfil(statut: number, json: unknown): string {
  const duServeur =
    json !== null && typeof json === "object" && typeof (json as { message?: unknown }).message === "string"
      ? (json as { message: string }).message.trim()
      : "";
  if (statut === 401) return "La session a expiré. Reconnectez-vous.";
  if (statut === 403) return "La modification est réservée aux administrateurs du cabinet.";
  if (statut === 404) return "Ce membre du cabinet est introuvable.";
  if (statut === 0) return "Le serveur du cabinet est injoignable. Réessayez en ligne.";
  if (duServeur !== "") return duServeur;
  if (statut === 400 || statut === 409) return "L'identité n'a pas été enregistrée : une valeur est refusée.";
  return "L'identité n'a pas pu être enregistrée.";
}
