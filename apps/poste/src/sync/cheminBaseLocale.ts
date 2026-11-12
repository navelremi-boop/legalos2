/**
 * Nom de la base locale du poste. Condition de l'exception RUSTSEC-2026-0459 (apps/poste/src-tauri/deny.toml,
 * docs/audit-dependances.md) : le poste n'ouvre que la base qu'il a créée lui-même dans son dossier de données,
 * jamais un fichier fourni par l'utilisateur ou reçu par mail. Le dossier est imposé par `database.ts`
 * (`appDataDir`) ; ce module n'accepte qu'un nom de fichier simple, sans chemin.
 */

const PREFIXE = "legalos-powersync";
const IDENTIFIANT_POSTE = /^[A-Za-z0-9_-]{1,64}$/u;
const NOM_AUTORISE = /^legalos-powersync(?:-[A-Za-z0-9_-]{1,64})?\.db$/u;

/** Vrai pour le seul nom de fichier que le poste crée : `legalos-powersync.db` ou `legalos-powersync-<poste>.db`. */
export function estNomDeBaseAutorise(nom: string): boolean {
  return NOM_AUTORISE.test(nom);
}

/** Nom de la base locale d'un poste (`posteId` vide hors isolation de recette). Refuse tout identifiant qui ne soit pas un mot simple. */
export function nomBaseLocale(posteId: string): string {
  if (posteId !== "" && !IDENTIFIANT_POSTE.test(posteId)) {
    throw new Error("Identifiant de poste refusé : la base locale reste dans le dossier de données de l'application.");
  }
  const nom = posteId === "" ? `${PREFIXE}.db` : `${PREFIXE}-${posteId}.db`;
  if (!estNomDeBaseAutorise(nom)) {
    throw new Error("Nom de base locale refusé.");
  }
  return nom;
}
