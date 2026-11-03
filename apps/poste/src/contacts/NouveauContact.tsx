import { IconBuilding, IconUser } from "@tabler/icons-react";
import { CreationPersonne } from "@/contacts/CreationPersonne";
import { CreationSociete } from "@/contacts/CreationSociete";
import { libelleNatureCreation, NATURES_CREATION, type NatureCreation } from "@/contacts/creationContact";
import type { ContactListe } from "@/contacts/listeContacts";
import type { PropositionSiren } from "@/contacts/propositionSiren";
import { fr } from "@/lib/fr";

type NouveauContactProps = {
  nature: NatureCreation;
  focusSiren: boolean;
  horsLigne: boolean;
  instanceUrl?: string;
  propositionFixe: PropositionSiren | null;
  contacts: readonly ContactListe[];
  onNature: (nature: NatureCreation) => void;
  onCreee: (contact: ContactListe) => void;
  onDirigeantCree: (contact: ContactListe) => void;
  onOuvrir: (id: string) => void;
  onAnnuler: () => void;
};

/**
 * Création d'un contact dans la zone de la fiche (maquette `prototype-contacts.html`) : étiquette
 * « Nouveau contact », bascule personne morale / personne physique, puis le formulaire de la nature.
 */
export function NouveauContact({
  nature,
  focusSiren,
  horsLigne,
  instanceUrl,
  propositionFixe,
  contacts,
  onNature,
  onCreee,
  onDirigeantCree,
  onOuvrir,
  onAnnuler,
}: NouveauContactProps) {
  return (
    <div
      className="contacts-nc"
      data-testid="contacts-nouveau-contact"
      onKeyDown={(event) => {
        if (event.key === "Escape") onAnnuler();
      }}
    >
      <div className="contacts-fi-tete">
        <div className="contacts-etq">
          <div className="contacts-etq__nat">
            {nature === "morale" ? (
              <IconBuilding size={13} stroke={1.8} aria-hidden />
            ) : (
              <IconUser size={13} stroke={1.8} aria-hidden />
            )}
            {fr(libelleNatureCreation(nature))}
          </div>
          <h2 className="contacts-etq__nom">{fr("Nouveau contact")}</h2>
          <p className="contacts-etq__sous">{fr("La fiche rejoint l'annuaire commun du cabinet.")}</p>
        </div>
      </div>
      <div className="contacts-nc__corps">
        <div className="segment mb-3" role="group" aria-label={fr("Nature")}>
          {NATURES_CREATION.map((entree) => (
            <button
              key={entree.nature}
              type="button"
              aria-pressed={nature === entree.nature}
              data-testid={`contacts-creation-nature-${entree.nature}`}
              onClick={() => {
                onNature(entree.nature);
              }}
            >
              {fr(entree.libelle)}
            </button>
          ))}
        </div>
        {nature === "morale" ? (
          <CreationSociete
            horsLigne={horsLigne}
            instanceUrl={instanceUrl}
            propositionFixe={propositionFixe}
            contacts={contacts}
            focusSiren={focusSiren}
            onCreee={onCreee}
            onDirigeantCree={onDirigeantCree}
            onOuvrir={onOuvrir}
            onAnnuler={onAnnuler}
          />
        ) : (
          <CreationPersonne
            instanceUrl={instanceUrl}
            local={propositionFixe !== null}
            onCreee={onCreee}
            onAnnuler={onAnnuler}
          />
        )}
      </div>
    </div>
  );
}
