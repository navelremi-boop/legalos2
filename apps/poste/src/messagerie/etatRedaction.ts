import { formatHeure } from "@/lib/format";
import { fr } from "@/lib/fr";
import {
  depuisLignes,
  versLignes,
  type ChampAdresses,
  type Destinataire,
} from "@/messagerie/adressesRedaction";
import {
  corpsDeDepart,
  destinatairesDepart,
  filDeReponse,
  objetRedaction,
  type GenreRedaction,
  type MessageCite,
} from "@/messagerie/citation";
import { nettoyerSortie, texteDepuisHtml } from "@/messagerie/nettoyageHtml";

/**
 * État d'un message en cours de rédaction et sa correspondance avec la ligne `brouillons_message` de la base
 * locale. L'écran ne manipule que cet état ; l'enregistrement n'écrit que les colonnes qui ont changé
 * (une écriture locale partielle devient une écriture partielle côté API, dernière écriture gagnante).
 */

export type EtatRedaction = {
  id: string;
  genre: GenreRedaction;
  origineMessageId: string | null;
  compteId: string | null;
  dossierId: string | null;
  a: Destinataire[];
  cc: Destinataire[];
  cci: Destinataire[];
  objet: string;
  corpsHtml: string;
  enReponseA: string | null;
  references: string[];
};

/** Colonnes de `brouillons_message` lues sur le poste. */
export type LigneBrouillon = {
  id: string;
  compte_id: string | null;
  genre: string | null;
  origine_message_id: string | null;
  dossier_id: string | null;
  a: string | null;
  cc: string | null;
  cci: string | null;
  objet: string | null;
  corps_html: string | null;
  corps: string | null;
  en_reponse_a: string | null;
  references_texte: string | null;
  pieces_texte: string | null;
  modifie_le: string | null;
  cree_le: string | null;
};

/** Colonnes que le poste écrit. `pieces_texte`, `revision` et les dates sont posées par le serveur. */
export type ChampsEcrits = {
  compte_id: string | null;
  genre: string;
  origine_message_id: string | null;
  dossier_id: string | null;
  a: string;
  cc: string;
  cci: string;
  objet: string;
  corps_html: string;
  corps: string;
  en_reponse_a: string | null;
  references_texte: string;
};

const GENRES: readonly GenreRedaction[] = ["nouveau", "reponse", "reponse_a_tous", "transfert"];

export function genreConnu(valeur: string | null | undefined): GenreRedaction {
  return GENRES.find((genre) => genre === valeur) ?? "nouveau";
}

/** Titre du volet de rédaction (maquette : « Nouveau mail », « Répondre », « Répondre à tous », « Transférer »). */
export function titreRedaction(genre: GenreRedaction): string {
  switch (genre) {
    case "nouveau":
      return "Nouveau mail";
    case "reponse":
      return "Répondre";
    case "reponse_a_tous":
      return "Répondre à tous";
    case "transfert":
      return "Transférer";
  }
}

/** Départ d'une rédaction à partir du message d'origine (réponse, réponse à tous, transfert) ou de rien (message neuf). */
export function etatDeDepart(entree: {
  id: string;
  genre: GenreRedaction;
  message: MessageCite | null;
  adressesPropres: readonly string[];
  dossierId?: string | null;
}): EtatRedaction {
  const { genre, message } = entree;
  const destinataires =
    message === null ? { a: [], cc: [] } : destinatairesDepart(genre, message, entree.adressesPropres);
  const fil = message === null ? { enReponseA: null, references: [] } : filDeReponse(genre, message);
  return {
    id: entree.id,
    genre,
    origineMessageId: message === null ? null : message.id,
    compteId: null,
    dossierId: entree.dossierId ?? null,
    a: destinataires.a,
    cc: destinataires.cc,
    cci: [],
    objet: message === null ? "" : objetRedaction(genre, message.objet),
    corpsHtml: corpsDeDepart(genre, message),
    enReponseA: fil.enReponseA,
    references: fil.references,
  };
}

/**
 * Départ d'une réponse composé par le serveur : ses destinataires et son fil remplacent ceux du calcul local
 * (il connaît les adresses du cabinet et la chaîne complète des références). Une réponse du serveur sans
 * destinataire ne remplace rien.
 */
export function appliquerDepartServeur(
  etat: EtatRedaction,
  serveur: { a: Destinataire[]; cc: Destinataire[]; enReponseA: string | null; references: string[] },
): EtatRedaction {
  if (serveur.a.length === 0 && serveur.cc.length === 0) return etat;
  return {
    ...etat,
    a: serveur.a,
    cc: serveur.cc,
    enReponseA: serveur.enReponseA ?? etat.enReponseA,
    references: serveur.references.length > 0 ? serveur.references : etat.references,
  };
}

