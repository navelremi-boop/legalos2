#!/usr/bin/env node
/**
 * Moteur permanent : un mail arrive sans poste, il est en base en moins de 30 s.
 * Essai négatif : avant l'enregistrement du compte, rien n'est relevé.
 * Coupure du moteur puis relance : pas de doublon.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import {
  MOT_IMAP_TEST,
  agirImap,
  connecterAuReseauApi,
  conteneur,
  envoyerSmtp,
  attendreSql,
} from "./lib/moteur-mail.mjs";
import { sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`s7-moteur: FAIL — ${message}`);
  process.exit(1);
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const greenmail = conteneur("legalos-imap-test-greenmail")[0];
  const apiNom = conteneur("legalos-instance-api")[0];
  if (!greenmail || !apiNom) fail("greenmail de test ou api absents");
  await sqlServeur(
    `DELETE FROM messages WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'capa.%@cabinet.example')`,
  );
  await sqlServeur(`DELETE FROM comptes_mail WHERE adresse LIKE 'capa.%@cabinet.example'`);
  spawnSync("docker", ["restart", apiNom], { stdio: "inherit" });
  const attenteApi = Date.now();
  while (Date.now() - attenteApi < 60_000) {
    const etat = await fetch(`${instance}/health`).catch(() => null);
    if (etat?.ok) break;
    await sleep(1000);
  }
  connecterAuReseauApi(greenmail);
  agirImap({
    hote: "127.0.0.1",
    port: 3143,
    utilisateur: "capa",
    action: "creer",
    uid: "1",
  });
  const marque = randomUUID().slice(0, 8);
  const messageId = `<s7-moteur-${marque}@legalos.test>`;
  await envoyerSmtp({
    port: 3025,
    de: "tiers@example.com",
    a: "capa",
    messageId,
    sujet: "arrivee moteur",
  });
  await sleep(8000);
  const avant = await sqlServeur(
    `SELECT COUNT(*) FROM messages WHERE message_id = '${messageId}'`,
  );
  if (avant !== "0") fail("un compte non enregistré a reçu le message");
  const jeton = await demoAccessToken(api, `s7-moteur-${marque}`);
  const id = randomUUID();
  const debut = Date.now();
  const creation = await fetch(`${api}/messagerie/comptes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id,
      adresse: `capa.${marque}@cabinet.example`,
      hote: greenmail,
      port: 3143,
      utilisateur: "capa",
      mot_de_passe: MOT_IMAP_TEST,
      tls: false,
    }),
  });
  const texte = await creation.text();
  if (!creation.ok) fail(`compte → ${creation.status} ${texte.slice(0, 180)}`);
  if (texte.includes(MOT_IMAP_TEST)) fail("mot de passe dans la réponse HTTP");
  try {
    await attendreSql(
      `SELECT COUNT(*) FROM messages WHERE message_id = '${messageId}' AND compte_id = '${id}'`,
      (v) => v === "1",
      30_000,
    );
  } catch (err) {
    fail(`message absent après ${Date.now() - debut} ms (${err instanceof Error ? err.message : err})`);
  }
  const duree = Date.now() - debut;
  if (duree > 30_000) fail(`relevé en ${duree} ms`);
  const sent = await sqlServeur(
    `SELECT COUNT(*) FROM releve_curseurs WHERE compte_id = '${id}' AND dossier_imap IN ('Sent', 'Envoyés')`,
  );
  if (sent === "0") fail("aucun autre dossier relevé");
  const chemin = await sqlServeur(
    `SELECT chemin FROM releve_curseurs WHERE compte_id = '${id}' AND dossier_imap = 'INBOX'`,
  );
  if (chemin === "qresync") fail("chemin QRESYNC étiqueté sur GreenMail");
  spawnSync("docker", ["restart", apiNom], { stdio: "inherit" });
  const reprise = Date.now();
  while (Date.now() - reprise < 60_000) {
    const etat = await fetch(`${instance}/health`).catch(() => null);
    if (etat?.ok) break;
    await sleep(1000);
  }
  await sleep(20_000);
  const apres = await sqlServeur(
    `SELECT COUNT(*) FROM messages WHERE message_id = '${messageId}'`,
  );
  if (apres !== "1") fail(`doublon ou perte après reprise (${apres})`);
  console.log(`s7-moteur: OK en ${duree} ms, reprise sans doublon`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
