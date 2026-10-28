/** Garde au plus six chiffres. Un collage « 123 456 » devient « 123456 ». */
export function repartirCode(saisie: string): string {
  return saisie.replace(/\D/g, "").slice(0, 6);
}

/** Six cases, vides à droite si le code est incomplet. */
export function chiffresCode(code: string): string[] {
  const propre = repartirCode(code);
  return Array.from({ length: 6 }, (_, index) => propre[index] ?? "");
}

/**
 * Même phrase que l'adresse soit inconnue ou le mot de passe faux.
 * Le serveur répond déjà « Identifiants invalides » dans les deux cas.
 */
export function messageConnexion(message: string): string {
  if (message === "Identifiants invalides") return "Adresse ou mot de passe incorrect";
  return message;
}
