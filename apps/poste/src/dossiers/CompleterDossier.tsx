import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { ajouterPartie, ecrireContact, lierDossiers } from "@/dossiers/ecrireContact";
import type { NatureContact, RolePartie, TypeClient } from "@/dossiers/ecrireContact";
import { majusculeInitiale } from "@/dossiers/majusculeInitiale";
import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { getPowerSyncDatabase } from "@/sync/database";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

const ROLES: RolePartie[] = ["client", "adversaire", "confrere"];
const NATURES: NatureContact[] = ["physique", "morale"];
const TYPES: TypeClient[] = ["professionnel", "particulier", "etranger"];

const LIBELLE_ROLE: Record<RolePartie, string> = {
  client: "Client",
  adversaire: "Adversaire",
  confrere: "Confrère",
};

type DossierLien = { id: string; nom: string; reference: string | null };

export function CompleterDossier({ dossierId }: { dossierId: string }) {
  const [message, setMessage] = useState("");
  const [ouvert, setOuvert] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [dossiers, setDossiers] = useState<DossierLien[]>([]);
  const [choisiId, setChoisiId] = useState("");

  useEffect(() => {
    let stop = false;
    void getPowerSyncDatabase()
      .then((database) =>
        database.getAll<DossierLien>("SELECT id, nom, reference FROM dossiers ORDER BY nom"),
      )
      .then((lignes) => {
        if (!stop) setDossiers(lignes);
      })
      .catch(() => {
        if (!stop) setDossiers([]);
      });
    return () => {
      stop = true;
    };
  }, []);

  const trouves = dossiers.filter((ligne) => {
    if (ligne.id === dossierId || recherche.trim() === "") return false;
    const texte = `${ligne.nom} ${ligne.reference ?? ""}`.toLocaleLowerCase("fr-FR");
    return texte.includes(recherche.trim().toLocaleLowerCase("fr-FR"));
  });

  async function ajouter(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = champ(form, "role");
    const nom = majusculeInitiale(champ(form, "nom"));
    if (role !== "client" && role !== "adversaire" && role !== "confrere") {
      setMessage(fr("Rôle de partie inconnu."));
      return;
    }
    try {
      let contactId: string | undefined;
      const contactNom = majusculeInitiale(champ(form, "contact_nom"));
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
    const cible = champ(new FormData(event.currentTarget), "lie_a_id") || choisiId;
    if (cible === "") {
      setMessage(fr("Choisissez un dossier par son nom ou sa référence."));
      return;
    }
    try {
      await lierDossiers(dossierId, cible);
      setMessage(fr("Dossiers liés."));
      setRecherche("");
      setChoisiId("");
      event.currentTarget.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Lien impossible."));
    }
  }

  return (
    <aside
      className="mt-4 max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille p-4 text-encre"
      data-testid="panneau-parties"
    >
      <button
        type="button"
        className="font-extrabold"
        data-testid="panneau-parties-ouvrir"
        aria-expanded={ouvert}
        onClick={() => {
          setOuvert((actuel) => !actuel);
        }}
      >
        {fr("Parties et dossiers liés")}
      </button>
      {ouvert ? (
        <div className="mt-3" data-testid="completer-dossier">
          <form onSubmit={(event) => void ajouter(event)}>
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="partie-role">
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
                  {fr(LIBELLE_ROLE[role])}
                </option>
              ))}
            </select>
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="partie-nom">
              {fr("Nom de la partie")}
            </label>
            <input
              id="partie-nom"
              name="nom"
              required
              data-testid="partie-nom"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            />
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="contact-nature">
              {fr("Nature")}
            </label>
            <select
              id="contact-nature"
              name="nature"
              data-testid="contact-nature"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
              defaultValue="morale"
            >
              {NATURES.map((nature) => (
                <option key={nature} value={nature}>
                  {fr(nature === "physique" ? "Personne physique" : "Personne morale")}
                </option>
              ))}
            </select>
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="contact-nom">
              {fr("Contact")}
            </label>
            <input
              id="contact-nom"
              name="contact_nom"
              data-testid="contact-nom"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            />
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="contact-siren">
              {fr("SIREN")}
            </label>
            <input
              id="contact-siren"
              name="siren"
              data-testid="contact-siren"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            />
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="contact-tva">
              {fr("Numéro de TVA")}
            </label>
            <input
              id="contact-tva"
              name="numero_tva"
              data-testid="contact-tva"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            />
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="contact-type">
              {fr("Type de client")}
            </label>
            <select
              id="contact-type"
              name="type_client"
              data-testid="contact-type"
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
              defaultValue="professionnel"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {fr(type === "etranger" ? "Étranger" : majusculeInitiale(type))}
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
            <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="lien-recherche">
              {fr("Dossier lié")}
            </label>
            <input
              id="lien-recherche"
              data-testid="lien-recherche"
              value={recherche}
              className="mt-1 mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
              onChange={(event) => {
                setRecherche(event.target.value);
                setChoisiId("");
              }}
            />
            <input
              id="lien-cible"
              name="lie_a_id"
              type="hidden"
              data-testid="lien-cible"
              value={choisiId}
              onChange={(event) => {
                setChoisiId(event.target.value);
              }}
            />
            <ul data-testid="lien-resultats">
              {trouves.slice(0, 8).map((ligne) => (
                <li key={ligne.id}>
                  <button
                    type="button"
                    className="block w-full py-1 text-left"
                    data-testid="lien-resultat"
                    onClick={() => {
                      setChoisiId(ligne.id);
                      setRecherche(ligne.nom);
                    }}
                  >
                    {fr(
                      `${majusculeInitiale(ligne.nom)}${ligne.reference ? `, ${libelleReferenceDossier(ligne.reference)}` : ""}`,
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="submit"
              data-testid="lien-ajouter"
              className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            >
              {fr("Lier les dossiers")}
            </button>
          </form>
          <p className="mt-2 text-[length:var(--font-size-meta)] text-graphite" data-testid="completer-message">
            {message}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
