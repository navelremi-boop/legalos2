#!/usr/bin/env node
/**
 * S9 — validation (numéro continu + PDF/CII serveur) → dépôt PA idempotent → statuts →
 * règlement partiel / encaissée → avoir (lignes) ; e-reporting particulier ; immutabilité.
 * Temps + brouillon hors ligne sur le poste : s9-poste-tauri.mjs (obligatoire).
 * Jeu schematron § 3.7 parallèle : s9-facturx.mjs.
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const pa = process.env.LEGALOS_PA_URL ?? "http://127.0.0.1:8090";
const posteRecette = join(root, "tests/recette/s9-poste-tauri.mjs");
const s5Recette = join(root, "tests/recette/s9-s5-temps.mjs");
const xsl = join(root, "tests/recette/en16931/EN16931-CII-validation.xslt");

function fail(message) {
  console.error(`s9: FAIL — ${message}`);
  process.exit(1);
}

/** Contrôle statique : temps / brouillons / taux dans Sync Streams (JOIN ≤ 2, S5 via dossier_acces). */
function verifierSyncRules() {
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
    if (!new RegExp(`^  ${flux}:`, "m").test(yaml)) fail(`sync-config : flux ${flux} absent`);
  }
  for (const table of ["temps_saisis", "brouillons_facture", "taux_horaires"]) {
    if (!new RegExp(`\\bFROM ${table}\\b`, "i").test(yaml)) {
      fail(`sync-config : ${table} absente`);
    }
  }
  if (!/INNER JOIN dossier_acces/i.test(yaml)) {
    fail("sync-config : JOIN dossier_acces requis pour flux restreints (S5)");
  }
  const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
  for (const table of ["temps_saisis", "brouillons_facture", "taux_horaires"]) {
    if (!schema.includes(table)) fail(`AppSchema : ${table} absente`);
  }
  console.log("s9: Sync Streams + AppSchema (temps, brouillons, taux)");
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

function run(cmd, args) {
  const enfant = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  if (enfant.status !== 0) {
    fail(
      `${cmd} ${args.join(" ")} → ${enfant.status}\n${(enfant.stderr || enfant.stdout || "").slice(-500)}`,
    );
  }
  return enfant.stdout ?? "";
}

function schematron(sourceXml, sortieSvrl) {
  const saxonCp = process.env.SAXON_CP;
  if (saxonCp) {
    run("java", [
      "-cp",
      saxonCp,
      "net.sf.saxon.Transform",
      `-s:${sourceXml}`,
      `-xsl:${xsl}`,
      `-o:${sortieSvrl}`,
    ]);
  } else {
    const rel = sourceXml.replace(/\\/g, "/").replace(root.replace(/\\/g, "/"), "/work");
    const outRel = sortieSvrl.replace(/\\/g, "/").replace(root.replace(/\\/g, "/"), "/work");
    run("docker", [
      "run",
      "--rm",
      "-v",
      `${root}:/work`,
      "-w",
      "/work",
      "eclipse-temurin:21-jre-alpine",
      "java",
      "-cp",
      "/work/target/Saxon-HE-12.5.jar:/work/target/xmlresolver-5.2.2.jar",
      "net.sf.saxon.Transform",
      `-s:${rel}`,
      "-xsl:/work/tests/recette/en16931/EN16931-CII-validation.xslt",
      `-o:${outRel}`,
    ]);
  }
  const rapport = readFileSync(sortieSvrl, "utf8");
  if (rapport.includes("failed-assert")) {
    fail(`schematron API : assertion en échec (${sourceXml})`);
  }
}

function veraPdf(pdfPath) {
  const verapdf = process.env.VERAPDF;
  if (verapdf) {
    const sortie = run(verapdf, ["--flavour", "3b", pdfPath]);
    if (!sortie.includes('isCompliant="true"')) fail("veraPDF API non conforme");
    return;
  }
  const rel = pdfPath.replace(/\\/g, "/").replace(root.replace(/\\/g, "/"), "/work");
  const sortie = run("docker", [
    "run",
    "--rm",
    "-v",
    `${root}:/work`,
    "-w",
    "/work",
    "eclipse-temurin:21-jre-alpine",
    "sh",
    "/work/target/verapdf/verapdf",
    "--flavour",
    "3b",
    rel,
  ]);
  if (!sortie.includes('isCompliant="true"')) fail("veraPDF API non conforme");
}

