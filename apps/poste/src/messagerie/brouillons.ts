import type { CommonPowerSyncDatabase } from "@powersync/common";
import {
  champsEcrits,
  colonnesModifiees,
  type ChampsEcrits,
  type EtatRedaction,
  type LigneBrouillon,
} from "@/messagerie/etatRedaction";

/**
 * Brouillons de message dans la base locale (table `brouillons_message`, synchronisée par le flux
 * `brouillons_titulaire`). Écrire ici suffit : la file d'envoi PowerSync porte l'écriture jusqu'à l'API, donc
 * un brouillon s'enregistre hors ligne et part dès que la connexion revient. Dernière écriture gagnante
 * (docs/conflits.md, exception `brouillons_message`).
 */

export type BaseBrouillons = Pick<
  CommonPowerSyncDatabase,
  "execute" | "getAll" | "writeTransaction" | "getUploadQueueStats"
>;

const COLONNES_LUES =
  "id, compte_id, genre, origine_message_id, dossier_id, a, cc, cci, objet, corps_html, corps, en_reponse_a, references_texte, pieces_texte, modifie_le, cree_le";

export async function lireBrouillon(base: BaseBrouillons, id: string): Promise<LigneBrouillon | null> {
  const lignes = await base.getAll<LigneBrouillon>(
    `SELECT ${COLONNES_LUES} FROM brouillons_message WHERE id = ? LIMIT 1`,
    [id],
  );
  return lignes[0] ?? null;
}

/** Brouillons de l'utilisateur, du plus récemment modifié au plus ancien. */
export async function listerBrouillons(base: BaseBrouillons): Promise<LigneBrouillon[]> {
  return base.getAll<LigneBrouillon>(
    `SELECT ${COLONNES_LUES} FROM brouillons_message ORDER BY modifie_le DESC, cree_le DESC`,
  );
}

/** Cabinet de l'utilisateur, lu sur le poste (une seule ligne `cabinets` y descend). */
async function cabinetLocal(base: BaseBrouillons): Promise<string | null> {
  const lignes = await base.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  return lignes[0]?.id ?? null;
}

export type Enregistrement = {
  /** Colonnes écrites par ce passage, pour le test et la trace. */
  colonnes: string[];
  creation: boolean;
  instant: Date;
};

/**
 * Enregistre l'état. Première écriture : insertion de la ligne entière. Ensuite : seules les colonnes qui
 * ont changé depuis `precedent` (rien n'est écrit si rien n'a changé).
 */
export async function enregistrerBrouillon(
  base: BaseBrouillons,
  entree: {
    etat: EtatRedaction;
    precedent: ChampsEcrits | null;
    auteurId: string | null;
    maintenant: Date;
  },
): Promise<Enregistrement> {
  const { etat, precedent, auteurId, maintenant } = entree;
  const apres = champsEcrits(etat);
  const instant = maintenant.toISOString();
  if (precedent === null) {
    const cabinetId = await cabinetLocal(base);
    await base.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO brouillons_message (
           id, cabinet_id, auteur_id, compte_id, genre, origine_message_id, dossier_id,
           a, cc, cci, objet, corps_html, corps, en_reponse_a, references_texte, pieces_texte,
           revision, cree_le, modifie_le
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)`,
        [
          etat.id,
          cabinetId,
          auteurId,
          apres.compte_id,
          apres.genre,
          apres.origine_message_id,
          apres.dossier_id,
          apres.a,
          apres.cc,
          apres.cci,
          apres.objet,
          apres.corps_html,
          apres.corps,
          apres.en_reponse_a,
          apres.references_texte,
          instant,
          instant,
        ],
      );
    });
    return { colonnes: Object.keys(apres), creation: true, instant: maintenant };
  }
  const modifiees = colonnesModifiees(precedent, apres);
  const noms = Object.keys(modifiees);
  if (noms.length === 0) return { colonnes: [], creation: false, instant: maintenant };
  // Les noms de colonnes viennent de `ChampsEcrits`, jamais de la saisie : seules les valeurs sont paramétrées.
  const affectations = noms.map((nom) => `${nom} = ?`).join(", ");
  const valeurs = noms.map((nom) => modifiees[nom as keyof ChampsEcrits] ?? null);
  await base.writeTransaction(async (tx) => {
    await tx.execute(`UPDATE brouillons_message SET ${affectations}, modifie_le = ? WHERE id = ?`, [
      ...valeurs,
      instant,
      etat.id,
    ]);
  });
  return { colonnes: noms, creation: false, instant: maintenant };
}

/** Supprime le brouillon du poste ; la file d'envoi PowerSync demande à l'API de retirer sa copie. */
export async function supprimerBrouillon(base: BaseBrouillons, id: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute("DELETE FROM brouillons_message WHERE id = ?", [id]);
  });
}

/** Écritures locales pas encore reçues par le serveur. */
export async function ecrituresEnAttente(base: BaseBrouillons): Promise<number> {
  const stats = await base.getUploadQueueStats();
  return stats.count;
}

/**
 * Attend que la file d'envoi du poste soit vide, donc que le serveur ait reçu le brouillon. Faux si le délai
 * passe : l'appelant dit alors à l'utilisateur de réessayer plutôt que d'envoyer un brouillon périmé.
 */
export async function attendreFileVide(
  base: BaseBrouillons,
  delaiMs: number,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((fin) => setTimeout(fin, ms)),
): Promise<boolean> {
  const debut = Date.now();
  for (;;) {
    if ((await ecrituresEnAttente(base)) === 0) return true;
    if (Date.now() - debut >= delaiMs) return false;
    await pause(250);
  }
}

/** Dernier refus du serveur pour ce brouillon (table locale `refus_sync`), ou `null`. */
export async function dernierRefus(base: BaseBrouillons, id: string): Promise<string | null> {
  const lignes = await base.getAll<{ message: string }>(
    "SELECT message FROM refus_sync WHERE enregistrement_id = ? AND table_cible = 'brouillons_message' ORDER BY cree_le DESC LIMIT 1",
    [id],
  );
  return lignes[0]?.message ?? null;
}
