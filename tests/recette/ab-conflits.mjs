#!/usr/bin/env node
/**
 * Banc A/B de la Montée PowerSync : mesure si l'instabilité de conflits-poste-tauri.mjs
 * vient de la montée (58b2f98).
 *
 * Alterne, en série, l'arbre « base » (worktree .worktrees/ab-base, commit 9374345, juste avant
 * la montée, avec les recettes de HEAD) et l'arbre « nouveau » (le dépôt, HEAD) : base, nouveau,
 * base, nouveau… Chaque arbre compile dans son propre CARGO_TARGET_DIR. Même Docker, même port 1420 :
 * l'instance (API, PowerSync, Postgres) est donc commune aux deux arbres, seul le poste diffère.
 *
 * Usage : node tests/recette/ab-conflits.mjs [--passes 8] [--recette conflits-poste-tauri.mjs]
 *                                            [--sortie docs/journal/ab-powersync.md]
 *                                            [--arbres base,nouveau] [--env CLE=VALEUR] [--titre "…"]
 * Mesure du préchauffage de Vite (dette conflits-poste-tauri) : un seul arbre, une variable
 * d'environnement : --arbres nouveau --env LEGALOS_VITE_PRECHAUFFE=1 --passes 20
 *                   --sortie docs/journal/prechauffe-vite.md
 * Le fichier de sortie est réécrit après chaque passe : un arrêt garde les passes déjà mesurées.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function option(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const passes = Number(option("passes", "8"));
const recette = option("recette", "conflits-poste-tauri.mjs");
const sortie = join(root, option("sortie", "docs/journal/ab-powersync.md"));
const delaiMaxMs = 25 * 60_000;
const titre = option("titre", "Banc A/B de la Montée PowerSync");
const arbresVoulus = option("arbres", "base,nouveau").split(",");
/** `--env CLE=VALEUR` (répétable) : variables ajoutées à l'environnement des passes. */
const envSupplementaire = {};
process.argv.forEach((arg, i) => {
  const suivant = process.argv[i + 1];
  if (arg === "--env" && suivant?.includes("=")) {
    const egal = suivant.indexOf("=");
    envSupplementaire[suivant.slice(0, egal)] = suivant.slice(egal + 1);
  }
});

const TOUS_LES_ARBRES = [
  { nom: "base", dir: join(root, ".worktrees/ab-base"), cargo: join(root, ".worktrees/ab-base/target") },
  { nom: "nouveau", dir: root, cargo: join(root, "target") },
];
const ARBRES = TOUS_LES_ARBRES.filter((a) => arbresVoulus.includes(a.nom));

function fail(msg) {
  console.error(`ab-conflits: FAIL — ${msg}`);
  process.exit(1);
}

function git(dir, ...args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout.trim();
}

for (const arbre of ARBRES) {
  if (!existsSync(join(arbre.dir, "tests/recette", recette))) {
    fail(`${arbre.nom} : tests/recette/${recette} absent dans ${arbre.dir}`);
  }
  arbre.commit = git(arbre.dir, "rev-parse", "--short", "HEAD");
}

const logs = mkdtempSync(join(tmpdir(), "ab-conflits-"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ecoutes() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(Get-NetTCPConnection -State Listen -LocalPort 1420,9252,9253,9254 -ErrorAction SilentlyContinue | Measure-Object).Count",
    ],
    { encoding: "utf8" },
  );
  return Number(r.stdout.trim() || "0");
}

/** Une passe commence sur un poste propre : aucun port de recette en écoute. */
async function attendrePortsLibres() {
  const debut = Date.now();
  while (Date.now() - debut < 90_000) {
    if (ecoutes() === 0) return true;
    await sleep(3_000);
  }
  return false;
}

function arreterArbreProcessus(child) {
  if (child.pid === undefined) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}

function extraire(sortieTexte) {
  const lignes = sortieTexte.split(/\r?\n/);
  const echec =
    [...lignes].reverse().find((l) => /conflits-poste: FAIL|^\s*Error: |FAIL —/.test(l)) ?? "";
  const brut = sortieTexte;
  const iDiag = brut.indexOf("page=");
  const diagnostic = iDiag >= 0 ? brut.slice(iDiag, iDiag + 1600).split(/\r?\n/)[0] : "";
  return { echec: echec.trim().slice(0, 400), diagnostic };
}

