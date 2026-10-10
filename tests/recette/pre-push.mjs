#!/usr/bin/env node
/**
 * Politique de push autonome (décision de l'architecte du 10/10/2026) : `.githooks/pre-push` appelle
 * `scripts/pre-push-check.mjs`. Chaque règle a son essai négatif, joué de bout en bout par un vrai `git push`
 * dans un dépôt temporaire (origin nu + clone de travail qui embarque le script et le hook) :
 * - un push rapide sur main passe (le garde n'est pas un refus systématique) ;
 * - refus : push non rapide (sommet distant inconnu, puis origin/main récupéré mais divergent), tag, `--tags`,
 *   suppression (`--delete`, `:branche`, `:main`), gouvernance en échec, branche autre que main, remote autre qu'origin ;
 * - sortie 2 « revue du commandement requise » : un chemin protégé est touché ; le push est refusé et l'origine reste intacte.
 * Après chaque refus, le sommet de l'origine n'a pas bougé.
 *
 * Usage : node tests/recette/pre-push.mjs
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHEMINS_PROTEGES, estProtege, lireRefs } from "../../scripts/pre-push-check.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`pre-push: FAIL — ${msg}`);
  process.exit(1);
}

const env = { ...process.env };
for (const cle of Object.keys(env)) if (cle.startsWith("GIT_") && !cle.startsWith("GIT_EXEC")) delete env[cle];
Object.assign(env, {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

function git(cwd, args, { attendu = 0 } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
  if (attendu !== null && r.status !== attendu) {
    fail(`git ${args.join(" ")} (${cwd}) : code ${r.status}, ${attendu} attendu — ${r.stderr || r.stdout}`);
  }
  return r;
}

const dossiers = [];
process.on("exit", () => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

/** Dépôt temporaire : origin nu, clone de travail avec le script, le hook et un faux garde de gouvernance. */
function creerDepot({ gouvernance = 0 } = {}) {
  const base = mkdtempSync(join(tmpdir(), "legalos-prepush-"));
  dossiers.push(base);
  const origin = join(base, "origin.git");
  const travail = join(base, "travail");
  git(base, ["init", "--bare", "-b", "main", origin]);
  git(base, ["clone", origin, travail]);
  git(travail, ["config", "user.name", "test"]);
  git(travail, ["config", "user.email", "test@example.com"]);
  git(travail, ["config", "core.autocrlf", "false"]);
  git(travail, ["switch", "-c", "main"], { attendu: null });
  mkdirSync(join(travail, "scripts"), { recursive: true });
  mkdirSync(join(travail, "tests/recette"), { recursive: true });
  mkdirSync(join(travail, ".githooks"), { recursive: true });
  copyFileSync(join(racine, "scripts/pre-push-check.mjs"), join(travail, "scripts/pre-push-check.mjs"));
  copyFileSync(join(racine, ".githooks/pre-push"), join(travail, ".githooks/pre-push"));
  writeFileSync(join(travail, "tests/recette/plan-gouvernance.mjs"), `process.exit(${gouvernance});\n`, "utf8");
  writeFileSync(join(travail, "LISEZMOI.md"), "dépôt de test\n", "utf8");
  git(travail, ["add", "-A"]);
  git(travail, ["commit", "-q", "-m", "initial"]);
  git(travail, ["push", "--no-verify", "-u", "origin", "main"]);
  git(travail, ["config", "core.hooksPath", ".githooks"]);
  return { base, origin, travail };
}

const sommetOrigin = (d, ref = "main") => git(d.origin, ["rev-parse", ref]).stdout.trim();

function commit(d, fichier, contenu = "x\n") {
  const chemin = join(d.travail, fichier);
  mkdirSync(dirname(chemin), { recursive: true });
  // un fichier existant (le script lui-même) reçoit une ligne de commentaire pour rester exécutable
  if (existsSync(chemin)) appendFileSync(chemin, "\n// modification de test\n", "utf8");
  else writeFileSync(chemin, contenu, "utf8");
  git(d.travail, ["add", "-A"]);
  git(d.travail, ["commit", "-q", "-m", `modif ${fichier}`]);
}

