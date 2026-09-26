#!/usr/bin/env node
/**
 * Gardes Cursor : fail-closed si l'entrée stdin est illisible ; refus des secrets / commandes dangereuses.
 */
import { spawnSync } from "node:child_process";
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

expectDeny("garde-commandes.mjs", "", "illisible");
expectDeny("garde-commandes.mjs", "{", "illisible");
expectDeny("garde-commandes.mjs", JSON.stringify({ command: "git push --force origin main" }), "forcé");
expectAllow("garde-commandes.mjs", JSON.stringify({ command: "git status" }));

expectDeny("garde-secrets.mjs", "", "illisible");
expectDeny("garde-secrets.mjs", "not-json", "illisible");
expectDeny("garde-secrets.mjs", JSON.stringify({ file_path: "apps/poste/.env" }), "secrets");
expectAllow("garde-secrets.mjs", JSON.stringify({ file_path: "apps/poste/.env.example" }));
expectAllow("garde-secrets.mjs", JSON.stringify({ file_path: "PLAN.md" }));

console.log("garde-hooks: OK");
