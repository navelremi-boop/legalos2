#!/usr/bin/env node
/**
 * Référence de dossier (§ 3.4) — acceptation API / Postgres.
 * Deux créations concurrentes → numéros distincts continus ; rejeu idempotent, y compris
 * dix envois simultanés du même dossier ; rejeu d'un dossier restreint refusé hors dossier_acces ;
 * unicité ; référence figée ; Sync Streams + OpenAPI ; libellé « Référence en attente » si null.
 * Usage : node tests/recette/reference-dossier-api.mjs
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`reference-dossier-api: FAIL — ${message}`);
  process.exit(1);
}

function sqlServeur(requete) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "-f",
        "instance/docker-compose.yml",
        "--env-file",
        ".env",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "legalos",
        "-d",
        "legalos",
        "-tAc",
        requete,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, out: out.trim(), err: err.trim() });
    });
  });
}

async function json(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : {};
}

function verifierContrats() {
  const yaml = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
  if (!/dossiers_publics:[\s\S]*?\breference\b/.test(yaml)) {
    fail("sync-config : reference absente de dossiers_publics");
  }
  if (!/dossiers_restreints:[\s\S]*?\breference\b/.test(yaml)) {
    fail("sync-config : reference absente de dossiers_restreints");
  }
  const migration = readFileSync(
    join(root, "crates/api/migrations/016_dossier_reference.sql"),
    "utf8",
  );
  if (!/sequences_dossiers/.test(migration) || !/reference dossier immuable/.test(migration)) {
    fail("migration 016 incomplete");
  }
  const libPoste = join(root, "apps/poste/src/lib/referenceDossier.ts");
  try {
    const lib = readFileSync(libPoste, "utf8");
    if (!/en attente/.test(lib)) fail("contrat UI « en attente » absent côté poste");
  } catch {
    fail("apps/poste/src/lib/referenceDossier.ts manquant (coordination poste)");
  }
  console.log("reference-dossier-api: Sync Streams + migration 016 + contrat en attente");
}

verifierContrats();

const mig = await sqlServeur(
  "SELECT 1 FROM information_schema.columns WHERE table_name = 'dossiers' AND column_name = 'reference'",
);
if (mig.out !== "1") fail("colonne dossiers.reference absente (migration non appliquée)");

const jeton = await demoAccessToken(api, "reference-dossier-api");

const anneeRes = await sqlServeur(
  "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
);
if (anneeRes.code !== 0) fail(`année civile : ${anneeRes.err || anneeRes.out}`);
const annee = Number(anneeRes.out);
if (!Number.isInteger(annee) || annee < 2000) fail(`année invalide ${anneeRes.out}`);

async function creerDossier(suffixe) {
  const id = randomUUID();
  const corps = await json("/dossiers", jeton, "POST", {
    id,
    idempotence_cle: `${id}:dossier`,
    nom: `Dossier fictif référence ${suffixe}`,
    chemise: "kraft",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-5)}${suffixe}`,
    restreint: false,
  });
  return { id, ...corps };
}

const [da, db] = await Promise.all([creerDossier("a"), creerDossier("b")]);
const refs = [da.reference, db.reference].filter(Boolean).sort();
if (refs.length !== 2) fail(`références manquantes : ${JSON.stringify([da.reference, db.reference])}`);
const reFormat = new RegExp(`^${annee}-\\d{3,}$`);
if (!reFormat.test(refs[0]) || !reFormat.test(refs[1])) {
  fail(`format R0 attendu ${annee}-NNN, reçu ${refs.join(",")}`);
}
const numeros = refs.map((r) => Number(r.split("-")[1])).sort((x, y) => x - y);
if (numeros[1] !== numeros[0] + 1) {
  fail(`numéros non continus ${refs.join(",")} → ${numeros.join(",")}`);
}
console.log(`reference-dossier-api: concurrentes ${refs.join(" / ")} continues`);

const replay = await json("/dossiers", jeton, "POST", {
  id: da.id,
  idempotence_cle: `${da.id}:dossier-replay`,
  nom: "Ne doit pas changer la référence",
  chemise: "kraft",
  juridiction: "TJ de Lyon",
  numero_rg: "RG000000",
  restreint: false,
});
if (replay.reference !== da.reference) {
  fail(`idempotence : référence changée ${da.reference} → ${replay.reference}`);
}
console.log("reference-dossier-api: rejeu idempotent");

async function envoyer(jetonAppel, corps) {
  const reponse = await fetch(`${api}/dossiers`, {
    method: "POST",
    headers: { authorization: `Bearer ${jetonAppel}`, "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  let donnees = {};
  try {
    donnees = texte ? JSON.parse(texte) : {};
  } catch {
    donnees = { brut: texte.slice(0, 120) };
  }
  return { statut: reponse.status, corps: donnees };
}

// Rejeu concurrent du même dossier (poste qui réessaie) : aucune erreur, une seule référence.
{
  const id = randomUUID();
  const corps = {
    id,
    idempotence_cle: `${id}:dossier`,
    nom: "Dossier fictif rejeu concurrent",
    chemise: "kraft",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-5)}C`,
    restreint: false,
  };
  const reponses = await Promise.all(Array.from({ length: 10 }, () => envoyer(jeton, corps)));
  const statuts = reponses.map((r) => r.statut);
  if (statuts.some((s) => s !== 200)) {
    fail(`rejeu concurrent : statuts ${JSON.stringify(statuts)} (attendu dix 200)`);
  }
  const uniques = [...new Set(reponses.map((r) => r.corps.reference))];
  if (uniques.length !== 1 || !reFormat.test(String(uniques[0]))) {
    fail(`rejeu concurrent : références ${JSON.stringify(uniques)}`);
  }
  console.log(`reference-dossier-api: dix rejeux simultanés → 200, une seule référence (${uniques[0]})`);
}

// Dossier restreint : le rejeu par un collaborateur hors dossier_acces ne renvoie rien (§ 3.1).
{
  const collab = {
    email: "collab-reference@cabinet-fictif.example",
    password: "MotDePasseCollab123!",
    totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  };
  const creation = await fetch(`${api}/collaborateurs`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: collab.email,
      password: collab.password,
      totp_secret_base32: collab.totpSecret,
    }),
  });
  if (!creation.ok && creation.status !== 409) fail(`collaborateur → ${creation.status}`);
  const jetonCollab = await accessToken(api, { ...collab, nomAppareil: "reference-dossier-collab" });
  const id = randomUUID();
  const corps = {
    id,
    idempotence_cle: `${id}:dossier`,
    nom: "Dossier fictif restreint rejeu",
    chemise: "lilas",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-5)}X`,
    restreint: true,
  };
  const titulaire = await envoyer(jeton, corps);
  if (titulaire.statut !== 200 || !reFormat.test(String(titulaire.corps.reference))) {
    fail(`dossier restreint : création ${titulaire.statut} ${JSON.stringify(titulaire.corps)}`);
  }
  const etranger = await envoyer(jetonCollab, corps);
  if (etranger.statut !== 404) {
    fail(`rejeu restreint par un collaborateur hors accès : statut ${etranger.statut} (attendu 404)`);
  }
  if (JSON.stringify(etranger.corps).includes(titulaire.corps.reference)) {
    fail("rejeu restreint : la référence fuit vers un collaborateur hors accès");
  }
  const rejeuTitulaire = await envoyer(jeton, corps);
  if (rejeuTitulaire.statut !== 200 || rejeuTitulaire.corps.reference !== titulaire.corps.reference) {
    fail(`rejeu restreint par le titulaire : ${rejeuTitulaire.statut} ${rejeuTitulaire.corps.reference}`);
  }
  console.log("reference-dossier-api: rejeu restreint → 404 hors dossier_acces, référence inchangée pour le titulaire");
}

const doublon = await sqlServeur(
  `INSERT INTO dossiers (
     id, cabinet_id, nom, chemise, juridiction, numero_rg,
     reference, reference_annee, reference_numero, restreint, visibilite, revision
   )
   SELECT gen_random_uuid(), cabinet_id, 'doublon', 'kraft', 'x', 'RG-DUP',
          reference, reference_annee, reference_numero, false, 'public', 1
   FROM dossiers WHERE id = '${da.id}'`,
);
if (doublon.code === 0) fail("unicité (cabinet_id, reference) non appliquée");
if (!/unique|dossiers_cabinet_reference/i.test(doublon.err + doublon.out)) {
  fail(`unicité : erreur inattendue ${doublon.err || doublon.out}`);
}
console.log("reference-dossier-api: unicité refusée");

const fige = await sqlServeur(
  `UPDATE dossiers SET reference = '${annee}-999' WHERE id = '${da.id}'`,
);
if (fige.code === 0) fail("référence modifiable après attribution");
if (!/reference dossier immuable/i.test(fige.err + fige.out)) {
  fail(`immutabilité : erreur inattendue ${fige.err || fige.out}`);
}
const encore = await sqlServeur(`SELECT reference FROM dossiers WHERE id = '${da.id}'`);
if (encore.out !== da.reference) fail(`référence altérée en base : ${encore.out}`);
console.log("reference-dossier-api: référence figée");

const openapi = await fetch(`${api}/openapi.json`, { signal: AbortSignal.timeout(15_000) });
if (!openapi.ok) fail(`openapi.json → ${openapi.status}`);
const spec = await openapi.json();
const dossierSchema = spec.components?.schemas?.DossierResponse;
if (!dossierSchema?.properties?.reference) {
  fail("OpenAPI : DossierResponse.reference absent");
}
console.log("reference-dossier-api: OpenAPI expose reference");

console.log("reference-dossier-api: OK");
