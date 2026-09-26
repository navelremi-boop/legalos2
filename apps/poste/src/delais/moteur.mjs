/**
 * Computation des délais (CPC 640 à 645, 908, 915-4) et jours fériés métropolitains.
 * Chaque règle est reprise dans docs/hypotheses-delais.md, « à valider par l'avocat ».
 */

/** @typedef {'metropole' | 'collectivite-644'} SiegeJuridiction */
/** @typedef {'metropole' | 'outre-mer' | 'etranger'} LieuPartie */
/** @typedef {'oui' | 'non' | 'regime-special'} AugmentationDistance */
/** @typedef {'expediteur' | 'destinataire'} RolePartie */

/**
 * Bibliothèque minimale de délais (source : docs/hypotheses-delais.md).
 * @type {readonly {
 *   id: string,
 *   label: string,
 *   jours: number,
 *   mois: number,
 *   annees: number,
 *   augmentationDistance: AugmentationDistance,
 *   source: string,
 * }[]}
 */
export const BIBLIOTHEQUE_DELAIS = Object.freeze([
  {
    id: "libre",
    label: "Saisie libre",
    jours: 0,
    mois: 0,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("oui"),
    source: "",
  },
  {
    id: "appel-538",
    label: "Appel (art. 538, 1 mois)",
    jours: 0,
    mois: 1,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("oui"),
    source: "art. 538",
  },
  {
    id: "conclusions-908",
    label: "Conclusions d'appelant (art. 908, 3 mois)",
    jours: 0,
    mois: 3,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("regime-special"),
    source: "art. 908, 915-4",
  },
  {
    id: "opposition",
    label: "Opposition (1 mois)",
    jours: 0,
    mois: 1,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("oui"),
    source: "art. 538",
  },
  {
    id: "quinze-jours",
    label: "Délai de 15 jours",
    jours: 15,
    mois: 0,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("oui"),
    source: "",
  },
  {
    id: "deux-mois",
    label: "Délai de 2 mois",
    jours: 0,
    mois: 2,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("oui"),
    source: "",
  },
  {
    id: "saisine-renvoi",
    label: "Saisine après cassation (sans augmentation)",
    jours: 0,
    mois: 2,
    annees: 0,
    augmentationDistance: /** @type {AugmentationDistance} */ ("non"),
    source: "Cass. 2e civ. 4 février 2021",
  },
]);

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

/**
 * Art. 641 al. 3 : même quantième, sinon le dernier jour du mois.
 * @param {Date} origine
 * @param {number} annees
 */