async function unePasse(arbre, numero) {
  const portsLibres = await attendrePortsLibres();
  const debut = Date.now();
  if (!portsLibres) {
    return { arbre: arbre.nom, numero, exit: "invalide", duree: 0, echec: "ports de recette occupés avant la passe", diagnostic: "" };
  }
  const fichierLog = join(logs, `${String(numero).padStart(2, "0")}-${arbre.nom}.log`);
  const texte = await new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath, [join(arbre.dir, "tests/recette", recette)], {
      cwd: arbre.dir,
      env: { ...process.env, ...envSupplementaire, CARGO_TARGET_DIR: arbre.cargo },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.length > 400_000) out = out.slice(-300_000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const minuteur = setTimeout(() => {
      out += `\nab-conflits: délai de ${delaiMaxMs / 60_000} min dépassé, arrêt\n`;
      arreterArbreProcessus(child);
    }, delaiMaxMs);
    child.on("exit", (code) => {
      clearTimeout(minuteur);
      resolve({ code, out });
    });
  });
  writeFileSync(fichierLog, texte.out);
  const duree = Math.round((Date.now() - debut) / 1000);
  const { echec, diagnostic } = texte.code === 0 ? { echec: "", diagnostic: "" } : extraire(texte.out);
  return { arbre: arbre.nom, numero, exit: texte.code, duree, echec, diagnostic };
}

function ecrireRapport(resultats, debutGlobal, fini) {
  const compte = (nom) => resultats.filter((r) => r.arbre === nom);
  const echecs = (nom) => compte(nom).filter((r) => r.exit !== 0);
  const valides = (nom) => compte(nom).filter((r) => r.exit !== "invalide");
  const eb = echecs("base").length;
  const en = echecs("nouveau").length;
  let lecture = "Mesure en cours.";
  if (fini) {
    if (eb === 0 && en === 0) lecture = "Aucun échec de part et d'autre : non concluant.";
    else if (eb > 0 && en > 0) lecture = "Échecs sur les deux arbres : l'instabilité précède la montée.";
    else if (en > 0) lecture = "Échecs seulement sur « nouveau » : régression attribuable à la montée.";
    else lecture = "Échecs seulement sur « base » : cas non prévu par la règle du commandement, à lui soumettre.";
  }
  const cellule = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lignes = [
    `# ${titre}`,
    "",
    `Recette mesurée : \`tests/recette/${recette}\` (version de HEAD dans chaque arbre), ${passes} passes par arbre, en série, arbres en alternance (${ARBRES.map((a) => a.nom).join(", ")}).${
      Object.keys(envSupplementaire).length > 0
        ? ` Variables : ${Object.entries(envSupplementaire).map(([k, v]) => `${k}=${v}`).join(", ")}.`
        : ""
    }`,
    "",
    ...ARBRES.map((a) =>
      a.nom === "base"
        ? `- **base** : \`${a.commit}\` (worktree \`${relative(root, a.dir).replace(/\\/g, "/")}\`, juste avant « monter PowerSync en 0.1.0 »), \`CARGO_TARGET_DIR\` propre.`
        : `- **nouveau** : \`${a.commit}\` (dépôt), \`CARGO_TARGET_DIR\` = \`target\`.`,
    ),
    "- Même Docker, même instance (API, PowerSync, Postgres), même port 1420 : seul le poste (dépendances Rust et JavaScript) diffère entre les arbres.",
    `- Début : ${new Date(debutGlobal).toISOString()} ; ${fini ? "terminé" : "en cours"} (${new Date().toISOString()}).`,
    "",
    `**Bilan** : base ${eb} échec(s) sur ${valides("base").length} passe(s) valide(s) ; nouveau ${en} échec(s) sur ${valides("nouveau").length}. ${lecture}`,
    "",
    "| Passe | Arbre | Exit | Durée (s) | Ligne d'échec |",
    "| --- | --- | --- | --- | --- |",
    ...resultats.map((r) => `| ${r.numero} | ${r.arbre} | ${r.exit} | ${r.duree} | ${cellule(r.echec)} |`),
  ];
  const avecDiag = resultats.filter((r) => r.diagnostic);
  if (avecDiag.length > 0) {
    lignes.push("", "## Diagnostics de login", "");
    for (const r of avecDiag) {
      lignes.push(`- passe ${r.numero} (${r.arbre}) : \`${r.diagnostic.replace(/`/g, "'")}\``);
    }
  }
  lignes.push("", `Journaux complets des passes : \`${logs.replace(/\\/g, "/")}\` (hors dépôt).`, "");
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, lignes.join("\n"));
}

const resultats = [];
const debutGlobal = Date.now();
let numero = 0;
console.log(`ab-conflits: ${passes} passes par arbre, journaux dans ${logs}`);
ecrireRapport(resultats, debutGlobal, false);
for (let i = 1; i <= passes; i++) {
  for (const arbre of ARBRES) {
    numero += 1;
    console.log(`ab-conflits: passe ${numero} (${arbre.nom}) démarre`);
    const r = await unePasse(arbre, numero);
    resultats.push(r);
    console.log(`ab-conflits: passe ${numero} (${arbre.nom}) exit=${r.exit} ${r.duree} s ${r.echec}`);
    ecrireRapport(resultats, debutGlobal, false);
  }
}
ecrireRapport(resultats, debutGlobal, true);
console.log(`ab-conflits: terminé, rapport ${relative(root, sortie)}`);
