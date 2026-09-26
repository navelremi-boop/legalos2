#!/usr/bin/env node
/**
 * Acceptation jalon Référence de dossier (§ 3.4) — côté poste.
 * Usage : node tests/recette/reference-dossier.mjs
 *
 * Vérifie schéma client, libellé « en attente », absence de génération locale,
 * et (si instance + migration serveur) la preuve j5 étendue via éventuellement
 * `node tests/recette/j5-poste-tauri.mjs`.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`reference-dossier: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`reference-dossier: ${msg}`);
}

const schemaPath = join(root, "apps/poste/src/sync/AppSchema.ts");
const ecrirePath = join(root, "apps/poste/src/dossiers/ecrireDossier.ts");
const libPath = join(root, "apps/poste/src/lib/referenceDossier.ts");
const etiquettePath = join(root, "apps/poste/src/coque/EtiquetteDossier.tsx");
const palettePath = join(root, "apps/poste/src/dossiers/PaletteCommandes.tsx");
const dossiersPath = join(root, "apps/poste/src/screens/Dossiers.tsx");
const barrePath = join(root, "apps/poste/src/coque/BarreHaut.tsx");

for (const p of [schemaPath, ecrirePath, libPath, etiquettePath, palettePath, dossiersPath, barrePath]) {
  if (!existsSync(p)) fail(`fichier manquant : ${p}`);
}

const schema = readFileSync(schemaPath, "utf8");
if (!/reference:\s*column\.text/u.test(schema)) {
  fail("AppSchema dossiers.reference (column.text) absent");
}
ok("AppSchema : colonne reference");

const lib = readFileSync(libPath, "utf8");
if (!lib.includes('REFERENCE_EN_ATTENTE = "en attente"')) {
  fail("libellé « en attente » absent");
}
if (!/libelleReferenceDossier/u.test(lib)) {
  fail("libelleReferenceDossier absent");
}
if (!/REFERENCE_SERVEUR_RE\s*=\s*\/\^\\d\{4\}-\\d\+\$\//u.test(lib)) {
  fail("motif YYYY-… absent");
}
ok("libelleReferenceDossier (« en attente », YYYY-…)");

const ecrire = readFileSync(ecrirePath, "utf8");
if (/reference\s*[:=]\s*[`'"]?\d{4}-/u.test(ecrire)) {
  fail("ecrireDossier génère une référence côté poste");
}
if (!/VALUES \(\?, \?, NULL,/u.test(ecrire)) {
  fail("ecrireDossier doit insérer reference = NULL");
}
if (!/attribution uniquement côté serveur/u.test(ecrire)) {
  fail("commentaire § 3.4 absent dans ecrireDossier");
}
ok("aucune génération locale de référence");

const uiBlob = [etiquettePath, palettePath, dossiersPath, barrePath]
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
if (!uiBlob.includes("libelleReferenceDossier")) {
  fail("UI sans libelleReferenceDossier");
}
if (!uiBlob.includes("data-reference")) {
  fail("data-reference absent (étiquette / onglets / palette / liste)");
}
ok("étiquette, onglets, palette, liste branchés");

const rType = spawnSync("pnpm", ["--filter", "@legal-os/poste", "typecheck"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
if (rType.status !== 0) fail(`typecheck exit ${rType.status ?? 1}`);
ok("typecheck OK");

console.log("reference-dossier: OK");
