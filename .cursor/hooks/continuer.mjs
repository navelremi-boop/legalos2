// Relance automatique de l'agent principal tant que la mission n'est pas terminée.
// Arrêt manuel : créer le fichier .mission/STOP à la racine du dépôt.
// Deux relances consécutives sans commande exécutée ni commit : incident au journal et STOP (ordre § 4.7).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { lireEntree, repondre } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  console.error(`hook continuer : ${lu.erreur}, pas de relance`);
  repondre({});
}
const entree = lu.valeur;
const racine = process.env.CURSOR_PROJECT_DIR || process.cwd();

// Pas de relance si l'utilisateur a interrompu l'agent ou en cas d'erreur.
if (String(entree.status ?? "").trim() !== "completed") repondre({});

// Arrêt demandé, mission terminée ou bloquée : pas de relance.
for (const f of ["STOP", "TERMINEE", "BLOQUEE"]) {
  if (existsSync(join(racine, ".mission", f))) repondre({});
}

const precedent = lireCompteur(racine);
const acte = mesurer(racine, precedent);
if (acte.travaille) {
  ecrireCompteur(racine, { sans_travail: 0, head: acte.head, commande_ms: acte.commande });
} else {
  const n = precedent.sans_travail + 1;
  const etat = { sans_travail: n, head: acte.head, commande_ms: acte.commande };
  if (n >= 2) arreter(racine, etat);
  ecrireCompteur(racine, etat);
}

const plan = join(racine, "PLAN.md");
if (!existsSync(plan)) {
  repondre({
    followup_message:
      "PLAN.md est absent. Exécute la phase 0 de docs/ordre-operation.md, puis poursuis la mission sans attendre de nouvelle instruction.",
  });
}

const jalonOuvert = /^\s*[-*] \[ \]/m.test(readFileSync(plan, "utf8"));
repondre({
  followup_message: jalonOuvert
    ? "Mission en cours. Relis docs/ordre-operation.md, PLAN.md, JOURNAL.md et BLOCAGES.md, puis reprends au premier jalon non coché. Ne conclus que dans les conditions du paragraphe 4.6."
    : "Tous les jalons sont cochés. Exécute la recette complète (S1 à S14a sur le poste, vérifie S14b en CI), fais valider par le contrôleur, rédige RAPPORT.md, puis crée .mission/TERMINEE comme prévu au paragraphe 4.6.",
});

function mesurer(racine, precedent) {
  const head = headActuel(racine);
  const commande = instantCommande(racine);
  const commit = precedent.head !== "" && head !== "" && head !== precedent.head;
  const commandeNouvelle = commande > precedent.commande_ms;
  return { head, commande, travaille: commit || commandeNouvelle };
}

function headActuel(racine) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: racine,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) return "";
  return String(r.stdout || "").trim();
}

function instantCommande(racine) {
  const p = join(racine, ".mission", "derniere-commande");
  if (!existsSync(p)) return 0;
  return statSync(p).mtimeMs;
}

function lireCompteur(racine) {
  const p = join(racine, ".mission", "relances.json");
  if (!existsSync(p)) return { sans_travail: 0, head: "", commande_ms: 0 };
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    return {
      sans_travail: Number(v.sans_travail) || 0,
      head: String(v.head || ""),
      commande_ms: Number(v.commande_ms) || 0,
    };
  } catch {
    return { sans_travail: 0, head: "", commande_ms: 0 };
  }
}

function ecrireCompteur(racine, etat) {
  mkdirSync(join(racine, ".mission"), { recursive: true });
  writeFileSync(join(racine, ".mission", "relances.json"), `${JSON.stringify(etat)}\n`, "utf8");
}

function arreter(racine, etat) {
  mkdirSync(join(racine, ".mission"), { recursive: true });
  try {
    consigner(racine);
  } catch (e) {
    console.error(`hook continuer : journal ${e instanceof Error ? e.message : e}`);
  }
  writeFileSync(
    join(racine, ".mission", "STOP"),
    "deux relances consécutives sans commande exécutée ni commit\n",
    "utf8",
  );
  ecrireCompteur(racine, etat);
  repondre({});
}

function consigner(racine) {
  const quand = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const bloc =
    "\n## Incident — relances sans travail\n\n" +
    `${quand} (heure de Paris) — deux relances consécutives sans commande exécutée ni commit. ` +
    ".mission/STOP créé (ordre d'opération § 4.7).\n";
  const chemin = join(racine, "JOURNAL.md");
  const existant = existsSync(chemin) ? readFileSync(chemin, "utf8") : "# LEGAL OS — Journal\n";
  const texte = existant.endsWith("\n") ? existant + bloc : `${existant}\n${bloc}`;
  writeFileSync(chemin, texte.replace(/^\uFEFF/, ""), "utf8");
}
