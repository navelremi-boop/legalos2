#!/usr/bin/env node
/**
 * Un seul agent à la fois (consigne de l'architecte du 24/10/2026, ordre d'opération § 8).
 * Exécute réellement `scripts/agent-actif.mjs` dans un dépôt temporaire, avec ses essais négatifs, puis vérifie
 * que la règle est écrite aux trois endroits prévus, que le fichier est ignoré par git et que `loop_limit` vaut 10.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/agent-actif.mjs");
const erreurs = [];
const verifier = (condition, message) => {
  if (!condition) erreurs.push(message);
};

const dossier = mkdtempSync(join(tmpdir(), "legalos-agent-actif-"));
const fichier = join(dossier, ".mission", "agent-actif");
const heure = (decalageHeures) => new Date(Date.now() - decalageHeures * 3600_000).toISOString();
const poser = (outil, ilYaHeures) => {
  mkdirSync(join(dossier, ".mission"), { recursive: true });
  writeFileSync(fichier, `outil: ${outil}\nheure: ${heure(ilYaHeures)}\n`, "utf8");
};
const lancer = (...args) => {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, LEGALOS_RACINE: dossier },
  });
  return { code: r.status, sortie: `${r.stdout}${r.stderr}` };
};
const contenu = () => (existsSync(fichier) ? readFileSync(fichier, "utf8") : null);

try {
  // Début de session sans fichier : créé, avec l'outil et une heure lisible.
  let r = lancer("prendre", "cursor");
  verifier(r.code === 0, `prendre sans fichier : sortie ${r.code}`);
  verifier(/^outil: cursor\nheure: \d{4}-\d\d-\d\dT[\d:.]+Z\n$/.test(contenu() ?? ""), `contenu inattendu : ${contenu()}`);

  // Même outil : rafraîchi (relance du hook, nouvelle session du même outil).
  poser("cursor", 5);
  r = lancer("prendre", "cursor");
  verifier(r.code === 0, `prendre (même outil) : sortie ${r.code}`);
  verifier(Date.now() - Date.parse(/heure: (\S+)/.exec(contenu() ?? "")?.[1] ?? "") < 60_000, "heure non rafraîchie");

  // Essai négatif : autre outil, moins de 12 h → arrêt (sortie 3), fichier strictement inchangé.
  poser("claude-code", 11.9);
  const avant = contenu();
  r = lancer("prendre", "cursor");
  verifier(r.code === 3, `autre outil récent : sortie ${r.code} au lieu de 3`);
  verifier(contenu() === avant, "autre outil récent : le fichier a été modifié");
  verifier(/claude-code/.test(r.sortie) && /signale/.test(r.sortie), `message : ${r.sortie}`);

  // Essai négatif : l'autre outil récent ne peut pas libérer le fichier de son voisin.
  r = lancer("liberer", "cursor");
  verifier(r.code === 3 && contenu() === avant, "liberer par l'autre outil : fichier retiré ou sortie ≠ 3");

  // Autre outil, 12 h ou plus : périmé, remplacé.
  for (const heures of [12.1, 30]) {
    poser("claude-code", heures);
    r = lancer("prendre", "cursor");
    verifier(r.code === 0 && /^outil: cursor$/m.test(contenu() ?? ""), `fichier périmé (${heures} h) non remplacé`);
  }

  // Fichier illisible : ne bloque pas.
  mkdirSync(join(dossier, ".mission"), { recursive: true });
  writeFileSync(fichier, "n'importe quoi\n", "utf8");
  r = lancer("prendre", "claude-code");
  verifier(r.code === 0 && /^outil: claude-code$/m.test(contenu() ?? ""), "fichier illisible non remplacé");

  // Fin de session : le fichier est retiré par son propriétaire ; un second appel est sans effet.
  r = lancer("liberer", "claude-code");
  verifier(r.code === 0 && contenu() === null, "liberer : fichier encore présent");
  r = lancer("liberer", "claude-code");
  verifier(r.code === 0, `liberer sans fichier : sortie ${r.code}`);

  // Commande ou outil invalide.
  verifier(lancer("prendre", "").code === 1, "outil vide accepté");
  verifier(lancer("autre", "cursor").code === 1, "commande inconnue acceptée");
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

// La règle est écrite aux trois endroits prévus, et le fichier n'est jamais versionné.
const ecrit = (chemin) => readFileSync(join(root, chemin), "utf8").replace(/\r\n/g, "\n");
for (const chemin of ["docs/ordre-operation.md", "CLAUDE.md", ".cursor/rules/01-cursor.mdc"]) {
  const texte = ecrit(chemin);
  verifier(texte.includes(".mission/agent-actif"), `${chemin} : règle « un seul agent à la fois » absente`);
  verifier(/12 h/.test(texte), `${chemin} : durée de 12 h absente`);
}
verifier(/^\.mission\/agent-actif\s*$/m.test(ecrit(".gitignore")), ".gitignore : .mission/agent-actif non ignoré");
const suivis = spawnSync("git", ["ls-files", ".mission/agent-actif"], { cwd: root, encoding: "utf8" }).stdout.trim();
verifier(suivis === "", ".mission/agent-actif est suivi par git");

const limites = [...ecrit(".cursor/hooks.json").matchAll(/"loop_limit":\s*(\d+)/g)].map((m) => Number(m[1]));
verifier(limites.length > 0 && limites.every((n) => n === 10), `.cursor/hooks.json : loop_limit ${limites.join(", ")} au lieu de 10`);

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`agent-actif: FAIL — ${e}`);
  process.exit(1);
}
console.log("agent-actif: OK (prise, rafraîchissement, refus d'un autre outil récent, péremption à 12 h, libération, règle écrite, loop_limit 10)");
