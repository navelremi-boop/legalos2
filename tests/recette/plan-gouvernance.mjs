#!/usr/bin/env node
/**
 * Gouvernance de PLAN.md (ordre d'opération § 4.4).
 *
 * 1. Chaque jalon non coché garde ses critères sous forme de commandes, sauf
 *    dans une phase marquée « Critères de chaque jalon à proposer ».
 * 2. Chaque commit de la plage qui touche PLAN.md ne touche que PLAN.md et son
 *    sujet commence par « plan: ».
 * 3. D'un commit à l'autre, un jalon non coché ne perd aucune commande et une
 *    dette ouverte ne disparaît pas sans être cochée, sauf si le message du
 *    commit cite la consigne (« Consigne de l'architecte du … ») ; le
 *    contrôleur rapproche alors le commit de la consigne consignée dans
 *    JOURNAL.md.
 *
 * Plage : variable PLAN_RANGE (« base..tête ») ; à défaut origin/main..HEAD.
 * 4. Un chemin `docs/…` cité dans PLAN.md, BLOCAGES.md ou JOURNAL.md existe dans le dépôt.
 * 5. Le jalon en cours (en-tête « jalon en cours ») ne porte pas « à valider par l'architecte »
 *    (consigne du 29/09/2026). Sinon le contrôle échoue : l'état-major consigne l'attente
 *    dans BLOCAGES.md et traite les dettes ouvertes ; s'il n'en reste aucune, `.mission/STOP`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MARQUE_EXEMPTION = "Critères de chaque jalon à proposer";
const MARQUE_CONSIGNE = /^Consigne de l'architecte du /m;
const COMMANDE = /`((?:node|cargo|pnpm|docker|gh) [^`]+)`/g;

const erreurs = [];

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sansCase(ligne) {
  return ligne.replace(/^- \[[ x]\] /, "").trim();
}

function analyser(texte) {
  const jalons = new Map();
  const dettesOuvertes = new Set();
  const dettesCochees = new Set();
  let section = "";
  let exempt = false;
  let dansDettes = false;
  let courant = null;
  const ajouter = (jalon, ligne) => {
    for (const m of ligne.matchAll(COMMANDE)) jalon.commandes.add(m[1].trim());
  };
  for (const ligne of texte.replace(/\r\n/g, "\n").split("\n")) {
    if (/^#{2,3} /.test(ligne)) {
      courant = null;
      if (ligne.startsWith("## ")) {
        section = ligne.slice(3).trim();
        exempt = false;
      }
      dansDettes = ligne.startsWith("### Dettes");
      continue;
    }
    if (!ligne.startsWith(" ") && ligne.includes(MARQUE_EXEMPTION)) {
      exempt = true;
      continue;
    }
    const m = /^- \[( |x)\] \*\*(.+?)\*\*(.*)$/.exec(ligne);
    if (m) {
      const coche = m[1] === "x";
      if (dansDettes) {
        (coche ? dettesCochees : dettesOuvertes).add(sansCase(ligne));
        courant = null;
        continue;
      }
      courant = { nom: m[2], coche, section, exempt, commandes: new Set(), criteres: false };
      jalons.set(m[2], courant);
      ajouter(courant, m[3]);
      continue;
    }
    if (courant && /^\s+\S/.test(ligne)) {
      if (ligne.includes("Critères")) courant.criteres = true;
      ajouter(courant, ligne);
      continue;
    }
    if (ligne.trim() !== "") courant = null;
  }
  return { jalons, dettesOuvertes, dettesCochees };
}

/** Chaque élément « détail → jalon » de la section Couverture V1. */
function verifierCouverture(texte, nomsJalons) {
  const trouves = [];
  const lignes = texte.replace(/\r\n/g, "\n").split("\n");
  let dans = false;
  let numero = null;
  let elements = 0;
  const vus = new Set();
  const fermer = () => {
    if (numero !== null && elements === 0) {
      trouves.push(`fonctionnalité V1 n° ${numero} sans élément de détail`);
    }
  };
  for (const ligne of lignes) {
    if (ligne.startsWith("## ")) {
      if (dans) fermer();
      dans = ligne.startsWith("## Couverture V1");
      numero = null;
      elements = 0;
      continue;
    }
    if (!dans) continue;
    const fonction = /^- \*\*(\d+)\s/.exec(ligne);
    if (fonction) {
      fermer();
      numero = Number(fonction[1]);
      vus.add(numero);
      elements = 0;
      continue;
    }
    const element = /^  - (.+?) → (.+)$/.exec(ligne);
    if (!element) continue;
    elements += 1;
    const libelle = element[1].trim();
    const cibles = element[2]
      .split(";")
      .map((nom) => nom.trim())
      .filter(Boolean);
    if (cibles.length === 0) {
      trouves.push(`élément sans jalon : ${libelle}`);
      continue;
    }
    if (!nomsJalons) continue;
    for (const nom of cibles) {
      if (!nomsJalons.has(nom)) trouves.push(`jalon inconnu « ${nom} » pour « ${libelle} »`);
    }
  }
  if (dans) fermer();
  if (!texte.includes("## Couverture V1")) trouves.push("section « Couverture V1 » absente");
  for (let n = 1; n <= 14; n += 1) {
    if (!vus.has(n)) trouves.push(`fonctionnalité V1 n° ${n} absente de la matrice`);
  }
  return trouves;
}

