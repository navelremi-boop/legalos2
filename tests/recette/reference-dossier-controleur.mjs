#!/usr/bin/env node
/**
 * Acceptation contrôleur — Référence de dossier (cahier § 3.4), écrite depuis la spécification
 * avant lecture de l'implémentation :
 * « année + numéro continu propre au cabinet, remis à zéro chaque année, attribuée par le serveur
 *   dans une transaction avec contrainte d'unicité, jamais sur le poste. […] Une référence attribuée
 *   ne change jamais. »
 *
 * Vrais services : API derrière Caddy et Postgres de l'instance docker compose.
 * Le parcours hors ligne dans l'app Tauri (coupure réelle) relève de j5-poste-tauri.mjs.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const envFile = existsSync(join(root, ".env"))
  ? join(root, ".env")
  : join(root, "..", "..", ".env");
const MOTIF = /^(\d{4})-(\d{3,})$/;
const SIMULTANES = 30;

let echecs = 0;

function verifier(condition, libelle, detail = "") {
  if (condition) {
    console.log(`  ok     ${libelle}`);
  } else {
    echecs += 1;
    console.error(`  ÉCHEC  ${libelle}${detail ? ` — ${detail}` : ""}`);
  }
}

function info(message) {
  console.log(`  info   ${message}`);
}

function sql(requete) {
  return new Promise((resolve) => {
    const enfant = spawn(
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
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-tAc",
        requete,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    enfant.stdout.on("data", (morceau) => {
      out += morceau.toString();
    });
    enfant.stderr.on("data", (morceau) => {
      err += morceau.toString();
    });
    enfant.on("exit", (code) => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
  });
}

async function sqlOk(requete) {
  const r = await sql(requete);
  if (r.code !== 0) {
    console.error(`reference-dossier-controleur: FAIL — psql ${r.code} : ${r.err.slice(0, 400)}`);
    process.exit(1);
  }
  return r.out;
}

function corpsDossier(extra = {}) {
  const id = randomUUID();
  return {
    id,
    idempotence_cle: `controle-reference-${id}`,
    nom: `Contrôle référence ${id.slice(0, 8)}`,
    chemise: "kraft",
    juridiction: "Tribunal judiciaire de Lyon",
    numero_rg: "26/00042",
    restreint: false,
    ...extra,
  };
}

async function creer(jeton, corps) {
  const reponse = await fetch(`${api}/dossiers`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(30_000),
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { brut: texte.slice(0, 200) };
  }
  return { statut: reponse.status, corps: json };
}

function decoder(reference) {
  const m = MOTIF.exec(reference ?? "");
  return m ? { annee: Number(m[1]), numero: Number(m[2]) } : null;
}

async function doitEchouer(requete, libelle) {
  const r = await sql(`BEGIN; ${requete}; ROLLBACK;`);
  const erreurDeRequete = /42601|42703|42P01|syntax error|does not exist/i.test(r.err);
  verifier(
    r.code !== 0 && !erreurDeRequete,
    libelle,
    r.code === 0 ? "modification acceptée par la base" : r.err.split("\n")[0],
  );
  if (r.code !== 0) info(`message de la base : ${r.err.split("\n")[0]}`);
}

const anneeParis = Number(
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()),
);

const jeton = await demoAccessToken(api, "controle-reference-dossier");
console.log(`reference-dossier-controleur: connecté ; année civile Europe/Paris = ${anneeParis}`);

const colonnes = (
  await sqlOk(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dossiers' ORDER BY ordinal_position",
  )
)
  .split("\n")
  .filter(Boolean);
verifier(colonnes.includes("reference"), "Postgres : colonne dossiers.reference");
verifier(colonnes.includes("cabinet_id"), "Postgres : colonne dossiers.cabinet_id (numéro propre au cabinet)");
const avecAnneeNumero = colonnes.includes("reference_annee") && colonnes.includes("reference_numero");

console.log("1. Attribution par le serveur");
const c0 = corpsDossier();
const r0 = await creer(jeton, c0);
verifier(r0.statut === 200, "POST /dossiers → 200", `statut ${r0.statut} ${JSON.stringify(r0.corps)}`);
const n0 = decoder(r0.corps?.reference);
verifier(n0 !== null, "référence renvoyée au format AAAA-NNN", `reçu ${JSON.stringify(r0.corps?.reference)}`);
if (!n0) {
  console.error("reference-dossier-controleur: FAIL — pas de référence, arrêt");
  process.exit(1);
}
verifier(n0.annee === anneeParis, "année de la référence = année civile Europe/Paris", `${n0.annee}`);
let dernier = n0.numero;
const cabinet = await sqlOk(`SELECT cabinet_id FROM dossiers WHERE id = '${c0.id}'`);
verifier(/^[0-9a-f-]{36}$/.test(cabinet), "dossier rattaché à un cabinet en base", cabinet);
const enBase0 = await sqlOk(`SELECT reference FROM dossiers WHERE id = '${c0.id}'`);
verifier(enBase0 === r0.corps.reference, "référence en base = référence renvoyée", enBase0);

console.log("2. Rejeux de la file d'envoi");
const r0bis = await creer(jeton, c0);
verifier(
  r0bis.statut === 200 && r0bis.corps?.reference === r0.corps.reference,
  "rejeu à l'identique → même référence",
  JSON.stringify(r0bis),
);
const r0ter = await creer(jeton, { ...c0, idempotence_cle: `autre-cle-${randomUUID()}` });
info(`même id, autre clé d'idempotence → statut ${r0ter.statut}`);
verifier(
  r0ter.statut >= 400 || r0ter.corps?.reference === r0.corps.reference,
  "même id, autre clé d'idempotence → jamais une autre référence",
  JSON.stringify(r0ter),
);
const r1 = await creer(jeton, corpsDossier());
const n1 = decoder(r1.corps?.reference);
verifier(n1?.numero === dernier + 1, "après les rejeux, le dossier suivant reçoit le numéro suivant", `${n1?.numero} ≠ ${dernier + 1}`);
dernier = n1?.numero ?? dernier;

console.log("3. Le poste n'est jamais cru sur parole");
const cImpose = corpsDossier({ reference: "1999-999", reference_annee: 1999, reference_numero: 999 });
const rImpose = await creer(jeton, cImpose);
if (rImpose.statut === 200) {
  const ni = decoder(rImpose.corps?.reference);
  verifier(
    rImpose.corps?.reference !== "1999-999" && ni?.annee === anneeParis && ni?.numero === dernier + 1,
    "référence envoyée par le poste ignorée, le serveur attribue la sienne",
    JSON.stringify(rImpose.corps),
  );
  dernier = ni?.numero ?? dernier;
} else {
  verifier(rImpose.statut >= 400 && rImpose.statut < 500, "référence envoyée par le poste refusée (4xx)", `${rImpose.statut}`);
}
const refImposeeEnBase = await sqlOk(`SELECT coalesce(reference, 'NULL') FROM dossiers WHERE id = '${cImpose.id}'`);
verifier(refImposeeEnBase !== "1999-999", "aucune référence imposée par le poste en base", refImposeeEnBase);

console.log("4. Une création refusée ne consomme aucun numéro");
const sansNom = corpsDossier();
delete sansNom.nom;
const invalides = [
  { libelle: "champ nom absent", corps: sansNom },
  { libelle: "identifiant non UUID", corps: corpsDossier({ id: "pas-un-uuid" }) },
  { libelle: "restreint non booléen", corps: corpsDossier({ restreint: "oui" }) },
  { libelle: "chemise inconnue", corps: corpsDossier({ chemise: "couleur-inexistante-controle" }) },
  { libelle: "nom vide", corps: corpsDossier({ nom: "" }) },
  { libelle: "clé d'idempotence d'un autre dossier", corps: corpsDossier({ idempotence_cle: c0.idempotence_cle }) },
];
for (const cas of invalides) {
  const r = await creer(jeton, cas.corps);
  const n = decoder(r.corps?.reference);
  if (r.statut === 200 && r.corps?.id === cas.corps.id && n) {
    info(`« ${cas.libelle} » accepté comme création (${r.corps.reference})`);
    verifier(n.numero === dernier + 1, `« ${cas.libelle} » : numéro suivant`, `${n.numero}`);
    dernier = n.numero;
  } else {
    info(`« ${cas.libelle} » → statut ${r.statut}${r.corps?.id ? `, id renvoyé ${r.corps.id === c0.id ? "= dossier existant" : r.corps.id}` : ""}`);
  }
}
const rApres = await creer(jeton, corpsDossier());
const nApres = decoder(rApres.corps?.reference);
verifier(nApres?.numero === dernier + 1, "après les créations refusées, aucun trou", `${nApres?.numero} ≠ ${dernier + 1}`);
dernier = nApres?.numero ?? dernier;

console.log("5. Dossier restreint : même séquence du cabinet");
const rR = await creer(jeton, corpsDossier({ restreint: true }));
const nR = decoder(rR.corps?.reference);
verifier(rR.statut === 200 && nR?.numero === dernier + 1, "dossier restreint → numéro suivant", `${rR.statut} ${nR?.numero}`);
dernier = nR?.numero ?? dernier;

console.log(`6. ${SIMULTANES} créations simultanées`);
const lots = Array.from({ length: SIMULTANES }, () => corpsDossier());
const resultats = await Promise.all(lots.map((c) => creer(jeton, c)));
const statuts = resultats.map((r) => r.statut);
verifier(statuts.every((s) => s === 200), "toutes les créations simultanées → 200", JSON.stringify(statuts));
const nums = resultats
  .map((r) => decoder(r.corps?.reference))
  .filter((d) => d !== null && d.annee === anneeParis)
  .map((d) => d.numero)
  .sort((a, b) => a - b);
verifier(new Set(nums).size === SIMULTANES, "créations simultanées → références toutes distinctes", `${new Set(nums).size}`);
verifier(
  nums[0] === dernier + 1 && nums[nums.length - 1] === dernier + SIMULTANES,
  "créations simultanées → numéros contigus, sans trou",
  `${nums[0]}..${nums[nums.length - 1]} au lieu de ${dernier + 1}..${dernier + SIMULTANES}`,
);
dernier = nums[nums.length - 1] ?? dernier;

console.log("7. Dix envois simultanés du même dossier (rejeu concurrent)");
const cMeme = corpsDossier();
const rejeux = await Promise.all(Array.from({ length: 10 }, () => creer(jeton, cMeme)));
info(`statuts : ${JSON.stringify(rejeux.map((r) => r.statut))}`);
const refsMeme = [...new Set(rejeux.filter((r) => r.statut === 200).map((r) => r.corps?.reference))];
verifier(refsMeme.length === 1, "une seule référence pour le même dossier", JSON.stringify(refsMeme));
verifier((await sqlOk(`SELECT count(*) FROM dossiers WHERE id = '${cMeme.id}'`)) === "1", "un seul dossier en base");
const refMemeEnBase = await sqlOk(`SELECT reference FROM dossiers WHERE id = '${cMeme.id}'`);
verifier(decoder(refMemeEnBase)?.numero === dernier + 1, "un seul numéro consommé", `${refMemeEnBase}`);
dernier = decoder(refMemeEnBase)?.numero ?? dernier;
const rSuivant = await creer(jeton, corpsDossier());
verifier(decoder(rSuivant.corps?.reference)?.numero === dernier + 1, "le dossier suivant reste contigu", rSuivant.corps?.reference);
dernier = decoder(rSuivant.corps?.reference)?.numero ?? dernier;

console.log("8. État de l'année en base");
const refsAnnee = (
  await sqlOk(`SELECT reference FROM dossiers WHERE cabinet_id = '${cabinet}' AND reference LIKE '${anneeParis}-%'`)
)
  .split("\n")
  .filter(Boolean)
  .map((r) => decoder(r)?.numero)
  .sort((a, b) => a - b);
const premierEcart = refsAnnee.findIndex((n, i) => n !== i + 1);
verifier(
  premierEcart === -1 && refsAnnee.length > 0,
  `année ${anneeParis} : numéros 1..${refsAnnee.length} sans trou ni doublon (le premier de l'année est 1)`,
  premierEcart === -1 ? "aucune référence" : `rang ${premierEcart + 1} → ${refsAnnee[premierEcart]}`,
);
verifier(refsAnnee[refsAnnee.length - 1] === dernier, "dernier numéro en base = dernier attribué par l'API", `${refsAnnee.at(-1)}`);
info(`dossiers sans référence en base (créés avant le jalon ou en attente) : ${await sqlOk("SELECT count(*) FROM dossiers WHERE reference IS NULL")}`);
if (avecAnneeNumero) {
  const incoherents = await sqlOk(
    "SELECT count(*) FROM dossiers WHERE reference IS NOT NULL AND reference <> reference_annee::text || '-' || CASE WHEN reference_numero < 1000 THEN lpad(reference_numero::text, 3, '0') ELSE reference_numero::text END",
  );
  verifier(incoherents === "0", "reference = annee-numéro (3 chiffres minimum, sans troncature)", incoherents);
  const partielles = await sqlOk(
    "SELECT count(*) FROM dossiers WHERE (reference IS NULL) <> (reference_annee IS NULL) OR (reference IS NULL) <> (reference_numero IS NULL)",
  );
  verifier(partielles === "0", "référence complète ou absente, jamais partielle", partielles);
}

console.log("9. Séquence propre au cabinet, remise à zéro chaque année");
info(
  `colonnes sequences_dossiers : ${await sqlOk(
    "SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sequences_dossiers'",
  )}`,
);
const idxSequence = await sqlOk(
  "SELECT string_agg(indexdef, ' | ') FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sequences_dossiers'",
);
verifier(
  idxSequence.split(" | ").some((d) => /UNIQUE/i.test(d) && /\(cabinet_id, annee\)|\(annee, cabinet_id\)/.test(d)),
  "sequences_dossiers : clé unique (cabinet_id, annee)",
  idxSequence,
);
const ligneSequence = await sqlOk(
  `SELECT to_jsonb(s) FROM sequences_dossiers s WHERE cabinet_id = '${cabinet}' AND annee = ${anneeParis}`,
);
const sequence = ligneSequence ? JSON.parse(ligneSequence) : {};
const attenduCompteur = "prochain" in sequence ? dernier + 1 : dernier;
const compteurs = Object.entries(sequence)
  .filter(([cle, valeur]) => typeof valeur === "number" && cle !== "annee")
  .map(([, valeur]) => valeur);
verifier(
  compteurs.length === 1 && compteurs[0] === attenduCompteur,
  "compteur de l'année cohérent avec le dernier numéro attribué (pas de dérive)",
  ligneSequence,
);

console.log("10. Unicité en base");
const idxReference = await sqlOk(
  "SELECT string_agg(indexname || ' :: ' || indexdef, E'\\n') FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'dossiers' AND indexdef ILIKE '%reference%'",
);
info(`index sur la référence :\n${idxReference}`);
const uniques = idxReference.split("\n").filter((l) => /UNIQUE/i.test(l));
verifier(uniques.length > 0, "index UNIQUE sur la référence", idxReference);
verifier(uniques.some((l) => /cabinet_id/.test(l)), "unicité portée par le cabinet (cabinet_id dans l'index unique)", idxReference);
const surcharges = ["'id', gen_random_uuid()"];
if (colonnes.includes("idempotence_cle")) {
  surcharges.push("'idempotence_cle', 'controle-doublon-' || gen_random_uuid()::text");
}
const doublon = await sql(
  `BEGIN; INSERT INTO dossiers SELECT (jsonb_populate_record(NULL::dossiers, to_jsonb(d) || jsonb_build_object(${surcharges.join(", ")}))).* FROM dossiers d WHERE d.id = '${c0.id}'; ROLLBACK;`,
);
const contrainte = /unique constraint "([^"]+)"/.exec(doublon.err)?.[1] ?? "";
verifier(
  doublon.code !== 0 && /23505/.test(doublon.err) && uniques.some((l) => l.startsWith(`${contrainte} ::`)),
  "un second dossier portant la même référence est refusé par la contrainte d'unicité",
  doublon.code === 0 ? "insertion acceptée" : doublon.err.split("\n")[0],
);

console.log("11. Une référence attribuée ne change jamais (garantie en base)");
await doitEchouer(`UPDATE dossiers SET reference = '1999-999' WHERE id = '${c0.id}'`, "changer la référence est refusé");
await doitEchouer(`UPDATE dossiers SET reference = NULL WHERE id = '${c0.id}'`, "effacer la référence est refusé");
if (avecAnneeNumero) {
  await doitEchouer(
    `UPDATE dossiers SET reference_numero = reference_numero + 100000 WHERE id = '${c0.id}'`,
    "changer le numéro est refusé",
  );
  await doitEchouer(`UPDATE dossiers SET reference_annee = 1999 WHERE id = '${c0.id}'`, "changer l'année est refusé");
}
const neutre = await sql(`BEGIN; UPDATE dossiers SET nom = nom || ' (contrôle)' WHERE id = '${c0.id}'; ROLLBACK;`);
verifier(neutre.code === 0, "une modification sans rapport (nom) reste possible", neutre.err.split("\n")[0]);
const apres = await sqlOk(`SELECT reference FROM dossiers WHERE id = '${c0.id}'`);
verifier(apres === r0.corps.reference, "référence inchangée après toutes les tentatives", apres);

console.log("12. Remise à zéro annuelle (horloge serveur non injectable : bascule et séquence en transaction annulée)");
const bascule = await sqlOk(
  "SELECT EXTRACT(YEAR FROM (TIMESTAMPTZ '2026-12-31 22:59:59+00' AT TIME ZONE 'Europe/Paris'))::integer || ',' || EXTRACT(YEAR FROM (TIMESTAMPTZ '2026-12-31 23:00:00+00' AT TIME ZONE 'Europe/Paris'))::integer",
);
verifier(bascule === "2026,2027", "l'année change à minuit heure de Paris (31/12 23:00 UTC → 2027)", bascule);
const upsertSequence = (annee) =>
  `INSERT INTO sequences_dossiers (cabinet_id, annee, prochain) VALUES ('${cabinet}', ${annee}, 2) ON CONFLICT (cabinet_id, annee) DO UPDATE SET prochain = sequences_dossiers.prochain + 1 RETURNING prochain - 1`;
const simulation = await sql(
  `BEGIN; ${upsertSequence(anneeParis + 1)}; ${upsertSequence(anneeParis + 1)}; ${upsertSequence(anneeParis)}; ROLLBACK;`,
);
const tirages = simulation.out
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^\d+$/.test(l));
verifier(
  simulation.code === 0 && tirages.join(",") === `1,2,${dernier + 1}`,
  `année ${anneeParis + 1} : la séquence repart à 1, puis 2, sans toucher ${anneeParis} (${dernier + 1})`,
  `${tirages.join(",")} ${simulation.err.split("\n")[0]}`,
);
const apresSimulation = await sqlOk(
  `SELECT count(*) FROM sequences_dossiers WHERE cabinet_id = '${cabinet}' AND annee = ${anneeParis + 1}`,
);
verifier(apresSimulation === "0", "simulation annulée : aucune séquence créée pour l'année suivante", apresSimulation);

if (echecs > 0) {
  console.error(`reference-dossier-controleur: FAIL — ${echecs} contrôle(s) en échec`);
  process.exit(1);
}
console.log("reference-dossier-controleur: OK");
