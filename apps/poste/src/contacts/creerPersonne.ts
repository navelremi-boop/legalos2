import { assemblerAdresse, communeRetenue } from "@/contacts/creationContact";
import { civiliteRefusee, dateNaissanceValide, normaliserIdentite, type IdentiteSaisie } from "@/contacts/identiteFiche";
import { champsFicheVides, type ContactListe, type ProfessionReglementee } from "@/contacts/listeContacts";
import { estProfessionFiche } from "@/contacts/professionsFiche";
import { texteSaisi } from "@/contacts/texteSaisi";

export type FichePersonneACreer = {
  identite: IdentiteSaisie;
  professionCode: ProfessionReglementee | null;
  adresseDomicile: string | null;
};

export type SaisiePersonne = {
  civilite: string;
  accord: string;
  prenoms: string;
  nom: string;
  nomNaissance: string;
  dateNaissance: string;
  lieuNaissance: string;
  nationalite: string;
  profession: string;
  professionReglementee: string;
  voie: string;
  codePostal: string;
  commune: string;
};

/** Champs de la personne à créer. Lève une erreur au message lisible si la saisie ne passe pas. */
export function preparerCreationPersonne(saisie: SaisiePersonne): FichePersonneACreer {
  if (civiliteRefusee(saisie.civilite)) throw new Error("Cette civilité n'est pas proposée.");
  if (saisie.nom.trim() === "") throw new Error("Le nom est requis.");
  const date = saisie.dateNaissance.trim();
  if (date !== "" && !dateNaissanceValide(date)) throw new Error("La date de naissance est illisible.");
  const accord = saisie.accord === "masculin" || saisie.accord === "feminin" ? saisie.accord : null;
  const identite = normaliserIdentite({
    civilite: texteSaisi(saisie.civilite),
    accord,
    prenoms: texteSaisi(saisie.prenoms),
    nom: saisie.nom,
    nomNaissance: texteSaisi(saisie.nomNaissance),
    dateNaissance: date === "" ? null : date,
    lieuNaissance: texteSaisi(saisie.lieuNaissance),
    nationalite: texteSaisi(saisie.nationalite),
    profession: texteSaisi(saisie.profession),
  });
  if (identite === null) throw new Error("Le nom est requis.");
  const codePostal = saisie.codePostal.trim();
  return {
    identite,
    professionCode: estProfessionFiche(saisie.professionReglementee) ? saisie.professionReglementee : null,
    adresseDomicile: assemblerAdresse({
      voie: saisie.voie,
      codePostal,
      commune: communeRetenue(codePostal, saisie.commune),
    }),
  };
}

/** Ligne de liste de la personne créée, affichée sans attendre la synchronisation. */
export function contactDepuisPersonne(fiche: FichePersonneACreer, id: string): ContactListe {
  const { identite } = fiche;
  return {
    id,
    nature: "physique",
    nom: identite.nom,
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: fiche.professionCode !== null,
    ...champsFicheVides(),
    civilite: identite.civilite,
    accordSaisi: identite.accord,
    prenoms: identite.prenoms,
    nomNaissance: identite.nomNaissance,
    dateNaissance: identite.dateNaissance,
    lieuNaissance: identite.lieuNaissance,
    nationalite: identite.nationalite,
    profession: identite.profession,
    adresseDomicile: fiche.adresseDomicile,
    professionCode: fiche.professionCode,
  };
}

/** Corps de `POST /contacts` pour une personne physique. */
export function corpsCreationPersonne(
  fiche: FichePersonneACreer,
  id: string,
  cleIdempotence: string,
): Record<string, unknown> {
  const { identite } = fiche;
  return {
    id,
    idempotence_cle: cleIdempotence,
    nature: "physique",
    nom: identite.nom,
    type_client: "particulier",
    civilite: identite.civilite,
    accord: identite.accord,
    prenoms: identite.prenoms,
    nom_naissance: identite.nomNaissance,
    date_naissance: identite.dateNaissance,
    lieu_naissance: identite.lieuNaissance,
    nationalite: identite.nationalite,
    profession: identite.profession,
    profession_reglementee: fiche.professionCode,
  };
}
