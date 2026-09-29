#!/usr/bin/env node
/**
 * S5 — Sync Streams : contrôle statique des flux (dossiers, parties, documents, versions, temps, brouillons, taux, intercalaires).
 * Invariant : un dossier restreint et ses enfants ne descendent que via dossier_acces + auth.user_id().
 * Usage : node tests/recette/s5-sync-streams.mjs
 */
import { existsSync, readFileSync } from "node:fs";
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
  "journal_cabinet",
  "journal_publics",
  "journal_restreints",
  "dossiers_publics",
  "dossiers_restreints",
  "parties_publics",
  "parties_restreints",
  "documents_publics",
  "documents_restreints",
  "document_versions_publics",
  "document_versions_restreints",
  "temps_publics",
  "temps_restreints",
  "brouillons_publics",
  "brouillons_restreints",
  "taux_cabinet",
  "taux_publics",
  "taux_restreints",
  "intercalaires_publics",
  "intercalaires_restreints",
  "intercalaire_elements_publics",
  "intercalaire_elements_restreints",
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

const global = blocFlux("cabinet_global");
if (!/\bFROM cabinets\b/i.test(global)) {
  fail("cabinet_global : cabinets requis");
}
if (/\bFROM journal_modifications\b/i.test(global)) {
  fail("cabinet_global : journal_modifications interdit (trois flux dédiés)");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(global)) {
  fail("cabinet_global : auth.parameter('cabinet_id') requis");
}

const journalCabinet = blocFlux("journal_cabinet");
if (!/\bFROM journal_modifications\b/i.test(journalCabinet)) {
  fail("journal_cabinet : journal_modifications requis");
}
if (!/dossier_id\s+IS\s+NULL/i.test(journalCabinet)) {
  fail("journal_cabinet : dossier_id IS NULL requis");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(journalCabinet)) {
  fail("journal_cabinet : auth.parameter('cabinet_id') requis");
}

const journalPublics = blocFlux("journal_publics");
if (!/INNER JOIN dossiers/i.test(journalPublics)) {
  fail("journal_publics : JOIN dossiers requis");
}
if (!/visibilite\s*=\s*'public'/.test(journalPublics)) {
  fail("journal_publics : filtre dossiers publics requis");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(journalPublics)) {
  fail("journal_publics : auth.parameter('cabinet_id') requis");
}

const journalRestreints = blocFlux("journal_restreints");
if (!/INNER JOIN dossier_acces/i.test(journalRestreints)) {
  fail("journal_restreints : JOIN dossier_acces requis");
}
if (!/auth\.user_id\(\)/.test(journalRestreints)) {
  fail("journal_restreints : auth.user_id() requis");
}

const dossiersPublics = blocFlux("dossiers_publics");
if (!/visibilite\s*=\s*'public'/.test(dossiersPublics)) fail("dossiers_publics : filtre visibilite public");
if (!/auth\.parameter\('cabinet_id'\)/.test(dossiersPublics)) {
  fail("dossiers_publics : auth.parameter('cabinet_id') requis");
}
if (!/\breference\b/.test(dossiersPublics)) {
  fail("dossiers_publics : colonne reference requise (§ 3.4)");
}

const dossiersRestreints = blocFlux("dossiers_restreints");
if (!/INNER JOIN dossier_acces/i.test(dossiersRestreints)) {
  fail("dossiers_restreints : JOIN dossier_acces requis");
}
if (!/auth\.user_id\(\)/.test(dossiersRestreints)) {
  fail("dossiers_restreints : auth.user_id() requis");
}
if (!/\breference\b/.test(dossiersRestreints)) {
  fail("dossiers_restreints : colonne reference requise (§ 3.4)");
}

