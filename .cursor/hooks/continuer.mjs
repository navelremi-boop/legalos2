// Relance automatique de l'agent principal tant que la mission n'est pas terminée.
// Arrêt manuel : créer le fichier .mission/STOP à la racine du dépôt.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lireEntree, repondre } from './lib.mjs';

const lu = await lireEntree();
if (!lu.ok) {
  console.error(`hook continuer : ${lu.erreur}, pas de relance`);
  repondre({});
}
const entree = lu.valeur;
const racine = process.env.CURSOR_PROJECT_DIR || process.cwd();

// Pas de relance si l'utilisateur a interrompu l'agent ou en cas d'erreur.
if (String(entree.status ?? '').trim() !== 'completed') repondre({});

// Arrêt demandé, mission terminée ou bloquée : pas de relance.
for (const f of ['STOP', 'TERMINEE', 'BLOQUEE']) {
  if (existsSync(join(racine, '.mission', f))) repondre({});
}

const plan = join(racine, 'PLAN.md');
if (!existsSync(plan)) {
  repondre({ followup_message: "PLAN.md est absent. Exécute la phase 0 de docs/ordre-operation.md, puis poursuis la mission sans attendre de nouvelle instruction." });
}

const jalonOuvert = /^\s*[-*] \[ \]/m.test(readFileSync(plan, 'utf8'));
repondre({
  followup_message: jalonOuvert
    ? "Mission en cours. Relis docs/ordre-operation.md, PLAN.md, JOURNAL.md et BLOCAGES.md, puis reprends au premier jalon non coché. Ne conclus que dans les conditions du paragraphe 4.6."
    : "Tous les jalons sont cochés. Exécute la recette complète (S1 à S14a sur le poste, vérifie S14b en CI), fais valider par le contrôleur, rédige RAPPORT.md, puis crée .mission/TERMINEE comme prévu au paragraphe 4.6.",
});
