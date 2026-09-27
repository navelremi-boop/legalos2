#!/usr/bin/env node
/**
 * Vérifie que chaque glob des règles Cursor (.cursor/rules/*.mdc) correspond
 * à au moins un fichier, sauf 30-messagerie (crate à venir).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const rulesDir = join(root, ".cursor/rules");
const ALLOW_EMPTY = new Set();

function fail(msg) {
  console.error(`cursor-rules-globs: FAIL — ${msg}`);
  process.exit(1);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "target" || name === ".git" || name === "dist") continue;
      walk(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

/** Glob minimal : * et ** (segments). */
function globToRegExp(glob) {
  let s = glob.replace(/\\/g, "/");
  s = s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  s = s.replace(/\*\*/g, "§§");
  s = s.replace(/\*/g, "[^/]*");
  s = s.replace(/§§\//g, "(?:.*/)?");
  s = s.replace(/\/§§/g, "(?:/.*)?");
  s = s.replace(/§§/g, ".*");
  return new RegExp(`^${s}$`);
}

function matchesGlob(relPath, glob) {
  const path = relPath.replace(/\\/g, "/");
  let g = glob.replace(/\\/g, "/");
  // `foo/**` (sans autre **) → tous les fichiers sous foo/
  if (g.endsWith("/**") && !g.slice(0, -3).includes("*")) {
    const prefix = g.slice(0, -3);
    return path === prefix || path.startsWith(prefix + "/");
  }
  if (!g.includes("*")) {
    const abs = join(root, g);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      return path === g || path.startsWith(g.endsWith("/") ? g : g + "/");
    }
    return path === g;
  }
  return globToRegExp(g).test(path);
}

const allFiles = walk(root).map((p) => relative(root, p).replace(/\\/g, "/"));
const rules = readdirSync(rulesDir).filter((n) => n.endsWith(".mdc"));

for (const rule of rules) {
  const text = readFileSync(join(rulesDir, rule), "utf8");
  const m = /^globs:\s*(.+)$/m.exec(text);
  if (!m) continue;
  const globs = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  if (globs.length === 0) continue;
  if (ALLOW_EMPTY.has(rule)) {
    console.log(`cursor-rules-globs: ${rule} — exempt (crate à venir)`);
    continue;
  }
  for (const g of globs) {
    const hit = allFiles.some((f) => matchesGlob(f, g));
    if (!hit) fail(`${rule} : glob « ${g} » ne correspond à aucun fichier`);
  }
  console.log(`cursor-rules-globs: ${rule} OK (${globs.length} glob(s))`);
}

console.log("cursor-rules-globs: OK");
