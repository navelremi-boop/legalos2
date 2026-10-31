#!/usr/bin/env node
/**
 * Captures galerie Contacts (Vite) aux mêmes tailles / thèmes que la maquette.
 * Prérequis : `pnpm --filter @legal-os/poste dev` sur le port 1420.
 * Usage : node tests/recette/contacts-captures-galerie.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "design", "captures", "contacts-galerie");
mkdirSync(out, { recursive: true });

const base = process.env.LEGALOS_GALERIE_URL ?? "http://127.0.0.1:1420/?galerie=1";
const TAILLES = [
  { largeur: 1366, hauteur: 768 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1440 },
];
const THEMES = [
  { valeur: "light", nom: "jour" },
  { valeur: "dark", nom: "nuit" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 15_000 });
} catch (err) {
  console.error(`contacts-captures-galerie: FAIL — Vite inaccessible (${String(err.message ?? err)})`);
  process.exit(1);
}
await page.locator("[data-testid=galerie-vue-contacts]").click();
await page.waitForSelector("[data-testid=ecran-contacts]");

const lignes = [
  "# Captures galerie Contacts",
  "",
  "Jeu de démonstration de la galerie (Camille Martin, Luc Martin, SARL Duclos Industrie) — distinct du jeu Ferrand de la maquette.",
  "",
  "| Thème | Taille | Fichier |",
  "| --- | --- | --- |",
];

for (const th of THEMES) {
  await page.evaluate((valeur) => {
    document.documentElement.dataset.theme = valeur;
  }, th.valeur);
  await page.waitForTimeout(80);
  for (const taille of TAILLES) {
    await page.setViewportSize({ width: taille.largeur, height: taille.hauteur });
    await page.waitForTimeout(80);
    const nom = `contacts-${th.nom}-${taille.largeur}.png`;
    const cible = page.locator("[data-testid=galerie-scene]");
    if ((await cible.count()) > 0) {
      await cible.screenshot({ path: join(out, nom) });
    } else {
      await page.locator("[data-testid=ecran-contacts]").screenshot({ path: join(out, nom) });
    }
    lignes.push(`| ${th.nom} | ${taille.largeur}×${taille.hauteur} | \`${nom}\` |`);
  }
}

writeFileSync(join(out, "README.md"), `${lignes.join("\n")}\n`, "utf8");
await browser.close();
console.log(`contacts-captures-galerie: OK (${THEMES.length * TAILLES.length} fichiers)`);
