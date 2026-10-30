import { texteSaisi } from "@/contacts/texteSaisi";

/** Null si la dénomination est vide. Le nom d'une société est obligatoire. */
export function normaliserDenomination(valeur: string): string | null {
  return texteSaisi(valeur);
}
