import { apiUrl } from "@/lib/auth/client";
import {
  MODELE_PAR_DEFAUT,
  type RemiseAZero,
} from "@/lib/modeleReference";
import { loadSessionTokens } from "@/lib/session/storage";

export type ApercuReference = {
  annee: number;
  prochain: number;
  initiales: string;
};

export type EtatReferenceCabinet = {
  modele: string;
  remise_a_zero: RemiseAZero;
  numero_depart: number | null;
  apercu: ApercuReference;
};

export type MiseAJourReferenceCabinet = {
  modele: string;
  remise_a_zero: RemiseAZero;
  numero_depart: number | null;
};

function anneeParis(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
  }).formatToParts(date);
  const annee = parts.find((part) => part.type === "year")?.value;
  return annee === undefined ? date.getFullYear() : Number(annee);
}

export function apercuHorsLigne(): ApercuReference {
  return { annee: anneeParis(), prochain: 42, initiales: "XX" };
}

function estRemise(valeur: unknown): valeur is RemiseAZero {
  return valeur === "annuelle" || valeur === "jamais";
}

function entierPositif(valeur: unknown): number | null {
  if (typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 1) {
    return valeur;
  }
  if (typeof valeur === "string" && valeur.trim() !== "") {
    const n = Number(valeur);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

function lireMessage(corps: unknown, repli: string): string {
  if (corps !== null && typeof corps === "object" && "message" in corps) {
    const message = corps.message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return repli;
}

async function lireJson(reponse: Response): Promise<unknown> {
  const texte = await reponse.text();
  if (texte === "") return null;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return null;
  }
}

export function etatDepuisCorps(corps: unknown): EtatReferenceCabinet {
  const objet = corps !== null && typeof corps === "object" ? (corps as Record<string, unknown>) : {};
  const modele = typeof objet.modele === "string" && objet.modele.trim() !== "" ? objet.modele : MODELE_PAR_DEFAUT;
  const remise = estRemise(objet.remise_a_zero) ? objet.remise_a_zero : "annuelle";
  const horsLigne = apercuHorsLigne();
  return {
    modele,
    remise_a_zero: remise,
    numero_depart: entierPositif(objet.numero_depart),
    apercu: {
      annee: entierPositif(objet.annee) ?? horsLigne.annee,
      prochain:
        entierPositif(objet.prochain_numero) ??
        entierPositif(objet.prochain) ??
        horsLigne.prochain,
      initiales:
        typeof objet.initiales === "string" && objet.initiales.trim() !== ""
          ? objet.initiales
          : horsLigne.initiales,
    },
  };
}

export async function chargerReferenceCabinet(
  instanceUrl: string,
  cabinetId: string,
): Promise<{ ok: true; etat: EtatReferenceCabinet } | { ok: false; message: string }> {
  const jeton = loadSessionTokens().accessToken;
  if (!jeton) {
    return { ok: false, message: "Connexion requise." };
  }
  try {
    const reponse = await fetch(apiUrl(instanceUrl, `/cabinets/${cabinetId}/reference`), {
      headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
    });
    const corps = await lireJson(reponse);
    if (!reponse.ok) {
      return { ok: false, message: lireMessage(corps, `Erreur serveur (${String(reponse.status)}).`) };
    }
    return { ok: true, etat: etatDepuisCorps(corps) };
  } catch {
    return { ok: false, message: "Impossible de joindre l’instance. Vérifiez l’adresse et le réseau." };
  }
}

export async function enregistrerReferenceCabinet(
  instanceUrl: string,
  cabinetId: string,
  miseAJour: MiseAJourReferenceCabinet,
): Promise<{ ok: true; etat: EtatReferenceCabinet } | { ok: false; message: string }> {
  const jeton = loadSessionTokens().accessToken;
  if (!jeton) {
    return { ok: false, message: "Connexion requise." };
  }
  try {
    const reponse = await fetch(apiUrl(instanceUrl, `/cabinets/${cabinetId}/reference`), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${jeton}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotence_cle: crypto.randomUUID(),
        modele: miseAJour.modele,
        remise_a_zero: miseAJour.remise_a_zero,
        ...(miseAJour.numero_depart === null
          ? {}
          : { numero_depart: miseAJour.numero_depart }),
      }),
    });
    const corps = await lireJson(reponse);
    if (!reponse.ok) {
      return { ok: false, message: lireMessage(corps, `Erreur serveur (${String(reponse.status)}).`) };
    }
    return { ok: true, etat: etatDepuisCorps(corps) };
  } catch {
    return { ok: false, message: "Impossible de joindre l’instance. Vérifiez l’adresse et le réseau." };
  }
}
