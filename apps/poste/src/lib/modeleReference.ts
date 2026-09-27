/**
 * Référence de dossier personnalisable — portage de `crates/domaine/src/reference.rs`.
 * Arbitrage R0, `docs/hypotheses-dossiers.md`. Sans I/O.
 */

export const MODELE_PAR_DEFAUT = "{AAAA}-{N:3}";

const LONGUEUR_MAX = 40;
const INITIALES_MAX = 4;
const CHIFFRES_NUMERO_MAX = 18;
const NOMS_RESERVES_WINDOWS = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
] as const;

const SEPARATEURS = ["/", "-", ".", "_", " "] as const;

/** Points de code Unicode — même découpe que `chars()` en Rust, pas des graphèmes. */
function caracteres(texte: string): string[] {
  const sortie: string[] = [];
  for (const c of texte) {
    sortie.push(c);
  }
  return sortie;
}

export type RemiseAZero = "annuelle" | "jamais";

export type Bloc =
  | { kind: "texte"; valeur: string }
  | { kind: "annee"; chiffres: 2 | 4 }
  | { kind: "numero"; chiffres: number | null }
  | { kind: "initiales" };

export class ErreurModele extends Error {
  readonly codeErreur: string;

  constructor(message: string, codeErreur: string) {
    super(message);
    this.name = "ErreurModele";
    this.codeErreur = codeErreur;
  }

  code(): string {
    return this.codeErreur;
  }
}

export function estErreurModele(valeur: unknown): valeur is ErreurModele {
  return valeur instanceof ErreurModele;
}

type Lecture = {
  annee: number | null;
  numero: number;
};

type Etat = {
  annee: number | null;
  numero: number | null;
  initiales: { debut: number; longueur: number } | null;
};

export class ModeleReference {
  readonly blocs: readonly Bloc[];

  constructor(blocs: readonly Bloc[]) {
    this.blocs = blocs;
  }

  static analyser(texte: string): ModeleReference {
    const blocs = analyserStructure(texte);
    const numeros = blocs.filter((bloc) => bloc.kind === "numero").length;
    if (numeros === 0) {
      throw new ErreurModele("Le modèle doit contenir le numéro : {N} ou {N:k}.", "sans_numero");
    }
    if (numeros > 1) {
      throw new ErreurModele("Le modèle ne peut contenir qu'un seul numéro.", "plusieurs_numeros");
    }
    return new ModeleReference(blocs);
  }

  static analyserPour(texte: string, remise: RemiseAZero): ModeleReference {
    const modele = ModeleReference.analyser(texte);
    modele.verifierPolitique(remise);
    return modele;
  }

  verifierPolitique(remise: RemiseAZero): void {
    const aAnnee = this.blocs.some((bloc) => bloc.kind === "annee");
    if (remise === "annuelle" && !aAnnee) {
      throw new ErreurModele(
        "Avec la remise à zéro annuelle, le modèle doit contenir l'année : {AAAA} ou {AA}.",
        "sans_annee",
      );
    }
  }

  texte(): string {
    return texteDepuisBlocs(this.blocs);
  }

  produire(annee: number, numero: number, initiales: string): string {
    let sortie = "";
    for (const bloc of this.blocs) {
      switch (bloc.kind) {
        case "texte":
          sortie += bloc.valeur;
          break;
        case "annee":
          sortie +=
            bloc.chiffres === 4
              ? formaterEntierSigne(annee, 4)
              : formaterEntierSigne(remEuclid(annee, 100), 2);
          break;
        case "numero":
          sortie +=
            bloc.chiffres === null ? String(numero) : String(numero).padStart(bloc.chiffres, "0");
          break;
        case "initiales":
          sortie += initiales;
          break;
      }
    }
    return sortie;
  }

  pourraitRedonner(
    remise: RemiseAZero,
    anneeCourante: number,
    prochain: number,
    reference: string,
  ): boolean {
    return this.lectures(reference).some((lecture) => {
      if (lecture.annee === null) {
        return lecture.numero >= prochain;
      }
      if (remise === "annuelle") {
        return (
          lecture.annee > anneeCourante ||
          (lecture.annee === anneeCourante && lecture.numero >= prochain)
        );
      }
      return lecture.annee >= anneeCourante && lecture.numero >= prochain;
    });
  }

  private lectures(reference: string): Lecture[] {
    const cible = caracteres(formeClassement(reference).toUpperCase());
    const lectures: Lecture[] = [];
    lire(this.blocs, cible, 0, { annee: null, numero: null, initiales: null }, lectures);
    return lectures;
  }
}

