#!/usr/bin/env node
/**
 * Politique de push autonome (décision de l'architecte du 10/10/2026), appelée par `.githooks/pre-push`.
 *
 * Sortie 0 : le push est autorisé. Sortie 1 : refus. Sortie 2 : « revue du commandement requise »
 * (le push touche le jeu protégé : le commandement relit puis pousse lui-même).
 *
 * Refus (sortie 1) :
 * - la branche courante n'est pas `main`, ou une référence poussée n'est pas `refs/heads/main` ;
 * - un tag ou une suppression de référence est poussé ;
 * - `origin/main` (et le sommet distant annoncé par git) n'est pas un ancêtre de ce qui est poussé : aucun push non rapide ;
 * - `tests/recette/plan-gouvernance.mjs` ne sort pas 0 sur `origin/main..<poussé>` ;
 * - le remote n'est pas `origin`.
 * Sortie 2 : `git diff --name-only origin/main..<poussé>` touche un chemin de CHEMINS_PROTEGES.
 *
 * Activation (config locale, non versionnée) : `git config core.hooksPath .githooks`.
 * Le hook reçoit sur stdin une ligne par référence : « <ref locale> <sha local> <ref distante> <sha distant> ».
 * Sans stdin (appel à la main dans un terminal), le script vérifie HEAD contre origin/main.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Chemins dont la modification demande la revue du commandement (un nom finissant par « / » désigne un dossier). */
export const CHEMINS_PROTEGES = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".cursor/hooks/",
  ".cursor/permissions.json",
  "CLAUDE.md",
  ".github/",
  "scripts/pre-push-check.mjs",
  "tests/recette/plan-gouvernance.mjs",
  "tests/recette/garde-hooks.mjs",
  "tests/recette/regles-synchronisees.mjs",
  "tests/recette/pre-push.mjs",
  // Ajouts de l'implémentation : sans eux, le hook et son câblage pourraient être désarmés sans revue.
  ".githooks/",
  ".cursor/hooks.json",
];

const ZEROS = /^0+$/;

export function estProtege(chemin) {
  const net = String(chemin).replace(/\\/g, "/").replace(/^\.\//, "");
  return CHEMINS_PROTEGES.some((p) => (p.endsWith("/") ? net.startsWith(p) : net === p));
}

/** Lignes du hook pre-push : « <ref locale> <sha local> <ref distante> <sha distant> ». */
export function lireRefs(texte) {
  return String(texte)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [refLocale = "", shaLocale = "", refDistante = "", shaDistant = ""] = l.split(/\s+/);
      return { refLocale, shaLocale, refDistante, shaDistant };
    });
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function main() {
  const top = git(["rev-parse", "--show-toplevel"], process.cwd());
  if (top.status !== 0) {
    console.error("pre-push-check : hors d'un dépôt git.");
    return 1;
  }
  const racine = top.stdout.trim();
  const refus = [];

  const remote = process.argv[2];
  if (remote !== undefined && remote !== "origin") refus.push(`remote « ${remote} » : seul origin est autorisé`);

  const branche = git(["symbolic-ref", "--short", "-q", "HEAD"], racine).stdout.trim();
  if (branche !== "main") refus.push(`branche courante « ${branche || "HEAD détachée"} » : seule main peut être poussée`);

  let refs = [];
  if (!process.stdin.isTTY) {
    try {
      refs = lireRefs(readFileSync(0, "utf8"));
    } catch {
      refs = [];
    }
  }

  let sommet = "HEAD";
  for (const r of refs) {
    const supprime = r.refLocale === "(delete)" || ZEROS.test(r.shaLocale);
    if (supprime) refus.push(`suppression de la référence ${r.refDistante} refusée`);
    if (r.refLocale.startsWith("refs/tags/") || r.refDistante.startsWith("refs/tags/")) {
      refus.push(`push de tag refusé (${r.refDistante})`);
    }
    if (r.refDistante !== "refs/heads/main") refus.push(`référence distante ${r.refDistante} : seule refs/heads/main est autorisée`);
    if (!supprime && r.refLocale !== "refs/heads/main") refus.push(`référence locale ${r.refLocale} : seule refs/heads/main est autorisée`);
    if (!supprime && r.refDistante === "refs/heads/main" && !ZEROS.test(r.shaLocale)) sommet = r.shaLocale;
    if (!supprime && r.refDistante === "refs/heads/main" && r.shaDistant && !ZEROS.test(r.shaDistant)) {
      const a = git(["merge-base", "--is-ancestor", r.shaDistant, r.shaLocale], racine);
      if (a.status !== 0) refus.push(`push non rapide : le sommet distant ${r.shaDistant.slice(0, 7)} n'est pas un ancêtre de ${r.shaLocale.slice(0, 7)}`);
    }
  }

  const origine = git(["rev-parse", "--verify", "--quiet", "origin/main"], racine);
  let fichiers = [];
  if (origine.status !== 0) {
    refus.push("origin/main introuvable (git fetch origin)");
  } else {
    const ancetre = git(["merge-base", "--is-ancestor", "origin/main", sommet], racine);
    if (ancetre.status !== 0) refus.push(`push non rapide : origin/main n'est pas un ancêtre de ${sommet === "HEAD" ? "HEAD" : sommet.slice(0, 7)}`);
    const gov = spawnSync(process.execPath, [join(racine, "tests/recette/plan-gouvernance.mjs")], {
      cwd: racine,
      encoding: "utf8",
      env: { ...process.env, PLAN_RANGE: `origin/main..${sommet}` },
    });
    if (gov.status !== 0) {
      const fin = `${gov.stdout}${gov.stderr}`.trim().split(/\r?\n/).slice(-6).join(" | ");
      refus.push(`plan-gouvernance.mjs sort ${gov.status} : ${fin}`);
    }
    const diff = git(["diff", "--name-only", `origin/main..${sommet}`], racine);
    fichiers = diff.status === 0 ? diff.stdout.split(/\r?\n/).filter(Boolean) : [];
    if (diff.status !== 0) refus.push(`git diff origin/main..${sommet} impossible : ${diff.stderr.trim()}`);
  }

  if (refus.length > 0) {
    console.error("pre-push-check : push REFUSÉ");
    for (const r of refus) console.error(`  - ${r}`);
    return 1;
  }
  const proteges = fichiers.filter(estProtege);
  if (proteges.length > 0) {
    console.error("pre-push-check : revue du commandement requise (sortie 2), le push touche le jeu protégé :");
    for (const f of proteges) console.error(`  - ${f}`);
    return 2;
  }
  console.error("pre-push-check : OK");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
