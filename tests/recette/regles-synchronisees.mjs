#!/usr/bin/env node
/**
 * Règles communes à Cursor et à Claude Code (bascule du 07/10/2026).
 *
 * Chaque `.cursor/rules/<nom>.mdc` a son `.claude/rules/<nom>.md` au corps identique :
 * `globs` devient `paths`, `alwaysApply: true` (ou aucune portée) devient une règle sans `paths`.
 * `01-cursor.mdc` porte ce qui est propre à Cursor (hook de relance, arrêt pour attendre, fichier STOP)
 * et `02-claude-md.mdc` renvoie à `CLAUDE.md` : ces deux règles n'existent pas côté `.claude/rules`
 * (consigne de l'architecte du 24/10/2026).
 *
 * Sous-agents : chaque `.claude/agents/<nom>.md` a son `.cursor/agents/<nom>.md` au corps identique
 * (les en-têtes diffèrent : `model`, `effort`, `tools` et `hooks` sont propres à Claude Code). `Explore` n'a pas
 * d'équivalent : Cursor fait l'exploration lui-même.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dossierCursor = join(root, ".cursor/rules");
const dossierClaude = join(root, ".claude/rules");
const agentsCursor = join(root, ".cursor/agents");
const agentsClaude = join(root, ".claude/agents");
/** Règles propres à Cursor : exemptées de la comparaison, sans jumelle côté Claude Code. */
const REGLES_CURSOR = ["01-cursor", "02-claude-md"];
/** Sous-agents propres à Claude Code : sans équivalent sous Cursor. */
const AGENTS_CLAUDE_SEULS = ["Explore"];
const TERMES_CURSOR = [/relance/i, /\bSTOP\b/, /\bhook\b/i, /\.cursor\//];

/** Sépare l'en-tête (clé: valeur) du corps. `null` si le fichier n'a pas d'en-tête. */
function decouper(texte) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(texte.replace(/\r\n/g, "\n"));
  return m ? { entete: m[1], corps: m[2].trim() } : { entete: null, corps: texte.replace(/\r\n/g, "\n").trim() };
}

function globsCursor(entete) {
  const m = entete && /^globs:\s*(.+)$/m.exec(entete);
  return m ? m[1].split(",").map((g) => g.trim()).filter(Boolean) : [];
}

function pathsClaude(entete) {
  if (!entete) return [];
  const liste = [];
  let dans = false;
  for (const ligne of entete.split("\n")) {
    if (/^paths:\s*$/.test(ligne)) {
      dans = true;
    } else if (dans) {
      const m = /^\s+-\s+"?(.+?)"?\s*$/.exec(ligne);
      if (!m) break;
      liste.push(m[1]);
    }
  }
  return liste;
}

/** Écarts entre une règle Cursor et sa jumelle Claude Code. */
export function comparer(nom, texteCursor, texteClaude) {
  const ecarts = [];
  const c = decouper(texteCursor);
  const k = decouper(texteClaude);
  if (c.corps !== k.corps) ecarts.push(`${nom} : corps différents`);
  const globs = globsCursor(c.entete);
  const paths = pathsClaude(k.entete);
  if (JSON.stringify(globs) !== JSON.stringify(paths)) {
    ecarts.push(`${nom} : globs [${globs.join(", ")}] et paths [${paths.join(", ")}] différents`);
  }
  if (k.entete !== null && paths.length === 0) ecarts.push(`${nom} : en-tête Claude Code sans paths`);
  if (/^alwaysApply:\s*true\s*$/m.test(c.entete ?? "") && paths.length > 0) {
    ecarts.push(`${nom} : règle permanente avec paths`);
  }
  for (const terme of TERMES_CURSOR) {
    if (terme.test(k.corps)) ecarts.push(`${nom} : terme propre à Cursor (${terme}) dans le corps commun`);
  }
  return ecarts;
}

/** Écarts entre les ensembles de règles : jumelles manquantes, règles propres à Cursor absentes ou dupliquées. */
export function ecartsEnsembles(cursor, claude) {
  const ecarts = [];
  for (const nom of REGLES_CURSOR) {
    if (!cursor.includes(nom)) ecarts.push(`.cursor/rules/${nom}.mdc absente`);
    if (claude.includes(nom)) ecarts.push(`.claude/rules/${nom}.md ne doit pas exister`);
  }
  for (const nom of claude) {
    if (!cursor.includes(nom)) ecarts.push(`.claude/rules/${nom}.md sans jumelle Cursor`);
  }
  for (const nom of cursor) {
    if (!REGLES_CURSOR.includes(nom) && !claude.includes(nom)) ecarts.push(`.claude/rules/${nom}.md absente`);
  }
  return ecarts;
}

/** Écarts entre les sous-agents Claude Code et Cursor (corps identiques ; `Explore` seulement côté Claude Code). */
export function ecartsAgents(claude, cursor) {
  const ecarts = [];
  for (const [nom, texte] of claude) {
    if (AGENTS_CLAUDE_SEULS.includes(nom)) {
      if (cursor.has(nom)) ecarts.push(`.cursor/agents/${nom}.md ne doit pas exister (Cursor explore lui-même)`);
      continue;
    }
    if (!cursor.has(nom)) {
      ecarts.push(`.cursor/agents/${nom}.md absent`);
    } else if (decouper(texte).corps !== decouper(cursor.get(nom)).corps) {
      ecarts.push(`${nom} : corps du sous-agent différent entre .claude/agents et .cursor/agents`);
    }
  }
  for (const nom of cursor.keys()) {
    if (!claude.has(nom)) ecarts.push(`.cursor/agents/${nom}.md sans équivalent dans .claude/agents`);
  }
  return ecarts;
}

