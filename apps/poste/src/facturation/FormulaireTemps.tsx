import { useEffect, useRef, useState } from "react";
import { formatMontant } from "@/lib/format";
import { lireDuree } from "@/facturation/lireDuree";
import type { SubmitEvent } from "react";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import {
  centimesDepuisEuros,
  enregistrerTemps,
  eurosDepuisCentimes,
  htTempsCentimes,
  tauxHoraireParDefaut,
} from "@/facturation/ecrireTemps";
import { getPowerSyncDatabase } from "@/sync/database";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
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
export function FormulaireTemps({
  instanceUrl,
  dossierIdPrefere,
}: {
  instanceUrl: string;
  /** Pré-sélectionne le dossier ouvert (barre d'actions / chronomètre). */
  dossierIdPrefere?: string | null;
}) {
  const [message, setMessage] = useState("");
  const [brouillon, setBrouillon] = useState<BrouillonLocal | null>(null);
  const [cii, setCii] = useState("");
  const [dossiers, setDossiers] = useState<DossierOption[]>([]);
  const [tauxSuggere, setTauxSuggere] = useState(6_000);
  const [dossierChoisi, setDossierChoisi] = useState(dossierIdPrefere ?? "");
  const [apercu, setApercu] = useState<{ minutes: number | null; ht: number | null; taux: number } | null>({
    minutes: null,
    ht: null,
    taux: 6_000,
  });
  const tauxTouche = useRef(false);

  function relireApercu(formulaire: HTMLFormElement) {
    tauxTouche.current = true;
    const donnees = new FormData(formulaire);
    const saisie = donnees.get("minutes");
    const minutes = lireDuree(typeof saisie === "string" ? saisie : "");
    const tauxBrut = donnees.get("taux_euros");
    const taux = centimesDepuisEuros(typeof tauxBrut === "string" ? tauxBrut : "");
    if (taux === null) {
      setApercu(null);
      return;
    }
    setApercu({
      minutes,
      ht: minutes === null ? null : htTempsCentimes(minutes, taux),
      taux,
    });
  }

  useEffect(() => {
    let annule = false;
    async function charger() {
      const database = await getPowerSyncDatabase();
      const lignes = await database.getAll<DossierOption>(
        "SELECT id, nom FROM dossiers ORDER BY nom COLLATE NOCASE",
      );
      if (!annule) setDossiers(lignes);
      const taux = await tauxHoraireParDefaut(database);
      if (!annule && !tauxTouche.current) {
        setTauxSuggere(taux);
        setApercu({ minutes: null, ht: null, taux });
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

  const dossierSelect =
    dossiers.length === 0
      ? dossierChoisi || dossierIdPrefere || ""
      : dossiers.some((d) => d.id === dossierChoisi)
        ? dossierChoisi
        : dossierIdPrefere && dossiers.some((d) => d.id === dossierIdPrefere)
          ? dossierIdPrefere
          : "";

  async function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const form = new FormData(formulaire);
    const minutes = lireDuree(champ(form, "minutes"));
    const libelle = champ(form, "libelle");
    const dossierId = champ(form, "dossier_id");
    const taux = centimesDepuisEuros(champ(form, "taux_euros"));
    if (minutes === null || libelle.length === 0) {
      setMessage(fr("Saisissez une durée et un libellé."));
      return;
    }
    if (dossierId.length === 0) {
      setMessage(fr("Choisissez un dossier existant."));
      return;
    }
    if (taux === null) {
      setMessage(fr("Indiquez un taux horaire en euros par heure."));
      return;
    }
    const existe = dossiers.some((d) => d.id === dossierId);
    if (!existe) {
      setMessage(fr("Dossier introuvable dans la base locale."));
      return;
    }
    const ht = htTempsCentimes(minutes, taux);
    if (ht <= 0) {
      setMessage(fr("Montant calculé nul."));
      return;
    }
    const database = await getPowerSyncDatabase();
    const ecrit = await enregistrerTemps(database, { dossierId, minutes, libelle, tauxCentimesHeure: taux });
    if (!ecrit.ok) {
      setMessage(fr(ecrit.message));
      return;
    }
    const { factureId, tempsId } = ecrit;
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
    const jeton = await assurerJetonAcces();
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
      if (texte.includes("Dossier introuvable") || cree.status === 400 || cree.status === 404) {
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
    <form
      className="mb-8"
      onSubmit={(event) => void soumettre(event)}
      onInput={(event) => {
        relireApercu(event.currentTarget);
      }}
    >
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
        value={dossierSelect}
        onChange={(event) => {
          setDossierChoisi(event.target.value);
        }}
      >
        <option value="">{fr("Choisir un dossier")}</option>
        {dossiers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nom}
          </option>
        ))}
      </select>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="temps-minutes">
        {fr("Durée")}
      </label>
      <input
        id="temps-minutes"
        name="minutes"
        type="text"
        required
        placeholder={fr("1 h 30, 45 min ou 0,75")}
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      />
      <label
        className="text-[length:var(--font-size-dense)] text-graphite"
        htmlFor="temps-taux"
      >
        {fr("Taux horaire, euros par heure")}
      </label>
      <input
        key={tauxSuggere}
        id="temps-taux"
        name="taux_euros"
        type="text"
        inputMode="decimal"
        required
        placeholder={fr("60 ou 60,50")}
        defaultValue={eurosDepuisCentimes(tauxSuggere)}
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
      {apercu !== null ? (
        <p className="mb-3 text-encre" data-testid="temps-apercu">
          {apercu.minutes !== null && apercu.ht !== null
            ? fr(
                `${String(apercu.minutes)} min, ${formatMontant(apercu.ht)}, taux ${formatMontant(apercu.taux)} par heure`,
              )
            : fr(`Taux ${formatMontant(apercu.taux)} par heure`)}
        </p>
      ) : null}
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
      >
        {fr("Enregistrer")}
      </button>
      {brouillon !== null ? (
        <button
          id="valider-facture"
          type="button"
          className="ml-2 rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          onClick={() => void validerEnLigne()}
        >
          {fr("Valider")}
        </button>
      ) : null}
      <p className="mt-2 text-[length:var(--font-size-dense)] text-encre" data-testid="brouillon-hors-ligne">
        {message}
      </p>
      <pre className="sr-only" data-testid="facture-cii">
        {cii}
      </pre>
    </form>
  );
}
