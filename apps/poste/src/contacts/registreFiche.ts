import { formatDateActe } from "@/lib/format";

/** Identifiants de source écrits à l'import, avec le nom qu'on affiche. */
const SOURCES_IMPORT: Readonly<Record<string, string>> = {
  "recherche-entreprises": "Registre national des entreprises",
};

/** Nom affiché d'une source d'import ; null si l'identifiant est inconnu (rien n'est inventé). */
export function libelleSourceImport(source: string | null | undefined): string | null {
  const code = source?.trim() ?? "";
  return SOURCES_IMPORT[code] ?? null;
}

/**
 * Jour civil à Paris d'un instant stocké en texte (« 2026-10-02 09:12:00+00 », « 2026-10-02T07:12:00Z »,
 * ou une simple date). Null si le texte n'est pas une date.
 */
export function jourCivilParis(instant: string | null | undefined): string | null {
  const texte = instant?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte)) return texte;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(texte);
  if (m === null) return null;
  let decalage = m[3] ?? "Z";
  if (/^[+-]\d{2}$/.test(decalage)) decalage = `${decalage}:00`;
  else if (/^[+-]\d{4}$/.test(decalage)) decalage = `${decalage.slice(0, 3)}:${decalage.slice(3)}`;
  const date = new Date(`${m[1] ?? ""}T${m[2] ?? ""}${decalage}`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export type RegistreFiche = {
  sourceImport?: string | null;
  importeLe?: string | null;
  sourceCapital?: string | null;
};

/**
 * Ligne de source sous l'identité d'une société : « Registre national des entreprises, importé le
 * 2 octobre 2026. Capital saisi d'après le procès-verbal du 12 mars 2025. » Chaque phrase
 * n'apparaît que si sa donnée existe ; null quand il n'y a rien à dire.
 */
export function ligneSourceFiche(fiche: RegistreFiche): string | null {
  const phrases: string[] = [];
  const source = libelleSourceImport(fiche.sourceImport);
  if (source !== null) {
    const jour = jourCivilParis(fiche.importeLe);
    const date = jour === null ? "" : formatDateActe(jour);
    phrases.push(date === "" ? `${source}.` : `${source}, importé le ${date}.`);
  }
  const capital = fiche.sourceCapital?.trim() ?? "";
  if (capital !== "") phrases.push(`Capital saisi d'après ${capital}.`);
  return phrases.length === 0 ? null : phrases.join(" ");
}

/** Valeur de « Immatriculée le » : « 4 avril 2019 », ou null quand la date n'est pas connue. */
export function dateImmatriculation(iso: string | null | undefined): string | null {
  const jour = jourCivilParis(iso);
  if (jour === null) return null;
  const date = formatDateActe(jour);
  return date === "" ? null : date;
}

/** Greffe en lecture : « Lyon » pour « RCS de Lyon » ; la saisie reste intacte dans le champ d'édition. */
export function libelleGreffe(greffe: string | null | undefined): string | null {
  const net = greffe?.trim() ?? "";
  if (net === "") return null;
  const court = net.replace(/^RCS\s+(?:de\s+la\s+|de\s+l['’]\s*|de\s+|du\s+|d['’]\s*)/i, "").trim();
  return court === "" ? net : court;
}
