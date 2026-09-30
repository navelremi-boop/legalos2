#!/usr/bin/env node
/**
 * Documents phase 2 — arborescence, divergence, texte docx/pdf contre l'instance réelle.
 * Usage : node tests/recette/documents-arborescence.mjs
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const fixtures = join(root, "tests/recette/fixtures");

function fail(message) {
  console.error(`documents-arborescence: FAIL — ${message}`);
  process.exit(1);
}

function empreinte(octets) {
  return createHash("sha256").update(octets).digest("hex");
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
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : {};
}

async function statut(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { status: reponse.status, corps: texte ? JSON.parse(texte) : {} };
}

async function deposer(url, octets) {
  const reponse = await fetch(url, { method: "PUT", body: octets });
  if (!reponse.ok) fail(`dépôt → ${reponse.status}`);
}

const sante = await fetch(`${instance}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const jeton = await demoAccessToken(api, "documents-arborescence");
const dossierId = randomUUID();
await json("/dossiers", jeton, "POST", {
  id: dossierId,
  idempotence_cle: `${dossierId}:dossier`,
  nom: "Dossier arborescence fictif",
  chemise: "kraft",
  juridiction: "TJ de Lyon",
  numero_rg: `RG${String(Date.now()).slice(-6)}`,
  restreint: false,
});

const racineId = randomUUID();
await json("/repertoires", jeton, "POST", {
  id: racineId,
  dossier_id: dossierId,
  parent_id: null,
  nom: "Pieces",
  idempotence_cle: `${racineId}:creer`,
});
const enfantId = randomUUID();
await json("/repertoires", jeton, "POST", {
  id: enfantId,
  dossier_id: dossierId,
  parent_id: racineId,
  nom: "Courriers",
  idempotence_cle: `${enfantId}:creer`,
});
const cycle = await statut(`/repertoires/${racineId}`, jeton, "PATCH", {
  base_revision: 1,
  idempotence_cle: `${racineId}:cycle`,
  parent_id: enfantId,
});
if (cycle.status !== 400) fail(`refus de cycle attendu, reçu ${cycle.status}`);
console.log("documents-arborescence: enfant + refus de cycle");

const docx = readFileSync(join(fixtures, "piece-fictive.docx"));
const pdf = readFileSync(join(fixtures, "sans-texte.pdf"));

const docDocx = randomUUID();
const depot1 = await json("/documents", jeton, "POST", {
  id: docDocx,
  dossier_id: dossierId,
  repertoire_id: enfantId,
  nom: "piece-fictive.docx",
  idempotence_cle: `${docDocx}:creer`,
});
await deposer(depot1.url, docx);
const sceau1 = await json(`/documents/${docDocx}/versions/1/sceller`, jeton, "POST", {
  empreinte: empreinte(docx),
  idempotence_cle: `${docDocx}:v1`,
});
if (!sceau1.parent_numero && sceau1.parent_numero !== null) fail("parent_numero absent");
if (sceau1.divergence !== false) fail("divergence v1 doit être false");

const depotA = await json(`/documents/${docDocx}/versions`, jeton, "POST", {
  base_numero: 1,
});
const depotB = await json(`/documents/${docDocx}/versions`, jeton, "POST", {
  base_numero: 1,
});
if (depotA.numero === depotB.numero) fail("numéros concurrentiels identiques");
await deposer(depotA.url, Buffer.from("branche-a-fictive"));
await deposer(depotB.url, Buffer.from("branche-b-fictive"));
const sceauA = await json(
  `/documents/${docDocx}/versions/${depotA.numero}/sceller`,
  jeton,
  "POST",
  { empreinte: empreinte(Buffer.from("branche-a-fictive")), idempotence_cle: `${docDocx}:a` },
);
const sceauB = await json(
  `/documents/${docDocx}/versions/${depotB.numero}/sceller`,
  jeton,
  "POST",
  { empreinte: empreinte(Buffer.from("branche-b-fictive")), idempotence_cle: `${docDocx}:b` },
);
if (sceauA.parent_numero !== 1 || sceauB.parent_numero !== 1) {
  fail("parent_numero des branches");
}
if (!sceauB.divergence) fail("divergence attendue sur la seconde branche");
const sceauAApres = await json(
  `/documents/${docDocx}/versions/${depotA.numero}/sceller`,
  jeton,
  "POST",
  { empreinte: empreinte(Buffer.from("branche-a-fictive")), idempotence_cle: `${docDocx}:a-relecture` },
);
if (!sceauAApres.divergence) fail("divergence attendue sur la premiere branche apres la seconde");
console.log("documents-arborescence: divergence conservée");

const docPdf = randomUUID();
const depotPdf = await json("/documents", jeton, "POST", {
  id: docPdf,
  dossier_id: dossierId,
  nom: "sans-texte.pdf",
  idempotence_cle: `${docPdf}:creer`,
});
await deposer(depotPdf.url, pdf);
await json(`/documents/${docPdf}/versions/1/sceller`, jeton, "POST", {
  empreinte: empreinte(pdf),
  idempotence_cle: `${docPdf}:v1`,
});
console.log(
  "documents-arborescence: OK — arborescence, divergence, scellements docx/pdf (texte vérifié côté Rust)",
);
