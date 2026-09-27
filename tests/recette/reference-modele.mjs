#!/usr/bin/env node
/**
 * Modèle de référence personnalisable (R0) — acceptation API / Postgres.
 * Usage : node tests/recette/reference-modele.mjs
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const envFile = existsSync(join(root, ".env"))
  ? join(root, ".env")
  : join(root, "..", "..", ".env");

function fail(message) {
  console.error(`reference-modele: FAIL — ${message}`);
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
        envFile,
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

async function envoyer(jeton, chemin, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  let donnees = {};
  try {
    donnees = texte ? JSON.parse(texte) : {};
  } catch {
    donnees = { brut: texte.slice(0, 200) };
  }
  return { statut: reponse.status, corps: donnees };
}

async function json(jeton, chemin, methode, corps) {
  const r = await envoyer(jeton, chemin, methode, corps);
  if (r.statut < 200 || r.statut >= 300) {
    fail(`${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps).slice(0, 220)}`);
  }
  return r.corps;
}

const migration = readFileSync(join(root, "crates/api/migrations/017_reference_modele.sql"), "utf8");
if (!/reference_modele/.test(migration) || !/sequences_dossiers_continues/.test(migration)) {
  fail("migration 017 incomplète");
}
if (!/reference_classement/.test(migration) || !/dossiers_cabinet_classement_unique/.test(migration)) {
  fail("migration 017 : forme de classement absente");
}
const yaml = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
if (!/cabinet_global:[\s\S]*?reference_modele/.test(yaml)) {
  fail("sync-config : reference_modele absent de cabinet_global");
}
if (!/cabinet_global:[\s\S]*?reference_remise_a_zero/.test(yaml)) {
  fail("sync-config : reference_remise_a_zero absent de cabinet_global");
}
if (/cabinet_global:[\s\S]*?initiales/.test(yaml)) {
  fail("sync-config : initiales ne doivent pas être synchronisées");
}

const colonnes = await sqlServeur(
  "SELECT 1 FROM information_schema.columns WHERE table_name = 'cabinets' AND column_name = 'reference_modele'",
);
if (colonnes.out !== "1") fail("colonne cabinets.reference_modele absente (migration 017)");

const jeton = await demoAccessToken(api, "reference-modele");
const moi = await json(jeton, "/cabinets/me", "GET");
const cabinetId = moi.id;
if (!cabinetId) fail("cabinet_id absent de /cabinets/me");

const anneeRes = await sqlServeur(
  "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
);
if (anneeRes.code !== 0) fail(`année civile : ${anneeRes.err || anneeRes.out}`);
const annee = Number(anneeRes.out);
if (!Number.isInteger(annee) || annee < 2000) fail(`année invalide ${anneeRes.out}`);
const aa = String(annee).slice(-2);

async function dernierNumero() {
  const r = await sqlServeur(
    `SELECT COALESCE(MAX(reference_numero), 0) FROM dossiers WHERE cabinet_id = '${cabinetId}'`,
  );
  if (r.code !== 0) fail(`dernier numéro : ${r.err || r.out}`);
  return Number(r.out);
}

async function restaurerDefaut() {
  const depart = (await dernierNumero()) + 1;
  await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `restore-${randomUUID()}`,
    modele: "{AAAA}-{N:3}",
    remise_a_zero: "annuelle",
    numero_depart: depart,
  });
}

const crees = [];

async function creerDossier(suffixe) {
  const id = randomUUID();
  const corps = await json(jeton, "/dossiers", "POST", {
    id,
    idempotence_cle: `${id}:dossier`,
    nom: `Dossier fictif modèle ${suffixe}`,
    chemise: "kraft",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-5)}${suffixe}`,
    restreint: false,
  });
  crees.push(id);
  return { id, ...corps };
}

async function referenceEnBase(id) {
  const r = await sqlServeur(`SELECT reference FROM dossiers WHERE id = '${id}'`);
  if (r.code !== 0) fail(`lecture référence : ${r.err || r.out}`);
  return r.out;
}

// (a) GET défaut
const etatA = await json(jeton, `/cabinets/${cabinetId}/reference`, "GET");
if (etatA.modele !== "{AAAA}-{N:3}") fail(`(a) modèle défaut ${etatA.modele}`);
if (etatA.remise_a_zero !== "annuelle") fail(`(a) remise ${etatA.remise_a_zero}`);
if (!Number.isInteger(etatA.annee) || etatA.annee !== annee) fail(`(a) année ${etatA.annee}`);
if (!Number.isInteger(etatA.prochain_numero) || etatA.prochain_numero < 1) {
  fail(`(a) prochain ${etatA.prochain_numero}`);
}
if (typeof etatA.initiales !== "string" || etatA.initiales.length === 0) {
  fail("(a) initiales vides");
}
console.log(`reference-modele: (a) GET défaut ${etatA.modele} n° ${etatA.prochain_numero} ${etatA.initiales}`);

// (k) non-régression sans PUT
const dk = await creerDossier("k");
if (!new RegExp(`^${annee}-\\d{3,}$`).test(dk.reference)) {
  fail(`(k) format défaut attendu ${annee}-NNN, reçu ${dk.reference}`);
}
console.log(`reference-modele: (k) sans PUT → ${dk.reference}`);

// (b) {AAAA}/{N:3} et slash intact
await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-b-${randomUUID()}`,
  modele: "{AAAA}/{N:3}",
  remise_a_zero: "annuelle",
});
const db = await creerDossier("b");
if (!new RegExp(`^${annee}/\\d{3,}$`).test(db.reference) || !db.reference.includes("/")) {
  fail(`(b) attendu ${annee}/NNN, reçu ${db.reference}`);
}
const enBaseB = await referenceEnBase(db.id);
if (enBaseB !== db.reference || !enBaseB.includes("/")) {
  fail(`(b) slash altéré en base ${enBaseB}`);
}
console.log(`reference-modele: (b) ${db.reference}`);
await restaurerDefaut();

// (c) RN/{AA}/{N:4}
await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-c-${randomUUID()}`,
  modele: "RN/{AA}/{N:4}",
  remise_a_zero: "annuelle",
});
const dc = await creerDossier("c");
if (!new RegExp(`^RN/${aa}/\\d{4,}$`).test(dc.reference)) {
  fail(`(c) attendu RN/${aa}/NNNN, reçu ${dc.reference}`);
}
console.log(`reference-modele: (c) ${dc.reference}`);
await restaurerDefaut();

// (d) {N}/{AAAA}
await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-d-${randomUUID()}`,
  modele: "{N}/{AAAA}",
  remise_a_zero: "annuelle",
});
const dd = await creerDossier("d");
if (!new RegExp(`^\\d+/${annee}$`).test(dd.reference)) {
  fail(`(d) attendu N/${annee}, reçu ${dd.reference}`);
}
console.log(`reference-modele: (d) ${dd.reference}`);
await restaurerDefaut();

// (e) sans séparateur
await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-e-${randomUUID()}`,
  modele: "{AAAA}{N:4}",
  remise_a_zero: "annuelle",
});
const de = await creerDossier("e");
if (!new RegExp(`^${annee}\\d{4,}$`).test(de.reference)) {
  fail(`(e) attendu ${annee}NNNN, reçu ${de.reference}`);
}
console.log(`reference-modele: (e) ${de.reference}`);

// (i) collision : le texte sans séparateur serait relue comme {N}
const collision = await envoyer(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-i-${randomUUID()}`,
  modele: "{N}",
  remise_a_zero: "jamais",
});
if (collision.statut !== 409 || collision.corps.code !== "reference_existante") {
  fail(`(i) collision → ${collision.statut} ${JSON.stringify(collision.corps)}`);
}
const insertCasse = await sqlServeur(
  `INSERT INTO dossiers (
     id, cabinet_id, nom, chemise, juridiction, numero_rg,
     reference, reference_annee, reference_numero, restreint, visibilite, revision
   ) VALUES (
     gen_random_uuid(), '${cabinetId}', 'fictif classement', 'kraft', 'x', 'RG-CASE',
     'md8888', 2020, 3, false, 'public', 1
   )`,
);
if (insertCasse.code !== 0) fail(`(i) insert casse : ${insertCasse.err || insertCasse.out}`);
const collisionCasse = await envoyer(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-i-casse-${randomUUID()}`,
  modele: "{INI}{N:4}",
  remise_a_zero: "jamais",
});
if (collisionCasse.statut !== 409 || collisionCasse.corps.code !== "reference_existante") {
  fail(`(i) casse → ${collisionCasse.statut} ${JSON.stringify(collisionCasse.corps)}`);
}
console.log("reference-modele: (i) 409 reference_existante (y compris casse / classement)");
await restaurerDefaut();

// (f) politique jamais
await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-f-${randomUUID()}`,
  modele: "{AAAA}-{N:3}",
  remise_a_zero: "jamais",
});
const df1 = await creerDossier("f1");
const seqCont = await sqlServeur(
  `SELECT prochain FROM sequences_dossiers_continues WHERE cabinet_id = '${cabinetId}'`,
);
if (seqCont.code !== 0 || !/^\d+$/.test(seqCont.out)) {
  fail(`(f) sequences_dossiers_continues : ${seqCont.err || seqCont.out}`);
}
const df2 = await creerDossier("f2");
const n1 = Number(String(df1.reference).split("-")[1]);
const n2 = Number(String(df2.reference).split("-")[1]);
if (n2 !== n1 + 1) fail(`(f) numéros non continus ${df1.reference} / ${df2.reference}`);
console.log(`reference-modele: (f) jamais ${df1.reference} → ${df2.reference}, seq ${seqCont.out}`);
await restaurerDefaut();

// (g) numéro de départ
const dernierG = await dernierNumero();
const departOk = dernierG + 5;
const etatG = await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-g-${randomUUID()}`,
  modele: "{AAAA}-{N:3}",
  remise_a_zero: "annuelle",
  numero_depart: departOk,
});
if (etatG.prochain_numero !== departOk) {
  fail(`(g) prochain ${etatG.prochain_numero}, attendu ${departOk}`);
}
const refuseG = await envoyer(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: `modele-g-refus-${randomUUID()}`,
  modele: "{AAAA}-{N:3}",
  remise_a_zero: "annuelle",
  numero_depart: dernierG,
});
if (refuseG.statut !== 400 || refuseG.corps.code !== "numero_depart_invalide") {
  fail(`(g) refus → ${refuseG.statut} ${JSON.stringify(refuseG.corps)}`);
}
console.log(`reference-modele: (g) numero_depart ${departOk}, refus ${dernierG}`);
await restaurerDefaut();

// (h) modèles invalides
const invalides = [
  { modele: "", remise_a_zero: "annuelle" },
  { modele: "{AAAA}-{X}-{N}", remise_a_zero: "annuelle" },
  { modele: "{AAAA}-DOSSIER", remise_a_zero: "annuelle" },
  { modele: "{N}-{N:3}-{AAAA}", remise_a_zero: "annuelle" },
  { modele: "RN-{N:3}", remise_a_zero: "annuelle" },
];
for (const corps of invalides) {
  const r = await envoyer(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `modele-h-${randomUUID()}`,
    ...corps,
  });
  if (r.statut !== 400 || r.corps.code !== "modele_invalide") {
    fail(`(h) ${JSON.stringify(corps)} → ${r.statut} ${JSON.stringify(r.corps)}`);
  }
  if (typeof r.corps.message !== "string" || r.corps.message.length === 0) {
    fail(`(h) message français absent pour ${JSON.stringify(corps)}`);
  }
}
console.log("reference-modele: (h) 400 modele_invalide");

// (j) rejeu PUT
const cleRejeu = `modele-j-${randomUUID()}`;
const premier = await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: cleRejeu,
  modele: "{AAAA}/{N:3}",
  remise_a_zero: "annuelle",
});
const rejeu = await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
  idempotence_cle: cleRejeu,
  modele: "RN/{AA}/{N:4}",
  remise_a_zero: "jamais",
  numero_depart: (await dernierNumero()) + 20,
});
if (rejeu.modele !== premier.modele || rejeu.remise_a_zero !== premier.remise_a_zero) {
  fail(`(j) rejeu a modifié l'état ${JSON.stringify(rejeu)}`);
}
if (rejeu.prochain_numero !== premier.prochain_numero) {
  fail(`(j) rejeu a changé le prochain ${premier.prochain_numero} → ${rejeu.prochain_numero}`);
}
console.log("reference-modele: (j) rejeu sans second effet");
await restaurerDefaut();

const openapi = await fetch(`${api}/openapi.json`, { signal: AbortSignal.timeout(15_000) });
if (!openapi.ok) fail(`openapi.json → ${openapi.status}`);
const spec = await openapi.json();
if (!spec.paths?.["/cabinets/{cabinet_id}/reference"]?.get) {
  fail("OpenAPI : GET /cabinets/{cabinet_id}/reference absent");
}
if (!spec.paths?.["/cabinets/{cabinet_id}/reference"]?.put) {
  fail("OpenAPI : PUT /cabinets/{cabinet_id}/reference absent");
}
console.log("reference-modele: OpenAPI GET/PUT reference");

if (crees.length > 0) {
  const liste = crees.map((id) => `'${id}'`).join(",");
  const nettoyage = await sqlServeur(
    `DELETE FROM dossier_acces WHERE dossier_id IN (${liste});
     DELETE FROM parties WHERE dossier_id IN (${liste});
     DELETE FROM dossiers WHERE id IN (${liste}) OR (cabinet_id = '${cabinetId}' AND reference = 'md8888');
     UPDATE sequences_dossiers SET prochain = ${etatA.prochain_numero}
       WHERE cabinet_id = '${cabinetId}' AND annee = ${annee};`,
  );
  if (nettoyage.code !== 0) fail(`nettoyage : ${nettoyage.err || nettoyage.out}`);
}

console.log("reference-modele: OK");
