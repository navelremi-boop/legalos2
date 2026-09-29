import { useState } from "react";
import type { SubmitEvent } from "react";
import { ajouterPartie, ecrireContact, lierDossiers } from "@/dossiers/ecrireContact";
import type { NatureContact, RolePartie, TypeClient } from "@/dossiers/ecrireContact";
import { fr } from "@/lib/fr";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

const ROLES: RolePartie[] = ["client", "adversaire", "confrere"];
const NATURES: NatureContact[] = ["physique", "morale"];
const TYPES: TypeClient[] = ["professionnel", "particulier", "etranger"];

export function CompleterDossier({ dossierId }: { dossierId: string }) {
  const [message, setMessage] = useState("");

  async function ajouter(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = champ(form, "role");
    const nom = champ(form, "nom");
    if (role !== "client" && role !== "adversaire" && role !== "confrere") {
      setMessage(fr("Rôle de partie inconnu."));
      return;
    }
    try {
      let contactId: string | undefined;
      const contactNom = champ(form, "contact_nom");
      if (contactNom !== "") {
        const nature = champ(form, "nature");
        const typeClient = champ(form, "type_client");
        if (nature !== "physique" && nature !== "morale") {
          setMessage(fr("Nature de contact inconnue."));
          return;
        }
        if (
          typeClient !== "professionnel" &&
          typeClient !== "particulier" &&
          typeClient !== "etranger"
        ) {
          setMessage(fr("Type de client inconnu."));
          return;
        }
        contactId = await ecrireContact({
          nature,
          nom: contactNom,
          siren: champ(form, "siren"),
          numeroTva: champ(form, "numero_tva"),
          typeClient,
        });
      }
      await ajouterPartie(dossierId, role, nom, contactId);
      setMessage(fr("Partie enregistrée."));
      event.currentTarget.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Enregistrement impossible."));
    }
  }

  async function lier(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cible = champ(new FormData(event.currentTarget), "lie_a_id");
    try {
      await lierDossiers(dossierId, cible);
      setMessage(fr("Dossiers liés."));
      event.currentTarget.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Lien impossible."));
    }
  }

  return (
    <div className="mt-4" data-testid="completer-dossier">
      <form onSubmit={(event) => void ajouter(event)}>
        <label className="text-[length:var(--font-size-dense)] text-sur-chemise" htmlFor="partie-role">
          {fr("Rôle")}
        </label>
        <select
          id="partie-role"
          name="role"
          data-testid="partie-role"
          className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="adversaire"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {fr(role === "confrere" ? "confrère" : role)}
            </option>
          ))}
        </select>
        <input
          name="nom"
          required
          data-testid="partie-nom"
          placeholder={fr("Nom de la partie")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <select
          name="nature"
          data-testid="contact-nature"
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="morale"
        >
          {NATURES.map((nature) => (
            <option key={nature} value={nature}>
              {fr(nature === "physique" ? "personne physique" : "personne morale")}
            </option>
          ))}
        </select>
        <input
          name="contact_nom"
          data-testid="contact-nom"
          placeholder={fr("Contact (facultatif)")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          name="siren"
          data-testid="contact-siren"
          placeholder={fr("SIREN")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          name="numero_tva"
          data-testid="contact-tva"
          placeholder={fr("N° TVA")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <select
          name="type_client"
          data-testid="contact-type"
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="professionnel"
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {fr(type)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          data-testid="partie-ajouter"
          className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        >
          {fr("Ajouter la partie")}
        </button>
      </form>
      <form className="mt-3" onSubmit={(event) => void lier(event)}>
        <input
          name="lie_a_id"
          required
          data-testid="lien-cible"
          placeholder={fr("Identifiant du dossier lié")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <button
          type="submit"
          data-testid="lien-ajouter"
          className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        >
          {fr("Lier les dossiers")}
        </button>
      </form>
      <p className="mt-2 text-[length:var(--font-size-meta)] text-sur-chemise" data-testid="completer-message">
        {message}
      </p>
    </div>
  );
}
