import { adresseValide, type Destinataire } from "@/messagerie/adressesRedaction";
import { analyserCorrespondant, separerDestinataires } from "@/messagerie/expediteurs";
import { dateDuMail } from "@/messagerie/listeMails";
import type { MailLocal } from "@/messagerie/typesMails";

/**
 * Complétion des destinataires. La source principale est la route de l'API (annuaire du cabinet, adresses déjà
 * écrites, adresses des mails lisibles). Hors ligne, les adresses des mails de la base locale prennent le relais :
 * la saisie ne s'arrête jamais faute de réseau.
 */

export const SUGGESTIONS_MAX = 8;
export const SAISIE_MIN = 2;

export type SuggestionDestinataire = Destinataire & { source: string };

function cle(adresse: string): string {
  return adresse.trim().toLowerCase();
}

function correspond(suggestion: Destinataire, saisie: string): boolean {
  const mot = saisie.trim().toLowerCase();
  return suggestion.adresse.toLowerCase().includes(mot) || suggestion.nom.toLowerCase().includes(mot);
}

/** Adresses des expéditeurs et destinataires des mails de la base locale qui contiennent la saisie, les plus récentes d'abord. */
export function suggestionsLocales(
  saisie: string,
  mails: readonly Pick<MailLocal, "expediteur" | "destinataires_texte" | "date_entete" | "cree_le">[],
  adressesPropres: readonly string[],
): SuggestionDestinataire[] {
  if (Array.from(saisie.trim()).length < SAISIE_MIN) return [];
  const propres = new Set(adressesPropres.map(cle));
  const vues = new Map<string, SuggestionDestinataire>();
  const recents = [...mails].sort((a, b) => (dateDuMail(b) ?? "").localeCompare(dateDuMail(a) ?? ""));
  for (const mail of recents) {
    const bruts = [mail.expediteur ?? "", ...separerDestinataires(mail.destinataires_texte)];
    for (const brut of bruts) {
      const correspondant = analyserCorrespondant(brut);
      if (!adresseValide(correspondant.adresse) || propres.has(cle(correspondant.adresse))) continue;
      const candidat: SuggestionDestinataire = {
        adresse: correspondant.adresse.trim(),
        nom: correspondant.nom,
        source: "recu",
      };
      if (!correspond(candidat, saisie)) continue;
      const existant = vues.get(cle(candidat.adresse));
      if (existant === undefined) vues.set(cle(candidat.adresse), candidat);
      else if (existant.nom === "" && candidat.nom !== "") existant.nom = candidat.nom;
    }
  }
  return [...vues.values()].slice(0, SUGGESTIONS_MAX);
}

/**
 * Suggestions à montrer : celles de l'API d'abord (ordre de priorité du serveur), puis les locales, sans
 * doublon, sans adresse déjà présente dans un champ du message, huit au plus.
 */
export function fusionnerSuggestions(
  api: readonly SuggestionDestinataire[],
  locales: readonly SuggestionDestinataire[],
  dejaPresents: readonly Destinataire[],
): SuggestionDestinataire[] {
  const exclus = new Set(dejaPresents.map((d) => cle(d.adresse)));
  const resultat: SuggestionDestinataire[] = [];
  for (const suggestion of [...api, ...locales]) {
    const adresse = cle(suggestion.adresse);
    if (exclus.has(adresse)) continue;
    exclus.add(adresse);
    resultat.push(suggestion);
  }
  return resultat.slice(0, SUGGESTIONS_MAX);
}

/** Libellé d'une suggestion : « Nom, adresse » ou l'adresse seule. */
export function libelleSuggestion(suggestion: Destinataire): string {
  return suggestion.nom !== "" ? `${suggestion.nom}, ${suggestion.adresse}` : suggestion.adresse;
}

/** Provenance affichée sous la suggestion. */
export function provenanceSuggestion(source: string): string {
  switch (source) {
    case "annuaire":
      return "Contact";
    case "envoye":
      return "Déjà écrit";
    case "recu":
      return "Mail reçu";
    default:
      return "";
  }
}

/** Touches qui valident la saisie en cours comme un destinataire (Entrée, Tab, virgule, point-virgule, espace après une adresse). */
export function toucheValideSaisie(touche: string, saisie: string): boolean {
  if (saisie.trim() === "") return false;
  return touche === "Enter" || touche === "Tab" || touche === "," || touche === ";" || (touche === " " && adresseValide(saisie));
}