export function ajouterAnnees(origine, annees) {
  const annee = origine.getUTCFullYear() + annees;
  const moisOrigine = origine.getUTCMonth();
  const quantieme = origine.getUTCDate();
  const cible = new Date(Date.UTC(annee, moisOrigine, 1));
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
 * Source textuelle de l'augmentation (H8 / H10).
 * @param {AugmentationDistance} mode
 * @param {SiegeJuridiction} siege
 */
function sourcePour(mode, siege) {
  if (mode === "regime-special") return "art. 915-4";
  if (siege === "collectivite-644") return "art. 644";
  return "art. 643";
}

/**
 * H8 / H10 — mois d'augmentation pour la distance.
 * @param {{
 *   siegeJuridiction?: SiegeJuridiction,
 *   departementSiege?: string,
 *   lieuPartie?: LieuPartie,
 *   departement?: string,
 *   collectivite?: string,
 *   augmentationDistance?: AugmentationDistance,
 * }} saisie
 * @returns {{ mois: number, source: string }}
 */
export function moisAugmentationDistance(saisie) {
  const mode = saisie.augmentationDistance ?? "oui";
  if (mode === "non") {
    return { mois: 0, source: "" };
  }

  const siege = saisie.siegeJuridiction ?? "metropole";
  const lieu = saisie.lieuPartie ?? "metropole";
  const source = sourcePour(mode, siege);

  if (lieu === "etranger") {
    return { mois: 2, source };
  }

  if (siege === "metropole") {
    if (lieu === "outre-mer") return { mois: 1, source };
    return { mois: 0, source: "" };
  }

  // Siège dans une collectivité de l'art. 644 : +1 hors département du siège.
  const depSiege = (saisie.departementSiege ?? "").trim();
  const depPartie = (saisie.departement ?? "").trim();
  if (lieu === "metropole") {
    return { mois: 1, source };
  }
  if (lieu === "outre-mer") {
    if (depSiege !== "" && depPartie !== "" && depSiege === depPartie) {
      return { mois: 0, source: "" };
    }
    return { mois: 1, source };
  }
  return { mois: 0, source: "" };
}

/**
 * H11 — date de notification selon la partie (art. 647-1).
 * @param {{
 *   origine?: string,
 *   dateExpedition?: string,
 *   dateRemise?: string,
 *   rolePartie?: RolePartie,
 * }} saisie
 */
export function dateOrigineNotification(saisie) {
  const role = saisie.rolePartie;
  if (role === "expediteur" && saisie.dateExpedition) {
    return saisie.dateExpedition;
  }
  if (role === "destinataire" && saisie.dateRemise) {
    return saisie.dateRemise;
  }
  if (!saisie.origine) {
    throw new Error("origine manquante");
  }
  return saisie.origine;
}

/**
 * Applique mois (dont augmentation), années, jours, puis report H6.
 * @param {string} origineIso
 * @param {{ jours?: number, mois?: number, annees?: number }} duree
 */
function appliquerDuree(origineIso, duree) {
  const jours = duree.jours ?? 0;
  const mois = duree.mois ?? 0;
  const annees = duree.annees ?? 0;
  if (jours < 0 || mois < 0 || annees < 0) {
    throw new Error("durée négative");
  }
  if (jours === 0 && mois === 0 && annees === 0) {
    throw new Error("durée vide");
  }
  let date = lireDate(origineIso);
  if (annees > 0) {
    date = ajouterAnnees(date, annees);
  }
  if (mois > 0) {
    date = ajouterMois(date, mois);
  }
  if (jours > 0) {
    date = decalerJours(date, jours);
  }
  return ecrireDate(prorogerAuJourOuvrable(date));
}

/**
 * Calcul complet : échéance + augmentation affichée (H8–H11).
 * @param {{
 *   origine?: string,
 *   jours?: number,
 *   mois?: number,
 *   annees?: number,
 *   moisDistance?: number,
 *   siegeJuridiction?: SiegeJuridiction,
 *   departementSiege?: string,
 *   lieuPartie?: LieuPartie,
 *   collectivite?: string,
 *   departement?: string,
 *   typeDelai?: {
 *     jours?: number,
 *     mois?: number,
 *     annees?: number,
 *     augmentationDistance?: AugmentationDistance,
 *   },
 *   dateExpedition?: string,
 *   dateRemise?: string,
 *   rolePartie?: RolePartie,
 * }} saisie
 * @returns {{ echeance: string, moisAugmentation: number, sourceAugmentation: string }}
 */
export function calculerDelaiComplet(saisie) {
  const type = saisie.typeDelai ?? {};
  const mode = type.augmentationDistance ?? "oui";

  let moisAugmentation = 0;
  let sourceAugmentation = "";

  if (typeof saisie.moisDistance === "number") {
    moisAugmentation = saisie.moisDistance;
    sourceAugmentation = moisAugmentation > 0 ? "saisie manuelle (rétrocompat)" : "";
  } else {
    const aug = moisAugmentationDistance({
      siegeJuridiction: saisie.siegeJuridiction,
      departementSiege: saisie.departementSiege,
      lieuPartie: saisie.lieuPartie,
      departement: saisie.departement,
      collectivite: saisie.collectivite,
      augmentationDistance: mode,
    });
    moisAugmentation = aug.mois;
    sourceAugmentation = aug.source;
  }

  const jours = saisie.jours ?? type.jours ?? 0;
  const moisBase = saisie.mois ?? type.mois ?? 0;
  const annees = saisie.annees ?? type.annees ?? 0;
  const origine = dateOrigineNotification(saisie);

  const echeance = appliquerDuree(origine, {
    jours,
    mois: moisBase + moisAugmentation,
    annees,
  });

  return { echeance, moisAugmentation, sourceAugmentation };
}

/**
 * H10 — enchaînement appel (art. 538 + 643/644) puis conclusions (art. 908 + 915-4).
 * Si `dateDeclarationAppel` est omise, on suppose l'appel formé le dernier jour du délai.
 * @param {{
 *   origine: string,
 *   siegeJuridiction?: SiegeJuridiction,
 *   departementSiege?: string,
 *   lieuPartie?: LieuPartie,
 *   departement?: string,
 *   collectivite?: string,
 *   dateDeclarationAppel?: string,
 *   dateExpedition?: string,
 *   dateRemise?: string,
 *   rolePartie?: RolePartie,
 * }} saisie
 */
export function calculerChaineAppelConclusions(saisie) {
  const commun = {
    siegeJuridiction: saisie.siegeJuridiction,
    departementSiege: saisie.departementSiege,
    lieuPartie: saisie.lieuPartie,
    departement: saisie.departement,
    collectivite: saisie.collectivite,
    dateExpedition: saisie.dateExpedition,
    dateRemise: saisie.dateRemise,
    rolePartie: saisie.rolePartie,
  };

  const appel = calculerDelaiComplet({
    ...commun,
    origine: saisie.origine,
    mois: 1,
    typeDelai: { augmentationDistance: "oui" },
  });

  const declaration = saisie.dateDeclarationAppel ?? appel.echeance;
  const conclusions = calculerDelaiComplet({
    ...commun,
    origine: declaration,
    mois: 3,
    typeDelai: { augmentationDistance: "regime-special" },
  });

  return {
    appel,
    conclusions,
    moisConclusions: 3 + conclusions.moisAugmentation,
    dateDeclarationAppel: declaration,
  };
}

/**
 * @param {{
 *   origine: string,
 *   jours?: number,
 *   mois?: number,
 *   annees?: number,
 *   moisDistance?: number,
 *   siegeJuridiction?: SiegeJuridiction,
 *   departementSiege?: string,
 *   lieuPartie?: LieuPartie,
 *   collectivite?: string,
 *   departement?: string,
 *   typeDelai?: {
 *     jours?: number,
 *     mois?: number,
 *     annees?: number,
 *     augmentationDistance?: AugmentationDistance,
 *   },
 *   dateExpedition?: string,
 *   dateRemise?: string,
 *   rolePartie?: RolePartie,
 * }} saisie
 * @returns {string}
 */
export function calculerEcheance(saisie) {
  if (
    saisie.siegeJuridiction !== undefined ||
    saisie.lieuPartie !== undefined ||
    saisie.typeDelai !== undefined ||
    saisie.dateExpedition !== undefined ||
    saisie.dateRemise !== undefined
  ) {
    return calculerDelaiComplet(saisie).echeance;
  }
  const jours = saisie.jours ?? 0;
  const mois = (saisie.mois ?? 0) + (saisie.moisDistance ?? 0);
  const annees = saisie.annees ?? 0;
  return appliquerDuree(saisie.origine, { jours, mois, annees });
}
