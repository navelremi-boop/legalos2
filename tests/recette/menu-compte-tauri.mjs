#!/usr/bin/env node
/**
 * Coque claire — le menu du compte dans l'application Tauri (PLAN, jalon « Coque claire »).
 *
 * Application connectée : Temps, Réglages et Palette de commandes s'ouvrent depuis le menu ; la
 * navigation principale n'a que cinq entrées ; Se déconnecter ramène à l'écran de connexion.
 * Application relancée (coque locale hors ligne) : Verrouiller ramène à l'authentification sans
 * perdre les données locales.
 * Lancement par `ouvrirPoste` (relance unique sur la signature « #root vide »).
 *
 * Usage : node tests/recette/menu-compte-tauri.mjs
 */
import { demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep } from "./lib/poste-session.mjs";

const session = creerSession("menu-compte-tauri");
const { fail, ok, assurerInstance, evaluate, marque } = session;
const POSTE = "mca";
const PORT = "9281";
const NAVIGATION = ["journee", "dossiers", "mails", "agenda", "facturation"];

await assurerInstance();
session.resetPostes([POSTE]);

async function attendre(nom, expression, send, delaiMs = 15_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(200);
  }
  fail(`${nom} : condition non atteinte en ${delaiMs} ms (${expression.slice(0, 90)})`);
}

/** Ouvre le menu du compte (deux temps : le menu n'est dans le DOM qu'après le clic). */
async function ouvrirMenu(send) {
  await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
  await attendre("ouverture du menu", `Boolean(document.querySelector("[data-testid=menu-compte-liste]"))`, send, 5_000);
}

async function choisir(send, testid) {
  await ouvrirMenu(send);
  await evaluate(send, `document.querySelector(${JSON.stringify(`[data-testid=${testid}]`)})?.click()`);
  await attendre("fermeture du menu", `!document.querySelector("[data-testid=menu-compte-liste]")`, send, 5_000);
}

const formulaireConnexion = `Boolean(document.getElementById("instance-url") || document.getElementById("email") || document.getElementById("code-totp"))`;

// ——— application connectée ———
const creds = { email: demoEmail, password: demoPassword, secret: totpSecretB32, nomAppareil: `Menu compte ${marque}`, mode: "dev" };
{
  const { child, page } = await session.ouvrirPoste(POSTE, PORT, creds);
  try {
    const send = page.send;
    await attendre("menu du compte", `Boolean(document.querySelector("[data-testid=menu-compte]"))`, send);

    const nav = await evaluate(
      send,
      `JSON.stringify([...document.querySelectorAll("[data-testid^=nav-]")].map((e) => e.getAttribute("data-testid").replace("nav-", "")))`,
    );
    if (nav !== JSON.stringify(NAVIGATION)) fail(`navigation principale : ${nav} au lieu de ${JSON.stringify(NAVIGATION)}`);
    ok("navigation principale : cinq entrées (La journée, Dossiers, Mails, Agenda, Facturation)");

    await ouvrirMenu(send);
    const entrees = await evaluate(
      send,
      `JSON.stringify([...document.querySelectorAll("[data-testid=menu-compte-liste] [role=menuitem]")].map((e) => e.textContent.trim()))`,
    );
    const attendues = ["Temps", "Réglages", "Palette de commandes", "Verrouiller", "Se déconnecter"];
    // Hors build distribué, une entrée « Galerie (dev) » s'ajoute : elle n'est pas comptée.
    const reelles = JSON.parse(entrees).filter((e) => e !== "Galerie (dev)");
    if (JSON.stringify(reelles) !== JSON.stringify(attendues)) fail(`entrées du menu : ${entrees}`);
    await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
    await attendre("fermeture", `!document.querySelector("[data-testid=menu-compte-liste]")`, send, 5_000);
    ok("menu : Temps, Réglages, Palette de commandes, Verrouiller, Se déconnecter");

    // Temps : le panneau de saisie s'ouvre.
    await choisir(send, "menu-compte-temps");
    await attendre("panneau Temps", `Boolean(document.querySelector("[role=dialog] form, [role=dialog] input, [role=dialog] select"))`, send);
    await evaluate(send, `[...document.querySelectorAll("[role=dialog] button")].find((b) => /^Fermer$/.test(b.textContent.trim()))?.click()`);
    await attendre("fermeture du panneau Temps", `!document.querySelector("[role=dialog]")`, send, 5_000);
    ok("Temps s'ouvre depuis le menu");

    // Réglages : l'écran s'ouvre.
    await choisir(send, "menu-reglages");
    await attendre("écran Réglages", `Boolean(document.querySelector("[data-testid=ecran-reglages]"))`, send);
    ok("Réglages s'ouvre depuis le menu");

    // Palette de commandes.
    await choisir(send, "menu-compte-palette");
    await attendre("palette de commandes", `Boolean(document.querySelector("[role=dialog] input"))`, send);
    await evaluate(send, `[...document.querySelectorAll("[role=dialog] button")].find((b) => /^Fermer$/.test(b.textContent.trim()))?.click()`);
    await attendre("fermeture de la palette", `!document.querySelector("[role=dialog]")`, send, 5_000);
    ok("la Palette de commandes s'ouvre depuis le menu");

    // Se déconnecter : retour à l'écran de connexion.
    await choisir(send, "menu-compte-deconnexion");
    await attendre("écran de connexion après Se déconnecter", formulaireConnexion, send);
    ok("Se déconnecter ramène à l'écran de connexion");
  } finally {
    try {
      page.ws.close();
    } catch {
      /* déjà fermé */
    }
    await session.stopApp(child);
  }
}

// ——— application relancée : Verrouiller ———
{
  const child = session.startApp(POSTE, PORT, "dev");
  try {
    await session.waitCdp(child);
    const page = await session.connectCdp(child.port);
    const send = page.send;
    await attendre("coque locale après relancement", `Boolean(document.querySelector("[data-testid=menu-compte]"))`, send, 90_000);
    const avant = await evaluate(
      send,
      `(async () => { const r = await window.__legalosRecette?.lireSqlite("SELECT COUNT(*) AS n FROM cabinets"); return Number(r?.[0]?.n ?? -1); })()`,
    );
    if (!(avant >= 1)) fail(`données locales absentes avant Verrouiller (cabinets = ${avant})`);
    await choisir(send, "menu-compte-verrouiller");
    await attendre("authentification après Verrouiller", formulaireConnexion, send);
    const apres = await evaluate(
      send,
      `(async () => { const r = await window.__legalosRecette?.lireSqlite("SELECT COUNT(*) AS n FROM cabinets"); return Number(r?.[0]?.n ?? -1); })()`,
    );
    if (apres !== avant) fail(`les données locales ont changé après Verrouiller (${avant} → ${apres})`);
    ok("Verrouiller ramène à l'authentification, données locales conservées");
    page.ws.close();
  } finally {
    await session.stopApp(child);
  }
}

ok("OK — menu du compte dans l'application");
