#!/usr/bin/env node
/**
 * Coque claire — menu du compte (PLAN, jalon « Coque claire »), sur la galerie de développement.
 *
 * - s'ouvre au clic et à la touche Entrée (Espace aussi) ; se ferme par Échap et par clic extérieur ;
 * - cinq entrées : Temps, Réglages, Palette de commandes, Verrouiller, Se déconnecter ;
 * - la navigation principale n'a que cinq entrées (La journée, Dossiers, Mails, Agenda, Facturation) ;
 * - `data-testid` stables ; le menu n'est pas coupé par la barre (`overflow: hidden`).
 * Que Temps et Réglages s'ouvrent vraiment depuis lui : `menu-compte-tauri.mjs` (application).
 *
 * Usage : node tests/recette/menu-compte.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arreterVite, attendreUrl, demarrerVite, URL_GALERIE } from "./lib/vite-dev.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`menu-compte: FAIL — ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`menu-compte: ${msg}`);
}

const ENTREES = [
  ["menu-compte-temps", "Temps", "temps"],
  ["menu-reglages", "Réglages", "reglages"],
  ["menu-compte-palette", "Palette de commandes", "palette"],
  ["menu-compte-verrouiller", "Verrouiller", "verrouiller"],
  ["menu-compte-deconnexion", "Se déconnecter", "deconnexion"],
];
const NAVIGATION = ["journee", "dossiers", "mails", "agenda", "facturation"];

let chromium;
try {
  chromium = (await import("playwright")).chromium;
} catch {
  fail("playwright non installé (pnpm install à la racine)");
}

const vite = demarrerVite(racine);
// fail() appelle process.exit(1) : le finally ne s'exécute pas, Vite serait laissé actif sur le port 1420.
process.on("exit", () => {
  arreterVite(vite);
});
let navigateur;
try {
  await attendreUrl(URL_GALERIE, 60_000).catch((err) => fail(err.message));
  navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1320, height: 900 } });
  await page.goto(URL_GALERIE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=galerie-demo]");
  await page
    .locator("[data-testid=galerie-commandes]")
    .getByRole("button", { name: "La journée", exact: true })
    .click();

  const bouton = page.getByTestId("menu-compte");
  const liste = page.getByTestId("menu-compte-liste");
  const estOuvert = async () => (await bouton.getAttribute("aria-expanded")) === "true";
  const dernierChoix = () => page.getByTestId("galerie-menu-dernier-choix").textContent();

  // — état initial —
  await bouton.waitFor();
  if (await estOuvert()) fail("le menu est ouvert au départ");
  if ((await liste.count()) !== 0) fail("la liste est dans le DOM alors que le menu est fermé");
  if ((await bouton.textContent())?.trim() !== "Compte") fail("le bouton ne s'appelle pas « Compte »");
  // Avatar du compte (maquette) : initiales dessinées par le CSS, rond de 32 px, nom accessible conservé.
  const avatar = await bouton.evaluate((el) => ({
    initiales: getComputedStyle(el, "::before").content,
    largeur: Math.round(el.getBoundingClientRect().width),
    rayon: getComputedStyle(el).borderRadius,
    nom: el.getAttribute("aria-label"),
  }));
  if (avatar.initiales !== '"JM"') fail(`avatar : initiales ${avatar.initiales} au lieu de "JM"`);
  if (avatar.largeur !== 32) fail(`avatar : largeur ${avatar.largeur} px au lieu de 32`);
  if (avatar.nom !== "Menu du compte") fail(`avatar : nom accessible ${avatar.nom}`);
  ok("état initial : fermé, avatar « JM » de 32 px, texte « Compte » conservé");

  // — navigation principale : cinq entrées, ni Temps ni Réglages —
  const nav = await page.locator("[data-testid^=nav-]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-testid")?.replace("nav-", "")),
  );
  if (JSON.stringify(nav) !== JSON.stringify(NAVIGATION)) {
    fail(`navigation principale : ${JSON.stringify(nav)} au lieu de ${JSON.stringify(NAVIGATION)}`);
  }
  ok("navigation principale : La journée, Dossiers, Mails, Agenda, Facturation (cinq entrées)");

  // — ouverture au clic —
  await bouton.click();
  await liste.waitFor();
  if (!(await estOuvert())) fail("aria-expanded n'est pas à true après le clic");
  const libelles = await liste.getByRole("menuitem").allTextContents();
  const attendus = ENTREES.map((e) => e[1]);
  if (JSON.stringify(libelles.map((l) => l.trim())) !== JSON.stringify(attendus)) {
    fail(`entrées : ${JSON.stringify(libelles)} au lieu de ${JSON.stringify(attendus)}`);
  }
  for (const [testid, libelle] of ENTREES) {
    if ((await page.getByTestId(testid).count()) !== 1) fail(`data-testid ${testid} (${libelle}) absent ou en double`);
  }
  ok("ouverture au clic : cinq entrées, data-testid stables");

  // — le menu n'est pas coupé par la barre : l'élément au centre de chaque entrée est l'entrée —
  for (const [testid, libelle] of ENTREES) {
    const visible = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el === null) return false;
      const r = el.getBoundingClientRect();
      const au = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return au !== null && el.contains(au) && r.top >= 0 && r.bottom <= window.innerHeight;
    }, testid);
    if (!visible) fail(`l'entrée « ${libelle} » est masquée ou hors écran (menu coupé par la barre ?)`);
  }
  ok("entrées visibles et cliquables (non coupées par la barre)");

  // — fermeture par Échap, focus rendu au bouton —
  await page.keyboard.press("Escape");
  await liste.waitFor({ state: "detached" });
  if (await estOuvert()) fail("Échap n'a pas fermé le menu");
  if (!(await bouton.evaluate((el) => el === document.activeElement))) fail("le focus n'est pas rendu au bouton après Échap");
  ok("fermeture par Échap, focus rendu au bouton");

  // — ouverture au clavier : Entrée, puis Espace —
  await bouton.focus();
  await page.keyboard.press("Enter");
  await liste.waitFor();
  if (!(await estOuvert())) fail("Entrée n'a pas ouvert le menu");
  const premier = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  if (premier !== "menu-compte-temps") fail(`focus à l'ouverture sur ${premier} au lieu de menu-compte-temps`);
  await page.keyboard.press("ArrowDown");
  const second = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  if (second !== "menu-reglages") fail(`flèche bas : focus sur ${second} au lieu de menu-reglages`);
  await page.keyboard.press("Escape");
  await liste.waitFor({ state: "detached" });
  await bouton.focus();
  await page.keyboard.press("Space");
  await liste.waitFor();
  ok("ouverture à Entrée et à Espace, focus sur la première entrée, flèches");
  await page.keyboard.press("Escape");
  await liste.waitFor({ state: "detached" });

  // — fermeture par clic extérieur —
  await bouton.click();
  await liste.waitFor();
  await page.mouse.click(60, 700);
  await liste.waitFor({ state: "detached" });
  if (await estOuvert()) fail("un clic extérieur n'a pas fermé le menu");
  ok("fermeture par clic extérieur");

  // — le clic sur le bouton referme —
  await bouton.click();
  await liste.waitFor();
  await bouton.click();
  await liste.waitFor({ state: "detached" });
  ok("un second clic sur « Compte » referme le menu");

  // — chaque entrée déclenche son action puis ferme le menu —
  for (const [testid, libelle, attendu] of ENTREES) {
    await bouton.click();
    await liste.waitFor();
    await page.getByTestId(testid).click();
    await liste.waitFor({ state: "detached" });
    const choix = (await dernierChoix())?.trim();
    if (choix !== attendu) fail(`« ${libelle} » : action ${JSON.stringify(choix)} au lieu de ${JSON.stringify(attendu)}`);
  }
  ok("chaque entrée déclenche son action et ferme le menu");

  ok("OK");
} finally {
  if (navigateur) await navigateur.close();
  arreterVite(vite);
}
