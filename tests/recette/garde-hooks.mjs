#!/usr/bin/env node
/**
 * Gardes Cursor et Claude Code (mêmes scripts, deux formats d'entrée et de réponse) : fail-closed si l'entrée
 * stdin est illisible ; refus des secrets / commandes dangereuses, y compris chaînées derrière un préfixe de la
 * liste d'autorisation ; worktrees sous `.worktrees/` ; garde du sous-agent executant ; câblage de
 * `.claude/settings.json`. Chaque garde a un essai négatif (réponse d'un garde qui ne reconnaît pas le format).
 * Couvre aussi `continuer.mjs` (relance, Cursor). Toute modification de `lib.mjs` repasse ce fichier (CI, job frontend).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ---------------------------------------------------------------------------------------------------------
// Format Claude Code : entrée { hook_event_name, tool_name, tool_input, cwd } ; refus par
// hookSpecificOutput.permissionDecision « deny » ; pas d'objection = réponse vide (la liste d'autorisation
// et le mode de permission décident ; un « allow » explicite les court-circuiterait).
// ---------------------------------------------------------------------------------------------------------
const cwdClaude = "C:\\Users\\exemple\\legalos2";
const claudeBash = (command, outil = "Bash") =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: outil, tool_input: { command }, cwd: cwdClaude });
const claudeRead = (file_path) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path }, cwd: cwdClaude });

/** Écart d'une réponse de refus au format Claude Code, ou `null`. */
function ecartRefusClaude(out, fragment) {
  const s = out?.hookSpecificOutput;
  if (!s) return `pas de hookSpecificOutput : ${JSON.stringify(out)}`;
  if (s.hookEventName !== "PreToolUse") return `hookEventName ${s.hookEventName}`;
  if (s.permissionDecision !== "deny") return `permissionDecision ${s.permissionDecision}`;
  if (fragment && !String(s.permissionDecisionReason || "").includes(fragment)) {
    return `permissionDecisionReason sans « ${fragment} » : ${s.permissionDecisionReason}`;
  }
  return null;
}

/** Écart d'une réponse « pas d'objection » au format Claude Code, ou `null`. */
function ecartAutorisationClaude(out) {
  return JSON.stringify(out) === "{}" ? null : `réponse vide attendue : ${JSON.stringify(out)}`;
}

function expectDenyClaude(script, stdin, fragment) {
  const ecart = ecartRefusClaude(run(script, stdin), fragment);
  if (ecart) fail(`${script} (Claude Code) devait refuser : ${ecart}`);
}

function expectAllowClaude(script, stdin) {
  const ecart = ecartAutorisationClaude(run(script, stdin));
  if (ecart) fail(`${script} (Claude Code) devait laisser passer : ${ecart}`);
}

