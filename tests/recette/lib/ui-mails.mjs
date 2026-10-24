/**
 * Aides des recettes qui pilotent l'écran Mails de l'app Tauri par le DOM (CDP) : évaluation dans la page, clics,
 * saisie dans un champ React, frappe au clavier, dépôt de fichiers, captures, attentes et essais négatifs.
 *
 * Reprises à l'identique de `j11-redaction.mjs` (qui garde les siennes, inchangées). Le poste courant change quand
 * une recette ouvre un second poste : `creerUi` reçoit donc une fonction qui rend le `send` CDP du poste actif.
 * Ne journalise aucun secret ni contenu : les messages d'échec nomment la vérification.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "./poste-session.mjs";

export const FORM = "[data-testid=mails-redaction]";
export const MO = 1024 * 1024;

/** Espaces insécables et fines insécables ramenés à une espace, apostrophes typographiques à l'apostrophe droite. */
export const norm = (texte) => String(texte).replace(/[  ]/gu, " ").replace(/’/gu, "'");
/** Littéral SQL. */
export const lit = (texte) => `'${String(texte).replaceAll("'", "''")}'`;
/** Vrai si les morceaux se suivent dans le texte, dans cet ordre. */
export const ordre = (texte, ...morceaux) => {
  const positions = morceaux.map((m) => texte.indexOf(m));
  return positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || positions[i - 1] < p);
};
export const occurrences = (texte, motif) => texte.split(motif).length - 1;

/**
 * @param {{ getSend: () => Function, fail: (message: string) => never, dossierCaptures: string }} options
 */
export function creerUi({ getSend, fail, dossierCaptures }) {
  /**
   * Commande CDP bornée à 60 s : sans réponse, la recette échoue en nommant la commande au lieu de rester suspendue
   * (blocages de j11-connexion-boites des 22 et 24/10/2026 : aucun message, processus vivant, page muette).
   */
  const send = (...args) => {
    let minuteur;
    const delai = new Promise((_, rejeter) => {
      minuteur = setTimeout(() => {
        rejeter(new Error(`cdp sans réponse en 60 s (${String(args[0])})`));
      }, 60_000);
    });
    return Promise.race([getSend()(...args), delai]).finally(() => {
      clearTimeout(minuteur);
    });
  };

  /** Évalue dans la page ; une exception remonte avec sa description. */
  const js = async (expr) => {
    const msg = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    const err = msg.result?.exceptionDetails;
    if (err) throw new Error(String(err.exception?.description ?? err.text ?? "évaluation").slice(0, 400));
    return msg.result?.result?.value;
  };
  const cliquer = (sel) =>
    js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
  const texteDe = async (sel) => String((await js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`)) ?? "");
  const present = (sel) => js(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
  const compter = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const sqliteLocal = (sql) => js(`window.__legalosRecette.lireSqlite(${JSON.stringify(sql)})`);
  const htmlCorps = () => js(`document.querySelector("[data-testid=redac-corps]")?.innerHTML ?? ""`);
  const htmlDe = async (sel) => String((await js(`document.querySelector(${JSON.stringify(sel)})?.innerHTML ?? null`)) ?? "");
  const idBrouillon = () => js(`document.querySelector(${JSON.stringify(FORM)})?.getAttribute("data-brouillon-id") ?? null`);
  const desactive = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.disabled ?? null`);
  const valeurDe = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);

  /** Saisit dans un champ texte contrôlé par React (valeur native puis événement input). */
  const saisir = (sel, valeur) =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(valeur)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  /** Choisit une option d'une liste contrôlée par React (valeur native puis événement change). */
  const choisirOption = (sel, valeur) =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(valeur)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === ${JSON.stringify(valeur)};
    })()`);

  const taper = async (texte) => {
    await send("Input.insertText", { text: texte });
  };
  const touche = async (key, code, vk, texte) => {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(texte ? { text: texte } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const entree = () => touche("Enter", "Enter", 13, "\r");
  const focusCorps = () => js(`document.querySelector("[data-testid=redac-corps]").focus()`);

  /** Place le curseur à la fin du corps de la rédaction. */
  const curseurFinCorps = () =>
    js(`(() => { const el = document.querySelector("[data-testid=redac-corps]"); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);

  /** Dépose des fichiers sur la rédaction (événements dragenter, dragover, drop). */
  const deposer = (fichiers) =>
    js(`(() => {
      const dt = new DataTransfer();
      for (const f of ${JSON.stringify(fichiers)}) {
        const octets = f.texte !== undefined ? new TextEncoder().encode(f.texte) : new Uint8Array(f.taille);
        dt.items.add(new File([octets], f.nom, { type: f.type ?? "application/octet-stream" }));
      }
      const form = document.querySelector(${JSON.stringify(FORM)});
      const ev = (type) => form.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      ev("dragenter"); ev("dragover"); ev("drop");
      return true;
    })()`);

  async function capturer(nom, theme) {
    mkdirSync(dossierCaptures, { recursive: true });
    await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const capture = await send("Page.captureScreenshot", { format: "png" });
    const donnees = capture.result?.data;
    if (donnees) writeFileSync(join(dossierCaptures, nom), Buffer.from(donnees, "base64"));
    await send("Emulation.clearDeviceMetricsOverride");
    await js(`document.documentElement.dataset.theme = "light"`);
  }

  async function attendre(description, lire, predicat, delai = 60_000) {
    const debut = Date.now();
    let dernier;
    while (Date.now() - debut < delai) {
      try {
        dernier = await lire();
        if (predicat(dernier)) return dernier;
      } catch (err) {
        dernier = err instanceof Error ? err.message : String(err);
      }
      await sleep(400);
    }
    return fail(`${description} : délai dépassé (dernière valeur ${JSON.stringify(dernier)})`);
  }

  function verifier(nom, condition, detail = "") {
    if (!condition) fail(`${nom}${detail === "" ? "" : ` — ${detail}`}`);
  }
  /** Essai négatif : la condition passée doit être fausse, sinon la vérification qu'elle double est muette. */
  function essaiNegatif(nom, condition) {
    if (condition) fail(`essai négatif muet : ${nom}`);
  }

  return {
    send,
    js,
    cliquer,
    texteDe,
    present,
    compter,
    sqliteLocal,
    htmlCorps,
    htmlDe,
    idBrouillon,
    desactive,
    valeurDe,
    saisir,
    choisirOption,
    taper,
    touche,
    entree,
    focusCorps,
    curseurFinCorps,
    deposer,
    capturer,
    attendre,
    verifier,
    essaiNegatif,
  };
}