function refuse(libelle, d, args, fragment, avant = sommetOrigin(d)) {
  const r = git(d.travail, ["push", ...args], { attendu: null });
  if (r.status === 0) fail(`${libelle} : le push aurait dû être refusé`);
  const sortie = `${r.stderr}${r.stdout}`;
  if (fragment && !sortie.includes(fragment)) fail(`${libelle} : message sans « ${fragment} » : ${sortie.slice(-400)}`);
  if (sommetOrigin(d) !== avant) fail(`${libelle} : le sommet de l'origine a bougé malgré le refus`);
  console.log(`pre-push: ${libelle} — refusé`);
}

function verifierScript(d, args = [], input = "") {
  return spawnSync(process.execPath, [join(d.travail, "scripts/pre-push-check.mjs"), ...args], {
    cwd: d.travail,
    encoding: "utf8",
    input,
    env,
  });
}

// — câblage du dépôt réel : hook exécutable, appelant le script —
{
  const hook = readFileSync(join(racine, ".githooks/pre-push"), "utf8");
  if (!hook.startsWith("#!/bin/sh") || !hook.includes("scripts/pre-push-check.mjs")) fail(".githooks/pre-push n'appelle pas scripts/pre-push-check.mjs");
  const mode = /^(\d+)/.exec(git(racine, ["ls-files", "-s", ".githooks/pre-push"]).stdout)?.[1];
  if (mode !== "100755") fail(`.githooks/pre-push : mode ${mode}, 100755 attendu`);
  console.log("pre-push: câblage — hook exécutable qui appelle le script");
}

// — chemins protégés : classement —
{
  const protegesAttendus = [
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".cursor/hooks/garde-commandes.mjs",
    ".cursor/permissions.json",
    "CLAUDE.md",
    ".github/workflows/ci.yml",
    "scripts/pre-push-check.mjs",
    "tests/recette/plan-gouvernance.mjs",
    "tests/recette/garde-hooks.mjs",
    "tests/recette/regles-synchronisees.mjs",
    "tests/recette/pre-push.mjs",
    ".githooks/pre-push",
    ".cursor/hooks.json",
  ];
  for (const chemin of protegesAttendus) if (!estProtege(chemin)) fail(`${chemin} devrait être protégé`);
  if (!estProtege(".github\\workflows\\ci.yml")) fail("séparateur Windows non reconnu");
  for (const chemin of ["PLAN.md", "docs/ordre-operation.md", ".claude/rules/00-global.md", ".cursor/rules/a.mdc", ".githubx/a", "CLAUDE.md.bak", "scripts/autre.mjs", "tests/recette/pre-push2.mjs", "apps/poste/CLAUDE.md"]) {
    if (estProtege(chemin)) fail(`${chemin} ne devrait pas être protégé`);
  }
  if (CHEMINS_PROTEGES.length < 11) fail("liste des chemins protégés amputée");
  const refs = lireRefs("refs/heads/main aaaa refs/heads/main bbbb\n(delete) 0000 refs/heads/x cccc\n");
  if (refs.length !== 2 || refs[1].refLocale !== "(delete)" || refs[0].shaDistant !== "bbbb") fail("lireRefs : lignes mal lues");
  console.log(`pre-push: chemins protégés — ${protegesAttendus.length} reconnus, 9 faux positifs écartés`);
}

// — push rapide sur main : passe —
{
  const d = creerDepot();
  commit(d, "docs/note.md");
  const r = git(d.travail, ["push", "origin", "main"], { attendu: null });
  if (r.status !== 0) fail(`push rapide refusé à tort : ${r.stderr}`);
  if (sommetOrigin(d) !== git(d.travail, ["rev-parse", "HEAD"]).stdout.trim()) fail("push rapide : l'origine n'a pas avancé");
  if (verifierScript(d).status !== 0) fail("script sans stdin : sortie 0 attendue sur un arbre à jour");
  console.log("pre-push: push rapide sur main — autorisé");
}

