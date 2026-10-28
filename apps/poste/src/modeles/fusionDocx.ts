import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/** Délimiteurs du cœur gratuit. `{@rawXml}` pourra s'y brancher plus tard, sans module payant aujourd'hui. */
export const DELIMITEURS_FUSION = { start: "{", end: "}" } as const;

export const GENRES_MODELE = ["courrier", "convention", "acte"] as const;
export type GenreModele = (typeof GENRES_MODELE)[number];

export class FusionIncomplete extends Error {
  readonly champsManquants: readonly string[];

  constructor(champs: readonly string[]) {
    super(`Champs manquants : ${champs.join(", ")}`);
    this.name = "FusionIncomplete";
    this.champsManquants = champs;
  }
}

const STYLES_LIVRES =
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Normal" w:type="paragraph"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>';

/** Document Word minimal : le texte de chaque paragraphe est déjà du XML de run. */
export function construireModele(paragraphes: readonly string[], styles = STYLES_LIVRES): Uint8Array {
  const corps = paragraphes
    .map((texte) => `<w:p><w:r><w:t xml:space="preserve">${texte}</w:t></w:r></w:p>`)
    .join("");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corps}<w:sectPr/></w:body></w:document>`,
  );
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${styles}`);
  return zip.generate({ type: "uint8array" });
}

export function modeleLivre(genre: GenreModele): Uint8Array {
  const titre =
    genre === "courrier" ? "Courrier" : genre === "convention" ? "Convention d'honoraires" : "Acte";
  return construireModele([
    titre,
    "{dossier_nom}",
    "{dossier_reference}",
    "{client_nom}",
    "{cabinet_nom}",
  ]);
}

function texteDocument(octets: Uint8Array): string {
  const xml = new PizZip(octets).file("word/document.xml")?.asText() ?? "";
  return xml.replace(/<[^>]+>/g, "");
}

/** Balises de données. Les préfixes `@`, `#` et `/` sont laissés au cœur (rawXml ou boucle, plus tard). */
export function balisesDuModele(octets: Uint8Array): string[] {
  const trouvees = texteDocument(octets).match(/\{[^{}]+\}/g) ?? [];
  const noms = trouvees
    .map((balise) => balise.slice(1, -1).trim())
    .filter((nom) => nom !== "" && !nom.startsWith("@") && !nom.startsWith("#") && !nom.startsWith("/"));
  return [...new Set(noms)];
}

export function champsManquants(balises: readonly string[], donnees: Readonly<Record<string, string>>): string[] {
  return balises.filter((nom) => {
    const valeur = donnees[nom];
    return valeur === undefined || valeur.trim() === "";
  });
}

export function balisesResiduelles(octets: Uint8Array): number {
  return (texteDocument(octets).match(/\{[^{}]+\}/g) ?? []).length;
}

export function stylesIdentiques(avant: Uint8Array, apres: Uint8Array): boolean {
  const gauche = new PizZip(avant).file("word/styles.xml")?.asUint8Array();
  const droite = new PizZip(apres).file("word/styles.xml")?.asUint8Array();
  if (!gauche || !droite || gauche.length !== droite.length) return false;
  for (let i = 0; i < gauche.length; i += 1) {
    if (gauche[i] !== droite[i]) return false;
  }
  return true;
}

/** Fusion hors ligne. Un champ absent ou vide arrête avant d'écrire. Aucun module payant. */
export function fusionnerDocx(octets: Uint8Array, donnees: Readonly<Record<string, string>>): Uint8Array {
  const manquants = champsManquants(balisesDuModele(octets), donnees);
  if (manquants.length > 0) throw new FusionIncomplete(manquants);
  const zip = new PizZip(octets);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { ...DELIMITEURS_FUSION },
  });
  doc.render({ ...donnees });
  const sorti = doc.getZip().generate({ type: "uint8array" });
  if (balisesResiduelles(sorti) > 0) throw new Error("Balise résiduelle");
  return sorti;
}
