// Bloque les commandes destructrices ou irréversibles pendant les longues exécutions autonomes.
// Couvre PowerShell, cmd et bash.
import { autoriser, commandeDe, lireEntree, racinesDe, refuser, refuserIllisible } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  refuserIllisible(
    `Commande refusée par garde-commandes : entrée illisible (${lu.erreur}).`,
    "Le garde n'a pas pu lire l'entrée de la commande. Refuse par sécurité (fail-closed).",
  );
}

const c = commandeDe(lu.valeur);

const racineDisque = String.raw`["']?(?:[A-Za-z]:[\\/]?|~|\$HOME|\$env:USERPROFILE|%USERPROFILE%)["']?(?:\s|$)`;
const interdits = [
  [/git\s+push\b.*(--force\b|--force-with-lease|\s-f\b)/i, "push forcé"],
  [/git\s+push\b.*(--tags\b|\sv\d)/i, "push de tag de version"],
  [/git\s+push\b.*--delete\b/i, "suppression de branche distante"],
  [/git\s+filter-(branch|repo)\b/i, "réécriture de l'historique"],
  [new RegExp(String.raw`\brm\s+-[a-z]*r[a-z]*\s+(?:/|~|\$HOME)(?:\s|/?$)`, "i"), "suppression récursive hors du projet"],
  [new RegExp(String.raw`Remove-Item\b(?=.*-Recurse)[^|;]*\s` + racineDisque, "i"), "suppression récursive hors du projet"],
  [new RegExp(String.raw`\b(?:rd|rmdir)\s+/s\b[^|;&]*\s` + racineDisque, "i"), "suppression récursive hors du projet"],
  [/\bformat(?:\.com)?\s+[A-Za-z]:/i, "formatage de disque"],
  [/\b(diskpart|shutdown|Restart-Computer|Stop-Computer)\b/i, "opération système"],
  [/\breg(?:\.exe)?\s+delete\s+HK(?:LM|EY_LOCAL_MACHINE)/i, "modification du registre système"],
  [/(^|[\s;&|])sudo\s/i, "élévation de privilèges"],
  [/Start-Process\b.*-Verb\s+RunAs/i, "élévation de privilèges"],
  [/\bwsl(?:\.exe)?\s+--unregister\b/i, "suppression de distribution WSL"],
  [/docker\s+system\s+prune\b(?=.*(\s-a\b|--all))(?=.*--volumes)/i, "purge complète de Docker"],
];

for (const [motif, raison] of interdits) {
  if (motif.test(c)) {
    refuser(lu.valeur, `Commande bloquée par garde-commandes : ${raison}.`,
      "Commande interdite par l'ordre d'opération (paragraphe 5) ou dangereuse pour le poste. Trouve une autre méthode ; si une action administrateur est indispensable, passe par BLOCAGES.md.");
  }
}

// Politique de push autonome (décision de l'architecte du 10/10/2026) : le garde refuse, quelle que soit la place
// de `git` dans la commande (options globales `-C`, `-c`, enchaînements), les formes qui contourneraient le hook
// pre-push ou la revue du commandement : --no-verify, -f / --force*, +refspec, --delete, --tags, tout refspec
// contenant « : », et toute modification de core.hooksPath. Les options longues sont reconnues par préfixe
// (git accepte `--no-ver`, `--forc`, `--dele`).
const OPTIONS_PUSH_AVEC_VALEUR = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const OPTIONS_GIT_AVEC_VALEUR = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path", "--super-prefix"]);
const LECTURE_CONFIG = /^--(get|get-all|get-regexp|get-urlmatch|list|show-origin|show-scope|name-only)$|^-l$/;

