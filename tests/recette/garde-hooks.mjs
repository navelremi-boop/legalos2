#!/usr/bin/env node
/**
 * Gardes Cursor : fail-closed si l'entrée stdin est illisible ; refus des secrets / commandes dangereuses,
 * y compris chaînées derrière un préfixe de la liste d'autorisation ; worktrees sous `.worktrees/`.
 * Couvre aussi `continuer.mjs` (relance). Toute modification de `lib.mjs` repasse ce fichier (CI, job frontend).
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

for (const fichier of ["docs/ordre-operation.md", ".cursor/rules/00-mission.mdc", ".cursor/rules/50-infra-ci.mdc"]) {
  const texte = readFileSync(join(root, fichier), "utf8");
  for (const extrait of ["gh run view", "gh run watch", "relances consécutives sans commande exécutée ni commit"]) {
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
