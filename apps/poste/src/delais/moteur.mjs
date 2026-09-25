/**
 * Computation des délais (CPC 640 à 644) et jours fériés métropolitains.
 * Chaque règle est reprise dans docs/hypotheses-delais.md, « à valider par l'avocat ».
 */

/** @param {number} annee */
export function dimancheDePaques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return dateUtc(annee, mois, jour);
}

/** @param {string} iso YYYY-MM-DD */
export function lireDate(iso) {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!morceaux) {
    throw new Error("date attendue AAAA-MM-JJ");
  }
  const annee = Number(morceaux[1]);
  const mois = Number(morceaux[2]);
  const jour = Number(morceaux[3]);
  const date = dateUtc(annee, mois, jour);
  if (date.getUTCFullYear() !== annee || date.getUTCMonth() + 1 !== mois || date.getUTCDate() !== jour) {
    throw new Error("date impossible");
  }
  return date;
}

/** @param {Date} date */
export function ecrireDate(date) {
  const mois = String(date.getUTCMonth() + 1).padStart(2, "0");
  const jour = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mois}-${jour}`;
}

/** @param {number} annee @param {number} mois 1-12 @param {number} jour */
function dateUtc(annee, mois, jour) {
  return new Date(Date.UTC(annee, mois - 1, jour));
}

/** @param {Date} date @param {number} jours */
function decalerJours(date, jours) {
  const copie = new Date(date.getTime());
  copie.setUTCDate(copie.getUTCDate() + jours);
  return copie;
}

/**
 * Art. 641 al. 2 : même quantième, sinon le dernier jour du mois.
 * @param {Date} origine
 * @param {number} mois
 */
export function ajouterMois(origine, mois) {
  const annee = origine.getUTCFullYear();
  const moisOrigine = origine.getUTCMonth();
  const quantieme = origine.getUTCDate();
  const cible = new Date(Date.UTC(annee, moisOrigine + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(quantieme, dernier));
  return cible;
}

/** @param {number} annee */
export function joursFeriesMetropole(annee) {
  const paques = dimancheDePaques(annee);
  const dates = [
    dateUtc(annee, 1, 1),
    decalerJours(paques, 1),
    dateUtc(annee, 5, 1),
    dateUtc(annee, 5, 8),
    decalerJours(paques, 39),
    decalerJours(paques, 50),
    dateUtc(annee, 7, 14),
    dateUtc(annee, 8, 15),
    dateUtc(annee, 11, 1),
    dateUtc(annee, 11, 11),
    dateUtc(annee, 12, 25),
  ];
  return new Set(dates.map(ecrireDate));
}

/** @param {Date} date */
export function estOuvrable(date) {
  const jour = date.getUTCDay();
  if (jour === 0 || jour === 6) return false;
  return !joursFeriesMetropole(date.getUTCFullYear()).has(ecrireDate(date));
}

/** Art. 642 al. 2 : premier jour ouvrable suivant. @param {Date} date */
export function prorogerAuJourOuvrable(date) {
  let courant = date;
  while (!estOuvrable(courant)) {
    courant = decalerJours(courant, 1);
  }
  return courant;
}

/**
 * @param {{
 *   origine: string,
 *   jours?: number,
 *   mois?: number,
 *   moisDistance?: number,
 * }} saisie
 */
export function calculerEcheance(saisie) {
  const jours = saisie.jours ?? 0;
  const mois = (saisie.mois ?? 0) + (saisie.moisDistance ?? 0);
  if (jours < 0 || mois < 0) {
    throw new Error("durée négative");
  }
  if (jours === 0 && mois === 0) {
    throw new Error("durée vide");
  }
  let date = lireDate(saisie.origine);
  if (mois > 0) {
    date = ajouterMois(date, mois);
  }
  if (jours > 0) {
    date = decalerJours(date, jours);
  }
  return ecrireDate(prorogerAuJourOuvrable(date));
}
