/**
 * Miroir TypeScript du connecteur d'envoi du poste (apps/poste/src-tauri/src/powersync_connect.rs,
 * `corps_brouillon`) pour la table `brouillons_message` : de quoi est fait le corps de
 * `PUT /api/messagerie/brouillons/{id}` quand le poste porte une écriture locale.
 *
 * Deux usages : l'écriture directe d'un brouillon complet avant un téléversement de pièce ou un envoi (même
 * corps que la file d'envoi, donc même résultat), et le test qui compare ce corps à celui du connecteur
 * (tests/recette/fixtures/brouillon-upload.json, lu par les deux côtés).
 */

export const TABLE_BROUILLONS_MESSAGE = "brouillons_message";

/** Colonnes qui ne partent jamais : le serveur les pose. */
export const COLONNES_DU_SERVEUR: readonly string[] = [
  "id",
  "cabinet_id",
  "auteur_id",
  "pieces_texte",
  "revision",
  "cree_le",
  "modifie_le",
];

function texteNonVide(colonnes: Readonly<Record<string, unknown>>, nom: string): string | null {
  const valeur = colonnes[nom];
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

function lignes(valeur: unknown): string[] {
  return (typeof valeur === "string" ? valeur : "")
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "");
}

/** Corps d'une écriture partielle : seules les colonnes présentes partent. */
export function corpsBrouillon(colonnes: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  for (const nom of ["compte_id", "genre", "origine_message_id"]) {
    const valeur = texteNonVide(colonnes, nom);
    if (valeur !== null) corps[nom] = valeur;
  }
  for (const nom of ["objet", "corps_html", "corps"]) {
    const valeur = colonnes[nom];
    if (typeof valeur === "string") corps[nom] = valeur;
  }
  if ("dossier_id" in colonnes) corps.dossier_id = texteNonVide(colonnes, "dossier_id");
  if ("en_reponse_a" in colonnes) {
    const valeur = colonnes.en_reponse_a;
    corps.en_reponse_a = typeof valeur === "string" ? valeur : "";
  }
  for (const [colonne, champ] of [
    ["a", "a"],
    ["cc", "cc"],
    ["cci", "cci"],
    ["references_texte", "references"],
  ] as const) {
    if (colonne in colonnes) corps[champ] = lignes(colonnes[colonne]);
  }
  return corps;
}
