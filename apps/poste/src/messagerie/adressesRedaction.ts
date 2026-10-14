import { analyserCorrespondant, separerDestinataires } from "@/messagerie/expediteurs";

/**
 * Destinataires d'un message en cours de rédaction : lecture d'une saisie ou d'un collage, validation,
 * forme stockée dans le brouillon (une adresse par ligne) et forme envoyée à l'API.
 */

export type Destinataire = { adresse: string; nom: string };

export type ChampAdresses = "a" | "cc" | "cci";

/** Une adresse valable pour un en-tête : pas d'espace, de chevron, de guillemet ni de caractère de contrôle. */
const FORME_ADRESSE = /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]{2,}$/u;
const CARACTERE_DE_CONTROLE = /\p{Cc}/u;

export function adresseValide(adresse: string): boolean {
  const texte = adresse.trim();
  return texte.length <= 320 && !CARACTERE_DE_CONTROLE.test(texte) && FORME_ADRESSE.test(texte);
}

/** Un retour à la ligne ou un caractère de contrôle ne passe jamais dans un en-tête (le serveur le refuse aussi). */
export function contientCaractereDeControle(texte: string): boolean {
  return CARACTERE_DE_CONTROLE.test(texte);
}

/** Nom d'affichage sans ce qui casserait « Nom <adresse> » : chevrons, guillemets, virgules, contrôles. */
function nomSur(nom: string): string {
  return nom
    .replace(/\p{Cc}/gu, " ")
    .replace(/[<>",;]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export type LectureSaisie = { destinataires: Destinataire[]; invalides: string[] };

/**
 * Lit une saisie ou un collage : adresses séparées par des virgules, des points-virgules ou des retours à la
 * ligne, avec ou sans nom (« Me Anne Perrin <a.perrin@exemple.fr> »). Ce qui n'est pas une adresse est rendu à part.
 */
export function lireSaisie(texte: string): LectureSaisie {
  const destinataires: Destinataire[] = [];
  const invalides: string[] = [];
  const morceaux = texte
    .split(/[\r\n]+/u)
    .flatMap((ligne) => separerDestinataires(ligne));
  for (const morceau of morceaux) {
    const correspondant = analyserCorrespondant(morceau);
    if (adresseValide(correspondant.adresse)) {
      destinataires.push({ adresse: correspondant.adresse.trim(), nom: nomSur(correspondant.nom) });
    } else {
      invalides.push(morceau);
    }
  }
  return { destinataires, invalides };
}

function cle(adresse: string): string {
  return adresse.trim().toLowerCase();
}

/** Ajoute des destinataires sans doublon (adresse comparée sans tenir compte de la casse) ; un nom connu complète une entrée sans nom. */
export function ajouterDestinataires(
  liste: readonly Destinataire[],
  nouveaux: readonly Destinataire[],
): Destinataire[] {
  const resultat = liste.map((d) => ({ ...d }));
  for (const nouveau of nouveaux) {
    const existant = resultat.find((d) => cle(d.adresse) === cle(nouveau.adresse));
    if (existant === undefined) {
      resultat.push({ ...nouveau });
    } else if (existant.nom === "" && nouveau.nom !== "") {
      existant.nom = nouveau.nom;
    }
  }
  return resultat;
}

export function retirerDestinataire(liste: readonly Destinataire[], adresse: string): Destinataire[] {
  return liste.filter((d) => cle(d.adresse) !== cle(adresse));
}

/** Forme d'un destinataire dans un en-tête : « Nom <adresse> » ou l'adresse seule. */
export function formeEnTete(destinataire: Destinataire): string {
  const nom = nomSur(destinataire.nom);
  return nom === "" ? destinataire.adresse.trim() : `${nom} <${destinataire.adresse.trim()}>`;
}

/** Lignes envoyées à l'API et stockées dans le brouillon (une adresse par ligne). */
export function versLignes(liste: readonly Destinataire[]): string[] {
  return liste.map(formeEnTete);
}

/** Relit la colonne texte du brouillon (une adresse par ligne). Les lignes illisibles sont ignorées. */
export function depuisLignes(texte: string | null | undefined): Destinataire[] {
  const lignes = (texte ?? "")
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "");
  return lireSaisie(lignes.join("\n")).destinataires;
}

/** Texte de l'étiquette d'une puce : le nom, sinon l'adresse. */
export function etiquetteDestinataire(destinataire: Destinataire): string {
  return destinataire.nom !== "" ? destinataire.nom : destinataire.adresse;
}

/** Nombre de destinataires, tous champs confondus (l'envoi en exige au moins un). */
export function nombreDestinataires(champs: Record<ChampAdresses, readonly Destinataire[]>): number {
  return champs.a.length + champs.cc.length + champs.cci.length;
}