/** Un brouillon repris : l'état relu depuis la base locale. */
export function etatDepuisLigne(ligne: LigneBrouillon): EtatRedaction {
  const references = (ligne.references_texte ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  const enReponseA = (ligne.en_reponse_a ?? "").trim();
  return {
    id: ligne.id,
    genre: genreConnu(ligne.genre),
    origineMessageId: ligne.origine_message_id === "" ? null : ligne.origine_message_id,
    compteId: ligne.compte_id === "" ? null : ligne.compte_id,
    dossierId: ligne.dossier_id === "" ? null : ligne.dossier_id,
    a: depuisLignes(ligne.a),
    cc: depuisLignes(ligne.cc),
    cci: depuisLignes(ligne.cci),
    objet: ligne.objet ?? "",
    corpsHtml: ligne.corps_html ?? "",
    enReponseA: enReponseA === "" ? null : enReponseA,
    references,
  };
}

/** Colonnes à écrire pour cet état. Le HTML est nettoyé ici : rien d'autre que ce que l'éditeur sait écrire n'est stocké. */
export function champsEcrits(etat: EtatRedaction): ChampsEcrits {
  const html = nettoyerSortie(etat.corpsHtml);
  return {
    compte_id: etat.compteId,
    genre: etat.genre,
    origine_message_id: etat.origineMessageId,
    dossier_id: etat.dossierId,
    a: versLignes(etat.a).join("\n"),
    cc: versLignes(etat.cc).join("\n"),
    cci: versLignes(etat.cci).join("\n"),
    objet: etat.objet.replace(/\p{Cc}/gu, " ").trim(),
    corps_html: html,
    corps: texteDepuisHtml(html),
    en_reponse_a: etat.enReponseA,
    references_texte: etat.references.join("\n"),
  };
}

/** Colonnes dont la valeur diffère entre deux états : seules celles-ci sont écrites par une mise à jour. */
export function colonnesModifiees(avant: ChampsEcrits, apres: ChampsEcrits): Partial<ChampsEcrits> {
  const modifiees: Record<string, string | null> = {};
  const cles = Object.keys(apres) as (keyof ChampsEcrits)[];
  for (const cle of cles) {
    if (avant[cle] !== apres[cle]) modifiees[cle] = apres[cle];
  }
  return modifiees;
}

/** Vrai si l'utilisateur a écrit quelque chose : un brouillon intact (départ d'une réponse) n'est pas enregistré. */
export function estIntact(etat: EtatRedaction, depart: EtatRedaction): boolean {
  const a = champsEcrits(etat);
  const b = champsEcrits(depart);
  return (Object.keys(a) as (keyof ChampsEcrits)[]).every((cle) => a[cle] === b[cle]);
}

/** Vrai si le corps n'a pas été touché par l'utilisateur depuis le départ (même si l'objet ou les adresses ont changé). */
export function corpsNonTouche(etat: EtatRedaction, depart: EtatRedaction): boolean {
  return nettoyerSortie(etat.corpsHtml) === nettoyerSortie(depart.corpsHtml);
}

export function champDestinataires(etat: EtatRedaction, champ: ChampAdresses): Destinataire[] {
  return etat[champ];
}

/** Statut d'enregistrement affiché dans l'en-tête du volet. */
export type StatutEnregistrement =
  | { genre: "vierge" }
  | { genre: "enregistrement" }
  | { genre: "local"; a: Date; enLigne: boolean }
  | { genre: "serveur"; a: Date }
  | { genre: "refuse"; message: string };

export function libelleStatut(statut: StatutEnregistrement): string {
  switch (statut.genre) {
    case "vierge":
      return fr("Le brouillon s'enregistre dès que vous écrivez.");
    case "enregistrement":
      return fr("Enregistrement du brouillon…");
    case "local":
      return fr(
        statut.enLigne
          ? `Brouillon enregistré à ${formatHeure(statut.a)} sur cet appareil, envoi au serveur en cours`
          : `Brouillon enregistré à ${formatHeure(statut.a)} sur cet appareil, disponible hors ligne`,
      );
    case "serveur":
      return fr(`Brouillon enregistré à ${formatHeure(statut.a)}, visible sur vos autres appareils`);
    case "refuse":
      return fr(`Le serveur n'a pas accepté ce brouillon. ${statut.message}`);
  }
}

/**
 * Envoi possible ? Au moins un destinataire valide et aucun transfert en cours ; sinon la phrase qui dit pourquoi.
 */
export function verifierEnvoi(
  etat: Pick<EtatRedaction, "a" | "cc" | "cci">,
  pieceEnCours: boolean,
): { ok: true } | { ok: false; message: string } {
  if (etat.a.length + etat.cc.length + etat.cci.length === 0) {
    return { ok: false, message: "Ajoutez au moins un destinataire." };
  }
  if (pieceEnCours) return { ok: false, message: "Une pièce jointe est encore en cours d'ajout." };
  return { ok: true };
}
