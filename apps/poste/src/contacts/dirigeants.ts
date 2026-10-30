import type { ContactListe } from "@/contacts/listeContacts";

export type DirigeantRegistre = {
  nature: "physique" | "morale";
  nom: string | null;
  prenoms: string | null;
  /** Mois et année `AAAA-MM`. */
  naissance: string | null;
  siren: string | null;
  qualite: string | null;
};

function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[-'’]/g, " ")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ")
    .trim();
}

function sirenChiffres(valeur: string | null): string {
  return (valeur ?? "").replace(/\D/g, "");
}

/** Fiches déjà là qui correspondent. N'en crée aucune. */
export function fichesDuDirigeant(
  dirigeant: DirigeantRegistre,
  contacts: readonly ContactListe[],
): ContactListe[] {
  if (dirigeant.nature === "morale") {
    const siren = sirenChiffres(dirigeant.siren);
    if (siren.length !== 9) return [];
    return contacts.filter((contact) => sirenChiffres(contact.siren) === siren);
  }
  const nom = normaliser(dirigeant.nom ?? "");
  const prenoms = normaliser(dirigeant.prenoms ?? "");
  const naissance = dirigeant.naissance ?? "";
  if (nom === "" || prenoms === "" || !/^\d{4}-\d{2}$/.test(naissance)) return [];
  return contacts.filter((contact) => {
    if (contact.nature !== "physique") return false;
    if (normaliser(contact.nom) !== nom) return false;
    if (normaliser(contact.prenoms ?? "") !== prenoms) return false;
    return (contact.dateNaissance ?? "").slice(0, 7) === naissance;
  });
}

export function dirigeantsDepuisJson(valeur: unknown): DirigeantRegistre[] {
  if (!Array.isArray(valeur)) return [];
  const lus: DirigeantRegistre[] = [];
  for (const entree of valeur) {
    if (entree === null || typeof entree !== "object") continue;
    const ligne = entree as Record<string, unknown>;
    const texte = (cle: string): string | null => (typeof ligne[cle] === "string" ? ligne[cle] : null);
    const nature = texte("nature") === "morale" ? "morale" : "physique";
    lus.push({
      nature,
      nom: texte("nom"),
      prenoms: texte("prenoms"),
      naissance: texte("naissance"),
      siren: texte("siren"),
      qualite: texte("qualite"),
    });
  }
  return lus;
}
