import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarreActions, type ActionBarre } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import {
  annulerEnvoi,
  classerMessage,
  lireCorpsMessage,
  lireFileEnvoi,
  relancerEnvoi,
} from "@/messagerie/apiMessagerie";
import {
  boiteDuMessage,
  compteNominatifDuMessage,
  compterNonLusReception,
  construireRail,
  identifiantUtilisateur,
  mailsDuDossier,
  vueParDefaut,
  type BoiteRail,
} from "@/messagerie/boitesMail";
import {
  compterAClasser,
  estAClasser,
  sousTitreEcran,
  type DossierClassement,
} from "@/messagerie/classement";
import { composerDepartServeur, type DepartServeur } from "@/messagerie/apiBrouillons";
import { appliquerDepartServeur, champsEcrits, etatDeDepart, etatDepuisLigne, type ChampsEcrits, type EtatRedaction } from "@/messagerie/etatRedaction";
import { brouillonsVersMails } from "@/messagerie/listeBrouillons";
import { lirePiecesBrouillon, type PieceBrouillon } from "@/messagerie/piecesRedaction";
import type { GenreRedaction, MessageCite } from "@/messagerie/citation";
import { VoletRedaction } from "@/messagerie/VoletRedaction";
import { lireDonneesMails, lireTexteStocke, type DonneesMails } from "@/messagerie/donneesMails";
import { invitationDuMessage, reponseEnvoyee } from "@/messagerie/invitations";
import { dossierImap } from "@/messagerie/dossiersImap";
import { suiteDuMail } from "@/messagerie/journalMails";
import {
  LectureMail,
  type DemandeComposition,
  type GenreComposition,
  type SuggestionTempsMail,
} from "@/messagerie/LectureMail";
import { PanneauListe } from "@/messagerie/PanneauListe";
import { filtrerMails, groupesParJour, listePieces, trierParDate, type FiltreListe } from "@/messagerie/listeMails";
import { RailMails, type VueMails } from "@/messagerie/RailMails";
import { analyserCorrespondant } from "@/messagerie/expediteurs";
import { libelleReleve } from "@/messagerie/releve";
import { rechercherMailsHorsLigne, type ResultatRechercheMail } from "@/messagerie/rechercheMails";
import {
  ErreurReponseInvitation,
  reponseInvitation,
  type ReponseInvitation,
} from "@/messagerie/reponseInvitation";
import { saisirTempsDuMail } from "@/messagerie/saisieTempsMail";
import { propositionTemps, proposer, type ActeMail } from "@/messagerie/tempsMail";
import type { DemonstrationMails, LigneEnvoi, MailLocal } from "@/messagerie/typesMails";
import { useJournalMails } from "@/messagerie/useJournalMails";
import { getPowerSyncDatabase } from "@/sync/database";

export type { DemonstrationMails, MailLocal } from "@/messagerie/typesMails";
export type { DemandeComposition, GenreComposition } from "@/messagerie/LectureMail";

type EcranMailsProps = {
  instanceUrl: string;
  /** Prévenu quand une rédaction s'ouvre (nouveau mail, réponse, réponse à tous, transfert) ; l'écran ouvre la rédaction lui-même. */
  onComposer?: (demande: DemandeComposition) => void;
  onSaisirTemps?: () => void;
  /** Ouvre le dossier où le mail est classé. Sans lui, le bouton « Ouvrir le dossier » n'est pas proposé. */
  onOuvrirDossier?: (id: string, nom: string, chemise: string, reference?: string | null) => void;
  /**
   * En-tête Message-ID d'un mail à ouvrir (lien « Ouvrir le mail » de l'Agenda) : l'écran choisit la boîte et le dossier
   * de ce mail, le sélectionne, puis prévient par `onMessageOuvert`.
   */
  ouvrirMessageId?: string | null;
  onMessageOuvert?: () => void;
  /** Galerie seulement : pas d'appel PowerSync. */
  demonstration?: DemonstrationMails;
};

const DONNEES_VIDES: DonneesMails = { comptes: [], mails: [], dossiers: [], invitations: [], brouillons: [] };

