#!/usr/bin/env node
/**
 * Vérifie que chaque workflow GitHub Actions est un YAML valide, avec des jobs et des étapes.
 * Un fichier invalide fait échouer la CI en 0 s sans exécuter aucun contrôle : ce script se lance
 * avant de pousser une modification de `.github/workflows/`.
 *
 * js-yaml est une dépendance transitive (outillage ESLint) : résolu dans le magasin pnpm.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dossierWorkflows = join(root, ".github/workflows");

function fail(msg) {
  console.error(`workflows-valides: FAIL — ${msg}`);
  process.exit(1);
}

function chargerJsYaml() {
  const magasin = join(root, "node_modules/.pnpm");
  const version = existsSync(magasin)
    ? readdirSync(magasin).find((nom) => /^js-yaml@\d/.test(nom))
    : undefined;
  if (!version) fail("js-yaml introuvable dans node_modules/.pnpm (lancer pnpm install)");
  const require = createRequire(import.meta.url);
  return require(join(magasin, version, "node_modules/js-yaml"));
}

function actionsAutorisees(texte) {
  const map = new Map();
  let dans = false;
  for (const ligne of texte.split(/\n/)) {
    if (ligne.startsWith("## Actions tierces autorisées")) {
      dans = true;
      continue;
    }
    if (dans && ligne.startsWith("## ")) break;
    if (!dans) continue;
    const cellules = ligne.split("|").map((c) => c.trim());
    if (cellules.length < 4) continue;
    const action = cellules[1];
    const version = cellules[2];
    if (!action || action === "Action" || action.startsWith("-")) continue;
    map.set(action, version);
  }
  return map;
}

function erreurAction(spec, autorisees) {
  if (spec.startsWith("./") || spec.startsWith("docker://")) {
    return `action locale ou image interdite : ${spec}`;
  }
  const arobase = spec.split("@");
  const chemin = arobase[0];
  const version = arobase.slice(1).join("@");
  const owner = chemin.split("/")[0];
  if (owner === "actions" || owner === "github") return "";
  const attendue = autorisees.get(chemin);
  if (!attendue) return `action tierce non autorisée : ${chemin}`;
  if (version !== attendue) return `${chemin}@${version || "?"} : la liste autorise ${attendue}`;
  return "";
}

const texteBlocages = readFileSync(join(root, "BLOCAGES.md"), "utf8");
const autorisees = actionsAutorisees(texteBlocages);
if (autorisees.size === 0) fail("BLOCAGES.md : tableau « Actions tierces autorisées » vide");
const essai = erreurAction("evil/action@v1", autorisees);
if (!essai.includes("evil/action")) fail("essai négatif des actions tierces muet");

const yaml = chargerJsYaml();
const fichiers = readdirSync(dossierWorkflows).filter((nom) => /\.ya?ml$/.test(nom));
if (fichiers.length === 0) fail("aucun workflow dans .github/workflows");

for (const nom of fichiers) {
  let document;
  try {
    document = yaml.load(readFileSync(join(dossierWorkflows, nom), "utf8"));
  } catch (e) {
    fail(`${nom} : ${e.reason ?? e.message} (ligne ${(e.mark?.line ?? -1) + 1})`);
  }
  const jobs = document?.jobs;
  if (!jobs || Object.keys(jobs).length === 0) fail(`${nom} : aucun job`);
  for (const [job, definition] of Object.entries(jobs)) {
    if (!Array.isArray(definition?.steps) || definition.steps.length === 0) {
      fail(`${nom} : job « ${job} » sans étape`);
    }
  }
  if (nom === "ci.yml") {
    if (document.permissions?.contents !== "read") {
      fail("ci.yml : permissions.contents doit être read");
    }
    if (jobs["macos-placeholder"]) fail("ci.yml : macos-placeholder retiré (S14b, J16, déclenchement manuel)");
    if (!jobs.perimetre) fail("ci.yml : job perimetre absent");
    for (const lourd of ["rust", "s1-instance", "facturx"]) {
      const condition = String(jobs[lourd]?.if ?? "");
      if (!condition.includes("perimetre")) {
        fail(`ci.yml : ${lourd} doit dépendre du périmètre (push Markdown)`);
      }
    }
    if (jobs.frontend?.if || jobs.gouvernance?.if) {
      fail("ci.yml : frontend et gouvernance restent lancés même pour un push Markdown");
    }
  }
  const brut = readFileSync(join(dossierWorkflows, nom), "utf8");
  for (const correspondance of brut.matchAll(/uses:\s*['"]?([^'"\s#]+)/g)) {
    const erreur = erreurAction(correspondance[1], autorisees);
    if (erreur) fail(`${nom} : ${erreur}`);
  }
  console.log(`workflows-valides: ${nom} OK (${Object.keys(jobs).length} jobs)`);
}

console.log("workflows-valides: OK");
