import { Feuille } from "@/coque/Feuille";
import { BarreActions } from "@/coque/BarreActions";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

export type LigneJournee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId };
  urgent?: boolean;
};

export type DonneesJournee = {
  audiences: LigneJournee[];
  delais: LigneJournee[];
  mails: LigneJournee[];
  temps: LigneJournee[];
};

/** Jeu fictif pour DEV / galerie / captures B9 (§ 7.6). */
export const JOURNEE_DEMO: DonneesJournee = {
  audiences: [
    {
      id: "aud-1",
      titre: "Audience de mise en état",
      meta: "TJ Nanterre · 9 h 30",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "aud-2",
      titre: "Rendez-vous client",
      meta: "Cabinet · 14 h 00",
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande" },
    },
  ],
  delais: [
    {
      id: "del-1",
      titre: "Conclusions adverses",
      meta: "échéance le 3 oct. · 5 jours",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
      urgent: false,
    },
    {
      id: "del-2",
      titre: "Appel incident",
      meta: "échéance le 29 sept. · 2 jours",
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur" },
      urgent: true,
    },
  ],
  mails: [
    {
      id: "mail-1",
      titre: "Me Dupont — pièces jointes",
      meta: "Suggéré : Ferrand Métal",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "mail-2",
      titre: "Assurances Loire — mise en demeure",
      meta: "Suggéré : Martin / Assurances Loire",
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur" },
    },
  ],
  temps: [
    {
      id: "tps-1",
      titre: "Préparation audience",
      meta: "0 h 45 · brouillon",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "tps-2",
      titre: "Entretien téléphonique",
      meta: "0 h 20 · brouillon",
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande" },
    },
  ],
};

type JourneeProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  /** Affiche le jeu fictif (galerie / captures). Défaut : DEV. */
  donneesDemo?: boolean;
  donnees?: DonneesJournee;
};

function Pastille({ chemise }: { chemise: ChemiseId }) {
  return (
    <span
      className="ligne-journee__pastille"
      data-chemise={chemise}
      aria-hidden
    />
  );
}

function Section({
  titre,
  lignes,
  vide,
}: {
  titre: string;
  lignes: LigneJournee[];
  vide: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
        {fr(titre)}
      </h2>
      {lignes.length === 0 ? (
        <p className="text-graphite">{fr(vide)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lignes.map((ligne) => (
            <li
              key={ligne.id}
              className={`ligne-journee${ligne.urgent ? " ligne-journee--urgent" : ""}`}
            >
              {ligne.dossier ? <Pastille chemise={ligne.dossier.chemise} /> : null}
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{fr(ligne.titre)}</div>
                <div className="truncate text-[length:var(--font-size-dense)] text-graphite">
                  {fr(ligne.meta)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Journee({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  donneesDemo,
  donnees,
}: JourneeProps) {
  const utiliserDemo = donneesDemo ?? import.meta.env.DEV;
  const jeu = donnees ?? (utiliserDemo ? JOURNEE_DEMO : undefined);
  const audiences = jeu?.audiences ?? [];
  const delais = jeu?.delais ?? [];
  const mails = jeu?.mails ?? [];
  const temps = jeu?.temps ?? [];

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px] pb-0"
      data-testid="ecran-journee"
      data-fond="neutre"
    >
      <div className="sr-only" data-testid="fond-neutre">
        {fr("Fond neutre")}
      </div>
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
        {fr("La journée")}
      </h1>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="grid gap-8 p-[22px] pb-24 md:grid-cols-2">
          <Section
            titre="Audiences et rendez-vous"
            lignes={audiences}
            vide="Aucune audience ni rendez-vous aujourd’hui."
          />
          <Section
            titre="Délais"
            lignes={delais}
            vide="Aucun délai à surveiller pour le moment."
          />
          <Section
            titre="Mails à classer"
            lignes={mails}
            vide="Aucun mail en attente de classement."
          />
          <Section
            titre="Temps à saisir"
            lignes={temps}
            vide="Aucun temps en attente de saisie."
          />
        </div>
      </Feuille>
      <BarreActions
        actions={[
          { id: "nouveau-dossier", label: "Nouveau dossier", primaire: true, onClick: onNouveauDossier },
          { id: "nouveau-mail", label: "Nouveau mail", onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", raccourci: "T", onClick: onSaisirTemps },
        ]}
      />
    </div>
  );
}
