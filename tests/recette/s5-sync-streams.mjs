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
  "repertoires_publics",
  "repertoires_restreints",
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
  "contacts_cabinet",
  "dossier_liens_publics",
  "dossier_liens_restreints",
  "dossier_liens_restreints_croises",
  "agenda_publics",
  "agenda_restreints",
  "messages_publics",
  "messages_restreints",
  "messages_a_classer",
  "messages_nominatifs",
  "comptes_nominatifs",
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
if (/JOIN\s+dossiers/i.test(journalPublics)) {
  fail("journal_publics : JOIN dossiers interdit (un bucket par dossier)");
}
if (!/journal_modifications\.visibilite\s*=\s*'public'/.test(journalPublics)) {
  fail("journal_publics : visibilite copiee sur la fille requise");
}
if (!/dossier_id\s+IS\s+NOT\s+NULL/i.test(journalPublics)) {
  fail("journal_publics : dossier_id IS NOT NULL requis");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(journalPublics)) {
  fail("journal_publics : auth.parameter('cabinet_id') requis");
}

const journalRestreints = blocFlux("journal_restreints");
if (!/INNER JOIN groupe_acces_membres/i.test(journalRestreints)) {
  fail("journal_restreints : JOIN groupe_acces_membres requis");
}
if (/JOIN\s+dossier_acces/i.test(journalRestreints)) {
  fail("journal_restreints : JOIN dossier_acces interdit (un bucket par dossier)");
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
if (!/INNER JOIN groupe_acces_membres/i.test(dossiersRestreints)) {
  fail("dossiers_restreints : JOIN groupe_acces_membres requis");
}
if (/JOIN\s+dossier_acces/i.test(dossiersRestreints)) {
  fail("dossiers_restreints : JOIN dossier_acces interdit (un bucket par dossier)");
}
if (!/auth\.user_id\(\)/.test(dossiersRestreints)) {
  fail("dossiers_restreints : auth.user_id() requis");
}
if (!/\breference\b/.test(dossiersRestreints)) {
  fail("dossiers_restreints : colonne reference requise (§ 3.4)");
}

// Un JOIN dossiers crée un bucket PowerSync par dossier (PSYNC_S2305, limite 1000).
// La visibilité copiée sur la fille, tenue par le déclencheur, suffit : un seul bucket par cabinet.
for (const nom of [
  "parties_publics",
  "repertoires_publics",
  "documents_publics",
  "document_versions_publics",
  "temps_publics",
  "brouillons_publics",
  "taux_publics",
  "intercalaires_publics",
  "intercalaire_elements_publics",
  "dossier_liens_publics",
  "agenda_publics",
  "messages_publics",
]) {
  const bloc = blocFlux(nom);
  if (/JOIN\s+dossiers/i.test(bloc)) fail(`${nom} : JOIN dossiers interdit (un bucket par dossier)`);
  if (!/visibilite\s*=\s*'public'/.test(bloc)) fail(`${nom} : visibilite publique requise`);
  if (!/auth\.parameter\('cabinet_id'\)/.test(bloc)) fail(`${nom} : auth.parameter('cabinet_id') requis`);
}

const elementsPublics = blocFlux("intercalaire_elements_publics");
if (/JOIN\s+dossiers/i.test(elementsPublics)) {
  fail("intercalaire_elements_publics : JOIN dossiers interdit (un bucket par dossier)");
}
if (!/intercalaire_elements\.visibilite\s*=\s*'public'/.test(elementsPublics)) {
  fail("intercalaire_elements_publics : visibilite copiee requise");
}
if (!/intercalaire_elements\.cabinet_id/.test(elementsPublics)) {
  fail("intercalaire_elements_publics : cabinet_id de la fille requis");
}

for (const nom of [
  "parties_restreints",
  "repertoires_restreints",
  "documents_restreints",
  "document_versions_restreints",
  "temps_restreints",
  "brouillons_restreints",
  "taux_restreints",
  "intercalaires_restreints",
  "intercalaire_elements_restreints",
  "dossier_liens_restreints",
  "dossier_liens_restreints_croises",
  "agenda_restreints",
  "messages_restreints",
]) {
  const bloc = blocFlux(nom);
  if (!/INNER JOIN groupe_acces_membres/i.test(bloc)) {
    fail(`${nom} : JOIN groupe_acces_membres requis (un bucket par groupe)`);
  }
  if (/JOIN\s+dossier_acces/i.test(bloc) || /JOIN\s+dossiers/i.test(bloc)) {
    fail(`${nom} : jointure par dossier interdite`);
  }
  if (!/auth\.user_id\(\)/.test(bloc)) fail(`${nom} : auth.user_id() requis`);
  if (
    /WHERE[\s\S]*\b(documents|document_versions|repertoires|parties|temps_saisis|brouillons_facture|taux_horaires|intercalaires_personnalises|intercalaire_elements|dossier_liens|agenda_elements)\.visibilite\s*=/.test(
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

const contactsCabinet = blocFlux("contacts_cabinet");
if (/JOIN\s+dossiers/i.test(contactsCabinet)) {
  fail("contacts_cabinet : JOIN dossiers interdit (un seul seau cabinet)");
}
if (!/auth\.parameter\('cabinet_id'\)/.test(contactsCabinet)) {
  fail("contacts_cabinet : auth.parameter('cabinet_id') requis");
}
if (!/\bFROM contacts\b/i.test(contactsCabinet)) {
  fail("contacts_cabinet : contacts requis");
}
if (/\bdossier_id\b/.test(contactsCabinet)) {
  fail("contacts_cabinet : l'annuaire ne porte pas le dossier");
}
if (!/\bnom\b/.test(contactsCabinet) || !/\bsiren\b/.test(contactsCabinet)) {
  fail("contacts_cabinet : nom et SIREN requis (annuaire commun)");
}
if (/secret_ref|mot_de_passe|imap_password/i.test(yaml)) {
  fail("sync-config : identifiant de messagerie exposé");
}
const comptes = blocFlux("comptes_nominatifs");
if (!/type_compte\s*=\s*'nominatif'/.test(comptes)) {
  fail("comptes_nominatifs : type nominatif requis");
}
if (!/titulaire_id::text\s*=\s*auth\.user_id\(\)/.test(comptes)) {
  fail("comptes_nominatifs : titulaire = auth.user_id() requis");
}
if (/secret_ref/.test(comptes)) fail("comptes_nominatifs : secret_ref interdit");

for (const nom of ["messages_publics", "messages_restreints", "messages_a_classer", "messages_nominatifs"]) {
  if (!/texte_brut/.test(blocFlux(nom))) fail(`${nom} : texte_brut requis`);
}
const messagesPublics = blocFlux("messages_publics");
if (!/dossier_id IS NOT NULL/.test(messagesPublics)) {
  fail("messages_publics : dossier classé seulement (le nominatif a son flux)");
}
const aClasser = blocFlux("messages_a_classer");
if (/JOIN/i.test(aClasser)) fail("messages_a_classer : jointure interdite");
if (!/dossier_id IS NULL/.test(aClasser) || !/titulaire_id IS NULL/.test(aClasser)) {
  fail("messages_a_classer : boîte de classement sans titulaire");
}
const nominatifs = blocFlux("messages_nominatifs");
if (/JOIN/i.test(nominatifs)) fail("messages_nominatifs : jointure interdite (un seau par titulaire)");
if (!/titulaire_id::text\s*=\s*auth\.user_id\(\)/.test(nominatifs)) {
  fail("messages_nominatifs : titulaire = auth.user_id() requis");
}

const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
for (const table of [
  "dossiers",
  "parties",
  "repertoires",
  "documents",
  "document_versions",
  "temps_saisis",
  "brouillons_facture",
  "taux_horaires",
  "intercalaires_personnalises",
  "intercalaire_elements",
  "contacts",
  "dossier_liens",
  "agenda_elements",
  "messages",
  "comptes_mail",
]) {
  if (!new RegExp(`\\b${table}\\b`).test(schema)) fail(`AppSchema : table ${table} absente`);
}
if (!/texte_brut/.test(schema)) fail("AppSchema : texte_brut absent");

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

if (requetes.length < 25) fail(`requêtes Sync Streams insuffisantes (${requetes.length})`);
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
  "s5-sync-streams: OK — flux Sync Streams (cabinet, journal ×3, dossiers, parties, repertoires, documents, versions, temps, brouillons, taux, intercalaires, éléments)",
);
