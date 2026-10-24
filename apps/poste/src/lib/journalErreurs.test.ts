import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDE_JOURNAL,
  ENTREES_MAX_PAR_MINUTE,
  decrireErreur,
  decrirePromesseRejetee,
  installerJournalErreurs,
} from "./journalErreurs.ts";

/** Cible minimale : retient les écouteurs, les déclenche à la main. */
function fauxNavigateur() {
  const ecouteurs = new Map<string, ((evenement: Event) => void)[]>();
  return {
    addEventListener: (type: string, ecouteur: (evenement: Event) => void) => {
      ecouteurs.set(type, [...(ecouteurs.get(type) ?? []), ecouteur]);
    },
    removeEventListener: (type: string, ecouteur: (evenement: Event) => void) => {
      ecouteurs.set(type, (ecouteurs.get(type) ?? []).filter((e) => e !== ecouteur));
    },
    declencher: (type: string, evenement: unknown) => {
      for (const ecouteur of ecouteurs.get(type) ?? []) ecouteur(evenement as Event);
    },
    nombre: (type: string) => (ecouteurs.get(type) ?? []).length,
  };
}

function enregistreur() {
  const appels: { commande: string; args: Record<string, unknown> }[] = [];
  return {
    appels,
    envoyer: (commande: string, args: Record<string, unknown>) => {
      appels.push({ commande, args });
      return Promise.resolve(undefined);
    },
  };
}

describe("description d'une erreur JavaScript", () => {
  it("une erreur de page porte son message, sa source et sa ligne", () => {
    assert.deepEqual(decrireErreur({ message: "x is not defined", filename: "http://localhost/app.js", lineno: 42 }), {
      genre: "erreur_js",
      message: "x is not defined",
      source: "http://localhost/app.js",
      ligne: 42,
    });
  });

  it("une erreur typée donne son nom et son message", () => {
    assert.equal(decrireErreur({ error: new TypeError("boom") }).message, "TypeError: boom");
  });

  it("essai négatif : sans message ni source, des valeurs vides plutôt qu'un plantage", () => {
    assert.deepEqual(decrireErreur({}), { genre: "erreur_js", message: "erreur sans message", source: null, ligne: null });
    assert.equal(decrireErreur({ message: "", filename: "", lineno: Number.NaN }).source, null);
    assert.equal(decrireErreur({ lineno: Number.NaN }).ligne, null);
  });

  it("une promesse rejetée : Error, texte, et jamais le contenu d'un objet", () => {
    assert.equal(decrirePromesseRejetee(new RangeError("hors limites")).message, "RangeError: hors limites");
    assert.equal(decrirePromesseRejetee("refusée").message, "refusée");
    const secret = { motDePasse: "Mot2PasseFictif" };
    const texte = decrirePromesseRejetee(secret).message;
    assert.equal(texte, "valeur non textuelle (object)");
    assert.equal(texte.includes("Mot2PasseFictif"), false);
    assert.equal(decrirePromesseRejetee(undefined).genre, "promesse_rejetee");
  });

  it("un message très long est borné", () => {
    assert.ok(decrireErreur({ message: "a".repeat(5_000) }).message.length <= 401);
  });
});

describe("installation du journal", () => {
  it("chaque erreur de page et chaque rejet est envoyé à la commande du journal", () => {
    const fenetre = fauxNavigateur();
    const { appels, envoyer } = enregistreur();
    installerJournalErreurs(fenetre, envoyer);
    fenetre.declencher("error", { message: "oups", filename: "a.js", lineno: 3 });
    fenetre.declencher("unhandledrejection", { reason: new Error("refus") });
    assert.equal(appels.length, 2);
    assert.equal(appels[0]?.commande, COMMANDE_JOURNAL);
    assert.deepEqual(appels[0]?.args, { genre: "erreur_js", message: "oups", source: "a.js", ligne: 3 });
    assert.equal(appels[1]?.args.genre, "promesse_rejetee");
    assert.equal(appels[1]?.args.message, "Error: refus");
  });

  it("retirer l'installation retire les écouteurs ; ensuite plus rien n'est envoyé", () => {
    const fenetre = fauxNavigateur();
    const { appels, envoyer } = enregistreur();
    const retirer = installerJournalErreurs(fenetre, envoyer);
    assert.equal(fenetre.nombre("error"), 1);
    retirer();
    assert.equal(fenetre.nombre("error"), 0);
    assert.equal(fenetre.nombre("unhandledrejection"), 0);
    fenetre.declencher("error", { message: "après" });
    assert.equal(appels.length, 0);
  });

  it("une boucle d'erreurs est limitée à 20 par minute, puis reprend", () => {
    const fenetre = fauxNavigateur();
    const { appels, envoyer } = enregistreur();
    let horloge = 1_000;
    installerJournalErreurs(fenetre, envoyer, () => horloge);
    for (let i = 0; i < 100; i += 1) fenetre.declencher("error", { message: `boucle ${String(i)}` });
    assert.equal(appels.length, ENTREES_MAX_PAR_MINUTE);
    // Essai négatif : la fenêtre écoulée, l'erreur suivante est de nouveau consignée.
    horloge += 61_000;
    fenetre.declencher("error", { message: "après la minute" });
    assert.equal(appels.length, ENTREES_MAX_PAR_MINUTE + 1);
  });

  it("un envoi qui échoue, de façon synchrone ou asynchrone, ne provoque aucune exception", async () => {
    const fenetre = fauxNavigateur();
    installerJournalErreurs(fenetre, () => Promise.reject(new Error("hors Tauri")));
    fenetre.declencher("error", { message: "x" });
    installerJournalErreurs(fenetre, () => {
      throw new Error("invoke indisponible");
    });
    fenetre.declencher("error", { message: "y" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(true, "aucune exception ni rejet non géré");
  });
});
