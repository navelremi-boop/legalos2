import { useState } from "react";
import { fichesDuDirigeant, type DirigeantRegistre } from "@/contacts/dirigeants";
import { champsFicheVides, type ContactListe } from "@/contacts/listeContacts";
import { fr } from "@/lib/fr";

type DirigeantsProposesProps = {
  dirigeants: readonly DirigeantRegistre[];
  contacts: readonly ContactListe[];
  onCreer: (contact: ContactListe) => void;
};

function libelle(dirigeant: DirigeantRegistre): string {
  if (dirigeant.nature === "morale") {
    return [dirigeant.nom, dirigeant.siren].filter((part) => part !== null && part !== "").join(", ");
  }
  const nom = [dirigeant.prenoms, dirigeant.nom].filter((part) => part !== null && part !== "").join(" ");
  const naissance = dirigeant.naissance === null ? "" : ` (${dirigeant.naissance})`;
  return `${nom}${naissance}`;
}

export function DirigeantsProposes({ dirigeants, contacts, onCreer }: DirigeantsProposesProps) {
  const [choix, setChoix] = useState<Record<number, string>>({});
  if (dirigeants.length === 0) return null;
  return (
    <div data-testid="contacts-dirigeants">
      <p className="font-bold">{fr("Dirigeants du registre")}</p>
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
                      setChoix((etatCourant) => ({ ...etatCourant, [index]: `Relié à ${fiche.prenoms ? `${fiche.prenoms} ` : ""}${fiche.nom}` }));
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
                    onCreer({
                      id: crypto.randomUUID(),
                      nature: dirigeant.nature,
                      nom,
                      siren: dirigeant.siren,
                      numeroTva: null,
                      typeClient: dirigeant.nature === "morale" ? "professionnel" : "particulier",
                      professionReglementee: false,
                      ...champsFicheVides(),
                      prenoms: dirigeant.prenoms,
                    });
                    setChoix((etatCourant) => ({ ...etatCourant, [index]: "Fiche créée" }));
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