// — push non rapide —
{
  const d = creerDepot();
  const autre = join(d.base, "autre");
  git(d.base, ["clone", d.origin, autre]);
  writeFileSync(join(autre, "autre.md"), "autre\n", "utf8");
  git(autre, ["add", "-A"]);
  git(autre, ["commit", "-q", "-m", "autre"]);
  git(autre, ["push", "--no-verify", "origin", "main"]);
  commit(d, "docs/local.md");
  // origin/main local est périmé : seul le sommet distant annoncé par git trahit la divergence
  refuse("push non rapide (forcé, origin/main périmé)", d, ["--force", "origin", "main"], "push non rapide");
  git(d.travail, ["fetch", "origin"]);
  refuse("push non rapide (forcé, origin/main récupéré)", d, ["--force", "origin", "main"], "push non rapide");
  refuse("push non rapide (+main)", d, ["origin", "+main"], "push non rapide");
}

// — chemin protégé : sortie 2, push refusé —
for (const fichier of ["CLAUDE.md", ".github/workflows/ci.yml", "scripts/pre-push-check.mjs", ".cursor/hooks/garde-commandes.mjs", ".claude/settings.json"]) {
  const d = creerDepot();
  commit(d, fichier);
  const r = verifierScript(d);
  if (r.status !== 2) fail(`${fichier} : sortie ${r.status}, 2 attendu (${r.stderr})`);
  if (!r.stderr.includes("revue du commandement requise")) fail(`${fichier} : message « revue du commandement requise » absent`);
  refuse(`chemin protégé ${fichier}`, d, ["origin", "main"], "revue du commandement requise");
}
{
  // un refus dur l'emporte sur la revue : sortie 1
  const d = creerDepot({ gouvernance: 1 });
  commit(d, "CLAUDE.md");
  const r = verifierScript(d);
  if (r.status !== 1) fail(`gouvernance en échec + chemin protégé : sortie ${r.status}, 1 attendu`);
}

// — tag —
{
  const d = creerDepot();
  git(d.travail, ["tag", "v1.0.0"]);
  refuse("tag", d, ["origin", "v1.0.0"], "tag");
  refuse("--tags", d, ["--tags"], "tag");
  if (git(d.origin, ["tag", "-l"]).stdout.trim() !== "") fail("un tag est arrivé à l'origine");
}

// — suppression de référence —
{
  const d = creerDepot();
  git(d.travail, ["push", "--no-verify", "origin", "main:autre"]);
  const avantAutre = sommetOrigin(d, "autre");
  refuse("--delete", d, ["origin", "--delete", "autre"], "suppression");
  refuse(":branche", d, ["origin", ":autre"], "suppression");
  refuse(":main", d, ["origin", ":main"], "suppression");
  if (sommetOrigin(d, "autre") !== avantAutre) fail("la branche autre a changé");
}

// — gouvernance en échec —
{
  const d = creerDepot({ gouvernance: 1 });
  commit(d, "docs/note.md");
  refuse("gouvernance en échec", d, ["origin", "main"], "plan-gouvernance.mjs sort 1");
}

// — branche autre que main —
{
  const d = creerDepot();
  git(d.travail, ["switch", "-c", "lot/x"]);
  commit(d, "docs/lot.md");
  refuse("branche autre que main", d, ["origin", "lot/x"], "seule main peut être poussée");
  refuse("HEAD:main depuis une autre branche", d, ["origin", "HEAD:main"], "seule main peut être poussée");
}

// — remote autre qu'origin —
{
  const d = creerDepot();
  const miroir = join(d.base, "miroir.git");
  git(d.base, ["init", "--bare", "-b", "main", miroir]);
  git(d.travail, ["remote", "add", "miroir", miroir]);
  commit(d, "docs/note.md");
  const r = git(d.travail, ["push", "miroir", "main"], { attendu: null });
  if (r.status === 0) fail("remote autre qu'origin : push accepté");
  if (!`${r.stderr}${r.stdout}`.includes("seul origin est autorisé")) fail("remote autre qu'origin : message absent");
  console.log("pre-push: remote autre qu'origin — refusé");
}

console.log("pre-push: OK");
