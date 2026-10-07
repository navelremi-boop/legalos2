// Garde du sous-agent executant (Claude Code).
// 1. Ni git push ni git commit, ni autre écriture d'historique : l'agent principal commite.
// 2. Aucune écriture dans les chemins de la synchronisation, des droits, de la facturation et de la messagerie
//    (décision du commandement, 07/10/2026) : ces tâches reviennent à l'agent principal.
//
// Les écritures par les outils Edit, Write, MultiEdit et NotebookEdit sont contrôlées sur le chemin exact.
// Pour Bash et PowerShell, le contrôle est de bonne foi : redirections, commandes d'écriture usuelles (rm, mv, cp,
// tee, sed -i, Set-Content, Out-File…) et code en ligne (node -e, python -c) dont un mot désigne un chemin
// réservé. Une écriture indirecte (un script qui écrit ailleurs, `cargo fmt`) n'est pas vue : le relecteur
// (agent principal) relit tout ce que produit executant avant de commiter.
import { posix } from "node:path";
import { autoriser, commandeDe, lireEntree, refuser, refuserIllisible } from "./lib.mjs";

/** Préfixes réservés, en minuscules, avec des barres obliques. Un chemin les contient après une barre. */
const CHEMINS_RESERVES = [
  // Noms par la décision du 07/10/2026.
  ["apps/poste/src-tauri/src/sync/", "synchronisation"],
  ["crates/api/src/", "API (droits, facturation, synchronisation)"],
  ["crates/messagerie/", "messagerie"],
  ["crates/api/migrations/", "schéma de base de données"],
  // Droits, synchronisation et facturation hors de ces dossiers.
  ["apps/poste/src/sync/", "synchronisation"],
  ["apps/poste/src/lib/auth/", "droits (authentification)"],
  ["instance/powersync/", "synchronisation (règles de flux)"],
  ["apps/poste/src/facturation/", "facturation"],
  ["instance/simulateur-pa/", "facturation (plateforme agréée)"],
  ["crates/api/templates/", "facturation"],
  ["tests/recette/facturx/", "facturation"],
];

/** Fichier de droits ou de facturation, où qu'il soit : un mot du chemin, borné par des non-lettres. */
const NOM_RESERVE =
  /(?:^|[^a-z])(?:factur[a-z]*|avoirs?|droits?|acces|permissions?|rbac|auth|oauth|authentif[a-z]*|provisions?|honorair[a-z]*)(?:[^a-z]|$)/;

/** Raison du refus si le chemin est réservé, sinon `null`. */
function raisonReservee(chemin) {
  const brut = String(chemin).replace(/^["']|["']$/g, "").replace(/\\/g, "/").toLowerCase();
  if (brut === "" || brut === "-") return null;
  const net = `/${posix.normalize(brut).replace(/^\.\//, "").replace(/^\/+/, "")}`;
  for (const [prefixe, raison] of CHEMINS_RESERVES) {
    if (net.includes(`/${prefixe}`)) return raison;
  }
  // Le nom ne compte que pour un vrai chemin : on ignore les mots seuls (options, messages).
  if (/[/.]/.test(brut) && NOM_RESERVE.test(net)) return "droits ou facturation (nom de fichier)";
  return null;
}

const OUTILS_ECRITURE = new Set(["edit", "write", "multiedit", "notebookedit"]);
const VERBES_ECRITURE = [
  /(?:^|[\s(])(?:rm|rmdir|mv|cp|touch|mkdir|ln|truncate|dd|install|patch)\s/i,
  /\btee\b/i,
  /\bsed\s+(?:-[a-z]*i|--in-place)/i,
  /\bperl\s+-[a-z]*i/i,
  /\b(?:Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item|Set-ItemProperty)\b/i,
  /\bgit(?:\.exe)?\s+(?:-\S+\s+)*(?:apply|checkout|restore|clean|rm|mv|stash)\b/i,
  /\b(?:node|python3?|perl|ruby|pwsh|powershell)(?:\.exe)?\s+(?:-e|-c|-pe|-command|-encodedcommand)\b/i,
];

/** Tout mot d'un segment qui désigne un chemin réservé : `{ mot, raison }` ou `null`. */
function motReserve(segment) {
  for (const mot of segment.split(/[\s"'`,()=;]+/)) {
    const raison = raisonReservee(mot);
    if (raison) return { mot, raison };
  }
  return null;
}

/** Écriture par commande dans un chemin réservé : `{ mot, raison }` ou `null`. */
function ecritureReserveeParCommande(commande) {
  for (const segment of commande.split(/&&|\|\||[;|&\r\n]/)) {
    for (const cible of segment.matchAll(/\d?>{1,2}\s*("[^"]+"|'[^']+'|[^\s;|&<>]+)/g)) {
      const raison = raisonReservee(cible[1]);
      if (raison) return { mot: cible[1], raison };
    }
    if (VERBES_ECRITURE.some((v) => v.test(segment))) {
      const trouve = motReserve(segment);
      if (trouve) return trouve;
    }
  }
  return null;
}

const lu = await lireEntree();
if (!lu.ok) {
  refuserIllisible(`Commande refusée par garde-executant : entrée illisible (${lu.erreur}).`);
}

const refuserChemin = (mot, raison) =>
  refuser(
    lu.valeur,
    `Commande bloquée par garde-executant : écriture dans un chemin réservé à l'agent principal (${raison}) : ${mot}.`,
    "executant ne touche ni la synchronisation, ni les droits, ni la facturation, ni la messagerie. Rends compte à l'agent principal.",
  );

const outil = String(lu.valeur.tool_name ?? "").toLowerCase();
if (OUTILS_ECRITURE.has(outil)) {
  const entree = lu.valeur.tool_input ?? {};
  const chemin = String(entree.file_path ?? entree.notebook_path ?? "");
  const raison = raisonReservee(chemin);
  if (raison) refuserChemin(chemin, raison);
  autoriser(lu.valeur);
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
const ecriture = ecritureReserveeParCommande(c);
if (ecriture) refuserChemin(ecriture.mot, ecriture.raison);
autoriser(lu.valeur);
