import { useState } from "react";
import { fichesDuDirigeant, lienDepuisDirigeant, type DirigeantRegistre } from "@/contacts/dirigeants";
import { champsFicheVides, type ContactListe } from "@/contacts/listeContacts";
import type { LienAffiche } from "@/contacts/liensContacts";
import { fr } from "@/lib/fr";

type DirigeantsProposesProps = {
  dirigeants: readonly DirigeantRegistre[];
  contacts: readonly ContactListe[];
  societe?: Pick<ContactListe, "id" | "nom">;
  /** Crée la fiche du dirigeant et son lien vers la société, en une seule écriture locale. */
  onCreer: (contact: ContactListe, dirigeant: DirigeantRegistre) => Promise<void> | void;
  onRelier?: (lien: LienAffiche, dirigeant: DirigeantRegistre) => Promise<void> | void;
};

function libelle(dirigeant: DirigeantRegistre): string {
  if (dirigeant.nature === "morale") {
    return [dirigeant.nom, dirigeant.siren].filter((part) => part !== null && part !== "").join(", ");
  }
  const nom = [dirigeant.prenoms, dirigeant.nom].filter((part) => part !== null && part !== "").join(" ");
  const naissance = dirigeant.naissance === null ? "" : ` (${dirigeant.naissance})`;
  return `${nom}${naissance}`;
}

export function DirigeantsProposes({ dirigeants, contacts, societe, onCreer, onRelier }: DirigeantsProposesProps) {
  const [choix, setChoix] = useState<Record<number, string>>({});
  if (dirigeants.length === 0) return null;
  return (
    <div data-testid="contacts-dirigeants">
      <p className="font-bold">{fr("Dirigeants indiqués par le registre")}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {dirigeants.map((dirigeant, index) => {
          const trouves = fichesDuDirigeant(dirigeant, contacts);
          const etat = choix[index] ?? "";
          return (
            <li key={`${dirigeant.nature}-${dirigeant.nom ?? ""}-${dirigeant.siren ?? ""}`} data-testid="contacts-dirigeant">
              <p>{fr(libelle(dirigeant))}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {trouves.map((fiche) => (
                  <button
                    key={fiche.id}
                    type="button"
                    className="filtre"
                    data-testid="contacts-dirigeant-relier"
                    onClick={() => {
                      const nomAffiche = fiche.prenoms ? `${fiche.prenoms} ${fiche.nom}` : fiche.nom;
                      const poser = () => {
                        setChoix((etatCourant) => ({ ...etatCourant, [index]: `Relié à ${nomAffiche}` }));
                      };
                      if (societe === undefined || onRelier === undefined) {
                        poser();
                        return;
                      }
                      const lien = lienDepuisDirigeant(societe, fiche, dirigeant, crypto.randomUUID());
                      void Promise.resolve(onRelier(lien, dirigeant)).then(poser, (erreur: unknown) => {
                        setChoix((etatCourant) => ({
                          ...etatCourant,
                          [index]: erreur instanceof Error ? erreur.message : "Le lien n'a pas été enregistré.",
                        }));
                      });
                    }}
                  >
                    {fr(`Relier à ${fiche.prenoms ? `${fiche.prenoms} ${fiche.nom}` : fiche.nom}`)}
                  </button>
                ))}
                <button
                  type="button"
                  className="filtre"
                  data-testid="contacts-dirigeant-creer"
                  onClick={() => {
                    const nom = dirigeant.nom?.trim() ?? "";
                    if (nom === "") return;
                    void Promise.resolve(
                      onCreer(
                        {
                          id: crypto.randomUUID(),
                          nature: dirigeant.nature,
                          nom,
                          siren: dirigeant.siren,
                          numeroTva: null,
                          typeClient: dirigeant.nature === "morale" ? "professionnel" : "particulier",
                          professionReglementee: false,
                          ...champsFicheVides(),
                          prenoms: dirigeant.prenoms,
                        },
                        dirigeant,
                      ),
                    ).then(
                      () => {
                        setChoix((etatCourant) => ({ ...etatCourant, [index]: "Fiche créée" }));
                      },
                      (erreur: unknown) => {
                        setChoix((etatCourant) => ({
                          ...etatCourant,
                          [index]: erreur instanceof Error ? erreur.message : "La fiche n'a pas été créée.",
                        }));
                      },
                    );
                  }}
                >
                  {fr("Créer une fiche")}
                </button>
                <button
                  type="button"
                  className="filtre"
                  data-testid="contacts-dirigeant-ignorer"
                  onClick={() => {
                    setChoix((etatCourant) => ({ ...etatCourant, [index]: "Ignoré" }));
                  }}
                >
                  {fr("Ignorer")}
                </button>
              </div>
              {etat !== "" ? (
                <p data-testid="contacts-dirigeant-etat">{fr(etat)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
