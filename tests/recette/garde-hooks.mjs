#!/usr/bin/env node
/**
 * Gardes Cursor : fail-closed si l'entrée stdin est illisible ; refus des secrets / commandes dangereuses,
 * y compris chaînées derrière un préfixe de la liste d'autorisation ; worktrees sous `.worktrees/`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const hooks = join(root, ".cursor/hooks");

function fail(msg) {
  console.error(`garde-hooks: FAIL — ${msg}`);
  process.exit(1);
}

function run(script, stdin) {
  const r = spawnSync(process.execPath, [join(hooks, script)], {
    input: stdin,
    encoding: "utf8",
  });
  if (r.error) fail(`${script} : ${r.error.message}`);
  let json;
  try {
    json = JSON.parse(String(r.stdout || "").trim());
  } catch {
    fail(`${script} : sortie non JSON (${r.stdout})`);
  }
  return json;
}

function expectDeny(script, stdin, fragment) {
  const out = run(script, stdin);
  if (out.permission !== "deny") fail(`${script} devait refuser, a répondu ${JSON.stringify(out)}`);
  if (fragment && !String(out.user_message || "").includes(fragment)) {
    fail(`${script} message sans « ${fragment} » : ${out.user_message}`);
  }
}

function expectAllow(script, stdin) {
  const out = run(script, stdin);
  if (out.permission !== "allow") fail(`${script} devait autoriser : ${JSON.stringify(out)}`);
}

/** Préfixes de `terminalAllowlist` (JSON avec commentaires `//`, hors chaînes). */
function lireAutorisations() {
  let texte;
  try {
    texte = readFileSync(join(root, ".cursor/permissions.json"), "utf8");
  } catch {
    fail(".cursor/permissions.json introuvable");
  }
  let sansCommentaires = "";
  let dansChaine = false;
  for (let i = 0; i < texte.length; i += 1) {
    const car = texte[i];
    if (dansChaine) {
      sansCommentaires += car;
      if (car === "\\") {
        sansCommentaires += texte[i + 1] ?? "";
        i += 1;
      } else if (car === '"') {
        dansChaine = false;
      }
    } else if (car === '"') {
      dansChaine = true;
      sansCommentaires += car;
    } else if (car === "/" && texte[i + 1] === "/") {
      while (i < texte.length && texte[i] !== "\n") i += 1;
      sansCommentaires += "\n";
    } else {
      sansCommentaires += car;
    }
  }
  try {
    const liste = JSON.parse(sansCommentaires).terminalAllowlist;
    return Array.isArray(liste) ? liste.map(String) : [];
  } catch (erreur) {
    fail(`.cursor/permissions.json illisible : ${erreur.message}`);
  }
}

expectDeny("garde-commandes.mjs", "", "illisible");
expectDeny("garde-commandes.mjs", "{", "illisible");
expectDeny("garde-commandes.mjs", JSON.stringify({ command: "git push --force origin main" }), "forcé");
expectAllow("garde-commandes.mjs", JSON.stringify({ command: "git status" }));

// La liste d'autorisation de .cursor/permissions.json fonctionne par préfixe : une commande chaînée
// qui commence par un préfixe autorisé doit rester refusée par le hook.
const prefixes = lireAutorisations();
if (prefixes.length === 0) fail(".cursor/permissions.json : terminalAllowlist vide ou absente");
for (const prefixe of prefixes) {
  for (const chaine of [
    `${prefixe}; git push --force --dry-run origin main`,
    `${prefixe} && git push -f origin main`,
    `${prefixe} | git push origin main --force-with-lease`,
  ]) {
    expectDeny("garde-commandes.mjs", JSON.stringify({ command: chaine }), "forcé");
  }
  expectDeny(
    "garde-commandes.mjs",
    JSON.stringify({ command: `${prefixe}; git push origin v1.2.0` }),
    "tag",
  );
}

// Worktrees des sous-agents : dans .worktrees/ à la racine du dépôt (ordre d'opération § 4.3).
const racine = "C:\\Users\\exemple\\legalos2";
expectDeny("garde-commandes.mjs", JSON.stringify({ command: "git worktree add ../legal-os-mail -b lot/mail" }), "worktree");
expectDeny(
  "garde-commandes.mjs",
  JSON.stringify({ command: "git status; git worktree add -b lot/mail C:\\Users\\exemple\\ailleurs", workspace_roots: [racine] }),
  "worktree",
);
expectDeny("garde-commandes.mjs", JSON.stringify({ command: "git worktree add" }), "worktree");
expectAllow("garde-commandes.mjs", JSON.stringify({ command: "git worktree add .worktrees/mail -b lot/mail" }));
expectAllow("garde-commandes.mjs", JSON.stringify({ command: "git worktree add -b lot/mail .worktrees\\mail" }));
expectAllow(
  "garde-commandes.mjs",
  JSON.stringify({ command: `git worktree add ${racine}\\.worktrees\\mail -b lot/mail`, workspace_roots: ["/c:/Users/exemple/legalos2"] }),
);
expectAllow("garde-commandes.mjs", JSON.stringify({ command: "git worktree list; git worktree remove .worktrees/mail" }));

expectDeny("garde-secrets.mjs", "", "illisible");
expectDeny("garde-secrets.mjs", "not-json", "illisible");
expectDeny("garde-secrets.mjs", JSON.stringify({ file_path: "apps/poste/.env" }), "secrets");
expectAllow("garde-secrets.mjs", JSON.stringify({ file_path: "apps/poste/.env.example" }));
expectAllow("garde-secrets.mjs", JSON.stringify({ file_path: "PLAN.md" }));

console.log("garde-hooks: OK");