export function analyser(texte: string): ModeleReference {
  return ModeleReference.analyser(texte);
}

export function analyserPour(texte: string, remise: RemiseAZero): ModeleReference {
  return ModeleReference.analyserPour(texte, remise);
}

export function produire(
  modele: ModeleReference,
  annee: number,
  numero: number,
  initiales: string,
): string {
  return modele.produire(annee, numero, initiales);
}

export function pourraitRedonner(
  modele: ModeleReference,
  remise: RemiseAZero,
  anneeCourante: number,
  prochain: number,
  reference: string,
): boolean {
  return modele.pourraitRedonner(remise, anneeCourante, prochain, reference);
}

export function estSeparateur(valeur: string): boolean {
  return valeur === "" || (SEPARATEURS as readonly string[]).includes(valeur);
}

export function estBlocSeparateur(bloc: Bloc): boolean {
  return bloc.kind === "texte" && estSeparateur(bloc.valeur);
}

export function blocsDepuisTexte(modele: string): Bloc[] {
  try {
    const blocs = analyserStructure(modele);
    return insererSeparateursVides(blocs);
  } catch {
    const texte = modele.trim();
    return texte.length === 0 ? [] : [{ kind: "texte", valeur: texte }];
  }
}

export function texteDepuisBlocs(blocs: readonly Bloc[]): string {
  let sortie = "";
  for (const bloc of blocs) {
    switch (bloc.kind) {
      case "texte":
        sortie += bloc.valeur;
        break;
      case "annee":
        sortie += bloc.chiffres === 4 ? "{AAAA}" : "{AA}";
        break;
      case "numero":
        sortie += bloc.chiffres === null ? "{N}" : `{N:${String(bloc.chiffres)}}`;
        break;
      case "initiales":
        sortie += "{INI}";
        break;
    }
  }
  return sortie;
}

export function formeClassement(reference: string): string {
  return caracteres(reference)
    .map((c) => (estAsciiAlphanumerique(c) || c === "-" || c === "_" ? c : "-"))
    .join("");
}

export function formeExport(reference: string): string {
  const remplace = caracteres(reference)
    .map((c) =>
      c === "/" ||
      c === "\\" ||
      c === ":" ||
      c === "*" ||
      c === "?" ||
      c === '"' ||
      c === "<" ||
      c === ">" ||
      c === "|" ||
      estControle(c)
        ? "-"
        : c,
    )
    .join("");
  let sortie = remplace;
  if (sortie.endsWith(".") || sortie.endsWith(" ")) {
    sortie = `${sortie.slice(0, -1)}-`;
  }
  const finBase = sortie.indexOf(".");
  const fin = finBase === -1 ? sortie.length : finBase;
  const base = sortie.slice(0, fin).toUpperCase();
  if ((NOMS_RESERVES_WINDOWS as readonly string[]).includes(base)) {
    sortie = `${sortie.slice(0, fin)}-${sortie.slice(fin)}`;
  }
  return sortie;
}

export function referenceCitee(reference: string, texte: string): boolean {
  const lettres = caracteres(texte);
  return [reference, formeClassement(reference)].some((forme) => {
    const cible = caracteres(forme);
    return cible.length > 0 && contientBorne(lettres, cible);
  });
}

export function initialesDepuis(texte: string): string {
  const locale = texte.split("@")[0] ?? "";
  const initiales = locale
    .split(/[.\-_+]|\s/u)
    .map((segment) => {
      for (const c of segment) {
        const lettre = lettreSansAccent(c);
        if (lettre !== null) return lettre;
      }
      return "";
    })
    .filter((lettre) => lettre.length > 0)
    .slice(0, INITIALES_MAX)
    .join("");
  return initiales.length === 0 ? "X" : initiales;
}

export function initialesValides(initiales: string): boolean {
  const lettres = caracteres(initiales);
  const n = lettres.length;
  return n >= 1 && n <= INITIALES_MAX && lettres.every((c) => c >= "A" && c <= "Z");
}

