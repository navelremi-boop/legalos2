import { useEffect, useState } from "react";
import { EtiquetteDossier } from "@/coque/EtiquetteDossier";
import { InfosDossier } from "@/coque/InfosDossier";
import { JaugeEcheance } from "@/coque/JaugeEcheance";
import { Feuille } from "@/coque/Feuille";
import {
  Intercalaires,
  INTERCALAIRES_STANDARDS,
  estIntercalaireStandard,
  type IntercalaireId,
  type IntercalaireItem,
} from "@/coque/Intercalaires";
import { BarreActions } from "@/coque/BarreActions";
import { chargerChrono } from "@/coque/chrono/chargerChrono";
import { VueScindee } from "@/coque/chrono/VueScindee";
import type { ChronoItem } from "@/coque/chrono/types";
import {
  creerIntercalaire,
  rattacherElement,
  renommerIntercalaire,
  retirerIntercalaire,
} from "@/dossiers/ecrireIntercalaire";
import { ArborescencePieces } from "@/documents/ArborescencePieces";
import { PanneauConvention } from "@/conventions/PanneauConvention";
import { CompleterDossier } from "@/dossiers/CompleterDossier";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";
import { decalerJour, jourCivil } from "@/agenda/navigationAgenda";
import { formatDateCourte } from "@/lib/format";

export type DossierVue = {
  id: string;
  reference: string;
  nom: string;
  chemise: ChemiseId;
  juridiction: string;
  numeroRg: string;
  client: string;
  adversaire: string;
  confrere?: string;
  typeDossier?: string;
  etape?: string;
  lies?: string;
  /** Présente uniquement pour le jeu de démonstration / galerie. */
  echeanceDemo?: {
    joursRestants: number;
    partEcoulee: number;
    intitule: string;
    dateLibelle: string;
  };
};

type IntercalaireLocal = {
  id: string;
  nom: string;
};

type ElementLocal = {
  id: string;
  intercalaire_id: string;
  type_element: string;
  element_id: string;
};

type ConflitLocal = {
  champ: string;
  valeur_remplacee: string | null;
  valeur_appliquee: string | null;
};

type DossierOuvertProps = {
  dossier: DossierVue;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  onFacturer: () => void;
  onCalculerDelai: () => void;
  /** Jeu fictif : galerie et captures seulement, jamais un dossier réel. */
  elementsChrono?: ChronoItem[];
  /**
   * Charge et écrit les intercalaires personnalisés (SQLite).
   * Désactivé pour la galerie démo (identifiants hors base).
   */
  intercalairesSync?: boolean;
};

