#!/usr/bin/env node
/**
 * Étape 3 : compte nominatif. Secret chiffré côté serveur.
 * Essai négatif : le mot de passe n'est pas dans la réponse HTTP.
 * Le SQLite du poste est couvert par s7-poste-tauri.mjs.
 */
import { randomUUID } from "node:crypto";
import { accessToken, demoAccessToken } from "./lib/demo-auth.mjs";
import { sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`s7-compte-nominatif: FAIL — ${message}`);
  process.exit(1);
}

async function creer(jeton, corps) {
  const reponse = await fetch(`${api}/messagerie/comptes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(20_000),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`POST compte → ${reponse.status} ${texte.slice(0, 180)}`);
  if (texte.includes(corps.mot_de_passe)) fail("mot de passe dans la réponse HTTP");
  return JSON.parse(texte);
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const marque = randomUUID().slice(0, 8);
  const jetonDemo = await demoAccessToken(api, `s7-compte-${marque}`);
  const emailCollab = `s7-compte-${marque}@cabinet-fictif.example`;
  const motCollab = "MotDePasseCollab123!";
  const totpCollab = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
  const creation = await fetch(`${api}/collaborateurs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jetonDemo}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: emailCollab,
      password: motCollab,
      totp_secret_base32: totpCollab,
    }),
  });
  if (!creation.ok) fail(`collaborateur → ${creation.status}`);
  const collab = await creation.json();
  const jetonCollab = await accessToken(api, {
    email: emailCollab,
    password: motCollab,
    totpSecret: totpCollab,
    nomAppareil: `s7-compte-b-${marque}`,
  });
  const motDemo = `SentinelleDemo${marque}`;
  const motAutre = `SentinelleAutre${marque}`;
  const idDemo = randomUUID();
  const idAutre = randomUUID();
  const compteDemo = await creer(jetonDemo, {
    id: idDemo,
    adresse: `demo.${marque}@cabinet.example`,
    hote: "injoignable.example",
    port: 143,
    utilisateur: `demo-${marque}`,
    mot_de_passe: motDemo,
    tls: false,
  });
  const compteAutre = await creer(jetonCollab, {
    id: idAutre,
    adresse: `autre.${marque}@cabinet.example`,
    hote: "injoignable.example",
    port: 143,
    utilisateur: `autre-${marque}`,
    mot_de_passe: motAutre,
    tls: false,
  });
  if (compteDemo.adresse === compteAutre.adresse) fail("les deux boîtes ne sont pas distinctes");
  const secretDemo = await sqlServeur(
    `SELECT CASE WHEN secret_chiffre IS NULL THEN 'absent' WHEN position('${motDemo}' in secret_chiffre) > 0 THEN 'clair' ELSE 'chiffre' END FROM comptes_mail WHERE id = '${idDemo}'`,
  );
  if (secretDemo !== "chiffre") fail(`secret démo ${secretDemo}`);
  const secretAutre = await sqlServeur(
    `SELECT CASE WHEN secret_chiffre IS NULL THEN 'absent' WHEN position('${motAutre}' in secret_chiffre) > 0 THEN 'clair' ELSE 'chiffre' END FROM comptes_mail WHERE id = '${idAutre}'`,
  );
  if (secretAutre !== "chiffre") fail(`secret collaborateur ${secretAutre}`);
  const titulaires = await sqlServeur(
    `SELECT COUNT(DISTINCT titulaire_id) FROM comptes_mail WHERE id IN ('${idDemo}', '${idAutre}')`,
  );
  if (titulaires !== "2") fail(`titulaires ${titulaires}`);
  const titulaireDemo = await sqlServeur(`SELECT titulaire_id FROM comptes_mail WHERE id = '${idDemo}'`);
  const idCollab = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${emailCollab}'`);
  if (titulaireDemo === idCollab) fail("le compte démo appartient au collaborateur");
  if (collab.id && collab.id !== idCollab) fail("identifiant collaborateur incohérent");
  console.log("s7-compte-nominatif: OK deux titulaires, secret chiffré, absent de la réponse");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