function analyserStructure(texteBrut: string): Bloc[] {
  const texte = texteBrut.trim();
  const unites = caracteres(texte);
  if (unites.length === 0) {
    throw new ErreurModele("Le modèle est vide.", "vide");
  }
  if (unites.length > LONGUEUR_MAX) {
    throw new ErreurModele("Le modèle dépasse 40 caractères.", "trop_long");
  }
  if (unites.some((c) => estControle(c))) {
    throw new ErreurModele("Le modèle contient un caractère de contrôle.", "caractere_controle");
  }
  const blocs: Bloc[] = [];
  let libre = "";
  let i = 0;
  while (i < unites.length) {
    const c = unites[i];
    if (c === undefined) break;
    if (c === "{") {
      const finRel = unites.slice(i).indexOf("}");
      if (finRel === -1) {
        throw new ErreurModele("Accolade non fermée dans le modèle.", "accolade_non_fermee");
      }
      const jetonCaracteres = unites.slice(i + 1, i + finRel);
      if (jetonCaracteres.includes("{")) {
        throw new ErreurModele("Accolade non fermée dans le modèle.", "accolade_non_fermee");
      }
      const bloc = blocDuJeton(jetonCaracteres.join(""));
      if (libre.length > 0) {
        blocs.push({ kind: "texte", valeur: libre });
        libre = "";
      }
      blocs.push(bloc);
      i += finRel + 1;
    } else if (c === "}") {
      throw new ErreurModele("Accolade fermante sans accolade ouvrante.", "accolade_isolee");
    } else {
      libre += c;
      i += 1;
    }
  }
  if (libre.length > 0) {
    blocs.push({ kind: "texte", valeur: libre });
  }
  return blocs;
}

function blocDuJeton(jeton: string): Bloc {
  if (jeton === "AAAA") return { kind: "annee", chiffres: 4 };
  if (jeton === "AA") return { kind: "annee", chiffres: 2 };
  if (jeton === "N") return { kind: "numero", chiffres: null };
  if (jeton === "INI") return { kind: "initiales" };
  if (
    jeton.startsWith("N:") &&
    jeton.length > 2 &&
    caracteres(jeton.slice(2)).every((c) => c >= "0" && c <= "9")
  ) {
    const k = Number(jeton.slice(2));
    if (Number.isInteger(k) && k >= 1 && k <= 9) {
      return { kind: "numero", chiffres: k };
    }
    throw new ErreurModele("Le numéro compte de 1 à 9 chiffres.", "chiffres_hors_bornes");
  }
  throw new ErreurModele(`Jeton inconnu : {${jeton}}.`, "jeton_inconnu");
}

function insererSeparateursVides(blocs: readonly Bloc[]): Bloc[] {
  const sortie: Bloc[] = [];
  for (const bloc of blocs) {
    const dernier = sortie[sortie.length - 1];
    if (dernier !== undefined && !estBlocSeparateur(dernier) && !estBlocSeparateur(bloc)) {
      sortie.push({ kind: "texte", valeur: "" });
    }
    sortie.push(bloc);
  }
  return sortie;
}

function lire(
  blocs: readonly Bloc[],
  cible: readonly string[],
  pos: number,
  etat: Etat,
  lectures: Lecture[],
): void {
  const bloc = blocs[0];
  if (bloc === undefined) {
    if (pos === cible.length && etat.numero !== null) {
      lectures.push({ annee: etat.annee, numero: etat.numero });
    }
    return;
  }
  const suite = blocs.slice(1);
  const reste = cible.slice(pos);
  switch (bloc.kind) {
    case "texte": {
      const attendu = caracteres(formeClassement(bloc.valeur).toUpperCase());
      if (commencePar(reste, attendu)) {
        lire(suite, cible, pos + attendu.length, etat, lectures);
      }
      return;
    }
    case "annee": {
      const largeur = bloc.chiffres;
      if (reste.length < largeur) return;
      const valeur = valeurDecimale(reste.slice(0, largeur));
      if (valeur === null || valeur > 0x7fff_ffff) return;
      const annee = largeur === 4 ? valeur : 2000 + valeur;
      if (etat.annee !== null && etat.annee !== annee) return;
      lire(suite, cible, pos + largeur, { ...etat, annee }, lectures);
      return;
    }
    case "numero": {
      let disponibles = 0;
      for (const c of reste) {
        if (c < "0" || c > "9") break;
        disponibles += 1;
        if (disponibles >= CHIFFRES_NUMERO_MAX) break;
      }
      for (let longueur = 1; longueur <= disponibles; longueur += 1) {
        const chiffresLus = reste.slice(0, longueur);
        const commenceParZero = chiffresLus[0] === "0";
        const produit =
          bloc.chiffres === null
            ? !commenceParZero
            : longueur === bloc.chiffres || (longueur > bloc.chiffres && !commenceParZero);
        const numero = valeurDecimale(chiffresLus);
        if (numero === null || numero < 1) continue;
        if (produit) {
          lire(suite, cible, pos + longueur, { ...etat, numero }, lectures);
        }
      }
      return;
    }
    case "initiales": {
      if (etat.initiales !== null) {
        const deja = cible.slice(etat.initiales.debut, etat.initiales.debut + etat.initiales.longueur);
        if (commencePar(reste, deja)) {
          lire(suite, cible, pos + etat.initiales.longueur, etat, lectures);
        }
        return;
      }
      let lettres = 0;
      for (const c of reste) {
        if (c < "A" || c > "Z") break;
        lettres += 1;
        if (lettres >= INITIALES_MAX) break;
      }
      for (let longueur = 1; longueur <= lettres; longueur += 1) {
        lire(suite, cible, pos + longueur, { ...etat, initiales: { debut: pos, longueur } }, lectures);
      }
    }
  }
}

