import type { ApercuChrono, ChronoItem, ChronoPeriode } from "@/coque/chrono/types";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneMail = {
  id: string;
  objet: string | null;
  expediteur: string | null;
  cree_le: string | null;
};

type LignePiece = {
  id: string;
  nom: string | null;
  cree_le: string | null;
};

type LigneFacture = {
  id: string;
  libelle: string | null;
  ht_centimes: number | null;
  cree_le: string | null;
};

function dateDe(valeur: string | null): Date | null {
  if (valeur === null || valeur === "") return null;
  const normalise = valeur.includes("T") ? valeur : valeur.replace(" ", "T");
  const date = new Date(normalise);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodeDe(valeur: string | null): ChronoPeriode {
  const date = dateDe(valeur);
  if (date === null) return "plus-tot";
  const maintenant = new Date();
  const debutJour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  if (date >= debutJour) return "aujourdhui";
  const semaine = new Date(debutJour);
  semaine.setDate(semaine.getDate() - 6);
  if (date >= semaine) return "cette-semaine";
  return "plus-tot";
}

function heureDe(valeur: string | null): string | undefined {
  const date = dateDe(valeur);
  if (date === null) return undefined;
  return `${String(date.getHours())} h ${String(date.getMinutes()).padStart(2, "0")}`;
}

function instantDe(valeur: string | null): number {
  return dateDe(valeur)?.getTime() ?? 0;
}

function monoDe(texte: string): string {
  const base = texte.split("@")[0] ?? texte;
  const lettres = base.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return (lettres.slice(0, 2) || "M").toUpperCase();
}

function euros(centimes: number): string {
  const abs = Math.abs(centimes);
  const entier = Math.trunc(abs / 100);
  const cts = String(abs % 100).padStart(2, "0");
  const groupes = String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const signe = centimes < 0 ? "-" : "";
  return `${signe}${groupes},${cts} €`;
}

function apercuMail(ligne: LigneMail, titre: string): ApercuChrono {
  const qui = ligne.expediteur?.trim() || "Expéditeur inconnu";
  return {
    mono: monoDe(qui),
    qui,
    sousTitre: qui,
    quand: heureDe(ligne.cree_le) ?? "",
    titre,
    encart: {
      variante: "classement",
      titre: "Classé dans ce dossier",
      detail: "Le mail synchronisé est rattaché à ce dossier.",
    },
  };
}

/**
 * Chrono d'un dossier réel : mails classés, pièces et brouillons de facture
 * présents dans le SQLite synchronisé. Pas de jeu fictif.
 */
export async function chargerChrono(dossierId: string): Promise<ChronoItem[]> {
  const database = await getPowerSyncDatabase();
  const mails = await database.getAll<LigneMail>(
    `SELECT id, objet, expediteur, cree_le
     FROM messages
     WHERE dossier_id = ? AND etat_classement = 'classe'`,
    [dossierId],
  );
  const pieces = await database.getAll<LignePiece>(
    `SELECT id, nom, cree_le FROM documents WHERE dossier_id = ?`,
    [dossierId],
  );
  const factures = await database.getAll<LigneFacture>(
    `SELECT id, libelle, ht_centimes, cree_le FROM brouillons_facture WHERE dossier_id = ?`,
    [dossierId],
  );

  const items: Array<ChronoItem & { instant: number }> = [
    ...mails.map((ligne) => {
      const titre = ligne.objet?.trim() || "(sans objet)";
      return {
        id: `mail-${ligne.id}`,
        type: "mail" as const,
        periode: periodeDe(ligne.cree_le),
        titre,
        metadonnees: ligne.expediteur?.trim() || "Expéditeur inconnu",
        heure: heureDe(ligne.cree_le),
        apercu: apercuMail(ligne, titre),
        instant: instantDe(ligne.cree_le),
      };
    }),
    ...pieces.map((ligne) => {
      const titre = ligne.nom?.trim() || "(pièce sans nom)";
      return {
        id: `piece-${ligne.id}`,
        type: "piece" as const,
        periode: periodeDe(ligne.cree_le),
        titre,
        metadonnees: "Pièce du dossier",
        heure: heureDe(ligne.cree_le),
        apercu: {
          mono: "P",
          qui: "Pièce",
          sousTitre: titre,
          quand: heureDe(ligne.cree_le) ?? "",
          titre,
          encart: {
            variante: "note" as const,
            titre: "Pièce synchronisée",
            detail: "Rangée dans ce dossier.",
          },
        },
        instant: instantDe(ligne.cree_le),
      };
    }),
    ...factures.map((ligne) => {
      const titre = ligne.libelle?.trim() || "Brouillon de facture";
      const montant = euros(ligne.ht_centimes ?? 0);
      return {
        id: `facture-${ligne.id}`,
        type: "facture" as const,
        periode: periodeDe(ligne.cree_le),
        titre,
        metadonnees: `${montant} HT`,
        heure: heureDe(ligne.cree_le),
        apercu: {
          mono: "F",
          qui: "Brouillon de facture",
          sousTitre: montant,
          quand: heureDe(ligne.cree_le) ?? "",
          titre,
          chiffres: [{ libelle: "Montant HT", valeur: montant }],
          encart: {
            variante: "note" as const,
            titre: "Brouillon",
            detail: "Facture non encore validée.",
          },
        },
        instant: instantDe(ligne.cree_le),
      };
    }),
  ];

  items.sort((a, b) => b.instant - a.instant);
  return items.map((item) => ({
    id: item.id,
    type: item.type,
    periode: item.periode,
    titre: item.titre,
    metadonnees: item.metadonnees,
    heure: item.heure,
    apercu: item.apercu,
  }));
}
