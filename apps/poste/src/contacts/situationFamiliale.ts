import type { AccordGrammatical } from "@/contacts/listeContacts";

/** Codes enregistrés. L'affichage accorde le libellé ; le code, non. */
export const SITUATIONS_FAMILIALES = ["celibataire", "marie", "pacse", "divorce", "veuf"] as const;

export type SituationFamiliale = (typeof SITUATIONS_FAMILIALES)[number];

const LIBELLES: Record<SituationFamiliale, { masculin: string; feminin: string; neutre: string }> = {
  celibataire: { masculin: "Célibataire", feminin: "Célibataire", neutre: "Célibataire" },
  marie: { masculin: "Marié", feminin: "Mariée", neutre: "Marié(e)" },
  pacse: { masculin: "Pacsé", feminin: "Pacsée", neutre: "Pacsé(e)" },
  divorce: { masculin: "Divorcé", feminin: "Divorcée", neutre: "Divorcé(e)" },
  veuf: { masculin: "Veuf", feminin: "Veuve", neutre: "Veuf ou veuve" },
};

export function estSituationFamiliale(valeur: string): valeur is SituationFamiliale {
  return (SITUATIONS_FAMILIALES as readonly string[]).includes(valeur);
}

/** Libellé accordé. Sans accord connu, la forme ne choisit pas un genre. */
export function libelleSituation(code: string, accord: AccordGrammatical | null): string {
  if (!estSituationFamiliale(code)) return "";
  const formes = LIBELLES[code];
  if (accord === "feminin") return formes.feminin;
  if (accord === "masculin") return formes.masculin;
  return formes.neutre;
}
