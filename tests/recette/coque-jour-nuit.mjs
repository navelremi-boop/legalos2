#!/usr/bin/env node
/**
 * Coque claire — jour et nuit (PLAN, jalon « Coque claire »).
 *
 * En jour : luminance relative de la barre haute et de la barre d'actions supérieure à 0,6, fond de
 * l'écran supérieur à 0,5. En nuit : inférieure à 0,25. La barre est translucide : sa couleur est
 * composée sur le fond qui la porte (le résultat visible), pas lue brute.
 * Essai négatif : les anciennes valeurs (barre sombre, fond ardoise en jour) font échouer le contrôle.
 *
 * Usage : node tests/recette/coque-jour-nuit.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arreterVite, attendreUrl, demarrerVite, luminance, URL_GALERIE } from "./lib/vite-dev.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(msg) {
  console.error(`coque-jour-nuit: FAIL — ${msg}`);
  process.exit(1);
}

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

  async function choisir(libelleTheme) {
    const commandes = page.locator("[data-testid=galerie-commandes]");
    await commandes.getByRole("button", { name: libelleTheme, exact: true }).click();
    await commandes.getByRole("button", { name: "La journée", exact: true }).click();
    await page.waitForSelector("[data-testid=barre-haut]");
    await page.waitForSelector(".barre-actions");
    await page.waitForSelector(".fond-neutre");
  }

  /** Couleurs composées : la barre et le dock (translucides) sur le fond qui les porte. */
  async function mesurer() {
    const rgb = await page.evaluate(() => {
      const analyse = (couleur) => {
        const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/.exec(couleur);
        if (m === null) return null;
        const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return [Number(m[1]), Number(m[2]), Number(m[3]), a];
      };
      /** Fond visible sous un élément : premier ancêtre opaque. */
      const fondSous = (el) => {
        for (let n = el.parentElement; n !== null; n = n.parentElement) {
          const c = analyse(getComputedStyle(n).backgroundColor);
          if (c !== null && c[3] >= 0.99) return c;
        }
        return [255, 255, 255, 1];
      };
      const compose = (el) => {
        const c = analyse(getComputedStyle(el).backgroundColor);
        const dessous = fondSous(el);
        if (c === null) return dessous;
        const [r, g, b, a] = c;
        return [0, 1, 2].map((i) => Math.round((c[i] ?? 0) * a + (dessous[i] ?? 0) * (1 - a)));
      };
      const fmt = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      const barre = document.querySelector("[data-testid=barre-haut]");
      const dock = document.querySelector(".barre-actions");
      const fond = document.querySelector(".fond-neutre");
      if (barre === null || dock === null || fond === null) return null;
      const fondEcran = analyse(getComputedStyle(fond).backgroundColor);
      return {
        barre: fmt(compose(barre)),
        dock: fmt(compose(dock)),
        fond: fmt(fondEcran ?? [0, 0, 0, 1]),
      };
    });
    if (rgb === null) fail("barre haute, barre d'actions ou fond neutre introuvable dans la galerie");
    return {
      couleurs: rgb,
      barre: luminance(rgb.barre),
      dock: luminance(rgb.dock),
      fond: luminance(rgb.fond),
    };
  }

  const verifierJour = (m) => [
    ...(m.barre > 0.6 ? [] : [`barre haute ${m.barre.toFixed(3)} ≤ 0,6 (${m.couleurs.barre})`]),
    ...(m.dock > 0.6 ? [] : [`barre d'actions ${m.dock.toFixed(3)} ≤ 0,6 (${m.couleurs.dock})`]),
    ...(m.fond > 0.5 ? [] : [`fond ${m.fond.toFixed(3)} ≤ 0,5 (${m.couleurs.fond})`]),
  ];
  const verifierNuit = (m) => [
    ...(m.barre < 0.25 ? [] : [`barre haute ${m.barre.toFixed(3)} ≥ 0,25 (${m.couleurs.barre})`]),
    ...(m.dock < 0.25 ? [] : [`barre d'actions ${m.dock.toFixed(3)} ≥ 0,25 (${m.couleurs.dock})`]),
    ...(m.fond < 0.25 ? [] : [`fond ${m.fond.toFixed(3)} ≥ 0,25 (${m.couleurs.fond})`]),
  ];

  // — jour —
  await choisir("Jour");
  const jour = await mesurer();
  const ecartsJour = verifierJour(jour);
  if (ecartsJour.length > 0) fail(`jour : ${ecartsJour.join(" ; ")}`);
  console.log(
    `coque-jour-nuit: jour OK — barre ${jour.barre.toFixed(3)}, barre d'actions ${jour.dock.toFixed(3)}, fond ${jour.fond.toFixed(3)}`,
  );

  // — essai négatif : les anciennes valeurs doivent faire échouer le contrôle du jour —
  await page.addStyleTag({
    content: `:root[data-theme="light"] { --barre: rgb(16 21 23 / 0.86); --dock-fond: rgb(16 21 23 / 0.86); --neutre: #2a3337; }`,
  });
  const ancien = await mesurer();
  const ecartsAncien = verifierJour(ancien);
  if (ecartsAncien.length !== 3) {
    fail(`essai négatif : les anciennes valeurs auraient dû échouer sur les trois mesures, écarts : ${ecartsAncien.join(" ; ") || "aucun"}`);
  }
  console.log(`coque-jour-nuit: essai négatif OK — l'ancienne valeur échoue (${ecartsAncien.length} écarts)`);

  // — nuit (page rechargée : sans l'injection de l'essai négatif) —
  await page.goto(URL_GALERIE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=galerie-demo]");
  await choisir("Nuit");
  const nuit = await mesurer();
  const ecartsNuit = verifierNuit(nuit);
  if (ecartsNuit.length > 0) fail(`nuit : ${ecartsNuit.join(" ; ")}`);
  console.log(
    `coque-jour-nuit: nuit OK — barre ${nuit.barre.toFixed(3)}, barre d'actions ${nuit.dock.toFixed(3)}, fond ${nuit.fond.toFixed(3)}`,
  );
  console.log("coque-jour-nuit: OK");
} finally {
  if (navigateur) await navigateur.close();
  arreterVite(vite);
}
