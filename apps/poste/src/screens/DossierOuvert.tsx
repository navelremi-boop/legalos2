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
import { VueScindee } from "@/coque/chrono/VueScindee";
import type { ChronoItem } from "@/coque/chrono/types";
import {
  creerIntercalaire,
  rattacherElement,
  renommerIntercalaire,
  retirerIntercalaire,
} from "@/dossiers/ecrireIntercalaire";
import { ArborescencePieces } from "@/documents/ArborescencePieces";
import { CompleterDossier } from "@/dossiers/CompleterDossier";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

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

  const onglets: IntercalaireItem[] = [
    ...INTERCALAIRES_STANDARDS.map((s) =>
      s.id === "chrono" && elementsChrono
        ? { ...s, compteur: elementsChrono.length }
        : { ...s },
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
      className="fond-chemise relative flex h-full min-h-0 flex-col pr-[168px] pl-[42px] pt-[28px]"
      data-chemise={dossier.chemise}
      data-testid="ecran-dossier"
      data-dossier-id={dossier.id}
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-7">
        <div>
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
          {conflitDossier ? (
            <p data-testid="dossier-conflit" role="status">
              {fr(
                `Conflit sur ${conflitDossier.champ} : « ${conflitDossier.valeur_remplacee ?? ""} » remplacé par « ${conflitDossier.valeur_appliquee ?? ""} ».`,
              )}
            </p>
          ) : null}
          {conflitContact ? (
            <p data-testid="contact-conflit" role="status">
              {fr(
                `Conflit de contact sur ${conflitContact.champ} : « ${conflitContact.valeur_remplacee ?? ""} » remplacé par « ${conflitContact.valeur_appliquee ?? ""} ».`,
              )}
            </p>
          ) : null}
          <ul data-testid="contact-historique">
            {historique.map((ligne, index) => (
              <li key={`${ligne.champ}-${String(index)}`}>
                {fr(`${ligne.champ} : ${ligne.valeur_appliquee ?? ""}`)}
              </li>
            ))}
          </ul>
          {intercalairesSync ? <CompleterDossier dossierId={dossier.id} /> : null}
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

      <div className="relative mt-6 min-h-0 flex-1">
        <Feuille uneColonne={!chronoActif} className="h-full min-h-[360px]">
          {chronoActif ? (
            <VueScindee items={elementsChrono ?? []} />
          ) : persoActif ? (
            <div className="p-[22px] pb-24" data-testid="vue-intercalaire-perso">
              {conflits.length > 0 ? (
                <div
                  className="mb-4 rounded-[var(--radius-control)] bg-survol px-3 py-2 text-[length:var(--font-size-dense)]"
                  data-testid="intercalaire-conflit"
                  role="status"
                >
                  {fr(
                    `Conflit de synchronisation sur le nom : « ${conflits[0]?.valeur_remplacee ?? ""} » remplacé par « ${conflits[0]?.valeur_appliquee ?? ""} ».`,
                  )}
                </div>
              ) : null}
              <label className="mb-2 block text-[length:var(--font-size-dense)] text-graphite">
                {fr("Nom de l'intercalaire")}
              </label>
              <input
                className="mb-4 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
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
              <p className="mb-4 text-graphite">
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
                      className="rounded-[var(--radius-control)] border border-filet px-3 py-2"
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
                className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
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
              <h3 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
                {fr(titreStandard)}
              </h3>
              <p className="text-graphite">
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

export const DOSSIERS_DEMO: DossierDemo[] = [
  {
    id: "demo-kraft",
    reference: "2026-042",
    nom: "Ferrand Métal",
    chemise: "kraft",
    juridiction: "TJ Nanterre",
    numeroRg: "24/03812",
    client: "SAS Ferrand Métal",
    adversaire: "Sté Dupuis Outillage",
    echeanceDemo: {
      joursRestants: 5,
      partEcoulee: 0.62,
      intitule: "Conclusions adverses",
      dateLibelle: "échéance le 3 oct.",
    },
  },
  {
    id: "demo-bleu",
    reference: "2026-018",
    nom: "Martin / Assurances Loire",
    chemise: "bleu-classeur",
    juridiction: "CA Paris",
    numeroRg: "25/00441",
    client: "Me Martin",
    adversaire: "Assurances Loire",
    echeanceDemo: {
      joursRestants: 2,
      partEcoulee: 0.8,
      intitule: "Appel incident",
      dateLibelle: "échéance le 29 sept.",
    },
  },
  {
    id: "demo-amande",
    reference: "2026-007",
    nom: "SCI des Lilas",
    chemise: "vert-amande",
    juridiction: "TJ Lyon",
    numeroRg: "23/01990",
    client: "SCI des Lilas",
    adversaire: "M. Durand",
    echeanceDemo: {
      joursRestants: 12,
      partEcoulee: 0.35,
      intitule: "Mémoire ampliatif",
      dateLibelle: "échéance le 15 oct.",
    },
  },
  {
    id: "demo-lilas",
    reference: "2026-031",
    nom: "Époux Bernard",
    chemise: "lilas",
    juridiction: "TJ Bordeaux",
    numeroRg: "25/01102",
    client: "Époux Bernard",
    adversaire: "Banque Atlantique",
    echeanceDemo: {
      joursRestants: 8,
      partEcoulee: 0.45,
      intitule: "Conclusions",
      dateLibelle: "échéance le 10 oct.",
    },
  },
];
