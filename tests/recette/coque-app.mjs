#!/usr/bin/env node
/**
 * Acceptation jalon Coque de l'app — jetons § 7.3, testid coque, absence de couleurs hors tokens.
 * Usage : node tests/recette/coque-app.mjs
 * Captures (optionnel, Playwright) : node tests/recette/coque-app.mjs --captures
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wantCaptures = process.argv.includes("--captures");

function fail(msg) {
  console.error(`coque-app: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`coque-app: ${msg}`);
}

const CHEMISES = [
  "kraft",
  "bleu-classeur",
  "vert-amande",
  "jaune-paille",
  "rose-buvard",
  "lilas",
  "vert-eau",
  "gris-perle",
];
const VALEURS = ["fond", "teinte", "texte", "accent"];

const tokens = readFileSync(join(root, "design/tokens.css"), "utf8");
if (!existsSync(join(root, "design/grain.svg"))) fail("design/grain.svg manquant");
if (!/--neutre:/u.test(tokens)) fail("--neutre absent");
if (!/--grain:/u.test(tokens)) fail("--grain absent");
if (!/--lumiere:/u.test(tokens)) fail("--lumiere absent");
if (!/--sur-chemise:/u.test(tokens)) fail("--sur-chemise absent");

for (const chemise of CHEMISES) {
  for (const valeur of VALEURS) {
    const re = new RegExp(
      `data-chemise="${chemise}"[\\s\\S]{0,400}--chemise-${valeur}:\\s*#`,
      "u",
    );
    if (!re.test(tokens)) {
      fail(`jeton --chemise-${valeur} manquant ou incomplet pour ${chemise}`);
    }
  }
}
ok("tokens § 7.3 (8 chemises × 4 valeurs, neutre, grain, lumière)");

const TESTIDS = [
  "barre-haut",
  "etiquette-dossier",
  "jauge-echeance",
  "feuille",
  "intercalaires",
  "barre-actions",
  "ecran-journee",
  "fond-neutre",
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(tsx|ts|css)$/u.test(name)) acc.push(path);
  }
  return acc;
}

const srcDir = join(root, "apps/poste/src");
const srcFiles = walk(srcDir);
const srcBlob = srcFiles.map((p) => readFileSync(p, "utf8")).join("\n");
for (const id of TESTIDS) {
  if (!srcBlob.includes(`data-testid="${id}"`)) {
    fail(`data-testid="${id}" absent du code source`);
  }
}
ok("data-testid coque présents");

const colorRe = /(?:\brgb\s*\(|\bhsl\s*\(|#[0-9a-fA-F]{3,8}\b)/g;
for (const path of srcFiles) {
  const rel = relative(root, path).replaceAll("\\", "/");
  let text = readFileSync(path, "utf8");
  text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  colorRe.lastIndex = 0;
  const match = colorRe.exec(text);
  if (match) {
    fail(`couleur en dur dans ${rel} : ${match[0]}`);
  }
}
ok("aucune couleur en dur dans apps/poste/src");

if (!srcBlob.includes("import.meta.env.DEV")) {
  fail("galerie DEV : import.meta.env.DEV absent");
}
if (!/GalerieDemo/u.test(srcBlob)) fail("GalerieDemo absente");
ok("galerie réservée au DEV");

if (!srcBlob.includes("libelleReferenceDossier")) {
  fail("référence dossier : libelleReferenceDossier absent");
}
if (!srcBlob.includes('REFERENCE_EN_ATTENTE = "Référence en attente"')) {
  fail("référence dossier : « Référence en attente » (cahier § 3.4) absent");
}
if (!/reference:\s*column\.text/u.test(srcBlob)) {
  fail("AppSchema : dossiers.reference absent");
}
ok("référence de dossier (§ 3.4) branchée");

if (/useState<OngletDossier\[\]>\(\(\) =>\s*DOSSIERS_DEMO/u.test(srcBlob)) {
  fail("onglets initialisés avec DOSSIERS_DEMO (dette Coque)");
}
if (!srcBlob.includes("instanceReachable")) {
  fail("sonde d'instance (instanceReachable) absente — navigator.onLine seul insuffisant");
}
ok("onglets sans démo ; sonde d'instance présente");

const rType = spawnSync("pnpm", ["--filter", "@legal-os/poste", "typecheck"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
if (rType.status !== 0) fail(`typecheck exit ${rType.status ?? 1}`);

const rLint = spawnSync("pnpm", ["--filter", "@legal-os/poste", "lint"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
if (rLint.status !== 0) fail(`lint exit ${rLint.status ?? 1}`);

ok("typecheck + lint OK");

if (wantCaptures) {
  await runCaptures();
} else {
  const capturesDir = join(root, "design/captures");
  mkdirSync(capturesDir, { recursive: true });
  const note = join(capturesDir, "README.md");
  if (!existsSync(note)) {
    writeFileSync(
      note,
      `# Captures coque

Lancer : \`node tests/recette/coque-app.mjs --captures\`

Ou manuellement : \`pnpm --filter @legal-os/poste dev\` puis ouvrir \`http://127.0.0.1:1420/?galerie=1\`
(jour / nuit × kraft / bleu-classeur / vert-amande + La journée).
`,
      "utf8",
    );
  }
  ok("captures : lancer avec --captures (Playwright) ou via ?galerie=1 en DEV");
}

console.log("coque-app: OK");

async function runCaptures() {
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    fail("playwright non installé (pnpm install à la racine)");
  }

  const outDir = join(root, "design/captures");
  mkdirSync(outDir, { recursive: true });

  const vite = spawn(
    "pnpm",
    ["--filter", "@legal-os/poste", "exec", "vite", "--host", "127.0.0.1", "--port", "1420"],
    { cwd: root, shell: true, stdio: "pipe" },
  );

  const ready = await waitForUrl("http://127.0.0.1:1420/?galerie=1", 60_000).catch((err) => {
    vite.kill();
    fail(`Vite n'a pas démarré : ${err}`);
  });
  if (!ready) {
    vite.kill();
    fail("Vite timeout");
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
    await page.goto("http://127.0.0.1:1420/?galerie=1", { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=galerie-demo]");

    const commandes = page.locator("[data-testid=galerie-commandes]");
    const chemises = ["kraft", "bleu-classeur", "vert-amande"];
    const fondAttendu = {
      light: {
        kraft: "rgb(206, 154, 85)",
        "bleu-classeur": "rgb(111, 162, 224)",
        "vert-amande": "rgb(108, 191, 132)",
        neutre: "rgb(42, 51, 55)",
      },
      dark: {
        kraft: "rgb(110, 81, 40)",
        "bleu-classeur": "rgb(47, 79, 122)",
        "vert-amande": "rgb(46, 90, 61)",
        neutre: "rgb(17, 23, 26)",
      },
    };
    for (const theme of ["light", "dark"]) {
      await commandes.getByRole("button", { name: theme === "light" ? "Jour" : "Nuit", exact: true }).click();
      await commandes.getByRole("button", { name: "Dossier", exact: true }).click();
      for (const chemise of chemises) {
        const label = chemise.replace(/-/g, " ");
        await commandes.getByRole("button", { name: label, exact: true }).click();
        await page.waitForSelector(`[data-testid=ecran-dossier][data-chemise=${chemise}]`);
        const cible = fondAttendu[theme][chemise];
        await page.waitForFunction(
          (attendu) => {
            const el = document.querySelector("[data-testid=ecran-dossier]");
            return el !== null && getComputedStyle(el).backgroundColor === attendu;
          },
          cible,
          { timeout: 5_000 },
        );
        // Laisser les layout effects d’overflow des onglets se stabiliser (§ 7.4).
        await page.waitForFunction(
          () => {
            const overflow = document.querySelector("[data-testid=onglets-overflow]");
            const onglets = document.querySelectorAll(".onglet-dossier");
            // Avec 4 dossiers démo, le menu doit apparaître à 1240px.
            return overflow !== null || onglets.length <= 2;
          },
          { timeout: 3_000 },
        ).catch(() => undefined);
        await page.waitForTimeout(100);
        const scene = page.locator("[data-testid=galerie-scene]");
        await scene.screenshot({
          path: join(outDir, `dossier-${chemise}-${theme === "light" ? "jour" : "nuit"}.png`),
        });
      }
      await commandes.getByRole("button", { name: "La journée", exact: true }).click();
      await page.waitForSelector("[data-testid=ecran-journee]");
      const neutre = fondAttendu[theme].neutre;
      await page.waitForFunction(
        (attendu) => {
          const el = document.querySelector("[data-testid=ecran-journee]");
          return el !== null && getComputedStyle(el).backgroundColor === attendu;
        },
        neutre,
        { timeout: 5_000 },
      );
      await page.locator("[data-testid=galerie-scene]").screenshot({
        path: join(outDir, `journee-${theme === "light" ? "jour" : "nuit"}.png`),
      });

      const horsDossier = [
        ["Dossiers", "ecran-dossiers", "dossiers"],
        ["Mails", "ecran-mails", "mails"],
        ["Agenda", "ecran-agenda", "agenda"],
        ["Facturation", "ecran-facturation", "facturation"],
        ["Réglages", "ecran-reglages", "reglages"],
      ];
      for (const [nom, testid, fichier] of horsDossier) {
        await commandes.getByRole("button", { name: nom, exact: true }).click();
        await page.waitForSelector(`[data-testid=${testid}][data-fond=neutre]`);
        await page.waitForFunction(
          (attendu) => {
            const el = document.querySelector("[data-fond=neutre]");
            return el !== null && getComputedStyle(el).backgroundColor === attendu;
          },
          neutre,
          { timeout: 5_000 },
        );
        if (testid === "ecran-mails") {
          await page.waitForSelector("[data-testid=banniere-classer]");
          await page.waitForSelector("[data-testid=pastille-mail]");
          await page.waitForSelector("[data-testid=lecture-date]");
        }
        if (testid === "ecran-agenda") {
          await page.getByTestId("agenda-vue-jour").click();
          await page.waitForSelector("[data-testid=agenda-vue-jour-contenu]");
          await page.waitForSelector("[data-testid=agenda-element-heure]");
        }
        await page.waitForTimeout(100);
        await page.locator("[data-testid=galerie-scene]").screenshot({
          path: join(outDir, `${fichier}-${theme === "light" ? "jour" : "nuit"}.png`),
        });
        if (testid === "ecran-agenda") {
          await page.getByTestId("agenda-vue-semaine").click();
          await page.waitForSelector("[data-testid=agenda-vue-semaine-contenu]");
          await page.waitForSelector("[data-testid=agenda-element-heure]");
          await page.waitForTimeout(100);
          await page.locator("[data-testid=galerie-scene]").screenshot({
            path: join(outDir, `agenda-semaine-${theme === "light" ? "jour" : "nuit"}.png`),
          });
        }
      }

      // Vue scindée (§ 7.4) : chrono + aperçu, jour et nuit (chemise kraft).
      await commandes.getByRole("button", { name: "Dossier", exact: true }).click();
      await commandes.getByRole("button", { name: "kraft", exact: true }).click();
      await page.waitForSelector("[data-testid=ecran-dossier][data-chemise=kraft]");
      await page.waitForSelector("[data-testid=chrono-liste]");
      await page.waitForSelector("[data-testid=chrono-apercu]");
      await page.waitForFunction(
        (attendu) => {
          const el = document.querySelector("[data-testid=ecran-dossier]");
          return el !== null && getComputedStyle(el).backgroundColor === attendu;
        },
        fondAttendu[theme].kraft,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(100);
      await page.locator("[data-testid=galerie-scene]").screenshot({
        path: join(outDir, `vue-scindee-${theme === "light" ? "jour" : "nuit"}.png`),
      });
    }
    ok(`captures écrites dans ${relative(root, outDir)}`);
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }
}

function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status === 200) {
          resolve(true);
          return;
        }
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("timeout"));
        return;
      }
      setTimeout(() => {
        void tick();
      }, 500);
    };
    void tick();
  });
}
