/**
 * Lancement de l'application par les recettes : diagnostic d'un échec et relance unique.
 *
 * Dette « conflits-poste-tauri : instabilité au lancement » (décision de l'architecte du 10/10/2026) :
 * une recette qui lance l'application relance le lancement UNE fois, seulement quand l'échec porte la
 * signature « #root vide, sans erreur JavaScript, Vite répond ». La relance est journalisée et comptée ;
 * la recette échoue à partir de deux relances par exécution. Aucun autre échec n'est relancé.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const MAX_RELANCES = 2;

/**
 * Signature de l'instabilité connue : page sans application montée (`#root` sans enfant), aucune
 * erreur JavaScript, du journal du navigateur ou du réseau, et Vite qui répond (page et module
 * d'entrée en 200). Sans serveur Vite (mode build), il n'y a pas de signature : aucune relance.
 */
export function estSignatureRootVide({ racine, erreurs, viteRepond, modeBuild = false }) {
  if (modeBuild) return false;
  return racine === 0 && Array.isArray(erreurs) && erreurs.length === 0 && viteRepond === true;
}

/** Erreur de lancement portant la signature : seule celle-ci peut être relancée. */
export class EchecLancement extends Error {
  constructor(message, { signatureRootVide = false } = {}) {
    super(message);
    this.name = "EchecLancement";
    this.signatureRootVide = signatureRootVide;
  }
}

/**
 * Relance unique d'un lancement. `essai` lance l'application jusqu'à l'écran voulu et lève une
 * `EchecLancement`. Retourne `{ valeur, relances }`. Le compteur est partagé par toute l'exécution.
 */
export function creerRelanceUnique({ journal = console.log, etiquette = "recette" } = {}) {
  let relances = 0;
  return {
    get relances() {
      return relances;
    },
    async lancer(nom, essai) {
      for (;;) {
        try {
          return await essai();
        } catch (err) {
          if (!(err instanceof EchecLancement) || !err.signatureRootVide) throw err;
          relances += 1;
          journal(
            `${etiquette}: RELANCE ${relances}/${MAX_RELANCES - 1} (${nom}) — signature « #root vide, sans erreur JavaScript, Vite répond »`,
          );
          if (relances >= MAX_RELANCES) {
            throw new Error(
              `${relances} relances de lancement dans la même exécution (maximum ${MAX_RELANCES - 1}) : ${err.message}`,
            );
          }
        }
      }
    },
  };
}

/**
 * Collecte des événements CDP utiles au diagnostic (exceptions JS, console.error, journal du
 * navigateur, réponses réseau en échec). Le 404 de favicon.ico est du bruit.
 */
export function creerCollecteur() {
  const erreurs = [];
  const requetes = new Map();
  return {
    erreurs,
    /** À appeler pour chaque message CDP sans `id`. */
    traiter(msg) {
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        erreurs.push(`exception: ${d?.exception?.description ?? d?.text ?? "?"}`.slice(0, 400));
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        erreurs.push(
          `console.error: ${(msg.params.args ?? []).map((a) => a.value ?? a.description ?? "?").join(" ")}`.slice(0, 400),
        );
      } else if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
        // Échec de chargement d'un module (504, réseau) : journal du navigateur, pas d'exception JS.
        const e = msg.params.entry;
        erreurs.push(`log error: ${e.text} ${e.url ?? ""}`.slice(0, 400));
      } else if (msg.method === "Network.requestWillBeSent") {
        if (requetes.size < 600) requetes.set(msg.params.requestId, msg.params.request?.url ?? "?");
      } else if (msg.method === "Network.responseReceived") {
        const r = msg.params.response;
        if (r && r.status >= 400) erreurs.push(`réseau ${r.status} ${r.url}`.slice(0, 400));
      } else if (msg.method === "Network.loadingFailed") {
        const url = requetes.get(msg.params.requestId) ?? msg.params.requestId;
        erreurs.push(`réseau échec ${url} : ${msg.params.errorText ?? "?"}`.slice(0, 400));
      } else {
        return;
      }
      if (erreurs.length > 0 && /favicon\.ico/.test(erreurs[erreurs.length - 1])) erreurs.pop();
      if (erreurs.length > 16) erreurs.shift();
    },
  };
}

