/**
 * Éprouve le filet de cliché (consigne du 27/10/2026).
 * Construit le poste avec la feature `test-webdriver`, le lance par copie, attache cdb,
 * et vérifie qu'un cliché complet apparaît après `--lever-corruption-tas`.
 * Le binaire de la série (sans cette feature) est restauré ensuite.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { creerSession, sleep } from "./lib/poste-session.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cible = join(racine, "target-recette");
const exe = join(cible, "debug", "legal-os-poste.exe");
const pdb = join(cible, "debug", "legal_os_poste.pdb");
const sauvegarde = join(tmpdir(), "legalos-binaire-serie");
const session = creerSession("filet-cliche");
const { fail, ok, startApp, stopApp } = session;

function copier(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function restaurer() {
  copier(join(sauvegarde, "legal-os-poste.exe"), exe);
  copier(join(sauvegarde, "legal_os_poste.pdb"), pdb);
}

function construire() {
  const configPath = join(tmpdir(), `legalos-filet-cliche-${Date.now()}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      build: {
        frontendDist: "../dist-recette",
        beforeBuildCommand: "node -e \"process.exit(0)\"",
      },
    }),
  );
  console.log("filet-cliche: construction avec la feature test-webdriver");
  const r = spawnSync(
    "cmd.exe",
    ["/d", "/s", "/c", `pnpm tauri build --debug --no-bundle --features test-webdriver --config ${configPath}`],
    {
      cwd: join(racine, "apps", "poste"),
      env: {
        ...process.env,
        RUST_BACKTRACE: "1",
        CARGO_TARGET_DIR: cible,
        VITE_LEGALOS_RECETTE_HOOKS: "1",
        LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (r.status !== 0) fail(`construction exit ${r.status ?? 1}`);
}

async function attendreFichier(chemin, delaiMs) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (existsSync(chemin) && statSync(chemin).size > 0) return statSync(chemin).size;
    await sleep(500);
  }
  return 0;
}

let enfant = null;

async function main() {
  if (!existsSync(exe)) fail(`binaire de la série absent (${exe})`);
  copier(exe, join(sauvegarde, "legal-os-poste.exe"));
  copier(pdb, join(sauvegarde, "legal_os_poste.pdb"));
  process.env.CARGO_TARGET_DIR = cible;
  construire();
  enfant = startApp("filet", 9391, "copie", ["--lever-corruption-tas"]);
  const filet = enfant.filet;
  if (!filet) fail("le filet cdb n'est pas posé");
  const debut = Date.now();
  let attache = false;
  while (Date.now() - debut < 30_000) {
    if (existsSync(filet.journal) && readFileSync(filet.journal, "utf8").includes("CDB_ATTACHE")) {
      attache = true;
      break;
    }
    if (filet.exitCode !== null) break;
    await sleep(400);
  }
  if (!attache) fail(`cdb ne s'est pas attaché (journal ${filet.journal})`);
  while (filet.exitCode === null && Date.now() - debut < 180_000) await sleep(500);
  const taille = await attendreFichier(filet.cliche, 5_000);
  const journal = existsSync(filet.journal) ? readFileSync(filet.journal, "utf8") : "";
  if (taille === 0) fail("aucun cliché après STATUS_HEAP_CORRUPTION");
  if (!journal.includes("CRASH_C0000374")) fail("le journal du filet ne contient pas CRASH_C0000374");
  ok(`cliché écrit (${taille} octets) après l'exception volontaire ; le binaire de la série est restauré`);
  rmSync(filet.cliche, { force: true });
}

main()
  .catch((err) => {
    console.error(`filet-cliche: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => (enfant ? stopApp(enfant) : undefined))
  .finally(() => {
    try {
      restaurer();
    } catch (err) {
      console.error(`filet-cliche: restauration du binaire impossible : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
      process.exitCode = 1;
    }
    session.fermer();
  });