expectDenyClaude("garde-commandes.mjs", claudeBash("git push --force origin main"), "forcé");
expectDenyClaude("garde-commandes.mjs", claudeBash("git push --force origin main", "PowerShell"), "forcé");
expectDenyClaude("garde-commandes.mjs", claudeBash("git push origin v1.2.0"), "tag");
expectDenyClaude("garde-commandes.mjs", claudeBash("git push origin --delete lot/x"), "suppression de branche");
expectDenyClaude("garde-commandes.mjs", claudeBash("git filter-repo --force"), "historique");
expectAllowClaude("garde-commandes.mjs", claudeBash("git status"));
expectAllowClaude("garde-commandes.mjs", claudeBash("git commit -m ok", "PowerShell"));
for (const prefixe of prefixes) {
  expectDenyClaude("garde-commandes.mjs", claudeBash(`${prefixe}; git push --force --dry-run origin main`), "forcé");
  expectDenyClaude("garde-commandes.mjs", claudeBash(`${prefixe} | git push origin main --force-with-lease`, "PowerShell"), "forcé");
  expectDenyClaude("garde-commandes.mjs", claudeBash(`${prefixe}; git push origin v1.2.0`), "tag");
}
expectDenyClaude("garde-commandes.mjs", claudeBash("git worktree add ../legal-os-mail -b lot/mail"), "worktree");
expectDenyClaude("garde-commandes.mjs", claudeBash("git worktree add -b lot/mail C:\\Users\\exemple\\ailleurs"), "worktree");
expectAllowClaude("garde-commandes.mjs", claudeBash("git worktree add .worktrees/mail -b lot/mail"));
expectAllowClaude("garde-commandes.mjs", claudeBash(`git worktree add ${cwdClaude}\\.worktrees\\mail -b lot/mail`));
// Entrée illisible : refus dans les deux formats à la fois, code de sortie 2.
for (const script of ["garde-commandes.mjs", "garde-secrets.mjs", "garde-executant.mjs"]) {
  for (const stdin of ["", "{", "[]"]) {
    const r = spawnSync(process.execPath, [join(hooks, script)], { input: stdin, encoding: "utf8" });
    let out;
    try {
      out = JSON.parse(String(r.stdout || "{}"));
    } catch {
      fail(`${script} entrée illisible : sortie non JSON (${r.stdout})`);
    }
    if (r.status !== 2) fail(`${script} entrée illisible : code ${r.status}, 2 attendu`);
    if (out.permission !== "deny") fail(`${script} entrée illisible : refus Cursor absent`);
    const ecart = ecartRefusClaude(out, "illisible");
    if (ecart) fail(`${script} entrée illisible : refus Claude Code absent (${ecart})`);
  }
}

expectDenyClaude("garde-secrets.mjs", claudeRead("C:\\Users\\exemple\\legalos2\\apps\\poste\\.env"), "secrets");
expectDenyClaude("garde-secrets.mjs", claudeRead("/home/exemple/cle.pem"), "secrets");
expectAllowClaude("garde-secrets.mjs", claudeRead("apps/poste/.env.example"));
expectAllowClaude("garde-secrets.mjs", claudeRead("C:\\Users\\exemple\\legalos2\\PLAN.md"));

// Garde du sous-agent executant : ni git push ni git commit (ni écriture d'historique).
for (const commande of [
  "git commit -m x",
  "git add . && git commit -m x",
  "git -C . commit -m x",
  "git -c user.name=a commit -m x",
  "git push origin main",
  "git.exe push origin main",
  "git reset --hard HEAD~1",
  "git rebase main",
  "git tag v1",
]) {
  expectDenyClaude("garde-executant.mjs", claudeBash(commande), "garde-executant");
  expectDenyClaude("garde-executant.mjs", claudeBash(commande, "PowerShell"), "garde-executant");
}
for (const commande of ["git status", "git diff --stat", "git log -3", "node tests/recette/regles-synchronisees.mjs", "cargo test -p legalos-api"]) {
  expectAllowClaude("garde-executant.mjs", claudeBash(commande));
}

