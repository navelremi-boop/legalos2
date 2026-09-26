import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { getPowerSyncDatabase } from "@/sync/database";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

/** HT = (minutes × taux_centimes_heure) / 60. Hypothèse F0. */
export function htTempsCentimes(minutes: number, tauxCentimesHeure: number): number {
  return Math.trunc((minutes * tauxCentimesHeure) / 60);
}

type DossierOption = { id: string; nom: string };

type BrouillonLocal = {
  factureId: string;
  tempsId: string;
  dossierId: string;
  minutes: number;
  libelle: string;
  ht: number;
  taux: number;
};

/**
 * Saisie de temps hors ligne sur un dossier existant.
 * Le numéro de facture reste nul jusqu'à la validation serveur.
 */
export function FormulaireTemps({ instanceUrl }: { instanceUrl: string }) {
  const [message, setMessage] = useState("");
  const [brouillon, setBrouillon] = useState<BrouillonLocal | null>(null);
  const [cii, setCii] = useState("");
  const [dossiers, setDossiers] = useState<DossierOption[]>([]);
  const [tauxSuggere, setTauxSuggere] = useState(6_000);

  useEffect(() => {
    let annule = false;
    async function charger() {
      const database = await getPowerSyncDatabase();
      const lignes = await database.getAll<DossierOption>(
        "SELECT id, nom FROM dossiers ORDER BY nom COLLATE NOCASE",
      );
      if (!annule) setDossiers(lignes);
      const taux = await database.getAll<{ centimes_par_heure: number }>(
        `SELECT centimes_par_heure FROM taux_horaires
         WHERE dossier_id IS NULL OR dossier_id = ''
         ORDER BY cree_le DESC LIMIT 1`,
      );
      const premier = taux[0]?.centimes_par_heure;
      if (!annule && typeof premier === "number" && premier > 0) {
        setTauxSuggere(premier);
      }
    }
    void charger();
    const timer = window.setInterval(() => {
      void charger();
    }, 800);
    return () => {
      annule = true;
      window.clearInterval(timer);
    };
  }, []);

  async function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const form = new FormData(formulaire);
    const minutes = Number(champ(form, "minutes"));
    const libelle = champ(form, "libelle");
    const dossierId = champ(form, "dossier_id");
    const taux = Number(champ(form, "taux_centimes_heure"));
    if (!Number.isInteger(minutes) || minutes <= 0 || libelle.length === 0) {
      setMessage(fr("Saisissez une durée et un libellé."));
      return;
    }
    if (dossierId.length === 0) {
      setMessage(fr("Choisissez un dossier existant."));
      return;
    }
    if (!Number.isInteger(taux) || taux <= 0) {
      setMessage(fr("Indiquez un taux horaire en centimes."));
      return;
    }
    const existe = dossiers.some((d) => d.id === dossierId);
    if (!existe) {
      setMessage(fr("Dossier introuvable dans la base locale."));
      return;
    }
    const factureId = crypto.randomUUID();
    const tempsId = crypto.randomUUID();
    const ht = htTempsCentimes(minutes, taux);
    if (ht <= 0) {
      setMessage(fr("Montant calculé nul."));
      return;
    }
    const database = await getPowerSyncDatabase();
    const cabinets = await database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
    const cabinetId = cabinets[0]?.id;
    if (!cabinetId) {
      setMessage(fr("Aucun cabinet synchronisé."));
      return;
    }
    const users = await database.getAll<{ id: string }>("SELECT id FROM users LIMIT 1");
    const intervenantId = users[0]?.id ?? cabinetId;
    const creeLe = new Date().toISOString();
    const dossierRows = await database.getAll<{ restreint: number }>(
      "SELECT restreint FROM dossiers WHERE id = ?",
      [dossierId],
    );
    const dossier = dossierRows[0];
    const visibilite = dossier?.restreint ? "restreint" : "public";
    await database.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO temps_saisis (
          id, cabinet_id, dossier_id, intervenant_id, minutes, libelle,
          taux_centimes_heure, ht_centimes, visibilite, cree_le
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tempsId,
          cabinetId,
          dossierId,
          intervenantId,
          minutes,
          libelle,
          taux,
          ht,
          visibilite,
          creeLe,
        ],
      );
      await tx.execute(
        `INSERT INTO brouillons_facture (
          id, cabinet_id, dossier_id, temps_id, numero, ht_centimes, libelle,
          intervenant_id, taux_centimes_heure, visibilite, cree_le
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          factureId,
          cabinetId,
          dossierId,
          tempsId,
          ht,
          libelle,
          intervenantId,
          taux,
          visibilite,
          creeLe,
        ],
      );
    });
    setBrouillon({ factureId, tempsId, dossierId, minutes, libelle, ht, taux });
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
    const entetes = {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    };
    // Pas de création de dossier : le serveur refuse si le dossier est absent.
    const cree = await fetch(apiUrl(instanceUrl, "/factures"), {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        id: brouillon.factureId,
        dossier_id: brouillon.dossierId,
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
      const texte = await cree.text();
      if (texte.includes("Dossier introuvable") || cree.status === 400) {
        setMessage(fr("Dossier introuvable — validation refusée."));
        return;
      }
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
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="temps-dossier">
        {fr("Dossier")}
      </label>
      <select
        id="temps-dossier"
        name="dossier_id"
        required
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        data-testid="temps-dossier"
      >
        <option value="">{fr("Choisir un dossier")}</option>
        {dossiers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nom}
          </option>
        ))}
      </select>
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
      <label
        className="text-[length:var(--font-size-dense)] text-graphite"
        htmlFor="temps-taux"
      >
        {fr("Taux horaire (centimes)")}
      </label>
      <input
        id="temps-taux"
        name="taux_centimes_heure"
        type="number"
        min={1}
        required
        defaultValue={tauxSuggere}
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
