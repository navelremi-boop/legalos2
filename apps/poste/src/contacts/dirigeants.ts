import type { ContactListe } from "@/contacts/listeContacts";
import { controlerLien, saisieLienVide, type LienNormalise, type SaisieLien } from "@/contacts/controleLien";
import type { FicheDirigeant } from "@/contacts/ecrireLien";
import type { LienAffiche } from "@/contacts/liensContacts";

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

function fonctionDepuisQualite(qualite: string | null): string | null {
  const net = normaliser(qualite ?? "");
  const fonctions: Record<string, string> = {
    gerant: "gerant",
    gerante: "gerant",
    presidente: "president",
    president: "president",
    "directeur general": "directeur_general",
    "directrice generale": "directeur_general",
    "directeur general delegue": "directeur_general_delegue",
    "directrice generale deleguee": "directeur_general_delegue",
    administrateur: "administrateur",
    administratrice: "administrateur",
    "membre du directoire": "membre_directoire",
    "membre du conseil de surveillance": "membre_conseil_surveillance",
    "liquidateur amiable": "liquidateur_amiable",
    "liquidatrice amiable": "liquidateur_amiable",
  };
  return fonctions[net] ?? null;
}

/** Type et fonction du lien que propose la qualité indiquée par le registre. */
function typeEtFonction(dirigeant: DirigeantRegistre): Pick<LienNormalise, "typeLien" | "fonction" | "libelle"> {
  const fonction = fonctionDepuisQualite(dirigeant.qualite);
  return fonction === null
    ? { typeLien: "autre", fonction: null, libelle: dirigeant.qualite?.trim() || "Dirigeant" }
    : { typeLien: "mandat_social", fonction, libelle: null };
}

export type PreparationDirigeant =
  | { ok: true; lien: LienNormalise; fiche: FicheDirigeant | null }
  | { ok: false; message: string };

/**
 * Prépare l'écriture du lien d'un dirigeant vers la société, contrôles du poste compris (les mêmes que
 * « Ajouter un lien »). `sourceId` : la fiche existante à relier, ou `null` pour une fiche à créer, dont la
 * description est alors rendue avec le lien. Le lien ne représente pas la société : ce choix reste à part.
 */
export function preparerLienDirigeant(
  societe: { id: string; nature: "physique" | "morale" },
  dirigeant: DirigeantRegistre,
  sourceId: string | null,
  liensExistants: readonly LienAffiche[],
): PreparationDirigeant {
  const nom = dirigeant.nom?.trim() ?? "";
  if (sourceId === null && nom === "") return { ok: false, message: "Le registre ne donne pas le nom de ce dirigeant." };
  const propose = typeEtFonction(dirigeant);
  const saisie: SaisieLien = {
    ...saisieLienVide(),
    typeLien: propose.typeLien,
    fonction: propose.fonction ?? "",
    libelle: propose.libelle ?? "",
    representeSociete: false,
  };
  const controle = controlerLien(saisie, {
    sourceId: sourceId ?? "nouvelle-fiche",
    cible: { id: societe.id, nature: societe.nature },
    liensExistants,
    lienId: null,
  });
  if (!controle.ok) return { ok: false, message: controle.message };
  const fiche: FicheDirigeant | null =
    sourceId === null
      ? {
          nature: dirigeant.nature,
          nom,
          prenoms: dirigeant.nature === "physique" ? (dirigeant.prenoms?.trim() || null) : null,
          siren: dirigeant.nature === "morale" ? dirigeant.siren : null,
        }
      : null;
  return { ok: true, lien: controle.lien, fiche };
}

/** Lien à enregistrer. Ne représente pas la société : ce choix reste à part. */
export function lienDepuisDirigeant(
  societe: Pick<ContactListe, "id" | "nom">,
  fiche: ContactListe,
  dirigeant: DirigeantRegistre,
  id: string,
): LienAffiche {
  const fonction = fonctionDepuisQualite(dirigeant.qualite);
  return {
    id,
    sourceId: fiche.id,
    cibleId: societe.id,
    sourceCivilite: fiche.civilite,
    sourcePrenoms: fiche.prenoms,
    sourceNom: fiche.nom,
    cibleNom: societe.nom,
    typeLien: fonction === null ? "autre" : "mandat_social",
    fonction,
    libelle: fonction === null ? dirigeant.qualite?.trim() || "Dirigeant" : null,
    representeSociete: false,
    debut: null,
    fin: null,
  };
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