export function DossierOuvert({
  dossier,
  onNouveauMail,
  onSaisirTemps,
  onFacturer,
  onCalculerDelai,
  elementsChrono,
  intercalairesSync = true,
}: DossierOuvertProps) {
  const [intercalaire, setIntercalaire] = useState<IntercalaireId>("chrono");
  const [personnalises, setPersonnalises] = useState<IntercalaireLocal[]>([]);
  const [elements, setElements] = useState<ElementLocal[]>([]);
  const [conflits, setConflits] = useState<ConflitLocal[]>([]);
  const [conflitDossier, setConflitDossier] = useState<ConflitLocal | null>(null);
  const [conflitContact, setConflitContact] = useState<ConflitLocal | null>(null);
  const [historique, setHistorique] = useState<ConflitLocal[]>([]);
  const [brouillonNom, setBrouillonNom] = useState<Record<string, string>>({});
  const [chronoSync, setChronoSync] = useState<ChronoItem[]>([]);
  const chronoActif = intercalaire === "chrono";
  const persoActif =
    !estIntercalaireStandard(intercalaire) &&
    personnalises.some((p) => p.id === intercalaire);
  const nomEdition =
    brouillonNom[String(intercalaire)] ??
    personnalises.find((p) => p.id === intercalaire)?.nom ??
    "";

  useEffect(() => {
    if (!intercalairesSync) {
      return;
    }
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const rows = await database.getAll<IntercalaireLocal>(
            `SELECT id, nom FROM intercalaires_personnalises
             WHERE dossier_id = ? ORDER BY cree_le ASC, nom ASC`,
            [dossier.id],
          );
          const liens = await database.getAll<ElementLocal>(
            `SELECT id, intercalaire_id, type_element, element_id
             FROM intercalaire_elements WHERE dossier_id = ?`,
            [dossier.id],
          );
          let journaux: ConflitLocal[] = [];
          if (!estIntercalaireStandard(intercalaire)) {
            journaux = await database.getAll<ConflitLocal>(
              `SELECT champ, valeur_remplacee, valeur_appliquee
               FROM journal_modifications
               WHERE table_cible = 'intercalaires_personnalises'
                 AND conflit = 1
                 AND enregistrement_id = ?
               ORDER BY cree_le DESC`,
              [intercalaire],
            );
          }
          const dossierConflits = await database.getAll<ConflitLocal>(
            `SELECT champ, valeur_remplacee, valeur_appliquee
             FROM journal_modifications
             WHERE table_cible = 'dossiers' AND conflit = 1 AND enregistrement_id = ?
             ORDER BY cree_le DESC LIMIT 1`,
            [dossier.id],
          );
          const contactConflits = await database.getAll<ConflitLocal>(
            `SELECT champ, valeur_remplacee, valeur_appliquee
             FROM journal_modifications
             WHERE table_cible = 'contacts' AND conflit = 1
               AND enregistrement_id IN (
                 SELECT contact_id FROM parties WHERE dossier_id = ? AND contact_id IS NOT NULL
               )
             ORDER BY cree_le DESC LIMIT 1`,
            [dossier.id],
          );
          const lignes = await database.getAll<ConflitLocal>(
            `SELECT champ, valeur_remplacee, valeur_appliquee
             FROM journal_modifications
             WHERE table_cible = 'parties'
               AND enregistrement_id IN (SELECT id FROM parties WHERE dossier_id = ?)
             ORDER BY cree_le ASC`,
            [dossier.id],
          );
          return {
            rows,
            liens,
            journaux,
            dossierConflit: dossierConflits[0] ?? null,
            contactConflit: contactConflits[0] ?? null,
            historique: lignes,
          };
        })
        .then(({ rows, liens, journaux, dossierConflit, contactConflit, historique: lignes }) => {
          if (stop) return;
          setPersonnalises(rows);
          setElements(liens);
          setConflits(journaux);
          setConflitDossier(dossierConflit);
          setConflitContact(contactConflit);
          setHistorique(lignes);
        })
        .catch(() => {
          if (stop) return;
          setPersonnalises([]);
          setElements([]);
          setConflits([]);
          setConflitDossier(null);
          setConflitContact(null);
          setHistorique([]);
        });
    };
    tick();
    const timer = window.setInterval(tick, 1_500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [dossier.id, intercalaire, intercalairesSync]);

  useEffect(() => {
    if (elementsChrono !== undefined) return;
    let stop = false;
    const tick = () => {
      void chargerChrono(dossier.id)
        .then((items) => {
          if (!stop) setChronoSync(items);
        })
        .catch(() => {
          if (!stop) setChronoSync([]);
        });
    };
    tick();
    const timer = window.setInterval(tick, 1_500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [dossier.id, elementsChrono]);

  const chronoItems = elementsChrono ?? chronoSync;

  const onglets: IntercalaireItem[] = [
    ...INTERCALAIRES_STANDARDS.map((s) =>
      s.id === "chrono" ? { ...s, compteur: chronoItems.length } : { ...s },
    ),
    ...personnalises.map((p) => ({
      id: p.id,
      label: p.nom,
      compteur: elements.filter((e) => e.intercalaire_id === p.id).length,
      personnalise: true as const,
    })),
  ];

  const elementsActifs = elements.filter((e) => e.intercalaire_id === intercalaire);

  const titreStandard =
    intercalaire === "procedure"
      ? "Procédure"
      : intercalaire === "pieces"
        ? "Pièces"
        : intercalaire === "mails"
          ? "Mails"
          : intercalaire === "factures"
            ? "Factures"
            : "Chrono";

  return (
    <div
      className="fond-chemise ecran-dossier relative flex h-full min-h-0 flex-col pt-[28px]"
      data-chemise={dossier.chemise}
      data-testid="ecran-dossier"
      data-dossier-id={dossier.id}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6">
        <div className="min-w-0">
          <EtiquetteDossier reference={dossier.reference} nom={dossier.nom} />
          <InfosDossier
            juridiction={dossier.juridiction}
            numeroRg={dossier.numeroRg}
            client={dossier.client}
            adversaire={dossier.adversaire}
            confrere={dossier.confrere}
            typeDossier={dossier.typeDossier}
            etape={dossier.etape}
            lies={dossier.lies}
          />
          <div className="dossier-tete__actions">
            <PanneauConvention dossierId={dossier.id} />
            {intercalairesSync ? <CompleterDossier dossierId={dossier.id} /> : null}
          </div>
          {conflitDossier ? (
            <p className="message-info mt-3 max-w-[var(--lecture-max)]" data-testid="dossier-conflit" role="status">
              {fr(
                `Conflit sur ${conflitDossier.champ} : « ${conflitDossier.valeur_remplacee ?? ""} » remplacé par « ${conflitDossier.valeur_appliquee ?? ""} ».`,
              )}
            </p>
          ) : null}
          {conflitContact ? (
            <p className="message-info mt-2 max-w-[var(--lecture-max)]" data-testid="contact-conflit" role="status">
              {fr(
                `Conflit de contact sur ${conflitContact.champ} : « ${conflitContact.valeur_remplacee ?? ""} » remplacé par « ${conflitContact.valeur_appliquee ?? ""} ».`,
              )}
            </p>
          ) : null}
          <ul className="mt-2 text-[length:var(--font-size-dense)] text-sur-chemise" data-testid="contact-historique">
            {historique.map((ligne, index) => (
              <li key={`${ligne.champ}-${String(index)}`}>
                {fr(`${ligne.champ} : ${ligne.valeur_appliquee ?? ""}`)}
              </li>
            ))}
          </ul>
        </div>
        {dossier.echeanceDemo ? (
          <JaugeEcheance
            joursRestants={dossier.echeanceDemo.joursRestants}
            partEcoulee={dossier.echeanceDemo.partEcoulee}
            intitule={dossier.echeanceDemo.intitule}
            dateLibelle={dossier.echeanceDemo.dateLibelle}
          />
        ) : (
          <div className="jauge-echeance" data-testid="jauge-echeance" role="status">
            <p className="text-[length:var(--font-size-dense)] text-sur-chemise opacity-75">
              {fr("Aucune échéance à afficher")}
            </p>
          </div>
        )}
      </div>

      <div className="tenue-cadre relative mt-6 min-h-0 flex-1">
        <Feuille uneColonne={!chronoActif} className="h-full min-h-[360px]">
          {chronoActif ? (
            <VueScindee items={chronoItems} />
          ) : persoActif ? (
            <div className="p-[22px] pb-24" data-testid="vue-intercalaire-perso">
              {conflits.length > 0 ? (
                <div
                  className="message-info mb-4"
                  data-testid="intercalaire-conflit"
                  role="status"
                >
                  {fr(
                    `Conflit de synchronisation sur le nom : « ${conflits[0]?.valeur_remplacee ?? ""} » remplacé par « ${conflits[0]?.valeur_appliquee ?? ""} ».`,
                  )}
                </div>
              ) : null}
              <label className="etiquette-champ" htmlFor="intercalaire-renommer">
                {fr("Nom de l'intercalaire")}
              </label>
              <input
                id="intercalaire-renommer"
                className="champ mb-4 max-w-md"
                data-testid="intercalaire-renommer"
                value={nomEdition}
                maxLength={24}
                onChange={(event) => {
                  const valeur = event.target.value;
                  setBrouillonNom((prev) => ({
                    ...prev,
                    [String(intercalaire)]: valeur,
                  }));
                }}
                onBlur={() => {
                  const actuel = personnalises.find((p) => p.id === intercalaire)?.nom ?? "";
                  if (nomEdition.trim() !== "" && nomEdition.trim() !== actuel) {
                    void renommerIntercalaire(String(intercalaire), nomEdition);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    (event.target as HTMLInputElement).blur();
                  }
                }}
              />
              <p className="mb-4 max-w-[var(--lecture-max)] text-graphite">
                {fr(
                  "Intercalaire créé pour ce dossier. Rattachez-y des éléments du chrono : ils resteront aussi visibles dans le chrono.",
                )}
              </p>
              <ul className="mb-4 space-y-2" data-testid="intercalaire-elements">
                {elementsActifs.length === 0 ? (
                  <li className="text-graphite">{fr("Aucun élément rattaché.")}</li>
                ) : (
                  elementsActifs.map((el) => (
                    <li
                      key={el.id}
                      className="liste-element"
                      data-testid="intercalaire-element"
                      data-element-id={el.element_id}
                      data-type={el.type_element}
                    >
                      {fr(el.type_element)}{" "}
                      <span className="text-graphite">{el.element_id.slice(0, 8)}</span>
                    </li>
                  ))
                )}
              </ul>
              <button
                type="button"
                className="bouton"
                data-testid="intercalaire-rattacher-note"
                onClick={() => {
                  void rattacherElement({
                    intercalaireId: String(intercalaire),
                    dossierId: dossier.id,
                    typeElement: "note",
                    elementId: crypto.randomUUID(),
                  });
                }}
              >
                {fr("Rattacher une note")}
              </button>
            </div>
          ) : intercalaire === "pieces" ? (
            <ArborescencePieces dossierId={dossier.id} />
          ) : (
            <div className="p-[22px] pb-24">
              <h3 className="feuille-titre mb-2">
                {fr(titreStandard)}
              </h3>
              <p className="etat-vide">
                {fr("Vue non détaillée dans cette version.")}
              </p>
            </div>
          )}
        </Feuille>
        <Intercalaires
          items={onglets}
          actif={intercalaire}
          onChanger={setIntercalaire}
          onCreer={
            intercalairesSync
              ? async (nom) => {
                  const id = await creerIntercalaire(dossier.id, nom);
                  setIntercalaire(id);
                }
              : undefined
          }
          onRetirer={
            intercalairesSync
              ? async (id) => {
                  if (estIntercalaireStandard(id)) return;
                  await retirerIntercalaire(String(id));
                  if (intercalaire === id) setIntercalaire("chrono");
                }
              : undefined
          }
        />
      </div>

      <BarreActions
        actions={[
          { id: "nouveau-mail", label: "Nouveau mail", primaire: true, onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", raccourci: "T", onClick: onSaisirTemps },
          { id: "facturer", label: "Facturer", onClick: onFacturer },
          {
            id: "calculer-delai",
            label: "Calculer un délai",
            onClick: onCalculerDelai,
          },
        ]}
      />
    </div>
  );
}

/** Jeu fictif pour démonstration / captures (trois chemises du prototype). */
export type DossierDemo = DossierVue;

/** Échéance fictive à `jours` du jour courant, pour des captures toujours datées dans le futur. */
function echeanceDemo(jours: number, partEcoulee: number, intitule: string): DossierVue["echeanceDemo"] {
  const jour = decalerJour(jourCivil(new Date()), jours);
  return { joursRestants: jours, partEcoulee, intitule, dateLibelle: `échéance le ${formatDateCourte(jour)}` };
}

export const DOSSIERS_DEMO: DossierDemo[] = [
  {
    id: "demo-kraft",
    reference: "2026-042",
    nom: "Ferrand Métal",
    chemise: "kraft",
    juridiction: "Tribunal judiciaire de Nanterre",
    numeroRg: "24/03812",
    client: "SAS Ferrand Métal",
    adversaire: "SARL Dupuis Outillage",
    confrere: "Me Clément Vasseur",
    typeDossier: "contentieux",
    etape: "instruction",
    lies: "2026-019, recouvrement Ferrand Métal",
    echeanceDemo: echeanceDemo(5, 0.62, "Conclusions en réplique"),
  },
  {
    id: "demo-bleu",
    reference: "2026-031",
    nom: "Martin c/ Assurances Loire",
    chemise: "bleu-classeur",
    juridiction: "Cour d'appel de Lyon",
    numeroRg: "25/00441",
    client: "M. Paul Martin",
    adversaire: "SA Assurances Loire",
    confrere: "Me Anne Perrin",
    typeDossier: "contentieux",
    etape: "plaidoirie",
    echeanceDemo: echeanceDemo(2, 0.8, "Appel incident"),
  },
  {
    id: "demo-amande",
    reference: "2026-038",
    nom: "SCI des Lilas",
    chemise: "vert-amande",
    juridiction: "Tribunal judiciaire de Lyon",
    numeroRg: "23/01990",
    client: "SCI des Lilas",
    adversaire: "M. Henri Durand",
    confrere: "Me Sophie Roche",
    typeDossier: "conseil",
    etape: "ouverture",
    echeanceDemo: echeanceDemo(12, 0.35, "Mémoire en réponse"),
  },
  {
    id: "demo-lilas",
    reference: "2026-057",
    nom: "Succession Moreau",
    chemise: "lilas",
    juridiction: "Tribunal judiciaire de Lyon",
    numeroRg: "26/00718",
    client: "Mme Claire Moreau",
    adversaire: "M. Julien Moreau",
    confrere: "Me Lucas Garnier",
    typeDossier: "conseil",
    etape: "instruction",
    echeanceDemo: echeanceDemo(8, 0.45, "Projet d'acte de partage"),
  },
];
