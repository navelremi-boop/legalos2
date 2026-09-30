#!/usr/bin/env node
/**
 * Volume Sync Streams : 3 000 dossiers, 300 restreints, un utilisateur sur 200.
 * Le nombre de buckets du checkpoint est le même à 300 et à 3 000 dossiers, et < 200.
 * L'ancienne jointure par dossier dépasse la limite (PSYNC_S2305).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const syncPath = join(root, "instance/powersync/sync-config.yaml");
const fixture = join(root, "tests/recette/fixtures/sync-config-par-dossier.yaml");
const yamlBon = readFileSync(syncPath, "utf8");

function fail(message) {
  throw new Error(`s5-buckets-volume: FAIL — ${message}`);
}

function psql(db, sql) {
  const run = spawnSync(
    "docker",
    ["exec", "legalos-instance-postgres-1", "psql", "-U", "legalos", "-d", db, "-tAc", sql],
    { encoding: "utf8" },
  );
  if (run.status !== 0) fail(run.stderr?.slice(0, 400) || `psql ${db}`);
  return run.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redemarrerPowersync() {
  const run = spawnSync("docker", ["restart", "legalos-instance-powersync-1"], {
    encoding: "utf8",
  });
  if (run.status !== 0) fail("redémarrage PowerSync");
}

function actif() {
  return psql("powersync_storage", "SELECT id FROM powersync.sync_rules WHERE state = 'ACTIVE'");
}

function tousLesBuckets() {
  const id = actif();
  if (!id) return -1;
  return Number(
    psql(
      "powersync_storage",
      `SELECT count(DISTINCT bucket_name) FROM powersync.bucket_data WHERE group_id = ${Number(id)}`,
    ),
  );
}

function bucketsUtilisateur(groupeId) {
  const id = actif();
  if (!id) return -1;
  const sql = `
    SELECT count(DISTINCT bucket_name)
    FROM powersync.bucket_data
    WHERE group_id = ${Number(id)}
      AND (
        bucket_name NOT LIKE '%restreint%'
        OR bucket_name LIKE '%${groupeId}%'
      )`;
  return Number(psql("powersync_storage", sql));
}

async function attendreBuckets(groupeId) {
  let dernier = -2;
  let stable = 0;
  for (let i = 0; i < 40; i += 1) {
    const n = bucketsUtilisateur(groupeId);
    const fait = psql(
      "powersync_storage",
      "SELECT snapshot_done FROM powersync.sync_rules WHERE state = 'ACTIVE'",
    );
    if (n === dernier && n >= 0 && fait === "t") stable += 1;
    else stable = 0;
    dernier = n;
    if (stable >= 3) return n;
    await sleep(2000);
  }
  return dernier;
}

function preparer(limite, utilisateur, autre) {
  psql(
    "legalos",
    `
    INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, restreint, visibilite)
    SELECT gen_random_uuid(), u.cabinet_id, 'Volume ' || g, 'kraft', 'TJ fictif',
           'RG-VOL-' || g,
           g <= 300,
           CASE WHEN g <= 300 THEN 'restreint' ELSE 'public' END
    FROM generate_series(1, ${limite}) AS g
    JOIN utilisateurs u ON u.id = '${utilisateur}'
    WHERE NOT EXISTS (
      SELECT 1 FROM dossiers d WHERE d.numero_rg = 'RG-VOL-' || g
    )`,
  );
  psql(
    "legalos",
    `
    INSERT INTO dossier_acces (dossier_id, utilisateur_id, utilisateur_texte, dossier_texte)
    SELECT d.id, '${utilisateur}'::uuid, '${utilisateur}', d.id::text
    FROM dossiers d
    WHERE d.numero_rg LIKE 'RG-VOL-%'
      AND d.restreint
      AND substring(d.numero_rg from 8)::int <= ${limite}
      AND substring(d.numero_rg from 8)::int <= 200
      AND NOT EXISTS (
        SELECT 1 FROM dossier_acces a
        WHERE a.dossier_id = d.id AND a.utilisateur_id = '${utilisateur}'::uuid
      )`,
  );
  psql(
    "legalos",
    `
    INSERT INTO dossier_acces (dossier_id, utilisateur_id, utilisateur_texte, dossier_texte)
    SELECT d.id, '${autre}'::uuid, '${autre}', d.id::text
    FROM dossiers d
    WHERE d.numero_rg LIKE 'RG-VOL-%'
      AND d.restreint
      AND substring(d.numero_rg from 8)::int BETWEEN 201 AND 300
      AND substring(d.numero_rg from 8)::int <= ${limite}
      AND NOT EXISTS (
        SELECT 1 FROM dossier_acces a
        WHERE a.dossier_id = d.id AND a.utilisateur_id = '${autre}'::uuid
      )`,
  );
}

async function main() {
  const cabinet = psql("legalos", "SELECT id FROM cabinets ORDER BY cree_le LIMIT 1");
  if (!cabinet) fail("cabinet absent");
  let utilisateurs = psql(
    "legalos",
    `SELECT id FROM utilisateurs WHERE cabinet_id = '${cabinet}' ORDER BY cree_le`,
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (utilisateurs.length < 2) {
    const cree = psql(
      "legalos",
      `INSERT INTO utilisateurs (id, cabinet_id, email, password_hash)
       VALUES (gen_random_uuid(), '${cabinet}', 'volume-b@cabinet.example', 'volume-test-not-a-secret')
       RETURNING id`,
    );
    utilisateurs.push(cree);
  }
  const [moi, autre] = utilisateurs;
  preparer(300, moi, autre);
  const groupe = psql(
    "legalos",
    `SELECT groupe_acces FROM dossiers WHERE numero_rg = 'RG-VOL-1'`,
  );
  if (!groupe) fail("groupe d'accès absent après 300 dossiers");
  const a300 = await attendreBuckets(groupe);
  preparer(3000, moi, autre);
  const a3000 = await attendreBuckets(groupe);
  console.log(`s5-buckets-volume: buckets 300=${a300} 3000=${a3000}`);
  if (a300 !== a3000) fail(`buckets ${a300} puis ${a3000}`);
  if (!(a300 > 0 && a300 < 200)) fail(`buckets ${a300} hors de 1..199`);

  psql(
    "legalos",
    `INSERT INTO contacts (id, cabinet_id, nature, nom, siren, type_client)
     SELECT gen_random_uuid(), '${cabinet}', 'morale', 'Contact volume restreint', '123456789', 'professionnel'
     WHERE NOT EXISTS (
       SELECT 1 FROM contacts WHERE cabinet_id = '${cabinet}' AND nom = 'Contact volume restreint'
     )`,
  );
  psql(
    "legalos",
    `INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, contact_id)
     SELECT gen_random_uuid(), d.id, d.cabinet_id, 'client', c.nom, c.id
     FROM dossiers d
     JOIN contacts c ON c.cabinet_id = d.cabinet_id AND c.nom = 'Contact volume restreint'
     WHERE d.numero_rg = 'RG-VOL-1'
       AND NOT EXISTS (
         SELECT 1 FROM parties p WHERE p.dossier_id = d.id AND p.contact_id = c.id
       )`,
  );
  const annuaire = psql(
    "legalos",
    `SELECT count(*) FROM contacts WHERE cabinet_id = '${cabinet}' AND nom = 'Contact volume restreint' AND siren = '123456789'`,
  );
  if (annuaire !== "1") fail("contact de dossier restreint absent de l'annuaire");
  const historiqueAutre = psql(
    "legalos",
    `SELECT count(*) FROM parties p
     JOIN contacts c ON c.id = p.contact_id
     WHERE c.nom = 'Contact volume restreint'
       AND EXISTS (
         SELECT 1 FROM groupe_acces_membres m
         WHERE m.groupe_id = p.groupe_acces AND m.utilisateur_texte = '${autre}'
       )`,
  );
  if (historiqueAutre !== "0") fail("historique du contact visible hors groupe");

  writeFileSync(syncPath, readFileSync(fixture, "utf8"));
  redemarrerPowersync();
  let erreur = "";
  let trop = 0;
  for (let i = 0; i < 24; i += 1) {
    await sleep(5000);
    erreur = psql(
      "powersync_storage",
      "SELECT coalesce(last_fatal_error, '') FROM powersync.sync_rules WHERE state = 'ACTIVE'",
    );
    trop = tousLesBuckets();
    if (erreur.includes("PSYNC_S2305") || trop > 1000) break;
  }
  const logs = spawnSync("docker", ["logs", "--since", "120s", "legalos-instance-powersync-1"], {
    encoding: "utf8",
  });
  const journal = `${erreur}\n${logs.stdout}\n${logs.stderr}`;
  if (!journal.includes("PSYNC_S2305") && !(trop > 1000)) {
    fail(`l'ancienne configuration n'a pas atteint PSYNC_S2305 (buckets=${trop})`);
  }
  console.log("s5-buckets-volume: ancienne configuration refusée");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    writeFileSync(syncPath, yamlBon);
    redemarrerPowersync();
  });
