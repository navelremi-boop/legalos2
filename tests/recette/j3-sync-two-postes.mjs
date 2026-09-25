#!/usr/bin/env node
/**
 * Ancien scénario navigateur (Playwright). Ce n'est plus la preuve de J3 :
 * le cahier § 3.4 exige l'app Tauri et le SDK natif, qui ne s'initialise pas dans Chromium.
 * La CI ne l'exécute plus. Le lancer ici échoue tant que la synchro n'est pas faite dans l'app réelle.
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
async function pickPreviewPort() {
  if (process.env.LEGALOS_PREVIEW_PORT) {
    return Number(process.env.LEGALOS_PREVIEW_PORT);
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("port libre introuvable"));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

const previewPort = await pickPreviewPort();
const previewUrl = `http://127.0.0.1:${previewPort}`;
/** Même origine que le preview Vite (proxy /api et /sync vers Caddy). */
function instanceBaseForPreview() {
  return previewUrl;
}

function fail(msg) {
  console.error(`j3-sync-two-postes: FAIL — ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function spawnPreview() {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@legal-os/poste",
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
      "--strictPort",
    ],
    {
      cwd: root,
      stdio: "ignore",
      shell: process.platform === "win32",
      env: { ...process.env },
    },
  );
  return child;
}

async function waitForPreview() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(previewUrl, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  fail("vite preview injoignable");
}

async function completeOnboarding(page, nomAppareil) {
  page.setDefaultTimeout(180_000);
  await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("#instance-url").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#instance-url").fill(instanceBaseForPreview());
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.locator("#email").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#email").fill(demoEmail);
  await page.locator("#password").fill(demoPassword);
  await page.locator("#nom-appareil").fill(nomAppareil);
  await page.getByRole("button", { name: "Se connecter" }).click();
  const totpInput = page.locator("#code-totp");
  try {
    await totpInput.waitFor({ state: "visible", timeout: 90_000 });
  } catch {
    const bodyText = await page.locator("body").innerText();
    fail(`écran TOTP absent après connexion — aperçu : ${bodyText.slice(0, 200)}`);
  }
  await totpInput.fill(totpNow());
  await page.getByRole("button", { name: "Valider" }).click();
  try {
    await page.waitForFunction(
      () =>
        typeof window.__legalosRecette?.readCabinetNom === "function" &&
        typeof window.__legalosRecette?.patchCabinetNom === "function",
      { timeout: 120_000 },
    );
  } catch {
    const bodyText = await page.locator("body").innerText();
    fail(`sync initiale / hooks recette absents — ${bodyText.slice(0, 350)}`);
  }
}

const build = spawnSync(
  "pnpm",
  ["--filter", "@legal-os/poste", "build"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_LEGALOS_RECETTE_HOOKS: "1" },
  },
);
if (build.status !== 0) {
  fail("build poste (hooks recette) a échoué");
}

const preview = spawnPreview();
try {
  await waitForPreview();
  const browser = await chromium.launch({ headless: true });
  try {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await completeOnboarding(pageA, "recette-j3-poste-a");
    await completeOnboarding(pageB, "recette-j3-poste-b");

    const newNom = `Sync-J3-${randomUUID().slice(0, 8)}`;
    await pageA.evaluate(async (nom) => {
      await window.__legalosRecette.patchCabinetNom(nom);
    }, newNom);

    const syncDeadline = Date.now() + 90_000;
    let synced = false;
    while (Date.now() < syncDeadline) {
      const nomB = await pageB.evaluate(async () => {
        if (!window.__legalosRecette) return null;
        return window.__legalosRecette.readCabinetNom();
      });
      if (nomB === newNom) {
        synced = true;
        break;
      }
      await sleep(500);
    }
    if (!synced) {
      fail("poste B n'a pas reçu la modification du cabinet");
    }

    console.log("j3-sync-two-postes: OK");
  } finally {
    await browser.close();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  preview.kill("SIGTERM");
}
