#!/usr/bin/env node
/**
 * S7 / J9 étape 3 — boîte de classement du cabinet contre GreenMail, par les routes actuelles de l'API
 * (`/messagerie/classement/relever`, `/messagerie/messages`, `…/corps`, `…/actions`, `/messagerie/recherche`).
 * Relève, resynchronisation si l'UIDVALIDITY change, HTML nettoyé, recherche, actions répercutées sur IMAP,
 * 50 000 messages (QRESYNC et repli, exemple `volume_50k`). Les routes `/messagerie/nominatif/*`, supprimées le
 * 24/10/2026, n'existent plus ; l'IDLE du moteur est éprouvé par `s7-moteur-fenetre.mjs`.
 */
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { creerClientImap } from "./lib/imap-controle.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const smtpPort = Number(process.env.LEGALOS_SMTP_PORT ?? "13025");
const boite = "demo@cabinet.example";

function motDePasseBoite() {
  if (process.env.LEGALOS_IMAP_PASSWORD) return process.env.LEGALOS_IMAP_PASSWORD;
  const chemin = join(racineInstance(), ".env");
  if (!existsSync(chemin)) fail(".env introuvable (GREENMAIL_PASSWORD)");
  const ligne = readFileSync(chemin, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("GREENMAIL_PASSWORD="));
  const valeur = ligne?.slice("GREENMAIL_PASSWORD=".length).trim();
  if (!valeur) fail("GREENMAIL_PASSWORD absent de .env");
  return valeur;
}

function fail(message) {
  console.error(`s7-synchro: FAIL — ${message}`);
  process.exit(1);
}

async function json(chemin, jeton, methode = "GET", corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(120_000),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : {};
}

function envoyerSmtp({ de, a, messageId, html }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: smtpPort });
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
    socket.on("error", reject);
    let buffer = "";
    const reponses = [];
    let attente = null;
    const livrer = (ligne) => {
      if (attente) {
        const suite = attente;
        attente = null;
        suite(ligne);
      } else reponses.push(ligne);
    };
    const suivante = () => {
      const deja = reponses.shift();
      if (deja !== undefined) return Promise.resolve(deja);
      return new Promise((res) => {
        attente = res;
      });
    };
    const exiger = async (prefixe) => {
      const ligne = await suivante();
      if (!ligne.startsWith(prefixe)) throw new Error(`SMTP ${ligne}`);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      while (buffer.includes("\n")) {
        const nl = buffer.indexOf("\n");
        const ligne = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (ligne.length >= 4 && ligne[3] === "-") continue;
        if (/^\d{3}( |$)/.test(ligne)) livrer(ligne);
      }
    });
    (async () => {
      await exiger("220");
      socket.write("EHLO legalos.test\r\n");
      await exiger("250");
      socket.write(`MAIL FROM:<${de}>\r\n`);
      await exiger("250");
      socket.write(`RCPT TO:<${boite}>\r\n`);
      await exiger("250");
      socket.write("DATA\r\n");
      await exiger("354");
      socket.write(
        [
          `From: ${de}`,
          `To: ${a}`,
          "Subject: Message nominatif",
          `Message-ID: ${messageId}`,
          "MIME-Version: 1.0",
          "Content-Type: text/html; charset=utf-8",
          "",
          html,
          ".",
          "",
        ].join("\r\n"),
      );
      await exiger("250");
      socket.write("QUIT\r\n");
      await exiger("221");
      socket.end();
      resolve();
    })().catch((err) => {
      socket.destroy();
      reject(err);
    });
  });
}

function fts5(texte, requete) {
  const schema = readFileSync(join(root, "apps/poste/src/sync/fts-mails.sql"), "utf8");
  const base = join(tmpdir(), `legalos-fts-${randomUUID()}.db`);
  const py = [
    "import sqlite3,sys",
    "c=sqlite3.connect(sys.argv[1])",
    "c.executescript(sys.argv[2])",
    "c.execute('INSERT INTO mails_fts(message_id, texte) VALUES (?, ?)', ('id', sys.argv[3]))",
    "n=c.execute('SELECT COUNT(*) FROM mails_fts WHERE mails_fts MATCH ?', (sys.argv[4],)).fetchone()[0]",
    "print(n)",
  ].join("\n");
  const run = spawnSync("python", ["-c", py, base, schema, texte, requete], {
    encoding: "utf8",
  });
  if (run.status !== 0) fail(`FTS5 ${run.stderr?.slice(0, 200) ?? run.status}`);
  return Number(run.stdout.trim());
}

