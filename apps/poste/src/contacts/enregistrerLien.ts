import {
  creerFicheEtLien,
  creerLien,
  modifierLien,
  type FicheDirigeant,
  type LienAEcrire,
} from "@/contacts/ecrireLien";
import type { ChampsLienModifies } from "@/contacts/controleLien";
import { preparerLienDirigeant, type DirigeantRegistre } from "@/contacts/dirigeants";
import type { LienAffiche } from "@/contacts/liensContacts";
import { getPowerSyncDatabase } from "@/sync/database";

/** Écritures locales des liens sur la base du poste (voir `ecrireLien.ts`) : hors ligne comprise. */

export async function ecrireLienLocal(lien: LienAEcrire): Promise<string> {
  return creerLien(await getPowerSyncDatabase(), lien);
}

export async function ecrireFicheEtLienLocal(
  fiche: FicheDirigeant,
  lien: Omit<LienAEcrire, "sourceId">,
): Promise<{ contactId: string; lienId: string }> {
  return creerFicheEtLien(await getPowerSyncDatabase(), fiche, lien);
}

export async function ecrireModificationLienLocal(id: string, champs: ChampsLienModifies): Promise<boolean> {
  return modifierLien(await getPowerSyncDatabase(), id, champs);
}

/**
 * Écrit le lien d'un dirigeant du registre vers la société (`societe`), contrôles du poste compris. `sourceId` :
 * la fiche existante à relier ; `null` : la fiche du dirigeant est créée dans la même transaction locale, avant
 * le lien (la file d'envoi garde cet ordre). Lève une erreur au message lisible si un contrôle refuse.
 */
export async function ecrireLienDirigeantLocal(
  societe: { id: string; nature: "physique" | "morale" },
  dirigeant: DirigeantRegistre,
  sourceId: string | null,
  liensExistants: readonly LienAffiche[],
): Promise<void> {
  const preparation = preparerLienDirigeant(societe, dirigeant, sourceId, liensExistants);
  if (!preparation.ok) throw new Error(preparation.message);
  if (preparation.fiche === null) {
    if (sourceId === null) throw new Error("La fiche du dirigeant est introuvable.");
    await ecrireLienLocal({ ...preparation.lien, sourceId, cibleId: societe.id });
    return;
  }
  await ecrireFicheEtLienLocal(preparation.fiche, { ...preparation.lien, cibleId: societe.id });
}
