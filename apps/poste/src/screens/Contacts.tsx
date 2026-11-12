import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  IconAlertTriangle,
  IconBuilding,
  IconCopy,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconMail,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import {
  compteursFiltres,
  FILTRES_CONTACTS,
  filtrerContacts,
  grouperAlphabetique,
  initialesListeContact,
  libelleListeContact,
  libelleCapital,
  metaListeContact,
  natureEtiquetteFiche,
  ongletsFiche,
  sirenListeContact,
  formeEnLettres,
  nomCourtContact,
  sousTitreFiche,
  type ContactListe,
  type CoordonneeLue,
  type FiltreContacts,
  type OngletFicheContact,
} from "@/contacts/listeContacts";
import { lireAnnuaireLocal } from "@/contacts/lireAnnuaire";
import { designationActe, accordDe } from "@/contacts/designation";
import { ecrireCoordonnee, type GenreCoordonnee, type UsageCoordonnee } from "@/contacts/ecrireCoordonnee";
import { avecCommune, communesDuCode, estAdresseFrance } from "@/contacts/codesPostaux";
import { groupesLiens, type LienAffiche } from "@/contacts/liensContacts";
import { envoyerLien, envoyerRetrait } from "@/contacts/envoyerLien";
import { EtatVideFiche, HistoriqueFiche } from "@/contacts/OngletsHistorique";
import { ligneIndex, villeListeContact } from "@/contacts/indexAnnuaire";
import type { IndexAnnuaire } from "@/contacts/indexAnnuaireFts";
import { PropositionImport, type PropositionImportHandle } from "@/contacts/PropositionImport";
import {
  etatVideLiens,
  type DossierFiche,
  type FactureFiche,
  type MailFiche,
  type NoteFiche,
} from "@/contacts/historiqueFiche";
import {
  compterDossiersParContact,
  lireDossiersContact,
  lireFacturesContact,
  lireMailsClasses,
  lireNotesContact,
} from "@/contacts/lireHistorique";
import { DoublonsFiche, type DoublonDetecte } from "@/contacts/DoublonsFiche";
import { NouveauContact } from "@/contacts/NouveauContact";
import type { NatureCreation } from "@/contacts/creationContact";
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
import { BarreActions } from "@/coque/BarreActions";
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
import {
  sectionPourChamp,
  titreSectionEdition,
  type SectionEditionFiche,
} from "@/contacts/sectionEditionFiche";
import type { PropositionSiren } from "@/contacts/propositionSiren";
import { Feuille } from "@/coque/Feuille";
import { PanneauLateral } from "@/coque/PanneauLateral";
import { libelleCoordonnee } from "@/contacts/libelleCoordonnee";
import { dateImmatriculation, libelleGreffe, ligneSourceFiche } from "@/contacts/registreFiche";
import { fr } from "@/lib/fr";
import { formatDateActe, formatMontant } from "@/lib/format";

type ContactsProps = {
  /** Jeu figé de la galerie. Sans cela, la liste est lue dans la base locale. */
  lignesFixes?: readonly ContactListe[];
  /** Liens figés de la galerie. Sans cela, ils sont lus dans la base locale. */
  liensFixes?: readonly LienAffiche[];
  horsLigne?: boolean;
  instanceUrl?: string;
  /** Proposition figée, affichée par le bouton sans appeler le registre. */
  propositionFixe?: PropositionSiren | null;
  /** Historique figé de la galerie, par fiche. Les autres fiches n'ont pas d'historique. */
  historiquesFixes?: readonly {
    contactId: string;
    dossiers: readonly DossierFiche[];
    factures: readonly FactureFiche[];
    mails: readonly MailFiche[];
    notes: readonly NoteFiche[];
  }[];
  /** Doublons figés de la galerie, par fiche. Sans cela, l'instance les détecte à l'ouverture de la fiche. */
  doublonsFixes?: Readonly<Record<string, readonly DoublonDetecte[]>>;
  /** Coordonnées figées de la galerie. Sans cela, elles sont lues dans la base locale. */
  coordonneesFixes?: readonly CoordonneeLue[];
  /** Nombre de dossiers par fiche, figé pour la galerie. */
  comptesDossiersFixes?: Readonly<Record<string, number>>;
  /** Année en cours figée pour la galerie (dates des mails) ; sinon l'horloge. */
  anneeCouranteFixe?: number;
  /** Fiche ouverte au premier affichage (galerie) ; sinon la première de la liste. */
  selectionInitiale?: string;
  onNouveauMail?: () => void;
};

