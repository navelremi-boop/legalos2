#!/usr/bin/env node
/**
 * Un seul agent à la fois (consigne de l'architecte du 24/10/2026, ordre d'opération § 8).
 *
 * `.mission/agent-actif` (ignoré par git) contient l'outil et l'heure de l'agent en session :
 *     outil: cursor
 *     heure: 2026-10-26T11:20:00.000Z
 *
 * Usage : node scripts/agent-actif.mjs <prendre|liberer|etat> <claude-code|cursor>
 *   prendre : début de session. Crée (ou rafraîchit) le fichier. Sortie 3, sans rien modifier, si le fichier existe,
 *             date de moins de 12 h et nomme un autre outil : l'agent s'arrête et le signale.
 *   liberer : fin de session, après l'entrée « État de session » de JOURNAL.md. Retire le fichier s'il nomme cet outil.
 *   etat    : affiche l'état, ne modifie rien.
 * Un fichier périmé (12 h ou plus) ou illisible ne bloque pas : il est remplacé.
 * Racine du dépôt : celle du script, ou `LEGALOS_RACINE` (essais).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VALIDITE_MS = 12 * 60 * 60 * 1000;
const OUTIL = /^[a-z][a-z0-9-]*$/;

/** `{ outil, heureMs }` d'un contenu de fichier, ou `null` s'il est illisible. */
export function lire(texte) {
  const outil = /^outil:\s*(\S+)\s*$/m.exec(texte)?.[1];
  const heure = /^heure:\s*(\S+)\s*$/m.exec(texte)?.[1];
  const heureMs = heure === undefined ? Number.NaN : Date.parse(heure);
  if (outil === undefined || !OUTIL.test(outil) || Number.isNaN(heureMs)) return null;
  return { outil, heureMs };
}

/**
 * Décision de début de session : `libre`, `rafraichir` (même outil), `perime`, `illisible` ou `occupe`.
 * `contenu` vaut `null` si le fichier n'existe pas.
 */
export function decider(contenu, outil, maintenantMs) {
  if (contenu === null) return "libre";
  const etat = lire(contenu);
  if (etat === null) return "illisible";
  if (etat.outil === outil) return "rafraichir";
  // Une heure dans le futur (horloge décalée) compte comme récente : mieux vaut s'arrêter à tort.
  return maintenantMs - etat.heureMs < VALIDITE_MS ? "occupe" : "perime";
}

function contenuPour(outil, maintenantMs) {
  return `outil: ${outil}\nheure: ${new Date(maintenantMs).toISOString()}\n`;
}

/** Exécute une commande dans `racine` ; retourne `{ code, message }`. */
export function executer(commande, outil, racine, maintenantMs = Date.now()) {
  const dossier = join(racine, ".mission");
  const chemin = join(dossier, "agent-actif");
  const contenu = existsSync(chemin) ? readFileSync(chemin, "utf8") : null;
  const etat = contenu === null ? null : lire(contenu);

  if (commande === "etat") {
    if (contenu === null) return { code: 0, message: "agent-actif: aucun agent actif" };
    if (etat === null) return { code: 0, message: "agent-actif: fichier illisible" };
    return { code: 0, message: `agent-actif: ${etat.outil} depuis ${new Date(etat.heureMs).toISOString()}` };
  }

  if (commande === "prendre") {
    const decision = decider(contenu, outil, maintenantMs);
    if (decision === "occupe") {
      return {
        code: 3,
        message:
          `agent-actif: ${etat.outil} est actif depuis ${new Date(etat.heureMs).toISOString()} (moins de 12 h). ` +
          "Arrête-toi et signale-le au commandement, sans rien modifier.",
      };
    }
    mkdirSync(dossier, { recursive: true });
    writeFileSync(chemin, contenuPour(outil, maintenantMs), "utf8");
    return { code: 0, message: `agent-actif: ${outil} pris (${decision})` };
  }

  if (commande === "liberer") {
    if (contenu === null) return { code: 0, message: "agent-actif: déjà libre" };
    if (etat !== null && etat.outil !== outil) {
      return { code: 3, message: `agent-actif: le fichier nomme ${etat.outil}, laissé en place` };
    }
    rmSync(chemin);
    return { code: 0, message: `agent-actif: ${outil} libéré` };
  }

  return { code: 1, message: `agent-actif: commande inconnue « ${commande} » (prendre, liberer, etat)` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [commande = "", outil = ""] = process.argv.slice(2);
  if (commande !== "etat" && !OUTIL.test(outil)) {
    console.error("usage: node scripts/agent-actif.mjs <prendre|liberer|etat> <claude-code|cursor>");
    process.exit(1);
  }
  const racine = process.env.LEGALOS_RACINE ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const { code, message } = executer(commande, outil, racine);
  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}
