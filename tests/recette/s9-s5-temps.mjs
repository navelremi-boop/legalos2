#!/usr/bin/env node
/**
 * S5 — temps_saisis / brouillons_facture / taux_horaires :
 * flux Sync Streams + preuve qu'un collaborateur hors dossier_acces
 * ne reçoit aucune ligne (filtre JOIN = auth.user_id()).
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const collabEmail = "collab-s9-s5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

function fail(message) {
  console.error(`s9-s5-temps: FAIL — ${message}`);
  process.exit(1);
}

function sqlServeur(requete) {
  return new Promise((resolve, reject) => {
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
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.slice(-200) || `psql ${code}`));
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

function verifierFluxStatiques() {
  const yaml = readFileSync(join(root, "instance/powersync/sync-config.yaml"), "utf8");
  for (const flux of [
    "temps_publics",
    "temps_restreints",
    "brouillons_publics",
    "brouillons_restreints",
    "taux_cabinet",
    "taux_publics",
    "taux_restreints",
  ]) {
    if (!new RegExp(`^  ${flux}:`, "m").test(yaml)) fail(`flux ${flux} absent`);
  }
  if (!/\bFROM temps_saisis\b/i.test(yaml)) fail("temps_saisis absent des Sync Streams");
  if (!/\bFROM brouillons_facture\b/i.test(yaml)) fail("brouillons_facture absents des Sync Streams");
  if (!/\bFROM taux_horaires\b/i.test(yaml)) fail("taux_horaires absents des Sync Streams");
  for (const flux of ["temps_restreints", "brouillons_restreints", "taux_restreints"]) {
    const re = new RegExp(`^  ${flux}:[ \\t]*\\r?\\n([\\s\\S]*?)(?=^  [a-z_]+:|(?![\\s\\S]))`, "m");
    const m = yaml.match(re);
    if (!m) fail(`bloc ${flux} illisible`);
    if (!/INNER JOIN dossier_acces/i.test(m[1])) fail(`${flux} : JOIN dossier_acces requis (S5)`);
    if (!/auth\.user_id\(\)/.test(m[1])) fail(`${flux} : auth.user_id() requis`);
  }
  const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
  for (const table of ["temps_saisis", "brouillons_facture", "taux_horaires"]) {
    if (!schema.includes(table)) fail(`AppSchema : ${table} absente`);
  }
  console.log("s9-s5-temps: Sync Streams + AppSchema (temps, brouillons, taux)");
}

verifierFluxStatiques();

const sante = await fetch(`${instance}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");

const jeton = await demoAccessToken(api, "s9-s5-temps");
const creation = await fetch(`${api}/collaborateurs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
  body: JSON.stringify({
    email: collabEmail,
    password: collabPassword,
    totp_secret_base32: collabTotp,
  }),
});
if (!creation.ok && creation.status !== 409) {
  fail(`collaborateur ${creation.status}`);
}

const dossierId = randomUUID();
await json("/dossiers", jeton, "POST", {
  id: dossierId,
  idempotence_cle: `${dossierId}:dossier`,
  nom: "Dossier restreint S5 temps",
  chemise: "kraft",
  juridiction: "TJ de Lyon",
  numero_rg: `RG${String(Date.now()).slice(-6)}S`,
  restreint: true,
});

const tempsId = randomUUID();
await json("/temps", jeton, "POST", {
  id: tempsId,
  dossier_id: dossierId,
  minutes: 30,
  libelle: "Temps restreint fictif",
  taux_centimes_heure: 12_000,
  idempotence_cle: `${tempsId}:temps`,
});
const brouillonId = randomUUID();
await json("/brouillons-facture", jeton, "POST", {
  id: brouillonId,
  dossier_id: dossierId,
  temps_id: tempsId,
  libelle: "Temps restreint fictif",
  ht_centimes: 6_000,
  taux_centimes_heure: 12_000,
  idempotence_cle: `${brouillonId}:brouillon`,
});
const tauxId = randomUUID();
await json("/taux-horaires", jeton, "POST", {
  id: tauxId,
  centimes_par_heure: 12_000,
  dossier_id: dossierId,
  idempotence_cle: `${tauxId}:taux`,
});

const visTemps = await sqlServeur(
  `SELECT visibilite FROM temps_saisis WHERE id = '${tempsId}'`,
);
if (visTemps !== "restreint") fail(`copie visibilité temps (${visTemps})`);
const visBrouillon = await sqlServeur(
  `SELECT visibilite FROM brouillons_facture WHERE id = '${brouillonId}'`,
);
if (visBrouillon !== "restreint") fail(`copie visibilité brouillon (${visBrouillon})`);

const demoUserId = await sqlServeur(
  `SELECT id FROM utilisateurs WHERE email = 'demo@cabinet-fictif.example' LIMIT 1`,
);
const collabUserId = await sqlServeur(
  `SELECT id FROM utilisateurs WHERE email = '${collabEmail}' LIMIT 1`,
);
if (!demoUserId || !collabUserId) fail("identifiants utilisateurs absents");

const accesCollab = await sqlServeur(
  `SELECT COUNT(*) FROM dossier_acces WHERE dossier_id = '${dossierId}' AND utilisateur_texte = '${collabUserId}'`,
);
if (accesCollab !== "0") fail(`collaborateur déjà dans dossier_acces (${accesCollab})`);

const tempsChezCollab = await sqlServeur(
  `SELECT COUNT(*) FROM temps_saisis t INNER JOIN dossier_acces a ON t.dossier_id = a.dossier_id WHERE t.id = '${tempsId}' AND a.utilisateur_texte = '${collabUserId}'`,
);
if (tempsChezCollab !== "0") fail(`temps visible pour poste non autorisé (${tempsChezCollab})`);

const brouillonChezCollab = await sqlServeur(
  `SELECT COUNT(*) FROM brouillons_facture b INNER JOIN dossier_acces a ON b.dossier_id = a.dossier_id WHERE b.id = '${brouillonId}' AND a.utilisateur_texte = '${collabUserId}'`,
);
if (brouillonChezCollab !== "0") {
  fail(`brouillon visible pour poste non autorisé (${brouillonChezCollab})`);
}

const tauxChezCollab = await sqlServeur(
  `SELECT COUNT(*) FROM taux_horaires t INNER JOIN dossier_acces a ON t.dossier_id = a.dossier_id WHERE t.id = '${tauxId}' AND a.utilisateur_texte = '${collabUserId}'`,
);
if (tauxChezCollab !== "0") fail(`taux visible pour poste non autorisé (${tauxChezCollab})`);

const tempsChezDemo = await sqlServeur(
  `SELECT COUNT(*) FROM temps_saisis t INNER JOIN dossier_acces a ON t.dossier_id = a.dossier_id WHERE t.id = '${tempsId}' AND a.utilisateur_texte = '${demoUserId}'`,
);
if (tempsChezDemo !== "1") fail(`temps absent pour titulaire (${tempsChezDemo})`);

console.log("s9-s5-temps: OK — poste non autorisé : 0 ligne temps/brouillon/taux");
