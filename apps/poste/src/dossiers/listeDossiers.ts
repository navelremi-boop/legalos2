import { dateCivile } from "@/lib/format";

export type FiltreDossier = "actifs" | "proche" | "restreints" | "clos";
export type TriDossier = "echeance" | "activite" | "reference";

/** Dossier tel que la liste le reçoit, échéance déjà réduite à la prochaine date future. */
export type DossierBrut = {
  id: string;
  nom: string;
  chemise: string;
  reference: string | null;
  typeDossier: string | null;
  etape: string | null;
  juridiction: string | null;
  numeroRg: string | null;
  restreint: boolean;
  creeLe: string | null;
  echeance: string | null;
  echeanceTitre: string | null;
  parties: string;
};

export type DossierVue = DossierBrut & {
  clos: boolean;
  jours: number | null;
};

export type CompteursDossiers = {
  actifs: number;
  proche: number;
  restreints: number;
  clos: number;
};

export type GroupeDossiers = {
  titre: string;
  dossiers: DossierVue[];
};

const JOURS_PROCHE = 14;
const JOURS_SEMAINE = 7;

/** Écart en jours civils. Négatif si l'échéance est passée. */
export function joursEntre(aujourdhui: string, echeance: string): number | null {
  const depart = dateCivile(aujourdhui);
  const arrivee = dateCivile(echeance);
  if (!depart || !arrivee) return null;
  const ms =
    Date.UTC(arrivee.annee, arrivee.mois - 1, arrivee.jour) -
    Date.UTC(depart.annee, depart.mois - 1, depart.jour);
  return Math.round(ms / 86_400_000);
}

export function vueDossier(dossier: DossierBrut, aujourdhui: string): DossierVue {
  const brut = dossier.echeance === null ? null : joursEntre(aujourdhui, dossier.echeance);
  const jours = brut === null || brut < 0 ? null : brut;
  return {
    ...dossier,
    clos: dossier.etape === "clos",
    jours,
  };
}

export function compteurs(liste: readonly DossierVue[]): CompteursDossiers {
  let actifs = 0;
  let proche = 0;
  let restreints = 0;
  let clos = 0;
  for (const dossier of liste) {
    if (dossier.restreint) restreints += 1;
    if (dossier.clos) {
      clos += 1;
      continue;
    }
    actifs += 1;
    if (dossier.jours !== null && dossier.jours <= JOURS_PROCHE) proche += 1;
  }
  return { actifs, proche, restreints, clos };
}

function normaliser(texte: string): string {
  return texte.toLowerCase();
}

function correspond(dossier: DossierVue, recherche: string): boolean {
  const q = normaliser(recherche.trim());
  if (q === "") return true;
  const haystack = normaliser(
    [dossier.nom, dossier.reference ?? "", dossier.numeroRg ?? "", dossier.juridiction ?? "", dossier.parties].join(
      " ",
    ),
  );
  return haystack.includes(q);
}

/** Une recherche porte sur tous les dossiers, clos compris, et ignore le filtre. */
export function filtrer(
  liste: readonly DossierVue[],
  filtre: FiltreDossier,
  recherche: string,
): DossierVue[] {
  if (recherche.trim() !== "") return liste.filter((dossier) => correspond(dossier, recherche));
  if (filtre === "actifs") return liste.filter((dossier) => !dossier.clos);
  if (filtre === "proche") {
    return liste.filter((dossier) => !dossier.clos && dossier.jours !== null && dossier.jours <= JOURS_PROCHE);
  }
  if (filtre === "restreints") return liste.filter((dossier) => dossier.restreint);
  return liste.filter((dossier) => dossier.clos);
}

function parJours(a: DossierVue, b: DossierVue): number {
  return (a.jours ?? 9999) - (b.jours ?? 9999);
}

function parActivite(a: DossierVue, b: DossierVue): number {
  return (b.creeLe ?? "").localeCompare(a.creeLe ?? "");
}

function parReference(a: DossierVue, b: DossierVue): number {
  return (b.reference ?? "").localeCompare(a.reference ?? "", "fr");
}

export function grouper(liste: readonly DossierVue[], tri: TriDossier): GroupeDossiers[] {
  if (tri === "activite") return [{ titre: "", dossiers: [...liste].sort(parActivite) }];
  if (tri === "reference") return [{ titre: "", dossiers: [...liste].sort(parReference) }];
  const semaine = liste.filter((d) => !d.clos && d.jours !== null && d.jours <= JOURS_SEMAINE).sort(parJours);
  const ensuite = liste.filter((d) => !d.clos && d.jours !== null && d.jours > JOURS_SEMAINE).sort(parJours);
  const sans = liste.filter((d) => !d.clos && d.jours === null).sort(parActivite);
  const clos = liste.filter((d) => d.clos).sort(parActivite);
  const groupes: GroupeDossiers[] = [
    { titre: "Cette semaine", dossiers: semaine },
    { titre: "Dans les semaines qui viennent", dossiers: ensuite },
    { titre: "Sans échéance", dossiers: sans },
    { titre: "Clos", dossiers: clos },
  ];
  return groupes.filter((groupe) => groupe.dossiers.length > 0);
}

/** La liste reste affichée pendant la création : seul le panneau de droite change. */
export function panneauDroit(creation: boolean): "creation" | "apercu" {
  return creation ? "creation" : "apercu";
}
