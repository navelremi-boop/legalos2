import { useState } from "react";
import type { SubmitEvent } from "react";
import { calculerEcheance } from "@/delais/moteur";
import { fr } from "@/lib/fr";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

export function FormulaireDelai() {
  const [echeance, setEcheance] = useState("");
  const [erreur, setErreur] = useState("");

  function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const origine = champ(form, "origine");
    const jours = Number(champ(form, "jours") || "0");
    const mois = Number(champ(form, "mois") || "0");
    const moisDistance = Number(champ(form, "distance") || "0");
    try {
      setEcheance(
        calculerEcheance({
          origine,
          jours: Number.isFinite(jours) ? jours : 0,
          mois: Number.isFinite(mois) ? mois : 0,
          moisDistance: Number.isFinite(moisDistance) ? moisDistance : 0,
        }),
      );
      setErreur("");
    } catch (err) {
      setEcheance("");
      setErreur(err instanceof Error ? err.message : fr("Calcul impossible."));
    }
  }

  return (
    <form className="mb-8" onSubmit={soumettre}>
      <h2 className="mb-3 text-[length:var(--font-size-section)] font-bold">
        {fr("Calculer un délai")}
      </h2>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-origine">
        {fr("Date de l'acte")}
      </label>
      <input
        id="delai-origine"
        name="origine"
        type="date"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-jours">
        {fr("Jours")}
      </label>
      <input
        id="delai-jours"
        name="jours"
        type="number"
        min={0}
        defaultValue={0}
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-mois">
        {fr("Mois")}
      </label>
      <input
        id="delai-mois"
        name="mois"
        type="number"
        min={0}
        defaultValue={0}
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-distance">
        {fr("Mois de distance")}
      </label>
      <input
        id="delai-distance"
        name="distance"
        type="number"
        min={0}
        max={2}
        defaultValue={0}
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      >
        {fr("Calculer l'échéance")}
      </button>
      <p className="mt-2 text-[length:var(--font-size-dense)] text-encre" data-testid="delai-echeance">
        {echeance}
      </p>
      {erreur !== "" ? <p className="mt-1 text-[length:var(--font-size-meta)] text-echeance">{erreur}</p> : null}
    </form>
  );
}