const MARQUE_A_VALIDER = "à valider par l'architecte";

/** Nom cité par l'en-tête, puis son bloc jusqu'au jalon suivant. `null` si le bloc est recevable. */
function jalonEnCoursPorteAValider(texte) {
  const normalise = texte.replace(/\r\n/g, "\n");
  const entete = /jalon en cours\s*:\s*\*\*(.+?)\*\*/.exec(normalise);
  if (!entete) return "en-tête « jalon en cours » absent";
  const nom = entete[1].trim();
  let dans = false;
  const bloc = [];
  for (const ligne of normalise.split("\n")) {
    const jalon = /^- \[[ x]\] \*\*(.+?)\*\*/.exec(ligne);
    if (jalon) {
      if (dans) break;
      if (jalon[1] === nom) dans = true;
    }
    if (dans) bloc.push(ligne);
  }
  if (!dans) return `jalon en cours « ${nom} » introuvable dans le plan`;
  if (bloc.join("\n").includes(MARQUE_A_VALIDER)) {
    return `jalon en cours « ${nom} » porte « ${MARQUE_A_VALIDER} »`;
  }
  return null;
}

function verifierStructure(plan, origine) {
  for (const jalon of plan.jalons.values()) {
    if (jalon.coche || jalon.exempt) continue;
    if (!jalon.criteres) {
      erreurs.push(`${origine} : jalon « ${jalon.nom} » (${jalon.section}) sans ligne de critères`);
    } else if (jalon.commandes.size === 0) {
      erreurs.push(`${origine} : jalon « ${jalon.nom} » sans critère sous forme de commande`);
    }
  }
}

function verifierCliquet(avant, apres, commit) {
  for (const jalon of avant.jalons.values()) {
    if (jalon.coche) continue;
    const suite = apres.jalons.get(jalon.nom);
    if (!suite) {
      erreurs.push(`${commit} : jalon non validé « ${jalon.nom} » supprimé ou renommé`);
      continue;
    }
    if (suite.coche) continue;
    for (const commande of jalon.commandes) {
      if (!suite.commandes.has(commande)) {
        erreurs.push(`${commit} : « ${jalon.nom} » perd le critère \`${commande}\``);
      }
    }
  }
  for (const dette of avant.dettesOuvertes) {
    if (!apres.dettesOuvertes.has(dette) && !apres.dettesCochees.has(dette)) {
      erreurs.push(`${commit} : dette ouverte supprimée ou reformulée : ${dette.slice(0, 90)}`);
    }
  }
}

const RE_DOC = /docs\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g;

function cheminsDocs(texte) {
  return [...new Set(texte.match(RE_DOC) ?? [])];
}

/** Chemins docs/ cités qui ne sont pas dans le dépôt. `existe` reçoit le chemin relatif. */
function documentsAbsents(texte, origine, existe) {
  const absents = [];
  for (const chemin of cheminsDocs(texte)) {
    if (!existe(chemin)) absents.push(`${origine} : chemin cité absent du dépôt : ${chemin}`);
  }
  return absents;
}

function plage() {
  if (process.env.PLAN_RANGE) return process.env.PLAN_RANGE.trim();
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/main"]);
    return "origin/main..HEAD";
  } catch {
    return null;
  }
}

const textePlan = readFileSync(join(root, "PLAN.md"), "utf8");
const attenteArchitecte = jalonEnCoursPorteAValider(textePlan);
if (attenteArchitecte) erreurs.push(`PLAN.md : ${attenteArchitecte}`);

