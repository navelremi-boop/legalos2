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
import { demoAccessToken, demoEmail } from "./lib/demo-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const envFile = existsSync(join(root, ".env"))
  ? join(root, ".env")
  : join(root, "..", "..", ".env");

function fail(message) {
  throw new Error(message);
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

const migration017 = readFileSync(join(root, "crates/api/migrations/017_reference_modele.sql"), "utf8");
if (!/reference_modele/.test(migration017) || !/sequences_dossiers_continues/.test(migration017)) {
  fail("migration 017 incomplète");
}
if (!/reference_classement/.test(migration017) || !/dossiers_cabinet_classement_unique/.test(migration017)) {
  fail("migration 017 : forme de classement absente");
}
const migration018 = readFileSync(join(root, "crates/api/migrations/018_dossier_responsable.sql"), "utf8");
if (!/responsable_id/.test(migration018) || !/auteur_id/.test(migration018)) {
  fail("migration 018 incomplète");
}
if (/\bDROP\b|\bRENAME\b|\bDELETE\b/i.test(migration018)) {
  fail("migration 018 non additive");
}
const yaml = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
if (!/cabinet_global:[\s\S]*?reference_modele/.test(yaml)) {
  fail("sync-config : reference_modele absent de cabinet_global");
}
if (!/cabinet_global:[\s\S]*?reference_remise_a_zero/.test(yaml)) {
  fail("sync-config : reference_remise_a_zero absent de cabinet_global");
}
if (!/dossiers_publics:[\s\S]*?responsable_id/.test(yaml)) {
  fail("sync-config : responsable_id absent de dossiers_publics");
}
if (!/dossiers_restreints:[\s\S]*?responsable_id/.test(yaml)) {
  fail("sync-config : responsable_id absent de dossiers_restreints");
}
const blocCabinet = yaml.match(/cabinet_global:[\s\S]*?(?=\n  [a-z_]+:|\n*$)/)?.[0] ?? "";
if (/auteur_id/.test(blocCabinet)) {
  fail("sync-config : auteur_id ne doit pas être dans cabinet_global");
}
if (/initiales/.test(blocCabinet)) {
  fail("sync-config : initiales ne doivent pas être synchronisées");
}

const vecteurs = JSON.parse(
  readFileSync(join(root, "crates/domaine/tests/reference-vecteurs.json"), "utf8"),
);
if (!Array.isArray(vecteurs.normalisations) || vecteurs.normalisations.length === 0) {
  fail("vecteurs.normalisations vides");
}

let jeton;
let cabinetId;
let utilisateurA;
let annee;
let aa;
let etatA;
const crees = [];
let exitCode = 0;

async function dernierNumero() {
  const r = await sqlServeur(
    `SELECT COALESCE(MAX(reference_numero), 0) FROM dossiers WHERE cabinet_id = '${cabinetId}'`,
  );
  if (r.code !== 0) fail(`dernier numéro : ${r.err || r.out}`);
  return Number(r.out);
}

async function restaurerDefaut() {
  if (!jeton || !cabinetId) return;
  const depart = (await dernierNumero()) + 1;
  await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `restore-${randomUUID()}`,
    modele: "{AAAA}-{N:3}",
    remise_a_zero: "annuelle",
    numero_depart: depart,
  });
}

async function creerDossier(suffixe, extras = {}) {
  const id = randomUUID();
  const corps = await json(jeton, "/dossiers", "POST", {
    id,
    idempotence_cle: `${id}:dossier`,
    nom: `Dossier fictif modèle ${suffixe}`,
    chemise: "kraft",
    juridiction: "TJ de Lyon",
    numero_rg: `RG${String(Date.now()).slice(-5)}${suffixe}`,
    restreint: false,
    ...extras,
  });
  crees.push(id);
  return { id, ...corps };
}

