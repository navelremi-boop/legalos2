import { formatDateLongue, formatHeureMur } from "@/lib/format";
import {
  ajouterDestinataires,
  lireSaisie,
  retirerDestinataire,
  type Destinataire,
} from "@/messagerie/adressesRedaction";
import { analyserCorrespondant, nomAffiche } from "@/messagerie/expediteurs";
import { muralMail } from "@/messagerie/listeMails";
import { nettoyerSortie, texteDepuisHtml } from "@/messagerie/nettoyageHtml";

/**
 * Construction du départ d'une rédaction : objet, destinataires, fil de discussion et historique cité
 * d'une réponse, d'une réponse à tous ou d'un transfert. Tout se calcule sur le poste, depuis la base locale :
 * répondre ne demande ni réseau ni attente. Le HTML produit est celui que le serveur nettoie puis envoie ;
 * l'historique est une citation (`blockquote`) précédée de sa mention d'origine, lisible dans Outlook et Gmail.
 */

export type GenreRedaction = "nouveau" | "reponse" | "reponse_a_tous" | "transfert";

/** Message cité : ce que la base locale sait d'un mail, plus son texte lu. */
export type MessageCite = {
  id: string;
  message_id: string | null;
  objet: string | null;
  expediteur: string | null;
  destinataires_texte: string | null;
  cree_le: string | null;
  /** Texte brut du message (pas de HTML : celui d'un tiers n'est jamais réinjecté tel quel). */
  texte: string;
  pieces: readonly string[];
};

const ECHAPPEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Échappe le texte d'un tiers avant de le mettre dans du HTML : le texte cité ne devient jamais du balisage. */
export function echapperHtml(texte: string): string {
  return texte.replace(/[&<>"']/gu, (c) => ECHAPPEMENTS[c] ?? c);
}

/** Paragraphes HTML d'un texte brut : lignes vides entre paragraphes, retours simples en `<br>`. */
export function paragraphesHtml(texte: string): string {
  const blocs = texte
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((bloc) => bloc.trim())
    .filter((bloc) => bloc !== "");
  return blocs.map((bloc) => `<p>${echapperHtml(bloc).replace(/\n/gu, "<br>")}</p>`).join("");
}

function commencePar(objet: string, mots: readonly string[]): boolean {
  const reste = objet.trimStart().toLowerCase();
  return mots.some((mot) => {
    if (!reste.startsWith(mot)) return false;
    return reste.slice(mot.length).trimStart().startsWith(":");
  });
}

/** Objet du message : « Re : » ou « Tr : » ajouté une seule fois, sans doubler un préfixe déjà présent. */
export function objetRedaction(genre: GenreRedaction, objet: string | null | undefined): string {
  const nu = (objet ?? "").trim();
  switch (genre) {
    case "nouveau":
      return nu;
    case "reponse":
    case "reponse_a_tous":
      return commencePar(nu, ["re"]) ? nu : nu === "" ? "Re :" : `Re : ${nu}`;
    case "transfert":
      return commencePar(nu, ["tr", "fwd", "fw"]) ? nu : nu === "" ? "Tr :" : `Tr : ${nu}`;
  }
}

function memeAdresse(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type DestinatairesDepart = { a: Destinataire[]; cc: Destinataire[] };

/**
 * Destinataires de départ. Réponse : l'expéditeur (ou, si c'est soi-même, les destinataires du message).
 * Réponse à tous : en plus, tous les autres destinataires en copie, sans les adresses du cabinet ni doublon.
 * Transfert et message neuf : aucun.
 */
export function destinatairesDepart(
  genre: GenreRedaction,
  message: Pick<MessageCite, "expediteur" | "destinataires_texte">,
  adressesPropres: readonly string[],
): DestinatairesDepart {
  if (genre === "nouveau" || genre === "transfert") return { a: [], cc: [] };
  const estPropre = (adresse: string) => adressesPropres.some((propre) => memeAdresse(propre, adresse));
  const correspondant = analyserCorrespondant(message.expediteur);
  const expediteur: Destinataire[] = lireSaisie(message.expediteur ?? "").destinataires.slice(0, 1);
  const autres = lireSaisie(message.destinataires_texte ?? "").destinataires;

  let a: Destinataire[];
  let cc: Destinataire[] = [];
  if (expediteur.length > 0 && !estPropre(correspondant.adresse)) {
    a = expediteur;
    if (genre === "reponse_a_tous") cc = autres;
  } else {
    // Réponse à un message qu'on a soi-même écrit : on écrit à ses destinataires.
    a = autres;
  }
  for (const propre of adressesPropres) {
    a = retirerDestinataire(a, propre);
    cc = retirerDestinataire(cc, propre);
  }
  // Un destinataire déjà dans « À » n'est pas répété en copie.
  for (const dest of a) cc = retirerDestinataire(cc, dest.adresse);
  return { a: ajouterDestinataires([], a), cc: ajouterDestinataires([], cc) };
}

/** Fil de discussion d'une réponse : `In-Reply-To` vers le message, `References` avec son identifiant. */
export function filDeReponse(
  genre: GenreRedaction,
  message: Pick<MessageCite, "message_id">,
): { enReponseA: string | null; references: string[] } {
  const identifiant = (message.message_id ?? "").trim();
  if ((genre !== "reponse" && genre !== "reponse_a_tous") || identifiant === "") {
    return { enReponseA: null, references: [] };
  }
  return { enReponseA: identifiant, references: [identifiant] };
}

/** « jeudi 8 octobre 2026 à 10 h 12 » à partir de la date d'un message ; chaîne vide si elle est illisible. */
export function dateCitation(cree_le: string | null | undefined): string {
  const mur = muralMail(cree_le);
  if (mur === null) return "";
  const jour = formatDateLongue(mur.jour);
  const annee = mur.jour.slice(0, 4);
  const heure = mur.heure === null || mur.minute === null ? "" : ` à ${formatHeureMur(mur.heure, mur.minute)}`;
  return `${jour} ${annee}${heure}`;
}

function auteurCite(message: Pick<MessageCite, "expediteur">): string {
  const correspondant = analyserCorrespondant(message.expediteur);
  const nom = nomAffiche(correspondant);
  if (nom === "") return "l'expéditeur";
  return correspondant.nom !== "" && correspondant.adresse !== "" ? `${correspondant.nom} <${correspondant.adresse}>` : nom;
}

/** Mention qui ouvre la citation d'une réponse : « Le jeudi 8 octobre 2026 à 10 h 12, Me X <x@y> a écrit : ». */
export function mentionDOrigine(message: Pick<MessageCite, "expediteur" | "cree_le">): string {
  const date = dateCitation(message.cree_le);
  const auteur = auteurCite(message);
  return date === "" ? `${auteur} a écrit :` : `Le ${date}, ${auteur} a écrit :`;
}

/** En-tête d'un message transféré : de, date, objet, à. */
function enTeteTransfert(message: MessageCite): string {
  const lignes = [`De : ${auteurCite(message)}`];
  const date = dateCitation(message.cree_le);
  if (date !== "") lignes.push(`Date : ${date}`);
  lignes.push(`Objet : ${(message.objet ?? "").trim() === "" ? "(sans objet)" : (message.objet ?? "").trim()}`);
  const destinataires = (message.destinataires_texte ?? "").trim();
  if (destinataires !== "") lignes.push(`À : ${destinataires}`);
  return `<p>${lignes.map((ligne) => echapperHtml(ligne)).join("<br>")}</p>`;
}

/**
 * Historique cité, à placer après la saisie. Réponse : mention puis texte du message en citation.
 * Transfert : ligne de séparation, en-tête du message d'origine puis son texte. Message neuf : rien.
 */
export function historiqueCite(genre: GenreRedaction, message: MessageCite): string {
  if (genre === "nouveau") return "";
  const texte = paragraphesHtml(message.texte);
  if (genre === "transfert") {
    return `<blockquote><p>---------- Message transféré ----------</p>${enTeteTransfert(message)}${texte}</blockquote>`;
  }
  return `<blockquote><p>${echapperHtml(mentionDOrigine(message))}</p>${texte}</blockquote>`;
}

/** Document de départ de l'éditeur : un paragraphe vide pour écrire, puis l'historique. */
export function corpsDeDepart(genre: GenreRedaction, message: MessageCite | null): string {
  const historique = message === null ? "" : historiqueCite(genre, message);
  return `<p></p>${historique}`;
}

/** Vrai si le document se termine par une citation (réponse ou transfert) que l'on peut masquer. */
export function aUnHistorique(html: string): boolean {
  return /<\/blockquote>\s*$/iu.test(html.trim());
}

/**
 * Texte du message cité, tiré du départ que le serveur compose (`html` : sa mention « a écrit : » puis le
 * texte en citation). Sert quand le poste n'a pas le corps du message (boîte du cabinet lue par le serveur) :
 * le serveur le lit sur IMAP. La mention est retirée, le HTML repasse par le nettoyage. Chaîne vide si absent.
 */
export function texteDeLaCitationServeur(html: string): string {
  const propre = nettoyerSortie(html);
  const debut = propre.search(/<blockquote>/u);
  if (debut === -1) return "";
  const fin = propre.lastIndexOf("</blockquote>");
  const interieur = propre.slice(debut + "<blockquote>".length, fin === -1 ? undefined : fin);
  // La première ligne est la mention d'origine du serveur : on la refait nous-mêmes avec les données du message.
  const sansMention = interieur.replace(/^<p>[^<]*a écrit\s*:\s*<\/p>/u, "");
  return texteDepuisHtml(sansMention);
}
