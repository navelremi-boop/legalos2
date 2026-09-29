import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { ecrireElementAgenda, type TypeAgenda } from "@/agenda/ecrireAgenda";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type Ligne = {
  id: string;
  dossier_id: string;
  type_element: string;
  titre: string;
  debut: string;
  rappel_le: string | null;
};

const TYPES: TypeAgenda[] = ["audience", "rendez_vous", "tache"];

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

export function EcranAgenda() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let stop = false;
    const charger = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<Ligne>(
            `SELECT id, dossier_id, type_element, titre, debut, rappel_le
             FROM agenda_elements ORDER BY debut ASC`,
          ),
        )
        .then((rows) => {
          if (!stop) setLignes(rows);
        })
        .catch(() => {
          if (!stop) setLignes([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 1_500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  async function ajouter(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typeElement = champ(form, "type_element");
    if (typeElement !== "audience" && typeElement !== "rendez_vous" && typeElement !== "tache") {
      setMessage(fr("Type d'agenda inconnu."));
      return;
    }
    try {
      await ecrireElementAgenda({
        dossierId: champ(form, "dossier_id"),
        typeElement,
        titre: champ(form, "titre"),
        debut: champ(form, "debut"),
        rappelLe: champ(form, "rappel_le"),
      });
      setMessage(fr("Élément inscrit à l'agenda."));
      event.currentTarget.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Enregistrement impossible."));
    }
  }

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]" data-testid="ecran-agenda">
      <h1 className="mb-4 text-[length:var(--font-size-section)] font-bold">{fr("Agenda")}</h1>
      <form className="mb-6 max-w-xl" onSubmit={(event) => void ajouter(event)}>
        <select
          id="agenda-type"
          name="type_element"
          data-testid="agenda-type"
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="audience"
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {fr(type === "rendez_vous" ? "rendez-vous" : type === "tache" ? "tâche" : "audience")}
            </option>
          ))}
        </select>
        <input
          id="agenda-dossier"
          name="dossier_id"
          required
          data-testid="agenda-dossier"
          placeholder={fr("Dossier")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-titre"
          name="titre"
          required
          data-testid="agenda-titre"
          placeholder={fr("Titre")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-debut"
          name="debut"
          required
          data-testid="agenda-debut"
          placeholder={fr("Début")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-rappel"
          name="rappel_le"
          data-testid="agenda-rappel"
          placeholder={fr("Rappel")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <button
          type="submit"
          data-testid="agenda-ajouter"
          className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        >
          {fr("Ajouter")}
        </button>
        <p className="mt-2 text-[length:var(--font-size-meta)] text-graphite" data-testid="agenda-message">
          {message}
        </p>
      </form>
      <ul data-testid="agenda-liste">
        {lignes.map((ligne) => (
          <li key={ligne.id} data-testid="agenda-element" data-type={ligne.type_element} data-dossier-id={ligne.dossier_id}>
            {fr(`${ligne.type_element} — ${ligne.titre} — ${ligne.debut}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
