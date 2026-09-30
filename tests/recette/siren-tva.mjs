#!/usr/bin/env node
/**
 * Dette avant Facturation, suite : SIREN (Luhn) et n° TVA FR
 * à la saisie sur le poste et dans l'API. Messages en français.
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { verifierSirenTva } from "../../apps/poste/src/dossiers/identifiants.ts";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const siren = "100000009";
const tva = "FR88100000009";

function fail(message) {
  console.error(`siren-tva: FAIL — ${message}`);
  process.exit(1);
}

async function poster(jeton, corps) {
  const reponse = await fetch(`${api}/contacts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { statut: reponse.status, texte };
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const jeton = await demoAccessToken(api, `siren-${randomUUID().slice(0, 8)}`);

  try {
    verifierSirenTva("123456789");
    fail("le poste accepte un SIREN sans clé de Luhn");
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message !== "SIREN invalide.") fail(`message poste SIREN : ${message}`);
  }
  try {
    verifierSirenTva(siren, "FR00100000009");
    fail("le poste accepte une clé de TVA fausse");
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message !== "Numéro de TVA invalide.") fail(`message poste TVA : ${message}`);
  }
  verifierSirenTva(siren, tva);

  const mauvais = await poster(jeton, {
    id: randomUUID(),
    idempotence_cle: `siren-mauvais-${randomUUID()}`,
    nature: "morale",
    nom: "Societe fictive invalide",
    siren: "123456789",
    type_client: "professionnel",
  });
  if (mauvais.statut !== 400 || !mauvais.texte.includes("SIREN invalide.")) {
    fail(`API SIREN ${mauvais.statut}`);
  }
  const tvaFausse = await poster(jeton, {
    id: randomUUID(),
    idempotence_cle: `siren-tva-${randomUUID()}`,
    nature: "morale",
    nom: "Societe fictive tva",
    siren,
    numero_tva: "FR00100000009",
    type_client: "professionnel",
  });
  if (tvaFausse.statut !== 400 || !tvaFausse.texte.includes("Numéro de TVA invalide.")) {
    fail(`API TVA ${tvaFausse.statut}`);
  }
  const bon = await poster(jeton, {
    id: randomUUID(),
    idempotence_cle: `siren-bon-${randomUUID()}`,
    nature: "morale",
    nom: "Societe fictive valide",
    siren,
    numero_tva: tva,
    type_client: "professionnel",
  });
  if (bon.statut !== 200) fail(`API paire valide ${bon.statut} ${bon.texte.slice(0, 160)}`);
  console.log("siren-tva: OK poste et API, messages en français");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
