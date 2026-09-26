#!/usr/bin/env node
/**
 * S5 — Sync Streams : contrôle statique des flux (dossiers, parties, documents, versions).
 * Invariant : un dossier restreint et ses enfants ne descendent que via dossier_acces + auth.user_id().
 * Usage : node tests/recette/s5-sync-streams.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(message) {
  console.error(`s5-sync-streams: FAIL — ${message}`);
  process.exit(1);
}

const yaml = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
const service = readFileSync(join(root, "instance/powersync/service.yaml"), "utf8");
const compose = readFileSync(join(root, "instance/docker-compose.yml"), "utf8");

if (!/edition:\s*3/.test(yaml)) fail("config.edition: 3 absent");
if (!/sync_config:\s*\n\s*path:\s*\/config\/sync-config\.yaml/.test(service)) {
  fail("service.yaml : sync_config.path attendu");
}
if (/sync_rules:/.test(service)) fail("service.yaml : sync_rules legacy encore présent");
if (!compose.includes("sync-config.yaml")) fail("docker-compose : montage sync-config.yaml absent");
if (compose.includes("sync-rules.yaml")) fail("docker-compose : sync-rules.yaml encore monté");

const fluxAttendus = [
  "cabinet_global",
  "dossiers_publics",
  "dossiers_restreints",
  "parties_publics",
  "parties_restreints",
  "documents_publics",
  "documents_restreints",
  "document_versions_publics",
  "document_versions_restreints",
];

/** Extrait le bloc YAML d'un flux nommé (clés de flux : exactement 2 espaces). */
function blocFlux(nom) {
  const re = new RegExp(`^  ${nom}:[ \\t]*\\r?\\n([\\s\\S]*?)(?=^  [a-z_]+:|(?![\\s\\S]))`, "m");
  const m = yaml.match(re);
  if (!m) fail(`flux ${nom} absent`);
  return m[1];
}

for (const nom of fluxAttendus) {
  if (!new RegExp(`^  ${nom}:`, "m").test(yaml)) fail(`flux ${nom} absent`);
  const bloc = blocFlux(nom);
  if (!/auto_subscribe:\s*true/.test(bloc)) fail(`${nom} : auto_subscribe: true requis`);
}

for (const interdit of ["temps_publics", "temps_restreints", "brouillons_", "taux_"]) {
  if (new RegExp(`^  ${interdit}`, "m").test(yaml)) {
    fail(`flux J8 (${interdit}*) hors périmètre de cette migration Sync Streams`);
  }
}

const global = blocFlux("cabinet_global");
if (!/\bFROM cabinets\b/i.test(global) || !/\bFROM journal_modifications\b/i.test(global)) {
  fail("cabinet_global : cabinets + journal_modifications requis");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(global)) {
  fail("cabinet_global : auth.parameter('cabinet_id') requis");
}

const dossiersPublics = blocFlux("dossiers_publics");
if (!/visibilite\s*=\s*'public'/.test(dossiersPublics)) fail("dossiers_publics : filtre visibilite public");
if (!/auth\.parameter\('cabinet_id'\)/.test(dossiersPublics)) {
  fail("dossiers_publics : auth.parameter('cabinet_id') requis");
}

const dossiersRestreints = blocFlux("dossiers_restreints");
if (!/INNER JOIN dossier_acces/i.test(dossiersRestreints)) {
  fail("dossiers_restreints : JOIN dossier_acces requis");
}
if (!/auth\.user_id\(\)/.test(dossiersRestreints)) {
  fail("dossiers_restreints : auth.user_id() requis");
}

for (const nom of ["parties_publics", "documents_publics", "document_versions_publics"]) {
  const bloc = blocFlux(nom);
  if (!/INNER JOIN dossiers/i.test(bloc) && !/IN\s*\(\s*SELECT[\s\S]*FROM dossiers/i.test(bloc)) {
    fail(`${nom} : JOIN ou sous-requête dossiers requis`);
  }
  if (!/visibilite\s*=\s*'public'/.test(bloc)) fail(`${nom} : filtre dossiers publics requis`);
}

for (const nom of ["parties_restreints", "documents_restreints", "document_versions_restreints"]) {
  const bloc = blocFlux(nom);
  if (!/INNER JOIN dossier_acces/i.test(bloc)) fail(`${nom} : JOIN dossier_acces requis`);
  if (!/auth\.user_id\(\)/.test(bloc)) fail(`${nom} : auth.user_id() requis`);
  if (/WHERE[\s\S]*\b(documents|document_versions|parties)\.visibilite\s*=/.test(bloc)) {
    fail(`${nom} : filtre visibilite fille interdit (auth via dossier_acces)`);
  }
}

const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
for (const table of ["dossiers", "parties", "documents", "document_versions"]) {
  if (!new RegExp(`\\b${table}\\b`).test(schema)) fail(`AppSchema : table ${table} absente`);
}

const doc = readFileSync(join(root, "docs/sync-streams.md"), "utf8");
if (!/edition:\s*3|édition 3/i.test(doc)) fail("docs/sync-streams.md : édition 3 absente");

console.log("s5-sync-streams: OK — flux Sync Streams (dossiers, parties, documents, versions)");
