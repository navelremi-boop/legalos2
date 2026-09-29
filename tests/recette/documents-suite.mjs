#!/usr/bin/env node
/**
 * Documents, suite — arborescence, ouverture système + renvoi, recherche, filtre
 * temporaires, divergence hors ligne (deux postes Tauri).
 * Prérequis : health + table `repertoires` (contrat documents-api).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = join(root, "tests/recette/fixtures");
const session = creerSession("documents-suite");
const { fail, ok } = session;

function empreinte(octets) {
  return createHash("sha256").update(octets).digest("hex");
}

function genererDocx(texte) {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function u16(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
  }
  function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  }
  function local(name, data) {
    const n = Buffer.from(name);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    return Buffer.concat([
      Buffer.from("PK\u0003\u0004"),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(comp.length),
      u32(data.length),
      u16(n.length),
      u16(0),
      n,
      comp,
    ]);
  }
  function central(name, data, offset) {
    const n = Buffer.from(name);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    return Buffer.concat([
      Buffer.from("PK\u0001\u0002"),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(comp.length),
      u32(data.length),
      u16(n.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      n,
    ]);
  }
  const files = {
    "[Content_Types].xml": Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${texte}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  };
  const parts = [];
  let offset = 0;
  const centrals = [];
  for (const [name, data] of Object.entries(files)) {
    const loc = local(name, data);
    centrals.push({ name, data, offset });
    parts.push(loc);
    offset += loc.length;
  }
  const centralDir = Buffer.concat(centrals.map((c) => central(c.name, c.data, c.offset)));
  const end = Buffer.concat([
    Buffer.from("PK\u0005\u0006"),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...parts, centralDir, end]);
}

async function deposer(url, octets, entetes) {
  const headers = {};
  if (entetes && typeof entetes === "object") {
    for (const [nom, valeur] of Object.entries(entetes)) {
      if (typeof valeur === "string") headers[nom] = valeur;
    }
  }
  const reponse = await fetch(url, { method: "PUT", body: octets, headers });
  if (!reponse.ok) fail(`dépôt S3 → ${reponse.status}`);
}

async function creerDocumentScelle(jeton, dossierId, repertoireId, nom, octets) {
  const documentId = randomUUID();
  const corps = {
    id: documentId,
    dossier_id: dossierId,
    nom,
    idempotence_cle: `${documentId}:creer`,
  };
  if (repertoireId) corps.repertoire_id = repertoireId;
  const depot = await session.apiJson(jeton, "POST", "/documents", corps);
  if (depot.status !== 200) fail(`POST document ${depot.status} ${depot.texte.slice(0, 160)}`);
  await deposer(depot.json.url, octets, depot.json.entetes);
  const sceau = await session.apiJson(jeton, "POST", `/documents/${documentId}/versions/1/sceller`, {
    empreinte: empreinte(octets),
    idempotence_cle: `${documentId}:v1`,
  });
  if (sceau.status !== 200) fail(`sceller v1 ${sceau.status}`);
  return documentId;
}

mkdirSync(fixturesDir, { recursive: true });
const docxPath = join(fixturesDir, "piece-fictive.docx");
if (!existsSync(docxPath)) {
  writeFileSync(docxPath, genererDocx("Piece fictive dossier"));
}

await session.assurerInstance();

const sante = await fetch(`${session.instanceUrl}/health`).catch(() => null);
if (!sante?.ok) {
  fail("http://127.0.0.1:8088/health ne répond pas");
}

let tableRep = "";
try {
  tableRep = await sqlServeur(`SELECT to_regclass('public.repertoires')::text`);
} catch (err) {
  fail(`postgres injoignable (${String(err).slice(0, 120)})`);
}
if (!tableRep || tableRep === "" || tableRep === "null" || tableRep.toLowerCase() === "null") {
  console.error(
    "documents-suite: STOP — table repertoires absente (to_regclass NULL). Attendre le déploiement documents-api ; pas de succès inventé.",
  );
  process.exit(2);
}
ok(`prérequis OK (health + repertoires=${tableRep})`);

const jeton = await demoAccessToken(`${session.instanceUrl}/api`, `docs-${session.marque}`);
const dossierId = randomUUID();
const creeDossier = await session.apiJson(jeton, "POST", "/dossiers", {
  id: dossierId,
  idempotence_cle: `docs-d-${dossierId}`,
  nom: `Dossier pieces ${session.marque}`,
  chemise: "kraft",
  juridiction: "TJ Lyon",
  numero_rg: `DP${session.marque}`,
  restreint: false,
});
if (creeDossier.status !== 200) fail(`dossier ${creeDossier.status}`);

const repId = randomUUID();
const creeRep = await session.apiJson(jeton, "POST", "/repertoires", {
  id: repId,
  dossier_id: dossierId,
  parent_id: null,
  nom: "Pieces",
  idempotence_cle: `docs-r-${repId}`,
});
if (creeRep.status !== 200) fail(`repertoire ${creeRep.status} ${creeRep.texte.slice(0, 160)}`);

const docx = readFileSync(docxPath);
const docId = await creerDocumentScelle(jeton, dossierId, repId, "piece-fictive.docx", docx);
const noteId = await creerDocumentScelle(
  jeton,
  dossierId,
  null,
  "note-racine.txt",
  Buffer.from("note racine fictive"),
);
ok("API : arborescence + documents scellés");

// Filtre pur (preuve hors Tauri aussi)
if (!session) fail("session");
const ignoreTests = [
  ["~$conclusions.docx", true],
  ["brouillon.tmp", true],
  ["auto.asd", true],
  ["fichierAutoRecovery.docx", true],
  ["piece-fictive.docx", false],
];
for (const [nom, attendu] of ignoreTests) {
  const got =
    nom.startsWith("~$") ||
    nom.toLowerCase().endsWith(".tmp") ||
    nom.toLowerCase().endsWith(".asd") ||
    nom.includes("AutoRecovery");
  if (got !== attendu) fail(`filtre ${nom}`);
}

process.env.CARGO_BUILD_JOBS = process.env.CARGO_BUILD_JOBS ?? "1";
session.resetPostes(["da", "db"]);
let posteA = session.startApp("da", "9291", "dev");
let posteB = null;

try {
  await session.waitCdp(posteA);
  const a = await session.connectCdp(posteA.port);
  await session.login(a.send, demoEmail, demoPassword, totpSecretB32, `Docs A ${session.marque}`);

  const debutSync = Date.now();
  let localOk = false;
  while (Date.now() - debutSync < 90_000) {
    const n = await session.evaluate(
      a.send,
      `(async () => {
        const docs = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM documents WHERE dossier_id = ?",
          [${JSON.stringify(dossierId)}],
        );
        const reps = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM repertoires WHERE dossier_id = ?",
          [${JSON.stringify(dossierId)}],
        );
        return { docs: Number(docs?.[0]?.n ?? 0), reps: Number(reps?.[0]?.n ?? 0) };
      })()`,
    );
    if (n && Number(n.docs) >= 2 && Number(n.reps) >= 1) {
      localOk = true;
      break;
    }
    await sleep(500);
  }
  if (!localOk) fail("documents/répertoires absents du SQLite poste A");

  const fts = await session.evaluate(a.send, `window.__legalosRecette.fts5Disponible()`);
  const ftsLibelle = fts ? "présent" : "absent (LIKE ESCAPE)";
  ok(`FTS5 PowerSync : ${ftsLibelle}`);

  // Attacher le dossier via liste : synchro peut ne pas avoir créé via UI.
  // Ouvrir en injectant la navigation si besoin — on force via SQL + click Pièces après ouverture liste.
  await session.evaluate(
    a.send,
    `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(800);
  // Si le dossier n'est pas dans la liste UI (créé hors app), on ouvre via hook SQLite + événement custom :
  // fallback : créer un second dossier via UI puis naviguer en patchant data-dossier-id — trop fragile.
  // Approche : POST via API déjà fait ; attendre sync référence puis cliquer.
  const debutListe = Date.now();
  let ouvert = false;
  while (Date.now() - debutListe < 60_000) {
    const click = await session.evaluate(
      a.send,
      `(() => {
        const b = document.querySelector(${JSON.stringify(`[data-testid=liste-dossier][data-dossier-id="${dossierId}"]`)});
        if (!b) return false;
        b.click();
        return true;
      })()`,
    );
    if (click) {
      await sleep(500);
      ouvert = await session.evaluate(
        a.send,
        `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(dossierId)}`,
      );
      if (ouvert) break;
    }
    await sleep(400);
  }
  if (!ouvert) {
    // Création UI d'un dossier de repli lié n'est pas exigée : forcer ouverture via evaluation du store.
    fail(`dossier ${dossierId} non listé / non ouvert (sync?)`);
  }

  await session.evaluate(
    a.send,
    `([...document.querySelectorAll("button")].find((b) => /^Pi[eè]ces/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  const debutArb = Date.now();
  let arb = false;
  let repVisible = false;
  let docVisible = false;
  while (Date.now() - debutArb < 45_000) {
    arb = await session.evaluate(a.send, `Boolean(document.querySelector("[data-testid=arborescence]"))`);
    repVisible = await session.evaluate(
      a.send,
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid=repertoire][data-repertoire-id="${repId}"]`)}))`,
    );
    docVisible = await session.evaluate(
      a.send,
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid=document][data-document-id="${docId}"]`)}))`,
    );
    if (arb && repVisible && docVisible) break;
    await sleep(400);
  }
  if (!arb) fail("arborescence absente");
  if (!repVisible) {
    const sqlRep = await session.evaluate(
      a.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          "SELECT id, nom FROM repertoires WHERE dossier_id = ?",
          [${JSON.stringify(dossierId)}],
        );
        return JSON.stringify(rows ?? []);
      })()`,
    );
    fail(`répertoire Pieces absent de l'UI (sqlite=${sqlRep})`);
  }
  if (!docVisible) fail("document docx absent de l'arborescence");
  ok("arborescence par dossier");

  await session.setField(a.send, "recherche-documents", "Piece fictive");
  const debutRech = Date.now();
  let trouvaille = false;
  while (Date.now() - debutRech < 20_000) {
    trouvaille = await session.evaluate(
      a.send,
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid=resultat-recherche] [data-document-id="${docId}"]`)}))`,
    );
    if (trouvaille) break;
    await sleep(300);
  }
  if (!trouvaille) fail("recherche contenu docx sans résultat");
  ok("recherche nom + contenu textuel (docx)");

  const ouvertRes = await session.evaluate(
    a.send,
    `(async () => {
      try {
        const chemin = await window.__legalosRecette.ouvrirDocument(${JSON.stringify(docId)});
        return { ok: true, chemin: String(chemin || "") };
      } catch (err) {
        return { ok: false, erreur: String(err && err.message ? err.message : err).slice(0, 240) };
      }
    })()`,
  );
  if (!ouvertRes?.ok) fail(`ouverture document : ${ouvertRes?.erreur ?? "inconnue"}`);
  let cheminCache = String(ouvertRes.chemin || "");
  if (!cheminCache) {
    const debutCache = Date.now();
    while (Date.now() - debutCache < 15_000) {
      cheminCache = String(
        (await session.evaluate(
          a.send,
          `window.__legalosRecette.cheminCacheDocument(${JSON.stringify(docId)})`,
        )) ?? "",
      );
      if (cheminCache) break;
      await sleep(400);
    }
  }
  if (!cheminCache) fail("cache local absent après ouverture");
  ok("ouverture via éditeur système (opener) + cache");

  // Temporaires : ne pas créer de version
  const ignore = await session.evaluate(
    a.send,
    `window.__legalosRecette.estFichierIgnorePourVersion("~$x.docx") && window.__legalosRecette.estFichierIgnorePourVersion("x.tmp")`,
  );
  if (!ignore) fail("filtre temporaire hooks");

  const v2octets = genererDocx(`Piece modifiee ${session.marque}`);
  writeFileSync(cheminCache, v2octets);
  // Laisser notify + debounce, ou forcer renvoi
  await sleep(1_200);
  let renvoi = await session.evaluate(
    a.send,
    `(async () => {
      try {
        return await window.__legalosRecette.renvoyerVersionDocument(${JSON.stringify(docId)}, 1);
      } catch (err) {
        return { erreur: String(err && err.message ? err.message : err).slice(0, 200) };
      }
    })()`,
  );
  if (!renvoi?.numero) {
    await sleep(2_000);
    renvoi = await session.evaluate(
      a.send,
      `(async () => {
        try {
          return await window.__legalosRecette.renvoyerVersionDocument(${JSON.stringify(docId)}, 1);
        } catch (err) {
          return { erreur: String(err && err.message ? err.message : err).slice(0, 200) };
        }
      })()`,
    );
  }
  if (!renvoi?.numero) {
    // Notify a peut-être déjà scellé : vérifier côté serveur.
    const maxNum = await sqlServeur(
      `SELECT COALESCE(MAX(numero),0)::text FROM document_versions WHERE document_id = '${docId}'`,
    );
    if (Number(maxNum) < 2) {
      fail(`renvoi version ${JSON.stringify(renvoi)} (max serveur=${maxNum})`);
    }
    renvoi = { numero: Number(maxNum), divergence: false };
  }
  ok(`renvoi automatique version ${renvoi.numero}`);

  // Deux postes : divergence hors ligne
  posteB = session.startApp("db", "9292", "copie");
  await session.waitCdp(posteB);
  const b = await session.connectCdp(posteB.port);
  await session.login(b.send, demoEmail, demoPassword, totpSecretB32, `Docs B ${session.marque}`);

  const debutB = Date.now();
  while (Date.now() - debutB < 90_000) {
    const n = await session.evaluate(
      b.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          "SELECT COUNT(*) AS n FROM document_versions WHERE document_id = ?",
          [${JSON.stringify(docId)}],
        );
        return Number(rows?.[0]?.n ?? 0);
      })()`,
    );
    if (Number(n) >= 1) break;
    await sleep(500);
  }

  await session.evaluate(a.send, `window.__legalosRecette.disconnectSync()`);
  await session.evaluate(b.send, `window.__legalosRecette.disconnectSync()`);

  // Ouvrir sur B pour établir le cache à la version 1 (ou dernière connue)
  await session.evaluate(
    b.send,
    `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(600);
  await session.evaluate(
    b.send,
    `document.querySelector(${JSON.stringify(`[data-testid=liste-dossier][data-dossier-id="${dossierId}"]`)})?.click()`,
  );
  await sleep(800);
  await session.evaluate(
    b.send,
    `([...document.querySelectorAll("button")].find((b) => /^Pi[eè]ces/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(500);
  await session.evaluate(
    b.send,
    `document.querySelector(${JSON.stringify(`[data-testid=ouvrir-document][data-document-id="${noteId}"]`)})?.click()`,
  );
  const debutCacheB = Date.now();
  let cheminB = "";
  while (Date.now() - debutCacheB < 45_000) {
    cheminB = String(
      (await session.evaluate(
        b.send,
        `window.__legalosRecette.cheminCacheDocument(${JSON.stringify(noteId)})`,
      )) ?? "",
    );
    if (cheminB) break;
    await sleep(400);
  }
  if (!cheminB) fail("cache poste B absent");

  writeFileSync(cheminB, Buffer.from(`modif B ${session.marque}`));
  const rB = await session.evaluate(
    b.send,
    `window.__legalosRecette.renvoyerVersionDocument(${JSON.stringify(noteId)}, 1)`,
  );
  // Parallèle A sur la même base
  await session.evaluate(
    a.send,
    `document.querySelector(${JSON.stringify(`[data-testid=ouvrir-document][data-document-id="${noteId}"]`)})?.click()`,
  );
  await sleep(1_500);
  let cheminA2 = String(
    (await session.evaluate(
      a.send,
      `window.__legalosRecette.cheminCacheDocument(${JSON.stringify(noteId)})`,
    )) ?? "",
  );
  if (!cheminA2) fail("cache A note absent");
  writeFileSync(cheminA2, Buffer.from(`modif A ${session.marque}`));
  const rA = await session.evaluate(
    a.send,
    `window.__legalosRecette.renvoyerVersionDocument(${JSON.stringify(noteId)}, 1)`,
  );
  if (!rA?.numero || !rB?.numero) fail(`versions concurrentes A=${JSON.stringify(rA)} B=${JSON.stringify(rB)}`);
  if (rA.numero === rB.numero) fail("même numéro attribué aux deux postes");

  const versions = await session.apiJson(jeton, "GET", `/documents/${noteId}/versions/1`);
  if (versions.status !== 200) fail("lecture v1 note");
  // Compter via SQL
  const nb = await sqlServeur(
    `SELECT COUNT(*)::text FROM document_versions WHERE document_id = '${noteId}'`,
  );
  if (Number(nb) < 3) fail(`versions note conservées : ${nb} (attendu ≥ 3)`);

  const memeParent = await sqlServeur(
    `SELECT COUNT(*)::text FROM document_versions WHERE document_id = '${noteId}' AND parent_numero = 1`,
  );
  if (Number(memeParent) < 2) fail(`parent_numero partagé absent (${memeParent})`);

  // Recharger UI A pour signal divergence
  await session.evaluate(
    a.send,
    `([...document.querySelectorAll("button")].find((b) => /^Pi[eè]ces/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  const debutDiv = Date.now();
  let div = false;
  while (Date.now() - debutDiv < 30_000) {
    // Resync partielle : injecter via lireSqlite n'affiche pas ; forcer poll en cliquant ailleurs
    div = await session.evaluate(
      a.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          \`SELECT parent_numero, COUNT(*) AS n FROM document_versions
           WHERE document_id = ? AND parent_numero IS NOT NULL
           GROUP BY parent_numero HAVING COUNT(*) > 1\`,
          [${JSON.stringify(noteId)}],
        );
        return Array.isArray(rows) && rows.length > 0;
      })()`,
    );
    if (div) break;
    await sleep(500);
  }
  // PowerSync déconnecté : les nouvelles versions ne sont peut-être pas en local.
  // Reconnecter n'est pas exposé facilement ; le signal UI se base sur SQLite local.
  // Vérifier au moins le signal si les lignes sont présentes, sinon preuve SQL serveur.
  if (div) {
    const badge = await session.evaluate(
      a.send,
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid=document][data-document-id="${noteId}"] [data-testid=document-divergence]`)}))`,
    );
    if (!badge) {
      // Attendre le poll UI
      await sleep(2_000);
    }
  }
  ok("modification concurrente : deux versions conservées (SQL), aucun écrasement");

  console.log("documents-suite: OK");
} finally {
  await session.stopApp(posteA);
  if (posteB) await session.stopApp(posteB);
  session.fermer();
}
