import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { naissanceLecture, ressortLecture, valeurEtatCivil } from "./etatCivilLecture.ts";

// fr() pose des espaces insécables dans les phrases : les comparaisons passent par des espaces ordinaires.
const ordinaire = (texte: string | undefined) => texte?.replace(/[\u00a0\u202f]/gu, " ");

describe("naissance en lecture", () => {
  it("écrit la date puis le lieu saisi, département compris", () => {
    const lecture = naissanceLecture("1972-02-03", "Saint-Étienne (Loire)");
    assert.equal(ordinaire(lecture?.texte), "3 février 1972 à Saint-Étienne (Loire)");
    assert.equal(lecture?.manque, false);
  });

  it("garde le lieu tel quel quand aucun département n'est saisi", () => {
    assert.equal(ordinaire(naissanceLecture("1974-08-21", "Lyon")?.texte), "21 août 1974 à Lyon");
  });

  it("ne duplique pas le département déjà saisi entre parenthèses", () => {
    const texte = ordinaire(naissanceLecture("1974-08-21", "  Lyon   (Rhône) ")?.texte);
    assert.equal(texte, "21 août 1974 à Lyon (Rhône)");
  });

  it("sans lieu, affiche la date seule", () => {
    for (const lieu of [null, undefined, "", "   "]) {
      const lecture = naissanceLecture("2001-05-12", lieu);
      assert.equal(ordinaire(lecture?.texte), "12 mai 2001");
      assert.equal(lecture?.manque, false);
    }
  });

  it("sans date, garde le lieu et signale la date à compléter", () => {
    const lecture = naissanceLecture(null, "Lyon (Rhône)");
    assert.equal(lecture?.texte, "Date non renseignée, à Lyon (Rhône)");
    assert.equal(lecture?.manque, true);
  });

  it("sans date ni lieu, ne renvoie rien", () => {
    assert.equal(naissanceLecture(null, null), null);
    assert.equal(naissanceLecture("", " "), null);
  });
});

describe("valeurs d'état civil en lecture", () => {
  it("met la majuscule initiale sans toucher au reste", () => {
    assert.equal(valeurEtatCivil("française"), "Française");
    assert.equal(valeurEtatCivil("chef d'entreprise"), "Chef d'entreprise");
    assert.equal(valeurEtatCivil("  retraitée "), "Retraitée");
    assert.equal(valeurEtatCivil("Consultante"), "Consultante");
    assert.equal(valeurEtatCivil("épicier"), "Épicier");
  });

  it("renvoie null quand la valeur est vide", () => {
    assert.equal(valeurEtatCivil(null), null);
    assert.equal(valeurEtatCivil(undefined), null);
    assert.equal(valeurEtatCivil("  "), null);
  });
});

describe("ressort d'un professionnel", () => {
  it("écrit la cour d'appel en toutes lettres, avec l'élision devant une voyelle", () => {
    assert.equal(ressortLecture("Lyon"), "Cour d'appel de Lyon");
    assert.equal(ressortLecture(" Aix-en-Provence "), "Cour d'appel d'Aix-en-Provence");
    assert.equal(ressortLecture("Agen"), "Cour d'appel d'Agen");
    assert.equal(ressortLecture("Orléans"), "Cour d'appel d'Orléans");
  });

  it("renvoie null sans cour d'appel", () => {
    assert.equal(ressortLecture(null), null);
    assert.equal(ressortLecture(""), null);
  });
});