/** Active les domaines CDP dont le collecteur a besoin. */
export async function activerDiagnostic(send) {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Diagnostic d'un écran absent : état de la page, requêtes du module d'entrée, état de Vite, journal
 * de Vite, version de WebView2, capture d'écran, processus et ports. Retourne le texte (une ligne)
 * et la signature.
 *
 * @param {{ send: Function, evaluer: Function, child: any, collecteur: ReturnType<typeof creerCollecteur>, dossierCaptures: string, marque: string, modeBuild?: boolean }} p
 */
export async function diagnosticLancement({ send, evaluer, child, collecteur, dossierCaptures, marque, modeBuild = false }) {
  const lire = async (expression) => {
    try {
      return await evaluer(send, expression);
    } catch (err) {
      return `illisible (${err.message})`;
    }
  };
  const pageBrute = await lire(
    `JSON.stringify({ href: location.href, etat: document.readyState, html: document.documentElement.outerHTML.length, racine: document.getElementById("root")?.childElementCount ?? null, scripts: [...document.scripts].map((s) => s.src.replace(location.origin, "") + (s.type ? " (" + s.type + ")" : "")) })`,
  );
  let page = {};
  try {
    page = JSON.parse(pageBrute);
  } catch {
    page = {};
  }
  // Requêtes de la page vues par le navigateur, y compris celles d'avant la connexion CDP.
  const requetes = await lire(
    `JSON.stringify((() => {
      const toutes = performance.getEntriesByType("resource");
      const gardees = toutes.filter((e) => /\\/src\\/main\\.tsx|@vite\\/client|@react-refresh|\\.vite\\/deps\\//.test(e.name));
      return {
        total: toutes.length,
        horsSucces: toutes.filter((e) => !(e.responseStatus >= 200 && e.responseStatus < 400)).length,
        entree: gardees.slice(0, 12).map((e) => e.name.replace(location.origin, "").slice(0, 80) + " " + e.responseStatus + " " + Math.round(e.duration) + "ms"),
      };
    })())`,
  );
  const cibles = await fetch(`http://127.0.0.1:${child.port}/json`)
    .then((r) => r.json())
    .then((l) => l.map((t) => `${t.type}:${t.url}`).join(" | "))
    .catch((err) => `illisible (${err.message})`);
  const navigateur = await fetch(`http://127.0.0.1:${child.port}/json/version`)
    .then((r) => r.json())
    .then((v) => `${v.Browser ?? "?"} / ${v["Protocol-Version"] ?? "?"}`)
    .catch((err) => `illisible (${err.message})`);
  // Vite répond-il au moment de l'échec ? (page et module d'entrée, depuis le poste de recette)
  let viteRepond = false;
  let vite = "sans serveur Vite (mode build)";
  if (!modeBuild) {
    const sonde = async (chemin) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`http://localhost:1420${chemin}`, { signal: AbortSignal.timeout(5_000) });
        await res.text();
        return { ok: res.status === 200, texte: `${chemin} ${res.status} ${Date.now() - t0}ms` };
      } catch (err) {
        return { ok: false, texte: `${chemin} ${err.name} ${Date.now() - t0}ms` };
      }
    };
    const [a, b] = [await sonde("/"), await sonde("/src/main.tsx")];
    viteRepond = a.ok && b.ok;
    vite = `${a.texte} ; ${b.texte}`;
  }
  let capture = "aucune";
  try {
    const msg = await Promise.race([
      send("Page.captureScreenshot", { format: "png" }),
      sleep(10_000).then(() => {
        throw new Error("délai");
      }),
    ]);
    const donnees = msg.result?.data;
    if (donnees) {
      capture = join(dossierCaptures, `legalos-echec-${marque}-${child.port}-${Date.now()}.png`);
      writeFileSync(capture, Buffer.from(donnees, "base64"));
    }
  } catch (err) {
    capture = `impossible (${err.message})`;
  }
  const processus = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'legal-os-poste.exe','msedgewebview2.exe','node.exe' -and $_.CommandLine -match 'legalos|legal-os|tauri|vite' } | ForEach-Object { "$($_.Name) pid=$($_.ProcessId) parent=$($_.ParentProcessId)" }; Get-NetTCPConnection -State Listen -LocalPort 1420,9252,9253,9254 -ErrorAction SilentlyContinue | ForEach-Object { "écoute $($_.LocalPort) pid=$($_.OwningProcess)" }`,
    ],
    { encoding: "utf8" },
  )
    .stdout.trim()
    .replace(/\r?\n/g, " ; ");
  const erreurs = collecteur?.erreurs ?? [];
  const texte = [
    `page=${pageBrute}`,
    `requetes=${requetes}`,
    `erreurs=[${erreurs.join(" | ")}]`,
    `vite=[${vite}]`,
    `webview2=${navigateur}`,
    `capture=${capture}`,
    `journalVite=[${child.logVite ? child.logVite(2500) : ""}]`,
    `cibles=[${cibles}]`,
    `processus=[${processus}]`,
  ].join(" ");
  const signature = estSignatureRootVide({ racine: page.racine, erreurs, viteRepond, modeBuild });
  return { texte, signature };
}
