#!/usr/bin/env node
/**
 * io-imap et imap-codec restent aux versions figées par l'architecte.
 * Aucun type de ces crates ne sort de crates/messagerie/src/imap.rs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`messagerie-figee: FAIL — ${msg}`);
  process.exit(1);
}

const manifeste = readFileSync(join(root, "crates/messagerie/Cargo.toml"), "utf8");
if (!manifeste.includes('io-imap = "=0.6.1"')) fail("io-imap doit être épinglé à =0.6.1");
if (!manifeste.includes('imap-codec = "=2.0.0-alpha.8"')) {
  fail("imap-codec doit être épinglé à =2.0.0-alpha.8");
}
if (manifeste.includes("async-imap")) fail("async-imap est interdit");

const verrou = readFileSync(join(root, "Cargo.lock"), "utf8");
if (!verrou.includes('name = "io-imap"\nversion = "0.6.1"')) fail("Cargo.lock : io-imap 0.6.1");
if (!verrou.includes('name = "imap-codec"\nversion = "2.0.0-alpha.8"')) {
  fail("Cargo.lock : imap-codec 2.0.0-alpha.8");
}
if (verrou.includes('name = "async-imap"')) fail("Cargo.lock contient async-imap");

const src = join(root, "crates/messagerie/src");
for (const nom of readdirSync(src)) {
  if (!nom.endsWith(".rs") || nom === "imap.rs") continue;
  const texte = readFileSync(join(src, nom), "utf8");
  if (texte.includes("use io_imap") || texte.includes("use imap_codec")) {
    fail(`${nom} importe io-imap ou imap-codec`);
  }
}

console.log("messagerie-figee: OK");
