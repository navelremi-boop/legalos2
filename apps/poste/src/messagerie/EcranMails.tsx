import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarreActions, type ActionBarre } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";
import {
  annulerEnvoi,
  classerMessage,
  lireCorpsMessage,
  lireFileEnvoi,
  relancerEnvoi,
} from "@/messagerie/apiMessagerie";
import {
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
import { lireDonneesMails, lireTexteStocke, type DonneesMails } from "@/messagerie/donneesMails";
import { invitationDuMessage } from "@/messagerie/invitations";
import { LectureMail, type DemandeComposition } from "@/messagerie/LectureMail";
import { PanneauListe } from "@/messagerie/PanneauListe";
import { filtrerMails, groupesParJour, trierParDate, type FiltreListe } from "@/messagerie/listeMails";
import { RailMails, type VueMails } from "@/messagerie/RailMails";
import { libelleReleve } from "@/messagerie/releve";
import { rechercherMailsHorsLigne, type ResultatRechercheMail } from "@/messagerie/rechercheMails";
import {
  ErreurReponseInvitation,
  reponseInvitation,
  type ReponseInvitation,
} from "@/messagerie/reponseInvitation";
import type { DemonstrationMails, LigneEnvoi, MailLocal } from "@/messagerie/typesMails";
import { getPowerSyncDatabase } from "@/sync/database";

export type { DemonstrationMails, MailLocal } from "@/messagerie/typesMails";
export type { DemandeComposition, GenreComposition } from "@/messagerie/LectureMail";

type EcranMailsProps = {
  instanceUrl: string;
  /**
   * Demande de rédaction (nouveau mail, réponse, réponse à tous, transfert). Branchée par la partie B de
   * l'étape 4 ; sans elle, les boutons sont visibles mais n'ouvrent rien.
   */
  onComposer?: (demande: DemandeComposition) => void;
  onSaisirTemps?: () => void;
  /** Ouvre le dossier où le mail est classé. Sans lui, le bouton « Ouvrir le dossier » n'est pas proposé. */
  onOuvrirDossier?: (id: string, nom: string, chemise: string, reference?: string | null) => void;
  /** Galerie seulement : pas d'appel PowerSync. */
  demonstration?: DemonstrationMails;
};

const DONNEES_VIDES: DonneesMails = { comptes: [], mails: [], dossiers: [], invitations: [] };

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
  const corpsDemandes = useRef(new Set<string>());

  const enDemo = demonstration !== undefined;
  const donnees: DonneesMails = demonstration
    ? {
        comptes: demonstration.comptes,
        mails: demonstration.mails,
        dossiers: demonstration.dossiers,
        invitations: demonstration.invitations ?? [],
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
  const classesDeja = useMemo(() => new Set(Object.keys(classesLocal)), [classesLocal]);
  const dossiersParId = useMemo(() => {
    const table = new Map<string, DossierClassement>();
    for (const dossier of donnees.dossiers) table.set(dossier.id, dossier);
    return table;
  }, [donnees.dossiers]);
  const rail = useMemo(
    () => construireRail(donnees.comptes, donnees.mails, monId),
    [donnees.comptes, donnees.mails, monId],
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
    return mailsDuDossier(donnees.mails, vue.boite, vue.dossier, monId);
  }, [enRecherche, enDemo, terme, hits, donnees.mails, vue, monId, classesDeja]);

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
    donnees.mails.find((mail) => mail.id === selection) ?? trierParDate(mailsFiltres)[0] ?? null;
  const choisiId = choisi?.id ?? null;
  const classeLocal = choisi === null ? undefined : classesLocal[choisi.id];

  // Corps du message choisi : base locale, sinon l'API le récupère à la demande.
  useEffect(() => {
    if (choisiId === null || enDemo) return;
    if (corpsDemandes.current.has(choisiId)) return;
    corpsDemandes.current.add(choisiId);
    void getPowerSyncDatabase()
      .then((database) => lireTexteStocke(database, choisiId))
      .then(async (texte) => (texte.trim() !== "" ? texte : lireCorpsMessage(instanceUrl, choisiId)))
      .catch(() => "")
      .then((texte) => {
        setCorpsLus((actuel) => ({ ...actuel, [choisiId]: texte }));
      });
  }, [choisiId, enDemo, instanceUrl]);

  const corps = choisi === null ? undefined : enDemo ? (demonstration.corps?.[choisi.id] ?? "") : corpsLus[choisi.id];

  const adressesPropres = useMemo(
    () => donnees.comptes.filter((compte) => compte.type_compte === "nominatif").map((compte) => compte.adresse),
    [donnees.comptes],
  );
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
      void reponseInvitation(instanceUrl, invitationId, reponse)
        .then(() => {
          setReponsesInvitation((actuel) => ({ ...actuel, [invitationId]: reponse }));
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
    [instanceUrl],
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

  const dossierDuChoisi: DossierClassement | undefined =
    choisi === null
      ? undefined
      : dossiersParId.get(classeLocal ?? (choisi.etat_classement === "classe" ? (choisi.dossier_id ?? "") : ""));

  const actions: ActionBarre[] = [
    {
      id: "nouveau-mail",
      label: "Nouveau mail",
      primaire: true,
      onClick: () => {
        onComposer?.({ genre: "nouveau" });
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
            onSelection={setSelection}
            dossiers={dossiersParId}
            classesLocal={classesLocal}
            maintenant={maintenant}
          />
          {choisi === null ? (
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
              reponseConfirmee={invitation === null ? undefined : reponsesInvitation[invitation.id]}
              erreurInvitation={
                invitation !== null && erreurInvitation?.id === invitation.id ? erreurInvitation.message : null
              }
              reponseEnCours={reponseEnCours}
              onRepondreInvitation={repondreInvitation}
              onComposer={onComposer}
            />
          )}
        </div>
      </Feuille>
      <BarreActions actions={actions} />
    </div>
  );
}