const essaiJalonAttente = jalonEnCoursPorteAValider(
  [
    "Dernière mise à jour (jalon en cours : **Agenda**).",
    "- [ ] **Agenda** — critères proposés, **à valider par l'architecte**",
    "  - `node tests/recette/agenda-tauri.mjs`",
  ].join("\n"),
);
if (!essaiJalonAttente || !essaiJalonAttente.includes(MARQUE_A_VALIDER)) {
  erreurs.push("essai négatif du jalon en cours muet");
}
const essaiJalonSuivant = jalonEnCoursPorteAValider(
  [
    "Dernière mise à jour (jalon en cours : **Agenda**).",
    "- [ ] **Agenda** — critères validés par l'architecte le 29/09/2026",
    "  - `node tests/recette/agenda-tauri.mjs`",
    "- [ ] **Documents, suite** — **à valider par l'architecte**",
  ].join("\n"),
);
if (essaiJalonSuivant) {
  erreurs.push(`essai négatif du jalon en cours : faux positif (${essaiJalonSuivant})`);
}

const planCourant = analyser(textePlan);
verifierStructure(planCourant, "PLAN.md");
for (const e of verifierCouverture(textePlan, new Set(planCourant.jalons.keys()))) {
  erreurs.push(`couverture : ${e}`);
}
const essaiNegatif = verifierCouverture(
  ["## Couverture V1", "- **1 Dossiers**", "  - juridiction → Jalon absent", "- **3 Droits**"].join("\n"),
  new Set(["J5"]),
);
if (!essaiNegatif.some((e) => e.includes("n° 2")) || !essaiNegatif.some((e) => e.includes("Jalon absent"))) {
  erreurs.push("essai négatif de la couverture V1 muet");
}

const existeDepot = (chemin) => existsSync(join(root, chemin));
for (const nom of ["PLAN.md", "BLOCAGES.md", "JOURNAL.md"]) {
  erreurs.push(...documentsAbsents(readFileSync(join(root, nom), "utf8"), nom, existeDepot));
}
const essaiDocs = documentsAbsents(
  "voir `docs/inexistant-gouvernance.md` et docs/cahier-des-charges.md",
  "essai",
  () => false,
);
if (
  essaiDocs.length !== 2 ||
  !essaiDocs.some((e) => e.includes("docs/inexistant-gouvernance.md")) ||
  !essaiDocs.some((e) => e.includes("docs/cahier-des-charges.md"))
) {
  erreurs.push("essai négatif des chemins docs muet");
}
const essaiDocsPresent = documentsAbsents("voir `docs/cahier-des-charges.md`", "essai", () => true);
if (essaiDocsPresent.length !== 0) {
  erreurs.push("essai négatif des chemins docs : faux positif");
}

const intervalle = plage();
const base = intervalle?.split("..")[0] ?? "";
if (!intervalle || base === "" || /^0+$/.test(base)) {
  console.log("plan-gouvernance: pas de plage de commits à contrôler");
} else {
  const commits = git(["rev-list", "--no-merges", "--reverse", intervalle, "--", "PLAN.md"])
    .split("\n")
    .filter(Boolean);
  for (const sha of commits) {
    const court = sha.slice(0, 7);
    const message = git(["log", "-1", "--format=%B", sha]);
    const sujet = message.split("\n")[0];
    if (!sujet.startsWith("plan:")) {
      erreurs.push(`${court} : modifie PLAN.md sans le préfixe « plan: » (${sujet})`);
    }
    const fichiers = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
      .split("\n")
      .filter(Boolean);
    const autres = fichiers.filter((f) => f !== "PLAN.md");
    if (autres.length > 0) {
      erreurs.push(`${court} : commit non dédié, touche aussi ${autres.join(", ")}`);
    }
    let avant = null;
    try {
      avant = git(["show", `${sha}^:PLAN.md`]);
    } catch {
      avant = null;
    }
    const apres = analyser(git(["show", `${sha}:PLAN.md`]));
    verifierStructure(apres, court);
    if (avant !== null && !MARQUE_CONSIGNE.test(message)) {
      verifierCliquet(analyser(avant), apres, court);
    }
  }
  console.log(`plan-gouvernance: ${commits.length} commit(s) touchant PLAN.md sur ${intervalle}`);
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`plan-gouvernance: FAIL — ${e}`);
  process.exit(1);
}
console.log("plan-gouvernance: OK");
