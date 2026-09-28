import { useState } from "react";
import { EtiquetteDossier } from "@/coque/EtiquetteDossier";
import { InfosDossier } from "@/coque/InfosDossier";
import { JaugeEcheance } from "@/coque/JaugeEcheance";
import { Feuille } from "@/coque/Feuille";
import { Intercalaires, type IntercalaireId } from "@/coque/Intercalaires";
import { BarreActions } from "@/coque/BarreActions";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

export type DossierVue = {
  id: string;
  reference: string;
  nom: string;
  chemise: ChemiseId;
  juridiction: string;
  numeroRg: string;
  client: string;
  adversaire: string;
  /** Présente uniquement pour le jeu de démonstration / galerie. */
  echeanceDemo?: {
    joursRestants: number;
    partEcoulee: number;
    intitule: string;
    dateLibelle: string;
  };
};

type DossierOuvertProps = {
  dossier: DossierVue;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  onFacturer: () => void;
  onCalculerDelai: () => void;
};

export function DossierOuvert({
  dossier,
  onNouveauMail,
  onSaisirTemps,
  onFacturer,
  onCalculerDelai,
}: DossierOuvertProps) {
  const [intercalaire, setIntercalaire] = useState<IntercalaireId>("chrono");

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
          />
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
        <Feuille uneColonne={intercalaire !== "chrono"} className="h-full min-h-[360px]">
          <div className="p-[22px] pb-24">
            <h3 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
              {fr(
                intercalaire === "chrono"
                  ? "Chrono"
                  : intercalaire === "procedure"
                    ? "Procédure"
                    : intercalaire === "pieces"
                      ? "Pièces"
                      : intercalaire === "mails"
                        ? "Mails"
                        : "Factures",
              )}
            </h3>
            <p className="text-graphite">
              {fr("Le chrono détaillé arrivera avec la vue scindée.")}
            </p>
          </div>
        </Feuille>
        <Intercalaires actif={intercalaire} onChanger={setIntercalaire} />
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
