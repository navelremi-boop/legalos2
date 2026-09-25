import { useState } from "react";
import type { SubmitEvent } from "react";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { getPowerSyncDatabase } from "@/sync/database";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

type BrouillonLocal = {
  factureId: string;
  minutes: number;
  libelle: string;
  ht: number;
};

/** Une minute saisie vaut 100 centimes. Hypothèse : docs/hypotheses-facturation.md. */
export function FormulaireTemps({ instanceUrl }: { instanceUrl: string }) {
  const [message, setMessage] = useState("");
  const [brouillon, setBrouillon] = useState<BrouillonLocal | null>(null);
  const [cii, setCii] = useState("");

  async function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const form = new FormData(formulaire);
    const minutes = Number(champ(form, "minutes"));
    const libelle = champ(form, "libelle");
    if (!Number.isInteger(minutes) || minutes <= 0 || libelle.length === 0) {
      setMessage(fr("Saisissez une durée et un libellé."));
      return;
    }
    const factureId = crypto.randomUUID();
    const ht = minutes * 100;
    const database = await getPowerSyncDatabase();
    await database.execute(
      `CREATE TABLE IF NOT EXISTS temps_saisis (
        id TEXT PRIMARY KEY,
        minutes INTEGER NOT NULL,
        libelle TEXT NOT NULL
      )`,
    );
    await database.execute(
      `CREATE TABLE IF NOT EXISTS brouillons_facture (
        id TEXT PRIMARY KEY,
        temps_id TEXT NOT NULL,
        numero INTEGER,
        ht_centimes INTEGER NOT NULL,
        libelle TEXT NOT NULL
      )`,
    );
    await database.execute("INSERT INTO temps_saisis (id, minutes, libelle) VALUES (?, ?, ?)", [
      factureId,
      minutes,
      libelle,
    ]);
    await database.execute(
      "INSERT INTO brouillons_facture (id, temps_id, numero, ht_centimes, libelle) VALUES (?, ?, NULL, ?, ?)",
      [factureId, factureId, ht, libelle],
    );
    setBrouillon({ factureId, minutes, libelle, ht });
    setCii("");
    setMessage("sans numéro");
    formulaire.reset();
  }

  async function validerEnLigne() {
    if (!brouillon) {
      setMessage(fr("Enregistrez d'abord le temps hors ligne."));
      return;
    }
    const jeton = loadSessionTokens().accessToken;
    if (!jeton) {
      setMessage(fr("Connexion requise pour valider."));
      return;
    }
    const dossierId = crypto.randomUUID();
    const entetes = {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    };
    const dossier = await fetch(apiUrl(instanceUrl, "/dossiers"), {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        id: dossierId,
        idempotence_cle: `${dossierId}:dossier`,
        nom: "Dossier temps fictif",
        chemise: "kraft",
        juridiction: "TJ de Lyon",
        numero_rg: `RG${String(Date.now()).slice(-6)}`,
        restreint: false,
      }),
    });
    if (!dossier.ok) {
      setMessage(fr("Dossier refusé."));
      return;
    }
    const cree = await fetch(apiUrl(instanceUrl, "/factures"), {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        id: brouillon.factureId,
        dossier_id: dossierId,
        taux_tva_bp: 2000,
        lignes: [
          {
            libelle: brouillon.libelle,
            nature: "honoraires",
            montant_ht_centimes: brouillon.ht,
          },
        ],
      }),
    });
    if (!cree.ok) {
      setMessage(fr("Brouillon refusé."));
      return;
    }
    const validee = await fetch(apiUrl(instanceUrl, `/factures/${brouillon.factureId}/valider`), {
      method: "POST",
      headers: entetes,
    });
    const corps = (await validee.json()) as { numero?: number };
    if (!validee.ok || typeof corps.numero !== "number") {
      setMessage(fr("Validation refusée."));
      return;
    }
    const xml = await fetch(apiUrl(instanceUrl, `/factures/${brouillon.factureId}/cii`), {
      headers: { authorization: `Bearer ${jeton}` },
    });
    const texte = await xml.text();
    if (!xml.ok) {
      setMessage(fr("Factur-X indisponible."));
      return;
    }
    const database = await getPowerSyncDatabase();
    await database.execute("UPDATE brouillons_facture SET numero = ? WHERE id = ?", [
      corps.numero,
      brouillon.factureId,
    ]);
    setCii(texte);
    setMessage(`numéro ${String(corps.numero)}`);
  }

  return (
    <form className="mb-8" onSubmit={(event) => void soumettre(event)}>
      <h2 className="mb-3 text-[length:var(--font-size-section)] font-bold">{fr("Saisir du temps")}</h2>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="temps-minutes">
        {fr("Minutes")}
      </label>
      <input
        id="temps-minutes"
        name="minutes"
        type="number"
        min={1}
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="temps-libelle">
        {fr("Libellé")}
      </label>
      <input
        id="temps-libelle"
        name="libelle"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      >
        {fr("Enregistrer hors ligne")}
      </button>
      <button
        id="valider-facture"
        type="button"
        className="ml-2 rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        onClick={() => void validerEnLigne()}
      >
        {fr("Valider en ligne")}
      </button>
      <p className="mt-2 text-[length:var(--font-size-dense)] text-encre" data-testid="brouillon-hors-ligne">
        {message}
      </p>
      <pre className="sr-only" data-testid="facture-cii">
        {cii}
      </pre>
    </form>
  );
}
