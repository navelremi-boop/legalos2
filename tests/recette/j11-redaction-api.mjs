#!/usr/bin/env node
/**
 * J11 étape 1a — rédaction côté API, contre l'instance et GreenMail.
 *
 * (a) modèles de message : table, routes, nettoyage du HTML, doublon refusé.
 * (d) en-têtes non injectables : un retour à la ligne dans l'objet ou dans une adresse est refusé
 *     (composition et file d'envoi), avec la même requête sans retour à la ligne acceptée.
 * (e) la copie cachée n'apparaît jamais dans les en-têtes reçus par les autres destinataires ;
 *     la copie « Envoyés » la garde ; l'enveloppe la porte (le destinataire caché reçoit).
 * (f) In-Reply-To et References posés ; « répondre à tous » exclut l'adresse de l'expéditeur ;
 *     le transfert garde les pièces et ne pose pas de fil.
 * Droits : un collaborateur ne lit ni ne modifie le brouillon ni la signature d'un autre, et ne
 * compose pas depuis un message d'une boîte nominative qui n'est pas la sienne.
 *
 * Aucun contenu de mail réel : adresses et textes fictifs. Prérequis : instance démarrée avec
 * GreenMail (IMAP 13143, SMTP 13025 sur l'hôte), `python` pour le client IMAP de contrôle.
 * Usage : node tests/recette/j11-redaction-api.mjs
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, demoAccessToken } from "./lib/demo-auth.mjs";
import { racineInstance, sleep, sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const imapHote = process.env.LEGALOS_IMAP_HOST ?? "127.0.0.1";
const imapPort = process.env.LEGALOS_IMAP_PORT ?? "13143";
/** Boîte de classement de l'instance (compose : demo@cabinet.example, identifiant « demo »). */
const boite = "demo@cabinet.example";
const marque = randomUUID().slice(0, 8);