// Après-commande (PostToolUse) : la marque est écrite dans CLAUDE_PROJECT_DIR.
{
  const dir = mkdtempSync(join(tmpdir(), "legalos-apres-"));
  try {
    const entree = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status" }, cwd: dir });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    delete env.CURSOR_PROJECT_DIR;
    const r = spawnSync(process.execPath, [join(hooks, "apres-commande.mjs")], { input: entree, encoding: "utf8", env });
    if (r.stdout.trim() !== "{}") fail(`apres-commande (Claude Code) : ${r.stdout}`);
    if (!existsSync(join(dir, ".mission", "derniere-commande"))) {
      fail("apres-commande (Claude Code) : marque absente de CLAUDE_PROJECT_DIR");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Essais négatifs : ce que répondrait un garde qui ne reconnaît pas le format Claude Code
// (il lit `command` à plat, ne trouve rien, autorise ; ou répond au format Cursor) doit être vu comme un écart.
const reponseAncienGarde = { permission: "allow" };
const reponseMauvaisFormat = { permission: "deny", user_message: "Commande bloquée : refus au format Cursor." };
const reponseAllowExplicite = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
for (const [garde, fragment] of [["garde-commandes", "forcé"], ["garde-secrets", "secrets"], ["garde-executant", "garde-executant"]]) {
  if (!ecartRefusClaude(reponseAncienGarde, fragment)) fail(`essai négatif ${garde} : un garde qui autorise passe pour un refus`);
  if (!ecartRefusClaude(reponseMauvaisFormat, fragment)) fail(`essai négatif ${garde} : une réponse au format Cursor passe pour un refus Claude Code`);
  if (!ecartRefusClaude(reponseAllowExplicite, fragment)) fail(`essai négatif ${garde} : un allow passe pour un refus`);
}
if (!ecartAutorisationClaude(reponseAncienGarde)) fail("essai négatif : une réponse Cursor passe pour « pas d'objection » Claude Code");
if (!ecartAutorisationClaude(reponseAllowExplicite)) fail("essai négatif : un allow explicite passe pour « pas d'objection »");
{
  // L'ancien garde (avant la bascule) lit `command` à plat : sur une entrée Claude Code il autorise tout.
  const ancien = join(tmpdir(), `legalos-garde-ancien-${process.pid}.mjs`);
  const libUrl = pathToFileURL(join(hooks, "lib.mjs")).href;
  writeFileSync(
    ancien,
    `import { lireEntree, repondre } from ${JSON.stringify(libUrl)};
const lu = await lireEntree();
const c = String(lu.valeur.command || "");
repondre(c.includes("--force") ? { permission: "deny", user_message: "refus" } : { permission: "allow" });
`,
    "utf8",
  );
  try {
    const r = spawnSync(process.execPath, [ancien], { input: claudeBash("git push --force origin main"), encoding: "utf8" });
    if (!ecartRefusClaude(JSON.parse(r.stdout), "forcé")) fail("essai négatif : l'ancien garde passe pour un refus Claude Code");
  } finally {
    rmSync(ancien, { force: true });
  }
}

// .claude/settings.json : liste d'autorisation reprise de .cursor/permissions.json, réglages de sécurité, hooks.
{
  let reglages;
  try {
    reglages = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  } catch (erreur) {
    fail(`.claude/settings.json illisible : ${erreur.message}`);
  }
  const verifierReglages = (r) => {
    const ecarts = [];
    const autorisations = r.permissions?.allow ?? [];
    const demandes = r.permissions?.ask ?? [];
    const reprise = (liste, prefixe) =>
      liste.some((regle) => {
        const m = /^(?:Bash|PowerShell)\((.*)\)$/.exec(regle);
        return m !== null && m[1].startsWith(prefixe);
      });
    for (const prefixe of prefixes) {
      // Un push n'est jamais autorisé d'avance sous Claude Code : il passe par « ask » (décision du commandement, 07/10).
      if (prefixe.startsWith("git push")) {
        if (!reprise(demandes, prefixe)) ecarts.push(`${prefixe} absent de permissions.ask`);
      } else if (/^(curl|Invoke-WebRequest)\b/.test(prefixe)) {
        // Non repris (décision du commandement, 07/10) : un motif « http://127.0.0.1* » accepterait aussi
        // « 127.0.0.1.exemple.com » ; le dépôt n'utilise pas ces appels. Aucune règle réseau locale n'est permise
        // tant qu'elle ne se termine pas par un port ou un chemin.
        continue;
      } else if (!reprise(autorisations, prefixe)) {
        ecarts.push(`préfixe de permissions.json non repris : ${prefixe}`);
      }
    }
    for (const regle of autorisations) {
      if (/127\.0\.0\.1\*|localhost\*/i.test(regle)) ecarts.push(`motif réseau ouvert (joker juste après l'hôte) : ${regle}`);
    }
    if (autorisations.some((regle) => /^(?:Bash|PowerShell)\(git push\b/.test(regle))) {
      ecarts.push("git push dans permissions.allow : à placer dans permissions.ask");
    }
    if (r.permissions?.blockReadsOutsideWorkingDirectories !== true) ecarts.push("blockReadsOutsideWorkingDirectories absent");
    if (r.permissions?.disableBypassPermissionsMode !== "disable") ecarts.push("disableBypassPermissionsMode absent");
    const attendus = [
      ["PreToolUse", "Bash|PowerShell", "garde-commandes.mjs"],
      ["PreToolUse", "Read", "garde-secrets.mjs"],
      ["PostToolUse", "Bash|PowerShell", "apres-commande.mjs"],
    ];
    for (const [evenement, matcher, script] of attendus) {
      const branche = (r.hooks?.[evenement] ?? []).some(
        (e) => e.matcher === matcher && (e.hooks ?? []).some((h) => h.type === "command" && String(h.command).includes(`.cursor/hooks/${script}`)),
      );
      if (!branche) ecarts.push(`hook ${evenement} ${matcher} → ${script} absent`);
    }
    for (const evenement of Object.keys(r.hooks ?? {})) {
      if (/^(Stop|SubagentStop)$/i.test(evenement)) ecarts.push(`hook ${evenement} interdit`);
    }
    return ecarts;
  };
  const ecarts = verifierReglages(reglages);
  if (ecarts.length > 0) fail(`.claude/settings.json : ${ecarts.join(" ; ")}`);
  // Essais négatifs : un réglage affaibli est vu.
  const sansBloc = structuredClone(reglages);
  delete sansBloc.permissions.blockReadsOutsideWorkingDirectories;
  const avecStop = structuredClone(reglages);
  avecStop.hooks.Stop = [{ hooks: [{ type: "command", command: "node .cursor/hooks/continuer.mjs" }] }];
  const sansSecrets = structuredClone(reglages);
  sansSecrets.hooks.PreToolUse = sansSecrets.hooks.PreToolUse.filter((e) => e.matcher !== "Read");
  const pushAutorise = structuredClone(reglages);
  pushAutorise.permissions.allow.push("Bash(git push origin *)");
  const curlOuvert = structuredClone(reglages);
  curlOuvert.permissions.allow.push("Bash(curl -s http://127.0.0.1*)");
  const pushSansDemande = structuredClone(reglages);
  pushSansDemande.permissions.ask = [];
  const sansAutorisation = structuredClone(reglages);
  sansAutorisation.permissions.allow = sansAutorisation.permissions.allow.filter((a) => !a.includes("cargo"));
  for (const [libelle, variante] of [
    ["blockReads retiré", sansBloc],
    ["hook Stop ajouté", avecStop],
    ["garde-secrets retiré", sansSecrets],
    ["autorisation cargo retirée", sansAutorisation],
    ["git push dans allow", pushAutorise],
    ["git push sans ask", pushSansDemande],
    ["curl local à joker ouvert", curlOuvert],
  ]) {
    if (verifierReglages(variante).length === 0) fail(`essai négatif settings.json muet : ${libelle}`);
  }
}

// Sous-agent executant : le garde est branché dans son en-tête.
{
  const executant = readFileSync(join(root, ".claude/agents/executant.md"), "utf8");
  if (!executant.includes(".cursor/hooks/garde-executant.mjs")) fail("executant.md : garde-executant non branché");
  if (!/^model:\s*haiku\s*$/m.test(executant)) fail("executant.md : model haiku absent");
  const controleur = readFileSync(join(root, ".claude/agents/controleur.md"), "utf8");
  if (!/^model:\s*sonnet\s*$/m.test(controleur) || !/^effort:\s*high\s*$/m.test(controleur)) {
    fail("controleur.md : model sonnet et effort high attendus");
  }
  const explore = readFileSync(join(root, ".claude/agents/Explore.md"), "utf8");
  if (!/^model:\s*haiku\s*$/m.test(explore) || !/^tools:\s*Read, Grep, Glob\s*$/m.test(explore)) {
    fail("Explore.md : model haiku et lecture seule attendus");
  }
}

// Relance : exécution réelle de continuer.mjs, dépôt temporaire via CURSOR_PROJECT_DIR.
function depotTemporaire(plan, avecStop) {
  const dir = mkdtempSync(join(tmpdir(), "legalos-continuer-"));
  writeFileSync(join(dir, "PLAN.md"), plan, "utf8");
  if (avecStop) {
    mkdirSync(join(dir, ".mission"));
    writeFileSync(join(dir, ".mission", "STOP"), "", "utf8");
  }
  return dir;
}

function runContinuer(script, stdin, projectDir) {
  const r = spawnSync(process.execPath, [script], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: projectDir },
  });
  if (r.error) fail(`continuer : ${r.error.message}`);
  let json;
  try {
    json = JSON.parse(String(r.stdout || "").trim() || "{}");
  } catch {
    fail(`continuer : sortie non JSON (${r.stdout})`);
  }
  return { json, stderr: String(r.stderr || "") };
}

function assertRelance(libelle, stdin, plan, avecStop, attendu) {
  const dir = depotTemporaire(plan, avecStop);
  try {
    const { json, stderr } = runContinuer(join(hooks, "continuer.mjs"), stdin, dir);
    if (attendu === "reprise") {
      if (!String(json.followup_message || "").includes("premier jalon non coché")) {
        fail(`${libelle} : relance de reprise absente (${JSON.stringify(json)})`);
      }
    } else if (attendu === "cloture") {
      if (!String(json.followup_message || "").includes("Tous les jalons sont cochés")) {
        fail(`${libelle} : relance de clôture absente (${JSON.stringify(json)})`);
      }
    } else if (JSON.stringify(json) !== "{}") {
      fail(`${libelle} : {} attendu, reçu ${JSON.stringify(json)}`);
    }
    return stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const planOuvert = "- [ ] **Vue scindée**\n";
const planFerme = "- [x] **Vue scindée** — fait\n";
const entreeCompleted = JSON.stringify({ status: "completed" });

assertRelance("completed + jalon ouvert", entreeCompleted, planOuvert, false, "reprise");
assertRelance("completed + jalons cochés", entreeCompleted, planFerme, false, "cloture");
assertRelance("aborted", JSON.stringify({ status: "aborted" }), planOuvert, false, "silence");
assertRelance("completed + STOP", entreeCompleted, planOuvert, true, "silence");
{
  const dir = depotTemporaire(planOuvert, false);
  try {
    const { json, stderr } = runContinuer(join(hooks, "continuer.mjs"), "{", dir);
    if (JSON.stringify(json) !== "{}") fail(`entrée illisible : {} attendu, reçu ${JSON.stringify(json)}`);
    if (!stderr.includes("hook continuer") || !stderr.includes("pas de relance")) {
      fail(`entrée illisible : stderr sans message de relance (${stderr})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Essai négatif : l'ancien code lit status sur { ok, valeur } et ne relance jamais.
const ancien = join(tmpdir(), `legalos-continuer-ancien-${process.pid}.mjs`);
const libUrl = pathToFileURL(join(hooks, "lib.mjs")).href;
writeFileSync(
  ancien,
  `import { lireEntree, repondre } from ${JSON.stringify(libUrl)};
const entree = await lireEntree();
if (String(entree.status ?? "").trim() !== "completed") repondre({});
repondre({ followup_message: "ancien code a relancé" });
`,
  "utf8",
);
try {
  const dir = depotTemporaire(planOuvert, false);
  try {
    const { json } = runContinuer(ancien, entreeCompleted, dir);
    if (json.followup_message) {
      fail("essai négatif muet : l'ancien code a relancé");
    }
    if (JSON.stringify(json) !== "{}") {
      fail(`essai négatif : {} attendu de l'ancien code, reçu ${JSON.stringify(json)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  rmSync(ancien, { force: true });
}

// La règle de relance (Cursor) vit dans 01-cursor.mdc depuis la bascule vers Claude Code ; l'état et l'attente
// d'une CI restent dans les règles communes.
const extraitsCi = {
  "docs/ordre-operation.md": ["gh run view", "gh run watch", "relances consécutives sans commande exécutée ni commit"],
  ".cursor/rules/00-mission.mdc": ["gh run view", "gh run watch"],
  ".cursor/rules/50-infra-ci.mdc": ["gh run view", "gh run watch"],
  ".cursor/rules/01-cursor.mdc": ["gh run watch", "relances consécutives sans commande exécutée ni commit"],
  ".claude/rules/00-mission.md": ["gh run view", "gh run watch"],
  ".claude/rules/50-infra-ci.md": ["gh run view", "gh run watch"],
};
for (const [fichier, extraits] of Object.entries(extraitsCi)) {
  const texte = readFileSync(join(root, fichier), "utf8");
  for (const extrait of extraits) {
    if (!texte.includes(extrait)) fail(`${fichier} : extrait absent « ${extrait} »`);
  }
}

function etatRelances(dir) {
  return JSON.parse(readFileSync(join(dir, ".mission", "relances.json"), "utf8"));
}

{
  const dir = depotTemporaire(planOuvert, false);
  try {
    const une = runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    if (!String(une.json.followup_message || "").includes("premier jalon non coché")) {
      fail(`première relance vide : suivi absent (${JSON.stringify(une.json)})`);
    }
    if (etatRelances(dir).sans_travail !== 1) {
      fail(`première relance vide : compteur ${etatRelances(dir).sans_travail}`);
    }
    if (existsSync(join(dir, ".mission", "STOP"))) fail("première relance vide : STOP trop tôt");

    const { json: marque } = runContinuer(join(hooks, "apres-commande.mjs"), "{}", dir);
    if (JSON.stringify(marque) !== "{}") fail(`apres-commande : ${JSON.stringify(marque)}`);
    const apresCmd = runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    if (!String(apresCmd.json.followup_message || "").includes("premier jalon non coché")) {
      fail(`commande exécutée : suivi absent (${JSON.stringify(apresCmd.json)})`);
    }
    if (etatRelances(dir).sans_travail !== 0) {
      fail(`commande exécutée : compteur ${etatRelances(dir).sans_travail}`);
    }

    runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    const deux = runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    if (JSON.stringify(deux.json) !== "{}") {
      fail(`deuxième relance vide : {} attendu, reçu ${JSON.stringify(deux.json)}`);
    }
    if (!existsSync(join(dir, ".mission", "STOP"))) fail("deuxième relance vide : STOP absent");
    const journal = readFileSync(join(dir, "JOURNAL.md"), "utf8");
    if (!journal.includes("deux relances consécutives sans commande exécutée ni commit")) {
      fail("deuxième relance vide : incident absent du journal");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = depotTemporaire(planOuvert, false);
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: gitEnv });
    if (r.status !== 0) fail(`git ${args.join(" ")} : ${r.stderr || r.stdout}`);
  };
  try {
    git(["init", "-b", "main"]);
    git(["add", "PLAN.md"]);
    git(["commit", "-m", "plan initial"]);
    runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    if (etatRelances(dir).sans_travail !== 1) fail("avant commit : le compteur doit rester à 1");
    writeFileSync(join(dir, "PLAN.md"), `${planOuvert}\n`, "utf8");
    git(["add", "PLAN.md"]);
    git(["commit", "-m", "plan suite"]);
    const apres = runContinuer(join(hooks, "continuer.mjs"), entreeCompleted, dir);
    if (!String(apres.json.followup_message || "").includes("premier jalon non coché")) {
      fail(`commit : suivi absent (${JSON.stringify(apres.json)})`);
    }
    if (etatRelances(dir).sans_travail !== 0) fail(`commit : compteur ${etatRelances(dir).sans_travail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("garde-hooks: OK");
