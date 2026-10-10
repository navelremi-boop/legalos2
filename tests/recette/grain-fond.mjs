#!/usr/bin/env node
/**
 * Grain du fond lin (Coque claire, consigne de l'architecte du 10/10/2026) : le grain visible des
 * maquettes est la cible ; l'opacité de 0,04 du cahier § 7.3 est abandonnée.
 *
 * Mesure : écart-type de la luminosité (0-255) d'une zone de fond plate (200 par 30 px, sous la barre,
 * à droite du titre), sur la capture du poste (galerie, écran La journée) et sur la maquette
 * `prototype-journee.html` dans la même zone.
 * - Jour : l'écart-type du poste est compris entre 5 et 8 (maquette : 6,3 à 6,8 selon la zone).
 * - Nuit : critère de l'architecte, l'écart-type est aussi compris entre 5 et 8. Le grain de la
 *   maquette est noir ; sur le fond sombre il ne donne qu'environ 1,45 (maquette) et 2,08 (poste) :
 *   cette partie ÉCHOUE tant que l'architecte n'a pas tranché (grain clair en nuit, mesuré à 7,15,
 *   ou autre intervalle ; voir la dette du grain dans PLAN.md). Ne pas assouplir cette assertion.
 * - Essai négatif : l'ancienne tuile à 0,04 d'opacité fait échouer la mesure du jour.
 *
 * Usage : node tests/recette/grain-fond.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arreterVite, attendreUrl, demarrerVite, URL_GALERIE } from "./lib/vite-dev.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ZONE = { x: 700, y: 72, width: 200, height: 30 };
const JOUR_MIN = 5;
const JOUR_MAX = 8;
const ECART_MAQUETTE_MAX = 2;

function fail(msg) {
  console.error(`grain-fond: FAIL — ${msg}`);
  process.exit(1);
}

let chromium;
try {
  chromium = (await import("playwright")).chromium;
} catch {
  fail("playwright non installé (pnpm install à la racine)");
}

const vite = demarrerVite(racine);
process.on("exit", () => {
  arreterVite(vite);
});

/** Écart-type de la luminosité (0-255) d'une image PNG. */
async function ecartType(outil, png) {
  const [moyenne, ecart] = await outil.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      n += 1;
      s += l;
      s2 += l * l;
    }
    const m = s / n;
    return [m, Math.sqrt(s2 / n - m * m)];
  }, png.toString("base64"));
  return { moyenne, ecart };
}

let navigateur;
try {
  await attendreUrl(URL_GALERIE, 60_000).catch((err) => fail(err.message));
  navigateur = await chromium.launch();
  const outil = await navigateur.newPage();

  // — maquette —
  const maquette = {};
  for (const nuit of [false, true]) {
    const page = await navigateur.newPage({ viewport: { width: 1320, height: 900 } });
    await page.goto(`file:///${racine.replace(/\\/g, "/")}/design/maquettes/prototype-journee.html`);
    await page.waitForSelector("#win");
    if (nuit) await page.evaluate(() => document.getElementById("win").classList.add("nuit"));
    await page.waitForTimeout(600);
    const box = await page.locator("#win").boundingBox();
    if (box === null) fail("maquette : #win introuvable");
    const png = await page.screenshot({
      clip: { x: box.x + ZONE.x, y: box.y + ZONE.y, width: ZONE.width, height: ZONE.height },
    });
    maquette[nuit ? "nuit" : "jour"] = await ecartType(outil, png);
    await page.close();
  }

  // — poste (galerie) —
  const page = await navigateur.newPage({ viewport: { width: 1320, height: 900 } });
  await page.goto(URL_GALERIE, { waitUntil: "networkidle" });
  const commandes = page.locator("[data-testid=galerie-commandes]");
  async function mesurerPoste(libelleTheme) {
    await commandes.getByRole("button", { name: libelleTheme, exact: true }).click();
    await commandes.getByRole("button", { name: "La journée", exact: true }).click();
    await page.waitForSelector("[data-testid=ecran-journee]");
    await page.waitForTimeout(500);
    const box = await page.locator("[data-testid=galerie-scene]").boundingBox();
    if (box === null) fail("galerie : scène introuvable");
    const png = await page.screenshot({
      clip: { x: box.x + ZONE.x, y: box.y + ZONE.y, width: ZONE.width, height: ZONE.height },
    });
    return ecartType(outil, png);
  }

  const jour = await mesurerPoste("Jour");
  console.log(`grain-fond: jour — poste ${jour.ecart.toFixed(2)}, maquette ${maquette.jour.ecart.toFixed(2)}`);
  if (!(jour.ecart >= JOUR_MIN && jour.ecart <= JOUR_MAX)) {
    fail(`jour : écart-type ${jour.ecart.toFixed(2)} hors de [${JOUR_MIN}, ${JOUR_MAX}]`);
  }
  if (Math.abs(jour.ecart - maquette.jour.ecart) > ECART_MAQUETTE_MAX) {
    fail(`jour : écart-type du poste ${jour.ecart.toFixed(2)} trop éloigné de la maquette ${maquette.jour.ecart.toFixed(2)}`);
  }
  console.log(`grain-fond: jour OK — dans [${JOUR_MIN}, ${JOUR_MAX}] et à moins de ${ECART_MAQUETTE_MAX} de la maquette`);

  // — essai négatif : l'ancienne tuile (opacité 0,04) doit faire échouer la mesure du jour —
  const ancienne = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="3" seed="4" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0 0 0 -0.1"/></filter><rect width="220" height="220" filter="url(#n)" opacity="0.04"/></svg>`,
  );
  await page.addStyleTag({
    content: `:root, :root[data-theme="light"], :root[data-theme="dark"] { --grain: url("data:image/svg+xml,${ancienne}"); }`,
  });
  const avecAncien = await mesurerPoste("Jour");
  if (avecAncien.ecart >= JOUR_MIN) {
    fail(`essai négatif : l'ancienne tuile (0,04) donne ${avecAncien.ecart.toFixed(2)}, elle aurait dû échouer (< ${JOUR_MIN})`);
  }
  console.log(`grain-fond: essai négatif OK — l'ancienne tuile à 0,04 donne ${avecAncien.ecart.toFixed(2)} (< ${JOUR_MIN})`);

  // — nuit : comparaison à la maquette (le grain noir se voit peu sur fond sombre) —
  await page.goto(URL_GALERIE, { waitUntil: "networkidle" });
  const nuit = await mesurerPoste("Nuit");
  console.log(`grain-fond: nuit — poste ${nuit.ecart.toFixed(2)}, maquette ${maquette.nuit.ecart.toFixed(2)}`);
  if (!(nuit.ecart >= JOUR_MIN && nuit.ecart <= JOUR_MAX)) {
    fail(
      `nuit : écart-type ${nuit.ecart.toFixed(2)} hors de [${JOUR_MIN}, ${JOUR_MAX}] (maquette : ${maquette.nuit.ecart.toFixed(2)}, qui n'y est pas non plus) — critère de l'architecte non atteint, décision attendue`,
    );
  }
  console.log(`grain-fond: nuit OK — dans [${JOUR_MIN}, ${JOUR_MAX}]`);
  console.log("grain-fond: OK");
} finally {
  if (navigateur) await navigateur.close();
  arreterVite(vite);
}
