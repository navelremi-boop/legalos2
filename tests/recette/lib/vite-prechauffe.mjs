#!/usr/bin/env node
/**
 * `beforeDevCommand` de recette (hypothèse « course au démarrage de Vite » de la dette
 * « conflits-poste-tauri : instabilité au lancement »).
 *
 * Tauri lance l'application dès que `devUrl` (http://localhost:1420) répond. Ici, Vite écoute sur un
 * port interne ; on charge la page et tout le graphe de modules à partir du module d'entrée, on
 * attend que l'optimisation des dépendances soit finie, et seulement alors on ouvre le port 1420
 * (simple relais TCP vers Vite, WebSocket de rechargement à chaud compris). Tauri n'ouvre donc la
 * fenêtre qu'une fois le serveur chaud.
 *
 * Aucun rechargement de page n'est ajouté ici ni dans la recette. Les événements de réoptimisation
 * vus pendant le préchauffage sont comptés et affichés.
 *
 * Usage (par la recette, via `--config`) : node tests/recette/lib/vite-prechauffe.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const poste = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/poste");
const PORT_PUBLIC = 1420;
const PORT_INTERNE = 14200;
const base = `http://localhost:${PORT_INTERNE}`;
const debut = Date.now();

function journal(msg) {
  console.log(`[prechauffe] ${msg}`);
}

const require = createRequire(join(poste, "package.json"));
const viteBin = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");

const vite = spawn(process.execPath, [viteBin, "--port", String(PORT_INTERNE), "--strictPort"], {
  cwd: poste,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let dernierEvenementOptim = 0;
let reoptimisations = 0;
function surSortieVite(chunk) {
  const texte = chunk.toString();
  process.stdout.write(texte);
  if (/optimized dependencies changed|new dependencies optimized|reloading/i.test(texte)) {
    dernierEvenementOptim = Date.now();
    reoptimisations += 1;
  }
}
vite.stdout.on("data", surSortieVite);
vite.stderr.on("data", surSortieVite);

function arreterVite() {
  if (vite.pid === undefined || vite.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    vite.kill();
  }
}
vite.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGTERM", () => {
  arreterVite();
  process.exit(0);
});
process.on("SIGINT", () => {
  arreterVite();
  process.exit(0);
});
process.on("exit", arreterVite);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attendreVite(ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* pas encore */
    }
    await sleep(200);
  }
  throw new Error("Vite n'a pas répondu");
}

/** Imports d'un module servi par Vite : chemins absolus (`/src/…`, `/node_modules/.vite/deps/…`). */
function importsDe(texte) {
  const trouves = new Set();
  for (const m of texte.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\/[^"']+)["']/g)) trouves.add(m[1]);
  return trouves;
}

/** Charge la page puis, de proche en proche, tous les modules importés. */
async function parcourir(statuts) {
  const index = await fetch(`${base}/`);
  const html = await index.text();
  statuts.set("/", index.status);
  const file = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const planifies = new Set(file);
  while (file.length > 0 && statuts.size < 2000) {
    const lot = file.splice(0, 8);
    await Promise.all(
      lot.map(async (chemin) => {
        try {
          const res = await fetch(`${base}${chemin}`);
          statuts.set(chemin, res.status);
          const type = res.headers.get("content-type") ?? "";
          const texte = await res.text();
          if (res.ok && /javascript/.test(type)) {
            for (const suite of importsDe(texte)) {
              if (!planifies.has(suite)) {
                planifies.add(suite);
                file.push(suite);
              }
            }
          }
        } catch {
          statuts.set(chemin, 0);
        }
      }),
    );
  }
}

async function preChauffer() {
  await attendreVite(60_000);
  journal(`Vite répond sur ${base} après ${Date.now() - debut} ms`);
  let statuts = new Map();
  for (let tour = 1; tour <= 5; tour++) {
    const avant = reoptimisations;
    statuts = new Map();
    await parcourir(statuts);
    // Attend le calme de l'optimiseur : aucun événement depuis 2 s.
    while (Date.now() - dernierEvenementOptim < 2_000 && Date.now() - debut < 90_000) await sleep(250);
    const erreurs = [...statuts.values()].filter((s) => s !== 200).length;
    journal(`tour ${tour} : ${statuts.size} requêtes, ${erreurs} hors 200, ${reoptimisations - avant} événement(s) d'optimisation`);
    if (reoptimisations === avant && erreurs === 0) return statuts.size;
  }
  throw new Error("préchauffage non stabilisé après 5 tours");
}

function ouvrirPasserelle(hote) {
  return new Promise((resolve) => {
    const serveur = createServer((client) => {
      const amont = connect(PORT_INTERNE, "localhost");
      const fermer = () => {
        client.destroy();
        amont.destroy();
      };
      client.on("error", fermer);
      amont.on("error", fermer);
      client.on("close", fermer);
      amont.on("close", fermer);
      client.pipe(amont);
      amont.pipe(client);
    });
    serveur.on("error", () => resolve(false));
    serveur.listen(PORT_PUBLIC, hote, () => resolve(true));
  });
}

try {
  const n = await preChauffer();
  const v4 = await ouvrirPasserelle("127.0.0.1");
  const v6 = await ouvrirPasserelle("::1");
  if (!v4 && !v6) throw new Error(`port ${PORT_PUBLIC} indisponible`);
  journal(`serveur chaud (${n} requêtes, ${reoptimisations} événement(s) d'optimisation au total, ${Date.now() - debut} ms) : port ${PORT_PUBLIC} ouvert (IPv4 ${v4}, IPv6 ${v6})`);
} catch (err) {
  journal(`ÉCHEC : ${err.message}`);
  arreterVite();
  process.exit(1);
}
