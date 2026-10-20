#!/usr/bin/env node
/**
 * S7 — le moteur de boîtes ne perd pas un message arrivé entre la relève et l'armement de la veille
 * (cause d'un échec intermittent de `j11-invitation.mjs` : « message non relevé en 60 s » ; seuil de ce banc ramené à 30 s le 20/10/2026).
 *
 * La fenêtre est élargie de façon déterministe : un verrou SQL retient l'écriture de la note de relève
 * (`moteur_connexions`) après que le moteur a lu la boîte. Un message déposé pendant ce blocage n'est
 * ni dans l'instantané de la relève, ni annoncé par une veille qui n'existait pas encore, si la veille
 * est armée après la relève (ancien ordre) : il attendait alors la relève périodique de 10 minutes.
 * La veille est maintenant armée AVANT la relève : le dépôt la réveille et le message est relevé.
 *
 *  - variante A (fenêtre) : dépôt pendant le blocage → relevé en moins de 30 s ;
 *  - variante B (témoin)  : dépôt après l'armement, verrou levé → relevé aussi (le banc sait voir un réveil).
 *
 * Dovecot d'imap-test (QRESYNC : le réveil de la veille déclenche la relève). Données fictives.
 * Usage : node tests/recette/s7-moteur-fenetre.mjs
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { conteneur, connecterAuReseauApi, agirImap, MOT_IMAP_TEST } from "./lib/moteur-mail.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`s7-moteur-fenetre: FAIL — ${message}`);
  process.exit(1);
}

async function variante(nom, jeton, dovecot) {
  const marque = randomUUID().slice(0, 8);
  const id = randomUUID();
  const messageId = `<fenetre-${nom}-${marque}@legalos.test>`;
  const deposer = () =>
    agirImap({ hote: "127.0.0.1", port: 1143, utilisateur: `fenetre-${nom}-${marque}`, action: "ajouter", uid: "1", messageId, sujet: `fenetre ${nom}` });
  // Retient l'écriture de moteur_connexions 24 s (les INSERT du moteur attendent).
  const verrou = spawn(
    "docker",
    ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", "exec", "-T", "postgres", "psql", "-U", "legalos", "-d", "legalos", "-c",
      "BEGIN; LOCK TABLE moteur_connexions IN SHARE MODE; SELECT pg_sleep(24); COMMIT;"],
    { cwd: racineInstance(), stdio: "ignore" },
  );
  try {
    await sleep(2500);
    const creation = await fetch(`${api}/messagerie/comptes`, {
      method: "POST",
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: JSON.stringify({
        id, adresse: `fenetre.${nom}.${marque}@cabinet.example`, hote: dovecot, port: 143,
        utilisateur: `fenetre-${nom}-${marque}`, mot_de_passe: MOT_IMAP_TEST, tls: false,
      }),
    });
    if (!creation.ok) fail(`compte (${nom}) → ${creation.status}`);
    // Dovecot accepte tout identifiant : la boîte `fenetre-…` est neuve, donc vide ; le moteur la lit
    // dans les 5 s, puis reste bloqué sur l'écriture de sa note jusqu'à la fin du verrou.
    await sleep(nom === "A" ? 14_000 : 30_000);
    deposer();
    const depot = Date.now();
    while (Date.now() - depot < 30_000) {
      if ((await sqlServeur(`SELECT COUNT(*) FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`)) === "1") {
        return Math.round((Date.now() - depot) / 1000);
      }
      await sleep(1500);
    }
    return null;
  } finally {
    verrou.kill();
    for (let essai = 0; essai < 3; essai += 1) {
      try {
        await sqlServeur(`DELETE FROM messages WHERE compte_id = '${id}'; DELETE FROM comptes_mail WHERE id = '${id}'`);
        break;
      } catch {
        await sleep(1000);
      }
    }
  }
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const dovecot = conteneur("legalos-imap-test-dovecot")[0];
  if (!dovecot) fail("Dovecot d'imap-test absent : docker compose -f instance/imap-test/docker-compose.yml up -d --wait");
  connecterAuReseauApi(dovecot);
  const jeton = await demoAccessToken(api, `s7-moteur-fenetre-${randomUUID().slice(0, 8)}`);
  const temoin = await variante("B", jeton, dovecot);
  if (temoin === null) fail("témoin (dépôt après l'armement) : message non relevé en 30 s, le banc ne voit pas un réveil");
  const fenetre = await variante("A", jeton, dovecot);
  if (fenetre === null) {
    fail("message déposé entre la relève et l'armement de la veille : non relevé en 30 s (attend la relève périodique)");
  }
  console.log(`s7-moteur-fenetre: OK — témoin relevé en ${temoin} s, message de la fenêtre relevé en ${fenetre} s`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