async function referenceEnBase(id) {
  const r = await sqlServeur(`SELECT reference FROM dossiers WHERE id = '${id}'`);
  if (r.code !== 0) fail(`lecture référence : ${r.err || r.out}`);
  return r.out;
}

async function executer() {
  const colonnes = await sqlServeur(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'cabinets' AND column_name = 'reference_modele'",
  );
  if (colonnes.out !== "1") fail("colonne cabinets.reference_modele absente (migration 017)");
  const colResp = await sqlServeur(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'dossiers' AND column_name = 'responsable_id'",
  );
  if (colResp.out !== "1") fail("colonne dossiers.responsable_id absente (migration 018)");
  const colAuteur = await sqlServeur(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_modifications' AND column_name = 'auteur_id'",
  );
  if (colAuteur.out !== "1") fail("colonne journal_modifications.auteur_id absente (migration 018)");

  jeton = await demoAccessToken(api, "reference-modele");
  const moi = await json(jeton, "/cabinets/me", "GET");
  cabinetId = moi.id;
  if (!cabinetId) fail("cabinet_id absent de /cabinets/me");

  const userA = await sqlServeur(
    `SELECT id FROM utilisateurs WHERE cabinet_id = '${cabinetId}' AND email = '${demoEmail}'`,
  );
  if (userA.code !== 0 || !/^[0-9a-f-]{36}$/i.test(userA.out)) {
    fail(`utilisateur démo A : ${userA.err || userA.out}`);
  }
  utilisateurA = userA.out;

  const anneeRes = await sqlServeur(
    "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
  );
  if (anneeRes.code !== 0) fail(`année civile : ${anneeRes.err || anneeRes.out}`);
  annee = Number(anneeRes.out);
  if (!Number.isInteger(annee) || annee < 2000) fail(`année invalide ${anneeRes.out}`);
  aa = String(annee).slice(-2);

  // (a) GET défaut
  etatA = await json(jeton, `/cabinets/${cabinetId}/reference`, "GET");
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

  // (i) collision + numero_depart_minimal (référence purement numérique encore atteignable)
  const seqContEstime = await sqlServeur(
    `SELECT COALESCE(
       (SELECT prochain FROM sequences_dossiers_continues WHERE cabinet_id = '${cabinetId}'),
       1
     )`,
  );
  const seqAnnEstime = await sqlServeur(
    `SELECT COALESCE(
       (SELECT prochain FROM sequences_dossiers WHERE cabinet_id = '${cabinetId}' AND annee = ${annee}),
       1
     )`,
  );
  const prochainJamaisEstime = Math.max(
    Number(seqContEstime.out) || 1,
    Number(seqAnnEstime.out) || 1,
    (await dernierNumero()) + 1,
    1,
  );
  const idCollision = randomUUID();
  const numCollision = prochainJamaisEstime;
  const insertCollision = await sqlServeur(
    `INSERT INTO dossiers (
       id, cabinet_id, nom, chemise, juridiction, numero_rg,
       reference, reference_annee, reference_numero, restreint, visibilite, revision
     ) VALUES (
       '${idCollision}', '${cabinetId}', 'fictif collision N', 'kraft', 'x', 'RG-COLL',
       '${numCollision}', 2019, ${numCollision}, false, 'public', 1
     )`,
  );
  if (insertCollision.code !== 0) {
    fail(`(i) insert collision : ${insertCollision.err || insertCollision.out}`);
  }
  crees.push(idCollision);
  const collision = await envoyer(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `modele-i-${randomUUID()}`,
    modele: "{N}",
    remise_a_zero: "jamais",
  });
  if (collision.statut !== 409 || collision.corps.code !== "reference_existante") {
    fail(`(i) collision → ${collision.statut} ${JSON.stringify(collision.corps)}`);
  }
  if (
    typeof collision.corps.numero_depart_minimal !== "number" ||
    !Number.isInteger(collision.corps.numero_depart_minimal)
  ) {
    fail(`(i) numero_depart_minimal absent : ${JSON.stringify(collision.corps)}`);
  }
  if (collision.corps.numero_depart_minimal <= numCollision) {
    fail(
      `(i) numero_depart_minimal=${collision.corps.numero_depart_minimal} doit dépasser ${numCollision}`,
    );
  }
  if (
    typeof collision.corps.message !== "string" ||
    !collision.corps.message.includes(String(collision.corps.numero_depart_minimal))
  ) {
    fail(`(i) message sans numéro minimal : ${collision.corps.message}`);
  }
  const etatMinimal = await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `modele-i-ok-${randomUUID()}`,
    modele: "{N}",
    remise_a_zero: "jamais",
    numero_depart: collision.corps.numero_depart_minimal,
  });
  if (etatMinimal.prochain_numero !== collision.corps.numero_depart_minimal) {
    fail(
      `(i) PUT avec minimal → prochain ${etatMinimal.prochain_numero}, attendu ${collision.corps.numero_depart_minimal}`,
    );
  }
  console.log(
    `reference-modele: (i) 409 numero_depart_minimal=${collision.corps.numero_depart_minimal}, PUT OK`,
  );
  await restaurerDefaut();

  // Casse / classement : référence en minuscules encore atteignable sous « jamais ».
  const idCasse = randomUUID();
  // Après le PUT réussi, la séquence continue est à numCollision+1 ; un numéro encore
  // atteignable (égal au prochain estimé) provoque le 409, y compris en minuscules.
  const seqApres = await sqlServeur(
    `SELECT COALESCE(
       (SELECT prochain FROM sequences_dossiers_continues WHERE cabinet_id = '${cabinetId}'),
       1
     )`,
  );
  const numCasse = Math.max(Number(seqApres.out) || 1, numCollision + 1);
  const refCasse = `md${numCasse}`;
  const insertCasse = await sqlServeur(
    `INSERT INTO dossiers (
       id, cabinet_id, nom, chemise, juridiction, numero_rg,
       reference, reference_annee, reference_numero, restreint, visibilite, revision
     ) VALUES (
       '${idCasse}', '${cabinetId}', 'fictif classement', 'kraft', 'x', 'RG-CASE',
       '${refCasse}', 2020, ${numCasse}, false, 'public', 1
     )`,
  );
  if (insertCasse.code !== 0) fail(`(i) insert casse : ${insertCasse.err || insertCasse.out}`);
  crees.push(idCasse);
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

  // (l) responsable ≠ créateur, initiales figées ; défaut = créateur
  const collab = {
    email: `bernard.dupont.${randomUUID().slice(0, 8)}@cabinet-fictif.example`,
    password: "MotDePasseCollab123!",
    totp_secret_base32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  };
  const creationB = await fetch(`${api}/collaborateurs`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: collab.email,
      password: collab.password,
      totp_secret_base32: collab.totp_secret_base32,
    }),
  });
  if (!creationB.ok) fail(`collaborateur B → ${creationB.status}`);
  const corpsB = await creationB.json();
  const utilisateurB = corpsB.id;
  if (!utilisateurB) fail("collaborateur B sans id");
  const setIniA = await sqlServeur(
    `UPDATE utilisateurs SET initiales = 'AA' WHERE id = '${utilisateurA}'`,
  );
  if (setIniA.code !== 0) fail(`initiales A : ${setIniA.err || setIniA.out}`);
  const setIniB = await sqlServeur(
    `UPDATE utilisateurs SET initiales = 'BB' WHERE id = '${utilisateurB}'`,
  );
  if (setIniB.code !== 0) fail(`initiales B : ${setIniB.err || setIniB.out}`);
  const iniA = await sqlServeur(`SELECT initiales FROM utilisateurs WHERE id = '${utilisateurA}'`);
  const iniB = await sqlServeur(`SELECT initiales FROM utilisateurs WHERE id = '${utilisateurB}'`);
  if (iniA.out !== "AA" || iniB.out !== "BB") {
    fail(`initiales A/B : ${iniA.out}/${iniB.out}`);
  }

  for (const modeleIni of ["{INI}-{N:3}", "{INI}{N:3}"]) {
    await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
      idempotence_cle: `modele-l-${randomUUID()}`,
      modele: modeleIni,
      // Sans jeton d'année : politique « jamais » (R0-a / R0-d).
      remise_a_zero: "jamais",
    });
    const avecB = await creerDossier(`lB${modeleIni.length}`, { responsable_id: utilisateurB });
    if (!String(avecB.reference).startsWith("BB")) {
      fail(`(l) ${modeleIni} attendu initiales BB, reçu ${avecB.reference}`);
    }
    if (String(avecB.reference).startsWith("AA")) {
      fail(`(l) ${modeleIni} porte les initiales du créateur A`);
    }
    const respB = await sqlServeur(
      `SELECT responsable_id::text FROM dossiers WHERE id = '${avecB.id}'`,
    );
    if (respB.out !== utilisateurB) {
      fail(`(l) responsable_id=${respB.out}, attendu B ${utilisateurB}`);
    }
    const rejeuB = await json(jeton, "/dossiers", "POST", {
      id: avecB.id,
      idempotence_cle: `${avecB.id}:dossier`,
      nom: "rejeu",
      chemise: "kraft",
      juridiction: "x",
      numero_rg: "RG-rejeu",
      restreint: false,
      responsable_id: utilisateurA,
    });
    if (rejeuB.reference !== avecB.reference) {
      fail(`(l) rejeu a changé la référence ${avecB.reference} → ${rejeuB.reference}`);
    }
    console.log(`reference-modele: (l) ${modeleIni} → ${avecB.reference} (responsable B)`);
  }

  await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: `modele-l-defaut-${randomUUID()}`,
    modele: "{INI}-{N:3}",
    remise_a_zero: "jamais",
  });
  const sansChamp = await creerDossier("lA");
  if (!String(sansChamp.reference).startsWith("AA")) {
    fail(`(l) sans responsable_id attendu AA, reçu ${sansChamp.reference}`);
  }
  const respA = await sqlServeur(
    `SELECT responsable_id::text FROM dossiers WHERE id = '${sansChamp.id}'`,
  );
  if (respA.out !== utilisateurA) {
    fail(`(l) défaut responsable_id=${respA.out}, attendu créateur ${utilisateurA}`);
  }
  const etranger = await envoyer(jeton, "/dossiers", "POST", {
    id: randomUUID(),
    idempotence_cle: `hors-cabinet-${randomUUID()}`,
    nom: "hors cabinet",
    chemise: "kraft",
    juridiction: "x",
    numero_rg: "RG-hors",
    restreint: false,
    responsable_id: "00000000-0000-4000-8000-000000000099",
  });
  if (etranger.statut !== 400) {
    fail(`(l) responsable hors cabinet → ${etranger.statut}`);
  }
  console.log("reference-modele: (l) responsable B / défaut créateur / 400 hors cabinet");
  await restaurerDefaut();

  // (m) auteur_id journalisé sur PUT référence
  const cleJournal = `modele-m-${randomUUID()}`;
  await json(jeton, `/cabinets/${cabinetId}/reference`, "PUT", {
    idempotence_cle: cleJournal,
    modele: "{AAAA}/{N:3}",
    remise_a_zero: "annuelle",
  });
  const journal = await sqlServeur(
    `SELECT auteur_id::text FROM journal_modifications
     WHERE cabinet_id = '${cabinetId}' AND champ = 'reference_modele'
       AND valeur_appliquee = '{AAAA}/{N:3}'
     ORDER BY cree_le DESC LIMIT 1`,
  );
  if (journal.out !== utilisateurA) {
    fail(`(m) auteur_id=${journal.out}, attendu ${utilisateurA}`);
  }
  console.log("reference-modele: (m) journal.auteur_id = utilisateur authentifié");
  await restaurerDefaut();

  // (n) expression du déclencheur 017 = forme de classement des vecteurs (majuscules ASCII).
  // Pas d'INSERT de la référence du vecteur : sa forme peut déjà exister (2026/042 et 2026-042).
  const expression = (refSql) =>
    `SELECT upper(regexp_replace('${refSql}', '[^A-Za-z0-9_-]', '-', 'g'))`;
  for (const cas of vecteurs.normalisations) {
    const refSql = cas.reference.replace(/'/g, "''");
    const calcul = await sqlServeur(expression(refSql));
    const attendu = String(cas.classement).toUpperCase();
    if (calcul.code !== 0 || calcul.out !== attendu) {
      fail(
        `(n) ${cas.reference} → ${calcul.out || calcul.err}, attendu ${attendu} (vecteur ${cas.classement})`,
      );
    }
  }
  const idPreuve = randomUUID();
  const preuve = `preuve${idPreuve.replace(/-/g, "")}`;
  const insertPreuve = await sqlServeur(
    `INSERT INTO dossiers (
       id, cabinet_id, nom, chemise, juridiction, numero_rg,
       reference, restreint, visibilite, revision
     ) VALUES (
       '${idPreuve}', '${cabinetId}', 'fictif classement vecteur', 'kraft', 'x', 'RG-${idPreuve.slice(0, 8)}',
       '${preuve}', false, 'public', 1
     )`,
  );
  if (insertPreuve.code !== 0) {
    fail(`(n) insert preuve déclencheur : ${insertPreuve.err || insertPreuve.out}`);
  }
  const classementPreuve = await sqlServeur(
    `SELECT reference_classement FROM dossiers WHERE id = '${idPreuve}'`,
  );
  const attenduPreuve = await sqlServeur(expression(preuve));
  if (classementPreuve.out !== attenduPreuve.out) {
    fail(
      `(n) déclencheur ${classementPreuve.out} ≠ expression ${attenduPreuve.out}`,
    );
  }
  const delPreuve = await sqlServeur(`DELETE FROM dossiers WHERE id = '${idPreuve}'`);
  if (delPreuve.code !== 0) fail(`(n) nettoyage preuve : ${delPreuve.err || delPreuve.out}`);
  console.log(`reference-modele: (n) ${vecteurs.normalisations.length} formes de classement`);

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
}

