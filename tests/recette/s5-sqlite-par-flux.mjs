#!/usr/bin/env node
/**
 * S5 — couverture des preuves SQLite par famille de flux (Migration Sync Streams).
 * Critère d'acceptation : dossiers, documents, versions, temps, brouillons
 * absents de la SQLite du poste non autorisé (ordre § 3 S5 ; pas seulement Postgres).
 * Usage : node tests/recette/s5-sqlite-par-flux.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const recetteDir = join(root, "tests/recette");

function fail(message) {
  console.error(`s5-sqlite-par-flux: FAIL — ${message}`);
  process.exit(1);
}

const fichiers = readdirSync(recetteDir)
  .filter((n) => n.endsWith(".mjs"))
  .map((n) => ({ nom: n, texte: readFileSync(join(recetteDir, n), "utf8") }));

/** Preuve S5 : SQLite du poste PowerSync (pas un sqlite3 jetable de fumée). */
function preuveSqliteS5(table) {
  return fichiers.filter((f) => {
    const posteDb =
      /legalos-powersync-[ab]\.db/i.test(f.texte) ||
      (/function sqliteLocal/i.test(f.texte) && /LEGALOS_POSTE_ID|poste B|startApp\(/i.test(f.texte));
    if (!posteDb) return false;
    if (!new RegExp(`SELECT[\\s\\S]{0,240}\\bFROM\\s+${table}\\b`, "i").test(f.texte)) return false;
    return /non autoris|poste B|collab|interdit|restreint présentes chez|absents du SQLite/i.test(
      f.texte,
    );
  });
}

const familles = [
  { table: "dossiers", label: "dossiers" },
  { table: "documents", label: "documents" },
  { table: "document_versions", label: "versions" },
  { table: "temps_saisis", label: "temps" },
  { table: "brouillons_facture", label: "brouillons" },
];

const manques = [];
for (const { table, label } of familles) {
  const preuves = preuveSqliteS5(table);
  if (preuves.length === 0) {
    manques.push(
      `${label} (${table}) : aucune recette ne vérifie l'absence en SQLite chez un poste non autorisé`,
    );
  }
}

// s9-s5-temps ne doit pas se faire passer pour une preuve SQLite.
const s9 = fichiers.find((f) => f.nom === "s9-s5-temps.mjs");
if (s9 && !/sqlite3\.connect|sqliteLocal|legalos-powersync-/i.test(s9.texte)) {
  const doc = readFileSync(join(root, "docs/sync-streams.md"), "utf8");
  if (/Preuve\s*:[\s\S]{0,120}s9-s5-temps\.mjs/i.test(doc) && /SQLite locale/i.test(doc)) {
    manques.push(
      "docs/sync-streams.md cite s9-s5-temps.mjs comme preuve SQLite alors que ce fichier n'ouvre pas la SQLite",
    );
  }
}

// j5 : contrôles documents/versions sans dépôt de pièce sur le dossier restreint = vacuité.
const j5 = fichiers.find((f) => f.nom === "j5-poste-tauri.mjs");
if (j5) {
  const checkDocs = /FROM documents WHERE dossier_id = '\$\{idRestreint\}'/.test(j5.texte);
  const checkVersions = /FROM document_versions WHERE dossier_id = '\$\{idRestreint\}'/.test(
    j5.texte,
  );
  const depotPiece =
    /\/api\/documents|presign|empreinte|Garage|document_versions.*POST|POST[\s\S]{0,120}versions/i.test(
      j5.texte,
    );
  if ((checkDocs || checkVersions) && !depotPiece) {
    manques.push(
      "j5-poste-tauri.mjs:461-474 — SELECT documents/versions sur dossier restreint sans dépôt de pièce → assertion vacueuse pour flux documents/versions",
    );
  }
}

if (manques.length > 0) {
  for (const m of manques) console.error(`s5-sqlite-par-flux: — ${m}`);
  fail(`${manques.length} trou(s) de couverture SQLite S5 par flux`);
}

console.log("s5-sqlite-par-flux: OK — preuves SQLite locales présentes pour dossiers, documents, versions, temps, brouillons");
