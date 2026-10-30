export type DossierFiche = {
  id: string;
  nom: string;
  qualite: string;
};

export type FactureFiche = {
  id: string;
  libelle: string;
  ttcCentimes: number;
  encaisseCentimes: number;
};

export type MailFiche = {
  id: string;
  objet: string;
  expediteur: string;
  destinataires: string;
  etat: string;
};

export type NoteFiche = {
  id: string;
  texte: string;
};

export type SyntheseFactures = {
  encaisseCentimes: number;
  encoursCentimes: number;
};

function adresses(texte: string): string[] {
  return texte
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/[<>]/g, "").toLocaleLowerCase("fr"))
    .filter((part) => part.includes("@"));
}

/** Encours = reste à payer, jamais négatif. */
export function syntheseFactures(factures: readonly FactureFiche[]): SyntheseFactures {
  let encaisse = 0;
  let encours = 0;
  for (const facture of factures) {
    encaisse += facture.encaisseCentimes;
    const reste = facture.ttcCentimes - facture.encaisseCentimes;
    encours += reste > 0 ? reste : 0;
  }
  return { encaisseCentimes: encaisse, encoursCentimes: encours };
}

/** Mails classés dont l'expéditeur ou un destinataire est une adresse de la fiche. */
export function mailsDuContact(mails: readonly MailFiche[], emails: readonly string[]): MailFiche[] {
  const connus = new Set(emails.map((email) => email.trim().toLocaleLowerCase("fr")).filter((email) => email !== ""));
  if (connus.size === 0) return [];
  return mails.filter((mail) => {
    if (mail.etat !== "classe") return false;
    const presents = [...adresses(mail.expediteur), ...adresses(mail.destinataires)];
    return presents.some((adresse) => connus.has(adresse));
  });
}
