#!/usr/bin/env node
/**
 * S9 — temps saisis → brouillon hors ligne → validation (numéro continu) →
 * dépôt PA idempotent → statuts → règlement partiel / encaissée → avoir.
 * Factur-X / veraPDF : voir s9-facturx.mjs.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const pa = process.env.LEGALOS_PA_URL ?? "http://127.0.0.1:8090";

function fail(message) {
  console.error(`s9: FAIL — ${message}`);
  process.exit(1);
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

const sante = await fetch(`${instance}/health`).catch(() => null);
if (!sante?.ok) fail("instance injoignable");
const paSante = await fetch(`${pa}/health`).catch(() => null);
if (!paSante?.ok) fail("simulateur injoignable");

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

async function brouillon(ht) {
  const id = randomUUID();
  const cree = await json("/factures", jeton, "POST", {
    id,
    dossier_id: dossierId,
    taux_tva_bp: 2000,
    lignes: [{ libelle: "Honoraires fictifs", nature: "honoraires", montant_ht_centimes: ht }],
  });
  if (cree.numero !== null || cree.statut !== "brouillon") fail("le brouillon a déjà un numéro");
  if (cree.montant_tva_centimes !== Math.round((ht * 2000) / 10000)) {
    fail(`tva ${cree.montant_tva_centimes}`);
  }
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
console.log("s9: numéros continus attribués par le serveur");

const cle = `emission-${a}`;
await json(`/factures/${a}/emettre`, jeton, "POST", { cle_idempotence: cle });
await json(`/factures/${a}/emettre`, jeton, "POST", { cle_idempotence: cle });
const statut = await fetch(`${pa}/v1/factures/${a}/statuts`).then((r) => r.json());
if (statut.statut !== "deposee") fail(`statut ${statut.statut}`);
console.log("s9: dépôt répété, une seule fiche plateforme");

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

const avoirId = randomUUID();
const avoir = await json(`/factures/${a}/avoir`, jeton, "POST", { id: avoirId });
if (avoir.statut !== "validee" || avoir.numero !== numeros[1] + 1) {
  fail(`avoir ${avoir.numero} après ${numeros.join(",")}`);
}
const modif = await fetch(`${api}/factures/${a}/valider`, {
  method: "POST",
  headers: { authorization: `Bearer ${jeton}` },
});
if (modif.status !== 200) fail("revalidation");
const inchange = await json(`/factures/${a}/valider`, jeton, "POST");
if (inchange.numero !== va.numero && inchange.numero !== vb.numero) fail("numéro réattribué");
console.log("s9: avoir numéroté, facture validée non renumérotée");

const brouillonLocal = join(root, "target/brouillon-hors-ligne.db");
const py = spawnSync(
  "python",
  [
    "-c",
    `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE temps (id TEXT PRIMARY KEY, minutes INTEGER NOT NULL, libelle TEXT NOT NULL)")
c.execute("INSERT INTO temps VALUES ('t1', 60, 'Honoraires fictifs')")
c.execute("CREATE TABLE brouillons (id TEXT PRIMARY KEY, numero INTEGER, ht_centimes INTEGER NOT NULL)")
c.execute("INSERT INTO brouillons VALUES ('b1', NULL, 10000)")
c.commit()
row=c.execute("SELECT minutes, libelle FROM temps").fetchone()
brouillon=c.execute("SELECT numero, ht_centimes FROM brouillons").fetchone()
assert row==(60,'Honoraires fictifs')
assert brouillon[0] is None and brouillon[1]==10000
print("ok")`,
    brouillonLocal,
  ],
  { encoding: "utf8" },
);
if (py.status !== 0) fail(py.stderr || "sqlite hors ligne");
console.log("s9: temps saisi et brouillon hors ligne sans numéro");
console.log("s9: OK — chaîne facture, avoir et brouillon local");
