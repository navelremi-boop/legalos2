import { boiteDuMessage, compteNominatifDuMessage } from "@/messagerie/boitesMail";
import { dossierImap } from "@/messagerie/dossiersImap";
import type { CompteLocal, MailLocal } from "@/messagerie/typesMails";

/**
 * Actions sur les messages (lu, non lu, archiver, supprimer, déplacer) et recherche sur le serveur. Pures : le réseau est dans
 * `apiActionsMessages.ts` (en ligne seulement : l'action passe par la file du serveur, qui la répercute sur IMAP). Contrat :
 * `crates/api/src/routes/actions_messages.rs` et `recherche_messages.rs`.
 */

export type GenreAction = "lu" | "non_lu" | "archiver" | "supprimer" | "deplacer";

export type ActionAppliquee = {
  id: string;
  /** `appliquee`, `en_attente` (reprise par le serveur) ou `echec`. */
  etat: string;
  erreur: string | null;
  dossierFinal: string | null;
  rejeu: boolean;
};

function objet(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

export function cheminAction(messageId: string): string {
  return `/messagerie/messages/${encodeURIComponent(messageId)}/actions`;
}

/** Corps de la demande ; la clé d'idempotence rend un rejeu sans effet (réseau coupé après l'envoi). */
export function corpsAction(genre: GenreAction, cle: string, destination?: string): Record<string, unknown> {
  return destination === undefined
    ? { genre, idempotence_cle: cle }
    : { genre, destination, idempotence_cle: cle };
}

export function lireAction(json: unknown): ActionAppliquee {
  const ligne = objet(json);
  return {
    id: texte(ligne.id),
    etat: texte(ligne.etat),
    erreur: texte(ligne.erreur) === "" ? null : texte(ligne.erreur),
    dossierFinal: texte(ligne.dossier_final) === "" ? null : texte(ligne.dossier_final),
    rejeu: ligne.rejeu === true,
  };
}

/** Ce que l'utilisateur lit après une demande : fait, en cours de reprise par le serveur, ou abandonné. */
export function messageResultat(genre: GenreAction, action: ActionAppliquee): { ok: boolean; texte: string } {
  if (action.etat === "appliquee") {
    const fait: Record<GenreAction, string> = {
      lu: "Marqué comme lu.",
      non_lu: "Marqué comme non lu.",
      archiver: "Déplacé dans les archives.",
      supprimer: "Déplacé dans la corbeille.",
      deplacer: "Message déplacé.",
    };
    return { ok: true, texte: fait[genre] };
  }
  if (action.etat === "echec") {
    return { ok: false, texte: "L'action n'a pas pu être appliquée sur la boîte." };
  }
  return { ok: true, texte: "Demande enregistrée : le serveur la rejoue dès que la boîte répond." };
}

/** Dossier IMAP d'une boîte tel que l'API le décrit (`GET /messagerie/comptes/{id}/dossiers`). */
export type DossierImap = {
  /** Nom IMAP exact, présenté tel quel au serveur pour déplacer un message. */
  nom: string;
  /** Nom affiché : français pour un dossier spécial, sinon le chemin. */
  libelle: string;
  role: string | null;
  /** Faux : le serveur le créera au premier déplacement. */
  existe: boolean;
};

/** Destination proposée par « Déplacer » : le nom IMAP à envoyer et le libellé à montrer. */
export type DestinationDeplacement = { nom: string; libelle: string };

export function cheminDossiersImap(compteId: string): string {
  return `/messagerie/comptes/${encodeURIComponent(compteId)}/dossiers`;
}

export function lireDossiersImap(json: unknown): DossierImap[] {
  const liste = objet(json).dossiers;
  if (!Array.isArray(liste)) return [];
  return (liste as unknown[]).flatMap((element) => {
    const ligne = objet(element);
    const nom = texte(ligne.nom);
    if (nom === "") return [];
    const libelle = texte(ligne.libelle);
    const role = texte(ligne.role);
    return [{ nom, libelle: libelle === "" ? nom : libelle, role: role === "" ? null : role, existe: ligne.existe !== false }];
  });
}

/**
 * Compte dont le poste demande la liste des dossiers pour un message : sa boîte nominative si c'est un message de
 * l'utilisateur, l'unique boîte partagée si le message vient d'une boîte partagée. `null` quand le poste ne peut pas
 * désigner un compte (plusieurs boîtes partagées, message de la boîte de classement) : il propose alors ses dossiers
 * locaux.
 */
export function compteDeplacement(
  mail: Pick<MailLocal, "dossier_imap" | "titulaire_id">,
  comptes: readonly CompteLocal[],
  monId: string | null,
): string | null {
  const boite = boiteDuMessage(mail, monId);
  if (boite === "perso") return compteNominatifDuMessage(mail, comptes, monId);
  if (boite === "partagee") {
    const partages = comptes.filter((compte) => compte.type_compte === "partage");
    return partages.length === 1 ? (partages[0]?.id ?? null) : null;
  }
  return null;
}

/** Destinations d'après la liste du serveur : tous ses dossiers, dans son ordre, sans celui où le message se trouve. */
export function destinationsDepuisServeur(
  dossiers: readonly DossierImap[],
  mail: Pick<MailLocal, "dossier_imap">,
): DestinationDeplacement[] {
  const actuel = (mail.dossier_imap ?? "") === "" ? "INBOX" : (mail.dossier_imap ?? "");
  return dossiers.filter((dossier) => dossier.nom !== actuel).map((dossier) => ({ nom: dossier.nom, libelle: dossier.libelle }));
}

/**
 * Dossiers IMAP proposés pour « Déplacer » quand le serveur ne répond pas : ceux où la boîte de l'utilisateur a déjà des
 * messages, la réception et les archives, sans le dossier actuel du message. Le serveur crée au besoin un dossier qui
 * n'existe pas encore.
 */
export function destinationsDeplacement(
  mail: Pick<MailLocal, "dossier_imap" | "titulaire_id">,
  mails: readonly Pick<MailLocal, "dossier_imap" | "titulaire_id">[],
  monId: string | null,
): string[] {
  const actuel = (mail.dossier_imap ?? "") === "" ? "INBOX" : (mail.dossier_imap ?? "");
  const boite = boiteDuMessage(mail, monId);
  const noms = new Set<string>(["INBOX", "Archives"]);
  for (const autre of mails) {
    if (boiteDuMessage(autre, monId) !== boite) continue;
    const nom = autre.dossier_imap ?? "";
    if (nom !== "") noms.add(nom);
  }
  noms.delete(actuel);
  return [...noms].sort((a, b) => a.localeCompare(b, "fr"));
}

/** Les destinations locales avec le libellé français des noms connus. */
export function destinationsLocales(
  mail: Pick<MailLocal, "dossier_imap" | "titulaire_id">,
  mails: readonly Pick<MailLocal, "dossier_imap" | "titulaire_id">[],
  monId: string | null,
): DestinationDeplacement[] {
  return destinationsDeplacement(mail, mails, monId).map((nom) => ({ nom, libelle: dossierImap(nom).libelle }));
}

// ----- Recherche sur le serveur -----

export type ResultatServeur = {
  id: string;
  objet: string;
  dossierImap: string;
};

export function cheminRecherche(terme: string, limite = 50): string {
  return `/messagerie/recherche?q=${encodeURIComponent(terme.trim())}&limite=${String(limite)}`;
}

export function lireRecherche(json: unknown): { resultats: ResultatServeur[]; aSuivre: boolean } {
  const racine = objet(json);
  const liste = Array.isArray(racine.resultats) ? (racine.resultats as unknown[]) : [];
  return {
    resultats: liste.flatMap((element) => {
      const ligne = objet(element);
      const id = texte(ligne.id);
      return id === "" ? [] : [{ id, objet: texte(ligne.objet), dossierImap: texte(ligne.dossier_imap) }];
    }),
    aSuivre: racine.a_suivre === true,
  };
}

/** Une saisie que le serveur accepte : au moins un mot de deux lettres ou chiffres. */
export function saisieRecherchable(terme: string): boolean {
  return terme.split(/[^\p{L}\p{N}]+/u).some((mot) => Array.from(mot).length >= 2);
}

/** Identifiants trouvés par le poste puis par le serveur, sans doublon, dans l'ordre de première apparition. */
export function fusionnerResultats(
  locaux: readonly { id: string }[],
  serveur: readonly { id: string }[],
): { id: string }[] {
  const vus = new Set<string>();
  const fusion: { id: string }[] = [];
  for (const element of [...locaux, ...serveur]) {
    if (vus.has(element.id)) continue;
    vus.add(element.id);
    fusion.push({ id: element.id });
  }
  return fusion;
}
