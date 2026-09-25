#!/usr/bin/env node
/**
 * S6 — déposer, ouvrir, modifier : la nouvelle version est renvoyée et l'ancienne reste.
 * Garage réel. Ne journalise aucun secret (pas d'URL présignée complète).
 */
import { createHash, randomUUID } from "node:crypto";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const garageAttendu = process.env.LEGALOS_GARAGE_PUBLIC ?? "http://127.0.0.1:3900";

function fail(message) {
  console.error(`s6: FAIL — ${message}`);
  process.exit(1);
}

function empreinte(octets) {
  return createHash("sha256").update(octets).digest("hex");
}

/** Origine + chemin uniquement (sans query : signatures présignées). */
function cibleStockage(urlTexte) {
  let u;
  try {
    u = new URL(urlTexte);
  } catch {
    fail("URL de stockage illisible");
  }
  return { origine: u.origin, chemin: u.pathname };
}

function exigerGarage(urlTexte, contexte) {
  const { origine, chemin } = cibleStockage(urlTexte);
  const attendu = new URL(garageAttendu).origin;
  if (origine !== attendu) {
    fail(`${contexte} : stockage hors Garage (${origine}, attendu ${attendu})`);
  }
  return chemin;
}

async function json(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 180)}`);
  return texte ? JSON.parse(texte) : {};
}

async function deposer(url, octets) {
  const reponse = await fetch(url, { method: "PUT", body: octets });
  if (!reponse.ok) fail(`dépôt S3 → ${reponse.status}`);
}

async function lire(url) {
  const reponse = await fetch(url);
  if (!reponse.ok) fail(`lecture S3 → ${reponse.status}`);
  return Buffer.from(await reponse.arrayBuffer());
}

const sante = await fetch(`${instance}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const jeton = await demoAccessToken(api, "s6-documents");
const dossierId = randomUUID();
await json("/dossiers", jeton, "POST", {
  id: dossierId,
  idempotence_cle: `${dossierId}:dossier`,
  nom: "Dossier pièces fictives",
  chemise: "bleu-classeur",
  juridiction: "TJ de Lyon",
  numero_rg: `RG${String(Date.now()).slice(-6)}`,
  restreint: false,
});

const documentId = randomUUID();
const v1 = Buffer.from("contenu fictif version 1");
const depot1 = await json("/documents", jeton, "POST", {
  id: documentId,
  dossier_id: dossierId,
  nom: "note-fictive.txt",
  idempotence_cle: `${documentId}:creer`,
});
if (depot1.numero !== 1 || depot1.methode !== "PUT") fail("dépôt initial inattendu");
const chemin1 = exigerGarage(depot1.url, "dépôt v1");
if (!chemin1.includes(`/documents/${documentId}/v1`)) {
  fail("clé objet v1 absente du chemin de dépôt");
}
await deposer(depot1.url, v1);
const sceau1 = await json(`/documents/${documentId}/versions/1/sceller`, jeton, "POST", {
  empreinte: empreinte(v1),
  idempotence_cle: `${documentId}:v1`,
});
if (sceau1.taille !== v1.length) fail("taille v1");
if (sceau1.empreinte !== empreinte(v1)) fail("empreinte v1");

const lien1 = await json(`/documents/${documentId}/versions/1`, jeton, "GET");
const cheminLecture1 = exigerGarage(lien1.url, "lecture v1");
if (cheminLecture1 !== chemin1) fail("chemin lecture v1 ≠ dépôt v1");
const relu1 = await lire(lien1.url);
if (!relu1.equals(v1)) fail("ouverture v1 différente");
console.log("s6: document déposé et ouvert (Garage)");

const v2 = Buffer.from("contenu fictif version 2, modifié");
const depot2 = await json(`/documents/${documentId}/versions`, jeton, "POST");
if (depot2.numero !== 2) fail(`version suivante ${depot2.numero}`);
const chemin2 = exigerGarage(depot2.url, "dépôt v2");
if (!chemin2.includes(`/documents/${documentId}/v2`)) {
  fail("clé objet v2 absente du chemin de dépôt");
}
if (chemin2 === chemin1) fail("clé objet v2 identique à v1 (écrasement)");
await deposer(depot2.url, v2);
const sceau2 = await json(`/documents/${documentId}/versions/2/sceller`, jeton, "POST", {
  empreinte: empreinte(v2),
  idempotence_cle: `${documentId}:v2`,
});
if (sceau2.empreinte === sceau1.empreinte) fail("empreintes v1/v2 identiques");
if (sceau2.numero !== 2) fail("numéro scellé v2");

const encoreLien1 = await json(`/documents/${documentId}/versions/1`, jeton, "GET");
const lien2 = await json(`/documents/${documentId}/versions/2`, jeton, "GET");
const cheminEncore1 = exigerGarage(encoreLien1.url, "relecture v1");
const cheminLecture2 = exigerGarage(lien2.url, "lecture v2");
if (cheminEncore1 === cheminLecture2) fail("chemins lecture v1 et v2 confondus");
if (cheminLecture2 !== chemin2) fail("chemin lecture v2 ≠ dépôt v2");

const encore1 = await lire(encoreLien1.url);
const relu2 = await lire(lien2.url);
if (!encore1.equals(v1)) fail("la version 1 a été écrasée");
if (!relu2.equals(v2)) fail("la version 2 n'est pas le contenu modifié");
console.log(
  "s6: OK — nouvelles clés distinctes (v1/v2), contenus conservés sur Garage",
);
