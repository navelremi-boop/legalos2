import { GENRES_MODELE, modeleLivre, type GenreModele } from "@/modeles/fusionDocx";

const CLE = (cabinetId: string, genre: GenreModele) => `legalos.modele.${cabinetId}.${genre}`;

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function versBase64(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

/** Copie locale du modèle du cabinet, ou le modèle livré avec le poste. */
export function lireModele(stock: Storage, cabinetId: string, genre: GenreModele): Uint8Array {
  const garde = cabinetId === "" ? null : stock.getItem(CLE(cabinetId, genre));
  return garde === null ? modeleLivre(genre) : depuisBase64(garde);
}

export function enregistrerModele(
  stock: Storage,
  cabinetId: string,
  genre: GenreModele,
  octets: Uint8Array,
): void {
  stock.setItem(CLE(cabinetId, genre), versBase64(octets));
}

export function modeleRemplace(stock: Storage, cabinetId: string, genre: GenreModele): boolean {
  return cabinetId !== "" && stock.getItem(CLE(cabinetId, genre)) !== null;
}

export function genresModele(): readonly GenreModele[] {
  return GENRES_MODELE;
}