async function main() {
  const envPath = existsSync(join(racineInstance(), ".env"))
    ? join(racineInstance(), ".env")
    : join(root, ".env");
  if (!existsSync(envPath)) fail(".env introuvable");
  const jeton = await demoAccessToken(api, `s7-synchro-${randomUUID().slice(0, 8)}`);

  const imap = creerClientImap({ hote: "127.0.0.1", port: 13143, login: "demo", secret: motDePasseBoite() });
  const demandes = { corps: (id) => `/messagerie/messages/${id}/corps`, actions: (id) => `/messagerie/messages/${id}/actions` };

  // Relève de la boîte de classement du cabinet (le moteur la relève en continu ; la route la force).
  const premiere = await json("/messagerie/classement/relever", jeton, "POST");
  if (typeof premiere.traites !== "number" || typeof premiere.total_messages !== "number") {
    fail(`réponse de relève inattendue ${JSON.stringify(premiere)}`);
  }

  const mot = `fenetre${randomUUID().slice(0, 8)}`;
  const secret = `jeton${randomUUID().slice(0, 8)}`;
  const mid = `<s7-sync-${randomUUID()}@cabinet.example>`;
  const midSuppr = `<s7-sync-del-${randomUUID()}@cabinet.example>`;
  const html = `<p>${mot}</p><script>${secret}</script><img src="https://exemple.test/pixel.png">`;

  await envoyerSmtp({ de: "tiers@example.com", a: boite, messageId: mid, html });
  await envoyerSmtp({ de: "tiers@example.com", a: boite, messageId: midSuppr, html: "<p>a supprimer</p>" });

  // Les deux messages deviennent lisibles par l'API une fois relevés (GreenMail n'a ni CONDSTORE ni QRESYNC : la
  // route force la relève, l'IDLE du moteur est éprouvé par `s7-moteur-fenetre.mjs`).
  const messageDe = async (messageId) => {
    const liste = await json("/messagerie/messages", jeton);
    return liste.find((m) => m.message_id === messageId) ?? null;
  };
  let message = null;
  let aSupprimer = null;
  for (let essai = 0; essai < 20 && (message === null || aSupprimer === null); essai += 1) {
    await json("/messagerie/classement/relever", jeton, "POST");
    message = await messageDe(mid);
    aSupprimer = await messageDe(midSuppr);
    if (message === null || aSupprimer === null) await sleep(1000);
  }
  if (message === null) fail("le message déposé n'est pas relevé");
  if (aSupprimer === null) fail("le second message déposé n'est pas relevé");

  // Corps : texte lu sur le serveur IMAP puis conservé ; HTML nettoyé conservé côté serveur.
  const corps = await json(demandes.corps(message.id), jeton, "POST");
  if (!corps.texte.includes(mot)) fail("texte utile absent");
  if (corps.texte.includes(secret)) fail("jeton de script indexé");
  const htmlConserve = await sqlServeur(`SELECT html_nettoye FROM contenus_messages WHERE message_id_ref = '${message.id}'`);
  if (htmlConserve === "") fail("HTML nettoyé non conservé");
  if (htmlConserve.toLowerCase().includes("script")) fail("script conservé");
  if (htmlConserve.includes("exemple.test")) fail("image distante conservée");
  if (!htmlConserve.includes(mot)) fail("texte utile absent du HTML nettoyé");

  // Recherche sur le serveur : le mot est trouvé, le jeton du script ne l'est pas.
  const trouves = await json(`/messagerie/recherche?q=${encodeURIComponent(mot)}`, jeton);
  if (!trouves.resultats.some((m) => m.id === message.id)) fail("recherche serveur muette");
  const secrets = await json(`/messagerie/recherche?q=${encodeURIComponent(secret)}`, jeton);
  if (secrets.resultats.some((m) => m.id === message.id)) fail("recherche serveur a indexé le script");
  if (fts5(corps.texte, mot) !== 1) fail("FTS5 hors ligne muet");
  if (fts5(corps.texte, secret) !== 0) fail("FTS5 a indexé le script");

  // Actions par message (file idempotente, répercutée sur IMAP) : lu, déplacement, suppression, et un genre inconnu refusé.
  const action = (id, genre, destination) =>
    json(demandes.actions(id), jeton, "POST", {
      genre,
      idempotence_cle: `s7-${genre}-${randomUUID()}`,
      ...(destination === undefined ? {} : { destination }),
    });
  // Lire le corps d'un message sur le serveur IMAP le marque lu (comportement du client de messagerie) : on le constate, puis
  // « non lu » l'enlève et « lu » le remet, chaque fois vérifié sur le serveur IMAP et jamais déduit de la réponse.
  const apresLecture = imap.drapeaux("INBOX", "Message-ID", mid);
  if (apresLecture.length !== 1 || !apresLecture[0].includes("\\Seen")) fail(`la lecture du corps n'a pas marqué le message lu ${JSON.stringify(apresLecture)}`);
  const nonLu = await action(message.id, "non_lu");
  if (nonLu.etat !== "appliquee") fail(`marquage non lu non appliqué ${JSON.stringify(nonLu)}`);
  const apresNonLu = imap.drapeaux("INBOX", "Message-ID", mid);
  if (apresNonLu.length !== 1 || apresNonLu[0].includes("\\Seen")) fail(`\\Seen encore présent après « non lu » ${JSON.stringify(apresNonLu)}`);
  const lu = await action(message.id, "lu");
  if (lu.etat !== "appliquee") fail(`marquage lu non appliqué ${JSON.stringify(lu)}`);
  const apresLu = imap.drapeaux("INBOX", "Message-ID", mid);
  if (apresLu.length !== 1 || !apresLu[0].includes("\\Seen")) fail(`\\Seen absent sur le serveur IMAP après « lu » ${JSON.stringify(apresLu)}`);
  const refus = await fetch(`${api}${demandes.actions(message.id)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({ genre: "drapeau", idempotence_cle: `s7-refus-${randomUUID()}` }),
    signal: AbortSignal.timeout(60_000),
  });
  if (refus.status !== 400) fail(`un genre d'action inconnu n'est pas refusé en 400 (${refus.status})`);

  const suppr = await action(aSupprimer.id, "supprimer");
  if (suppr.etat !== "appliquee") fail(`suppression non appliquée ${JSON.stringify(suppr)}`);
  if (imap.drapeaux("INBOX", "Message-ID", midSuppr).length !== 0) fail("le message supprimé est encore dans la réception");

  const deplace = await action(message.id, "deplacer", "Archives");
  if (deplace.etat !== "appliquee") fail(`déplacement non appliqué ${JSON.stringify(deplace)}`);
  if (imap.drapeaux("INBOX", "Message-ID", mid).length !== 0) fail("le message déplacé est encore dans la réception");
  if (imap.drapeaux("Archives", "Message-ID", mid).length !== 1) fail("le message déplacé est absent des archives");

  // Changement d'UIDVALIDITY : la relève repart de zéro sans perdre le message déjà relevé.
  await sqlServeur("UPDATE releve_curseurs SET uid_validity = 0 WHERE dossier_imap = 'INBOX'");
  await json("/messagerie/classement/relever", jeton, "POST");
  const apres = await messageDe(mid);
  if (apres === null) fail("resynchronisation a perdu le message");
  const encore = await json(demandes.corps(apres.id), jeton, "POST");
  if (!encore.texte.includes(mot)) fail("resynchronisation a perdu le texte du message");

  const composeVolume = join(root, "instance/imap-test/docker-compose.yml");
  const up = spawnSync(
    "docker",
    ["compose", "-f", composeVolume, "up", "-d", "dovecot"],
    { encoding: "utf8" },
  );
  if (up.status !== 0) fail(`dovecot ${up.stderr?.slice(0, 200) ?? up.status}`);
  const gen = spawnSync(
    "docker",
    [
      "cp",
      join(root, "tests/recette/generer-volume.pl"),
      "legalos-imap-test-dovecot-1:/tmp/generer-volume.pl",
    ],
    { encoding: "utf8" },
  );
  if (gen.status !== 0) fail("copie du générateur");
  const perl = spawnSync(
    "docker",
    ["exec", "legalos-imap-test-dovecot-1", "perl", "/tmp/generer-volume.pl"],
    { encoding: "utf8" },
  );
  if (perl.status !== 0) fail(perl.stderr?.slice(0, 200) || "générateur");
  spawnSync("docker", [
    "exec",
    "legalos-imap-test-dovecot-1",
    "chown",
    "-R",
    "dovecot:dovecot",
    "/tmp/mail/capa",
  ]);
  const mesure = spawnSync(
    "cargo",
    ["run", "-p", "legalos-messagerie", "--example", "volume_50k"],
    { cwd: root, encoding: "utf8" },
  );
  const sortie = `${mesure.stdout}\n${mesure.stderr}`;
  const ligne = sortie.match(/volume messages=(\d+) repli_ms=(\d+) qresync_ms=(\d+)/);
  if (mesure.status !== 0 || !ligne) {
    fail(`volume 50 000 ${sortie.slice(-400)}`);
  }
  if (Number(ligne[1]) < 50_000) fail(`volume ${ligne[1]} messages`);
  console.log(
    `s7-synchro: OK relevés=${premiere.total_messages} volume=${ligne[1]} repli_ms=${ligne[2]} qresync_ms=${ligne[3]}`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
