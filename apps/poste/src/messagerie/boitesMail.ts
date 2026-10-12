import { estLu } from "@/messagerie/classement";
import {
  DOSSIERS_TOUJOURS_AFFICHES,
  ORDRE_DOSSIERS,
  dossierImap,
  libelleDossierImap,
  type CleDossierImap,
} from "@/messagerie/dossiersImap";
import type { CompteLocal, MailLocal } from "@/messagerie/typesMails";

/** « perso » : boîte nominative de l'utilisateur ; « partagee » : boîte partagée ou de classement du cabinet. */
export type IdBoite = "perso" | "partagee";

export type EntreeDossierRail = {
  cle: string;
  libelle: string;
  /** Nombre de non lus (boîte de réception) ou de messages (brouillons) ; `null` : aucun compteur. */
  compteur: number | null;
  nature: "non-lus" | "total" | null;
};

export type AdresseRail = { id: string; adresse: string; identifiantsRefuses: boolean };

export type BoiteRail = {
  id: IdBoite;
  titre: string;
  adresses: AdresseRail[];
  dossiers: EntreeDossierRail[];
};

/**
 * Identifiant de l'utilisateur, lu sur ses comptes nominatifs synchronisés : le flux « comptes nominatifs »
 * ne descend que ceux dont il est le titulaire.
 */
export function identifiantUtilisateur(comptes: readonly CompteLocal[]): string | null {
  const nominatif = comptes.find(
    (compte) => compte.type_compte === "nominatif" && (compte.titulaire_id ?? "") !== "",
  );
  return nominatif?.titulaire_id ?? null;
}

/**
 * Boîte d'un message. Les mails de la boîte de l'utilisateur ont son identifiant de titulaire ; ceux sans
 * titulaire viennent d'une boîte partagée ou de la boîte de classement. Les autres (mails classés dans un
 * dossier mais reçus par un confrère) ne sont dans aucune boîte de l'utilisateur.
 */
export function boiteDuMessage(
  mail: Pick<MailLocal, "titulaire_id">,
  monId: string | null,
): IdBoite | null {
  const titulaire = mail.titulaire_id ?? "";
  if (titulaire === "") return "partagee";
  return monId !== null && titulaire === monId ? "perso" : null;
}

export function mailsDeLaBoite(
  mails: readonly MailLocal[],
  boite: IdBoite,
  monId: string | null,
): MailLocal[] {
  return mails.filter((mail) => boiteDuMessage(mail, monId) === boite);
}

export function mailsDuDossier(
  mails: readonly MailLocal[],
  boite: IdBoite,
  cle: string,
  monId: string | null,
): MailLocal[] {
  return mailsDeLaBoite(mails, boite, monId).filter((mail) => dossierImap(mail.dossier_imap).cle === cle);
}

function entreesDossiers(mailsBoite: readonly MailLocal[], toujours: readonly CleDossierImap[]): EntreeDossierRail[] {
  const presents = new Map<string, { libelle: string; total: number; nonLus: number }>();
  for (const mail of mailsBoite) {
    const dossier = dossierImap(mail.dossier_imap);
    const actuel = presents.get(dossier.cle) ?? { libelle: dossier.libelle, total: 0, nonLus: 0 };
    actuel.total += 1;
    if (!estLu(mail)) actuel.nonLus += 1;
    presents.set(dossier.cle, actuel);
  }
  const entrees: EntreeDossierRail[] = [];
  const dejaVus = new Set<string>();
  const connues: readonly string[] = ORDRE_DOSSIERS;
  const ordre = [
    ...ORDRE_DOSSIERS.filter((cle) => toujours.includes(cle) || presents.has(cle)),
    ...[...presents.keys()].filter((cle) => !connues.includes(cle)).sort((a, b) => a.localeCompare(b, "fr")),
  ];
  for (const cle of ordre) {
    if (dejaVus.has(cle)) continue;
    dejaVus.add(cle);
    const compte = presents.get(cle);
    const libelle = compte?.libelle ?? libelleConnu(cle);
    if (cle === "reception") {
      const n = compte?.nonLus ?? 0;
      entrees.push({ cle, libelle, compteur: n > 0 ? n : null, nature: n > 0 ? "non-lus" : null });
    } else if (cle === "brouillons") {
      const n = compte?.total ?? 0;
      entrees.push({ cle, libelle, compteur: n > 0 ? n : null, nature: n > 0 ? "total" : null });
    } else {
      entrees.push({ cle, libelle, compteur: null, nature: null });
    }
  }
  return entrees;
}

function estCleConnue(cle: string): cle is CleDossierImap {
  return (ORDRE_DOSSIERS as readonly string[]).includes(cle);
}

function libelleConnu(cle: string): string {
  return estCleConnue(cle) ? libelleDossierImap(cle) : cle;
}

/**
 * Rail des boîtes : « Ma boîte » (comptes nominatifs de l'utilisateur) puis « Boîte partagée » dès qu'un compte
 * partagé est synchronisé ou qu'un message sans titulaire l'est.
 */
export function construireRail(
  comptes: readonly CompteLocal[],
  mails: readonly MailLocal[],
  monId: string | null,
): BoiteRail[] {
  const rail: BoiteRail[] = [];
  const adresse = (compte: CompteLocal): AdresseRail => ({
    id: compte.id,
    adresse: compte.adresse,
    identifiantsRefuses: compte.etat_connexion === "identifiants_refuses",
  });

  const nominatifs = comptes.filter((compte) => compte.type_compte === "nominatif");
  if (nominatifs.length > 0) {
    rail.push({
      id: "perso",
      titre: "Ma boîte",
      adresses: nominatifs.map(adresse),
      dossiers: entreesDossiers(mailsDeLaBoite(mails, "perso", monId), DOSSIERS_TOUJOURS_AFFICHES),
    });
  }

  const partages = comptes.filter((compte) => compte.type_compte === "partage");
  const mailsPartages = mailsDeLaBoite(mails, "partagee", monId);
  if (partages.length > 0 || mailsPartages.length > 0) {
    rail.push({
      id: "partagee",
      titre: "Boîte partagée",
      adresses: partages.map(adresse),
      dossiers: entreesDossiers(mailsPartages, ["reception"]),
    });
  }
  return rail;
}

/**
 * Vue ouverte au départ : la boîte de réception de l'utilisateur, ou celle de la boîte partagée quand
 * seule celle-ci contient des messages.
 */
export function vueParDefaut(
  mails: readonly MailLocal[],
  monId: string | null,
): { boite: IdBoite; dossier: string } {
  const perso = mailsDuDossier(mails, "perso", "reception", monId).length;
  const partagee = mailsDuDossier(mails, "partagee", "reception", monId).length;
  if (perso === 0 && partagee > 0) return { boite: "partagee", dossier: "reception" };
  return { boite: "perso", dossier: "reception" };
}

/** Nombre de non lus dans les boîtes de réception de l'utilisateur (la sienne et la partagée). */
export function compterNonLusReception(mails: readonly MailLocal[], monId: string | null): number {
  return mails.filter(
    (mail) =>
      boiteDuMessage(mail, monId) !== null && dossierImap(mail.dossier_imap).cle === "reception" && !estLu(mail),
  ).length;
}
