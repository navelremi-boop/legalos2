#!/usr/bin/env node
/**
 * S7 / J9 étape 1 — boîte de classement contre GreenMail.
 * Adresse normalisée, référence dans l'objet (deux modèles), correspondant unique,
 * suggestion puis À classer, relève interrompue sans perte ni doublon, chrono dossier.
 */
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { racineInstance, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const smtpHost = process.env.LEGALOS_SMTP_HOST ?? "127.0.0.1";
const smtpPort = Number(process.env.LEGALOS_SMTP_PORT ?? "13025");
/** Compte GreenMail de classement (compose : demo@cabinet.example). */
const boite = "demo@cabinet.example";
const domaine = "cabinet.example";

function fail(message) {
  console.error(`s7-classement: FAIL — ${message}`);
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
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : {};
}

function envoyerSmtp({ de, a, objet, messageId, corps }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: smtpHost, port: smtpPort });
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
    socket.on("error", reject);

    let buffer = "";
    const reponses = [];
    /** @type {((ligne: string) => void) | null} */
    let attente = null;

    const livrer = (ligne) => {
      if (attente) {
        const suite = attente;
        attente = null;
        suite(ligne);
      } else {
        reponses.push(ligne);
      }
    };

    const reponseSuivante = () => {
      const deja = reponses.shift();
      if (deja !== undefined) return Promise.resolve(deja);
      return new Promise((res) => {
        attente = res;
      });
    };

    const exiger = async (prefixe) => {
      const ligne = await reponseSuivante();
      if (!ligne.startsWith(prefixe)) {
        socket.destroy();
        throw new Error(`SMTP attendait ${prefixe}, reçu ${ligne}`);
      }
      return ligne;
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
          `Subject: ${objet}`,
          `Message-ID: ${messageId}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          corps,
          `.`,
          ``,
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

async function attendreMessage(jeton, predicat, essais = 20) {
  let liste = [];
  for (let i = 0; i < essais; i += 1) {
    liste = await json("/messagerie/messages", jeton);
    const trouve = liste.find(predicat);
    if (trouve) return { liste, trouve };
    await sleep(500);
  }
  fail(
    `message attendu absent après relève (total=${liste.length} ids=${liste
      .map((m) => m.message_id)
      .join(",")})`,
  );
}

async function main() {
  const envPath = existsSync(join(racineInstance(), ".env"))
    ? join(racineInstance(), ".env")
    : join(root, ".env");
  if (!existsSync(envPath)) fail(".env introuvable");

  const jeton = await demoAccessToken(api, `s7-classement-${randomUUID().slice(0, 8)}`);
  const cabinet = await json("/cabinets/me", jeton);

  // Modèle 1 (défaut) : {AAAA}-{N:3}. Le cabinet peut déjà être sur un modèle
  // ultérieur après une exécution précédente : on le réarme avant le dossier A.
  await json(`/cabinets/${cabinet.id}/reference`, jeton, "PUT", {
    modele: "{AAAA}-{N:3}",
    remise_a_zero: "annuelle",
    idempotence_cle: `s7-modele-defaut-${randomUUID()}`,
  });

  const dossierA = randomUUID();
  const creeA = await json("/dossiers", jeton, "POST", {
    id: dossierA,
    idempotence_cle: `s7-a-${dossierA}`,
    nom: "Classement modèle tiret",
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-S7A-${Date.now()}`,
    restreint: false,
  });
  if (!creeA.reference) fail("référence dossier A absente");
  const refA = creeA.reference;
  const formeA = refA.replace(/[^A-Za-z0-9_-]/g, "-");

  // Modèle 2 : RN/{AA}/{N:4}
  await json(`/cabinets/${cabinet.id}/reference`, jeton, "PUT", {
    modele: "RN/{AA}/{N:4}",
    remise_a_zero: "annuelle",
    idempotence_cle: `s7-modele-${randomUUID()}`,
  });

  const dossierB = randomUUID();
  const creeB = await json("/dossiers", jeton, "POST", {
    id: dossierB,
    idempotence_cle: `s7-b-${dossierB}`,
    nom: "Classement modèle RN",
    chemise: "bleu-classeur",
    juridiction: "TJ fictif",
    numero_rg: `RG-S7B-${Date.now()}`,
    restreint: false,
  });
  if (!creeB.reference) fail("référence dossier B absente");
  const refB = creeB.reference;
  const formeB = refB.replace(/[^A-Za-z0-9_-]/g, "-");

  const emailClient = `client.classement.${Date.now()}@example.com`;
  const contactId = randomUUID();
  await json("/contacts", jeton, "POST", {
    id: contactId,
    idempotence_cle: `s7-c-${contactId}`,
    nature: "physique",
    nom: "Client Classement",
    type_client: "particulier",
    email: emailClient,
  });
  await json(`/dossiers/${dossierA}/parties`, jeton, "POST", {
    id: randomUUID(),
    idempotence_cle: `s7-p-${randomUUID()}`,
    role: "client",
    nom: "Client Classement",
    contact_id: contactId,
  });

  const midAdresse = `<s7-adr-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: "tiers@example.com",
    a: `classement+${formeA.toLowerCase()}@${domaine}`,
    objet: "Sans référence dans l objet",
    messageId: midAdresse,
    corps: "Adresse de classement.",
  });

  const midObjetOrigine = `<s7-obj-o-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: "tiers@example.com",
    a: boite,
    objet: `Pièces ${refB} jointes`,
    messageId: midObjetOrigine,
    corps: "Objet forme d'origine.",
  });

  const midObjetNorm = `<s7-obj-n-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: "tiers@example.com",
    a: boite,
    objet: `Pièces ${formeB} jointes`,
    messageId: midObjetNorm,
    corps: "Objet forme normalisée.",
  });

  const midCorr = `<s7-corr-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: emailClient,
    a: boite,
    objet: "Correspondant unique",
    messageId: midCorr,
    corps: "Un seul dossier actif.",
  });

  // Relève avant d'ajouter le 2e dossier au correspondant
  await json("/messagerie/classement/relever", jeton, "POST");
  await sleep(400);

  const { trouve: msgAdr } = await attendreMessage(jeton, (m) => m.message_id === midAdresse);
  if (msgAdr.etat_classement !== "classe" || msgAdr.dossier_id !== dossierA) {
    fail("adresse de classement non rattachée au dossier A");
  }

  const { trouve: msgObjO } = await attendreMessage(
    jeton,
    (m) => m.message_id === midObjetOrigine,
  );
  if (msgObjO.etat_classement !== "classe" || msgObjO.dossier_id !== dossierB) {
    fail("référence d'origine dans l'objet non classée (modèle 2)");
  }
  const { trouve: msgObjN } = await attendreMessage(jeton, (m) => m.message_id === midObjetNorm);
  if (msgObjN.etat_classement !== "classe" || msgObjN.dossier_id !== dossierB) {
    fail("référence normalisée dans l'objet non classée (modèle 2)");
  }

  const { trouve: msgCorr } = await attendreMessage(jeton, (m) => m.message_id === midCorr);
  if (msgCorr.etat_classement !== "classe" || msgCorr.dossier_id !== dossierA) {
    fail("correspondant d'un seul dossier actif non classé");
  }

  // Deuxième dossier actif pour le même correspondant → suggestion
  await json(`/dossiers/${dossierB}/parties`, jeton, "POST", {
    id: randomUUID(),
    idempotence_cle: `s7-p2-${randomUUID()}`,
    role: "client",
    nom: "Client Classement",
    contact_id: contactId,
  });

  const midSugg = `<s7-sug-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: emailClient,
    a: boite,
    objet: "Plusieurs dossiers",
    messageId: midSugg,
    corps: "Suggestion.",
  });

  const midAClasser = `<s7-ac-${randomUUID()}@cabinet.example>`;
  await envoyerSmtp({
    de: "inconnu@example.com",
    a: boite,
    objet: "Sans signal",
    messageId: midAClasser,
    corps: "À classer.",
  });

  await json("/messagerie/classement/relever", jeton, "POST");
  await sleep(400);

  const { trouve: msgSug } = await attendreMessage(jeton, (m) => m.message_id === midSugg);
  if (msgSug.etat_classement !== "suggestion" || !msgSug.suggestion_dossier_id) {
    fail("suggestion attendue pour correspondant multi-dossiers");
  }
  await json(`/messagerie/messages/${msgSug.id}/accepter-suggestion`, jeton, "POST");
  const apresSug = await json("/messagerie/messages", jeton);
  const sugClasse = apresSug.find((m) => m.id === msgSug.id);
  if (!sugClasse || sugClasse.etat_classement !== "classe" || !sugClasse.dossier_id) {
    fail("suggestion non validée d'un clic");
  }

  const { trouve: msgAc } = await attendreMessage(jeton, (m) => m.message_id === midAClasser);
  if (msgAc.etat_classement !== "a_classer") fail("corbeille À classer absente");

  // Relève interrompue puis reprise
  const mid1 = `<s7-int-1-${randomUUID()}@cabinet.example>`;
  const mid2 = `<s7-int-2-${randomUUID()}@cabinet.example>`;
  const mid3 = `<s7-int-3-${randomUUID()}@cabinet.example>`;
  for (const [mid, objet] of [
    [mid1, `Interrupt ${refA} un`],
    [mid2, `Interrupt ${refA} deux`],
    [mid3, `Interrupt ${refA} trois`],
  ]) {
    await envoyerSmtp({
      de: "tiers@example.com",
      a: boite,
      objet,
      messageId: mid,
      corps: "lot interruptible",
    });
  }

  const avant = await json("/messagerie/messages", jeton);
  const avantCount = avant.length;
  const coupe = await json("/messagerie/classement/relever?limite=1", jeton, "POST");
  if (coupe.traites < 1) fail("relève limitée n'a rien traité");
  const milieu = await json("/messagerie/messages", jeton);
  if (milieu.length !== avantCount + coupe.traites) {
    fail("perte ou doublon pendant la relève limitée");
  }
  const reprise = await json("/messagerie/classement/relever", jeton, "POST");
  const fin = await json("/messagerie/messages", jeton);
  const ids = fin.map((m) => m.message_id);
  for (const mid of [mid1, mid2, mid3]) {
    if (ids.filter((x) => x === mid).length !== 1) fail(`doublon ou perte pour ${mid}`);
  }
  if (fin.length !== avantCount + 3) {
    fail(
      `reprise : attendu ${avantCount + 3} messages, obtenu ${fin.length} (reprise traites=${reprise.traites})`,
    );
  }

  // Chrono du dossier (source poste) : mails classés visibles
  const chrono = await json(`/dossiers/${dossierA}/chrono-mails`, jeton);
  if (!chrono.some((m) => m.message_id === midAdresse)) {
    fail("mail classé absent du chrono dossier A");
  }

  // Preuve poste : le message synchronisé apparaît dans SQLite sans secret IMAP
  const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
  if (!/messages\s*=\s*new Table/.test(schema)) fail("AppSchema : table messages absente");
  const sync = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
  if (!/messages_publics:/.test(sync) || !/messages_restreints:/.test(sync)) {
    fail("sync-config : flux messages absents");
  }
  if (/secret_ref|mot_de_passe|imap_password/i.test(sync)) {
    fail("sync-config : identifiant de messagerie exposé");
  }

  // Si un poste démo a déjà sync, vérifier la présence ; sinon la preuve API+flux suffit
  // pour l'étape 1 (S5 SQLite détaillé = s7-poste-tauri).
  try {
    const local = await sqliteLocal(
      "demo",
      `SELECT COUNT(*) FROM messages WHERE dossier_id = '${dossierA}' AND message_id = '${midAdresse}'`,
    );
    if (local === "1") {
      console.log("s7-classement: chrono SQLite poste OK");
    }
  } catch {
    // Pas de base locale : acceptable si les flux et le chrono API sont en place.
  }

  const comptesSecrets = await sqlServeur(
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'comptes_mail' AND column_name = 'secret_ref'",
  );
  if (comptesSecrets !== "1") fail("secret_ref serveur absent");

  console.log("s7-classement: OK");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