function valeurDecimale(chiffres: readonly string[]): number | null {
  try {
    let acc = 0n;
    for (const c of chiffres) {
      if (c.length !== 1 || c < "0" || c > "9") return null;
      acc = acc * 10n + BigInt(c.charCodeAt(0) - 48);
      if (acc > 0xffff_ffff_ffff_ffffn) return null;
    }
    return Number(acc);
  } catch {
    return null;
  }
}

function contientBorne(texte: readonly string[], forme: readonly string[]): boolean {
  if (forme.length > texte.length) return false;
  const max = texte.length - forme.length;
  for (let debut = 0; debut <= max; debut += 1) {
    const fin = debut + forme.length;
    let egal = true;
    for (let i = 0; i < forme.length; i += 1) {
      const a = texte[debut + i];
      const b = forme[i];
      if (a === undefined || b === undefined || !eqIgnoreAsciiCase(a, b)) {
        egal = false;
        break;
      }
    }
    const avant = texte[debut - 1];
    const apres = texte[fin];
    const borneAvant = debut === 0 || (avant !== undefined && !estAlphanumerique(avant));
    const borneApres = fin === texte.length || (apres !== undefined && !estAlphanumerique(apres));
    if (egal && borneAvant && borneApres) return true;
  }
  return false;
}

function commencePar(reste: readonly string[], attendu: readonly string[]): boolean {
  if (attendu.length > reste.length) return false;
  return attendu.every((c, i) => reste[i] === c);
}

function eqIgnoreAsciiCase(a: string, b: string): boolean {
  return plierAscii(a) === plierAscii(b);
}

function plierAscii(c: string): string {
  if (c.length !== 1) return c;
  const code = c.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
  return c;
}

function estAsciiAlphanumerique(c: string): boolean {
  return (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function estAlphanumerique(c: string): boolean {
  return /\p{L}/u.test(c) || /\p{N}/u.test(c);
}

function estControle(c: string): boolean {
  return /\p{Cc}/u.test(c);
}

function remEuclid(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function formaterEntierSigne(n: number, largeur: number): string {
  if (n >= 0) return String(n).padStart(largeur, "0");
  return `-${String(Math.abs(n)).padStart(Math.max(largeur - 1, 0), "0")}`;
}

function lettreSansAccent(c: string): string | null {
  switch (c) {
    case "à":
    case "á":
    case "â":
    case "ã":
    case "ä":
    case "å":
    case "æ":
    case "À":
    case "Á":
    case "Â":
    case "Ã":
    case "Ä":
    case "Å":
    case "Æ":
      return "A";
    case "ç":
    case "Ç":
      return "C";
    case "è":
    case "é":
    case "ê":
    case "ë":
    case "È":
    case "É":
    case "Ê":
    case "Ë":
      return "E";
    case "ì":
    case "í":
    case "î":
    case "ï":
    case "Ì":
    case "Í":
    case "Î":
    case "Ï":
      return "I";
    case "ñ":
    case "Ñ":
      return "N";
    case "ò":
    case "ó":
    case "ô":
    case "õ":
    case "ö":
    case "œ":
    case "Ò":
    case "Ó":
    case "Ô":
    case "Õ":
    case "Ö":
    case "Œ":
      return "O";
    case "ù":
    case "ú":
    case "û":
    case "ü":
    case "Ù":
    case "Ú":
    case "Û":
    case "Ü":
      return "U";
    case "ý":
    case "ÿ":
    case "Ý":
    case "Ÿ":
      return "Y";
    default:
      if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
        return c.toUpperCase();
      }
      return null;
  }
}
