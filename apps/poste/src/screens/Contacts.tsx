import { useEffect, useMemo, useState } from "react";
import {
  appliquerCoordonnees,
  champsFicheVides,
  compteursFiltres,
  estProfessionReglementee,
  FILTRES_CONTACTS,
  filtrerContacts,
  grouperAlphabetique,
  libelleCapital,
  libelleNature,
  libelleTypeClient,
  ONGLETS_FICHE,
  type ContactListe,
  type CoordonneeLue,
  type FiltreContacts,
  type NatureContactListe,
  type OngletFicheContact,
  type ProfessionReglementee,
  type TypeClientListe,
} from "@/contacts/listeContacts";
import { designationActe } from "@/contacts/designation";
import { ecrireCoordonnee, type GenreCoordonnee, type UsageCoordonnee } from "@/contacts/ecrireCoordonnee";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";
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

type CoordSql = {
  contact_id: string;
  genre: string;
  usage: string;
  valeur: string;
  principale: number | null;
  cree_le: string | null;
};

const VIDE_ONGLET: Record<Exclude<OngletFicheContact, "general">, string> = {
  liens: "Aucun lien.",
  dossiers: "Aucun dossier.",
  factures: "Aucune facture.",
  mails: "Aucun mail.",
  notes: "Aucune note.",
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

type ContactsProps = {
  /** Jeu figé de la galerie. Sans cela, la liste est lue dans la base locale. */
  lignesFixes?: readonly ContactListe[];
};

export function Contacts({ lignesFixes }: ContactsProps = {}) {
  const [lignesSync, setLignesSync] = useState<ContactListe[] | null>(null);
  const [coordsSync, setCoordsSync] = useState<CoordonneeLue[]>([]);
  const [filtre, setFiltre] = useState<FiltreContacts>("tous");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<OngletFicheContact>("general");

  useEffect(() => {
    if (lignesFixes !== undefined) return;
    let ignore = false;
    const charger = () => {
      void (async () => {
        try {
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
          if (ignore) return;
          const contacts: ContactListe[] = [];
          for (const ligne of rows) {
            const contact = versContact(ligne);
            if (contact !== null) contacts.push(contact);
          }
          const lues: CoordonneeLue[] = coords.map((ligne) => ({
            contactId: ligne.contact_id,
            genre: ligne.genre,
            usage: ligne.usage,
            valeur: ligne.valeur,
            principale: ligne.principale === 1,
            creeLe: ligne.cree_le ?? "",
          }));
          setCoordsSync(lues);
          setLignesSync(appliquerCoordonnees(contacts, lues));
        } catch {
          if (!ignore) setLignesSync([]);
        }
      })();
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [lignesFixes]);

  const lignes = lignesFixes ?? lignesSync;

  const comptes = useMemo(() => compteursFiltres(lignes ?? []), [lignes]);
  const visibles = useMemo(
    () => filtrerContacts(lignes ?? [], filtre, recherche),
    [lignes, filtre, recherche],
  );
  const groupes = useMemo(() => grouperAlphabetique(visibles), [visibles]);
  const choisi = visibles.find((contact) => contact.id === selection) ?? visibles[0] ?? null;

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col ecran" data-testid="ecran-contacts" data-fond="neutre">
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Contacts")}</h1>
          <p className="ecran-tete__sous-titre">
            {fr(`${String(comptes.tous)} contacts dans l'annuaire du cabinet`)}
          </p>
        </div>
      </header>
      <Feuille uneColonne className="min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-[23rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden border-r border-filet px-[22px] pt-[22px]">
            <label className="mb-3 block">
              <span className="sr-only">{fr("Rechercher un contact")}</span>
              <input
                type="search"
                className="champ w-full"
                placeholder={fr("Rechercher un contact")}
                aria-label={fr("Rechercher un contact")}
                data-testid="contacts-recherche"
                value={recherche}
                onChange={(event) => {
                  setRecherche(event.target.value);
                }}
              />
            </label>
            <div className="filtres mb-2" role="group" aria-label={fr("Filtrer les contacts")}>
              {FILTRES_CONTACTS.map((entree) => (
                <button
                  key={entree.id}
                  type="button"
                  className="filtre"
                  aria-pressed={filtre === entree.id}
                  data-testid={`contacts-filtre-${entree.id}`}
                  onClick={() => {
                    setFiltre(entree.id);
                  }}
                >
                  {fr(entree.label)} <span className="filtre__compte">{comptes[entree.id]}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-24" data-testid="contacts-liste">
              {lignes === null ? (
                <p className="etat-vide">{fr("Chargement des contacts.")}</p>
              ) : visibles.length === 0 ? (
                <p className="etat-vide">
                  {recherche.trim() !== ""
                    ? fr("Aucun contact ne correspond.")
                    : fr("Aucun contact dans ce filtre.")}
                </p>
              ) : (
                groupes.map((groupe) => (
                  <section key={groupe.lettre}>
                    <h2 className="dossiers-groupe">
                      {fr(groupe.lettre)} <span className="text-graphite">{groupe.contacts.length}</span>
                    </h2>
                    <ul>
                      {groupe.contacts.map((contact) => (
                        <li key={contact.id}>
                          <button
                            type="button"
                            className="w-full rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-survol"
                            data-testid="contacts-ligne"
                            data-contact-id={contact.id}
                            data-selected={choisi?.id === contact.id ? "true" : "false"}
                            onClick={() => {
                              setSelection(contact.id);
                              setOnglet("general");
                            }}
                          >
                            <span className="block font-bold">
                              {fr(contact.prenoms ? `${contact.prenoms} ${contact.nom}` : contact.nom)}
                            </span>
                            <span className="block text-[length:var(--font-size-dense)] text-graphite">
                              {fr(libelleNature(contact.nature))}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden" data-testid="contacts-fiche">
            {choisi === null ? (
              <p className="etat-vide px-6 pt-6">{fr("Choisissez un contact pour voir sa fiche.")}</p>
            ) : (
              <>
                <div className="px-6 pt-5">
                  <h2 className="text-[length:var(--font-size-section)] font-extrabold">{fr(choisi.nom)}</h2>
                  <p className="text-[length:var(--font-size-dense)] text-graphite">{fr(libelleNature(choisi.nature))}</p>
                </div>
                <div className="filtres px-6 pt-4" role="tablist" aria-label={fr("Sections de la fiche")}>
                  {ONGLETS_FICHE.map((entree) => (
                    <button
                      key={entree.id}
                      type="button"
                      role="tab"
                      className="filtre"
                      aria-selected={onglet === entree.id}
                      data-testid={`contacts-onglet-${entree.id}`}
                      onClick={() => {
                        setOnglet(entree.id);
                      }}
                    >
                      {fr(entree.label)}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4" role="tabpanel">
                  {onglet === "general" ? (
                    <FicheGenerale
                      contact={choisi}
                      coordonnees={coordsSync.filter((ligne) => ligne.contactId === choisi.id)}
                    />
                  ) : (
                    <p className="etat-vide">{fr(VIDE_ONGLET[onglet])}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Feuille>
    </div>
  );
}

const GENRES_COORDONNEE: { id: GenreCoordonnee; label: string }[] = [
  { id: "adresse", label: "Adresse" },
  { id: "telephone", label: "Téléphone" },
  { id: "email", label: "E-mail" },
  { id: "site", label: "Site" },
];

const USAGES_COORDONNEE: { id: UsageCoordonnee; label: string }[] = [
  { id: "domicile", label: "Domicile" },
  { id: "siege", label: "Siège" },
  { id: "correspondance", label: "Correspondance" },
  { id: "facturation", label: "Facturation" },
  { id: "cabinet", label: "Cabinet" },
  { id: "etude", label: "Étude" },
  { id: "autre", label: "Autre" },
];

function FicheGenerale({
  contact,
  coordonnees,
}: {
  contact: ContactListe;
  coordonnees: readonly CoordonneeLue[];
}) {
  const acte = designationActe(contact);
  const [copie, setCopie] = useState(false);
  const [genre, setGenre] = useState<GenreCoordonnee>("adresse");
  const [usage, setUsage] = useState<UsageCoordonnee>(contact.nature === "morale" ? "siege" : "domicile");
  const [valeur, setValeur] = useState("");
  const [principale, setPrincipale] = useState(true);
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <div data-testid="contacts-designation">
        <p className="font-bold">{fr("Désignation dans les actes")}</p>
        <p className="mt-1">{acte.texte === "" ? fr("Désignation incomplète.") : fr(acte.texte)}</p>
        <button
          type="button"
          className="filtre mt-2"
          data-testid="contacts-copier-designation"
          disabled={acte.texte === ""}
          onClick={() => {
            const texte = fr(acte.texte);
            void navigator.clipboard.writeText(texte).then(
              () => {
                setCopie(true);
              },
              () => {
                setCopie(false);
              },
            );
          }}
        >
          {fr(copie ? "Copié" : "Copier")}
        </button>
      </div>
      {acte.mentions.length > 0 ? (
        <div className="message-attention" data-testid="contacts-mentions">
          <ul>
            {acte.mentions.map((mention) => (
              <li key={mention.champ} data-testid="contacts-mention">
                {fr(mention.libelle)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="fiche-infos">
        <dt>{fr("Nom")}</dt>
        <dd>{fr(contact.prenoms ? `${contact.prenoms} ${contact.nom}` : contact.nom)}</dd>
        <dt>{fr("Nature")}</dt>
        <dd>{fr(libelleNature(contact.nature))}</dd>
        <dt>{fr("SIREN")}</dt>
        <dd>{contact.siren ? fr(contact.siren) : fr("Non renseigné")}</dd>
        <dt>{fr("N° TVA")}</dt>
        <dd>{contact.numeroTva ? fr(contact.numeroTva) : fr("Non renseigné")}</dd>
        <dt>{fr("Type de client")}</dt>
        <dd>{fr(libelleTypeClient(contact.typeClient))}</dd>
      </dl>
      <div>
        <p className="font-bold">{fr("Coordonnées")}</p>
        {coordonnees.length === 0 ? (
          <p className="etat-vide">{fr("Aucune coordonnée.")}</p>
        ) : (
          <ul data-testid="contacts-coordonnees">
            {coordonnees.map((ligne) => (
              <li key={`${ligne.genre}-${ligne.usage}-${ligne.creeLe}-${ligne.valeur}`} data-testid="contacts-coordonnee">
                {fr(`${libelleGenre(ligne.genre)}, ${libelleUsage(ligne.usage)} : ${ligne.valeur}`)}
                {ligne.principale ? fr(" (principale)") : ""}
              </li>
            ))}
          </ul>
        )}
        <form
            className="mt-3 flex flex-col gap-2"
            data-testid="contacts-coordonnee-form"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage("");
              void ecrireCoordonnee({
                contactId: contact.id,
                genre,
                usage,
                valeur,
                principale,
              }).then(
                () => {
                  setValeur("");
                  setMessage("Coordonnée enregistrée.");
                },
                () => {
                  setMessage("La coordonnée n'a pas pu être enregistrée.");
                },
              );
            }}
          >
            <label>
              <span className="sr-only">{fr("Genre")}</span>
              <select
                className="champ"
                aria-label={fr("Genre de coordonnée")}
                data-testid="contacts-coordonnee-genre"
                value={genre}
                onChange={(event) => {
                  const choisi = event.target.value;
                  if (choisi === "adresse" || choisi === "telephone" || choisi === "email" || choisi === "site") {
                    setGenre(choisi);
                  }
                }}
              >
                {GENRES_COORDONNEE.map((entree) => (
                  <option key={entree.id} value={entree.id}>
                    {fr(entree.label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{fr("Type")}</span>
              <select
                className="champ"
                aria-label={fr("Type de coordonnée")}
                data-testid="contacts-coordonnee-usage"
                value={usage}
                onChange={(event) => {
                  const choisi = event.target.value;
                  if (
                    choisi === "domicile" ||
                    choisi === "siege" ||
                    choisi === "correspondance" ||
                    choisi === "facturation" ||
                    choisi === "cabinet" ||
                    choisi === "etude" ||
                    choisi === "autre"
                  ) {
                    setUsage(choisi);
                  }
                }}
              >
                {USAGES_COORDONNEE.map((entree) => (
                  <option key={entree.id} value={entree.id}>
                    {fr(entree.label)}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="champ"
              aria-label={fr("Valeur de la coordonnée")}
              data-testid="contacts-coordonnee-valeur"
              value={valeur}
              onChange={(event) => {
                setValeur(event.target.value);
              }}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="contacts-coordonnee-principale"
                checked={principale}
                onChange={(event) => {
                  setPrincipale(event.target.checked);
                }}
              />
              {fr("Principale")}
            </label>
            <button type="submit" className="filtre" data-testid="contacts-coordonnee-ajouter">
              {fr("Ajouter")}
            </button>
            {message !== "" ? <p data-testid="contacts-coordonnee-message">{fr(message)}</p> : null}
          </form>
      </div>
    </div>
  );
}

function libelleGenre(genre: string): string {
  return GENRES_COORDONNEE.find((entree) => entree.id === genre)?.label ?? genre;
}

function libelleUsage(usage: string): string {
  return USAGES_COORDONNEE.find((entree) => entree.id === usage)?.label ?? usage;
}
