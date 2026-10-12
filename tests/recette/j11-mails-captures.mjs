#!/usr/bin/env node
/**
 * J11 étape 4 partie A — captures de référence de l'écran Mails, jour et nuit, à 1240 par 800 :
 * l'écran de l'app (galerie de développement, données fictives de la maquette) et la maquette
 * `design/maquettes/prototype-mails.html` rendue au même état, côte à côte.
 * Écrit dans design/captures/j11-mails/ ; ne modifie aucune autre capture.
 * Usage : node tests/recette/j11-mails-captures.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sortie = join(racine, "design", "captures", "j11-mails");
const port = 1431;
const origine = `http://127.0.0.1:${port}/?galerie=1`;
const maquette = pathToFileURL(join(racine, "design", "maquettes", "prototype-mails.html")).href;
const police = pathToFileURL(
  join(racine, "apps", "poste", "public", "fonts", "atkinson-hyperlegible-next", "AtkinsonHyperlegibleNext-Variable.ttf"),
).href;

function fail(message) {
  console.error(`j11-mails-captures: FAIL — ${message}`);
  process.exit(1);
}

let chromium;
try {
  chromium = (await import("playwright")).chromium;
} catch {
  fail("playwright non installé (pnpm install à la racine)");
}
mkdirSync(sortie, { recursive: true });

function arreter(enfant) {
  if (enfant.pid === undefined || enfant.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(enfant.pid), "/T", "/F"], { stdio: "ignore" });
  else enfant.kill();
}

const vite = spawn(
  "pnpm",
  ["--filter", "@legal-os/poste", "exec", "vite", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: racine, shell: true, stdio: "ignore" },
);
process.on("exit", () => {
  arreter(vite);
});

async function attendre(url, delai) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* pas encore */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Vite n'a pas démarré");
}

/** États comparés : même mail sélectionné dans l'app et dans la maquette. */
const ETATS = [
  { nom: "aclasser", appMail: "mail-2", maquetteMail: "2" },
  { nom: "invitation", appMail: "mail-4", maquetteMail: "4" },
];

let browser;
try {
  await attendre(origine, 90_000);
  browser = await chromium.launch();

  for (const theme of ["jour", "nuit"]) {
    // --- App (galerie) ---
    const page = await browser.newPage({ viewport: { width: 1320, height: 800 } });
    await page.goto(origine, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=galerie-demo]");
    const commandes = page.locator("[data-testid=galerie-commandes]");
    await commandes.getByRole("button", { name: theme === "jour" ? "Jour" : "Nuit", exact: true }).click();
    await commandes.getByRole("button", { name: "Mails", exact: true }).click();
    await page.waitForSelector("[data-testid=ecran-mails]");
    for (const etat of ETATS) {
      await page.locator(`[data-testid=mail-ligne][data-id=${etat.appMail}]`).click();
      await page.waitForTimeout(450);
      await page.locator("[data-testid=galerie-scene]").screenshot({ path: join(sortie, `app-${theme}-${etat.nom}.png`) });
    }
    await page.close();

    // --- Maquette ---
    const pm = await browser.newPage({ viewport: { width: 1320, height: 800 } });
    await pm.route("**/fonts.googleapis.com/**", (r) => r.abort());
    await pm.route("**/fonts.gstatic.com/**", (r) => r.abort());
    await pm.goto(maquette);
    await pm.addStyleTag({
      content: `@font-face{font-family:"Atkinson Hyperlegible Next";font-weight:400 800;src:url("${police}") format("truetype")}`,
    });
    await pm.evaluate(() => document.fonts.ready);
    if (theme === "nuit") await pm.click(".choix[data-g=theme] button[data-t=nuit]");
    for (const etat of ETATS) {
      await pm.click(`.mail[data-id="${etat.maquetteMail}"]`);
      await pm.waitForTimeout(450);
      await pm.locator("#win").screenshot({ path: join(sortie, `maquette-${theme}-${etat.nom}.png`) });
    }
    await pm.close();

    // --- Côte à côte ---
    for (const etat of ETATS) {
      const html = join(sortie, "_cote-a-cote.html");
      const app = pathToFileURL(join(sortie, `app-${theme}-${etat.nom}.png`)).href;
      const maq = pathToFileURL(join(sortie, `maquette-${theme}-${etat.nom}.png`)).href;
      writeFileSync(
        html,
        `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex;gap:16px;background:#888;width:2496px}img{width:1240px;height:800px;display:block}</style><img src="${app}"><img src="${maq}">`,
        "utf8",
      );
      const pc = await browser.newPage({ viewport: { width: 2496, height: 800 } });
      await pc.goto(pathToFileURL(html).href);
      await pc.waitForLoadState("load");
      await pc.screenshot({ path: join(sortie, `cote-a-cote-${theme}-${etat.nom}.png`) });
      await pc.close();
    }
  }
  console.log(`j11-mails-captures: captures écrites dans ${sortie}`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (browser) await browser.close();
  arreter(vite);
}
