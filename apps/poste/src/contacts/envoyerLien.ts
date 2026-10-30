import { apiUrl } from "@/lib/auth/client";
import type { LienAffiche } from "@/contacts/liensContacts";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

/** Écrit le lien sur l'instance. La source est le dirigeant, la cible la société. */
export async function envoyerLien(instanceUrl: string, lien: LienAffiche): Promise<void> {
  const jeton = await assurerJetonAcces();
  if (jeton === null) throw new Error("La session a expiré. Reconnectez-vous.");
  const reponse = await fetch(apiUrl(instanceUrl, `/contacts/${lien.sourceId}/liens`), {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: lien.id,
      idempotence_cle: crypto.randomUUID(),
      contact_cible_id: lien.cibleId,
      type_lien: lien.typeLien,
      fonction: lien.fonction,
      libelle: lien.libelle,
      represente_societe: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!reponse.ok) {
    const json: unknown = await reponse.json().catch(() => null);
    const message =
      json !== null && typeof json === "object" && typeof (json as { message?: unknown }).message === "string"
        ? (json as { message: string }).message
        : "Le lien n'a pas été enregistré.";
    throw new Error(message);
  }
}
