import { apiUrl } from "@/lib/auth/client";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

export type AdresseAEnvoyer = { usage: "siege" | "domicile"; valeur: string };

function messageDe(json: unknown, defaut: string): string {
  if (json !== null && typeof json === "object" && typeof (json as { message?: unknown }).message === "string") {
    return (json as { message: string }).message;
  }
  return defaut;
}

/**
 * Crée la fiche sur l'instance, puis son adresse principale. Lève une erreur au message lisible
 * si la fiche n'a pas été créée ; l'échec de l'adresse seule n'annule pas la fiche.
 */
export async function enregistrerContact(
  instanceUrl: string,
  id: string,
  corps: Record<string, unknown>,
  adresse: AdresseAEnvoyer | null,
): Promise<void> {
  const jeton = await assurerJetonAcces();
  if (jeton === null) throw new Error("La session a expiré. Reconnectez-vous.");
  let reponse: Response;
  try {
    reponse = await fetch(apiUrl(instanceUrl, "/contacts"), {
      method: "POST",
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("La fiche n'a pas été créée. La saisie manuelle reste possible.");
  }
  const json: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new Error(messageDe(json, "La fiche n'a pas été créée."));
  if (adresse === null) return;
  await fetch(apiUrl(instanceUrl, `/contacts/${id}/coordonnees`), {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      idempotence_cle: crypto.randomUUID(),
      genre: "adresse",
      usage: adresse.usage,
      valeur: adresse.valeur,
      principale: true,
    }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => undefined);
}

/** Interroge le registre ; lève une erreur au message lisible. Retourne le JSON brut. */
export async function chercherSirenRegistre(instanceUrl: string, siren: string): Promise<unknown> {
  const jeton = await assurerJetonAcces();
  if (jeton === null) throw new Error("La session a expiré. Reconnectez-vous.");
  const indisponible = "Le registre des entreprises est indisponible. La saisie manuelle reste possible.";
  let reponse: Response;
  try {
    reponse = await fetch(apiUrl(instanceUrl, `/contacts/recherche-siren/${encodeURIComponent(siren)}`), {
      headers: { authorization: `Bearer ${jeton}` },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error(indisponible);
  }
  const json: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new Error(messageDe(json, indisponible));
  return json;
}