function fail(message) {
  console.error(`j11-redaction-api: FAIL — ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`j11-redaction-api: ${message}`);
}

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

/** Requête sans échec automatique : renvoie statut et corps. */
async function requete(chemin, jeton, methode = "GET", corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = null;
  }
  return { statut: reponse.status, json, texte };
}

async function exiger(chemin, jeton, methode, corps, contexte) {
  const r = await requete(chemin, jeton, methode, corps);
  if (r.statut < 200 || r.statut >= 300) {
    fail(`${contexte ?? `${methode} ${chemin}`} → ${r.statut} ${r.texte.slice(0, 300)}`);
  }
  return r.json;
}

function attendreStatut(r, attendu, contexte) {
  if (r.statut !== attendu) {
    fail(`${contexte} : statut ${r.statut} (attendu ${attendu}) ${r.texte.slice(0, 200)}`);
  }
}

// Client IMAP de contrôle (python imaplib). Le mot de passe passe par l'environnement.
const SCRIPT_IMAP = [
  "import imaplib, json, os, re, sys",
  "hote, port, login, action, dossier, cible = sys.argv[1:7]",
  "boite = imaplib.IMAP4(hote, int(port))",
  "boite.login(login, os.environ['IMAP_SECRET'])",
  "if action == 'ajouter':",
  "    typ, _ = boite.append(dossier, None, None, os.environ['IMAP_BRUT'].encode('utf-8'))",
  "    assert typ == 'OK', typ",
  "    print('[]')",
  "elif action == 'chercher':",
  "    typ, _ = boite.select(dossier)",
  "    if typ != 'OK':",
  "        print('[]'); sys.exit(0)",
  "    typ, data = boite.search(None, 'HEADER', 'Message-ID', '\"' + cible + '\"')",
  "    sortie = []",
  "    for num in (data[0].split() if data and data[0] else []):",
  "        typ, brut = boite.fetch(num, '(RFC822)')",
  "        sortie.append(brut[0][1].decode('utf-8', 'replace'))",
  "    print(json.dumps(sortie))",
  // Messages d'un Message-ID avec leurs drapeaux (copie de brouillon : \\Draft, \\Seen).
  "elif action == 'chercher_drapeaux':",
  "    typ, _ = boite.select(dossier)",
  "    if typ != 'OK':",
  "        print('[]'); sys.exit(0)",
  "    typ, data = boite.search(None, 'HEADER', 'Message-ID', '\"' + cible + '\"')",
  "    sortie = []",
  "    for num in (data[0].split() if data and data[0] else []):",
  "        typ, brut = boite.fetch(num, '(FLAGS RFC822)')",
  "        tete = brut[0][0].decode('utf-8', 'replace')",
  "        m = re.search(r'FLAGS \\(([^)]*)\\)', tete)",
  "        drapeaux = sorted(m.group(1).split()) if m else []",
  "        sortie.append({'drapeaux': drapeaux, 'brut': brut[0][1].decode('utf-8', 'replace')})",
  "    print(json.dumps(sortie))",
  // Retire du dossier tous les messages d'un Message-ID (simule une copie perdue).
  "elif action == 'effacer':",
  "    typ, _ = boite.select(dossier)",
  "    n = 0",
  "    if typ == 'OK':",
  "        typ, data = boite.search(None, 'HEADER', 'Message-ID', '\"' + cible + '\"')",
  "        for num in (data[0].split() if data and data[0] else []):",
  "            boite.store(num, '+FLAGS', '(\\\\Deleted)')",
  "            n += 1",
  "        boite.expunge()",
  "    print(json.dumps(n))",
  "elif action == 'dossiers':",
  "    typ, data = boite.list()",
  "    print(json.dumps([l.decode('utf-8', 'replace').rsplit(' ', 1)[-1].strip('\"') for l in data if l]))",
  "boite.logout()",
].join("\n");

function imap({ login, secret, action, dossier = "INBOX", cible = "", brut = "" }) {
  const run = spawnSync(
    "python",
    ["-c", SCRIPT_IMAP, imapHote, imapPort, login, action, dossier, cible],
    {
      encoding: "utf8",
      env: { ...process.env, IMAP_SECRET: secret, IMAP_BRUT: brut },
    },
  );
  if (run.status !== 0) {
    throw new Error(`imap ${action} ${dossier} : ${(run.stderr || run.stdout).slice(0, 200)}`);
  }
  return JSON.parse(run.stdout || "[]");
}

async function attendreMessage({ login, secret, dossier, messageId, delaiMs = 15_000 }) {
  const debut = Date.now();
  let derniereErreur = "";
  while (Date.now() - debut < delaiMs) {
    try {
      const trouves = imap({ login, secret, action: "chercher", dossier, cible: messageId });
      if (trouves.length > 0) return trouves[0];
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  fail(`message ${messageId} absent de ${dossier} (${derniereErreur})`);
  return "";
}

/** En-têtes bruts (avant la première ligne vide). */
function entetes(brut) {
  return brut.split(/\r?\n\r?\n/)[0];
}

function aEnTete(brut, nom) {
  return new RegExp(`^${nom}:`, "im").test(entetes(brut));
}

function valeurEnTete(brut, nom) {
  const correspondance = new RegExp(`^${nom}:[ \\t]*((?:.*)(?:\\r?\\n[ \\t].*)*)`, "im").exec(
    entetes(brut),
  );
  return correspondance ? correspondance[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
}

function messageRecu({ de, a, cc, objet, messageId, references, pieces }) {
  const corps = [
    `From: ${de}`,
    `To: ${a}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${objet}`,
    `Message-ID: ${messageId}`,
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
  ];
  if (!pieces) {
    return [
      ...corps,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Bonjour, merci de confirmer le creneau.",
      "",
    ].join("\r\n");
  }
  return [
    ...corps,
    'Content-Type: multipart/mixed; boundary="limite-j11"',
    "",
    "--limite-j11",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Bonjour, merci de confirmer le creneau.",
    "--limite-j11",
    'Content-Type: application/pdf; name="Convocation.pdf"',
    'Content-Disposition: attachment; filename="Convocation.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
    "--limite-j11--",
    "",
  ].join("\r\n");
}

// ===========================================================================================
// Étape 1b — brouillons (copie IMAP \Draft), pièces, envoi du brouillon, complétion
// ===========================================================================================

/** Pièce jointe en corps brut (la route n'accepte pas de JSON). */
async function requeteBrute(chemin, jeton, octets, typeContenu) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      ...(typeContenu ? { "content-type": typeContenu } : {}),
    },
    body: octets,
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = null;
  }
  return { statut: reponse.status, json, texte };
}

/** Dossier des brouillons de la boîte : « Drafts » s'il existe, sinon « Brouillons » (comme l'API). */
function dossierBrouillons(secret) {
  const noms = imap({ login: "demo", secret, action: "dossiers" });
  const dernier = (nom) => nom.split(/[/.]/).pop().toLowerCase();
  return (
    noms.find((nom) => dernier(nom) === "drafts") ??
    noms.find((nom) => dernier(nom) === "brouillons") ??
    "Brouillons"
  );
}

function copiesBrouillon(secret, messageId) {
  return imap({
    login: "demo",
    secret,
    action: "chercher_drapeaux",
    dossier: dossierBrouillons(secret),
    cible: messageId,
  });
}

/** Attend que la copie de brouillon ait exactement `attendu` exemplaires dont chacun vérifie `condition`. */
async function attendreCopies({ secret, messageId, attendu, condition = () => true, contexte, delaiMs = 20_000 }) {
  const debut = Date.now();
  let derniere = [];
  while (Date.now() - debut < delaiMs) {
    try {
      derniere = copiesBrouillon(secret, messageId);
      if (derniere.length === attendu && derniere.every(condition)) return derniere;
    } catch {
      // Dossier pas encore créé : on réessaie.
    }
    await sleep(400);
  }
  fail(`${contexte} : ${derniere.length} copie(s) de ${messageId} (attendu ${attendu}, condition remplie : ${derniere.every(condition)})`);
  return [];
}

async function attendreSql(requete, attendu, contexte, delaiMs = 20_000) {
  const debut = Date.now();
  let valeur = "";
  while (Date.now() - debut < delaiMs) {
    valeur = await sqlServeur(requete);
    if (valeur === attendu) return;
    await sleep(400);
  }
  fail(`${contexte} : « ${valeur} » (attendu « ${attendu} »)`);
}

async function etape1b({
  secret,
  jetonA,
  jetonB,
  idMail,
  idMessageNominatif,
  idMessageOrigine,
  idOrigine,
  objetOrigine,
}) {
  const marque1b = randomUUID().slice(0, 8);
  const destinataire = `dest1b.${marque1b}@example.com`;
  const cachee = `cachee1b.${marque1b}@example.com`;
  const idBrouillon = randomUUID();
  const uri = `/messagerie/brouillons/${idBrouillon}`;

  // --- 1. Brouillon enregistré : une copie dans le dossier Brouillons, avec \Draft ------------
  const v1 = await exiger(
    uri,
    jetonA,
    "PUT",
    {
      a: [destinataire],
      cci: [cachee],
      objet: `Brouillon ${marque1b}`,
      corps_html: "<p>Texte de la version un.</p>",
    },
    "enregistrement du brouillon",
  );
  const messageId = v1.message_id;
  if (!/^<envoi-.+@/.test(messageId)) fail(`Message-ID du brouillon : ${messageId}`);
  const [copie1] = await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    contexte: "première copie du brouillon",
  });
  if (!copie1.drapeaux.includes("\\Draft")) fail(`drapeaux de la copie : ${copie1.drapeaux}`);
  if (!copie1.drapeaux.includes("\\Seen")) fail(`la copie du brouillon n'est pas lue : ${copie1.drapeaux}`);
  if (valeurEnTete(copie1.brut, "Subject") !== `Brouillon ${marque1b}`) fail("objet de la copie");
  if (!valeurEnTete(copie1.brut, "To").includes(destinataire)) fail("destinataire de la copie");
  if (!valeurEnTete(copie1.brut, "Bcc").includes(cachee)) fail("la copie du brouillon doit garder le Bcc");
  if (!copie1.brut.includes("version un")) fail("corps de la copie");
  // Essais négatifs : la copie n'est ni dans la boîte de réception ni dans Envoyés ; un autre
  // identifiant n'a pas de copie ; la copie d'un message réellement envoyé ne porte pas \Draft.
  for (const dossier of ["INBOX", "Sent"]) {
    if (imap({ login: "demo", secret, action: "chercher", dossier, cible: messageId }).length !== 0) {
      fail(`un brouillon enregistré ne doit pas figurer dans ${dossier}`);
    }
  }
  if (copiesBrouillon(secret, `<inconnu-${marque1b}@cabinet.example>`).length !== 0) {
    fail("essai négatif : un identifiant inconnu a une copie");
  }
  const envoyeReel = imap({ login: "demo", secret, action: "chercher_drapeaux", dossier: "Sent", cible: idMail });
  if (envoyeReel.length === 0 || envoyeReel.some((m) => m.drapeaux.includes("\\Draft"))) {
    fail("essai négatif : la copie Envoyés d'un message envoyé ne doit pas porter \\Draft");
  }
  await attendreSql(
    `SELECT imap_etat FROM brouillons_message WHERE id = '${idBrouillon}'`,
    "depose",
    "état de la copie après le dépôt",
  );
  ok("brouillon enregistré : une copie dans le dossier Brouillons (\\Draft, \\Seen, Bcc gardé), rien dans INBOX ni Sent");

  // --- 2. Deuxième sauvegarde : toujours une seule copie, contenu mis à jour ------------------
  await exiger(
    uri,
    jetonA,
    "PUT",
    { objet: `Brouillon ${marque1b} (2)`, corps_html: "<p>Texte de la version deux.</p>" },
    "seconde sauvegarde",
  );
  const [copie2] = await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => c.brut.includes("version deux"),
    contexte: "copie après la seconde sauvegarde",
  });
  if (copie2.brut.includes("version un")) fail("l'ancien texte reste dans la copie");
  if (valeurEnTete(copie2.brut, "Subject") !== `Brouillon ${marque1b} (2)`) fail("objet de la seconde copie");
  if (valeurEnTete(copie2.brut, "Message-ID") !== messageId) fail("le Message-ID du brouillon a changé");
  // Rafale de sauvegardes : une seule copie, la dernière version.
  for (let i = 3; i <= 7; i += 1) {
    await exiger(uri, jetonA, "PUT", { corps_html: `<p>Texte de la version ${i}.</p>` }, `sauvegarde ${i}`);
  }
  await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => c.brut.includes("version 7"),
    contexte: "copie après une rafale de sauvegardes",
  });
  await sleep(1500);
  const apresRafale = copiesBrouillon(secret, messageId);
  if (apresRafale.length !== 1 || !apresRafale[0].brut.includes("version 7")) {
    fail(`rafale : ${apresRafale.length} copie(s) après stabilisation`);
  }
  // Essai négatif : un doublon introduit à la main est bien vu (deux copies), puis la sauvegarde
  // suivante le résorbe en une seule.
  imap({
    login: "demo",
    secret,
    action: "ajouter",
    dossier: dossierBrouillons(secret),
    brut: apresRafale[0].brut,
  });
  if (copiesBrouillon(secret, messageId).length !== 2) {
    fail("essai négatif : le doublon introduit à la main n'est pas vu");
  }
  await exiger(uri, jetonA, "PUT", { corps_html: "<p>Texte de la version 8.</p>" }, "sauvegarde 8");
  await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => c.brut.includes("version 8"),
    contexte: "doublon résorbé par la sauvegarde suivante",
  });
  ok("sauvegardes successives : toujours une seule copie, contenu à jour, rafale et doublon résorbés");

  // --- 3. Pièce jointe : présente dans la copie, retirée avec elle ----------------------------
  const avantPiece = copiesBrouillon(secret, messageId)[0];
  if (/note-brouillon\.txt/.test(avantPiece.brut)) fail("essai négatif : la pièce est là avant l'ajout");
  const pieceId = randomUUID();
  const ajout = await requeteBrute(
    `${uri}/pieces?nom=${encodeURIComponent("note-brouillon.txt")}&piece_id=${pieceId}`,
    jetonA,
    Buffer.from(`Contenu fictif de la pièce ${marque1b}`),
    "text/plain",
  );
  attendreStatut(ajout, 200, "ajout de la pièce");
  if (ajout.json.pieces.length !== 1 || ajout.json.pieces[0].nom !== "note-brouillon.txt") {
    fail(`résumé des pièces : ${ajout.texte.slice(0, 200)}`);
  }
  const [avecPiece] = await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => /note-brouillon\.txt/.test(c.brut),
    contexte: "copie avec la pièce jointe",
  });
  if (!/Content-Disposition: attachment/i.test(avecPiece.brut)) fail("la pièce n'est pas jointe");
  const rejeuPiece = await requeteBrute(
    `${uri}/pieces?nom=note-brouillon.txt&piece_id=${pieceId}`,
    jetonA,
    Buffer.from(`Contenu fictif de la pièce ${marque1b}`),
    "text/plain",
  );
  if (rejeuPiece.json?.pieces?.length !== 1) fail("le rejeu de la pièce crée un doublon");
  attendreStatut(
    await requeteBrute(`${uri}/pieces?nom=a.txt`, jetonA, Buffer.alloc(0), "text/plain"),
    400,
    "pièce vide",
  );
  attendreStatut(
    await requeteBrute(`${uri}/pieces?nom=${encodeURIComponent("../x.txt")}`, jetonA, Buffer.from("x")),
    400,
    "nom de pièce avec séparateur",
  );
  // Limite cumulée de 25 Mio : message clair, rien d'enregistré ; sous la limite, la même pièce passe.
  const enorme = Buffer.alloc(24 * 1024 * 1024, 1);
  attendreStatut(
    await requeteBrute(`${uri}/pieces?nom=gros.bin`, jetonA, enorme, "application/octet-stream"),
    200,
    "pièce de 24 Mio (sous la limite)",
  );
  const refus = await requeteBrute(
    `${uri}/pieces?nom=en-trop.bin`,
    jetonA,
    Buffer.alloc(2 * 1024 * 1024, 2),
    "application/octet-stream",
  );
  attendreStatut(refus, 400, "dépassement de 25 Mio cumulés");
  if (!/25 Mio/.test(refus.json?.message ?? "")) fail(`message de la limite : ${refus.texte.slice(0, 200)}`);
  const gros = (await exiger(uri, jetonA, "GET", undefined, "relecture")).pieces.find((p) => p.nom === "gros.bin");
  await exiger(`${uri}/pieces/${gros.id}`, jetonA, "DELETE", undefined, "retrait de la grosse pièce");
  attendreStatut(
    await requeteBrute(`${uri}/pieces?nom=en-trop.bin`, jetonA, Buffer.alloc(2 * 1024 * 1024, 2), "application/octet-stream"),
    200,
    "la même pièce passe sous la limite",
  );
  const surTrop = (await exiger(uri, jetonA, "GET", undefined, "relecture")).pieces.find((p) => p.nom === "en-trop.bin");
  await exiger(`${uri}/pieces/${surTrop.id}`, jetonA, "DELETE", undefined, "retrait de la pièce de 2 Mio");
  // Retrait de la note : la copie n'a plus la pièce.
  await exiger(`${uri}/pieces/${pieceId}`, jetonA, "DELETE", undefined, "retrait de la note");
  await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => !/note-brouillon\.txt/.test(c.brut) && !/gros\.bin/.test(c.brut),
    contexte: "copie sans la pièce retirée",
  });
  ok("pièces : présentes dans la copie, rejeu sans doublon, 25 Mio cumulés refusés (400), retirées de la copie");

  // --- 4. Reprise : copie perdue, rattrapée par le balayage du moteur -------------------------
  if (imap({ login: "demo", secret, action: "effacer", dossier: dossierBrouillons(secret), cible: messageId }) !== 1) {
    fail("la copie à perdre n'a pas été trouvée");
  }
  if (copiesBrouillon(secret, messageId).length !== 0) fail("la copie perdue est encore là");
  // Essai négatif : tant que le brouillon est noté « déposé », personne ne recrée la copie.
  await sleep(18_000);
  if (copiesBrouillon(secret, messageId).length !== 0) {
    fail("essai négatif : la copie a été recréée alors que l'état était « depose »");
  }
  await sqlServeur(
    `UPDATE brouillons_message SET imap_etat = 'erreur', imap_maj_le = NOW() - INTERVAL '2 minutes' WHERE id = '${idBrouillon}'`,
  );
  await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    contexte: "copie rattrapée par le balayage",
    delaiMs: 75_000,
  });
  await attendreSql(
    `SELECT imap_etat FROM brouillons_message WHERE id = '${idBrouillon}'`,
    "depose",
    "état après la reprise",
  );
  ok("reprise : une copie perdue est redéposée par le balayage seulement quand le brouillon est en erreur");

  // --- 5. Autre collaborateur : 404 partout, la copie de A n'est pas touchée ------------------
  attendreStatut(await requete(uri, jetonB, "GET"), 404, "B lit le brouillon de A");
  attendreStatut(await requete(uri, jetonB, "PUT", { objet: "Intrus" }), 404, "B écrit le brouillon de A");
  attendreStatut(await requete(uri, jetonB, "DELETE"), 404, "B supprime le brouillon de A");
  attendreStatut(await requete(`${uri}/envoyer`, jetonB, "POST"), 404, "B envoie le brouillon de A");
  attendreStatut(
    await requeteBrute(`${uri}/pieces?nom=intrus.txt`, jetonB, Buffer.from("x"), "text/plain"),
    404,
    "B ajoute une pièce chez A",
  );
  const listeB = await exiger("/messagerie/brouillons", jetonB, "GET", undefined, "brouillons de B");
  if (listeB.some((b) => b.id === idBrouillon)) fail("B voit le brouillon de A dans sa liste");
  if (copiesBrouillon(secret, messageId).length !== 1) fail("la copie de A a été touchée par B");
  const lueA = await exiger(uri, jetonA, "GET", undefined, "A relit son brouillon");
  if (lueA.objet.includes("Intrus")) fail("le brouillon de A a été modifié par B");
  attendreStatut(await requete(uri, jetonA, "GET"), 200, "contrôle positif : A lit son brouillon");
  ok("droits : un autre collaborateur obtient 404 sur lecture, écriture, suppression, pièces et envoi ; copie intacte");

  // --- 6. Suppression : la copie est retirée --------------------------------------------------
  const aSupprimer = randomUUID();
  const uriSuppr = `/messagerie/brouillons/${aSupprimer}`;
  const brouillonSuppr = await exiger(uriSuppr, jetonA, "PUT", { objet: `A supprimer ${marque1b}`, a: [destinataire] });
  await attendreCopies({ secret, messageId: brouillonSuppr.message_id, attendu: 1, contexte: "copie avant suppression" });
  attendreStatut(await requete(uriSuppr, jetonA, "DELETE"), 204, "suppression du brouillon");
  await attendreCopies({ secret, messageId: brouillonSuppr.message_id, attendu: 0, contexte: "copie après suppression" });
  attendreStatut(await requete(uriSuppr, jetonA, "GET"), 404, "lecture après suppression");
  await attendreSql(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${aSupprimer}'`, "0", "ligne après suppression");
  attendreStatut(await requete(uriSuppr, jetonA, "DELETE"), 404, "seconde suppression");
  ok("suppression : copie IMAP retirée, ligne supprimée, brouillon introuvable");

  // --- 7. Envoi du brouillon ------------------------------------------------------------------
  const uriEnvoi = uri;
  await exiger(uriEnvoi, jetonA, "PUT", { a: [boite], cc: [`copie1b.${marque1b}@cabinet.example`], cci: [], objet: `Envoi du brouillon ${marque1b}` });
  attendreStatut(
    await requeteBrute(`${uriEnvoi}/pieces?nom=piece-envoyee.txt`, jetonA, Buffer.from("Pièce fictive à envoyer"), "text/plain"),
    200,
    "pièce du brouillon à envoyer",
  );
  await attendreCopies({
    secret,
    messageId,
    attendu: 1,
    condition: (c) => /piece-envoyee\.txt/.test(c.brut),
    contexte: "copie avant l'envoi",
  });
  // Avant l'envoi, rien n'est parti.
  if (imap({ login: "demo", secret, action: "chercher", dossier: "INBOX", cible: messageId }).length !== 0) {
    fail("le message est arrivé avant l'envoi");
  }
  const envoi = await exiger(`${uriEnvoi}/envoyer`, jetonA, "POST", undefined, "envoi du brouillon");
  if (envoi.id !== idBrouillon || envoi.etat !== "brouillon" || envoi.message_id !== messageId) {
    fail(`ligne de file : ${JSON.stringify(envoi)}`);
  }
  await exiger(`/messagerie/file-envoi/${idBrouillon}/mettre-en-attente`, jetonA, "POST");
  const traite = await exiger(`/messagerie/file-envoi/${idBrouillon}/traiter`, jetonA, "POST");
  if (traite.etat !== "copie_envoyes_confirmee") fail(`traitement de l'envoi : ${traite.etat}`);
  const recu = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId });
  if (!/piece-envoyee\.txt/.test(recu)) fail("la pièce du brouillon n'est pas dans le message reçu");
  if (aEnTete(recu, "Bcc")) fail("le message reçu porte un Bcc");
  if (valeurEnTete(recu, "Subject") !== `Envoi du brouillon ${marque1b}`) fail("objet du message reçu");
  // Le brouillon et sa copie ont disparu.
  await attendreCopies({ secret, messageId, attendu: 0, contexte: "copie du brouillon après l'envoi" });
  await attendreSql(`SELECT COUNT(*) FROM brouillons_message WHERE id = '${idBrouillon}'`, "0", "ligne du brouillon après l'envoi");
  await attendreSql(`SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = '${idBrouillon}'`, "0", "pièces du brouillon après l'envoi");
  attendreStatut(await requete(uri, jetonA, "GET"), 404, "lecture du brouillon envoyé");
  // Rejeu : même ligne de file, aucun doublon (ligne, pièces, message reçu).
  const rejeu = await exiger(`${uriEnvoi}/envoyer`, jetonA, "POST", undefined, "rejeu de l'envoi");
  if (rejeu.id !== idBrouillon) fail("le rejeu a créé une autre ligne");
  await exiger(`/messagerie/file-envoi/${idBrouillon}/traiter`, jetonA, "POST");
  const lignes = await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE message_id = '${messageId}'`);
  if (lignes !== "1") fail(`${lignes} lignes de file pour le même Message-ID`);
  const piecesFile = await sqlServeur(`SELECT COUNT(*) FROM file_envoi_pieces WHERE envoi_id = '${idBrouillon}'`);
  if (piecesFile !== "1") fail(`${piecesFile} pièce(s) en file (attendu 1)`);
  await sleep(1000);
  const exemplaires = imap({ login: "demo", secret, action: "chercher", dossier: "INBOX", cible: messageId });
  if (exemplaires.length !== 1) fail(`${exemplaires.length} exemplaires reçus (attendu 1)`);
  // Un brouillon rejoué par une écriture tardive ne ressuscite pas.
  attendreStatut(await requete(uri, jetonA, "PUT", { objet: "Retour" }), 409, "écriture tardive sur un brouillon envoyé");
  ok("envoi du brouillon : reçu avec sa pièce, sans Bcc ; brouillon et copie IMAP disparus ; rejeu sans doublon");

  // --- 8. Complétion --------------------------------------------------------------------------
  const contact = randomUUID();
  const emailContact = `Annuaire.${marque1b}@Example.com`;
  await exiger("/contacts", jetonA, "POST", {
    id: contact,
    idempotence_cle: `j11-1b-${contact}`,
    nature: "physique",
    nom: `Nom Annuaire ${marque1b}`,
    type_client: "particulier",
    email: emailContact,
  });
  const cherche = async (jeton, q, limite) =>
    exiger(
      `/messagerie/destinataires?q=${encodeURIComponent(q)}${limite ? `&limite=${limite}` : ""}`,
      jeton,
      "GET",
      undefined,
      `complétion « ${q} »`,
    );
  const parAnnuaire = await cherche(jetonA, `annuaire.${marque1b}`);
  if (parAnnuaire.length !== 1 || parAnnuaire[0].source !== "annuaire" || parAnnuaire[0].adresse !== emailContact.toLowerCase()) {
    fail(`complétion par l'annuaire : ${JSON.stringify(parAnnuaire)}`);
  }
  if (parAnnuaire[0].nom !== `Nom Annuaire ${marque1b}`) fail("nom de l'annuaire absent");
  const parNom = await cherche(jetonA, `Nom Annuaire ${marque1b}`);
  if (parNom.length !== 1) fail("complétion par le nom du contact");
  // Adresses déjà échangées : message reçu (expéditeur) et envoi (destinataire, cc).
  const recus = await cherche(jetonA, `client.${marque}@`);
  if (!recus.some((s) => s.adresse === `client.${marque}@example.com` && s.source === "recu")) {
    fail(`complétion par les messages reçus : ${JSON.stringify(recus)}`);
  }
  const envoyes = await cherche(jetonA, `copie1b.${marque1b}`);
  if (!envoyes.some((s) => s.source === "envoye")) fail(`complétion par les envois : ${JSON.stringify(envoyes)}`);
  // Boîte nominative de A et dossier restreint : visibles de A, jamais de B.
  // (« tiers@example.com » figure aussi dans la boîte du cabinet : on donne au message nominatif
  // de A une adresse qu'aucun autre message ne porte.)
  const adresseNominatif = `nominatif.${marque1b}@example.com`;
  await sqlServeur(`UPDATE messages SET expediteur = '${adresseNominatif}' WHERE id = '${idMessageNominatif}'`);
  const nominatifA = await cherche(jetonA, `nominatif.${marque1b}`);
  if (!nominatifA.some((s) => s.adresse === adresseNominatif)) fail("A ne retrouve pas l'adresse de sa boîte nominative");
  const nominatifB = await cherche(jetonB, `nominatif.${marque1b}`);
  if (nominatifB.length !== 0) fail(`fuite : B voit l'adresse de la boîte nominative de A ${JSON.stringify(nominatifB)}`);
  const dossierRestreint = randomUUID();
  await exiger("/dossiers", jetonA, "POST", {
    id: dossierRestreint,
    idempotence_cle: `j11-1b-d-${dossierRestreint}`,
    nom: `Dossier restreint ${marque1b}`,
    chemise: "gris-perle",
    juridiction: "TJ Paris",
    numero_rg: "26/30001",
    restreint: true,
  });
  const compteClassement = await sqlServeur(`SELECT id FROM comptes_mail WHERE type_compte = 'classement' LIMIT 1`);
  await sqlServeur(
    `INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid, objet, expediteur, destinataires_texte, etat_classement)
     SELECT '${randomUUID()}', cabinet_id, id, '${dossierRestreint}', '<restreint-${marque1b}@example.com>', 1, 9${Date.now() % 100000}, 'Message fictif', 'secret.${marque1b}@example.com', 'autre.secret.${marque1b}@example.com', 'classe'
     FROM comptes_mail WHERE id = '${compteClassement}'`,
  );
  const restreintA = await cherche(jetonA, `secret.${marque1b}`);
  if (!restreintA.some((s) => s.adresse === `secret.${marque1b}@example.com`)) fail("A ne retrouve pas l'adresse de son dossier restreint");
  const restreintB = await cherche(jetonB, `secret.${marque1b}`);
  if (restreintB.length !== 0) fail(`fuite : B voit les adresses d'un dossier restreint ${JSON.stringify(restreintB)}`);
  // Saisie, limite, dédoublonnage sans casse, jokers.
  attendreStatut(await requete("/messagerie/destinataires?q=a", jetonA, "GET"), 400, "saisie d'un caractère");
  attendreStatut(await requete("/messagerie/destinataires", jetonA, "GET"), 400, "saisie absente");
  const tout = await cherche(jetonA, "example.com", 50);
  const adresses = tout.map((s) => s.adresse);
  if (new Set(adresses).size !== adresses.length) fail("adresses en double dans la complétion");
  if (tout.length < 3) fail("essai négatif : trop peu de résultats pour éprouver la limite");
  if ((await cherche(jetonA, "example.com", 2)).length !== 2) fail("limite non respectée");
  if ((await cherche(jetonA, "example.com")).length > 8) fail("limite par défaut dépassée");
  if ((await cherche(jetonA, "%%")).length !== 0) fail("jokers de la saisie non neutralisés");
  const majuscules = await cherche(jetonA, `ANNUAIRE.${marque1b}`);
  if (majuscules.length !== 1) fail("la recherche est sensible à la casse");
  ok("complétion : annuaire, messages reçus, envois ; jamais la boîte nominative d'un autre ni un dossier restreint non autorisé ; limite, casse, jokers");

  // --- 9. Réponse et transfert tenus comme brouillons ------------------------------------------
  const idReponse = randomUUID();
  const uriReponse = `/messagerie/brouillons/${idReponse}`;
  attendreStatut(
    await requete(`/messagerie/brouillons/${randomUUID()}`, jetonA, "PUT", { genre: "reponse" }),
    400,
    "réponse sans message d'origine",
  );
  attendreStatut(
    await requete(`/messagerie/brouillons/${randomUUID()}`, jetonB, "PUT", {
      genre: "reponse",
      origine_message_id: idMessageNominatif,
    }),
    404,
    "B répond à un message de la boîte nominative de A",
  );
  const reponseBrouillon = await exiger(
    uriReponse,
    jetonA,
    "PUT",
    {
      genre: "reponse",
      origine_message_id: idMessageOrigine,
      a: [boite],
      objet: `Re: ${objetOrigine}`,
      corps_html: "<p>Réponse du brouillon.</p>",
    },
    "brouillon de réponse",
  );
  if (reponseBrouillon.en_reponse_a !== idOrigine) {
    fail(`In-Reply-To du brouillon de réponse : ${reponseBrouillon.en_reponse_a}`);
  }
  const [copieReponse] = await attendreCopies({
    secret,
    messageId: reponseBrouillon.message_id,
    attendu: 1,
    contexte: "copie du brouillon de réponse",
  });
  if (valeurEnTete(copieReponse.brut, "In-Reply-To") !== idOrigine) fail("la copie de réponse n'a pas In-Reply-To");
  await exiger(`${uriReponse}/envoyer`, jetonA, "POST", undefined, "envoi de la réponse");
  await exiger(`/messagerie/file-envoi/${idReponse}/mettre-en-attente`, jetonA, "POST");
  const traiteReponse = await exiger(`/messagerie/file-envoi/${idReponse}/traiter`, jetonA, "POST");
  if (traiteReponse.etat !== "copie_envoyes_confirmee") fail(`envoi de la réponse : ${traiteReponse.etat}`);
  const recuReponse = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId: reponseBrouillon.message_id });
  if (valeurEnTete(recuReponse, "In-Reply-To") !== idOrigine) fail("la réponse reçue n'a pas In-Reply-To");

  const idTransfertBrouillon = randomUUID();
  const uriTransfert = `/messagerie/brouillons/${idTransfertBrouillon}`;
  const transfertBrouillon = await exiger(
    uriTransfert,
    jetonA,
    "PUT",
    { genre: "transfert", origine_message_id: idMessageOrigine, a: [boite], objet: `Fwd: ${objetOrigine}` },
    "brouillon de transfert",
  );
  if (!transfertBrouillon.pieces.some((p) => p.nom === "Convocation.pdf")) {
    fail("le brouillon de transfert ne garde pas la pièce d'origine");
  }
  if (transfertBrouillon.en_reponse_a) fail("le transfert pose un fil");
  await attendreCopies({
    secret,
    messageId: transfertBrouillon.message_id,
    attendu: 1,
    condition: (c) => /Convocation\.pdf/.test(c.brut),
    contexte: "copie du brouillon de transfert avec sa pièce",
  });
  await exiger(`${uriTransfert}/envoyer`, jetonA, "POST", undefined, "envoi du transfert");
  await exiger(`/messagerie/file-envoi/${idTransfertBrouillon}/mettre-en-attente`, jetonA, "POST");
  await exiger(`/messagerie/file-envoi/${idTransfertBrouillon}/traiter`, jetonA, "POST");
  const recuTransfert = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId: transfertBrouillon.message_id });
  if (!/Convocation\.pdf/.test(recuTransfert)) fail("le transfert envoyé depuis un brouillon n'a pas la pièce");
  if (aEnTete(recuTransfert, "In-Reply-To")) fail("le transfert reçu porte un fil");
  ok("brouillons de réponse (In-Reply-To déduit) et de transfert (pièce d'origine reprise) : copie IMAP puis envoi");
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const secret = motDePasseBoite();

  // --- Deux collaborateurs du même cabinet -------------------------------------------------
  const jetonA = await demoAccessToken(api, `j11-redaction-a-${marque}`);
  const emailB = `j11-redaction-${marque}@cabinet-fictif.example`;
  const collabB = {
    email: emailB,
    password: "MotDePasseCollab123!",
    totpSecret: "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA",
  };
  await exiger(
    "/collaborateurs",
    jetonA,
    "POST",
    {
      email: collabB.email,
      password: collabB.password,
      totp_secret_base32: collabB.totpSecret,
    },
    "création du collaborateur B",
  );
  const jetonB = await accessToken(api, { ...collabB, nomAppareil: `j11-redaction-b-${marque}` });

  // --- Message reçu à répondre / transférer ------------------------------------------------
  const idOrigine = `<orig-${marque}@example.com>`;
  const objetOrigine = `Audience ${marque}`;
  imap({
    login: "demo",
    secret,
    action: "ajouter",
    dossier: "INBOX",
    brut: messageRecu({
      de: `Confrere Fictif <confrere.${marque}@example.com>`,
      a: `Demo <DEMO@cabinet.example>, Client Fictif <client.${marque}@example.com>`,
      cc: `Secretariat <secretariat.${marque}@example.com>`,
      objet: objetOrigine,
      messageId: idOrigine,
      references: `<ancien-${marque}@example.com>`,
      pieces: true,
    }),
  });
  let messageA = null;
  for (let essai = 0; essai < 20 && !messageA; essai += 1) {
    await exiger("/messagerie/classement/relever", jetonA, "POST", undefined, "relève");
    const liste = await exiger("/messagerie/messages", jetonA, "GET", undefined, "liste messages");
    messageA = liste.find((m) => m.message_id === idOrigine) ?? null;
    if (!messageA) await sleep(500);
  }
  if (!messageA) fail("le message d'origine n'a pas été relevé");
  const idMessage = messageA.id;

  // =========================================================================================
  // (f) Réponse, réponse à tous, transfert
  // =========================================================================================
  const reponse = await exiger(
    "/messagerie/composition",
    jetonA,
    "POST",
    { genre: "reponse", message_id: idMessage },
    "composition réponse",
  );
  if (reponse.en_reponse_a !== idOrigine) fail(`In-Reply-To composé : ${reponse.en_reponse_a}`);
  const refsAttendues = [`<ancien-${marque}@example.com>`, idOrigine];
  if (JSON.stringify(reponse.references) !== JSON.stringify(refsAttendues)) {
    fail(`References composées : ${JSON.stringify(reponse.references)}`);
  }
  if (reponse.objet !== `Re: ${objetOrigine}`) fail(`objet de réponse : ${reponse.objet}`);
  if (reponse.a.length !== 1 || !reponse.a[0].includes(`confrere.${marque}@example.com`)) {
    fail(`destinataire de réponse : ${JSON.stringify(reponse.a)}`);
  }
  if (reponse.cc.length !== 0) fail("la réponse simple reprend des destinataires en copie");
  if (!/blockquote/i.test(reponse.html) || !reponse.texte.includes("> Bonjour")) {
    fail("historique cité absent de la réponse");
  }
  if (reponse.pieces.length !== 0) fail("la réponse reprend les pièces de l'original");
  ok("réponse : In-Reply-To, References, objet « Re: », historique cité, sans pièces");

  const reponseTous = await exiger(
    "/messagerie/composition",
    jetonA,
    "POST",
    { genre: "reponse_a_tous", message_id: idMessage },
    "composition réponse à tous",
  );
  const tousDestinataires = [...reponseTous.a, ...reponseTous.cc, ...reponseTous.cci].map((a) =>
    a.toLowerCase(),
  );
  if (tousDestinataires.some((a) => a.includes(boite))) {
    fail(`réponse à tous : l'expéditeur figure parmi les destinataires ${tousDestinataires}`);
  }
  for (const attendu of [`confrere.${marque}@`, `client.${marque}@`, `secretariat.${marque}@`]) {
    if (!tousDestinataires.some((a) => a.includes(attendu))) {
      fail(`réponse à tous : ${attendu} absent`);
    }
  }
  // Essai négatif : l'original portait bien l'adresse de l'expéditeur (en majuscules), donc
  // l'exclusion n'est pas un effet du hasard.
  const bruts = imap({
    login: "demo",
    secret,
    action: "chercher",
    dossier: "INBOX",
    cible: idOrigine,
  });
  if (!/DEMO@cabinet\.example/.test(entetes(bruts[0] ?? ""))) {
    fail("essai négatif : l'original ne portait pas l'adresse de l'expéditeur");
  }
  ok("réponse à tous : adresse de l'expéditeur exclue (casse comprise), autres destinataires gardés");

  const transfert = await exiger(
    "/messagerie/composition",
    jetonA,
    "POST",
    { genre: "transfert", message_id: idMessage },
    "composition transfert",
  );
  if (transfert.objet !== `Fwd: ${objetOrigine}`) fail(`objet de transfert : ${transfert.objet}`);
  if (transfert.en_reponse_a || transfert.references.length) fail("le transfert pose un fil");
  if (!transfert.pieces.some((p) => p.nom === "Convocation.pdf")) {
    fail("le transfert ne garde pas la pièce jointe");
  }
  if (transfert.a.length !== 0) fail("le transfert propose un destinataire");
  ok("transfert : pièce jointe gardée, aucun fil posé, destinataires à saisir");

  // Essais négatifs de composition
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", { genre: "reponse" }),
    400,
    "réponse sans message d'origine",
  );
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", {
      genre: "reponse",
      message_id: randomUUID(),
    }),
    404,
    "réponse à un message inconnu",
  );
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", { genre: "inconnu" }),
    400,
    "genre inconnu",
  );

  // =========================================================================================
  // (d) En-têtes non injectables
  // =========================================================================================
  const compositionSaine = {
    genre: "nouveau",
    a: [`destinataire.${marque}@example.com`],
    objet: `Note ${marque}`,
  };
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", compositionSaine),
    200,
    "composition saine (contrôle positif)",
  );
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", {
      ...compositionSaine,
      objet: `Note ${marque}\r\nBcc: pirate@example.com`,
    }),
    400,
    "retour à la ligne dans l'objet (composition)",
  );
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", {
      ...compositionSaine,
      a: [`destinataire.${marque}@example.com\r\nBcc: pirate@example.com`],
    }),
    400,
    "retour à la ligne dans une adresse (composition)",
  );

  const corpsEnvoiSain = (id, extra = {}) => ({
    id,
    idempotence_cle: `j11-redaction-api-${id}`,
    a: [`destinataire.${marque}@example.com`],
    objet: `Envoi ${marque}`,
    corps_html: "<p>Corps fictif.</p>",
    ...extra,
  });
  const idSain = randomUUID();
  const sain = await requete("/messagerie/file-envoi", jetonA, "POST", corpsEnvoiSain(idSain));
  attendreStatut(sain, 200, "envoi sain (contrôle positif)");
  const injections = [
    ["objet", { objet: `Envoi ${marque}\r\nBcc: pirate@example.com` }],
    ["adresse à", { a: [`destinataire.${marque}@example.com\nBcc: pirate@example.com`] }],
    ["adresse cc", { cc: [`copie.${marque}@example.com\r\nX-Injecte: oui`] }],
    ["adresse cci", { cci: [`cachee.${marque}@example.com\r\nX-Injecte: oui`] }],
    ["In-Reply-To", { en_reponse_a: `<x-${marque}@example.com>\r\nBcc: pirate@example.com` }],
    ["Message-ID", { message_id: `<x-${marque}@example.com>\r\nBcc: pirate@example.com` }],
  ];
  for (const [nom, extra] of injections) {
    const id = randomUUID();
    attendreStatut(
      await requete("/messagerie/file-envoi", jetonA, "POST", corpsEnvoiSain(id, extra)),
      400,
      `injection par ${nom}`,
    );
    const lignes = await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE id = '${id}'`);
    if (lignes !== "0") fail(`injection par ${nom} : une ligne a été créée malgré le refus`);
  }
  ok("(d) retour à la ligne refusé (400) dans l'objet, les adresses, le fil et l'identifiant ; aucune ligne créée");

  // =========================================================================================
  // (e) La copie cachée n'apparaît jamais dans ce que reçoivent les autres
  // =========================================================================================
  const cachee = `cachee.${marque}@cabinet.example`;
  const idMail = `<j11-e-${marque}@cabinet.example>`;
  const idEnvoiE = randomUUID();
  const envoiE = await exiger(
    "/messagerie/file-envoi",
    jetonA,
    "POST",
    corpsEnvoiSain(idEnvoiE, {
      a: [boite],
      cc: [`copie.${marque}@cabinet.example`],
      cci: [cachee],
      objet: `Copie cachee ${marque}`,
      message_id: idMail,
    }),
    "création de l'envoi (e)",
  );
  if (envoiE.message_id !== idMail) fail("Message-ID modifié à la création");
  if (envoiE.cci.length !== 1) fail("la copie cachée n'est pas conservée dans la file");
  await exiger(`/messagerie/file-envoi/${idEnvoiE}/mettre-en-attente`, jetonA, "POST");
  let traite = await exiger(`/messagerie/file-envoi/${idEnvoiE}/traiter`, jetonA, "POST");
  if (traite.etat !== "copie_envoyes_confirmee") fail(`envoi (e) : ${traite.etat}`);
  if (traite.message_id !== idMail) fail("Message-ID modifié à l'envoi");

  const recu = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId: idMail });
  if (aEnTete(recu, "Bcc")) fail("le message reçu porte un en-tête Bcc");
  if (recu.toLowerCase().includes(cachee)) fail("l'adresse en copie cachée figure dans le message reçu");
  if (!valeurEnTete(recu, "Cc").includes(`copie.${marque}@cabinet.example`)) {
    fail("la copie visible (Cc) manque dans le message reçu");
  }
  const copie = await attendreMessage({ login: "demo", secret, dossier: "Sent", messageId: idMail });
  if (!aEnTete(copie, "Bcc") || !valeurEnTete(copie, "Bcc").includes(cachee)) {
    fail("la copie « Envoyés » ne garde pas le Bcc");
  }
  // Essai négatif : le test de détection voit bien un Bcc quand il y en a un (la copie), et
  // ne confond pas Cc et Bcc.
  if (aEnTete(entetes(recu), "Bcc") || !aEnTete(copie, "Bcc")) {
    fail("essai négatif : la détection de Bcc ne distingue pas reçu et copie");
  }
  // Le destinataire caché reçoit le message (enveloppe). GreenMail crée la boîte à la première
  // livraison, avec l'adresse comme identifiant et mot de passe ; si le serveur de test refuse
  // cette connexion, la livraison n'est pas vérifiable ici et le dit sans échouer.
  let livraisonCachee = "non vérifiée (GreenMail refuse la connexion de la boîte créée à la livraison)";
  const debutCachee = Date.now();
  while (Date.now() - debutCachee < 10_000) {
    try {
      const recuCachee = imap({
        login: cachee,
        secret: cachee,
        action: "chercher",
        dossier: "INBOX",
        cible: idMail,
      });
      if (recuCachee.length > 0) {
        if (aEnTete(recuCachee[0], "Bcc")) fail("le destinataire caché voit un en-tête Bcc");
        livraisonCachee = "vérifiée";
        break;
      }
    } catch {
      break;
    }
    await sleep(500);
  }
  if (livraisonCachee === "vérifiée" || Date.now() - debutCachee >= 10_000) {
    if (livraisonCachee !== "vérifiée") fail("le destinataire en copie cachée n'a rien reçu");
  }
  ok(
    `(e) reçu sans Bcc par le destinataire visible ; copie Envoyés avec Bcc ; livraison au destinataire caché ${livraisonCachee}`,
  );
  // Rejeu de la création : même ligne, aucun doublon, identifiant inchangé.
  const rejeu = await exiger(
    "/messagerie/file-envoi",
    jetonA,
    "POST",
    corpsEnvoiSain(idEnvoiE, { a: [boite], cci: [cachee], message_id: idMail, objet: `Copie cachee ${marque}` }),
    "rejeu de la création",
  );
  if (rejeu.id !== idEnvoiE || rejeu.message_id !== idMail) fail("rejeu : autre ligne ou autre identifiant");
  const doublons = await sqlServeur(`SELECT COUNT(*) FROM file_envoi WHERE message_id = '${idMail}'`);
  if (doublons !== "1") fail(`rejeu : ${doublons} lignes pour le même Message-ID`);
  // Un second traitement ne renvoie rien (une seule copie reçue).
  traite = await exiger(`/messagerie/file-envoi/${idEnvoiE}/traiter`, jetonA, "POST");
  const recus = imap({ login: "demo", secret, action: "chercher", dossier: "INBOX", cible: idMail });
  if (recus.length !== 1) fail(`${recus.length} exemplaires reçus (attendu 1)`);
  ok("Message-ID figé : rejeu sans doublon, un seul exemplaire livré");

  // =========================================================================================
  // (f) suite : la réponse envoyée porte In-Reply-To et References
  // =========================================================================================
  const idReponse = reponse.message_id;
  const idEnvoiR = randomUUID();
  const envoiR = await exiger(
    "/messagerie/file-envoi",
    jetonA,
    "POST",
    {
      id: idEnvoiR,
      idempotence_cle: `j11-redaction-api-${idEnvoiR}`,
      genre: "reponse",
      origine_message_id: idMessage,
      a: reponse.a,
      cc: [boite],
      objet: reponse.objet,
      corps_html: reponse.html,
      message_id: idReponse,
      en_reponse_a: reponse.en_reponse_a,
      references: reponse.references,
    },
    "création de la réponse",
  );
  if (envoiR.en_reponse_a !== idOrigine) fail("fil non conservé dans la file");
  await exiger(`/messagerie/file-envoi/${idEnvoiR}/mettre-en-attente`, jetonA, "POST");
  const traiteR = await exiger(`/messagerie/file-envoi/${idEnvoiR}/traiter`, jetonA, "POST");
  if (traiteR.etat !== "copie_envoyes_confirmee") fail(`réponse : ${traiteR.etat}`);
  const recuR = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId: idReponse });
  if (valeurEnTete(recuR, "In-Reply-To") !== idOrigine) {
    fail(`In-Reply-To reçu : ${valeurEnTete(recuR, "In-Reply-To")}`);
  }
  const refsRecues = valeurEnTete(recuR, "References").split(/\s+/);
  if (JSON.stringify(refsRecues) !== JSON.stringify(refsAttendues)) {
    fail(`References reçues : ${JSON.stringify(refsRecues)}`);
  }
  if (valeurEnTete(recuR, "Subject") !== `Re: ${objetOrigine}`) fail("objet de la réponse reçue");
  const copieR = await attendreMessage({ login: "demo", secret, dossier: "Sent", messageId: idReponse });
  if (valeurEnTete(copieR, "In-Reply-To") !== idOrigine) fail("copie Envoyés sans In-Reply-To");
  ok("(f) réponse envoyée : In-Reply-To et References reçus et copiés dans Envoyés");

  // Réponse sans origine, sans fil : refusée (essai négatif).
  attendreStatut(
    await requete(
      "/messagerie/file-envoi",
      jetonA,
      "POST",
      corpsEnvoiSain(randomUUID(), { genre: "reponse" }),
    ),
    400,
    "réponse sans message d'origine dans la file",
  );

  // Transfert : les pièces de l'original partent dans l'envoi.
  const idEnvoiT = randomUUID();
  const idTransfert = transfert.message_id;
  const envoiT = await exiger(
    "/messagerie/file-envoi",
    jetonA,
    "POST",
    {
      id: idEnvoiT,
      idempotence_cle: `j11-redaction-api-${idEnvoiT}`,
      genre: "transfert",
      origine_message_id: idMessage,
      a: [boite],
      objet: transfert.objet,
      corps_html: transfert.html,
      message_id: idTransfert,
    },
    "création du transfert",
  );
  const piecesStockees = await sqlServeur(
    `SELECT COUNT(*) FROM file_envoi_pieces WHERE envoi_id = '${envoiT.id}'`,
  );
  if (piecesStockees !== "1") fail(`pièces du transfert en file : ${piecesStockees} (attendu 1)`);
  await exiger(`/messagerie/file-envoi/${idEnvoiT}/mettre-en-attente`, jetonA, "POST");
  const traiteT = await exiger(`/messagerie/file-envoi/${idEnvoiT}/traiter`, jetonA, "POST");
  if (traiteT.etat !== "copie_envoyes_confirmee") fail(`transfert : ${traiteT.etat}`);
  const recuT = await attendreMessage({ login: "demo", secret, dossier: "INBOX", messageId: idTransfert });
  if (!/Convocation\.pdf/.test(recuT)) fail("le transfert reçu ne porte pas la pièce jointe");
  if (aEnTete(recuT, "In-Reply-To") || aEnTete(recuT, "References")) {
    fail("le transfert reçu porte un fil de discussion");
  }
  ok("transfert envoyé : pièce jointe reçue, pas de fil");

  // =========================================================================================
  // (a) Modèles de message et signature
  // =========================================================================================
  const idModele = randomUUID();
  const nomModele = `Accusé de réception ${marque}`;
  const modele = await exiger(
    "/messagerie/modeles",
    jetonA,
    "POST",
    {
      id: idModele,
      nom: nomModele,
      objet: `Accusé ${marque}`,
      corps_html: "<p>Bonjour, nous accusons réception.</p><script>alert(1)</script>",
      ordre: 3,
    },
    "création du modèle",
  );
  if (/script|alert/i.test(modele.corps_html)) fail("le HTML du modèle n'est pas nettoyé");
  attendreStatut(
    await requete("/messagerie/modeles", jetonA, "POST", {
      id: randomUUID(),
      nom: nomModele.toUpperCase(),
    }),
    409,
    "nom de modèle en double",
  );
  attendreStatut(
    await requete("/messagerie/modeles", jetonA, "POST", { id: randomUUID(), nom: "   " }),
    400,
    "nom de modèle vide",
  );
  attendreStatut(
    await requete("/messagerie/modeles", jetonA, "POST", {
      id: randomUUID(),
      nom: `Injecte ${marque}`,
      objet: "Objet\r\nBcc: pirate@example.com",
    }),
    400,
    "retour à la ligne dans l'objet d'un modèle",
  );
  const listeB = await exiger("/messagerie/modeles", jetonB, "GET", undefined, "liste des modèles (B)");
  if (!listeB.some((m) => m.id === idModele)) fail("le modèle du cabinet n'est pas visible d'un collaborateur");

  const avecModele = await exiger(
    "/messagerie/composition",
    jetonA,
    "POST",
    { genre: "nouveau", modele_id: idModele },
    "composition avec modèle",
  );
  if (avecModele.objet !== `Accusé ${marque}`) fail(`objet du modèle : ${avecModele.objet}`);
  if (!avecModele.html.includes("accusons réception")) fail("corps du modèle absent");
  await exiger(
    `/messagerie/modeles/${idModele}`,
    jetonA,
    "PATCH",
    { actif: false },
    "désactivation du modèle",
  );
  const actifs = await exiger("/messagerie/modeles", jetonA, "GET", undefined, "modèles actifs");
  const tous = await exiger("/messagerie/modeles?tous=true", jetonA, "GET", undefined, "tous les modèles");
  if (actifs.some((m) => m.id === idModele) || !tous.some((m) => m.id === idModele)) {
    fail("la désactivation d'un modèle ne le retire pas de la liste par défaut");
  }
  attendreStatut(
    await requete("/messagerie/composition", jetonA, "POST", { genre: "nouveau", modele_id: idModele }),
    404,
    "composition avec un modèle désactivé",
  );
  attendreStatut(await requete(`/messagerie/modeles/${idModele}`, jetonA, "DELETE"), 204, "suppression du modèle");
  attendreStatut(await requete(`/messagerie/modeles/${idModele}`, jetonA, "DELETE"), 404, "second effacement");
  ok("(a) modèles : création nettoyée, doublon 409, nom vide 400, objet injecté 400, désactivation, suppression");

  const compteClassement = reponse.compte_id;
  const signatureA = await exiger(
    `/messagerie/comptes/${compteClassement}/signature`,
    jetonA,
    "PUT",
    { texte: `Me Signataire Fictif ${marque}`, html: `<p>Me Signataire Fictif ${marque}</p><script>x</script>` },
    "écriture de la signature",
  );
  if (/script/i.test(signatureA.html)) fail("le HTML de la signature n'est pas nettoyé");
  const avecSignature = await exiger(
    "/messagerie/composition",
    jetonA,
    "POST",
    { genre: "nouveau" },
    "composition avec signature",
  );
  if (!avecSignature.signature_inseree || !avecSignature.texte.includes(`Me Signataire Fictif ${marque}`)) {
    fail("la signature n'est pas insérée à la rédaction");
  }
  const sansSignature = await exiger(
    "/messagerie/composition",
    jetonB,
    "POST",
    { genre: "nouveau" },
    "composition sans signature (B)",
  );
  if (sansSignature.signature_inseree || sansSignature.texte.includes(`Me Signataire Fictif ${marque}`)) {
    fail("la signature d'un collaborateur est insérée chez un autre");
  }
  const lueB = await exiger(
    `/messagerie/comptes/${compteClassement}/signature`,
    jetonB,
    "GET",
    undefined,
    "lecture de sa signature (B)",
  );
  if (lueB.revision !== 0 || lueB.texte !== "") fail("B lit la signature de A");
  ok("signature : une par compte et par utilisateur, insérée à la rédaction, jamais chez un autre");

  // =========================================================================================
  // Droits : brouillons, signature et boîte nominative d'un autre
  // =========================================================================================
  const listeEnvoiB = await exiger("/messagerie/file-envoi", jetonB, "GET", undefined, "file d'envoi (B)");
  if (listeEnvoiB.some((e) => [idEnvoiE, idEnvoiR, idEnvoiT, idSain].includes(e.id))) {
    fail("B voit les envois de A dans la file");
  }
  const listeEnvoiA = await exiger("/messagerie/file-envoi", jetonA, "GET", undefined, "file d'envoi (A)");
  if (!listeEnvoiA.some((e) => e.id === idSain)) fail("A ne voit plus son propre brouillon");
  attendreStatut(
    await requete(`/messagerie/file-envoi/${idSain}/mettre-en-attente`, jetonB, "POST"),
    404,
    "B met en attente le brouillon de A",
  );
  attendreStatut(
    await requete(`/messagerie/file-envoi/${idSain}/traiter`, jetonB, "POST"),
    404,
    "B traite le brouillon de A",
  );
  attendreStatut(
    await requete(`/messagerie/file-envoi/${idSain}/annuler`, jetonB, "POST"),
    404,
    "B annule le brouillon de A",
  );
  const etatSain = await sqlServeur(`SELECT etat FROM file_envoi WHERE id = '${idSain}'`);
  if (etatSain !== "brouillon") fail(`le brouillon de A a changé d'état : ${etatSain}`);
  attendreStatut(
    await requete("/messagerie/file-envoi", jetonB, "POST", corpsEnvoiSain(idSain)),
    409,
    "B recrée l'identifiant de A",
  );

  // Boîte nominative de A : signature et messages invisibles de B.
  const idCompteA = randomUUID();
  await exiger(
    "/messagerie/comptes",
    jetonA,
    "POST",
    {
      id: idCompteA,
      adresse: `a.${marque}@cabinet.example`,
      hote: "127.0.0.1",
      port: 1,
      utilisateur: `a-${marque}`,
      mot_de_passe: `SentinelleA${marque}`,
      tls: false,
    },
    "compte nominatif de A",
  );
  attendreStatut(
    await requete(`/messagerie/comptes/${idCompteA}/signature`, jetonB, "GET"),
    404,
    "B lit la signature du compte de A",
  );
  attendreStatut(
    await requete(`/messagerie/comptes/${idCompteA}/signature`, jetonB, "PUT", { texte: "Intrus" }),
    404,
    "B écrit la signature du compte de A",
  );
  attendreStatut(
    await requete(`/messagerie/comptes/${idCompteA}/signature`, jetonA, "PUT", { texte: "Signature de A" }),
    200,
    "A écrit la signature de son compte",
  );
  const intrus = await sqlServeur(
    `SELECT COUNT(*) FROM signatures_messagerie WHERE compte_id = '${idCompteA}' AND texte = 'Intrus'`,
  );
  if (intrus !== "0") fail("la signature de A a été écrasée par B");
  const idMessageNominatif = randomUUID();
  await sqlServeur(
    `INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
     SELECT '${idMessageNominatif}', cabinet_id, id, '<nominatif-${marque}@example.com>', 1, 1,
            'Message nominatif fictif', 'tiers@example.com', 'a_classer'
     FROM comptes_mail WHERE id = '${idCompteA}'`,
  );
  attendreStatut(
    await requete("/messagerie/composition", jetonB, "POST", { genre: "reponse", message_id: idMessageNominatif }),
    404,
    "B compose depuis un message de la boîte de A",
  );
  const compoA = await requete("/messagerie/composition", jetonA, "POST", {
    genre: "reponse",
    message_id: idMessageNominatif,
  });
  if (compoA.statut === 404 || compoA.statut === 403) {
    fail(`A ne peut pas composer depuis sa propre boîte (${compoA.statut})`);
  }
  const messagesB = await exiger("/messagerie/messages", jetonB, "GET", undefined, "messages (B)");
  if (messagesB.some((m) => m.id === idMessageNominatif)) fail("B voit un message de la boîte de A");
  const messagesA = await exiger("/messagerie/messages", jetonA, "GET", undefined, "messages (A)");
  if (!messagesA.some((m) => m.id === idMessageNominatif)) fail("A ne voit plus son message nominatif");
  ok("droits : brouillon, signature et message d'une boîte nominative invisibles d'un autre collaborateur (404)");

  await etape1b({
    secret,
    jetonA,
    jetonB,
    idMail,
    idMessageNominatif,
    idMessageOrigine: idMessage,
    idOrigine,
    objetOrigine,
  });

  console.log("j11-redaction-api: OK");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
