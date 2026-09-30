#!/usr/bin/env node
/**
 * S7 / J9 étape 3 — boîte nominative contre GreenMail.
 * Relève incrémentale, IDLE, resynchronisation si l'UIDVALIDITY change,
 * lu / déplacement / suppression / drapeau, HTML nettoyé, recherche.
 */
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const smtpPort = Number(process.env.LEGALOS_SMTP_PORT ?? "13025");
const boite = "demo@cabinet.example";

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

  const premiere = await json("/messagerie/nominatif/relever", jeton, "POST");
  if (premiere.chemin !== "repli" && premiere.chemin !== "qresync") {
    fail(`chemin inconnu ${premiere.chemin}`);
  }

  const mot = `fenetre${randomUUID().slice(0, 8)}`;
  const secret = `jeton${randomUUID().slice(0, 8)}`;
  const mid = `<s7-sync-${randomUUID()}@cabinet.example>`;
  const midSuppr = `<s7-sync-del-${randomUUID()}@cabinet.example>`;
  const html = `<p>${mot}</p><script>${secret}</script><img src="https://exemple.test/pixel.png">`;

  const attente = json("/messagerie/nominatif/attendre", jeton, "POST");
  await sleep(1500);
  await envoyerSmtp({
    de: "tiers@example.com",
    a: boite,
    messageId: mid,
    html,
  });
  await envoyerSmtp({
    de: "tiers@example.com",
    a: boite,
    messageId: midSuppr,
    html: "<p>a supprimer</p>",
  });
  const notif = await attente;
  if (!notif.notifie) fail("aucune notification sur la boîte de réception");

  const releve = await json("/messagerie/nominatif/relever", jeton, "POST");
  if (!releve.resynchronisation && releve.ajoutes < 1) {
    fail(`relève incrémentale vide (ajoutes=${releve.ajoutes})`);
  }
  const contenu = await json(
    `/messagerie/nominatif/contenu?message_id=${encodeURIComponent(mid)}`,
    jeton,
  );
  if (contenu.html.toLowerCase().includes("script")) fail("script conservé");
  if (contenu.html.includes("exemple.test")) fail("image distante conservée");
  if (!contenu.texte.includes(mot)) fail("texte utile absent");
  if (contenu.texte.includes(secret)) fail("jeton de script indexé");

  const trouves = await json(
    `/messagerie/nominatif/recherche?q=${encodeURIComponent(mot)}`,
    jeton,
  );
  if (!trouves.some((m) => m.message_id === mid)) fail("recherche serveur muette");
  const secrets = await json(
    `/messagerie/nominatif/recherche?q=${encodeURIComponent(secret)}`,
    jeton,
  );
  if (secrets.some((m) => m.message_id === mid)) fail("recherche serveur a indexé le script");
  if (fts5(contenu.texte, mot) !== 1) fail("FTS5 hors ligne muet");
  if (fts5(contenu.texte, secret) !== 0) fail("FTS5 a indexé le script");

  const uid = contenu.uid;
  const lu = await json("/messagerie/nominatif/lu", jeton, "POST", { uid, lu: true });
  if (!lu.applique || !lu.lu) fail("marquage lu refusé");
  const drapeau = await json("/messagerie/nominatif/drapeau", jeton, "POST", {
    uid,
    drapeau: "\\Flagged",
  });
  if (!drapeau.applique) fail("drapeau refusé");
  const refus = await json("/messagerie/nominatif/drapeau", jeton, "POST", {
    uid,
    drapeau: "\\Recent",
  });
  if (refus.applique) fail("le drapeau \\Recent a été accepté");
  if (!refus.lu) fail("l'état réel n'a pas été relu après refus");

  const aSupprimer = await json(
    `/messagerie/nominatif/contenu?message_id=${encodeURIComponent(midSuppr)}`,
    jeton,
  );
  const suppr = await json("/messagerie/nominatif/supprimer", jeton, "POST", {
    uid: aSupprimer.uid,
  });
  if (!suppr.applique) fail("suppression refusée");

  const deplace = await json("/messagerie/nominatif/deplacer", jeton, "POST", {
    uid,
    destination: "Archives",
  });
  if (!deplace.applique) fail("déplacement refusé");

  await sqlServeur(
    "UPDATE releve_curseurs SET uid_validity = 0 WHERE dossier_imap = 'INBOX'",
  );
  const reprise = await json("/messagerie/nominatif/relever", jeton, "POST");
  if (!reprise.resynchronisation) fail("changement d'UIDVALIDITY sans resynchronisation");
  const encore = await json(
    `/messagerie/nominatif/contenu?message_id=${encodeURIComponent(mid)}`,
    jeton,
  );
  if (!encore.texte.includes(mot)) fail("resynchronisation a perdu le message");

  console.log(`s7-synchro: OK chemin=${premiere.chemin} idle=${notif.chemin}`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