const sante = await fetch(`${instance}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");
const paSante = await fetch(`${pa}/health`).catch(() => null);
if (!paSante?.ok) fail("simulateur injoignable");
if (!existsSync(posteRecette)) {
  fail("s9-poste-tauri.mjs absent — preuve temps/brouillon hors ligne sur le poste requise");
}
if (!existsSync(s5Recette)) {
  fail("s9-s5-temps.mjs absent — preuve S5 temps/brouillons requise");
}
verifierSyncRules();

const jeton = await demoAccessToken(api, "s9-factures");
const dossierId = randomUUID();
await json("/dossiers", jeton, "POST", {
  id: dossierId,
  idempotence_cle: `${dossierId}:dossier`,
  nom: "Dossier facture fictive",
  chemise: "kraft",
  juridiction: "TJ de Lyon",
  numero_rg: `RG${String(Date.now()).slice(-6)}`,
  restreint: false,
});

const absent = randomUUID();
const refuse = await fetch(`${api}/factures`, {
  method: "POST",
  headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
  body: JSON.stringify({
    id: randomUUID(),
    dossier_id: absent,
    taux_tva_bp: 2000,
    lignes: [{ libelle: "x", nature: "honoraires", montant_ht_centimes: 100 }],
  }),
});
const refuseTexte = await refuse.text();
if (refuse.status === 200 || !refuseTexte.includes("Dossier introuvable")) {
  fail(`dossier absent accepté (${refuse.status} ${refuseTexte.slice(0, 120)})`);
}
console.log("s9: validation refuse un dossier absent (ne crée pas de dossier)");

const tauxId = randomUUID();
const taux = await json("/taux-horaires", jeton, "POST", {
  id: tauxId,
  centimes_par_heure: 12_000,
  dossier_id: dossierId,
  idempotence_cle: `${tauxId}:taux`,
});
if (taux.centimes_par_heure !== 12_000) fail("taux non enregistré");
const tempsId = randomUUID();
const temps = await json("/temps", jeton, "POST", {
  id: tempsId,
  dossier_id: dossierId,
  minutes: 30,
  libelle: "Temps fictif",
  taux_centimes_heure: 12_000,
  idempotence_cle: `${tempsId}:temps`,
});
if (temps.ht_centimes !== 6_000) fail(`HT temps ${temps.ht_centimes} (attendu 6000 = 30×12000/60)`);
const brouillonTempsId = randomUUID();
const brouillonTemps = await json("/brouillons-facture", jeton, "POST", {
  id: brouillonTempsId,
  dossier_id: dossierId,
  temps_id: tempsId,
  libelle: "Temps fictif",
  ht_centimes: 6_000,
  taux_centimes_heure: 12_000,
  idempotence_cle: `${brouillonTempsId}:brouillon`,
});
if (brouillonTemps.numero !== null) fail("brouillon synchronisé a déjà un numéro");
console.log("s9: taux paramétrable, HT calculé, numéro nul sur brouillon sync");

async function brouillon(ht, extras = {}) {
  const id = randomUUID();
  const cree = await json("/factures", jeton, "POST", {
    id,
    dossier_id: dossierId,
    taux_tva_bp: 2000,
    type_client: extras.type_client ?? "professionnel",
    lignes: extras.lignes ?? [
      { libelle: "Honoraires fictifs", nature: "honoraires", montant_ht_centimes: ht },
    ],
  });
  if (cree.numero !== null || cree.statut !== "brouillon") fail("le brouillon a déjà un numéro");
  return id;
}

const a = await brouillon(10_000);
const b = await brouillon(5_000);
const [va, vb] = await Promise.all([
  json(`/factures/${a}/valider`, jeton, "POST"),
  json(`/factures/${b}/valider`, jeton, "POST"),
]);
const numeros = [va.numero, vb.numero].sort((x, y) => x - y);
if (numeros[1] !== numeros[0] + 1) fail(`numéros non continus ${numeros.join(",")}`);

const cii = await fetch(`${api}/factures/${a}/cii`, {
  headers: { authorization: `Bearer ${jeton}` },
});
const xml = await cii.text();
if (!cii.ok || !xml.includes("urn:cen.eu:en16931:2017") || !xml.includes("100.00")) {
  fail(`cii ${cii.status}`);
}
const pdfResp = await fetch(`${api}/factures/${a}/pdf`, {
  headers: { authorization: `Bearer ${jeton}` },
});
if (!pdfResp.ok) fail(`pdf ${pdfResp.status}`);
const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());
if (pdfBuf.length < 1000 || pdfBuf.subarray(0, 4).toString() !== "%PDF") {
  fail("PDF serveur illisible");
}
mkdirSync(join(root, "target"), { recursive: true });
const ciiApi = join(root, "target/s9-api-facture-cii.xml");
const pdfApi = join(root, "target/s9-api-facture.pdf");
writeFileSync(ciiApi, xml);
writeFileSync(pdfApi, pdfBuf);
schematron(ciiApi, join(root, "target/svrl-s9-api.xml"));
veraPdf(pdfApi);
console.log("s9: numéros continus ; PDF+CII produits à la validation (schematron + veraPDF)");

const deboursId = await brouillon(0, {
  lignes: [
    { libelle: "Honoraires fictifs", nature: "honoraires", montant_ht_centimes: 10_000 },
    { libelle: "Débours fictifs", nature: "debours", montant_ht_centimes: 1_000 },
  ],
});
await json(`/factures/${deboursId}/valider`, jeton, "POST");
const ciiDebours = await fetch(`${api}/factures/${deboursId}/cii`, {
  headers: { authorization: `Bearer ${jeton}` },
}).then((r) => r.text());
if (!ciiDebours.includes("Débours") || !ciiDebours.includes("10.00")) {
  fail("CII sans débours réels (debours_centimes forcé à 0 ?)");
}
console.log("s9: CII porte les débours réels des lignes");

const cle = `emission-${a}`;
await json(`/factures/${a}/emettre`, jeton, "POST", { cle_idempotence: cle });
await json(`/factures/${a}/emettre`, jeton, "POST", { cle_idempotence: cle });
const statut = await fetch(`${pa}/v1/factures/${a}/statuts`).then((r) => r.json());
if (statut.statut !== "deposee") fail(`statut ${statut.statut}`);
console.log("s9: dépôt répété, une seule fiche plateforme");

const particulierId = await brouillon(10_000, { type_client: "particulier" });
await json(`/factures/${particulierId}/valider`, jeton, "POST");
await json(`/factures/${particulierId}/emettre`, jeton, "POST", {
  cle_idempotence: `e-report-${particulierId}`,
});
const envoiPart = await sqlServeur(
  `SELECT identifiant_pa FROM envois_plateforme WHERE facture_id = '${particulierId}'`,
);
if (!envoiPart.out.includes("e-reporting-")) {
  fail(`e-reporting particulier absent (${envoiPart.out})`);
}
const annuaire = await json("/annuaire/123456789", jeton, "GET");
if (!annuaire.adresse_facturation_electronique) fail("annuaire stub sans adresse");
console.log("s9: e-reporting particulier + annuaire PA");

await json(`/factures/${a}/encaissements`, jeton, "POST", {
  montant_centimes: 6_000,
  cle_idempotence: `enc-${a}`,
});
await json(`/factures/${a}/encaissements`, jeton, "POST", {
  montant_centimes: 6_000,
  cle_idempotence: `enc-${a}`,
});
const apres = await fetch(`${pa}/v1/factures/${a}/statuts`).then((r) => r.json());
if (apres.encaissements.length !== 1 || apres.encaissements[0].montant_centimes !== 6_000) {
  fail("encaissement en double");
}
if (apres.statut !== "partiellement_encaissee") fail(`statut encaissement ${apres.statut}`);
console.log("s9: encaissement partiel, 6000 centimes, sans doublon");

await json(`/factures/${a}/encaissements`, jeton, "POST", {
  montant_centimes: 6_000,
  cle_idempotence: `enc2-${a}`,
});
const solde = await fetch(`${pa}/v1/factures/${a}/statuts`).then((r) => r.json());
if (solde.statut !== "encaissee") fail(`statut final ${solde.statut}`);
const totalEnc = solde.encaissements.reduce((s, e) => s + e.montant_centimes, 0);
if (totalEnc !== 12_000) fail(`montant encaissé ${totalEnc} (attendu 12000)`);
console.log("s9: règlement complété → statut encaissée, 12000 centimes");

const avoirId = randomUUID();
const avoir = await json(`/factures/${a}/avoir`, jeton, "POST", { id: avoirId });
if (avoir.statut !== "validee" || typeof avoir.numero !== "number" || avoir.numero <= numeros[1]) {
  fail(`avoir invalide ${JSON.stringify(avoir)} (attendu numéro > ${numeros[1]})`);
}
const lignesAvoir = await sqlServeur(
  `SELECT COUNT(*) FROM facture_lignes WHERE facture_id = '${avoirId}'`,
);
const lignesSource = await sqlServeur(
  `SELECT COUNT(*) FROM facture_lignes WHERE facture_id = '${a}'`,
);
if (lignesAvoir.out !== lignesSource.out || Number(lignesAvoir.out) < 1) {
  fail(`avoir sans lignes copiées (avoir=${lignesAvoir.out} source=${lignesSource.out})`);
}
const modif = await fetch(`${api}/factures/${a}/valider`, {
  method: "POST",
  headers: { authorization: `Bearer ${jeton}` },
});
if (modif.status !== 200) fail("revalidation");
const inchange = await json(`/factures/${a}/valider`, jeton, "POST");
if (inchange.numero !== va.numero && inchange.numero !== vb.numero) fail("numéro réattribué");
console.log("s9: avoir numéroté avec lignes, facture validée non renumérotée");

const entete = await sqlServeur(
  `UPDATE factures SET montant_ht_centimes = montant_ht_centimes WHERE id = '${a}'`,
);
if (entete.code === 0 || !entete.err.includes("facture validee immuable")) {
  fail(`entête validée encore mutable (${entete.code} ${entete.err.slice(0, 120)})`);
}
const lignes = await sqlServeur(
  `UPDATE facture_lignes SET libelle = 'mutation-interdite' WHERE facture_id = '${a}' RETURNING libelle`,
);
if (lignes.code === 0 && lignes.out.includes("mutation-interdite")) {
  fail("lignes d'une facture validée mutables en base (invariant § 5.3)");
}
if (lignes.code === 0) {
  fail(`UPDATE facture_lignes aurait dû échouer (${lignes.out.slice(0, 120)})`);
}
console.log("s9: facture validée immuable (entête et lignes)");

const brouillonLocal = join(root, "target/brouillon-hors-ligne.db");
rmSync(brouillonLocal, { force: true });
const py = spawnSync(
  "python",
  [
    "-c",
    `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE temps_saisis (id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, minutes INTEGER NOT NULL, libelle TEXT NOT NULL, taux_centimes_heure INTEGER NOT NULL, ht_centimes INTEGER NOT NULL)")
c.execute("INSERT INTO temps_saisis VALUES ('t1', 'd1', 30, 'Honoraires fictifs', 12000, 6000)")
c.execute("CREATE TABLE brouillons_facture (id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, numero INTEGER, ht_centimes INTEGER NOT NULL)")
c.execute("INSERT INTO brouillons_facture VALUES ('b1', 'd1', NULL, 6000)")
c.commit()
row=c.execute("SELECT minutes, taux_centimes_heure, ht_centimes FROM temps_saisis").fetchone()
brouillon=c.execute("SELECT numero, ht_centimes FROM brouillons_facture").fetchone()
assert row==(30,12000,6000)
assert brouillon[0] is None and brouillon[1]==6000
print("ok")`,
    brouillonLocal,
  ],
  { encoding: "utf8" },
);
if (py.status !== 0) fail(py.stderr || "sqlite hors ligne");
console.log("s9: modèle SQLite numéro nul + taux (fumée) — preuve poste : s9-poste-tauri.mjs");
console.log("s9: OK — chaîne facture, avoir et immutabilité");
console.log("s9: lancer aussi node tests/recette/s9-s5-temps.mjs (S5 temps/brouillons)");
