import type { CommonPowerSyncDatabase } from "@powersync/common";

/**
 * Écriture d'une saisie de temps dans la base locale (hors ligne), chemin commun au formulaire de saisie (J8) et à la
 * suggestion tirée d'un mail (J11). Le connecteur du poste porte les lignes à l'API, qui les enregistre : le taux
 * horaire de la saisie est fixé ici, à l'enregistrement, et ne change plus avec les taux du cabinet. La ligne de
 * brouillon de facture sans numéro l'accompagne ; le numéro vient du serveur à la validation.
 */

export type BaseTemps = Pick<CommonPowerSyncDatabase, "getAll" | "writeTransaction">;

/** Taux horaire proposé quand le cabinet n'en a enregistré aucun, en centimes par heure (60 €). */
export const TAUX_PAR_DEFAUT_CENTIMES = 6_000;

/** HT = (minutes × taux_centimes_heure) / 60. Hypothèse F0. */
export function htTempsCentimes(minutes: number, tauxCentimesHeure: number): number {
  return Math.trunc((minutes * tauxCentimesHeure) / 60);
}

/** Dernier taux horaire du cabinet, hors dossier ou client précis ; à défaut `TAUX_PAR_DEFAUT_CENTIMES`. */
export async function tauxHoraireParDefaut(base: Pick<CommonPowerSyncDatabase, "getAll">): Promise<number> {
  const taux = await base.getAll<{ centimes_par_heure: number }>(
    `SELECT centimes_par_heure FROM taux_horaires
     WHERE dossier_id IS NULL OR dossier_id = ''
     ORDER BY cree_le DESC LIMIT 1`,
  );
  const premier = taux[0]?.centimes_par_heure;
  return typeof premier === "number" && premier > 0 ? premier : TAUX_PAR_DEFAUT_CENTIMES;
}

export type SaisieTemps = {
  dossierId: string;
  minutes: number;
  libelle: string;
  tauxCentimesHeure: number;
  /** Identifiants des lignes, générés par l'appelant (rejouables) ; par défaut des UUID aléatoires. */
  tempsId?: string;
  factureId?: string;
  /** Intervenant : l'utilisateur connecté. Absent : le premier utilisateur synchronisé, puis le cabinet. */
  intervenantId?: string | null;
  /** Instant de l'enregistrement (horloge injectable pour les tests). */
  maintenant?: Date;
};

export type ResultatSaisieTemps =
  | { ok: true; tempsId: string; factureId: string; htCentimes: number }
  | { ok: false; message: string };

export async function enregistrerTemps(base: BaseTemps, saisie: SaisieTemps): Promise<ResultatSaisieTemps> {
  const { dossierId, minutes, libelle, tauxCentimesHeure } = saisie;
  if (!Number.isInteger(minutes) || minutes <= 0 || libelle.trim() === "") {
    return { ok: false, message: "Saisissez une durée et un libellé." };
  }
  if (!Number.isInteger(tauxCentimesHeure) || tauxCentimesHeure <= 0) {
    return { ok: false, message: "Indiquez un taux horaire en centimes." };
  }
  const ht = htTempsCentimes(minutes, tauxCentimesHeure);
  if (ht <= 0) return { ok: false, message: "Montant calculé nul." };

  const cabinets = await base.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  const cabinetId = cabinets[0]?.id;
  if (cabinetId === undefined || cabinetId === "") return { ok: false, message: "Aucun cabinet synchronisé." };
  const dossiers = await base.getAll<{ restreint: number }>("SELECT restreint FROM dossiers WHERE id = ?", [dossierId]);
  if (dossiers.length === 0) return { ok: false, message: "Dossier introuvable dans la base locale." };
  const visibilite = dossiers[0]?.restreint ? "restreint" : "public";
  let intervenantId = saisie.intervenantId ?? null;
  if (intervenantId === null || intervenantId === "") {
    const utilisateurs = await base.getAll<{ id: string }>("SELECT id FROM users LIMIT 1");
    intervenantId = utilisateurs[0]?.id ?? cabinetId;
  }
  const tempsId = saisie.tempsId ?? crypto.randomUUID();
  const factureId = saisie.factureId ?? crypto.randomUUID();
  const creeLe = (saisie.maintenant ?? new Date()).toISOString();
  const intervenant = intervenantId;

  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO temps_saisis (
        id, cabinet_id, dossier_id, intervenant_id, minutes, libelle,
        taux_centimes_heure, ht_centimes, visibilite, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tempsId, cabinetId, dossierId, intervenant, minutes, libelle, tauxCentimesHeure, ht, visibilite, creeLe],
    );
    await tx.execute(
      `INSERT INTO brouillons_facture (
        id, cabinet_id, dossier_id, temps_id, numero, ht_centimes, libelle,
        intervenant_id, taux_centimes_heure, visibilite, cree_le
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [factureId, cabinetId, dossierId, tempsId, ht, libelle, intervenant, tauxCentimesHeure, visibilite, creeLe],
    );
  });
  return { ok: true, tempsId, factureId, htCentimes: ht };
}
