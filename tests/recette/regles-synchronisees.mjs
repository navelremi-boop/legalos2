#!/usr/bin/env node
/**
 * Règles communes à Cursor et à Claude Code (bascule du 07/10/2026).
 *
 * Chaque `.cursor/rules/<nom>.mdc` a son `.claude/rules/<nom>.md` au corps identique :
 * `globs` devient `paths`, `alwaysApply: true` (ou aucune portée) devient une règle sans `paths`.
 * `01-cursor.mdc` porte ce qui est propre à Cursor (hook de relance, arrêt pour attendre, fichier STOP)
 * et n'existe pas côté `.claude/rules`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dossierCursor = join(root, ".cursor/rules");
const dossierClaude = join(root, ".claude/rules");
const REGLE_CURSOR = "01-cursor";
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

const erreurs = [];
const cursor = readdirSync(dossierCursor).filter((f) => f.endsWith(".mdc")).map((f) => f.slice(0, -4));
const claude = existsSync(dossierClaude)
  ? readdirSync(dossierClaude).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
  : [];

if (!cursor.includes(REGLE_CURSOR)) erreurs.push(`.cursor/rules/${REGLE_CURSOR}.mdc absente`);
if (claude.includes(REGLE_CURSOR)) erreurs.push(`.claude/rules/${REGLE_CURSOR}.md ne doit pas exister`);
for (const nom of claude) {
  if (!cursor.includes(nom)) erreurs.push(`.claude/rules/${nom}.md sans jumelle Cursor`);
}
for (const nom of cursor) {
  if (nom === REGLE_CURSOR) continue;
  if (!claude.includes(nom)) {
    erreurs.push(`.claude/rules/${nom}.md absente`);
    continue;
  }
  erreurs.push(
    ...comparer(
      nom,
      readFileSync(join(dossierCursor, `${nom}.mdc`), "utf8"),
      readFileSync(join(dossierClaude, `${nom}.md`), "utf8"),
    ),
  );
}

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
console.log(`regles-synchronisees: OK (${cursor.length - 1} règles communes, ${REGLE_CURSOR} propre à Cursor)`);