for (const nom of [
  "parties_publics",
  "documents_publics",
  "document_versions_publics",
  "temps_publics",
  "brouillons_publics",
  "taux_publics",
  "intercalaires_publics",
  "intercalaire_elements_publics",
]) {
  const bloc = blocFlux(nom);
  if (!/INNER JOIN dossiers/i.test(bloc) && !/IN\s*\(\s*SELECT[\s\S]*FROM dossiers/i.test(bloc)) {
    fail(`${nom} : JOIN ou sous-requête dossiers requis`);
  }
  if (!/visibilite\s*=\s*'public'/.test(bloc)) fail(`${nom} : filtre dossiers publics requis`);
}

for (const nom of [
  "parties_restreints",
  "documents_restreints",
  "document_versions_restreints",
  "temps_restreints",
  "brouillons_restreints",
  "taux_restreints",
  "intercalaires_restreints",
  "intercalaire_elements_restreints",
]) {
  const bloc = blocFlux(nom);
  if (!/INNER JOIN dossier_acces/i.test(bloc)) fail(`${nom} : JOIN dossier_acces requis`);
  if (!/auth\.user_id\(\)/.test(bloc)) fail(`${nom} : auth.user_id() requis`);
  if (
    /WHERE[\s\S]*\b(documents|document_versions|parties|temps_saisis|brouillons_facture|taux_horaires|intercalaires_personnalises|intercalaire_elements)\.visibilite\s*=/.test(
      bloc,
    )
  ) {
    fail(`${nom} : filtre visibilite fille interdit (auth via dossier_acces)`);
  }
}

const tauxCabinet = blocFlux("taux_cabinet");
if (!/dossier_id\s+IS\s+NULL/i.test(tauxCabinet)) fail("taux_cabinet : dossier_id IS NULL requis");
if (!/auth\.parameter\('cabinet_id'\)/.test(tauxCabinet)) {
  fail("taux_cabinet : auth.parameter('cabinet_id') requis");
}

const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
for (const table of [
  "dossiers",
  "parties",
  "documents",
  "document_versions",
  "temps_saisis",
  "brouillons_facture",
  "taux_horaires",
  "intercalaires_personnalises",
  "intercalaire_elements",
]) {
  if (!new RegExp(`\\b${table}\\b`).test(schema)) fail(`AppSchema : table ${table} absente`);
}

const doc = readFileSync(join(root, "docs/sync-streams.md"), "utf8");
if (!/edition:\s*3|édition 3/i.test(doc)) fail("docs/sync-streams.md : édition 3 absente");

/** Compte les tables d'un FROM…JOIN (contrat ≤ 2 tables par requête). */
function compterTables(sql) {
  const from = [...sql.matchAll(/\bFROM\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
  const joins = [...sql.matchAll(/\bJOIN\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
  return new Set([...from, ...joins]).size;
}

const requetes = [...yaml.matchAll(/(?:^|\n)\s{4,}-\s*(SELECT[\s\S]*?)(?=\n\s{4}-\s*SELECT|\n\s{2}[a-z_]+:|\n*$)/gi)]
  .map((m) => m[1])
  .concat(
    [...yaml.matchAll(/\bquery:\s*(?:\|\s*\n([\s\S]*?)(?=\n\s{2}[a-z_]+:|\n*$)|([^\n]+))/gi)].map(
      (m) => (m[1] ?? m[2] ?? "").trim(),
    ),
  )
  .filter((q) => /\bSELECT\b/i.test(q));

if (requetes.length < 23) fail(`requêtes Sync Streams insuffisantes (${requetes.length})`);
for (const sql of requetes) {
  const n = compterTables(sql);
  if (n > 2) fail(`requête > 2 tables (${n}) : ${sql.slice(0, 80).replace(/\s+/g, " ")}…`);
}

const versions = readFileSync(join(root, "docs/versions.md"), "utf8");
if (!/powersync-service:1\.26\.1/.test(versions) && !/1\.26\.1/.test(compose)) {
  fail("service PowerSync ≥ 1.26.1 absent (compose / versions.md)");
}
if (!/GHSA-q6wc-xx4m-92fj/.test(versions)) {
  fail("docs/versions.md : avis GHSA-q6wc-xx4m-92fj requis (PLAN Migration Sync Streams)");
}
if (!/1\.23\.3/.test(versions)) {
  fail("docs/versions.md : correctif 1.23.3 requis");
}

if (existsSync(join(root, "instance/powersync/sync-rules.yaml"))) {
  fail("instance/powersync/sync-rules.yaml encore présent (legacy)");
}
if (existsSync(join(root, "docs/sync-rules.md"))) {
  fail("docs/sync-rules.md encore présent (remplacé par sync-streams.md)");
}

console.log(
  "s5-sync-streams: OK — flux Sync Streams (cabinet, journal ×3, dossiers, parties, documents, versions, temps, brouillons, taux, intercalaires, éléments)",
);
