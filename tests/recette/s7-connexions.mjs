#!/usr/bin/env node
/**
 * Dettes avant le premier compte réel (B8).
 * Temporisation, arrêt après refus, session unique, IDLE avant 29 min,
 * CONDSTORE sans QRESYNC, compte modifié ou supprimé.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import {
  MOT_IMAP_TEST,
  agirImap,
  connecterAuReseauApi,
  conteneur,
} from "./lib/moteur-mail.mjs";
import { sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const root = join(import.meta.dirname, "../..");

function fail(message) {
  console.error(`s7-connexions: FAIL — ${message}`);
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
  });
  if (!reponse.ok) fail(`compte ${reponse.status}`);
  const texte = await reponse.text();
  if (texte.includes("mauvais-mot") || texte.includes(MOT_IMAP_TEST)) fail("secret dans la réponse");
}

async function attendre(sql, predicat, delai = 25_000) {
  const debut = Date.now();
  let valeur = "";
  while (Date.now() - debut < delai) {
    valeur = await sqlServeur(sql);
    if (predicat(valeur)) return valeur;
    await sleep(400);
  }
  fail(`attente ${valeur}`);
}

function lancerCondstore() {
  const nom = "legalos-dovecot-condstore";
  spawnSync("docker", ["rm", "-f", nom], { encoding: "utf8" });
  const lance = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      nom,
      "-p",
      "127.0.0.1:3144:143",
      "-v",
      `${join(root, "instance/imap-test/dovecot-condstore.conf")}:/etc/dovecot/dovecot.conf:ro`,
      "--entrypoint",
      "sh",
      "dovecot/dovecot:2.3.21.1",
      "-c",
      "mkdir -p /tmp/mail/cond && chown -R dovecot:dovecot /tmp/mail && exec dovecot -F",
    ],
    { encoding: "utf8" },
  );
  if (lance.status !== 0) fail(lance.stderr?.slice(0, 300) || "dovecot condstore");
  connecterAuReseauApi(nom);
  return nom;
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const greenmail = conteneur("legalos-imap-test-greenmail")[0];
  if (!greenmail) fail("greenmail de test absent");
  connecterAuReseauApi(greenmail);
  await sqlServeur(
    "DELETE FROM moteur_connexions WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'cx.%@cabinet.example')",
  );
  await sqlServeur("DELETE FROM messages WHERE compte_id IN (SELECT id FROM comptes_mail WHERE adresse LIKE 'cx.%@cabinet.example')");
  await sqlServeur("DELETE FROM comptes_mail WHERE adresse LIKE 'cx.%@cabinet.example'");

  const jeton = await demoAccessToken(api, `cx-${randomUUID().slice(0, 8)}`);
  const refuse = randomUUID();
  await creer(jeton, {
    id: refuse,
    adresse: `cx.refuse.${refuse.slice(0, 8)}@cabinet.example`,
    hote: greenmail,
    port: 3143,
    utilisateur: "capa",
    mot_de_passe: "mauvais-mot",
    tls: false,
  });
  await attendre(
    `SELECT etat_connexion FROM comptes_mail WHERE id = '${refuse}'`,
    (v) => v === "identifiants_refuses",
  );
  const essaisRefus = await sqlServeur(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${refuse}' AND issue = 'authentification'`,
  );
  if (essaisRefus !== "1") fail(`refus ${essaisRefus}`);
  await sleep(8_000);
  const apres = await sqlServeur(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${refuse}'`,
  );
  if (apres !== "1") fail(`boucle après refus ${apres}`);

  const ferme = randomUUID();
  await creer(jeton, {
    id: ferme,
    adresse: `cx.ferme.${ferme.slice(0, 8)}@cabinet.example`,
    hote: "127.0.0.1",
    port: 1,
    utilisateur: "capa",
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
  });
  await attendre(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${ferme}' AND issue = 'connexion'`,
    (v) => Number(v) >= 2,
    20_000,
  );
  const ecart = await sqlServeur(
    `SELECT EXTRACT(EPOCH FROM (MAX(cree_le) - MIN(cree_le)))::int FROM moteur_connexions WHERE compte_id = '${ferme}' AND issue = 'connexion'`,
  );
  if (Number(ecart) < 1) fail(`sans délai ${ecart}`);

  const bon = randomUUID();
  await creer(jeton, {
    id: bon,
    adresse: `cx.bon.${bon.slice(0, 8)}@cabinet.example`,
    hote: greenmail,
    port: 3143,
    utilisateur: "capa",
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
  });
  await attendre(
    `SELECT commandes FROM releve_curseurs WHERE compte_id = '${bon}' AND commandes LIKE '%IDLE 1680%'`,
    (v) => v.includes("IDLE 1680") && v.includes("session "),
  );
  const sessions = await sqlServeur(
    `SELECT COUNT(DISTINCT substring(commandes from 'session [0-9a-f-]+')) FROM releve_curseurs WHERE compte_id = '${bon}' AND commandes LIKE '%session %'`,
  );
  if (sessions !== "1") fail(`sessions ${sessions}`);
  if ((await sqlServeur(`SELECT commandes FROM releve_curseurs WHERE compte_id = '${bon}' AND dossier_imap = 'INBOX'`)).includes("CHANGEDSINCE")) {
    fail("GreenMail ne doit pas émettre CHANGEDSINCE");
  }
  const okAvant = await sqlServeur(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${bon}' AND issue = 'ok'`,
  );
  await sleep(8_000);
  const okApres = await sqlServeur(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${bon}' AND issue = 'ok'`,
  );
  if (Number(okApres) > Number(okAvant) + 1) fail(`boucle de connexion ${okAvant} → ${okApres}`);

  await sqlServeur(`DELETE FROM comptes_mail WHERE id = '${bon}'`);
  await sleep(25_000);
  const okSupprime = await sqlServeur(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${bon}' AND issue = 'ok'`,
  );
  if (okSupprime !== okApres) fail(`tâche encore active après suppression ${okSupprime}`);

  const modifie = randomUUID();
  await creer(jeton, {
    id: modifie,
    adresse: `cx.modifie.${modifie.slice(0, 8)}@cabinet.example`,
    hote: greenmail,
    port: 3143,
    utilisateur: "capa",
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
  });
  await attendre(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${modifie}' AND issue = 'ok'`,
    (v) => Number(v) >= 1,
  );
  await sqlServeur(`UPDATE comptes_mail SET port = 1 WHERE id = '${modifie}'`);
  await attendre(
    `SELECT COUNT(*) FROM moteur_connexions WHERE compte_id = '${modifie}' AND issue = 'connexion'`,
    (v) => Number(v) >= 1,
    40_000,
  );

  const condstore = lancerCondstore();
  const mid = `<cx-${randomUUID().slice(0, 8)}@legalos.test>`;
  agirImap({
    hote: "127.0.0.1",
    port: 3144,
    utilisateur: "cond",
    action: "ajouter",
    uid: "1",
    sujet: "condstore",
    messageId: mid,
  });
  const idCond = randomUUID();
  await creer(jeton, {
    id: idCond,
    adresse: `cx.cond.${idCond.slice(0, 8)}@cabinet.example`,
    hote: condstore,
    port: 143,
    utilisateur: "cond",
    mot_de_passe: MOT_IMAP_TEST,
    tls: false,
  });
  await attendre(
    `SELECT commandes FROM releve_curseurs WHERE compte_id = '${idCond}' AND commandes LIKE '%UID SEARCH%'`,
    (v) => v.includes("UID SEARCH") && !v.includes("QRESYNC"),
    40_000,
  );
  await attendre(
    `SELECT destinataires_texte FROM messages WHERE compte_id = '${idCond}' AND message_id = '${mid}'`,
    (v) => v.includes("capa@localhost"),
    20_000,
  );
  const midPiece = `<cx-piece-${randomUUID().slice(0, 8)}@legalos.test>`;
  agirImap({
    hote: "127.0.0.1",
    port: 3144,
    utilisateur: "cond",
    action: "ajouter_piece",
    uid: "1",
    sujet: "piece",
    messageId: midPiece,
  });
  await attendre(
    `SELECT pieces_texte FROM messages WHERE compte_id = '${idCond}' AND message_id = '${midPiece}'`,
    (v) => v.includes("Convocation.pdf"),
    40_000,
  );
  const idPiece = (
    await sqlServeur(
      `SELECT id::text FROM messages WHERE compte_id = '${idCond}' AND message_id = '${midPiece}'`,
    )
  ).trim();
  const avantCorps = await sqlServeur(
    `SELECT texte_brut FROM messages WHERE id = '${idPiece}'`,
  );
  if (avantCorps.includes("convocation fictive")) fail("corps relevé avec les en-têtes");
  const corpsRep = await fetch(`${api}/messagerie/messages/${idPiece}/corps`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}` },
  });
  if (!corpsRep.ok) fail(`corps ${corpsRep.status}`);
  const corpsJson = await corpsRep.json();
  if (
    typeof corpsJson.texte !== "string" ||
    !corpsJson.texte.includes("Texte de la convocation fictive.")
  ) {
    fail("corps absent de la réponse");
  }
  const apresCorps = await sqlServeur(`SELECT texte_brut FROM messages WHERE id = '${idPiece}'`);
  if (!apresCorps.includes("Texte de la convocation fictive.")) fail("corps non enregistré");
  agirImap({
    hote: "127.0.0.1",
    port: 3144,
    utilisateur: "cond",
    action: "drapeaux",
    uid: "1",
  });
  await attendre(
    `SELECT commandes FROM releve_curseurs WHERE compte_id = '${idCond}' AND commandes LIKE '%CHANGEDSINCE%'`,
    (v) => v.includes("FETCH CHANGEDSINCE") && v.includes("UID SEARCH") && !v.includes("QRESYNC"),
    40_000,
  );
  console.log("s7-connexions: OK");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
