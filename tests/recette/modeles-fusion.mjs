#!/usr/bin/env node
/**
 * Modèles et fusion (PLAN) : courrier, convention et acte depuis les données du dossier,
 * modèle du cabinet remplaçable sans recompiler, génération hors ligne, champ manquant
 * bloquant, document versionné, styles conservés.
 *
 * Usage : node tests/recette/modeles-fusion.mjs
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";

const require = createRequire(new URL("../../apps/poste/package.json", import.meta.url));
const PizZip = require("pizzip");

const session = creerSession("modeles-fusion");
const { fail, ok, assurerInstance, evaluate, setField, api } = session;
const POSTE = "mfu";
const PORT = "9294";

const paquet = JSON.parse(readFileSync(new URL("../../apps/poste/package.json", import.meta.url), "utf8"));
const dependances = Object.keys(paquet.dependencies ?? {});
if (!dependances.includes("docxtemplater")) fail("docxtemplater absent du poste");
if (dependances.some((nom) => nom.startsWith("docxtemplater-"))) fail("module payant docxtemplater installé");
ok("cœur gratuit de docxtemplater, aucun module payant");

const catalogue = readFileSync(new URL("../../docs/modeles-champs.md", import.meta.url), "utf8");
for (const champ of ["dossier_nom", "dossier_reference", "client_nom", "cabinet_nom"]) {
  if (!catalogue.includes(`\`${champ}\``)) fail(`catalogue sans ${champ}`);
}
ok("catalogue des champs");

function docx(paragraphes, styleId = "MarqueFusion") {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="${styleId}" w:type="paragraph"><w:name w:val="${styleId}"/><w:rPr><w:sz w:val="44"/></w:rPr></w:style></w:styles>`;
  const corps = paragraphes
    .map((texte) => `<w:p><w:r><w:t xml:space="preserve">${texte}</w:t></w:r></w:p>`)
    .join("");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corps}<w:sectPr/></w:body></w:document>`,
  );
  zip.file("word/styles.xml", styles);
  return zip.generate({ type: "nodebuffer" });
}

function stylesDe(octets) {
  return new PizZip(octets).file("word/styles.xml")?.asText() ?? "";
}

function texteDe(octets) {
  const xml = new PizZip(octets).file("word/document.xml")?.asText() ?? "";
  return xml.replace(/<[^>]+>/g, "");
}

await assurerInstance();
const spec = await fetch(`${api}/openapi.json`).then((reponse) => reponse.json());
if (!spec.paths?.["/modeles-documents/{genre}"]) {
  fail("l'instance n'expose pas /modeles-documents : reconstruire l'image API");
}

const dossierTemp = mkdtempSync(join(tmpdir(), "modeles-fusion-"));
const modeleBon = docx([
  "Marque du cabinet fictif",
  "{dossier_nom}",
  "{dossier_reference}",
  "{client_nom}",
  "{cabinet_nom}",
]);
const modeleIncomplet = docx(["{champ_fantome}"], "StyleIncomplet");
const cheminBon = join(dossierTemp, "modele-cabinet.docx");
const cheminIncomplet = join(dossierTemp, "modele-incomplet.docx");
writeFileSync(cheminBon, modeleBon);
writeFileSync(cheminIncomplet, modeleIncomplet);

async function attendre(nom, expression, send, delaiMs = 20_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(250);
  }
  fail(`${nom} : condition non atteinte`);
}

async function ouvrirModeles(send) {
  await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
  await attendre("menu", `Boolean(document.querySelector("[data-testid=menu-reglages]"))`, send, 5_000);
  await evaluate(send, `document.querySelector("[data-testid=menu-reglages]")?.click()`);
  await evaluate(send, `document.querySelector("[data-testid=reglages-section-modeles]")?.click()`);
  await attendre("panneau", `Boolean(document.querySelector("[data-testid=reglages-modeles]"))`, send);
}

async function deposerFichier(send, chemin) {
  const doc = await send("DOM.getDocument", { depth: 0 });
  const noeud = await send("DOM.querySelector", {
    nodeId: doc.result.root.nodeId,
    selector: "[data-testid=fusion-fichier]",
  });
  if (!noeud.result.nodeId) fail("champ de modèle absent");
  await send("DOM.setFileInputFiles", { files: [chemin], nodeId: noeud.result.nodeId });
}

async function remplacer(send, chemin) {
  const copie = join(dossierTemp, `modele-${Date.now()}.docx`);
  copyFileSync(chemin, copie);
  await evaluate(send, `(() => { const el = document.getElementById("fusion-fichier"); if (el) el.value = ""; return true; })()`);
  await deposerFichier(send, copie);
  await attendre(
    "enregistrement du modèle",
    `document.querySelector("[data-testid=fusion-message]")?.textContent?.includes("Modèle enregistré")`,
    send,
    30_000,
  );
  const origine = await evaluate(send, `document.querySelector("[data-testid=fusion-origine]")?.textContent ?? ""`);
  if (!String(origine).includes("cabinet")) fail(`origine après remplacement : ${origine}`);
}

async function lireDocument(jeton, documentId) {
  const lecture = await fetch(`${api}/documents/${documentId}/versions/1`, {
    headers: { authorization: `Bearer ${jeton}` },
  });
  if (!lecture.ok) fail(`lecture version ${documentId} → ${lecture.status}`);
  const corps = await lecture.json();
  const fichier = await fetch(corps.url);
  if (!fichier.ok) fail(`téléchargement ${documentId} → ${fichier.status}`);
  return Buffer.from(await fichier.arrayBuffer());
}

session.resetPostes([POSTE]);
const creds = {
  email: demoEmail,
  password: demoPassword,
  secret: totpSecretB32,
  nomAppareil: `Modèles ${session.marque}`,
  mode: "dev",
};
const { child, page } = await session.ouvrirPoste(POSTE, PORT, creds);
const send = page.send;
try {
  const dossierId = await session.creerDossier(send, {
    nom: `Fusion ${session.marque}`,
    juridiction: "TJ Paris",
    rg: `RG-${session.marque}`,
    partie: `Client ${session.marque}`,
    typeDossier: "contentieux",
    etape: "ouverture",
  });
  ok(`dossier ${dossierId}`);
  await attendre(
    "référence attribuée",
    `(async () => {
      const rows = await window.__legalosRecette.lireSqlite("SELECT reference FROM dossiers WHERE id = ?", [${JSON.stringify(dossierId)}]);
      return Boolean(rows?.[0]?.reference);
    })()`,
    send,
    60_000,
  );
  const reference = await evaluate(
    send,
    `(async () => (await window.__legalosRecette.lireSqlite("SELECT reference FROM dossiers WHERE id = ?", [${JSON.stringify(dossierId)}]))?.[0]?.reference ?? "")()`,
  );
  const cabinet = await evaluate(
    send,
    `(async () => (await window.__legalosRecette.lireSqlite("SELECT nom FROM cabinets LIMIT 1"))?.[0]?.nom ?? "")()`,
  );
  if (!/^[0-9a-f-]{36}$/i.test(dossierId)) fail("identifiant de dossier inattendu");
  if (!reference || !cabinet) fail("référence ou cabinet vide");

  await evaluate(
    send,
    `Object.keys(localStorage).filter((cle) => cle.startsWith("legalos.modele.")).forEach((cle) => localStorage.removeItem(cle))`,
  );
  await ouvrirModeles(send);
  await attendre(
    "dossier dans la liste",
    `Boolean(document.querySelector(${JSON.stringify(`#fusion-dossier option[value="${dossierId}"]`)}))`,
    send,
    20_000,
  );
  await setField(send, "fusion-dossier", dossierId);

  for (const genre of ["courrier", "convention", "acte"]) {
    await setField(send, "fusion-genre", genre);
    await sleep(300);
    await remplacer(send, cheminBon);
    const precedent = await evaluate(
      send,
      `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-document-id") ?? ""`,
    );
    await evaluate(send, `document.querySelector("[data-testid=fusion-produire]")?.click()`);
    await attendre(
      `production ${genre}`,
      `(() => {
        const el = document.querySelector("[data-testid=fusion-resultat]");
        return el?.getAttribute("data-attente") === "non" && el.getAttribute("data-document-id") !== ${JSON.stringify(precedent)};
      })()`,
      send,
      40_000,
    );
    const documentId = await evaluate(
      send,
      `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-document-id") ?? ""`,
    );
    const styles = await evaluate(
      send,
      `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-styles") ?? ""`,
    );
    const balises = await evaluate(
      send,
      `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-balises") ?? ""`,
    );
    if (styles !== "identiques" || balises !== "0") fail(`${genre} : styles ${styles}, balises ${balises}`);
    await attendre(
      `version ${genre}`,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite("SELECT numero FROM document_versions WHERE document_id = ?", [${JSON.stringify(documentId)}]);
        return Number(rows?.[0]?.numero) === 1;
      })()`,
      send,
      60_000,
    );
    const jeton = await demoAccessToken(api, `modeles-fusion-${genre}`);
    const produit = await lireDocument(jeton, documentId);
    if (stylesDe(produit) !== stylesDe(modeleBon)) fail(`${genre} : styles du modèle non conservés`);
    const texte = texteDe(produit);
    if (/\{\s*[^{}]+\}/.test(texte)) fail(`${genre} : balise résiduelle`);
    for (const attendu of [`Fusion ${session.marque}`, reference, `Client ${session.marque}`, cabinet, "Marque du cabinet fictif"]) {
      if (!texte.includes(attendu)) fail(`${genre} : « ${attendu} » absent du document`);
    }
    const ligne = await sqlServeur(
      `SELECT genre || ':' || empreinte FROM modeles_documents WHERE genre = '${genre}'`,
    );
    if (!ligne.includes(genre)) fail(`${genre} absent du cabinet (${ligne})`);
    ok(`${genre} versionné, styles conservés, stocké pour le cabinet`);
  }

  const avant = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE dossier_id = '${dossierId}'`);
  await setField(send, "fusion-genre", "courrier");
  await sleep(300);
  await remplacer(send, cheminIncomplet);
  await evaluate(send, `document.querySelector("[data-testid=fusion-produire]")?.click()`);
  await attendre(
    "champ manquant",
    `document.querySelector("[data-testid=fusion-message]")?.textContent?.includes("champ_fantome")`,
    send,
  );
  const apres = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE dossier_id = '${dossierId}'`);
  if (avant !== apres) fail(`un champ manquant a quand même créé un document (${avant} → ${apres})`);
  ok("champ absent : génération arrêtée, aucun document");

  await remplacer(send, cheminBon);
  const avantHorsLigne = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE dossier_id = '${dossierId}'`);
  await evaluate(
    send,
    `(() => { window.__fetchModele = window.fetch.bind(window); window.fetch = () => Promise.reject(new TypeError("réseau coupé")); return true; })()`,
  );
  await evaluate(send, `document.querySelector("[data-testid=fusion-produire]")?.click()`);
  await attendre(
    "génération hors ligne",
    `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-attente") === "oui"`,
    send,
  );
  const idDiffere = await evaluate(
    send,
    `document.querySelector("[data-testid=fusion-resultat]")?.getAttribute("data-document-id") ?? ""`,
  );
  const compteCoupe = await sqlServeur(`SELECT COUNT(*) FROM documents WHERE dossier_id = '${dossierId}'`);
  if (compteCoupe !== avantHorsLigne) fail("un document a été versé alors que le réseau était coupé");
  await evaluate(send, `(() => { window.fetch = window.__fetchModele; return true; })()`);
  await evaluate(send, `document.querySelector("[data-testid=fusion-reprendre]")?.click()`);
  await attendre(
    "reprise",
    `document.querySelector("[data-testid=fusion-message]")?.textContent?.includes("versés")`,
    send,
    40_000,
  );
  await attendre(
    "version différée",
    `(async () => {
      const rows = await window.__legalosRecette.lireSqlite("SELECT numero FROM document_versions WHERE document_id = ?", [${JSON.stringify(idDiffere)}]);
      return Number(rows?.[0]?.numero) === 1;
    })()`,
    send,
    60_000,
  );
  const empreinte = createHash("sha256").update(await lireDocument(await demoAccessToken(api, "modeles-fusion-reprise"), idDiffere)).digest("hex");
  if (empreinte.length !== 64) fail("empreinte absente");
  ok("génération hors ligne, versement au retour du réseau, sans doublon pendant la coupure");
  console.log("modeles-fusion: OK");
} finally {
  try {
    page.ws.close();
  } catch {
    /* déjà fermé */
  }
  await session.stopApp(child);
  session.fermer();
}
