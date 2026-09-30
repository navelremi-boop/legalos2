#!/usr/bin/env node
/**
 * Synchronisation dans les deux sens, hors LEGAL OS.
 * GreenMail : repli, sans CHANGEDSINCE. Dovecot : QRESYNC, CHANGEDSINCE.
 * Puis le poste voit le lu. Mesure 50 000 sur le moteur réel, chaque chemin.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import {
  MOT_IMAP_TEST,
  agirImap,
  connecterAuReseauApi,
  conteneur,
  envoyerSmtp,
  attendreSql,
} from "./lib/moteur-mail.mjs";
import { creerSession, sqliteLocal, sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`s7-sync-bidirectionnelle: FAIL — ${message}`);
  process.exit(1);
}

async function creerCompte(jeton, { id, hote, port, adresse, utilisateur = "capa" }) {
  const reponse = await fetch(`${api}/messagerie/comptes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id,
      adresse,
      hote,
      port,
      utilisateur,
      mot_de_passe: MOT_IMAP_TEST,
      tls: false,
    }),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`compte → ${reponse.status} ${texte.slice(0, 180)}`);
  if (texte.includes(MOT_IMAP_TEST)) fail("mot de passe dans la réponse HTTP");
}

async function reflet({ id, messageId, hote, port, action, predicat, utilisateur = "capa", delai = 45_000 }) {
  const uid = await sqlServeur(
    `SELECT uid FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`,
  );
  if (!uid) fail(`uid absent pour ${action}`);
  agirImap({ hote, port, utilisateur, action, uid });
  try {
    await attendreSql(
      `SELECT COALESCE(string_agg(dossier_imap || ':' || lu::text || ':' || array_to_string(drapeaux, ' '), '|'), '') FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`,
      predicat,
      delai,
    );
  } catch (err) {
    const etat = await sqlServeur(
      `SELECT COALESCE(string_agg(dossier_imap || ':' || lu::text || ':' || array_to_string(drapeaux, ' '), '|'), 'absent') FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`,
    ).catch(() => "illisible");
    fail(`${action} non reflété (${etat}) ${err instanceof Error ? err.message : ""}`);
  }
}

async function cheminDistinct(id, attendu, interdit) {
  const ligne = await sqlServeur(
    `SELECT chemin || ' ' || commandes FROM releve_curseurs WHERE compte_id = '${id}' AND dossier_imap = 'INBOX'`,
  );
  if (!ligne.includes(attendu)) fail(`chemin ${attendu} absent (${ligne})`);
  if (interdit && ligne.includes(interdit)) fail(`commande interdite sur ce serveur (${ligne})`);
  return ligne;
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const greenmail = conteneur("legalos-imap-test-greenmail")[0];
  const dovecot = conteneur("legalos-imap-test-dovecot")[0];
  if (!greenmail || !dovecot) fail("serveurs IMAP de test absents");
  connecterAuReseauApi(greenmail);
  connecterAuReseauApi(dovecot);
  spawnSync("docker", ["restart", greenmail], { stdio: "inherit" });
  await sleep(8000);
  agirImap({ hote: "127.0.0.1", port: 3143, utilisateur: "capa", action: "creer", uid: "1" });
  spawnSync("docker", ["exec", dovecot, "mkdir", "-p", "/tmp/mail/essai/cur", "/tmp/mail/essai/new", "/tmp/mail/essai/tmp"]);
  spawnSync("docker", ["exec", dovecot, "chown", "-R", "dovecot:dovecot", "/tmp/mail/essai"]);
  agirImap({ hote: "127.0.0.1", port: 1143, utilisateur: "essai", action: "creer", uid: "1" });

  const marque = randomUUID().slice(0, 8);
  const jeton = await demoAccessToken(api, `s7-sync-${marque}`);
  const idRepli = randomUUID();
  const idQresync = randomUUID();
  await creerCompte(jeton, {
    id: idRepli,
    hote: greenmail,
    port: 3143,
    adresse: `repli.${marque}@cabinet.example`,
  });
  await creerCompte(jeton, {
    id: idQresync,
    hote: dovecot,
    port: 143,
    adresse: `qresync.${marque}@cabinet.example`,
    utilisateur: "essai",
  });

  const midLu = `<s7-lu-${marque}@legalos.test>`;
  const midMove = `<s7-move-${marque}@legalos.test>`;
  const midSuppr = `<s7-suppr-${marque}@legalos.test>`;
  await envoyerSmtp({ port: 3025, de: "tiers@example.com", a: "capa", messageId: midLu, sujet: "lu" });
  await envoyerSmtp({ port: 3025, de: "tiers@example.com", a: "capa", messageId: midMove, sujet: "deplacer" });
  await envoyerSmtp({ port: 3025, de: "tiers@example.com", a: "capa", messageId: midSuppr, sujet: "supprimer" });
  await attendreSql(
    `SELECT COUNT(*) FROM messages WHERE compte_id = '${idRepli}' AND message_id IN ('${midLu}', '${midMove}', '${midSuppr}')`,
    (v) => v === "3",
    40_000,
  );

  await reflet({
    id: idRepli,
    messageId: midLu,
    hote: "127.0.0.1",
    port: 3143,
    action: "drapeaux",
    predicat: (v) => v.includes(":t:") || v.includes(":true:"),
  });
  const lu = await sqlServeur(
    `SELECT lu::text || ' ' || array_to_string(drapeaux, ' ') FROM messages WHERE compte_id = '${idRepli}' AND message_id = '${midLu}'`,
  );
  if (!lu.startsWith("t") && !lu.startsWith("true")) fail(`lu non reflété (${lu})`);
  if (!/Flag/i.test(lu)) fail(`drapeau non reflété (${lu})`);
  await reflet({
    id: idRepli,
    messageId: midMove,
    hote: "127.0.0.1",
    port: 3143,
    action: "deplacer",
    predicat: (v) => v.startsWith("Sent:"),
  });
  await reflet({
    id: idRepli,
    messageId: midSuppr,
    hote: "127.0.0.1",
    port: 3143,
    action: "supprimer",
    predicat: (v) => v === "",
  });
  await cheminDistinct(idRepli, "repli", "CHANGEDSINCE");

  const midQ = `<s7-q-${marque}@legalos.test>`;
  const midQDel = `<s7-qdel-${marque}@legalos.test>`;
  agirImap({
    hote: "127.0.0.1",
    port: 1143,
    utilisateur: "essai",
    action: "ajouter",
    uid: "1",
    messageId: midQ,
    sujet: "qresync",
  });
  agirImap({
    hote: "127.0.0.1",
    port: 1143,
    utilisateur: "essai",
    action: "ajouter",
    uid: "1",
    messageId: midQDel,
    sujet: "qresync-suppr",
  });
  await attendreSql(
    `SELECT COUNT(*) FROM messages WHERE compte_id = '${idQresync}' AND message_id IN ('${midQ}', '${midQDel}')`,
    (v) => v === "2",
    40_000,
  );
  await reflet({
    id: idQresync,
    messageId: midQ,
    hote: "127.0.0.1",
    port: 1143,
    utilisateur: "essai",
    action: "drapeaux",
    predicat: (v) => v.includes(":t:") || v.includes(":true:"),
  });
  await cheminDistinct(idQresync, "qresync", null);
  const trace = await sqlServeur(
    `SELECT commandes FROM releve_curseurs WHERE compte_id = '${idQresync}' AND dossier_imap = 'INBOX'`,
  );
  if (!trace.includes("CHANGEDSINCE")) fail(`QRESYNC sans CHANGEDSINCE (${trace})`);
  await reflet({
    id: idQresync,
    messageId: midQDel,
    hote: "127.0.0.1",
    port: 1143,
    utilisateur: "essai",
    action: "supprimer",
    predicat: (v) => v === "",
  });

  const session = creerSession("s7-sync");
  spawnSync("docker", ["restart", conteneur("legalos-instance-powersync")[0] ?? "legalos-instance-powersync-1"], {
    stdio: "inherit",
  });
  await sleep(8000);
  session.resetPostes(["s7sync"]);
  const poste = session.startApp("s7sync", 9344);
  try {
    await session.waitCdp(poste);
    const cdp = await session.connectCdp(poste.port);
    await session.login(cdp.send, demoEmail, demoPassword, totpSecretB32, `Poste sync ${marque}`);
    const debutPoste = Date.now();
    let luPoste = "";
    while (Date.now() - debutPoste < 90_000) {
      try {
        luPoste = await sqliteLocal("s7sync", `SELECT lu FROM messages WHERE message_id = '${midLu}'`);
        if (luPoste === "1") break;
      } catch {
        luPoste = "";
      }
      await sleep(1000);
    }
    if (luPoste !== "1") throw new Error(`poste sans le lu (${luPoste})`);
    const drapeauxPoste = await sqliteLocal(
      "s7sync",
      `SELECT drapeaux_texte FROM messages WHERE message_id = '${midLu}'`,
    );
    if (!/Flag/i.test(drapeauxPoste)) throw new Error(`poste sans le drapeau (${drapeauxPoste})`);
  } finally {
    session.stopApp(poste);
    session.fermer();
  }

  await retirerComptes(`'${idRepli}', '${idQresync}'`);
  await mesurer("qresync", dovecot, 143, "127.0.0.1", 1143, preparerDovecot);
  await mesurer("repli", "legalos-dovecot-repli", 143, "127.0.0.1", 2143, preparerRepli);
  console.log("s7-sync-bidirectionnelle: OK repli et QRESYNC, reflet sur le poste");
}

async function attendreSante() {
  const debut = Date.now();
  while (Date.now() - debut < 90_000) {
    const etat = await fetch(`${instance}/health`).catch(() => null);
    if (etat?.ok) return;
    await sleep(1000);
  }
  fail("api absente après redémarrage");
}

function preparerDovecot() {
  const nom = conteneur("legalos-imap-test-dovecot")[0];
  const copie = spawnSync(
    "docker",
    ["cp", join(root, "tests/recette/generer-volume.pl"), `${nom}:/tmp/generer-volume.pl`],
    { encoding: "utf8" },
  );
  if (copie.status !== 0) fail("copie du générateur");
  const perl = spawnSync("docker", ["exec", nom, "perl", "/tmp/generer-volume.pl"], { encoding: "utf8" });
  if (perl.status !== 0) fail(perl.stderr?.slice(0, 200) || "générateur");
  spawnSync("docker", ["exec", nom, "chown", "-R", "dovecot:dovecot", "/tmp/mail/capa"]);
}

function preparerRepli() {
  const nom = "legalos-dovecot-repli";
  spawnSync("docker", ["rm", "-f", nom], { encoding: "utf8" });
  const lance = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      nom,
      "-p",
      "127.0.0.1:2143:143",
      "-v",
      `${join(root, "instance/imap-test/dovecot-repli.conf")}:/etc/dovecot/dovecot.conf:ro`,
      "--entrypoint",
      "sh",
      "dovecot/dovecot:2.3.21.1",
      "-c",
      "mkdir -p /tmp/mail/capa && chown -R dovecot:dovecot /tmp/mail && exec dovecot -F",
    ],
    { encoding: "utf8" },
  );
  if (lance.status !== 0) fail(lance.stderr?.slice(0, 300) || "dovecot repli");
  connecterAuReseauApi(nom);
  const copie = spawnSync(
    "docker",
    ["cp", join(root, "tests/recette/generer-volume.pl"), `${nom}:/tmp/generer-volume.pl`],
    { encoding: "utf8" },
  );
  if (copie.status !== 0) fail("copie du générateur repli");
  const perl = spawnSync("docker", ["exec", nom, "perl", "/tmp/generer-volume.pl"], { encoding: "utf8" });
  if (perl.status !== 0) fail(perl.stderr?.slice(0, 200) || "générateur repli");
  spawnSync("docker", ["exec", nom, "chown", "-R", "dovecot:dovecot", "/tmp/mail/capa"]);
  const script = [
    "import imaplib, os, time",
    "boite = None",
    "for _ in range(20):",
    "    try:",
    "        boite = imaplib.IMAP4('127.0.0.1', 2143)",
    "        boite.login('capa', os.environ['IMAP_SECRET'])",
    "        break",
    "    except Exception:",
    "        time.sleep(0.5)",
    "if boite is None:",
    "    raise SystemExit('repli injoignable')",
    "caps = b' '.join(boite.capability()[1]).upper()",
    "boite.logout()",
    "if b'QRESYNC' in caps:",
    "    raise SystemExit('QRESYNC encore annonce')",
    "print('repli')",
  ].join("\n");
  const verif = spawnSync("python", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, IMAP_SECRET: MOT_IMAP_TEST },
  });
  if (verif.status !== 0) fail(verif.stderr?.slice(0, 300) || verif.stdout?.slice(0, 200) || "capacite repli");
}

async function mesurer(libelle, hoteApi, portApi, hoteImap, portImap, preparer) {
  preparer();
  await retirerComptes(
    `SELECT id FROM comptes_mail WHERE adresse LIKE 'capa.%@cabinet.example' OR adresse LIKE 'repli.%@cabinet.example' OR adresse LIKE 'qresync.%@cabinet.example' OR adresse LIKE '${libelle}.%@cabinet.example'`,
  );
  const apiNom = conteneur("legalos-instance-api")[0];
  spawnSync("docker", ["restart", apiNom], { stdio: "inherit" });
  await attendreSante();
  const id = randomUUID();
  const jeton = await demoAccessToken(api, `s7-volume-${libelle}`);
  const debut = Date.now();
  await creerCompte(jeton, {
    id,
    hote: hoteApi,
    port: portApi,
    adresse: `${libelle}.${id.slice(0, 8)}@cabinet.example`,
  });
  let n = "0";
  const limite = Date.now() + 20 * 60 * 1000;
  while (Date.now() < limite) {
    n = await sqlServeur(`SELECT COUNT(*) FROM messages WHERE compte_id = '${id}'`);
    if (Number(n) >= 50_000) break;
    await sleep(2000);
  }
  if (Number(n) < 50_000) fail(`${libelle} : ${n} messages en base`);
  const initial = Date.now() - debut;
  const messageId = `<vol-${libelle}-${id.slice(0, 8)}@legalos.test>`;
  const avant = Date.now();
  agirImap({
    hote: hoteImap,
    port: portImap,
    utilisateur: "capa",
    action: "ajouter",
    uid: "1",
    messageId,
    sujet: "volume",
  });
  await attendreSql(
    `SELECT COUNT(*) FROM messages WHERE compte_id = '${id}' AND message_id = '${messageId}'`,
    (v) => v === "1",
    120_000,
  );
  const reveil = Date.now() - avant;
  console.log(`MESURE ${libelle} initial_ms=${initial} reveil_ms=${reveil} messages=${n}`);
  await retirerComptes(`'${id}'`);
}

async function retirerComptes(listeOuSelect) {
  const sous = listeOuSelect.trim().startsWith("SELECT")
    ? listeOuSelect
    : `SELECT id FROM comptes_mail WHERE id IN (${listeOuSelect})`;
  await sqlServeur(
    `BEGIN; DELETE FROM file_envoi WHERE compte_id IN (${sous}); DELETE FROM messages WHERE compte_id IN (${sous}); DELETE FROM comptes_mail WHERE id IN (${sous}); COMMIT;`,
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
