/**
 * Seau PowerSync (consigne du 27/10/2026) : une passe n'ajoute qu'au plus 3 opérations par ligne
 * créée ou modifiée, et un poste déjà synchronisé ouvre la coque sur ses données locales.
 * Ne vide jamais le seau.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ecranDuPoste } from "../../apps/poste/src/sync/ecranDuPoste.ts";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const PLAFOND = 3;

function fail(message) {
  console.error(`seau-powersync: FAIL — ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`seau-powersync: ${message}`);
}

/** `true` si le nombre d'opérations tient dans le plafond, pour les lignes touchées. */
export function tientDansLePlafond(operations, lignes) {
  return lignes > 0 && operations <= PLAFOND * lignes;
}

function sql(requete) {
  const run = spawnSync(
    "docker",
    [
      "exec",
      "legalos-instance-postgres-1",
      "psql",
      "-U",
      "legalos",
      "-d",
      "powersync_storage",
      "-At",
      "-c",
      requete,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) fail(`postgres : ${(run.stderr || run.stdout || "").slice(-240)}`);
  return run.stdout.trim();
}

function sqlMetier(requete) {
  const run = spawnSync(
    "docker",
    ["exec", "legalos-instance-postgres-1", "psql", "-U", "legalos", "-d", "legalos", "-At", "-c", requete],
    { encoding: "utf8" },
  );
  if (run.status !== 0) fail(`postgres métier : ${(run.stderr || run.stdout || "").slice(-240)}`);
  return run.stdout.trim();
}

function photo(id) {
  const filtre = id === null ? "FALSE" : `row_id = '${id}' OR data LIKE '%${id}%'`;
  const [ops, lignes] = sql(
    `SELECT COUNT(*) || '|' || COUNT(DISTINCT row_id) FROM powersync.bucket_data WHERE ${filtre}`,
  ).split("|");
  return { ops: Number(ops), lignes: Number(lignes) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attendreStable(id, avant) {
  let dernier = avant;
  let stable = 0;
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    await sleep(500);
    const n = photo(id).ops;
    if (n === dernier && n > avant) stable += 1;
    else stable = 0;
    dernier = n;
    if (stable >= 3) return photo(id);
  }
  return photo(id);
}

async function main() {
  if (tientDansLePlafond(7, 2)) fail("sept opérations pour deux lignes passent le plafond");
  if (!tientDansLePlafond(6, 2)) fail("six opérations pour deux lignes sont refusées");
  ok("plafond : 3 opérations par ligne, essai négatif compris");

  const deja = ecranDuPoste({
    ecranPret: true,
    authenticated: true,
    localReady: true,
    forceLogin: false,
    syncDone: false,
    aUnJeton: true,
  });
  if (deja !== "coque") fail(`poste déjà synchronisé : ${deja}, coque attendue`);
  const premier = ecranDuPoste({
    ecranPret: true,
    authenticated: true,
    localReady: false,
    forceLogin: false,
    syncDone: false,
    aUnJeton: true,
  });
  if (premier !== "sync-initiale") fail(`premier poste : ${premier}, sync-initiale attendue`);
  ok("poste déjà synchronisé : coque sur les données locales, sans attendre le seau");

  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");

  const id = randomUUID();
  const avant = photo(id);
  const jeton = await demoAccessToken(api, `seau-${id.slice(0, 8)}`);
  const cree = await fetch(`${api}/contacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      id,
      idempotence_cle: `seau-creer-${id}`,
      nature: "physique",
      nom: "Contact fictif du seau",
      type_client: "particulier",
    }),
  });
  const texteCree = await cree.text();
  if (!cree.ok) fail(`création ${cree.status} ${texteCree.slice(0, 200)}`);
  const revision = JSON.parse(texteCree).revision;
  const modifie = await fetch(`${api}/contacts/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      base_revision: revision,
      idempotence_cle: `seau-modifier-${id}`,
      nom: "Contact fictif du seau, modifié",
    }),
  });
  if (!modifie.ok) fail(`modification ${modifie.status} ${(await modifie.text()).slice(0, 200)}`);

  const apres = await attendreStable(id, avant.ops);
  const ajoutees = apres.ops - avant.ops;
  const lignes = Math.max(apres.lignes - avant.lignes, 1);
  if (ajoutees <= 0) fail(`aucune opération nouvelle pour le contact (${avant.ops} → ${apres.ops})`);
  if (!tientDansLePlafond(ajoutees, lignes)) {
    fail(`${ajoutees} opérations pour ${lignes} lignes (plafond ${PLAFOND * lignes})`);
  }
  ok(`${ajoutees} opérations pour ${lignes} lignes (création et modification), plafond ${PLAFOND} par ligne`);

  sqlMetier(`DELETE FROM contacts WHERE id = '${id}'`);
  ok("le contact fictif est retiré après la mesure ; le seau n'est pas vidé");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
