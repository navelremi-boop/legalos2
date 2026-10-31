#!/usr/bin/env node
/**
 * Captures côte à côte maquette Contacts (prototype-contacts.html) :
 * Ferrand Métal (Général), Antoine Ferrand (Liens), mode Importer SIREN ;
 * 1 366 × 768, 1 920 × 1 080, 2 560 × 1 440 ; jour et nuit.
 * Écrit dans design/captures/contacts-maquette/ et un index Markdown.
 *
 * Usage : node tests/recette/contacts-captures-maquette.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = join(root, "design", "maquettes", "prototype-contacts.html");
const out = join(root, "design", "captures", "contacts-maquette");
mkdirSync(out, { recursive: true });

const TAILLES = [
  { largeur: 1366, hauteur: 768 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1440 },
];
const THEMES = ["jour", "nuit"];
const SCENES = [
  { id: "ferrand-general", contact: "ferrand", onglet: "general" },
  { id: "antoine-liens", contact: "antoine", onglet: "liens" },
  { id: "importer-siren", mode: "siren" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
await page.waitForSelector("#win");

async function theme(nom) {
  await page.click(`button[data-t="${nom}"]`);
  await page.waitForTimeout(80);
}

async function scene(s) {
  if (s.mode === "siren") {
    await page.evaluate(() => {
      etat.mode = "nouveau";
      etat.form = "siren";
      etat.nat = "pm";
      etat.siren = "812345676";
      etat.reg = {
        denomination: "FERRAND METAL",
        forme: "SAS",
        adresse: "14 RUE DE LA FORGE 69007 LYON",
        doublon: true,
      };
      render();
    });
    return;
  }
  await page.evaluate(
    ({ contact, onglet }) => {
      etat.sel = contact;
      etat.onglet = onglet;
      etat.mode = "fiche";
      etat.form = null;
      render();
    },
    { contact: s.contact, onglet: s.onglet },
  );
}

const lignes = [
  "# Captures maquette Contacts",
  "",
  "Générées par `node tests/recette/contacts-captures-maquette.mjs`.",
  "Données : jeu du prototype (Ferrand Métal, Antoine Ferrand, import SIREN).",
  "",
  "| Scène | Thème | Taille | Fichier |",
  "| --- | --- | --- | --- |",
];

for (const th of THEMES) {
  await theme(th);
  for (const taille of TAILLES) {
    await page.setViewportSize({ width: taille.largeur, height: taille.hauteur });
    for (const s of SCENES) {
      await scene(s);
      await page.waitForTimeout(50);
      const nom = `${s.id}-${th}-${taille.largeur}.png`;
      await page.locator("#win").screenshot({ path: join(out, nom) });
      lignes.push(
        `| ${s.id} | ${th} | ${taille.largeur}×${taille.hauteur} | \`${nom}\` |`,
      );
    }
  }
}

writeFileSync(join(out, "README.md"), `${lignes.join("\n")}\n`, "utf8");
await browser.close();
console.log(`contacts-captures-maquette: OK (${SCENES.length * THEMES.length * TAILLES.length} fichiers dans ${out})`);
