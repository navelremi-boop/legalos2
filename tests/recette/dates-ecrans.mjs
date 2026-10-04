#!/usr/bin/env node
/**
 * J10 — aucune date AAAA-MM-JJ dans le texte rendu des écrans.
 * Dates à la française : « 30 sept. », « mardi 30 septembre ». Heure : « 9 h 00 ».
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const port = 1421;
const origine = `http://127.0.0.1:${port}/?galerie=1`;
const DATE_ISO = /\d{4}-\d{2}-\d{2}(?!\d)/;
const JOUR = /(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi) \d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/;
const MOIS_COURT = /\d{1,2} (janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)/;
const HEURE = /\d{1,2}\u00a0h\u00a0\d{2}/;

function fail(msg) {
  console.error(`dates-ecrans: FAIL — ${msg}`);
  process.exit(1);
}

function datesIso(texte) {
  return texte.match(new RegExp(DATE_ISO, "g")) ?? [];
}

const negatif = datesIso("Audience le 2026-09-30, puis 2026-09-30T08:30:00.");
if (negatif.length !== 2 || negatif[0] !== "2026-09-30") {
  fail("essai négatif muet : une date AAAA-MM-JJ doit être signalée");
}
if (datesIso("30 sept. et mardi 30 septembre").length !== 0) {
  fail("essai négatif : faux positif sur les dates françaises");
}
if (datesIso("Dossier 2026-042, facture 2026-014").length !== 0) {
  fail("essai négatif : une référence n'est pas une date");
}

let chromium;
try {
  chromium = (await import("playwright")).chromium;
} catch {
  fail("playwright non installé (pnpm install à la racine)");
}

const vite = spawn(
  "pnpm",
  ["--filter", "@legal-os/poste", "exec", "vite", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: root, shell: true, stdio: "pipe" },
);
process.on("exit", () => {
  vite.kill();
});

function attendre(url, timeoutMs) {
  const debut = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          resolve(true);
          return;
        }
      } catch {
        /* réessayer */
      }
      if (Date.now() - debut > timeoutMs) {
        reject(new Error("timeout"));
        return;
      }
      setTimeout(() => {
        void tick();
      }, 400);
    };
    void tick();
  });
}

async function texteRendu(page) {
  return page.locator("[data-testid=galerie-scene]").evaluate((el) => {
    const clone = el.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "";
    clone.querySelectorAll("[data-testid=facture-cii], input, textarea").forEach((noeud) => {
      noeud.remove();
    });
    return clone.textContent ?? "";
  });
}

const ecrans = [
  ["Dossier", "ecran-dossier"],
  ["La journée", "ecran-journee"],
  ["Dossiers", "ecran-dossiers"],
  ["Mails", "ecran-mails"],
  ["Agenda", "ecran-agenda"],
  ["Facturation", "ecran-facturation"],
  ["Réglages", "ecran-reglages"],
];

let browser;
try {
  await attendre(origine, 60_000);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
  await page.goto(origine, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=galerie-demo]");
  const commandes = page.locator("[data-testid=galerie-commandes]");

  for (const [nom, testid] of ecrans) {
    await commandes.getByRole("button", { name: nom, exact: true }).click();
    await page.waitForSelector(`[data-testid=${testid}]`);
    const texte = await texteRendu(page);
    const trouvees = datesIso(texte);
    if (trouvees.length > 0) fail(`${nom} affiche ${trouvees.join(", ")}`);
  }

  await commandes.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByTestId("agenda-vue-jour").click();
  await page.waitForSelector("[data-testid=agenda-element-heure]");
  const jour = await texteRendu(page);
  if (!JOUR.test(jour)) fail(`vue Jour sans date longue (${jour.slice(0, 180)})`);
  if (!HEURE.test(jour)) fail("vue Jour sans heure");
  const heuresJour = await page.locator("[data-testid=agenda-element-heure]").count();
  if (heuresJour < 1) fail("vue Jour : aucun élément avec une heure");

  await page.getByTestId("agenda-vue-semaine").click();
  await page.waitForSelector("[data-testid=agenda-vue-semaine-contenu]");
  const jours = await page.locator("[data-testid=agenda-jour]").count();
  if (jours !== 7) fail(`vue Semaine : ${jours} jours au lieu de 7`);
  const semaine = await texteRendu(page);
  const isoSemaine = datesIso(semaine);
  if (isoSemaine.length > 0) fail(`vue Semaine affiche ${isoSemaine.join(", ")}`);
  if (!HEURE.test(semaine)) fail("vue Semaine sans heure");

  await commandes.getByRole("button", { name: "Mails", exact: true }).click();
  await page.waitForSelector("[data-testid=lecture-date]");
  const mails = await texteRendu(page);
  if (!MOIS_COURT.test(mails)) fail("liste des mails sans date courte");
  if (!JOUR.test(mails)) fail("lecture d'un mail sans date longue");
  if (!HEURE.test(mails)) fail("lecture d'un mail sans heure");

  console.log("dates-ecrans: OK");
} catch (err) {
  vite.kill();
  if (browser) await browser.close();
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (browser) await browser.close();
  vite.kill();
}
