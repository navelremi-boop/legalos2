import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { estNomDeBaseAutorise, nomBaseLocale } from "./cheminBaseLocale.ts";

describe("nom de la base locale du poste", () => {
  it("sans isolation, la base porte le nom fixe du poste", () => {
    assert.equal(nomBaseLocale(""), "legalos-powersync.db");
  });

  it("avec un identifiant de poste simple, le nom en dérive", () => {
    assert.equal(nomBaseLocale("j11rb"), "legalos-powersync-j11rb.db");
    assert.equal(nomBaseLocale("poste_2-a"), "legalos-powersync-poste_2-a.db");
  });

  it("essai négatif : un identifiant qui sort du dossier de données est refusé", () => {
    for (const hostile of ["..", "../x", "..\\x", "a/b", "a\\b", "C:\\x", "x.db", "x y", "é", "a".repeat(65)]) {
      assert.throws(() => nomBaseLocale(hostile), /refusé/u, hostile);
    }
  });

  it("n'autorise que le nom que le poste crée", () => {
    assert.equal(estNomDeBaseAutorise("legalos-powersync.db"), true);
    assert.equal(estNomDeBaseAutorise("legalos-powersync-j11rb.db"), true);
  });

  it("essai négatif : une base ailleurs, ou un fichier fourni par un tiers, est refusée", () => {
    for (const nom of [
      "",
      "autre.db",
      "client.sqlite",
      "legalos-powersync.db-wal",
      "legalos-powersync.db-shm",
      "legalos-powersync-.db",
      "legalos-powersync-../x.db",
      "../legalos-powersync.db",
      "..\\legalos-powersync.db",
      "C:\\Users\\x\\legalos-powersync.db",
      "/tmp/legalos-powersync.db",
      "legalos-powersync.db\u0000.sqlite",
    ]) {
      assert.equal(estNomDeBaseAutorise(nom), false, JSON.stringify(nom));
    }
  });
});

const RACINE_POSTE = new URL("../../", import.meta.url);

function fichiers(dossier: string, extensions: readonly string[]): string[] {
  const resultat: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === "node_modules" || nom === "target") continue;
      resultat.push(...fichiers(chemin, extensions));
    } else if (extensions.some((extension) => nom.endsWith(extension))) {
      resultat.push(chemin);
    }
  }
  return resultat;
}

describe("le poste n'ouvre aucune autre base SQLite que la sienne", () => {
  const racine = RACINE_POSTE.pathname.replace(/^\/([A-Za-z]:)/u, "$1");
  const source = fichiers(join(racine, "src"), [".ts", ".tsx"]).filter((chemin) => !/\.test\.tsx?$/u.test(chemin));
  const natif = fichiers(join(racine, "src-tauri", "src"), [".rs"]);
  const court = (chemin: string) => relative(racine, chemin).split(sep).join("/");

  it("seul sync/database.ts ouvre la base, dans le dossier de données de l'application", () => {
    const ouvrants = source.filter((chemin) => /PowerSyncTauriDatabase\s*\(|dbFilename|dbLocationAsync/u.test(readFileSync(chemin, "utf8")));
    assert.deepEqual(ouvrants.map(court).sort(), ["src/sync/database.ts"]);
    const texte = readFileSync(join(racine, "src", "sync", "database.ts"), "utf8");
    assert.match(texte, /dbLocationAsync:\s*appDataDir/u);
    assert.match(texte, /nomBaseLocale\(/u);
  });

  it("essai négatif : le contrôle voit une ouverture ajoutée ailleurs", () => {
    const fautif = "const base = new PowerSyncTauriDatabase({ database: { dbFilename: chemin } });";
    assert.equal(/PowerSyncTauriDatabase\s*\(|dbFilename|dbLocationAsync/u.test(fautif), true);
  });

  it("aucun code natif du poste n'ouvre une connexion SQLite", () => {
    const motif = /Connection::open|rusqlite::Connection|Connection::open_with_flags|ATTACH\s+DATABASE|sqlite3_open/iu;
    const ouvrants = natif.filter((chemin) => motif.test(readFileSync(chemin, "utf8")));
    assert.deepEqual(ouvrants.map(court), []);
  });
});