/** Rédaction ouverte à la place du volet de lecture. */
type Composition = {
  cle: string;
  etat: EtatRedaction;
  /** Colonnes déjà en base (brouillon repris) ; `null` : rien d'enregistré. */
  precedent: ChampsEcrits | null;
  modifieLe: string | null;
  piecesDuMessage: string[];
  piecesInitiales: PieceBrouillon[];
  /** Vrai pour un message qui s'ouvre, faux pour un brouillon repris : la signature n'entre qu'à l'ouverture. */
  signatureActive: boolean;
  compteConnu: string | null;
};

const GENRES_API: Record<GenreComposition, GenreRedaction> = {
  nouveau: "nouveau",
  repondre: "reponse",
  "repondre-a-tous": "reponse_a_tous",
  transferer: "transfert",
};

/**
 * Clé d'une réponse envoyée depuis cet écran, avant que la base locale la porte : l'identifiant ET la SEQUENCE,
 * car une version plus récente de l'invitation attend une nouvelle réponse.
 */
function cleReponse(invitationId: string, sequence: number | null | undefined): string {
  return `${invitationId}#${String(sequence ?? 0)}`;
}

function memeDonnees(a: DonneesMails, b: DonneesMails): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function titreDeLaVue(vue: VueMails, rail: readonly BoiteRail[]): string {
  if (vue.genre === "a-classer") return "À classer";
  const dossier = rail.find((boite) => boite.id === vue.boite)?.dossiers.find((entree) => entree.cle === vue.dossier);
  return dossier?.libelle ?? "Boîte de réception";
}

/**
 * Trois volets (§ 7.6, maquette prototype-mails) : boîtes et dossiers avec la file d'envoi ; liste groupée
 * par jour ; lecture. Données de la base locale ; l'API ne sert qu'au corps absent, au classement et à la file.
 */
