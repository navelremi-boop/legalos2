#!/usr/bin/env node
/**
 * Réaligne les sommes de contrôle sqlx d'une base locale sur le contenu commité des migrations.
 *
 * Contexte : sous Windows, l'arbre de travail peut être en CRLF alors que le dépôt est en LF
 * (`.gitattributes`). Une image API construite avant la normalisation de `instance/Dockerfile.api`
 * a enregistré dans `_sqlx_migrations` la somme SHA-384 des fichiers en CRLF ; l'image actuelle,
 * ramenée en LF, refuserait alors de démarrer (« migration was previously applied but has been
 * modified »).
 *
 * Portée stricte : seule une somme égale à celle de la variante CRLF du fichier commité est
 * remplacée par la somme LF (même contenu SQL, fins de ligne près). Toute autre différence arrête
 * l'outil sans rien modifier. Sans `--appliquer`, l'outil se contente d'afficher le constat.
 *
 * Usage (racine du dépôt, pile `instance/` démarrée) :
 *   node instance/outils/realigner-migrations-lf.mjs            # constat
 *   node instance/outils/realigner-migrations-lf.mjs --appliquer
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appliquer = process.argv.includes("--appliquer");

function psql(sql) {
  const r = spawnSync(
    "docker",
    [
      "compose", "-f", "instance/docker-compose.yml", "--env-file", ".env",
      "exec", "-T", "postgres", "psql", "-U", "legalos", "-d", "legalos",
      "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`psql : ${r.stderr.trim()}`);
  return r.stdout.trim();
}

const fichiers = execFileSync("git", ["ls-files", "crates/api/migrations/*.sql"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const enBase = new Map(
  psql("SELECT version, encode(checksum, 'hex') FROM _sqlx_migrations ORDER BY version")
    .split("\n")
    .filter(Boolean)
    .map((ligne) => {
      const [version, somme] = ligne.split("|");
      return [Number(version), somme];
    }),
);

// Constat complet avant toute écriture : une seule somme inexpliquée suffit à tout arrêter.
const aRealigner = [];
for (const fichier of fichiers) {
  const version = Number(fichier.split("/").pop().split("_")[0]);
  const lf = execFileSync("git", ["show", `:${fichier}`], { cwd: root });
  const crlf = Buffer.from(lf.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
  const sommeLf = createHash("sha384").update(lf).digest("hex");
  const sommeCrlf = createHash("sha384").update(crlf).digest("hex");
  const actuelle = enBase.get(version);
  if (!actuelle) {
    console.log(`${version} : non appliquée`);
  } else if (actuelle === sommeLf) {
    console.log(`${version} : conforme au commit (LF)`);
  } else if (actuelle === sommeCrlf) {
    console.log(`${version} : enregistrée en CRLF`);
    aRealigner.push({ version, sommeLf });
  } else {
    console.error(`${version} : somme de contrôle inexpliquée — arrêt, aucune modification`);
    process.exit(1);
  }
}

if (!appliquer) {
  console.log(`${aRealigner.length} migration(s) à réaligner (relancer avec --appliquer)`);
  process.exit(0);
}
for (const { version, sommeLf } of aRealigner) {
  psql(
    `UPDATE _sqlx_migrations SET checksum = decode('${sommeLf}', 'hex') WHERE version = ${version}`,
  );
  console.log(`${version} : réalignée sur le commit (LF)`);
}
console.log(`${aRealigner.length} migration(s) réalignée(s)`);