export function Contacts({
  lignesFixes,
  liensFixes,
  horsLigne = false,
  instanceUrl,
  propositionFixe = null,
  historiquesFixes,
  doublonsFixes,
  coordonneesFixes,
  comptesDossiersFixes,
  anneeCouranteFixe,
  selectionInitiale,
  onNouveauMail,
}: ContactsProps = {}) {
  const [lignesSync, setLignesSync] = useState<ContactListe[] | null>(null);
  const [coordsSync, setCoordsSync] = useState<CoordonneeLue[]>(() => [...(coordonneesFixes ?? [])]);
  const [liensSync, setLiensSync] = useState<LienAffiche[]>([]);
  const [filtre, setFiltre] = useState<FiltreContacts>("tous");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<string | null>(selectionInitiale ?? null);
  const [ongletChoisi, setOnglet] = useState<OngletFicheContact>("general");
  const [creation, setCreation] = useState<{ nature: NatureCreation; focusSiren: boolean } | null>(null);
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
  const [dossiersParContactSync, setDossiersParContactSync] = useState<Map<string, number>>(
    () => new Map(Object.entries(comptesDossiersFixes ?? {})),
  );
  const indexRef = useRef<IndexAnnuaire | null>(null);
  const importRef = useRef<PropositionImportHandle | null>(null);
  const [idsRecherche, setIdsRecherche] = useState<ReadonlySet<string> | null>(null);
  const [messageAction, setMessageAction] = useState("");

  useEffect(() => {
    if (lignesFixes !== undefined) return;
    let ignore = false;
    const charger = () => {
      void (async () => {
        try {
          const [annuaire, comptesDossiers] = await Promise.all([
            lireAnnuaireLocal(),
            compterDossiersParContact(),
          ]);
          if (ignore) return;
          setCoordsSync(annuaire.coordonnees);
          setLiensSync(annuaire.liens);
          setLignesSync(annuaire.contacts);
          setDossiersParContactSync(comptesDossiers);
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
  const dossiersParContact = useMemo(() => {
    const map = new Map(dossiersParContactSync);
    for (const fixe of historiquesFixes ?? []) map.set(fixe.contactId, fixe.dossiers.length);
    if (
      lignesFixes === undefined &&
      choisi !== null &&
      !(historiquesFixes ?? []).some((fixe) => fixe.contactId === choisi.id)
    ) {
      map.set(choisi.id, dossiersSync.length);
    }
    return map;
  }, [dossiersParContactSync, historiquesFixes, choisi, dossiersSync, lignesFixes]);
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
  const historiqueFixe = (historiquesFixes ?? []).find((fixe) => fixe.contactId === choisi?.id) ?? null;
  const historique =
    historiqueFixe !== null
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

  const contactLie =
    choisi !== null && liens.some((lien) => lien.sourceId === choisi.id || lien.cibleId === choisi.id);
  const emailsChoisi =
    choisi === null
      ? []
      : coordsSync.filter((ligne) => ligne.contactId === choisi.id && ligne.genre === "email");
  const peutEcrire = emailsChoisi.length > 0;
  const sirenChoisi = (choisiVu?.siren ?? choisi?.siren)?.trim() ?? "";
  const peutImporter = choisi !== null && choisi.nature === "morale" && sirenChoisi !== "";
  const compteursOnglets: Partial<Record<OngletFicheContact, number>> =
    choisi === null
      ? {}
      : {
          liens: liens.filter((lien) => lien.sourceId === choisi.id || lien.cibleId === choisi.id).length,
          dossiers: historique.dossiers.length,
          factures: historique.factures.length,
          mails: historique.mails.length,
        };
  const onglets = ongletsFiche(compteursOnglets);
  // Un onglet qui disparaît (plus aucune facture) ramène à Général.
  const onglet = onglets.some((entree) => entree.id === ongletChoisi) ? ongletChoisi : "general";
  const declencherImport = () => {
    if (onglet !== "general") setOnglet("general");
    importRef.current?.interroger();
  };

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col ecran ecran--large" data-testid="ecran-contacts" data-fond="neutre">
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Contacts")}</h1>
          <p className="ecran-tete__sous-titre" data-testid="contacts-sous-titre">
            {fr(`${String(comptes.tous)} contact${comptes.tous > 1 ? "s" : ""}`)}
          </p>
        </div>
        <span
          className="contacts-releve"
          data-testid="contacts-annuaire-commun"
          title={fr(
            "Tous les membres du cabinet voient l'annuaire ; un dossier restreint n'apparaît qu'aux personnes autorisées",
          )}
        >
          <IconUsers size={14} stroke={1.7} aria-hidden />
          {fr("Annuaire commun au cabinet")}
        </span>
      </header>
      <Feuille uneColonne className="min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-[368px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden border-r border-filet">
            <div className="px-4 pt-4">
            <label className="mb-3 block">
              <span className="sr-only">{fr("Rechercher un contact")}</span>
              <input
                type="search"
                className="champ w-full"
                placeholder={fr("Nom, dénomination, SIREN, e-mail, ville")}
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-24" data-testid="contacts-liste">
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
                      {fr(groupe.lettre)}
                    </h2>
                    <ul>
                      {groupe.contacts.map((contact) => {
                        const selectionne = choisi?.id === contact.id;
                        const archive = contact.archivee === true || archives.has(contact.id);
                        const nomListe = libelleListeContact(contact);
                        const meta = metaListeContact(contact, villeListeContact(contact, coordsSync));
                        const nbDossiers = dossiersParContact.get(contact.id) ?? 0;
                        return (
                          <li key={contact.id}>
                            <button
                              type="button"
                              className={`contacts-ligne${selectionne ? " contacts-ligne--sel" : ""}`}
                              data-testid="contacts-ligne"
                              data-contact-id={contact.id}
                              data-selected={selectionne ? "true" : "false"}
                              onClick={() => {
                                setCreation(null);
                                setSelection(contact.id);
                                setOnglet("general");
                              }}
                            >
                              <span
                                className={`contacts-tuile contacts-tuile--${contact.nature === "physique" ? "pp" : "pm"}`}
                                aria-hidden="true"
                              >
                                {contact.nature === "morale" ? (
                                  <IconBuilding size={16} stroke={1.8} />
                                ) : (
                                  fr(initialesListeContact(contact))
                                )}
                              </span>
                              <span className="contacts-ligne__tx">
                                <span className="contacts-ligne__nom">
                                  {fr(nomListe)}
                                  {archive ? fr(" — Archivé") : ""}
                                </span>
                                {meta !== "" ? (
                                  <span className="contacts-ligne__meta">{fr(meta)}</span>
                                ) : null}
                              </span>
                              <span
                                className="contacts-ligne__nb"
                                title={fr(`${String(nbDossiers)} dossier${nbDossiers > 1 ? "s" : ""}`)}
                              >
                                {nbDossiers > 0 ? (
                                  <>
                                    <IconFolder size={13} stroke={1.8} aria-hidden />
                                    {fr(String(nbDossiers))}
                                  </>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden" data-testid="contacts-fiche">
            {creation !== null ? (
              <NouveauContact
                nature={creation.nature}
                focusSiren={creation.focusSiren}
                horsLigne={horsLigne}
                instanceUrl={instanceUrl}
                propositionFixe={propositionFixe}
                contacts={lignes ?? []}
                onNature={(nature) => {
                  setCreation({ nature, focusSiren: nature === "morale" });
                }}
                onCreee={(contact) => {
                  setCreees((etat) => [...etat, contact]);
                  setSelection(contact.id);
                  setOnglet("general");
                  setCreation(null);
                }}
                onDirigeantCree={(contact) => {
                  setCreees((etat) => [...etat, contact]);
                }}
                onOuvrir={(id) => {
                  setSelection(id);
                  setOnglet("general");
                  setCreation(null);
                }}
                onAnnuler={() => {
                  setCreation(null);
                }}
              />
            ) : choisi === null ? (
              <p className="etat-vide px-6 pt-6">{fr("Choisissez un contact pour voir sa fiche.")}</p>
            ) : (
              <>
                <div className="contacts-fi-tete">
                  <div className="contacts-etq">
                    <div className="contacts-etq__nat">
                      {choisi.nature === "morale" ? (
                        <IconBuilding size={13} stroke={1.8} aria-hidden />
                      ) : (
                        <IconUser size={13} stroke={1.8} aria-hidden />
                      )}
                      {fr(natureEtiquetteFiche(choisiVu ?? choisi))}
                    </div>
                    <h2 className="contacts-etq__nom">{fr(libelleListeContact(choisiVu ?? choisi))}</h2>
                    {(() => {
                      const sous = sousTitreFiche(
                        choisiVu ?? choisi,
                        villeListeContact(choisiVu ?? choisi, coordsSync),
                      );
                      return sous !== "" ? <p className="contacts-etq__sous">{fr(sous)}</p> : null;
                    })()}
                  </div>
                  <div className="contacts-actions">
                    <button
                      type="button"
                      className="contacts-act"
                      data-testid="contacts-ecrire"
                      disabled={!peutEcrire}
                      title={
                        peutEcrire
                          ? undefined
                          : fr("Aucun e-mail sur cette fiche — l'écriture n'est pas encore branchée.")
                      }
                      onClick={() => {
                        /* Lot 2 : bouton présent ; messagerie non branchée. */
                      }}
                    >
                      <IconMail size={14} stroke={1.8} aria-hidden />
                      {fr("Écrire")}
                    </button>
                    <button
                      type="button"
                      className="contacts-act"
                      data-testid="contacts-ajouter-dossier"
                      onClick={() => {
                        setMessageAction("À venir");
                      }}
                    >
                      <IconFolderPlus size={14} stroke={1.8} aria-hidden />
                      {fr("Ajouter à un dossier")}
                    </button>
                    {peutImporter ? (
                      <button
                        type="button"
                        className="contacts-act"
                        data-testid="contacts-import-siren"
                        disabled={horsLigne}
                        onClick={declencherImport}
                      >
                        <IconBuilding size={14} stroke={1.8} aria-hidden />
                        {fr("Mettre à jour depuis le registre")}
                      </button>
                    ) : null}
                  </div>
                </div>
                {messageAction !== "" ? (
                  <p className="contacts-action-msg" role="status" data-testid="contacts-action-message">
                    {fr(messageAction)}
                  </p>
                ) : null}
                <div className="contacts-onglets" role="tablist" aria-label={fr("Sections de la fiche")}>
                  {onglets.map((entree) => {
                    const compte = compteursOnglets[entree.id];
                    return (
                      <button
                        key={entree.id}
                        type="button"
                        role="tab"
                        className="contacts-onglet"
                        aria-selected={onglet === entree.id}
                        data-testid={`contacts-onglet-${entree.id}`}
                        onClick={() => {
                          setOnglet(entree.id);
                        }}
                      >
                        {fr(entree.label)}
                        {compte !== undefined && compte > 0 ? <b>{fr(String(compte))}</b> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="contacts-corps" role="tabpanel">
                  <div
                    className={onglet === "general" ? undefined : "hidden"}
                    aria-hidden={onglet !== "general"}
                  >
                    <FicheGenerale
                      contact={choisiVu ?? choisi}
                      coordonnees={coordsSync.filter((ligne) => ligne.contactId === choisi.id)}
                      liens={liens}
                      contacts={lignes ?? []}
                      horsLigne={horsLigne}
                      instanceUrl={instanceUrl}
                      propositionFixe={propositionFixe}
                      doublonsFixes={doublonsFixes?.[choisi.id]}
                      importRef={importRef}
                      contactLie={contactLie}
                      onRetirer={retirerChoisi}
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
                  </div>
                  {onglet === "liens" ? (
                    <LiensFiche
                      contactId={choisi.id}
                      liens={liens}
                      contacts={lignes ?? []}
                      onOuvrir={(id) => {
                        setSelection(id);
                        setOnglet("general");
                      }}
                    />
                  ) : onglet !== "general" ? (
                    <HistoriqueFiche
                      onglet={onglet}
                      dossiers={historique.dossiers}
                      factures={historique.factures}
                      mails={historique.mails}
                      notes={historique.notes}
                      anneeCourante={anneeCouranteFixe}
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </Feuille>
      <BarreActions
        actions={[
          {
            id: "nouveau-contact",
            primaire: true,
            label: "Nouveau contact",
            testId: "contacts-nouveau",
            onClick: () => {
              setCreation({ nature: "physique", focusSiren: false });
            },
          },
          {
            id: "importer-siren",
            label: "Importer par SIREN",
            testId: "contacts-importer-siren",
            onClick: () => {
              setCreation({ nature: "morale", focusSiren: true });
            },
          },
          {
            id: "nouveau-mail",
            label: "Nouveau mail",
            testId: "contacts-nouveau-mail",
            onClick: () => {
              onNouveauMail?.();
            },
          },
        ]}
      />
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

function LiensFiche({
  contactId,
  liens,
  contacts,
  onOuvrir,
}: {
  contactId: string;
  liens: readonly LienAffiche[];
  contacts: readonly ContactListe[];
  onOuvrir: (id: string) => void;
}) {
  const groupes = groupesLiens(liens, contactId, (id) => {
    const fiche = contacts.find((contact) => contact.id === id);
    return fiche === undefined ? null : nomCourtContact(fiche);
  });
  return (
    <div data-testid="contacts-liens">
      <div className="sec-t">{fr("Liens avec d'autres contacts")}</div>
      {groupes.length === 0 ? <EtatVideFiche vide={etatVideLiens()} testId="contacts-liens-vide" /> : null}
      {groupes.map((entree) => (
        <Fragment key={entree.groupe}>
          <div className="sec-t">{fr(entree.groupe)}</div>
          <ul className="contacts-liens">
            {entree.lignes.map((ligne) => (
              <li
                key={ligne.id}
                className={`contacts-lien${ligne.termine ? " contacts-lien--fin" : ""}`}
                data-testid="contacts-lien"
              >
                <div className="contacts-lien__q">
                  <b>{fr(ligne.titre)}</b>
                  {fr(ligne.liaison === "de" ? " de " : ligne.liaison === "titre" ? " " : " : ")}
                  <button
                    type="button"
                    className="contacts-lk"
                    onClick={() => {
                      onOuvrir(ligne.autreId);
                    }}
                  >
                    {fr(ligne.autreNom)}
                  </button>
                  {ligne.source !== null ? <small>{fr(`Source : ${ligne.source}`)}</small> : null}
                </div>
                <div className="contacts-lien__date">{fr(ligne.periode)}</div>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </div>
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

function afficherCapitalLecture(
  centimes: number | null,
  monnaie: string | null,
  libelle: string | null,
): string | null {
  if (centimes !== null) {
    if (monnaie !== null && monnaie !== "" && monnaie !== "EUR") {
      const entier = Math.trunc(centimes / 100);
      const cent = Math.abs(centimes % 100);
      return `${String(entier)},${String(cent).padStart(2, "0")} ${monnaie}`;
    }
    return formatMontant(centimes);
  }
  const brut = libelle?.trim() ?? "";
  return brut === "" ? null : brut;
}

function FaitLecture({
  libelle,
  valeur,
  manque,
  placeholder = "Non renseigné",
  onOuvrir,
}: {
  libelle: string;
  valeur: string | null | undefined;
  manque?: boolean;
  placeholder?: string;
  onOuvrir: () => void;
}) {
  const nette = valeur?.trim() ?? "";
  const vide = nette === "";
  const estManque = manque ?? vide;
  return (
    <div>
      <dt>{fr(libelle)}</dt>
      <dd className={estManque ? "manque" : undefined}>
        <button type="button" className="faits__valeur" onClick={onOuvrir}>
          {fr(vide ? placeholder : nette)}
        </button>
      </dd>
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
  doublonsFixes,
  importRef,
  contactLie,
  onRetirer,
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
  doublonsFixes: readonly DoublonDetecte[] | undefined;
  importRef: RefObject<PropositionImportHandle | null>;
  contactLie: boolean;
  onRetirer: () => void;
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
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [section, setSection] = useState<SectionEditionFiche>(
    contact.nature === "morale" ? "denomination" : "identite",
  );
  const corpsPanneau = useRef<HTMLDivElement>(null);

  const ouvrir = (cible: SectionEditionFiche) => {
    setSection(cible);
    setPanneauOuvert(true);
  };

  useEffect(() => {
    if (!panneauOuvert) return;
    const ancre = corpsPanneau.current?.querySelector(`[data-section="${section}"]`);
    ancre?.scrollIntoView({ block: "nearest" });
  }, [panneauOuvert, section]);

  const capitalLecture = afficherCapitalLecture(
    contact.capitalCentimes,
    contact.monnaie,
    contact.capitalLibelle,
  );
  const libelleProfessionCode =
    PROFESSIONS_FICHE.find((entree) => entree.code === contact.professionCode)?.libelle ?? null;
  const mentionsLibelle = acte.mentions.map((mention) => mention.libelle).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <DoublonsFiche
        key={contact.id}
        contactId={contact.id}
        horsLigne={horsLigne}
        instanceUrl={instanceUrl}
        doublonsFixes={doublonsFixes}
      />
      {acte.mentions.length > 0 ? (
        <div className="alerte" data-testid="contacts-mentions">
          <IconAlertTriangle size={16} stroke={1.8} aria-hidden />
          <div>
            <b>{fr("Mention manquante pour un acte :")}</b>{" "}
            {fr(
              `${mentionsLibelle}. La fusion d'un modèle qui l'utilise s'arrêtera et nommera ce champ.`,
            )}
            <ul className="sr-only">
              {acte.mentions.map((mention) => (
                <li key={mention.champ} data-testid="contacts-mention">
                  {fr(mention.libelle)}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="bouton bouton--petit act"
            onClick={() => {
              const premiere = acte.mentions[0];
              ouvrir(premiere === undefined ? "identite" : sectionPourChamp(premiere.champ));
            }}
          >
            {fr("Compléter")}
          </button>
        </div>
      ) : null}
      <div className="desig" data-testid="contacts-designation">
        <IconFileText size={16} stroke={1.8} aria-hidden />
        <div>
          <div className="lb">{fr("Désignation dans les actes")}</div>
          <p>{acte.texte === "" ? fr("Désignation incomplète.") : fr(acte.texte)}</p>
        </div>
        <button
          type="button"
          className="bouton bouton--petit act"
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
          <IconCopy size={14} stroke={1.8} aria-hidden />
          {fr(copie ? "Copié" : "Copier")}
        </button>
      </div>
      <PropositionImport
        ref={importRef}
        contact={contact}
        horsLigne={horsLigne}
        instanceUrl={instanceUrl}
        propositionFixe={propositionFixe}
        contacts={contacts}
        onCreer={onCreer}
        onRelier={onRelier}
        afficherDeclencheur={false}
      />
      {contact.nature === "morale" ? (
        <>
          <div className="sec-t">
            {fr("Identité")}
            <button type="button" className="bouton bouton--petit act" onClick={() => { ouvrir("denomination"); }}>
              {fr("Modifier")}
            </button>
          </div>
          <dl className="faits">
            <FaitLecture libelle="Dénomination" valeur={contact.nom} onOuvrir={() => { ouvrir("denomination"); }} />
            <FaitLecture
              libelle="Forme"
              valeur={contact.forme ? formeEnLettres(contact.forme) : null}
              onOuvrir={() => { ouvrir("forme"); }}
            />
            <FaitLecture
              libelle="Capital"
              valeur={capitalLecture}
              onOuvrir={() => { ouvrir("capital"); }}
            />
            <FaitLecture
              libelle="SIREN"
              valeur={sirenListeContact(contact.siren) || null}
              onOuvrir={() => { ouvrir("siren"); }}
            />
            <FaitLecture libelle="Greffe du RCS" valeur={libelleGreffe(contact.greffe)} onOuvrir={() => { ouvrir("greffe"); }} />
            <FaitLecture
              libelle="N° TVA intracommunautaire"
              valeur={contact.numeroTva}
              onOuvrir={() => { ouvrir("tva"); }}
            />
            <FaitLecture libelle="Activité" valeur={contact.activite} onOuvrir={() => { ouvrir("activite"); }} />
            {dateImmatriculation(contact.immatriculeLe) !== null ? (
              <div>
                <dt>{fr("Immatriculée le")}</dt>
                <dd>{dateImmatriculation(contact.immatriculeLe)}</dd>
              </div>
            ) : null}
            {contact.professionCode !== null ? (
              <FaitLecture
                libelle="Profession réglementée"
                valeur={libelleProfessionCode}
                onOuvrir={() => { ouvrir("profession"); }}
              />
            ) : null}
          </dl>
          {ligneSourceFiche(contact) !== null ? (
            <p className="contacts-source" data-testid="contacts-source-import">
              {fr(ligneSourceFiche(contact) ?? "")}
            </p>
          ) : null}
        </>
      ) : contact.professionCode !== null ? (
        <>
          <div className="sec-t">
            {fr("Profession")}
            <button type="button" className="bouton bouton--petit act" onClick={() => { ouvrir("profession"); }}>
              {fr("Modifier")}
            </button>
          </div>
          <dl className="faits">
            <FaitLecture
              libelle="Profession"
              valeur={libelleProfessionCode}
              onOuvrir={() => { ouvrir("profession"); }}
            />
            {contact.barreau ? (
              <FaitLecture libelle="Barreau" valeur={contact.barreau} onOuvrir={() => { ouvrir("profession"); }} />
            ) : null}
            {contact.toque ? (
              <FaitLecture libelle="Toque" valeur={contact.toque} onOuvrir={() => { ouvrir("profession"); }} />
            ) : null}
            {contact.specialite ? (
              <FaitLecture
                libelle="Spécialité"
                valeur={contact.specialite}
                onOuvrir={() => { ouvrir("profession"); }}
              />
            ) : null}
            {contact.courAppel ? (
              <FaitLecture
                libelle="Cour d'appel"
                valeur={contact.courAppel}
                onOuvrir={() => { ouvrir("profession"); }}
              />
            ) : null}
            <FaitLecture libelle="Civilité" valeur={contact.civilite} onOuvrir={() => { ouvrir("identite"); }} />
            <FaitLecture
              libelle="Prénom et nom"
              valeur={[contact.prenoms, contact.nom].filter(Boolean).join(" ")}
              onOuvrir={() => { ouvrir("identite"); }}
            />
          </dl>
        </>
      ) : (
        <>
          <div className="sec-t">
            {fr("État civil")}
            <button type="button" className="bouton bouton--petit act" onClick={() => { ouvrir("identite"); }}>
              {fr("Modifier")}
            </button>
          </div>
          <dl className="faits">
            <FaitLecture libelle="Civilité" valeur={contact.civilite} onOuvrir={() => { ouvrir("identite"); }} />
            <FaitLecture libelle="Prénoms" valeur={contact.prenoms} onOuvrir={() => { ouvrir("identite"); }} />
            <FaitLecture libelle="Nom" valeur={contact.nom} onOuvrir={() => { ouvrir("identite"); }} />
            <FaitLecture
              libelle="Nom de naissance"
              valeur={contact.nomNaissance ?? contact.nom}
              onOuvrir={() => { ouvrir("identite"); }}
            />
            <FaitLecture
              libelle={
                accordDe(contact.civilite ?? "", contact.accordSaisi) === "feminin" ? "Née le" : "Né le"
              }
              valeur={contact.dateNaissance ? formatDateActe(contact.dateNaissance) : null}
              onOuvrir={() => { ouvrir("identite"); }}
            />
            <FaitLecture
              libelle="Nationalité"
              valeur={contact.nationalite}
              onOuvrir={() => { ouvrir("identite"); }}
            />
            <FaitLecture
              libelle="Profession"
              valeur={contact.profession}
              placeholder="À compléter"
              manque={!contact.profession?.trim()}
              onOuvrir={() => { ouvrir("identite"); }}
            />
            <FaitLecture
              libelle="Situation familiale"
              valeur={
                contact.situationFamiliale
                  ? libelleSituation(
                      contact.situationFamiliale,
                      accordDe(contact.civilite ?? "", contact.accordSaisi),
                    )
                  : null
              }
              onOuvrir={() => { ouvrir("situation"); }}
            />
          </dl>
        </>
      )}
      <div className="sec-t">
        {fr("Coordonnées")}
        <button type="button" className="bouton bouton--petit act" onClick={() => { ouvrir("coordonnee"); }}>
          <IconPlus size={14} stroke={1.8} aria-hidden />
          {fr("Ajouter")}
        </button>
      </div>
      {coordonnees.length === 0 ? (
        <p className="etat-vide">{fr("Aucune coordonnée.")}</p>
      ) : (
        <div className="coord" data-testid="contacts-coordonnees">
          {coordonnees.map((ligne) => {
            const libelle = libelleCoordonnee(ligne.genre, ligne.usage);
            const detail =
              ligne.pays !== undefined && ligne.pays !== null && ligne.pays.trim() !== ""
                ? `${ligne.valeur}, ${ligne.pays}`
                : ligne.valeur;
            return (
              <div
                key={`${ligne.genre}-${ligne.usage}-${ligne.creeLe}-${ligne.valeur}`}
                data-testid="contacts-coordonnee"
              >
                <span>{fr(libelle)}</span>
                <button type="button" className="coord__valeur" onClick={() => { ouvrir("coordonnee"); }}>
                  {fr(detail)}
                </button>
                {ligne.principale ? <em>{fr("Principale")}</em> : <span />}
              </div>
            );
          })}
        </div>
      )}
      <div className="contacts-actions-secondaires">
        {contactLie ? (
          <button type="button" className="contacts-act" data-testid="contacts-archiver" onClick={onRetirer}>
            {fr("Archiver")}
          </button>
        ) : (
          <button type="button" className="contacts-act" data-testid="contacts-supprimer" onClick={onRetirer}>
            {fr("Supprimer")}
          </button>
        )}
      </div>
      <PanneauLateral
        ouvert={panneauOuvert}
        titre={titreSectionEdition(section)}
        sousTitre="Les modifications sont enregistrées dès la saisie."
        onFermer={() => {
          setPanneauOuvert(false);
        }}
        testId="contacts-panneau-edition"
      >
        <div ref={corpsPanneau} className="flex flex-col gap-4">
          {contact.nature === "physique" ? (
            <div data-section="identite" className="panneau-lateral__section">
              <IdentitePersonne
                contactId={contact.id}
                identite={identiteDepuis(contact)}
                onIdentite={onIdentite}
              />
            </div>
          ) : null}
          {contact.nature === "physique" ? (
            <div data-section="situation" className="panneau-lateral__section">
              <label className="flex flex-col gap-1">
                <span className="etiquette-champ">{fr("Situation familiale")}</span>
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
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="denomination" className="panneau-lateral__section">
              <DenominationSociete contactId={contact.id} nom={contact.nom} onDenomination={onDenomination} />
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="forme" className="panneau-lateral__section">
              <FormeSociete forme={contact.forme} onForme={onForme} />
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="capital" className="panneau-lateral__section">
              <CapitalSociete
                contactId={contact.id}
                centimes={contact.capitalCentimes}
                monnaie={contact.monnaie}
                onCapital={onCapital}
              />
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="siren" className="panneau-lateral__section">
              <SirenSociete
                contactId={contact.id}
                siren={contact.siren}
                tva={contact.numeroTva}
                onSiren={onSiren}
              />
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="greffe" className="panneau-lateral__section">
              <div data-section="activite">
                <GreffeActivite
                  contactId={contact.id}
                  greffe={contact.greffe}
                  activite={contact.activite}
                  onGreffe={onGreffe}
                  onActivite={onActivite}
                />
              </div>
            </div>
          ) : null}
          {contact.nature === "morale" ? (
            <div data-section="tva" className="panneau-lateral__section">
              <TvaSociete
                contactId={contact.id}
                siren={contact.siren}
                numero={contact.numeroTva}
                onTva={onTva}
              />
            </div>
          ) : null}
          <div data-section="profession" className="panneau-lateral__section">
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
          </div>
          <div data-section="coordonnee" className="panneau-lateral__section">
            <form
              className="flex flex-col gap-2"
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
                <span className="etiquette-champ">{fr("Genre")}</span>
                <select
                  className="champ"
                  aria-label={fr("Genre de coordonnée")}
                  data-testid="contacts-coordonnee-genre"
                  value={genre}
                  onChange={(event) => {
                    const choisi = event.target.value;
                    if (
                      choisi === "adresse" ||
                      choisi === "telephone" ||
                      choisi === "email" ||
                      choisi === "site"
                    ) {
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
                <span className="etiquette-champ">{fr("Type")}</span>
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
              <button type="submit" className="bouton bouton--prim" data-testid="contacts-coordonnee-ajouter">
                {fr("Ajouter")}
              </button>
              {message !== "" ? <p data-testid="contacts-coordonnee-message">{fr(message)}</p> : null}
            </form>
          </div>
        </div>
      </PanneauLateral>
    </div>
  );
}
