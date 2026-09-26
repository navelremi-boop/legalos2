// Bloque les commandes destructrices ou irréversibles pendant les longues exécutions autonomes.
// Couvre PowerShell, cmd et bash.
import { lireEntree, repondre } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  repondre({
    permission: "deny",
    user_message: `Commande refusée par garde-commandes : entrée illisible (${lu.erreur}).`,
    agent_message:
      "Le garde n'a pas pu lire l'entrée de la commande. Refuse par sécurité (fail-closed).",
  });
}

const c = String(lu.valeur.command || "");

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
    repondre({
      permission: "deny",
      user_message: `Commande bloquée par garde-commandes : ${raison}.`,
      agent_message:
        "Commande interdite par l'ordre d'opération (paragraphe 5) ou dangereuse pour le poste. Trouve une autre méthode ; si une action administrateur est indispensable, passe par BLOCAGES.md.",
    });
  }
}
repondre({ permission: "allow" });