try {
  await executer();
  console.log("reference-modele: OK");
} catch (err) {
  exitCode = 1;
  console.error(`reference-modele: FAIL — ${err instanceof Error ? err.message : err}`);
} finally {
  try {
    if (crees.length > 0 && cabinetId) {
      const liste = crees.map((id) => `'${id}'`).join(",");
      const nettoyage = await sqlServeur(
        `DELETE FROM dossier_acces WHERE dossier_id IN (${liste});
         DELETE FROM parties WHERE dossier_id IN (${liste});
         DELETE FROM dossiers WHERE id IN (${liste}) OR (cabinet_id = '${cabinetId}' AND reference ~ '^md[0-9]+$');
         UPDATE sequences_dossiers SET prochain = ${etatA?.prochain_numero ?? 1}
           WHERE cabinet_id = '${cabinetId}' AND annee = ${annee ?? 2000};`,
      );
      if (nettoyage.code !== 0) {
        console.error(`reference-modele: nettoyage — ${nettoyage.err || nettoyage.out}`);
        exitCode = 1;
      }
    } else if (cabinetId) {
      await sqlServeur(
        `DELETE FROM dossiers WHERE cabinet_id = '${cabinetId}' AND reference ~ '^md[0-9]+$'`,
      );
    }
    await restaurerDefaut();
  } catch (err) {
    console.error(
      `reference-modele: restauration — ${err instanceof Error ? err.message : err}`,
    );
    exitCode = 1;
  }
  process.exit(exitCode);
}
