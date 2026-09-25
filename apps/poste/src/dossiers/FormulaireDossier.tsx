import { useState } from "react";
import type { SubmitEvent } from "react";
import { CHEMISE_IDS } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { ecrireDossier } from "@/dossiers/ecrireDossier";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

export function FormulaireDossier() {
  const [message, setMessage] = useState("");

  async function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const form = new FormData(formulaire);
    const chemise = champ(form, "chemise");
    if (
      chemise !== "kraft" &&
      chemise !== "bleu-classeur" &&
      chemise !== "vert-amande" &&
      chemise !== "jaune-paille" &&
      chemise !== "rose-buvard" &&
      chemise !== "lilas" &&
      chemise !== "vert-eau" &&
      chemise !== "gris-perle"
    ) {
      setMessage(fr("Choisissez une couleur de chemise."));
      return;
    }
    try {
      const id = await ecrireDossier({
        nom: champ(form, "nom"),
        chemise,
        juridiction: champ(form, "juridiction"),
        numeroRg: champ(form, "numero_rg"),
        partieNom: champ(form, "partie"),
        partieRole: "client",
        restreint: form.get("restreint") === "on",
      });
      setMessage(id);
      formulaire.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Enregistrement impossible."));
    }
  }

  return (
    <form className="mb-8" onSubmit={(event) => void soumettre(event)}>
      <h2 className="mb-3 text-[length:var(--font-size-section)] font-bold">{fr("Nouveau dossier")}</h2>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="dossier-nom">
        {fr("Nom du dossier")}
      </label>
      <input
        id="dossier-nom"
        name="nom"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="dossier-chemise">
        {fr("Couleur de chemise")}
      </label>
      <select
        id="dossier-chemise"
        name="chemise"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        defaultValue="bleu-classeur"
      >
        {CHEMISE_IDS.map((id) => (
          <option key={id} value={id}>
            {fr(id.replace(/-/g, " "))}
          </option>
        ))}
      </select>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="dossier-juridiction">
        {fr("Juridiction")}
      </label>
      <input
        id="dossier-juridiction"
        name="juridiction"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="dossier-rg">
        {fr("Numéro RG")}
      </label>
      <input
        id="dossier-rg"
        name="numero_rg"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="dossier-partie">
        {fr("Partie cliente")}
      </label>
      <input
        id="dossier-partie"
        name="partie"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="mb-3 flex items-center gap-2 text-[length:var(--font-size-dense)] text-encre">
        <input id="dossier-restreint" name="restreint" type="checkbox" />
        {fr("Dossier restreint")}
      </label>
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      >
        {fr("Créer le dossier")}
      </button>
      <p className="mt-2 text-[length:var(--font-size-meta)] text-graphite" data-testid="dossier-cree">
        {message}
      </p>
    </form>
  );
}
