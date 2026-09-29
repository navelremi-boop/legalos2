import { calculerDelaiComplet } from "@/delais/moteur";
import { getPowerSyncDatabase } from "@/sync/database";
import { instantPourHeureParis } from "@/agenda/fuseauParis";

/** Mur sans fuseau : interprété en Europe/Paris. Un instant déjà qualifié est conservé. */
export function instantAgenda(valeur: string): string {
  const texte = valeur.trim();
  const mur = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(texte);
  const jour = mur?.[1];
  const heure = mur?.[2];
  const minute = mur?.[3];
  if (!jour || !heure || !minute || /[zZ]$|[+-]\d{2}:\d{2}$/.test(texte)) return texte;
  return instantPourHeureParis(jour, Number(heure), Number(minute));
}

export type TypeAgenda = "audience" | "rendez_vous" | "tache";

type DossierSync = {
  cabinet_id: string;
  visibilite: string | null;
  restreint: number | null;
};

export async function ecrireElementAgenda(saisie: {
  dossierId: string;
  typeElement: TypeAgenda;
  titre: string;
  debut: string;
  rappelLe?: string;
  origineCalcul?: string;
  joursCalcul?: number;
  moisCalcul?: number;
  anneesCalcul?: number;
}): Promise<string> {
  const titre = saisie.titre.trim();
  const debut = instantAgenda(saisie.debut);
  if (titre === "" || debut === "") throw new Error("Titre et début requis");
  const database = await getPowerSyncDatabase();
  const dossiers = await database.getAll<DossierSync>(
    "SELECT cabinet_id, visibilite, restreint FROM dossiers WHERE id = ? LIMIT 1",
    [saisie.dossierId],
  );
  const dossier = dossiers[0];
  if (!dossier?.cabinet_id) throw new Error("Dossier introuvable");
  const restreint = dossier.restreint === 1 || dossier.visibilite === "restreint" ? 1 : 0;
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  const rappel = saisie.rappelLe?.trim() || null;
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO agenda_elements (
        id, cabinet_id, dossier_id, type_element, titre, debut, rappel_le,
        origine_calcul, jours_calcul, mois_calcul, annees_calcul,
        revision, visibilite, restreint, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        dossier.cabinet_id,
        saisie.dossierId,
        saisie.typeElement,
        titre,
        debut,
        rappel,
        saisie.origineCalcul ?? null,
        saisie.joursCalcul ?? null,
        saisie.moisCalcul ?? null,
        saisie.anneesCalcul ?? null,
        restreint === 1 ? "restreint" : "public",
        restreint,
        creeLe,
      ],
    );
  });
  return id;
}

export async function recalculerEcheance(id: string, origine: string): Promise<string> {
  const database = await getPowerSyncDatabase();
  const rows = await database.getAll<{
    jours_calcul: number | null;
    mois_calcul: number | null;
    annees_calcul: number | null;
  }>(
    "SELECT jours_calcul, mois_calcul, annees_calcul FROM agenda_elements WHERE id = ? LIMIT 1",
    [id],
  );
  const ligne = rows[0];
  if (!ligne) throw new Error("Échéance introuvable");
  const resultat = calculerDelaiComplet({
    origine,
    jours: ligne.jours_calcul ?? 0,
    mois: ligne.mois_calcul ?? 0,
    annees: ligne.annees_calcul ?? 0,
    siegeJuridiction: "metropole",
    lieuPartie: "metropole",
    typeDelai: { augmentationDistance: "oui" },
  });
  const debut = instantPourHeureParis(resultat.echeance, 9, 0);
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      "UPDATE agenda_elements SET origine_calcul = ?, debut = ? WHERE id = ?",
      [origine, debut, id],
    );
  });
  return resultat.echeance;
}

export async function retirerEcheance(id: string): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("DELETE FROM agenda_elements WHERE id = ?", [id]);
  });
}
