import { useState } from "react";
import type { SubmitEvent } from "react";
import {
  BIBLIOTHEQUE_DELAIS,
  calculerDelaiComplet,
  type LieuPartie,
  type SiegeJuridiction,
} from "@/delais/moteur";
import { ecrireElementAgenda } from "@/agenda/ecrireAgenda";
import { formatDateLongue } from "@/lib/format";
import { fr } from "@/lib/fr";

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

type TypeId = (typeof BIBLIOTHEQUE_DELAIS)[number]["id"];

export function FormulaireDelai({ dossierId }: { dossierId?: string | null } = {}) {
  const [echeance, setEcheance] = useState("");
  const [augmentation, setAugmentation] = useState("");
  const [erreur, setErreur] = useState("");
  const [inscrit, setInscrit] = useState("");
  const [origineRetenue, setOrigineRetenue] = useState("");
  const [dureeRetenue, setDureeRetenue] = useState({ jours: 0, mois: 0, annees: 0 });
  const [typeId, setTypeId] = useState<TypeId>("libre");
  const [siege, setSiege] = useState<SiegeJuridiction>("metropole");
  const [lieu, setLieu] = useState<LieuPartie>("metropole");

  const preset =
    BIBLIOTHEQUE_DELAIS.find((b) => b.id === typeId) ??
    BIBLIOTHEQUE_DELAIS[0] ??
    ({
      id: "libre",
      label: "Saisie libre",
      jours: 0,
      mois: 0,
      annees: 0,
      augmentationDistance: "oui" as const,
      source: "",
    } satisfies (typeof BIBLIOTHEQUE_DELAIS)[number]);

  function soumettre(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const origine = champ(form, "origine");
    const departementSiege = champ(form, "departementSiege");
    const departement = champ(form, "departement");
    const dateExpedition = champ(form, "dateExpedition");
    const dateRemise = champ(form, "dateRemise");
    const roleBrut = champ(form, "rolePartie");
    const rolePartie =
      roleBrut === "expediteur" || roleBrut === "destinataire" ? roleBrut : undefined;
    const joursSaisis = Number(champ(form, "jours") || "0");
    const moisSaisis = Number(champ(form, "mois") || "0");
    const anneesSaisis = Number(champ(form, "annees") || "0");
    const jours = typeId === "libre" ? (Number.isFinite(joursSaisis) ? joursSaisis : 0) : preset.jours;
    const mois = typeId === "libre" ? (Number.isFinite(moisSaisis) ? moisSaisis : 0) : preset.mois;
    const annees =
      typeId === "libre" ? (Number.isFinite(anneesSaisis) ? anneesSaisis : 0) : preset.annees;
    try {
      const resultat = calculerDelaiComplet({
        origine,
        jours,
        mois,
        annees,
        siegeJuridiction: siege,
        departementSiege: siege === "collectivite-644" ? departementSiege : undefined,
        lieuPartie: lieu,
        departement: lieu === "outre-mer" ? departement : undefined,
        typeDelai: {
          augmentationDistance: preset.augmentationDistance,
        },
        dateExpedition: dateExpedition !== "" ? dateExpedition : undefined,
        dateRemise: dateRemise !== "" ? dateRemise : undefined,
        rolePartie,
      });
      setEcheance(resultat.echeance);
      setOrigineRetenue(origine);
      setDureeRetenue({ jours, mois, annees });
      if (resultat.moisAugmentation > 0) {
        setAugmentation(
          fr(`+ ${String(resultat.moisAugmentation)} mois (${resultat.sourceAugmentation})`),
        );
      } else {
        setAugmentation(fr("Aucune augmentation pour la distance"));
      }
      setErreur("");
      setInscrit("");
    } catch (err) {
      setEcheance("");
      setAugmentation("");
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
          const valeur = event.target.value;
          if (BIBLIOTHEQUE_DELAIS.some((item) => item.id === valeur)) {
            setTypeId(valeur);
          }
        }}
        data-testid="delai-type"
      >
        {BIBLIOTHEQUE_DELAIS.map((item) => (
          <option key={item.id} value={item.id}>
            {fr(item.label)}
          </option>
        ))}
      </select>
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-siege">
        {fr("Siège de la juridiction")}
      </label>
      <select
        id="delai-siege"
        name="siege"
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        value={siege}
        onChange={(event) => {
          setSiege(event.target.value as SiegeJuridiction);
        }}
        data-testid="delai-siege"
      >
        <option value="metropole">{fr("France métropolitaine")}</option>
        <option value="collectivite-644">{fr("Collectivité (art. 644)")}</option>
      </select>
      {siege === "collectivite-644" ? (
        <>
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="delai-departement-siege"
          >
            {fr("Département du siège")}
          </label>
          <input
            id="delai-departement-siege"
            name="departementSiege"
            type="text"
            inputMode="numeric"
            placeholder={fr("ex. 971")}
            required
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            data-testid="delai-departement-siege"
          />
        </>
      ) : null}
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-lieu">
        {fr("Lieu où demeure la partie")}
      </label>
      <select
        id="delai-lieu"
        name="lieu"
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        value={lieu}
        onChange={(event) => {
          setLieu(event.target.value as LieuPartie);
        }}
        data-testid="delai-lieu"
      >
        <option value="metropole">{fr("Métropole")}</option>
        <option value="outre-mer">{fr("Outre-mer")}</option>
        <option value="etranger">{fr("Étranger")}</option>
      </select>
      {lieu === "outre-mer" ? (
        <>
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="delai-departement-partie"
          >
            {fr("Département ou collectivité de la partie")}
          </label>
          <input
            id="delai-departement-partie"
            name="departement"
            type="text"
            inputMode="numeric"
            placeholder={fr("ex. 976, 977")}
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            data-testid="delai-departement-partie"
          />
        </>
      ) : null}
      {lieu === "etranger" || lieu === "outre-mer" ? (
        <>
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="delai-role"
          >
            {fr("Partie pour le calcul (double date)")}
          </label>
          <select
            id="delai-role"
            name="rolePartie"
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            defaultValue=""
            data-testid="delai-role"
          >
            <option value="">{fr("Sans double date")}</option>
            <option value="expediteur">{fr("Expéditeur (date d'expédition)")}</option>
            <option value="destinataire">{fr("Destinataire (date de remise)")}</option>
          </select>
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="delai-expedition"
          >
            {fr("Date d'expédition")}
          </label>
          <input
            id="delai-expedition"
            name="dateExpedition"
            type="date"
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            data-testid="delai-expedition"
          />
          <label
            className="text-[length:var(--font-size-dense)] text-graphite"
            htmlFor="delai-remise"
          >
            {fr("Date de remise")}
          </label>
          <input
            id="delai-remise"
            name="dateRemise"
            type="date"
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            data-testid="delai-remise"
          />
        </>
      ) : null}
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-origine">
        {fr("Date de l'acte ou de la notification")}
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
          <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="delai-annees">
            {fr("Années")}
          </label>
          <input
            id="delai-annees"
            name="annees"
            type="number"
            min={0}
            defaultValue={0}
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
          />
        </>
      ) : null}
      <p className="mb-3 text-[length:var(--font-size-meta)] text-graphite">
        {fr(
          "Le calcul ne tient pas compte des jours chômés locaux ni des fériés d'Alsace-Moselle.",
        )}
      </p>
      <button
        type="submit"
        className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
      >
        {fr("Calculer l'échéance")}
      </button>
      <p
        className="mt-2 text-[length:var(--font-size-dense)] text-encre"
        data-testid="delai-echeance"
        data-echeance={echeance}
      >
        {echeance === "" ? "" : formatDateLongue(echeance)}
      </p>
      {echeance !== "" && dossierId ? (
        <button
          type="button"
          data-testid="delai-inscrire"
          className="mt-3 rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          onClick={() => {
            void ecrireElementAgenda({
              dossierId,
              typeElement: "tache",
              titre: `Échéance du ${formatDateLongue(echeance)}`,
              debut: `${echeance}T09:00`,
              origineCalcul: origineRetenue,
              joursCalcul: dureeRetenue.jours,
              moisCalcul: dureeRetenue.mois,
              anneesCalcul: dureeRetenue.annees,
            })
              .then(() => {
                setInscrit(echeance);
              })
              .catch((err: unknown) => {
                setErreur(err instanceof Error ? err.message : fr("Inscription impossible."));
              });
          }}
        >
          {fr("Inscrire à l'agenda")}
        </button>
      ) : null}
      {inscrit !== "" ? (
        <p
          className="mt-2 text-[length:var(--font-size-dense)] text-encre"
          data-testid="delai-inscrit"
          data-echeance={inscrit}
        >
          {inscrit === "" ? "" : formatDateLongue(inscrit)}
        </p>
      ) : null}
      {augmentation !== "" ? (
        <p
          className="mt-1 text-[length:var(--font-size-dense)] text-graphite"
          data-testid="delai-augmentation"
        >
          {augmentation}
        </p>
      ) : null}
      {erreur !== "" ? <p className="mt-1 text-[length:var(--font-size-meta)] text-echeance">{erreur}</p> : null}
    </form>
  );
}