function motsDe(segment) {
  return segment
    .trim()
    .split(/\s+/)
    .map((mot) => mot.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

/** Raison du refus pour un segment de commande, ou null. */
function raisonGit(segment) {
  const mots = motsDe(segment);
  const debut = mots.findIndex((mot) => /^(?:.*[\\/])?git(?:\.exe)?$/i.test(mot));
  if (debut >= 0) {
    let k = debut + 1;
    while (k < mots.length && mots[k].startsWith("-")) {
      const [nom, valeurEgale] = mots[k].split(/=(.*)/s);
      let valeur = valeurEgale;
      if (valeur === undefined && OPTIONS_GIT_AVEC_VALEUR.has(nom)) {
        k += 1;
        valeur = mots[k] ?? "";
      }
      if ((nom === "-c" || nom === "--config-env") && /hookspath/i.test(valeur ?? "")) return "modification de core.hooksPath";
      k += 1;
    }
    const sousCommande = mots[k];
    const args = mots.slice(k + 1);
    if (sousCommande === "push") {
      let positionnel = 0;
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg.startsWith("--")) {
          const nom = arg.split("=")[0];
          if (/^--no-v/.test(nom)) return "push sans le hook pre-push (--no-verify)";
          if (/^--for/.test(nom)) return "push forcé";
          if (/^--ta/.test(nom)) return "push de tag";
          if (/^--de/.test(nom)) return "suppression de branche distante";
          if (/^--(mi|prune)/.test(nom)) return "push miroir ou avec élagage (suppressions distantes)";
          if (OPTIONS_PUSH_AVEC_VALEUR.has(nom) && !arg.includes("=")) i += 1;
        } else if (arg.startsWith("-") && arg.length > 1) {
          if (/f/.test(arg)) return "push forcé (-f)";
          if (OPTIONS_PUSH_AVEC_VALEUR.has(arg)) i += 1;
        } else {
          positionnel += 1;
          if (arg.startsWith("+")) return "push forcé (refspec +)";
          const adresse = /^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || /^[\w.-]+@[\w.-]+:/.test(arg) || /^[A-Za-z]:[\\/]/.test(arg);
          if (arg.includes(":") && !(positionnel === 1 && adresse)) return "refspec contenant « : » (suppression ou renommage distant)";
        }
      }
    }
    if (sousCommande === "config" && args.some((a) => /hookspath/i.test(a) || a === "-e" || a === "--edit")) {
      const edition = args.some((a) => a === "-e" || a === "--edit");
      const lecture = args.some((a) => LECTURE_CONFIG.test(a));
      const positionnels = args.filter((a) => !a.startsWith("-"));
      const cle = positionnels.findIndex((a) => /hookspath/i.test(a));
      const ecriture = args.some((a) => /^--(unset|unset-all|add|replace-all|rename-section|remove-section)$/.test(a)) || (cle >= 0 && cle + 1 < positionnels.length && !lecture);
      if (edition || ecriture) return "modification de core.hooksPath ou édition de la configuration git";
    }
  }
  // Autres moyens de poser core.hooksPath : variables GIT_CONFIG_*, écriture directe dans la configuration.
  if (/hookspath/i.test(segment)) {
    const variable = /GIT_CONFIG_(KEY|COUNT|PARAMETERS)/i.test(segment);
    const ecritureDirecte = /\.git[\\/]config|\.gitconfig/i.test(segment) && /(>>?|\bsed\b.*\s-i|Set-Content|Add-Content|Out-File|\btee\b)/i.test(segment);
    if (variable || ecritureDirecte) return "modification de core.hooksPath";
  }
  return null;
}

for (const segment of c.split(/;|&&|\|\||&|\||\r?\n/)) {
  const raison = raisonGit(segment);
  if (raison) {
    refuser(lu.valeur, `Commande bloquée par garde-commandes : ${raison}.`,
      "Politique de push autonome (décision de l'architecte du 10/10/2026) : pas de contournement du hook pre-push, pas de push forcé, de tag ni de suppression, pas de modification de core.hooksPath. Le commandement relit et pousse ce qui touche le jeu protégé.");
  }
}

// Worktrees des sous-agents : uniquement sous .worktrees/ à la racine du dépôt (ordre d'opération § 4.3).
const racines = racinesDe(lu.valeur)
  .map((racine) => normaliser(String(racine)).replace(/\/+$/, ""));

function normaliser(chemin) {
  return chemin
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\/([A-Za-z]:)/, "$1")
    .toLowerCase();
}

function worktreeAutorise(chemin) {
  const net = normaliser(chemin);
  if (/^(\.\/)?\.worktrees\/[^/]/.test(net)) return true;
  return racines.some((racine) => net.startsWith(`${racine}/.worktrees/`));
}

const optionsAvecValeur = new Set(["-b", "-B", "--reason"]);
for (const segment of c.split(/;|&&|\|\||&|\||\r?\n/)) {
  const mots = segment.trim().split(/\s+/);
  const i = mots.findIndex(
    (mot, k) => /^git(\.exe)?$/i.test(mot) && mots[k + 1] === "worktree" && mots[k + 2] === "add",
  );
  if (i < 0) continue;
  let chemin = null;
  for (let k = i + 3; k < mots.length; k += 1) {
    if (optionsAvecValeur.has(mots[k])) {
      k += 1;
    } else if (!mots[k].startsWith("-")) {
      chemin = mots[k];
      break;
    }
  }
  if (!chemin || !worktreeAutorise(chemin)) {
    refuser(lu.valeur, "Commande bloquée par garde-commandes : worktree hors de .worktrees/.",
      "Les worktrees des sous-agents se créent dans le dossier du projet : git worktree add .worktrees/<lot> -b lot/<nom> (ordre d'opération § 4.3).");
  }
}
autoriser(lu.valeur);
