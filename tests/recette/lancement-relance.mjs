#!/usr/bin/env node
/**
 * Relance unique d'un lancement d'application (dette conflits-poste-tauri, décision du 10/10/2026).
 * Sans application ni service : la signature « #root vide, sans erreur JavaScript, Vite répond » et le
 * compteur de relances (une seule relance, échec à la deuxième, aucun autre échec relancé).
 * Usage : node tests/recette/lancement-relance.mjs
 */
import assert from "node:assert/strict";
import {
  creerCollecteur,
  creerRelanceUnique,
  EchecLancement,
  estSignatureRootVide,
  MAX_RELANCES,
} from "./lib/lancement.mjs";

let verifications = 0;
function verifie(nom, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`lancement-relance: FAIL — ${nom} : ${err.message}`);
    process.exit(1);
  }
  verifications += 1;
}

async function verifieAsync(nom, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`lancement-relance: FAIL — ${nom} : ${err.message}`);
    process.exit(1);
  }
  verifications += 1;
}

const signature = { racine: 0, erreurs: [], viteRepond: true };

// ——— signature ———
verifie("signature complète reconnue", () => assert.equal(estSignatureRootVide(signature), true));
verifie("#root monté : pas la signature", () =>
  assert.equal(estSignatureRootVide({ ...signature, racine: 1 }), false));
verifie("#root introuvable (null) : pas la signature", () =>
  assert.equal(estSignatureRootVide({ ...signature, racine: null }), false));
verifie("erreur JavaScript : pas la signature", () =>
  assert.equal(estSignatureRootVide({ ...signature, erreurs: ["exception: boom"] }), false));
verifie("Vite ne répond pas : pas la signature", () =>
  assert.equal(estSignatureRootVide({ ...signature, viteRepond: false }), false));
verifie("mode build (pas de Vite) : jamais la signature", () =>
  assert.equal(estSignatureRootVide({ ...signature, modeBuild: true }), false));

// ——— collecteur d'événements ———
verifie("collecteur : exception, console.error, journal d'erreur et réseau comptés", () => {
  const c = creerCollecteur();
  c.traiter({ method: "Runtime.exceptionThrown", params: { exceptionDetails: { text: "Uncaught", exception: { description: "Error: boom" } } } });
  c.traiter({ method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ value: "oups" }] } });
  c.traiter({ method: "Log.entryAdded", params: { entry: { level: "error", text: "Failed to load resource", url: "http://localhost:1420/src/main.tsx" } } });
  c.traiter({ method: "Network.responseReceived", params: { response: { status: 504, url: "http://localhost:1420/node_modules/.vite/deps/react.js" } } });
  c.traiter({ method: "Network.requestWillBeSent", params: { requestId: "7", request: { url: "http://localhost:1420/src/App.tsx" } } });
  c.traiter({ method: "Network.loadingFailed", params: { requestId: "7", errorText: "net::ERR_ABORTED" } });
  assert.equal(c.erreurs.length, 5);
  assert.match(c.erreurs[4], /src\/App\.tsx/);
});
verifie("collecteur : favicon.ico 404, avertissements et console.log sont du bruit", () => {
  const c = creerCollecteur();
  c.traiter({ method: "Network.responseReceived", params: { response: { status: 404, url: "http://localhost:1420/favicon.ico" } } });
  c.traiter({ method: "Log.entryAdded", params: { entry: { level: "error", text: "Failed to load resource: 404", url: "http://localhost:1420/favicon.ico" } } });
  c.traiter({ method: "Log.entryAdded", params: { entry: { level: "warning", text: "[Intervention] x" } } });
  c.traiter({ method: "Runtime.consoleAPICalled", params: { type: "log", args: [{ value: "info" }] } });
  assert.equal(c.erreurs.length, 0);
});

// ——— relance unique ———
const sig = () => new EchecLancement("écran auth absent", { signatureRootVide: true });
const autre = () => new EchecLancement("écran auth absent (autre cause)", { signatureRootVide: false });

await verifieAsync("une signature, puis succès : une relance journalisée et comptée", async () => {
  const lignes = [];
  const r = creerRelanceUnique({ journal: (l) => lignes.push(l), etiquette: "essai" });
  let n = 0;
  const valeur = await r.lancer("poste a", async () => {
    n += 1;
    if (n === 1) throw sig();
    return "ouvert";
  });
  assert.equal(valeur, "ouvert");
  assert.equal(n, 2);
  assert.equal(r.relances, 1);
  assert.equal(lignes.length, 1);
  assert.match(lignes[0], /RELANCE 1\/1 \(poste a\)/);
});

await verifieAsync("la signature deux fois de suite : échec à la deuxième relance", async () => {
  const r = creerRelanceUnique({ journal: () => {} });
  let n = 0;
  await assert.rejects(
    r.lancer("poste a", async () => {
      n += 1;
      throw sig();
    }),
    /2 relances de lancement dans la même exécution/,
  );
  assert.equal(n, 2);
  assert.equal(r.relances, MAX_RELANCES);
});

await verifieAsync("le compteur est partagé : une relance par lancement, la deuxième de l'exécution échoue", async () => {
  const r = creerRelanceUnique({ journal: () => {} });
  let a = 0;
  await r.lancer("poste a", async () => {
    a += 1;
    if (a === 1) throw sig();
  });
  let b = 0;
  await assert.rejects(
    r.lancer("poste b", async () => {
      b += 1;
      if (b === 1) throw sig();
    }),
    /2 relances/,
  );
  assert.equal(b, 1, "le lancement de b n'est pas relancé une deuxième fois de l'exécution");
});

await verifieAsync("un échec de lancement sans signature n'est jamais relancé", async () => {
  const r = creerRelanceUnique({ journal: () => {} });
  let n = 0;
  await assert.rejects(r.lancer("poste a", async () => { n += 1; throw autre(); }), /autre cause/);
  assert.equal(n, 1);
  assert.equal(r.relances, 0);
});

await verifieAsync("une erreur quelconque (non EchecLancement) n'est jamais relancée", async () => {
  const r = creerRelanceUnique({ journal: () => {} });
  let n = 0;
  await assert.rejects(r.lancer("poste a", async () => { n += 1; throw new Error("conflit non signalé"); }), /conflit non signalé/);
  assert.equal(n, 1);
  assert.equal(r.relances, 0);
});

await verifieAsync("aucun échec : aucune relance", async () => {
  const r = creerRelanceUnique({ journal: () => {} });
  assert.equal(await r.lancer("poste a", async () => 42), 42);
  assert.equal(r.relances, 0);
});

console.log(`lancement-relance: OK — ${verifications} vérifications (signature, collecteur, relance unique, essais négatifs)`);
