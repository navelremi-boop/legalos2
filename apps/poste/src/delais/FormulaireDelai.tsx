import { useState } from "react";
import type { SubmitEvent } from "react";
import { calculerEcheance } from "@/delais/moteur";
import { fr } from "@/lib/fr";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

/** Bibliothèque de délais usuels (hypothèses docs/hypotheses-delais.md). */
const BIBLIOTHEQUE = [
  { id: "libre", label: "Saisie libre", jours: 0, mois: 0 },
  { id: "appel", label: "Appel (1 mois)", jours: 0, mois: 1 },
  { id: "opposition", label: "Opposition (1 mois)", jours: 0, mois: 1 },
  { id: "quinze-jours", label: "Délai de 15 jours", jours: 15, mois: 0 },
  { id: "deux-mois", label: "Délai de 2 mois", jours: 0, mois: 2 },
] as const;

type LieuPartie = "metropole" | "outre-mer" | "etranger";

function moisDistancePour(lieu: LieuPartie): number {
  if (lieu === "outre-mer") return 1;
  if (lieu === "etranger") return 2;
  return 0;
}

export function FormulaireDelai() {
  const [echeance, setEcheance] = useState("");
  const [erreur, setErreur] = useState("");
  const [typeId, setTypeId] = useState<(typeof BIBLIOTHEQUE)[number]["id"]>("libre");

  const preset = BIBLIOTHEQUE.find((b) => b.id === typeId) ?? BIBLIOTHEQUE[0];

  function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const origine = champ(form, "origine");
    const lieuBrut = champ(form, "lieu");
    const lieu: LieuPartie =
      lieuBrut === "outre-mer" || lieuBrut === "etranger" ? lieuBrut : "metropole";
    const joursSaisis = Number(champ(form, "jours") || "0");
    const moisSaisis = Number(champ(form, "mois") || "0");
    const jours = typeId === "libre" ? (Number.isFinite(joursSaisis) ? joursSaisis : 0) : preset.jours;
    const mois = typeId === "libre" ? (Number.isFinite(moisSaisis) ? moisSaisis : 0) : preset.mois;
    try {
      setEcheance(
        calculerEcheance({
          origine,
          jours,
          mois,
          moisDistance: moisDistancePour(lieu),
        }),
      );
      setErreur("");
    } catch (err) {
      setEcheance("");
      setErreur(err instanceof Error ? err.message : fr("Calcul impossible."));
    }
  }

  return (
    <form className="mb-8" onSubmit={soumettre} data-testid="formulaire-delai">
      <h2 className="mb-3 text-[length:var(--font-size-section)] font-bold">
        {fr("Calculer un délai")}
      </h2>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-type">
        {fr("Type (bibliothèque)")}
      </label>
      <select
        id="delai-type"
        name="type"
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        value={typeId}
        onChange={(event) => {
          setTypeId(event.target.value as (typeof BIBLIOTHEQUE)[number]["id"]);
        }}
        data-testid="delai-type"
      >
        {BIBLIOTHEQUE.map((item) => (
          <option key={item.id} value={item.id}>
            {fr(item.label)}
          </option>
        ))}
      </select>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-lieu">
        {fr("Lieu où demeure la partie")}
      </label>
      <select
        id="delai-lieu"
        name="lieu"
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        defaultValue="metropole"
        data-testid="delai-lieu"
      >
        <option value="metropole">{fr("Métropole")}</option>
        <option value="outre-mer">{fr("Outre-mer")}</option>
        <option value="etranger">{fr("Étranger")}</option>
      </select>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-origine">
        {fr("Date de l'acte")}
      </label>
      <input
        id="delai-origine"
        name="origine"
        type="date"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
      />
      {typeId === "libre" ? (
        <>
          <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-jours">
            {fr("Jours")}
          </label>
          <input
            id="delai-jours"
            name="jours"
            type="number"
            min={0}
            defaultValue={0}
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
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
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
          />
        </>
      ) : null}
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
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
