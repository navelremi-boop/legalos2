import { useEffect, useMemo, useRef, useState } from "react";
import {
  compteursFiltres,
  FILTRES_CONTACTS,
  filtrerContacts,
  grouperAlphabetique,
  libelleNature,
  libelleTypeClient,
  libelleCapital,
  ONGLETS_FICHE,
  type ContactListe,
  type CoordonneeLue,
  type FiltreContacts,
  type OngletFicheContact,
} from "@/contacts/listeContacts";
import { lireAnnuaireLocal } from "@/contacts/lireAnnuaire";
import { designationActe, accordDe } from "@/contacts/designation";
import { ecrireCoordonnee, type GenreCoordonnee, type UsageCoordonnee } from "@/contacts/ecrireCoordonnee";
import { avecCommune, communesDuCode, estAdresseFrance } from "@/contacts/codesPostaux";
import { libelleLien, type LienAffiche } from "@/contacts/liensContacts";
import { envoyerLien, envoyerRetrait } from "@/contacts/envoyerLien";
import { HistoriqueFiche } from "@/contacts/OngletsHistorique";
import { ligneIndex } from "@/contacts/indexAnnuaire";
import type { IndexAnnuaire } from "@/contacts/indexAnnuaireFts";
import { PropositionImport } from "@/contacts/PropositionImport";
import type { DossierFiche, FactureFiche, MailFiche, NoteFiche } from "@/contacts/historiqueFiche";
import { lireDossiersContact, lireFacturesContact, lireMailsClasses, lireNotesContact } from "@/contacts/lireHistorique";
import { DoublonsFiche } from "@/contacts/DoublonsFiche";
import { CreationSociete } from "@/contacts/CreationSociete";
import { centimesDepuisSaisie, estMonnaie, MONNAIES, saisieDepuisCentimes } from "@/contacts/capitalFiche";
import { poserCapital } from "@/contacts/poserCapital";
import { poserDenomination } from "@/contacts/poserDenomination";
import { poserTva } from "@/contacts/poserTva";
import { poserSiren } from "@/contacts/poserSiren";
import { sirenSaisi } from "@/contacts/sirenFiche";
import { tvaSaisie } from "@/contacts/tvaFiche";
import { poserIdentite } from "@/contacts/poserIdentite";
import { normaliserDenomination } from "@/contacts/denominationFiche";
import {
  appliquerIdentite,
  accordDemande,
  identiteDepuis,
  normaliserIdentite,
  optionsCivilite,
  type IdentiteSaisie,
} from "@/contacts/identiteFiche";
import { poserProfession } from "@/contacts/poserProfession";
import {
  champsDeProfession,
  estProfessionFiche,
  PROFESSIONS_FICHE,
  retenirMentions,
  type ProfessionSaisie,
} from "@/contacts/professionsFiche";
import { poserTexteContact } from "@/contacts/poserTexteContact";
import { texteSaisi } from "@/contacts/texteSaisi";
import { poserForme } from "@/contacts/poserForme";
import { poserSituationFamiliale } from "@/contacts/poserSituation";
import { formesFiltrees, libelleForme } from "@/contacts/formesJuridiques";
import { estSituationFamiliale, libelleSituation, SITUATIONS_FAMILIALES } from "@/contacts/situationFamiliale";
import type { PropositionSiren } from "@/contacts/propositionSiren";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";

const VIDE_ONGLET: Record<Exclude<OngletFicheContact, "general">, string> = {
  liens: "Aucun lien.",
  dossiers: "Aucun dossier.",
  factures: "Aucune facture.",
  mails: "Aucun mail.",
  notes: "Aucune note.",
};

type ContactsProps = {
  /** Jeu figé de la galerie. Sans cela, la liste est lue dans la base locale. */
  lignesFixes?: readonly ContactListe[];
  /** Liens figés de la galerie. Sans cela, ils sont lus dans la base locale. */
  liensFixes?: readonly LienAffiche[];
  horsLigne?: boolean;
  instanceUrl?: string;
  /** Proposition figée, affichée par le bouton sans appeler le registre. */
  propositionFixe?: PropositionSiren | null;
  historiqueFixe?: {
    contactId: string;
    dossiers: readonly DossierFiche[];
    factures: readonly FactureFiche[];
    mails: readonly MailFiche[];
    notes: readonly NoteFiche[];
  } | null;
};

