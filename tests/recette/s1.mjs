#!/usr/bin/env node
/**
 * Recette S1 — instance complète healthy + probes HTTP hôte.
 * Prérequis : `.env` à la racine, Docker Desktop actif.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`s1: FAIL — ${cmd} ${args.join(" ")} (exit ${r.status ?? 1})`);
    process.exit(r.status ?? 1);
  }
}

run("cargo", ["run", "-p", "xtask", "--", "recette", "--scenario", "s1"]);

const instanceDir = join(root, "instance");
const expectedServices = [
  "caddy",
  "api",
  "postgres",
  "powersync",
  "garage",
  "greenmail",
  "simulateur-pa",
];

const ps = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    "docker-compose.yml",
    "--env-file",
    "../.env",
    "ps",
    "--format",
    "json",
  ],
  { cwd: instanceDir, encoding: "utf8", shell: process.platform === "win32" },
);
if (ps.status !== 0) {
  console.error("s1: FAIL — docker compose ps");
  process.exit(ps.status ?? 1);
}
const seen = new Set();
for (const line of ps.stdout.trim().split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line);
  const name = row.Service ?? row.Name;
  if (name) seen.add(name);
  const health = row.Health ?? row.Status ?? "";
  if (expectedServices.includes(name) && !String(health).toLowerCase().includes("healthy")) {
    console.error(`s1: FAIL — service ${name} not healthy (${health})`);
    process.exit(1);
  }
}
for (const svc of expectedServices) {
  if (!seen.has(svc)) {
    console.error(`s1: FAIL — service manquant dans compose ps: ${svc}`);
    process.exit(1);
  }
}

const caddyPort = process.env.CADDY_HTTP_PORT ?? "8088";
const apiPort = process.env.API_HOST_PORT ?? "8080";
for (const url of [
  `http://127.0.0.1:${apiPort}/health`,
  `http://127.0.0.1:${caddyPort}/health`,
  `http://127.0.0.1:${caddyPort}/`,
]) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) {
    console.error(`s1: FAIL HTTP ${r.status} ${url}`);
    process.exit(1);
  }
}

console.log("s1: OK");
