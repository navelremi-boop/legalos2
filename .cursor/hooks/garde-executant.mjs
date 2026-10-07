// Garde du sous-agent executant (Claude Code) : ni git push ni git commit, ni autre écriture d'historique.
// L'agent principal commite ; l'exécutant ne fait que modifier des fichiers et lancer des tests.
import { autoriser, commandeDe, lireEntree, refuser, refuserIllisible } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  refuserIllisible(`Commande refusée par garde-executant : entrée illisible (${lu.erreur}).`);
}

const c = commandeDe(lu.valeur);
// git [options] <sous-commande> : les options globales (-C <dir>, -c k=v, --no-pager…) précèdent la sous-commande.
const interdit = /(?:^|[\s;&|(])git(?:\.exe)?\s+(?:(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?)\s+)*(push|commit|reset|rebase|merge|tag|cherry-pick|revert|am)\b/i;
const m = interdit.exec(c);
if (m) {
  refuser(
    lu.valeur,
    `Commande bloquée par garde-executant : git ${m[1].toLowerCase()}.`,
    "L'exécutant ne commite pas et n'écrit pas l'historique. Rends compte à l'agent principal, qui commite.",
  );
}
autoriser(lu.valeur);
