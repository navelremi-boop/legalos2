/** SIREN (clé de Luhn) et n° TVA FR. Même formule que l'API. */

const MSG_SIREN = "SIREN invalide.";
const MSG_TVA = "Numéro de TVA invalide.";

function chiffres(brut: string): string {
  return brut.replace(/[^0-9]/g, "");
}

function luhnValide(valeur: string): boolean {
  if (!/^\d{9}$/.test(valeur)) return false;
  let somme = 0;
  let doubler = false;
  for (let i = valeur.length - 1; i >= 0; i -= 1) {
    const car = valeur[i];
    if (car === undefined) return false;
    let n = Number(car);
    if (doubler) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
    doubler = !doubler;
  }
  return somme % 10 === 0;
}

function cleTva(siren: string): number {
  return (12 + 3 * (Number(siren) % 97)) % 97;
}

export function verifierSirenTva(siren?: string, tva?: string): void {
  const sirenBrut = siren?.trim() ?? "";
  const sirenChiffres = sirenBrut === "" ? "" : chiffres(sirenBrut);
  if (sirenChiffres !== "" && !luhnValide(sirenChiffres)) {
    throw new Error(MSG_SIREN);
  }
  const tvaBrut = tva?.trim() ?? "";
  if (tvaBrut === "" || !tvaBrut.toUpperCase().startsWith("FR")) return;
  const compact = tvaBrut.replace(/\s/g, "").toUpperCase();
  const reste = compact.slice(2);
  if (!/^(\d{2})(\d{9})$/.test(reste)) throw new Error(MSG_TVA);
  const cle = Number(reste.slice(0, 2));
  const sirenTva = reste.slice(2);
  if (!luhnValide(sirenTva) || cle !== cleTva(sirenTva)) throw new Error(MSG_TVA);
  if (sirenChiffres !== "" && sirenChiffres !== sirenTva) throw new Error(MSG_TVA);
}