export function Contacts({
  lignesFixes,
  liensFixes,
  horsLigne = false,
  instanceUrl,
  propositionFixe = null,
  historiqueFixe = null,
}: ContactsProps = {}) {
  const [lignesSync, setLignesSync] = useState<ContactListe[] | null>(null);
  const [coordsSync, setCoordsSync] = useState<CoordonneeLue[]>([]);
  const [liensSync, setLiensSync] = useState<LienAffiche[]>([]);
  const [filtre, setFiltre] = useState<FiltreContacts>("tous");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<OngletFicheContact>("general");
  const [creation, setCreation] = useState(false);
  const [creees, setCreees] = useState<ContactListe[]>([]);
  const [liensAjoutes, setLiensAjoutes] = useState<LienAffiche[]>([]);
  const [archives, setArchives] = useState<ReadonlySet<string>>(new Set());
  const [retires, setRetires] = useState<ReadonlySet<string>>(new Set());
  const [situations, setSituations] = useState<Record<string, string | null>>({});
  const [formes, setFormes] = useState<Record<string, string | null>>({});
  const [capitaux, setCapitaux] = useState<
    Record<string, { centimes: number | null; monnaie: string | null }>
  >({});
  const [greffes, setGreffes] = useState<Record<string, string | null>>({});
  const [activites, setActivites] = useState<Record<string, string | null>>({});
  const [professions, setProfessions] = useState<Record<string, ProfessionSaisie>>({});
  const [identites, setIdentites] = useState<Record<string, IdentiteSaisie>>({});
  const [denominations, setDenominations] = useState<Record<string, string>>({});
  const [tvas, setTvas] = useState<Record<string, string | null>>({});
  const [sirens, setSirens] = useState<Record<string, string | null>>({});
  const [dossiersSync, setDossiersSync] = useState<DossierFiche[]>([]);
  const [facturesSync, setFacturesSync] = useState<FactureFiche[]>([]);
  const [mailsSync, setMailsSync] = useState<MailFiche[]>([]);
  const [notesSync, setNotesSync] = useState<NoteFiche[]>([]);
  const indexRef = useRef<IndexAnnuaire | null>(null);
  const [idsRecherche, setIdsRecherche] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (lignesFixes !== undefined) return;
    let ignore = false;
    const charger = () => {
      void (async () => {
        try {
          const annuaire = await lireAnnuaireLocal();
          if (ignore) return;
          setCoordsSync(annuaire.coordonnees);
          setLiensSync(annuaire.liens);
          setLignesSync(annuaire.contacts);
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

  const lignes = useMemo(() => {
    const base = lignesFixes ?? lignesSync;
    if (base === null) return null;
    return [...base, ...creees.filter((cree) => !base.some((ligne) => ligne.id === cree.id))].filter(
      (contact) => !retires.has(contact.id),
    );
  }, [lignesFixes, lignesSync, creees, retires]);
  const liens = useMemo(() => {
    const base = liensFixes ?? liensSync;
    return [...base, ...liensAjoutes.filter((ajoute) => !base.some((lien) => lien.id === ajoute.id))];
  }, [liensFixes, liensSync, liensAjoutes]);

  const comptes = useMemo(() => compteursFiltres(lignes ?? []), [lignes]);
  const corpsParId = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of lignes ?? []) map.set(contact.id, ligneIndex(contact, coordsSync).corps);
    return map;
  }, [lignes, coordsSync]);

  useEffect(() => {
    if (lignesFixes !== undefined) return;
    void (async () => {
      try {
        const { IndexAnnuaire: Ouvrir } = await import("@/contacts/indexAnnuaireFts");
        const index = indexRef.current ?? (await Ouvrir.ouvrir());
        indexRef.current = index;
        index.remplacer([...corpsParId].map(([id, corps]) => ({ id, corps })));
        const trouves = index.chercher(recherche);
        setIdsRecherche(trouves === null ? null : new Set(trouves));
      } catch {
        setIdsRecherche(null);
      }
    })();
  }, [lignesFixes, corpsParId, recherche]);

  const visibles = useMemo(() => {
    const sources = (lignes ?? []).map((contact) => {
      const avecIdentite = appliquerIdentite(contact, identites[contact.id]);
      const denomination = denominations[contact.id];
      const nomme = denomination === undefined ? avecIdentite : { ...avecIdentite, nom: denomination };
      const tva = tvas[contact.id];
      const avecTva = tva === undefined ? nomme : { ...nomme, numeroTva: tva };
      const siren = sirens[contact.id];
      return siren === undefined ? avecTva : { ...avecTva, siren };
    });
    const filtres = filtrerContacts(sources, filtre, "");
    if (recherche.trim() === "") return filtres;
    if (idsRecherche !== null) return filtres.filter((contact) => idsRecherche.has(contact.id));
    return filtrerContacts(sources, filtre, recherche, corpsParId);
  }, [lignes, filtre, recherche, idsRecherche, corpsParId, identites, denominations, tvas, sirens]);
  const groupes = useMemo(() => grouperAlphabetique(visibles), [visibles]);
  const choisi = visibles.find((contact) => contact.id === selection) ?? visibles[0] ?? null;
  const capitalPose = choisi === null ? undefined : capitaux[choisi.id];
  const professionPosee = choisi === null ? undefined : professions[choisi.id];
  const choisiVu =
    choisi === null
      ? null
      : {
          ...choisi,
          situationFamiliale:
            situations[choisi.id] === undefined ? choisi.situationFamiliale : situations[choisi.id] ?? null,
          forme: formes[choisi.id] === undefined ? choisi.forme : formes[choisi.id] ?? null,
          capitalCentimes: capitalPose === undefined ? choisi.capitalCentimes : capitalPose.centimes,
          monnaie: capitalPose === undefined ? choisi.monnaie : capitalPose.monnaie,
          capitalLibelle:
            capitalPose === undefined
              ? choisi.capitalLibelle
              : capitalPose.centimes === null
                ? null
                : libelleCapital(capitalPose.centimes, capitalPose.monnaie),
          greffe: greffes[choisi.id] === undefined ? choisi.greffe : greffes[choisi.id] ?? null,
          activite: activites[choisi.id] === undefined ? choisi.activite : activites[choisi.id] ?? null,
          professionCode: professionPosee === undefined ? choisi.professionCode : professionPosee.code,
          professionReglementee:
            professionPosee === undefined ? choisi.professionReglementee : professionPosee.code !== null,
          barreau: professionPosee === undefined ? choisi.barreau : professionPosee.barreau,
          toque: professionPosee === undefined ? choisi.toque : professionPosee.toque,
          specialite: professionPosee === undefined ? choisi.specialite : professionPosee.specialite,
          courAppel: professionPosee === undefined ? choisi.courAppel : professionPosee.courAppel,
        };
  const historique =
    historiqueFixe !== null && choisi?.id === historiqueFixe.contactId
      ? historiqueFixe
      : {
          contactId: choisi?.id ?? "",
          dossiers: dossiersSync,
          factures: facturesSync,
          mails: mailsSync,
          notes: notesSync,
        };

  useEffect(() => {
    if (lignesFixes !== undefined || choisi === null) return;
    const id = choisi.id;
    const emails = coordsSync
      .filter((ligne) => ligne.contactId === id && ligne.genre === "email")
      .map((ligne) => ligne.valeur);
    let ignore = false;
    void lireDossiersContact(id)
      .then((lignes) => {
        if (!ignore) setDossiersSync(lignes);
      })
      .catch(() => {
        if (!ignore) setDossiersSync([]);
      });
    void lireFacturesContact(id)
      .then((lignes) => {
        if (!ignore) setFacturesSync(lignes);
      })
      .catch(() => {
        if (!ignore) setFacturesSync([]);
      });
    void lireMailsClasses(emails)
      .then((lignes) => {
        if (!ignore) setMailsSync(lignes);
      })
      .catch(() => {
        if (!ignore) setMailsSync([]);
      });
    void lireNotesContact(id)
      .then((lignes) => {
        if (!ignore) setNotesSync(lignes);
      })
      .catch(() => {
        if (!ignore) setNotesSync([]);
      });
    return () => {
      ignore = true;
    };
  }, [lignesFixes, choisi, coordsSync]);
  const retirerChoisi = () => {
    if (choisi === null) return;
    const id = choisi.id;
    void (async () => {
      if (instanceUrl !== undefined && propositionFixe === null) {
        const effet = await envoyerRetrait(instanceUrl, id);
        if (effet === "supprime") {
          setRetires((etat) => new Set(etat).add(id));
        } else {
          setArchives((etat) => new Set(etat).add(id));
        }
        return;
      }
      const lie = liens.some((lien) => lien.sourceId === id || lien.cibleId === id);
      if (lie) {
        setArchives((etat) => new Set(etat).add(id));
        return;
      }
      setRetires((etat) => new Set(etat).add(id));
    })();
  };

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col ecran" data-testid="ecran-contacts" data-fond="neutre">
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Contacts")}</h1>
          <p className="ecran-tete__sous-titre">
            {fr(`${String(comptes.tous)} contacts dans l'annuaire du cabinet`)}
          </p>
        </div>
        <button
          type="button"
          className="filtre"
          data-testid="contacts-nouvelle-societe"
          onClick={() => {
            setCreation(true);
          }}
        >
          {fr("Nouvelle société")}
        </button>
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
                              {contact.archivee === true || archives.has(contact.id) ? fr(" — Archivé") : ""}
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
            {creation ? (
              <CreationSociete
                horsLigne={horsLigne}
                instanceUrl={instanceUrl}
                propositionFixe={propositionFixe}
                onFermer={() => {
                  setCreation(false);
                }}
                onCreee={(contact) => {
                  setCreees((etat) => [...etat, contact]);
                  setSelection(contact.id);
                }}
                contacts={lignes ?? []}
              />
            ) : choisi === null ? (
              <p className="etat-vide px-6 pt-6">{fr("Choisissez un contact pour voir sa fiche.")}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 px-6 pt-5">
                  <div>
                    <h2 className="text-[length:var(--font-size-section)] font-extrabold">{fr(choisi.nom)}</h2>
                    <p className="text-[length:var(--font-size-dense)] text-graphite">{fr(libelleNature(choisi.nature))}</p>
                  </div>
                  <button type="button" className="filtre" data-testid="contacts-retirer" onClick={retirerChoisi}>
                    {fr("Retirer")}
                  </button>
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
                      contact={choisiVu ?? choisi}
                      coordonnees={coordsSync.filter((ligne) => ligne.contactId === choisi.id)}
                      liens={liens}
                      contacts={lignes ?? []}
                      horsLigne={horsLigne}
                      instanceUrl={instanceUrl}
                      propositionFixe={propositionFixe}
                      onCreer={(contact) => {
                        setCreees((etat) => [...etat, contact]);
                      }}
                      onRelier={async (lien) => {
                        if (instanceUrl !== undefined && propositionFixe === null) {
                          await envoyerLien(instanceUrl, lien);
                        }
                        setLiensAjoutes((etat) => [...etat, lien]);
                      }}
                      onSituation={(code) => {
                        setSituations((etat) => ({ ...etat, [choisi.id]: code }));
                        if (lignesFixes !== undefined) return;
                        void poserSituationFamiliale(choisi.id, code);
                      }}
                      onForme={(code) => {
                        setFormes((etat) => ({ ...etat, [choisi.id]: code }));
                        if (lignesFixes !== undefined) return;
                        void poserForme(choisi.id, code);
                      }}
                      onCapital={(centimes, monnaie) => {
                        setCapitaux((etat) => ({ ...etat, [choisi.id]: { centimes, monnaie } }));
                        if (lignesFixes !== undefined) return;
                        void poserCapital(choisi.id, centimes, monnaie);
                      }}
                      onGreffe={(valeur) => {
                        setGreffes((etat) => ({ ...etat, [choisi.id]: valeur }));
                        if (lignesFixes !== undefined) return;
                        void poserTexteContact(choisi.id, "greffe_rcs", valeur);
                      }}
                      onActivite={(valeur) => {
                        setActivites((etat) => ({ ...etat, [choisi.id]: valeur }));
                        if (lignesFixes !== undefined) return;
                        void poserTexteContact(choisi.id, "activite", valeur);
                      }}
                      onProfession={(profession) => {
                        const retenue = retenirMentions(profession);
                        setProfessions((etat) => ({ ...etat, [choisi.id]: retenue }));
                        if (lignesFixes !== undefined) return;
                        void poserProfession(choisi.id, retenue);
                      }}
                      onIdentite={(identite) => {
                        setIdentites((etat) => ({ ...etat, [choisi.id]: identite }));
                        if (lignesFixes !== undefined) return;
                        void poserIdentite(choisi.id, identite);
                      }}
                      onDenomination={(nom) => {
                        setDenominations((etat) => ({ ...etat, [choisi.id]: nom }));
                        if (lignesFixes !== undefined) return;
                        void poserDenomination(choisi.id, nom);
                      }}
                      onTva={(numero) => {
                        setTvas((etat) => ({ ...etat, [choisi.id]: numero }));
                        if (lignesFixes !== undefined) return;
                        void poserTva(choisi.id, numero);
                      }}
                      onSiren={(siren) => {
                        setSirens((etat) => ({ ...etat, [choisi.id]: siren }));
                        if (lignesFixes !== undefined) return;
                        void poserSiren(choisi.id, siren);
                      }}
                    />
                  ) : onglet === "liens" ? (
                    <LiensFiche contactId={choisi.id} liens={liens} />
                  ) : (
                    <HistoriqueFiche
                      onglet={onglet}
                      dossiers={historique.dossiers}
                      factures={historique.factures}
                      mails={historique.mails}
                      notes={historique.notes}
                    />
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

function LiensFiche({ contactId, liens }: { contactId: string; liens: readonly LienAffiche[] }) {
  const vus = liens.filter((lien) => lien.sourceId === contactId || lien.cibleId === contactId);
  if (vus.length === 0) {
    return <p className="etat-vide">{fr(VIDE_ONGLET.liens)}</p>;
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="contacts-liens">
      {vus.map((lien) => {
        const libelle = libelleLien(lien, contactId);
        return (
          <li key={lien.id} data-testid="contacts-lien">
            <p>{fr(libelle.texte)}</p>
            {libelle.periode !== null ? (
              <p className="text-[length:var(--font-size-dense)] text-graphite">{fr(libelle.periode)}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CapitalSociete({
  contactId,
  centimes,
  monnaie,
  onCapital,
}: {
  contactId: string;
  centimes: number | null;
  monnaie: string | null;
  onCapital: (centimes: number | null, monnaie: string | null) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [montant, setMontant] = useState(saisieDepuisCentimes(centimes));
  const [message, setMessage] = useState("");
  if (pour !== contactId) {
    setPour(contactId);
    setMontant(saisieDepuisCentimes(centimes));
    setMessage("");
  }
  const code = monnaie !== null && monnaie !== "" ? monnaie : "EUR";
  const enregistrer = (prochainMontant: string, prochaineMonnaie: string) => {
    try {
      const suivant = centimesDepuisSaisie(prochainMontant);
      setMessage("");
      onCapital(suivant, prochaineMonnaie);
    } catch {
      setMessage("Capital invalide.");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span>{fr("Capital")}</span>
        <input
          className="champ"
          inputMode="decimal"
          aria-label={fr("Montant du capital")}
          data-testid="contacts-capital"
          value={montant}
          onChange={(event) => {
            setMontant(event.target.value);
          }}
          onBlur={() => {
            enregistrer(montant, code);
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Monnaie")}</span>
        <select
          className="champ"
          data-testid="contacts-monnaie"
          value={code}
          onChange={(event) => {
            const choisi = event.target.value;
            if (!estMonnaie(choisi) && choisi !== code) return;
            enregistrer(montant, choisi);
          }}
        >
          {code !== "EUR" && !estMonnaie(code) ? <option value={code}>{fr(code)}</option> : null}
          {MONNAIES.map((entree) => (
            <option key={entree} value={entree}>
              {fr(entree)}
            </option>
          ))}
        </select>
      </label>
      {message !== "" ? <p data-testid="contacts-capital-message">{fr(message)}</p> : null}
    </div>
  );
}

function DenominationSociete({
  contactId,
  nom,
  onDenomination,
}: {
  contactId: string;
  nom: string;
  onDenomination: (nom: string) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [brouillon, setBrouillon] = useState(nom);
  if (pour !== contactId) {
    setPour(contactId);
    setBrouillon(nom);
  }
  return (
    <label className="flex flex-col gap-1" data-testid="contacts-denomination">
      <span>{fr("Dénomination")}</span>
      <input
        className="champ"
        data-testid="contacts-denomination-nom"
        value={brouillon}
        onChange={(event) => {
          const saisie = event.target.value;
          setBrouillon(saisie);
          const nette = normaliserDenomination(saisie);
          if (nette !== null) onDenomination(nette);
        }}
      />
      {brouillon.trim() === "" ? (
        <p data-testid="contacts-denomination-message">{fr("La dénomination est requise.")}</p>
      ) : null}
    </label>
  );
}

function FormeSociete({
  forme,
  onForme,
}: {
  forme: string | null;
  onForme: (code: string | null) => void;
}) {
  const [filtre, setFiltre] = useState("");
  const brut = forme?.trim() ?? "";
  const estCode = brut !== "" && libelleForme(brut) !== brut;
  const options = formesFiltrees(filtre, estCode ? brut : null);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span>{fr("Forme")}</span>
        <input
          className="champ"
          aria-label={fr("Filtrer les catégories juridiques")}
          data-testid="contacts-forme-filtre"
          placeholder={fr("Code ou libellé")}
          value={filtre}
          onChange={(event) => {
            setFiltre(event.target.value);
          }}
        />
      </label>
      <select
        className="champ"
        data-testid="contacts-forme"
        value={brut}
        onChange={(event) => {
          const code = event.target.value;
          onForme(code === "" ? null : code);
        }}
      >
        <option value="">{fr("Non renseignée")}</option>
        {!estCode && brut !== "" ? <option value={brut}>{fr(brut)}</option> : null}
        {options.map((entree) => (
          <option key={entree.code} value={entree.code}>
            {fr(`${entree.code} — ${entree.libelle}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function SirenSociete({
  contactId,
  siren,
  tva,
  onSiren,
}: {
  contactId: string;
  siren: string | null;
  tva: string | null;
  onSiren: (siren: string | null) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [brouillon, setBrouillon] = useState(siren ?? "");
  const [message, setMessage] = useState("");
  if (pour !== contactId) {
    setPour(contactId);
    setBrouillon(siren ?? "");
    setMessage("");
  }
  return (
    <label className="flex flex-col gap-1" data-testid="contacts-siren-bloc">
      <span>{fr("SIREN")}</span>
      <input
        className="champ"
        data-testid="contacts-siren"
        value={brouillon}
        onChange={(event) => {
          const saisie = event.target.value;
          setBrouillon(saisie);
          const resultat = sirenSaisi(tva, saisie);
          setMessage(resultat.message ?? "");
          if (resultat.message === null) onSiren(resultat.valeur);
        }}
      />
      {message !== "" ? <p data-testid="contacts-siren-message">{fr(message)}</p> : null}
    </label>
  );
}

function GreffeActivite({
  contactId,
  greffe,
  activite,
  onGreffe,
  onActivite,
}: {
  contactId: string;
  greffe: string | null;
  activite: string | null;
  onGreffe: (valeur: string | null) => void;
  onActivite: (valeur: string | null) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [greffeSaisi, setGreffeSaisi] = useState(greffe ?? "");
  const [activiteSaisie, setActiviteSaisie] = useState(activite ?? "");
  if (pour !== contactId) {
    setPour(contactId);
    setGreffeSaisi(greffe ?? "");
    setActiviteSaisie(activite ?? "");
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span>{fr("Greffe du RCS")}</span>
        <input
          className="champ"
          data-testid="contacts-greffe"
          value={greffeSaisi}
          onChange={(event) => {
            const valeur = event.target.value;
            setGreffeSaisi(valeur);
            onGreffe(texteSaisi(valeur));
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Activité")}</span>
        <input
          className="champ"
          data-testid="contacts-activite"
          value={activiteSaisie}
          onChange={(event) => {
            const valeur = event.target.value;
            setActiviteSaisie(valeur);
            onActivite(texteSaisi(valeur));
          }}
        />
      </label>
    </div>
  );
}

function TvaSociete({
  contactId,
  siren,
  numero,
  onTva,
}: {
  contactId: string;
  siren: string | null;
  numero: string | null;
  onTva: (numero: string | null) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [brouillon, setBrouillon] = useState(numero ?? "");
  const [message, setMessage] = useState("");
  if (pour !== contactId) {
    setPour(contactId);
    setBrouillon(numero ?? "");
    setMessage("");
  }
  return (
    <label className="flex flex-col gap-1" data-testid="contacts-tva-bloc">
      <span>{fr("N° TVA intracommunautaire")}</span>
      <input
        className="champ"
        data-testid="contacts-tva"
        value={brouillon}
        onChange={(event) => {
          const saisie = event.target.value;
          setBrouillon(saisie);
          const resultat = tvaSaisie(siren, saisie);
          setMessage(resultat.message ?? "");
          if (resultat.message === null) onTva(resultat.valeur);
        }}
      />
      {message !== "" ? <p data-testid="contacts-tva-message">{fr(message)}</p> : null}
    </label>
  );
}

function ProfessionContact({
  profession,
  onProfession,
}: {
  profession: ProfessionSaisie;
  onProfession: (profession: ProfessionSaisie) => void;
}) {
  const champs = champsDeProfession(profession.code);
  const publier = (suite: ProfessionSaisie) => {
    onProfession(retenirMentions(suite));
  };
  return (
    <div className="flex flex-col gap-1" data-testid="contacts-profession">
      <label className="flex flex-col gap-1">
        <span>{fr("Profession réglementée")}</span>
        <select
          className="champ"
          data-testid="contacts-profession-code"
          value={profession.code ?? ""}
          onChange={(event) => {
            const code = event.target.value;
            if (code !== "" && !estProfessionFiche(code)) return;
            publier({ ...profession, code: code === "" ? null : code });
          }}
        >
          <option value="">{fr("Aucune")}</option>
          {PROFESSIONS_FICHE.map((entree) => (
            <option key={entree.code} value={entree.code}>
              {fr(entree.libelle)}
            </option>
          ))}
        </select>
      </label>
      {champs.includes("barreau") ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Barreau")}</span>
          <input
            className="champ"
            data-testid="contacts-barreau"
            value={profession.barreau ?? ""}
            onChange={(event) => {
              publier({ ...profession, barreau: texteSaisi(event.target.value) });
            }}
          />
        </label>
      ) : null}
      {champs.includes("toque") ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Toque")}</span>
          <input
            className="champ"
            data-testid="contacts-toque"
            value={profession.toque ?? ""}
            onChange={(event) => {
              publier({ ...profession, toque: texteSaisi(event.target.value) });
            }}
          />
        </label>
      ) : null}
      {champs.includes("specialite") ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Spécialité")}</span>
          <input
            className="champ"
            data-testid="contacts-specialite"
            value={profession.specialite ?? ""}
            onChange={(event) => {
              publier({ ...profession, specialite: texteSaisi(event.target.value) });
            }}
          />
        </label>
      ) : null}
      {champs.includes("cour_appel") ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Cour d'appel")}</span>
          <input
            className="champ"
            data-testid="contacts-cour-appel"
            value={profession.courAppel ?? ""}
            onChange={(event) => {
              publier({ ...profession, courAppel: texteSaisi(event.target.value) });
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function IdentitePersonne({
  contactId,
  identite,
  onIdentite,
}: {
  contactId: string;
  identite: IdentiteSaisie;
  onIdentite: (identite: IdentiteSaisie) => void;
}) {
  const [pour, setPour] = useState(contactId);
  const [brouillon, setBrouillon] = useState(identite);
  if (pour !== contactId) {
    setPour(contactId);
    setBrouillon(identite);
  }
  const publier = (suite: IdentiteSaisie) => {
    setBrouillon(suite);
    const nette = normaliserIdentite(suite);
    if (nette !== null) onIdentite(nette);
  };
  const demandeAccord = accordDemande(brouillon.civilite);
  return (
    <div className="flex flex-col gap-1" data-testid="contacts-identite">
      <label className="flex flex-col gap-1">
        <span>{fr("Civilité")}</span>
        <select
          className="champ"
          data-testid="contacts-civilite"
          value={brouillon.civilite ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, civilite: event.target.value === "" ? null : event.target.value });
          }}
        >
          <option value="">{fr("Non renseignée")}</option>
          {optionsCivilite(brouillon.civilite).map((libelle) => (
            <option key={libelle} value={libelle}>
              {fr(libelle)}
            </option>
          ))}
        </select>
      </label>
      {demandeAccord ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Accord grammatical")}</span>
          <select
            className="champ"
            data-testid="contacts-accord"
            value={brouillon.accord ?? ""}
            onChange={(event) => {
              const accord = event.target.value;
              publier({
                ...brouillon,
                accord: accord === "masculin" || accord === "feminin" ? accord : null,
              });
            }}
          >
            <option value="">{fr("À préciser")}</option>
            <option value="feminin">{fr("Féminin")}</option>
            <option value="masculin">{fr("Masculin")}</option>
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span>{fr("Prénoms")}</span>
        <input
          className="champ"
          data-testid="contacts-prenoms"
          value={brouillon.prenoms ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, prenoms: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Nom")}</span>
        <input
          className="champ"
          data-testid="contacts-nom"
          value={brouillon.nom}
          onChange={(event) => {
            publier({ ...brouillon, nom: event.target.value });
          }}
        />
      </label>
      {brouillon.nom.trim() === "" ? <p data-testid="contacts-identite-message">{fr("Le nom est requis.")}</p> : null}
      <label className="flex flex-col gap-1">
        <span>{fr("Nom de naissance")}</span>
        <input
          className="champ"
          data-testid="contacts-nom-naissance"
          value={brouillon.nomNaissance ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, nomNaissance: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Date de naissance")}</span>
        <input
          className="champ"
          type="date"
          data-testid="contacts-date-naissance"
          value={brouillon.dateNaissance ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, dateNaissance: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Lieu de naissance")}</span>
        <input
          className="champ"
          data-testid="contacts-lieu-naissance"
          value={brouillon.lieuNaissance ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, lieuNaissance: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Nationalité")}</span>
        <input
          className="champ"
          data-testid="contacts-nationalite"
          value={brouillon.nationalite ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, nationalite: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>{fr("Profession")}</span>
        <input
          className="champ"
          data-testid="contacts-profession-libre"
          value={brouillon.profession ?? ""}
          onChange={(event) => {
            publier({ ...brouillon, profession: event.target.value });
          }}
        />
      </label>
    </div>
  );
}

function FicheGenerale({
  contact,
  coordonnees,
  liens,
  contacts,
  horsLigne,
  instanceUrl,
  propositionFixe,
  onCreer,
  onRelier,
  onSituation,
  onForme,
  onCapital,
  onGreffe,
  onActivite,
  onProfession,
  onIdentite,
  onDenomination,
  onTva,
  onSiren,
}: {
  contact: ContactListe;
  coordonnees: readonly CoordonneeLue[];
  liens: readonly LienAffiche[];
  contacts: readonly ContactListe[];
  horsLigne: boolean;
  instanceUrl?: string;
  propositionFixe: PropositionSiren | null;
  onCreer: (contact: ContactListe) => void;
  onRelier: (lien: LienAffiche) => Promise<void> | void;
  onSituation: (code: string | null) => void;
  onForme: (code: string | null) => void;
  onCapital: (centimes: number | null, monnaie: string | null) => void;
  onGreffe: (valeur: string | null) => void;
  onActivite: (valeur: string | null) => void;
  onProfession: (profession: ProfessionSaisie) => void;
  onIdentite: (identite: IdentiteSaisie) => void;
  onDenomination: (nom: string) => void;
  onTva: (numero: string | null) => void;
  onSiren: (siren: string | null) => void;
}) {
  const acte = designationActe(contact, { liens, contacts });
  const [copie, setCopie] = useState(false);
  const [genre, setGenre] = useState<GenreCoordonnee>("adresse");
  const [usage, setUsage] = useState<UsageCoordonnee>(contact.nature === "morale" ? "siege" : "domicile");
  const [valeur, setValeur] = useState("");
  const [pays, setPays] = useState("");
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
      <PropositionImport
        contact={contact}
        horsLigne={horsLigne}
        instanceUrl={instanceUrl}
        propositionFixe={propositionFixe}
        contacts={contacts}
        onCreer={onCreer}
        onRelier={onRelier}
      />
      <DoublonsFiche contactId={contact.id} horsLigne={horsLigne} instanceUrl={instanceUrl} />
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
      {contact.nature === "physique" ? (
        <IdentitePersonne contactId={contact.id} identite={identiteDepuis(contact)} onIdentite={onIdentite} />
      ) : null}
      {contact.nature === "physique" ? (
        <label className="flex flex-col gap-1">
          <span>{fr("Situation familiale")}</span>
          <select
            className="champ"
            data-testid="contacts-situation"
            value={contact.situationFamiliale ?? ""}
            onChange={(event) => {
              const code = event.target.value;
              if (code !== "" && !estSituationFamiliale(code)) return;
              onSituation(code === "" ? null : code);
            }}
          >
            <option value="">{fr("Non renseignée")}</option>
            {SITUATIONS_FAMILIALES.map((code) => (
              <option key={code} value={code}>
                {fr(libelleSituation(code, accordDe(contact.civilite ?? "", contact.accordSaisi)))}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {contact.nature === "morale" ? (
        <DenominationSociete contactId={contact.id} nom={contact.nom} onDenomination={onDenomination} />
      ) : null}
      {contact.nature === "morale" ? (
        <FormeSociete forme={contact.forme} onForme={onForme} />
      ) : null}
      {contact.nature === "morale" ? (
        <CapitalSociete
          contactId={contact.id}
          centimes={contact.capitalCentimes}
          monnaie={contact.monnaie}
          onCapital={onCapital}
        />
      ) : null}
      {contact.nature === "morale" ? (
        <SirenSociete contactId={contact.id} siren={contact.siren} tva={contact.numeroTva} onSiren={onSiren} />
      ) : null}
      {contact.nature === "morale" ? (
        <GreffeActivite
          contactId={contact.id}
          greffe={contact.greffe}
          activite={contact.activite}
          onGreffe={onGreffe}
          onActivite={onActivite}
        />
      ) : null}
      {contact.nature === "morale" ? (
        <TvaSociete contactId={contact.id} siren={contact.siren} numero={contact.numeroTva} onTva={onTva} />
      ) : null}
      <ProfessionContact
        profession={{
          code: contact.professionCode,
          barreau: contact.barreau,
          toque: contact.toque,
          specialite: contact.specialite,
          courAppel: contact.courAppel,
        }}
        onProfession={onProfession}
      />
      <div>
        <p className="font-bold">{fr("Coordonnées")}</p>
        {coordonnees.length === 0 ? (
          <p className="etat-vide">{fr("Aucune coordonnée.")}</p>
        ) : (
          <ul data-testid="contacts-coordonnees">
            {coordonnees.map((ligne) => (
              <li key={`${ligne.genre}-${ligne.usage}-${ligne.creeLe}-${ligne.valeur}`} data-testid="contacts-coordonnee">
                {fr(`${libelleGenre(ligne.genre)}, ${libelleUsage(ligne.usage)} : ${ligne.valeur}`)}
                {ligne.pays !== undefined && ligne.pays !== null && ligne.pays.trim() !== ""
                  ? fr(`, ${ligne.pays}`)
                  : ""}
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
                pays: genre === "adresse" && !estAdresseFrance(pays) ? pays : null,
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
            {genre === "adresse" ? (
              <input
                className="champ"
                aria-label={fr("Pays, si l'adresse est à l'étranger")}
                data-testid="contacts-coordonnee-pays"
                placeholder={fr("Pays, si l'adresse est à l'étranger")}
                value={pays}
                onChange={(event) => {
                  setPays(event.target.value);
                }}
              />
            ) : null}
            {genre === "adresse" && estAdresseFrance(pays) ? (
              <ul data-testid="contacts-communes">
                {communesDuCode(valeur).map((commune) => (
                  <li key={commune}>
                    <button
                      type="button"
                      className="filtre"
                      data-testid="contacts-commune"
                      onClick={() => {
                        setValeur(avecCommune(valeur, commune));
                      }}
                    >
                      {fr(commune)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
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
