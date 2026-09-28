import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { CHEMISE_IDS } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import { ecrireDossier } from "@/dossiers/ecrireDossier";
import { getPowerSyncDatabase } from "@/sync/database";

type UtilisateurLocal = {
  id: string;
  display_name: string | null;
  email: string | null;
};

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

function libelleUtilisateur(utilisateur: UtilisateurLocal): string {
  const nom = utilisateur.display_name?.trim() ?? "";
  if (nom !== "") return nom;
  const email = utilisateur.email?.trim() ?? "";
  if (email !== "") return email;
  return utilisateur.id;
}

export function FormulaireDossier({
  onCree,
}: {
  onCree?: (dossier: {
    id: string;
    nom: string;
    chemise: string;
    reference: string | null;
  }) => void;
} = {}) {
  const [message, setMessage] = useState("");
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurLocal[]>([]);
  const [responsableId, setResponsableId] = useState("");
  const moiId = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);

  useEffect(() => {
    let stop = false;
    void getPowerSyncDatabase()
      .then((database) =>
        database.getAll<UtilisateurLocal>(
          "SELECT id, display_name, email FROM users ORDER BY display_name COLLATE NOCASE, email COLLATE NOCASE",
        ),
      )
      .then((rows) => {
        if (stop) return;
        const moi = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
        setUtilisateurs(rows);
        const defaut =
          moi !== null && rows.some((u) => u.id === moi)
            ? moi
            : (moi ?? rows[0]?.id ?? "");
        setResponsableId(defaut);
      })
      .catch(() => {
        if (!stop) {
          const moi = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
          setUtilisateurs([]);
          setResponsableId(moi ?? "");
        }
      });
    return () => {
      stop = true;
    };
  }, []);

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
    const moi = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
    const responsable =
      champ(form, "responsable_id") || responsableId || moi || "";
    if (responsable === "") {
      setMessage(fr("Identifiant de l’utilisateur connecté introuvable."));
      return;
    }
    try {
      const nom = champ(form, "nom");
      const id = await ecrireDossier({
        nom,
        chemise,
        juridiction: champ(form, "juridiction"),
        numeroRg: champ(form, "numero_rg"),
        partieNom: champ(form, "partie"),
        partieRole: "client",
        restreint: form.get("restreint") === "on",
        responsableId: responsable,
      });
      setMessage(id);
      onCree?.({ id, nom, chemise, reference: null });
      formulaire.reset();
      setResponsableId(responsable);
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
      {utilisateurs.length > 0 ? (
        <>
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="dossier-responsable"
          >
            {fr("Responsable")}
          </label>
          <select
            id="dossier-responsable"
            name="responsable_id"
            data-testid="dossier-responsable"
            required
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            value={responsableId}
            onChange={(event) => {
              setResponsableId(event.target.value);
            }}
          >
            {utilisateurs.map((utilisateur) => (
              <option key={utilisateur.id} value={utilisateur.id}>
                {fr(libelleUtilisateur(utilisateur))}
              </option>
            ))}
          </select>
        </>
      ) : (
        <input type="hidden" name="responsable_id" value={responsableId || moiId || ""} readOnly />
      )}
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