function lireAgents(dossier) {
  const agents = new Map();
  if (!existsSync(dossier)) return agents;
  for (const f of readdirSync(dossier).filter((n) => n.endsWith(".md"))) {
    agents.set(f.slice(0, -3), readFileSync(join(dossier, f), "utf8"));
  }
  return agents;
}

const erreurs = [];
const cursor = readdirSync(dossierCursor).filter((f) => f.endsWith(".mdc")).map((f) => f.slice(0, -4));
const claude = existsSync(dossierClaude)
  ? readdirSync(dossierClaude).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
  : [];

erreurs.push(...ecartsEnsembles(cursor, claude));
for (const nom of cursor) {
  if (REGLES_CURSOR.includes(nom) || !claude.includes(nom)) continue;
  erreurs.push(
    ...comparer(
      nom,
      readFileSync(join(dossierCursor, `${nom}.mdc`), "utf8"),
      readFileSync(join(dossierClaude, `${nom}.md`), "utf8"),
    ),
  );
}
erreurs.push(...ecartsAgents(lireAgents(agentsClaude), lireAgents(agentsCursor)));

// Essais négatifs : la comparaison doit voir un corps modifié, un paths perdu, une règle permanente bornée
// et une ligne Cursor oubliée dans le corps commun.
const modele = "---\ndescription: x\nglobs: a/**, b/*.rs\nalwaysApply: false\n---\n\n# T\n\n- règle\n";
const jumelle = "---\npaths:\n  - \"a/**\"\n  - \"b/*.rs\"\n---\n\n# T\n\n- règle\n";
const permanent = "---\ndescription: x\nalwaysApply: true\n---\n\n# T\n\n- règle\n";
const essais = [
  ["jumelle exacte", comparer("essai", modele, jumelle), false],
  ["permanente sans en-tête", comparer("essai", permanent, "# T\n\n- règle\n"), false],
  ["corps modifié", comparer("essai", modele, jumelle.replace("- règle", "- autre règle")), true],
  ["paths perdu", comparer("essai", modele, "# T\n\n- règle\n"), true],
  ["paths ajouté à une règle permanente", comparer("essai", permanent, jumelle), true],
  ["ligne Cursor dans le corps", comparer("essai", modele.replace("- règle", "- relance par le hook"), jumelle.replace("- règle", "- relance par le hook")), true],
  // Ensembles de règles : les deux règles propres à Cursor sont exemptées, rien d'autre ne l'est.
  ["ensembles conformes", ecartsEnsembles(["00-a", "01-cursor", "02-claude-md"], ["00-a"]), false],
  ["01-cursor absente", ecartsEnsembles(["00-a", "02-claude-md"], ["00-a"]), true],
  ["02-claude-md absente", ecartsEnsembles(["00-a", "01-cursor"], ["00-a"]), true],
  ["02-claude-md dupliquée côté Claude Code", ecartsEnsembles(["00-a", "01-cursor", "02-claude-md"], ["00-a", "02-claude-md"]), true],
  ["règle Cursor sans jumelle (hors 01 et 02)", ecartsEnsembles(["00-a", "03-b", "01-cursor", "02-claude-md"], ["00-a"]), true],
  ["règle Claude Code sans jumelle Cursor", ecartsEnsembles(["01-cursor", "02-claude-md"], ["00-a"]), true],
  // Sous-agents : corps identiques, en-têtes libres, Explore seulement côté Claude Code.
  ["sous-agents conformes", ecartsAgents(
    new Map([["x", "---\nname: x\nmodel: haiku\n---\n\nCorps\n"], ["Explore", "---\nname: Explore\n---\n\nE\n"]]),
    new Map([["x", "---\nname: x\nmodel: inherit\n---\n\nCorps\n"]]),
  ), false],
  ["sous-agent absent côté Cursor", ecartsAgents(new Map([["x", "---\nname: x\n---\n\nCorps\n"]]), new Map()), true],
  ["corps de sous-agent modifié", ecartsAgents(
    new Map([["x", "---\nname: x\n---\n\nCorps\n"]]),
    new Map([["x", "---\nname: x\n---\n\nCorps modifié\n"]]),
  ), true],
  ["Explore recréé côté Cursor", ecartsAgents(
    new Map([["Explore", "---\nname: Explore\n---\n\nE\n"]]),
    new Map([["Explore", "---\nname: Explore\n---\n\nE\n"]]),
  ), true],
  ["sous-agent Cursor sans équivalent", ecartsAgents(new Map(), new Map([["y", "---\nname: y\n---\n\nC\n"]])), true],
];
for (const [libelle, ecarts, attendu] of essais) {
  if ((ecarts.length > 0) !== attendu) {
    erreurs.push(`essai « ${libelle} » : ${attendu ? "écart attendu, aucun reçu" : `faux positif (${ecarts.join(" ; ")})`}`);
  }
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`regles-synchronisees: FAIL — ${e}`);
  process.exit(1);
}
console.log(
  `regles-synchronisees: OK (${cursor.length - REGLES_CURSOR.length} règles communes, ${REGLES_CURSOR.join(" et ")} propres à Cursor, ${essais.length} essais, sous-agents alignés)`,
);
