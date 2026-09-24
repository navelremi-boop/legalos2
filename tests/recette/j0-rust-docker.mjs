#!/usr/bin/env node
/**
 * Acceptation J0 — Rust fmt, clippy, tests, check-contracts (Linux container).
 * Contournement WDAC 4551 / linker Windows ; même barre que PLAN.md J0 et CI job `rust`.
 * Usage : node tests/recette/j0-rust-docker.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const inner =
  "export PATH=/usr/local/cargo/bin:$PATH && " +
  "apt-get update -qq && apt-get install -y -qq libpq-dev pkg-config >/dev/null && " +
  "cargo fmt --all -- --check && " +
  "cargo clippy --workspace --all-targets -- -D warnings && " +
  "cargo test --workspace && " +
  "cargo run -p xtask -- check-contracts";

const r = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--entrypoint",
    "bash",
    "-v",
    `${root}:/work`,
    "-w",
    "/work",
    "rust:1.85.0-bookworm",
    "-c",
    inner,
  ],
  { cwd: root, stdio: "inherit" },
);

if (r.status !== 0) {
  console.error(`j0-rust-docker: FAIL (exit ${r.status ?? 1})`);
  process.exit(r.status ?? 1);
}

console.log("j0-rust-docker: OK");
