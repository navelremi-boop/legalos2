import {
  appliquerCoordonnees,
  champsFicheVides,
  estProfessionReglementee,
  libelleCapital,
  type ContactListe,
  type CoordonneeLue,
  type NatureContactListe,
  type ProfessionReglementee,
  type TypeClientListe,
} from "@/contacts/listeContacts";
import type { LienAffiche } from "@/contacts/liensContacts";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneSql = {
  id: string;
  nature: string;
  nom: string;
  siren: string | null;
  numero_tva: string | null;
  type_client: string;
  civilite: string | null;
  accord: string | null;
  prenoms: string | null;
  nom_naissance: string | null;
  date_naissance: string | null;
  lieu_naissance: string | null;
  nationalite: string | null;
  profession: string | null;
  forme: string | null;
  capital_centimes: number | null;
  monnaie: string | null;
  greffe_rcs: string | null;
  activite: string | null;
  profession_reglementee: string | null;
  barreau: string | null;
  toque: string | null;
  specialite: string | null;
  cour_appel: string | null;
};

type LienSql = {
  id: string;
  contact_source_id: string;
  contact_cible_id: string;
  source_civilite: string | null;
  source_prenoms: string | null;
  source_nom: string;
  cible_nom: string;
  type_lien: string;
  fonction: string | null;
  libelle: string | null;
  debut: string | null;
  fin: string | null;
};

type CoordSql = {
  contact_id: string;
  genre: string;
  usage: string;
  valeur: string;
  principale: number | null;
  cree_le: string | null;
};

function estNature(valeur: string): valeur is NatureContactListe {
  return valeur === "physique" || valeur === "morale";
}

function estTypeClient(valeur: string): valeur is TypeClientListe {
  return valeur === "professionnel" || valeur === "particulier" || valeur === "etranger";
}

function versContact(ligne: LigneSql): ContactListe | null {
  if (!estNature(ligne.nature) || !estTypeClient(ligne.type_client)) return null;
  const code: ProfessionReglementee | null = estProfessionReglementee(ligne.profession_reglementee)
    ? ligne.profession_reglementee
    : null;
  const accord = ligne.accord === "masculin" || ligne.accord === "feminin" ? ligne.accord : null;
  return {
    id: ligne.id,
    nature: ligne.nature,
    nom: ligne.nom,
    siren: ligne.siren,
    numeroTva: ligne.numero_tva,
    typeClient: ligne.type_client,
    professionReglementee: code !== null,
    ...champsFicheVides(),
    civilite: ligne.civilite,
    accordSaisi: accord,
    prenoms: ligne.prenoms,
    nomNaissance: ligne.nom_naissance,
    dateNaissance: ligne.date_naissance,
    lieuNaissance: ligne.lieu_naissance,
    nationalite: ligne.nationalite,
    profession: ligne.profession,
    forme: ligne.forme,
    capitalLibelle:
      ligne.capital_centimes === null ? null : libelleCapital(ligne.capital_centimes, ligne.monnaie),
    greffe: ligne.greffe_rcs,
    professionCode: code,
    barreau: ligne.barreau,
    specialite: ligne.specialite,
    courAppel: ligne.cour_appel,
  };
}

export type AnnuaireLocal = {
  contacts: ContactListe[];
  coordonnees: CoordonneeLue[];
  liens: LienAffiche[];
};

/** Annuaire lu dans la base locale : fiches, coordonnées et liens. */
export async function lireAnnuaireLocal(): Promise<AnnuaireLocal> {
  const database = await getPowerSyncDatabase();
  const rows = await database.getAll<LigneSql>(
    `SELECT id, nature, nom, siren, numero_tva, type_client, civilite, accord, prenoms,
      nom_naissance, date_naissance, lieu_naissance, nationalite, profession, forme,
      capital_centimes, monnaie, greffe_rcs, activite, profession_reglementee, barreau,
      toque, specialite, cour_appel
     FROM contacts ORDER BY nom COLLATE NOCASE`,
  );
  const coords = await database.getAll<CoordSql>(
    "SELECT contact_id, genre, usage, valeur, principale, cree_le FROM contact_coordonnees",
  );
  const liens = await database.getAll<LienSql>(
    `SELECT l.id, l.contact_source_id, l.contact_cible_id, l.type_lien, l.fonction, l.libelle,
      l.debut, l.fin, s.civilite AS source_civilite, s.prenoms AS source_prenoms, s.nom AS source_nom,
      c.nom AS cible_nom
     FROM contact_liens l
     JOIN contacts s ON s.id = l.contact_source_id
     JOIN contacts c ON c.id = l.contact_cible_id`,
  );
  const contacts: ContactListe[] = [];
  for (const ligne of rows) {
    const contact = versContact(ligne);
    if (contact !== null) contacts.push(contact);
  }
  const coordonnees: CoordonneeLue[] = coords.map((ligne) => ({
    contactId: ligne.contact_id,
    genre: ligne.genre,
    usage: ligne.usage,
    valeur: ligne.valeur,
    principale: ligne.principale === 1,
    creeLe: ligne.cree_le ?? "",
  }));
  return {
    contacts: appliquerCoordonnees(contacts, coordonnees),
    coordonnees,
    liens: liens.map((ligne) => ({
      id: ligne.id,
      sourceId: ligne.contact_source_id,
      cibleId: ligne.contact_cible_id,
      sourceCivilite: ligne.source_civilite,
      sourcePrenoms: ligne.source_prenoms,
      sourceNom: ligne.source_nom,
      cibleNom: ligne.cible_nom,
      typeLien: ligne.type_lien,
      fonction: ligne.fonction,
      libelle: ligne.libelle,
      debut: ligne.debut,
      fin: ligne.fin,
    })),
  };
}
