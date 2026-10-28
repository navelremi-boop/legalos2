import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ETATS_CONNEXION,
  LIBELLES_ETAT_CONNEXION,
  SITUATIONS_CONNEXION,
  contenuConnexion,
} from "./etatsConnexion.ts";

describe("états de l'écran de connexion", () => {
  it("compte les onze états de la maquette, sans code de secours", () => {
    assert.equal(ETATS_CONNEXION.length, 11);
    for (const etat of ETATS_CONNEXION) {
      const contenu = contenuConnexion(etat);
      assert.equal(contenu.lienSecours, false);
      assert.equal(contenu.effaceDonneesLocales, false);
      assert.notEqual(LIBELLES_ETAT_CONNEXION[etat], "");
    }
  });

  it("chaque situation se déclenche sans effacer les données locales", () => {
    assert.deepEqual(SITUATIONS_CONNEXION, ["verrou", "horsligne", "revoque", "trousseau"]);
    for (const etat of SITUATIONS_CONNEXION) {
      const contenu = contenuConnexion(etat);
      assert.equal(contenu.effaceDonneesLocales, false);
      assert.notEqual(contenu.titre, "");
    }
    assert.match(contenuConnexion("verrou").sousTitre, /n'ont pas bougé/);
    assert.match(contenuConnexion("horsligne").info?.titre ?? "", /conservées/);
    assert.match(contenuConnexion("trousseau").info?.titre ?? "", /n'ont pas été modifiées/);
    assert.match(contenuConnexion("revoque").info?.texte ?? "", /ne les efface pas/);
  });

  it("laisse continuer quand le chiffrement du disque n'est pas détecté", () => {
    assert.equal(contenuConnexion("chiffrement").bouton, "Continuer quand même");
    assert.match(contenuConnexion("chiffrement").alerte?.texte ?? "", /chiffrement non confirmé/);
  });
});
