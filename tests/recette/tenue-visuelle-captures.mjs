#!/usr/bin/env node
/**
 * Captures Tenue visuelle : jour et nuit, 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440,
 * pour Dossiers, un dossier, Mails, Agenda, La journée, Temps et Réglages.
 * Usage : node tests/recette/tenue-visuelle-captures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep } from "./lib/poste-session.mjs";

const TAILLES = [
  { largeur: 1366, hauteur: 768 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1440 },
];
const THEMES = [
  { valeur: "light", nom: "jour" },
  { valeur: "dark", nom: "nuit" },
];
const ECRANS = [
  { id: "dossiers", nav: "nav-dossiers", testid: "ecran-dossiers" },
  { id: "dossier", nav: "nav-dossiers", testid: "ecran-dossier", ouvrir: true },
  { id: "mails", nav: "nav-mails", testid: "ecran-mails" },
  { id: "agenda", nav: "nav-agenda", testid: "ecran-agenda" },
  { id: "journee", nav: "nav-journee", testid: "ecran-journee" },
  { id: "temps", menu: "menu-compte-temps", testid: "ecran-temps" },
  { id: "reglages", menu: "menu-reglages", testid: "ecran-reglages" },
];

const session = creerSession("tenue-captures");
const { fail, ok, evaluate, setField } = session;
const dossier = join(session.root, "design", "captures", "tenue");
mkdirSync(dossier, { recursive: true });

function dimensions(octets) {
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

const creds = {
  email: demoEmail,
  password: demoPassword,
  secret: totpSecretB32,
  nomAppareil: `Captures tenue ${session.marque}`,
  mode: "dev",
};
const { child, page } = await session.ouvrirPoste("tvu", "9297", creds);
const send = page.send;

async function attendre(nom, expression, delaiMs = 20_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(200);
  }
  fail(`${nom} : condition non atteinte`);
}

async function vue(largeur, hauteur) {
  const reponse = await send("Emulation.setDeviceMetricsOverride", {
    width: largeur,
    height: hauteur,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (reponse.error) fail(`vue ${largeur} : ${reponse.error.message ?? "refus"}`);
}

async function theme(valeur) {
  await evaluate(
    send,
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );
  await sleep(200);
  const deja = await evaluate(send, `Boolean(document.getElementById("theme") && document.getElementById("theme").offsetParent)`);
  if (!deja) {
    await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
    await attendre("menu", `Boolean(document.querySelector("[data-testid=menu-reglages]"))`, 5_000);
    await evaluate(send, `document.querySelector("[data-testid=menu-reglages]")?.click()`);
    await evaluate(send, `document.querySelector("[data-testid=reglages-section-apparence]")?.click()`);
  }
  await attendre("thème", `Boolean(document.getElementById("theme"))`);
  await setField(send, "theme", valeur);
  await attendre(
    `thème ${valeur}`,
    `document.documentElement.dataset.theme === ${JSON.stringify(valeur === "dark" ? "dark" : "light")}`,
  );
}

async function aller(ecran) {
  if (ecran.menu) {
    await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
    await attendre(ecran.menu, `Boolean(document.querySelector("[data-testid=${ecran.menu}]"))`, 5_000);
    await evaluate(send, `document.querySelector("[data-testid=${ecran.menu}]")?.click()`);
  } else {
    await evaluate(send, `document.querySelector("[data-testid=${ecran.nav}]")?.click()`);
  }
  if (ecran.ouvrir) {
    await attendre("liste", `Boolean(document.querySelector("[data-testid=liste-dossier]"))`);
    await evaluate(
      send,
      `(() => {
        const lignes = [...document.querySelectorAll("[data-testid=liste-dossier]")];
        const tenue = lignes.find((ligne) => (ligne.textContent || "").includes("Tenue"));
        (tenue ?? lignes[0])?.click();
        return true;
      })()`,
    );
  }
  await attendre(ecran.id, `Boolean(document.querySelector("[data-testid=${ecran.testid}]"))`);
  await sleep(300);
}

async function capturer(chemin) {
  const reponse = await send("Page.captureScreenshot", { format: "png" });
  if (!reponse.result?.data) fail(`capture absente (${chemin})`);
  const octets = Buffer.from(reponse.result.data, "base64");
  writeFileSync(chemin, octets);
  return dimensions(octets);
}

try {
  let n = 0;
  for (const taille of TAILLES) {
    await vue(taille.largeur, taille.hauteur);
    for (const mode of THEMES) {
      await theme(mode.valeur);
      for (const ecran of ECRANS) {
        await aller(ecran);
        const nom = `${ecran.id}-${taille.largeur}x${taille.hauteur}-${mode.nom}.png`;
        const mesure = await capturer(join(dossier, nom));
        if (mesure.largeur < taille.largeur - 40 || mesure.hauteur < taille.hauteur - 80) {
          fail(`${nom} trop petit (${mesure.largeur}×${mesure.hauteur})`);
        }
        n += 1;
        ok(`${nom} ${mesure.largeur}×${mesure.hauteur}`);
      }
    }
  }
  if (n !== TAILLES.length * THEMES.length * ECRANS.length) fail(`captures ${n}`);
  console.log("tenue-visuelle-captures: OK");
} finally {
  try {
    page.ws.close();
  } catch {
    /* déjà fermé */
  }
  await session.stopApp(child);
  session.fermer();
}
