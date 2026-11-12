#!/usr/bin/env node
/**
 * Captures galerie Contacts (Vite) aux mêmes scènes, tailles et thèmes que la maquette
 * (`contacts-captures-maquette.mjs`) : SAS Ferrand Métal (Général, Dossiers, Factures, Mails), Antoine Ferrand (Liens), Holding Perrache (Dossiers),
 * création d'un contact (personne physique), Importer par SIREN (société déjà dans l'annuaire,
 * puis société trouvée au registre) ; 1 366 × 768, 1 920 × 1 080, 2 560 × 1 440 ; jour et nuit.
 * Jeu de la galerie : celui de la maquette (famille Ferrand, dossier 2026-031).
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

const base = process.env.LEGALOS_GALERIE_URL ?? "http://127.0.0.1:1420/?galerie=1&plein=1";
const TAILLES = [
  { largeur: 1366, hauteur: 768 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1440 },
];
const THEMES = [
  { valeur: "light", nom: "jour" },
  { valeur: "dark", nom: "nuit" },
];
const SCENES = [
  { id: "ferrand-general", contact: "ferrand", onglet: "general" },
  { id: "antoine-liens", contact: "antoine", onglet: "liens" },
  { id: "ferrand-dossiers", contact: "ferrand", onglet: "dossiers" },
  { id: "ferrand-factures", contact: "ferrand", onglet: "factures" },
  { id: "ferrand-mails", contact: "ferrand", onglet: "mails" },
  { id: "perrache-dossiers", contact: "perrache", onglet: "dossiers" },
  { id: "importer-siren", mode: "siren" },
  { id: "nouveau-personne", mode: "personne" },
  { id: "importer-siren-resultat", mode: "siren-resultat" },
];

function fail(message) {
  console.error(`contacts-captures-galerie: FAIL — ${message}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 15_000 });
} catch (err) {
  fail(`Vite inaccessible (${String(err.message ?? err)})`);
}

async function ouvrirContacts() {
  await page.locator("[data-testid=galerie-vue-contacts]").click();
  await page.waitForSelector("[data-testid=ecran-contacts]");
}

async function scene(s) {
  // Repart d'un écran neuf : le panneau de création ne garde rien d'une scène à l'autre.
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=galerie-vue-dossiers]").click({ force: true });
  await ouvrirContacts();
  if (s.mode === "personne") {
    await page.locator("[data-testid=contacts-nouveau]").click();
    await page.locator("[data-testid=contacts-creation-personne]").waitFor({ timeout: 5_000 });
    return;
  }
  if (s.mode === "siren" || s.mode === "siren-resultat") {
    await page.locator("[data-testid=contacts-importer-siren]").click();
    const champ = page.locator("[data-testid=contacts-creation-siren]");
    await champ.waitFor({ timeout: 5_000 });
    // Comme la maquette : le SIREN de Ferrand Métal est déjà dans l'annuaire ; l'autre vient du registre.
    await champ.fill(s.mode === "siren" ? "812345676" : "879201341");
    await page.locator("[data-testid=contacts-creation-interroger]").click();
    await page
      .locator(s.mode === "siren" ? "[data-testid=contacts-creation-doublon]" : "[data-testid=contacts-creation-proposition]")
      .waitFor({ timeout: 5_000 });
    return;
  }
  await page.locator(`[data-testid=contacts-ligne][data-contact-id="${s.contact}"]`).click();
  await page.locator(`[data-testid=contacts-onglet-${s.onglet}]`).click();
}

await ouvrirContacts();
for (const attendu of ["SAS Ferrand Métal", "Me Anne Perrin", "Annuaire commun au cabinet", "Doublon possible"]) {
  // fr() pose des espaces insécables (« Me Anne ») : comparaison sur des espaces ordinaires.
  const texte = (await page.locator("[data-testid=ecran-contacts]").innerText()).replace(/[  ]/gu, " ");
  if (!texte.includes(attendu)) fail(`« ${attendu} » absent de l'écran Contacts de la galerie`);
}

const lignes = [
  "# Captures galerie Contacts",
  "",
  "Générées par `node tests/recette/contacts-captures-galerie.mjs`.",
  "Jeu de la galerie aligné sur la maquette (Ferrand Métal, Antoine Ferrand, import SIREN) ; à comparer à `design/captures/contacts-maquette/`.",
  "",
  "| Scène | Thème | Taille | Fichier |",
  "| --- | --- | --- | --- |",
];

for (const th of THEMES) {
  await page.evaluate((valeur) => {
    document.documentElement.dataset.theme = valeur;
  }, th.valeur);
  for (const taille of TAILLES) {
    await page.setViewportSize({ width: taille.largeur, height: taille.hauteur });
    for (const s of SCENES) {
      await scene(s);
      await page.evaluate((valeur) => {
        document.documentElement.dataset.theme = valeur;
        // Les clics de Playwright font défiler les conteneurs « overflow: hidden » de la scène
        // (barre haute poussée hors champ) : on les ramène en haut avant la capture.
        window.scrollTo(0, 0);
        for (const element of document.querySelectorAll("[data-testid=galerie-scene], [data-testid=galerie-scene] *")) {
          if (element.scrollTop > 0 && getComputedStyle(element).overflowY === "hidden") element.scrollTop = 0;
        }
      }, th.valeur);
      await page.waitForTimeout(120);
      const nom = `${s.id}-${th.nom}-${taille.largeur}.png`;
      const cible = page.locator("[data-testid=galerie-scene]");
      if ((await cible.count()) > 0) {
        await cible.screenshot({ path: join(out, nom) });
      } else {
        await page.locator("[data-testid=ecran-contacts]").screenshot({ path: join(out, nom) });
      }
      lignes.push(`| ${s.id} | ${th.nom} | ${taille.largeur}×${taille.hauteur} | \`${nom}\` |`);
    }
  }
}

writeFileSync(join(out, "README.md"), `${lignes.join("\n")}\n`, "utf8");
await browser.close();
console.log(
  `contacts-captures-galerie: OK (${SCENES.length * THEMES.length * TAILLES.length} fichiers dans ${out})`,
);
