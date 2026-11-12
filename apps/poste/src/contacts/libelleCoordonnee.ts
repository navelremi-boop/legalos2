/** Libellé d'une coordonnée dans la fiche, comme la maquette : « Siège », « Adresse de facturation », « Téléphone ». */
const ADRESSES: Readonly<Record<string, string>> = {
  siege: "Siège",
  facturation: "Adresse de facturation",
  domicile: "Domicile",
  correspondance: "Adresse de correspondance",
  cabinet: "Cabinet",
  etude: "Étude",
  autre: "Adresse",
};

const GENRES: Readonly<Record<string, string>> = {
  adresse: "Adresse",
  telephone: "Téléphone",
  email: "E-mail",
  site: "Site",
};

const USAGES: Readonly<Record<string, string>> = {
  domicile: "domicile",
  siege: "siège",
  correspondance: "correspondance",
  facturation: "facturation",
  cabinet: "cabinet",
  etude: "étude",
  autre: "",
};

export function libelleCoordonnee(genre: string, usage: string): string {
  if (genre === "adresse") return ADRESSES[usage] ?? "Adresse";
  const base = GENRES[genre] ?? genre;
  const precision = USAGES[usage] ?? usage;
  return precision === "" ? base : `${base} (${precision})`;
}