export function EcranMails({
  instanceUrl,
  onComposer,
  onSaisirTemps,
  onOuvrirDossier,
  ouvrirMessageId = null,
  onMessageOuvert,
  demonstration,
}: EcranMailsProps) {
  const [donneesSync, setDonneesSync] = useState<DonneesMails>(DONNEES_VIDES);
  const [fileSync, setFileSync] = useState<LigneEnvoi[]>([]);
  const [maintenantSync, setMaintenantSync] = useState(() => new Date());
  const [vueChoisie, setVueChoisie] = useState<VueMails | null>(null);
  const [filtre, setFiltre] = useState<FiltreListe>("tous");
  const [terme, setTerme] = useState("");
  const [hits, setHits] = useState<ResultatRechercheMail[]>([]);
  const [selection, setSelection] = useState<string | null>(demonstration?.selectionInitiale ?? null);
  const [corpsLus, setCorpsLus] = useState<Record<string, string>>({});
  const [classesLocal, setClassesLocal] = useState<Record<string, string>>({});
  const [erreurClassement, setErreurClassement] = useState<{ id: string; message: string } | null>(null);
  const [erreurFile, setErreurFile] = useState<string | null>(null);
  const [reponsesInvitation, setReponsesInvitation] = useState<Record<string, ReponseInvitation>>({});
  const [erreurInvitation, setErreurInvitation] = useState<{ id: string; message: string } | null>(null);
  const [reponseEnCours, setReponseEnCours] = useState(false);
  const [composition, setComposition] = useState<Composition | null>(null);
  const corpsDemandes = useRef(new Set<string>());
  const { journal, noterActeMail, noterReglement } = useJournalMails();
  const [tempsSaisis, setTempsSaisis] = useState<Record<string, number>>({});
  const [tempsEnCours, setTempsEnCours] = useState(false);
  const [erreurTemps, setErreurTemps] = useState<{ id: string; message: string } | null>(null);

  const enDemo = demonstration !== undefined;
  const donnees: DonneesMails = demonstration
    ? {
        comptes: demonstration.comptes,
        mails: demonstration.mails,
        dossiers: demonstration.dossiers,
        invitations: demonstration.invitations ?? [],
        brouillons: demonstration.brouillons ?? [],
      }
    : donneesSync;
  const file = demonstration ? (demonstration.file ?? []) : fileSync;
  const maintenantDemo = demonstration?.maintenant;
  const maintenant = useMemo(
    () => (maintenantDemo === undefined ? maintenantSync : new Date(maintenantDemo)),
    [maintenantDemo, maintenantSync],
  );

  // Lecture périodique de la base locale et de la file d'envoi.
  useEffect(() => {
    if (enDemo) return;
    let stop = false;
    const tick = () => {
      void lireFileEnvoi(instanceUrl).then((lignes) => {
        if (!stop) setFileSync(lignes);
      });
      void getPowerSyncDatabase()
        .then((database) => lireDonneesMails(database))
        .then((lues) => {
          if (stop) return;
          setDonneesSync((actuelles) => (memeDonnees(actuelles, lues) ? actuelles : lues));
          setMaintenantSync(new Date());
        })
        .catch(() => {
          if (!stop) setDonneesSync(DONNEES_VIDES);
        });
    };
    tick();
    const timer = window.setInterval(tick, 1_500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [instanceUrl, enDemo]);

  // Recherche hors ligne (index FTS5 local).
  useEffect(() => {
    if (enDemo) return;
    let stop = false;
    void rechercherMailsHorsLigne(terme)
      .then((rows) => {
        if (!stop) setHits(rows);
      })
      .catch(() => {
        if (!stop) setHits([]);
      });
    return () => {
      stop = true;
    };
  }, [terme, enDemo]);

  const monId = identifiantUtilisateur(donnees.comptes);

  // Ouverture demandée depuis l'Agenda : le mail se trouve par son Message-ID dans la base locale. L'état local
  // s'ajuste pendant le rendu (une seule fois par demande) ; l'écran parent est prévenu ensuite.
  const [ouvertPour, setOuvertPour] = useState<string | null>(null);
  const cibleOuverture =
    ouvrirMessageId === null || ouvrirMessageId === "" || enDemo
      ? undefined
      : donnees.mails.find((mail) => mail.message_id === ouvrirMessageId);
  if (cibleOuverture !== undefined && ouvrirMessageId !== ouvertPour) {
    const boite = boiteDuMessage(cibleOuverture, monId);
    setOuvertPour(ouvrirMessageId);
    if (boite !== null) {
      setVueChoisie({ genre: "dossier", boite, dossier: dossierImap(cibleOuverture.dossier_imap).cle });
    }
    setSelection(cibleOuverture.id);
  }
  useEffect(() => {
    if (ouvrirMessageId !== null && ouvrirMessageId === ouvertPour) onMessageOuvert?.();
  }, [ouvrirMessageId, ouvertPour, onMessageOuvert]);

  // Les brouillons de la base locale sont des lignes du dossier Brouillons de l'utilisateur.
  const mailsTous = useMemo(
    () => [...donnees.mails, ...brouillonsVersMails(donnees.brouillons, monId)],
    [donnees.mails, donnees.brouillons, monId],
  );
  const classesDeja = useMemo(() => new Set(Object.keys(classesLocal)), [classesLocal]);
  const dossiersParId = useMemo(() => {
    const table = new Map<string, DossierClassement>();
    for (const dossier of donnees.dossiers) table.set(dossier.id, dossier);
    return table;
  }, [donnees.dossiers]);
  const rail = useMemo(
    () => construireRail(donnees.comptes, mailsTous, monId),
    [donnees.comptes, mailsTous, monId],
  );
  const aClasser = compterAClasser(donnees.mails, classesDeja);
  const nonLus = compterNonLusReception(donnees.mails, monId);

  const vue = useMemo<VueMails>(
    () => vueChoisie ?? { genre: "dossier", ...vueParDefaut(donnees.mails, monId) },
    [vueChoisie, donnees.mails, monId],
  );
  const enRecherche = terme.trim() !== "";

  const mailsDeLaVue = useMemo<MailLocal[]>(() => {
    if (enRecherche) {
      if (enDemo) {
        const mot = terme.trim().toLowerCase();
        return donnees.mails.filter((mail) =>
          `${mail.objet ?? ""} ${mail.expediteur ?? ""} ${mail.debut_texte ?? ""} ${mail.extrait_texte ?? ""}`
            .toLowerCase()
            .includes(mot),
        );
      }
      const parId = new Map(donnees.mails.map((mail) => [mail.id, mail]));
      return hits.flatMap((hit) => {
        const mail = parId.get(hit.id);
        return mail === undefined ? [] : [mail];
      });
    }
    if (vue.genre === "a-classer") {
      return donnees.mails.filter((mail) => estAClasser(mail.etat_classement) && !classesDeja.has(mail.id));
    }
    return mailsDuDossier(mailsTous, vue.boite, vue.dossier, monId);
  }, [enRecherche, enDemo, terme, hits, donnees.mails, mailsTous, vue, monId, classesDeja]);

  const mailsFiltres = useMemo(() => filtrerMails(mailsDeLaVue, filtre), [mailsDeLaVue, filtre]);
  const groupes = useMemo(() => groupesParJour(mailsFiltres, maintenant), [mailsFiltres, maintenant]);

  const messageVide = enRecherche
    ? "Aucun mail ne correspond."
    : filtre !== "tous"
      ? "Aucun mail ne correspond."
      : vue.genre === "a-classer"
        ? "Tous les mails sont classés."
        : "Aucun message dans cette boîte.";

  const choisi =
    mailsTous.find((mail) => mail.id === selection) ?? trierParDate(mailsFiltres)[0] ?? null;
  const choisiId = choisi?.id ?? null;
  const choisiEstBrouillon = choisi?.brouillon === true;
  const classeLocal = choisi === null ? undefined : classesLocal[choisi.id];

  // Corps du message choisi : base locale, sinon l'API le récupère à la demande.
  useEffect(() => {
    if (choisiId === null || enDemo || choisiEstBrouillon) return;
    if (corpsDemandes.current.has(choisiId)) return;
    corpsDemandes.current.add(choisiId);
    void getPowerSyncDatabase()
      .then((database) => lireTexteStocke(database, choisiId))
      .then(async (texte) => (texte.trim() !== "" ? texte : lireCorpsMessage(instanceUrl, choisiId)))
      .catch(() => "")
      .then((texte) => {
        setCorpsLus((actuel) => ({ ...actuel, [choisiId]: texte }));
      });
  }, [choisiId, choisiEstBrouillon, enDemo, instanceUrl]);

  const corps = choisi === null ? undefined : enDemo ? (demonstration.corps?.[choisi.id] ?? "") : corpsLus[choisi.id];

  const adressesPropres = useMemo(
    () => donnees.comptes.filter((compte) => compte.type_compte === "nominatif").map((compte) => compte.adresse),
    [donnees.comptes],
  );
  // Toutes les adresses du cabinet : une réponse à tous ne s'écrit jamais à soi-même ni à la boîte partagée.
  const adressesDuCabinet = useMemo(() => donnees.comptes.map((compte) => compte.adresse), [donnees.comptes]);
  const invitation = choisi === null ? null : invitationDuMessage(choisi, donnees.invitations);

  const classer = useCallback(
    (mailId: string, dossierId: string) => {
      if (enDemo) return;
      setErreurClassement(null);
      void classerMessage(instanceUrl, mailId, dossierId).then((resultat) => {
        if (resultat.ok) {
          setClassesLocal((actuel) => ({ ...actuel, [mailId]: dossierId }));
        } else {
          setErreurClassement({ id: mailId, message: `Classement impossible. ${resultat.message}` });
        }
      });
    },
    [enDemo, instanceUrl],
  );

  const repondreInvitation = useCallback(
    (invitationId: string, reponse: ReponseInvitation) => {
      setErreurInvitation(null);
      setReponseEnCours(true);
      const cle = cleReponse(invitationId, donnees.invitations.find((candidate) => candidate.id === invitationId)?.sequence);
      void reponseInvitation(instanceUrl, invitationId, reponse)
        .then(() => {
          setReponsesInvitation((actuel) => ({ ...actuel, [cle]: reponse }));
        })
        .catch((err: unknown) => {
          const message =
            err instanceof ErreurReponseInvitation ? err.message : "La réponse n'a pas pu être envoyée.";
          setErreurInvitation({ id: invitationId, message });
        })
        .finally(() => {
          setReponseEnCours(false);
        });
    },
    [instanceUrl, donnees.invitations],
  );

  const actionFile = useCallback(
    (action: (url: string, id: string) => Promise<{ ok: true } | { ok: false; message: string }>, id: string) => {
      setErreurFile(null);
      void action(instanceUrl, id)
        .then(async (resultat) => {
          if (!resultat.ok) setErreurFile(resultat.message);
          setFileSync(await lireFileEnvoi(instanceUrl));
        })
        .catch(() => {
          setErreurFile("L'instance est injoignable.");
        });
    },
    [instanceUrl],
  );

  /** Texte d'un message pour la citation : celui déjà lu, sinon la base locale, sinon le serveur. */
  const texteDuMessage = useCallback(
    async (mail: MailLocal): Promise<string> => {
      if (enDemo) return demonstration.corps?.[mail.id] ?? mail.debut_texte ?? "";
      const dejaLu = corpsLus[mail.id];
      if (dejaLu !== undefined && dejaLu.trim() !== "") return dejaLu;
      try {
        const base = await getPowerSyncDatabase();
        const stocke = await lireTexteStocke(base, mail.id);
        if (stocke.trim() !== "") return stocke;
      } catch {
        /* base locale indisponible : le serveur peut encore répondre */
      }
      const distant = await lireCorpsMessage(instanceUrl, mail.id);
      return distant.trim() !== "" ? distant : (mail.debut_texte ?? "");
    },
    [corpsLus, demonstration, enDemo, instanceUrl],
  );

  const demarrerComposition = useCallback(
    async (demande: DemandeComposition) => {
      const genre = GENRES_API[demande.genre];
      const mail = demande.messageId === undefined ? undefined : mailsTous.find((m) => m.id === demande.messageId);
      if (genre !== "nouveau" && mail === undefined) return;
      let message: MessageCite | null = null;
      if (mail !== undefined && genre !== "nouveau") {
        message = {
          id: mail.id,
          message_id: mail.message_id ?? null,
          objet: mail.objet,
          expediteur: mail.expediteur,
          destinataires_texte: mail.destinataires_texte ?? null,
          cree_le: mail.cree_le ?? null,
          texte: await texteDuMessage(mail),
          pieces: listePieces(mail),
        };
      }
      // En ligne, le serveur complète le départ : adresses du cabinet exclues, chaîne `References` du fil, et le texte
      // du message quand le poste ne l'a pas (boîte du cabinet, lue par le serveur).
      let serveur: DepartServeur | null = null;
      if (!enDemo && mail !== undefined && genre !== "nouveau") {
        const reponse = await composerDepartServeur(instanceUrl, genre, mail.id);
        if (reponse.ok) serveur = reponse.valeur;
      }
      if (message !== null && message.texte.trim() === "" && serveur !== null && serveur.texteCite !== "") {
        message = { ...message, texte: serveur.texteCite };
      }
      const dossierClasse =
        mail === undefined ? null : (classesLocal[mail.id] ?? (mail.etat_classement === "classe" ? mail.dossier_id : null));
      let etat = etatDeDepart({
        id: crypto.randomUUID(),
        genre,
        message,
        adressesPropres: adressesDuCabinet,
        dossierId: dossierClasse,
      });
      if (serveur !== null && (genre === "reponse" || genre === "reponse_a_tous")) {
        etat = appliquerDepartServeur(etat, serveur);
      }
      setComposition({
        cle: crypto.randomUUID(),
        etat,
        precedent: null,
        modifieLe: null,
        piecesDuMessage: message?.pieces.slice() ?? [],
        piecesInitiales: [],
        signatureActive: true,
        compteConnu: serveur?.compteId ?? (mail === undefined ? null : compteNominatifDuMessage(mail, donnees.comptes, monId)),
      });
    },
    [adressesDuCabinet, classesLocal, donnees.comptes, enDemo, instanceUrl, mailsTous, monId, texteDuMessage],
  );

  const ouvrirBrouillon = useCallback(
    (id: string) => {
      const ligne = donnees.brouillons.find((candidat) => candidat.id === id);
      if (ligne === undefined) return;
      const etat = etatDepuisLigne(ligne);
      const origine = etat.origineMessageId === null ? undefined : donnees.mails.find((m) => m.id === etat.origineMessageId);
      setComposition({
        cle: crypto.randomUUID(),
        etat,
        precedent: champsEcrits(etat),
        modifieLe: ligne.modifie_le,
        piecesDuMessage: origine === undefined ? [] : listePieces(origine),
        piecesInitiales: lirePiecesBrouillon(ligne.pieces_texte),
        signatureActive: false,
        compteConnu: null,
      });
    },
    [donnees.brouillons, donnees.mails],
  );

  const composer = useCallback(
    (demande: DemandeComposition) => {
      void demarrerComposition(demande);
      onComposer?.(demande);
    },
    [demarrerComposition, onComposer],
  );

  const choisirMail = useCallback(
    (id: string) => {
      setSelection(id);
      if (donnees.brouillons.some((brouillon) => brouillon.id === id)) ouvrirBrouillon(id);
      else setComposition(null);
    },
    [donnees.brouillons, ouvrirBrouillon],
  );

  const dossierDuChoisi: DossierClassement | undefined =
    choisi === null
      ? undefined
      : dossiersParId.get(classeLocal ?? (choisi.etat_classement === "classe" ? (choisi.dossier_id ?? "") : ""));

  /** Le temps d'un mail n'est écrit qu'à la demande de l'utilisateur, avec les minutes qu'il a validées. */
  const saisirTempsMail = useCallback(
    async (mailId: string, dossierId: string, minutes: number, actes: readonly ActeMail[]) => {
      setErreurTemps(null);
      setTempsEnCours(true);
      try {
        const base = await getPowerSyncDatabase();
        const resultat = await saisirTempsDuMail(base, {
          dossierId,
          minutes,
          actes,
          intervenantId: utilisateurIdDepuisJeton(loadSessionTokens().accessToken),
        });
        if (resultat.ok) {
          setTempsSaisis((actuel) => ({ ...actuel, [mailId]: minutes }));
          noterReglement(mailId);
        } else {
          setErreurTemps({ id: mailId, message: resultat.message });
        }
      } catch {
        setErreurTemps({ id: mailId, message: "Le temps n'a pas pu être enregistré sur cet appareil." });
      } finally {
        setTempsEnCours(false);
      }
    },
    [noterReglement],
  );

  let suggestionTemps: SuggestionTempsMail | undefined;
  if (!enDemo && choisi !== null && dossierDuChoisi !== undefined && journal !== null) {
    const suite = suiteDuMail(journal, choisi.id);
    const saisi = tempsSaisis[choisi.id] ?? null;
    const expediteur = analyserCorrespondant(choisi.expediteur).adresse.toLowerCase();
    const proposable = proposer({
      classeDansUnDossier: true,
      regle: suite.regle,
      ecritParLeCabinet: choisiEstBrouillon || adressesDuCabinet.some((adresse) => adresse.toLowerCase() === expediteur),
    });
    if (saisi !== null || proposable) {
      const mailId = choisi.id;
      const dossierId = dossierDuChoisi.id;
      suggestionTemps = {
        dossier: { nom: dossierDuChoisi.nom, chemise: dossierDuChoisi.chemise },
        proposition: proposable ? propositionTemps(suite.actes) : null,
        minutesSaisies: saisi,
        enCours: tempsEnCours,
        erreur: erreurTemps?.id === mailId ? erreurTemps.message : null,
        onSaisir: (minutes) => {
          void saisirTempsMail(mailId, dossierId, minutes, suite.actes);
        },
        onEcarter: () => {
          noterReglement(mailId);
        },
      };
    }
  }

  const actions: ActionBarre[] = [
    {
      id: "nouveau-mail",
      label: "Nouveau mail",
      primaire: true,
      onClick: () => {
        composer({ genre: "nouveau" });
      },
    },
    {
      id: "saisir-temps",
      label: "Saisir du temps",
      onClick: () => {
        onSaisirTemps?.();
      },
    },
  ];
  if (onOuvrirDossier !== undefined && dossierDuChoisi !== undefined) {
    const ouvrir = dossierDuChoisi;
    actions.push({
      id: "ouvrir-dossier",
      label: "Ouvrir le dossier",
      onClick: () => {
        onOuvrirDossier(ouvrir.id, ouvrir.nom, ouvrir.chemise, ouvrir.reference);
      },
    });
  }

  const releve = libelleReleve(demonstration?.derniereReleve, maintenant);

  return (
    <div
      className="fond-neutre relative flex h-full max-h-[calc(100vh-58px)] min-h-0 flex-col overflow-hidden px-[30px] pt-[28px]"
      data-testid="ecran-mails"
      data-fond="neutre"
    >
      <header className="mails-tete" data-testid="mails-entete">
        <div>
          <h1>{fr("Mails")}</h1>
          <p data-testid="mails-sous-titre">{fr(sousTitreEcran(aClasser, nonLus))}</p>
        </div>
        {releve === null ? null : (
          <span className="mails-releve" data-testid="mails-releve">
            <i aria-hidden />
            {fr(releve)}
          </span>
        )}
      </header>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="mails-feuille" data-testid="mails-trois-volets">
          <RailMails
            aClasser={aClasser}
            vue={vue}
            onVue={(nouvelle) => {
              setVueChoisie(nouvelle);
              setTerme("");
              setComposition(null);
            }}
            boites={rail}
            file={file}
            erreurFile={erreurFile}
            onAnnuler={(id) => {
              actionFile(annulerEnvoi, id);
            }}
            onRelancer={(id) => {
              actionFile(relancerEnvoi, id);
            }}
          />
          <PanneauListe
            titre={enRecherche ? "Résultats" : titreDeLaVue(vue, rail)}
            terme={terme}
            onTerme={setTerme}
            filtre={filtre}
            onFiltre={setFiltre}
            groupes={groupes}
            enRecherche={enRecherche}
            messageVide={messageVide}
            selection={choisiId}
            onSelection={choisirMail}
            dossiers={dossiersParId}
            classesLocal={classesLocal}
            maintenant={maintenant}
          />
          {composition !== null ? (
            <section className="mails-lecture mails-lecture--redaction" data-testid="mails-redaction-volet">
              <VoletRedaction
                key={composition.cle}
                depart={composition.etat}
                precedent={composition.precedent}
                modifieLe={composition.modifieLe}
                instanceUrl={instanceUrl}
                piecesDuMessage={composition.piecesDuMessage}
                piecesInitiales={composition.piecesInitiales}
                signatureActive={composition.signatureActive}
                compteConnu={composition.compteConnu}
                mails={donnees.mails}
                adressesPropres={adressesDuCabinet}
                dossiers={dossiersParId}
                demonstration={enDemo}
                onEnvoye={() => {
                  // Le mail auquel on a répondu ou qu'on a transféré est traité : la suggestion de temps en tient compte.
                  const { genre, origineMessageId } = composition.etat;
                  if (origineMessageId !== null && genre !== "nouveau") {
                    noterActeMail(origineMessageId, genre === "transfert" ? "transfert" : "reponse");
                  }
                  setComposition(null);
                  void lireFileEnvoi(instanceUrl).then(setFileSync);
                }}
                onSupprime={() => {
                  setComposition(null);
                }}
              />
            </section>
          ) : choisi === null ? (
            <section className="mails-lecture" data-testid="mails-lecture">
              <p className="mails-vide">{fr("Aucun message à lire.")}</p>
            </section>
          ) : (
            <LectureMail
              key={choisi.id}
              mail={choisi}
              maintenant={maintenant}
              adressesPropres={adressesPropres}
              corps={corps}
              dossiers={dossiersParId}
              classeLocal={classeLocal}
              erreurClassement={erreurClassement?.id === choisi.id ? erreurClassement.message : null}
              onClasser={(dossierId) => {
                classer(choisi.id, dossierId);
              }}
              invitation={invitation}
              reponseConfirmee={
                invitation === null
                  ? undefined
                  : (reponsesInvitation[cleReponse(invitation.id, invitation.sequence)] ?? reponseEnvoyee(invitation.reponse))
              }
              erreurInvitation={
                invitation !== null && erreurInvitation?.id === invitation.id ? erreurInvitation.message : null
              }
              reponseEnCours={reponseEnCours}
              onRepondreInvitation={repondreInvitation}
              onComposer={composer}
              temps={suggestionTemps}
            />
          )}
        </div>
      </Feuille>
      {composition === null ? <BarreActions actions={actions} /> : null}
    </div>
  );
}
