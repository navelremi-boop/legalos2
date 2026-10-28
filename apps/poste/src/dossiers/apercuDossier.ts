import { estLu } from "@/messagerie/classement";

export type EtatEtape = "fait" | "cours" | "futur";

export type EtapeProcedure = {
  code: string;
  libelle: string;
  etat: EtatEtape;
};

const CONTENTIEUX = [
  ["ouverture", "Ouverture"],
  ["instruction", "Instruction"],
  ["plaidoirie", "Plaidoirie"],
  ["jugement", "Jugement"],
  ["execution", "Exécution"],
  ["clos", "Clos"],
] as const;

const CONSEIL = [
  ["ouverture", "Ouverture"],
  ["instruction", "Instruction"],
  ["clos", "Clos"],
] as const;

/** Étapes du dossier, l'étape courante au milieu, les précédentes faites. */
export function etapesProcedure(typeDossier: string | null, etape: string | null): EtapeProcedure[] {
  const liste = typeDossier === "contentieux" ? CONTENTIEUX : CONSEIL;
  const index = liste.findIndex(([code]) => code === etape);
  return liste.map(([code, libelle], rang) => ({
    code,
    libelle,
    etat: index < 0 ? "futur" : rang < index ? "fait" : rang === index ? "cours" : "futur",
  }));
}

export type ElementRecent = {
  id: string;
  genre: "mail" | "piece" | "facture";
  titre: string;
  quand: string;
};

export function derniersElements(
  elements: readonly ElementRecent[],
  limite = 3,
): ElementRecent[] {
  return [...elements].sort((a, b) => b.quand.localeCompare(a.quand) || a.id.localeCompare(b.id)).slice(0, limite);
}

export function resumeFacturation(
  lignes: readonly { minutes: number; htCentimes: number; facture: boolean }[],
): { nonFactureMinutes: number; factureCentimes: number; encaiseCentimes: number } {
  let nonFactureMinutes = 0;
  let factureCentimes = 0;
  for (const ligne of lignes) {
    if (ligne.facture) factureCentimes += ligne.htCentimes;
    else nonFactureMinutes += ligne.minutes;
  }
  // Aucun règlement n'est synchronisé sur le poste : l'encaissé affiché est nul.
  return { nonFactureMinutes, factureCentimes, encaiseCentimes: 0 };
}

/** « 1 jour » au singulier, « aujourd'hui » quand l'échéance est le jour même. */
export function libelleJoursRestants(jours: number): string {
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "1 jour";
  return `${String(jours)} jours`;
}

/** Client et adversaire, mêmes rôles que la fiche du dossier ouvert. */
export function nomsParties(
  parties: readonly { role: string | null; nom: string | null }[],
): { client: string; adversaire: string } {
  const nom = (partie: { nom: string | null }) => partie.nom?.trim() ?? "";
  const client =
    parties.find((partie) => partie.role === "client" && nom(partie) !== "")?.nom?.trim() ??
    parties.find((partie) => partie.role === "demandeur" && nom(partie) !== "")?.nom?.trim() ??
    "";
  const adversaire = parties
    .filter((partie) => (partie.role === "adversaire" || partie.role === "defendeur") && nom(partie) !== "")
    .map((partie) => nom(partie))
    .join(", ");
  return { client, adversaire };
}

/** Mails classés dans un dossier et encore non lus. */
export function nonLusParDossier(
  mails: readonly { dossier_id: string | null; lu: number | boolean | null }[],
): Map<string, number> {
  const comptes = new Map<string, number>();
  for (const mail of mails) {
    if (mail.dossier_id === null || mail.dossier_id === "" || estLu(mail)) continue;
    comptes.set(mail.dossier_id, (comptes.get(mail.dossier_id) ?? 0) + 1);
  }
  return comptes;
}
