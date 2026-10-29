/** Dossier proposé par la recherche (docs/design.md : un dossier se choisit par recherche). */
export type DossierChoix = {
  id: string;
  nom: string;
  reference?: string | null;
  chemise?: string | null;
};

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

/**
 * Dossiers dont le nom ou la référence contient chacun des mots saisis, accents et casse ignorés.
 * Ceux dont le nom commence par la saisie viennent d'abord ; sans saisie, la liste dans l'ordre reçu.
 */
export function filtrerDossiers(dossiers: DossierChoix[], saisie: string, limite = 8): DossierChoix[] {
  const mots = normaliser(saisie).split(/\s+/u).filter((mot) => mot !== "");
  if (mots.length === 0) return dossiers.slice(0, limite);
  const debut = mots.join(" ");
  const trouves = dossiers.filter((dossier) => {
    const texte = normaliser(`${dossier.nom} ${dossier.reference ?? ""}`);
    return mots.every((mot) => texte.includes(mot));
  });
  const rang = (dossier: DossierChoix) =>
    normaliser(dossier.nom).startsWith(debut) || normaliser(dossier.reference ?? "").startsWith(debut) ? 0 : 1;
  return [...trouves].sort((a, b) => rang(a) - rang(b)).slice(0, limite);
}
