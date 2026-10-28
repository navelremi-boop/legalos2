export type DepotEnAttente = {
  documentId: string;
  dossierId: string;
  nom: string;
  empreinte: string;
  chemin: string;
};

const CLE = "legalos.fusion.attente";

export function lireAttente(stock: Storage): DepotEnAttente[] {
  const brut = stock.getItem(CLE);
  if (brut === null || brut === "") return [];
  try {
    const valeur = JSON.parse(brut) as unknown;
    if (!Array.isArray(valeur)) return [];
    return valeur.filter(estDepot);
  } catch {
    return [];
  }
}

export function memoriserAttente(stock: Storage, entree: DepotEnAttente): void {
  const sans = lireAttente(stock).filter((ligne) => ligne.documentId !== entree.documentId);
  stock.setItem(CLE, JSON.stringify([...sans, entree]));
}

export function oublierAttente(stock: Storage, documentId: string): void {
  const reste = lireAttente(stock).filter((ligne) => ligne.documentId !== documentId);
  stock.setItem(CLE, JSON.stringify(reste));
}

function estDepot(valeur: unknown): valeur is DepotEnAttente {
  if (valeur === null || typeof valeur !== "object") return false;
  const ligne = valeur as Record<string, unknown>;
  return (
    typeof ligne.documentId === "string" &&
    typeof ligne.dossierId === "string" &&
    typeof ligne.nom === "string" &&
    typeof ligne.empreinte === "string" &&
    typeof ligne.chemin === "string"
  );
}
