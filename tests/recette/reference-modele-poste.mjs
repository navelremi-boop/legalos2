#!/usr/bin/env node
/**
 * Portage TypeScript du modèle de référence (R0) : mêmes vecteurs que le Rust,
 * constructeur visuel aller-retour, échappement LIKE, libellés d'affichage.
 * Usage : node tests/recette/reference-modele-poste.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { echapperMotifLike } from "../../apps/poste/src/lib/echapperMotifLike.ts";
import {
  analyserPour,
  blocsDepuisTexte,
  estErreurModele,
  formeClassement,
  formeExport,
  initialesDepuis,
  initialesValides,
  referenceCitee,
  texteDepuisBlocs,
} from "../../apps/poste/src/lib/modeleReference.ts";
import {
  libelleEtiquetteReference,
  libelleReferenceDossier,
  REFERENCE_EN_ATTENTE,
} from "../../apps/poste/src/lib/referenceDossier.ts";
import { erreurReferenceDepuisCorps } from "../../apps/poste/src/lib/erreurReferenceCabinet.ts";
import { utilisateurIdDepuisJeton } from "../../apps/poste/src/lib/session/utilisateurCourant.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vecteurs = JSON.parse(
  readFileSync(join(root, "crates/domaine/tests/reference-vecteurs.json"), "utf8"),
);

function fail(msg) {
  console.error(`reference-modele-poste: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`reference-modele-poste: ${msg}`);
}

if (!Array.isArray(vecteurs.modeles) || vecteurs.modeles.length < 4) {
  fail("vecteurs.modeles insuffisants");
}

for (const cas of vecteurs.modeles) {
  let modele;
  try {
    modele = analyserPour(cas.modele, cas.remise);
  } catch (err) {
    fail(`${cas.modele} : ${err instanceof Error ? err.message : err}`);
  }
  if (modele.texte() !== cas.texte) {
    fail(`texte canonique de ${cas.modele} : ${modele.texte()} ≠ ${cas.texte}`);
  }
  if (!Array.isArray(cas.exemples) || cas.exemples.length === 0) {
    fail(`${cas.modele} sans exemple`);
  }
  for (const exemple of cas.exemples) {
    const reference = modele.produire(exemple.annee, exemple.numero, exemple.initiales);
    if (reference !== exemple.reference) {
      fail(`${cas.modele} pour ${exemple.annee} n° ${exemple.numero} : ${reference} ≠ ${exemple.reference}`);
    }
  }
}
ok(`modeles (${String(vecteurs.modeles.length)})`);

if (!Array.isArray(vecteurs.invalides) || vecteurs.invalides.length === 0) {
  fail("vecteurs.invalides vides");
}
for (const cas of vecteurs.invalides) {
  try {
    analyserPour(cas.modele, cas.remise);
    fail(`modèle accepté à tort : ${JSON.stringify(cas.modele)}`);
  } catch (err) {
    if (!estErreurModele(err) || err.code() !== cas.erreur) {
      fail(
        `modèle ${JSON.stringify(cas.modele)} : ${estErreurModele(err) ? err.code() : String(err)} ≠ ${cas.erreur}`,
      );
    }
  }
}
ok(`invalides (${String(vecteurs.invalides.length)})`);

if (!Array.isArray(vecteurs.normalisations) || vecteurs.normalisations.length === 0) {
  fail("vecteurs.normalisations vides");
}
for (const cas of vecteurs.normalisations) {
  const classement = formeClassement(cas.reference);
  const exportNom = formeExport(cas.reference);
  if (classement !== cas.classement) {
    fail(`classement de ${cas.reference} : ${classement} ≠ ${cas.classement}`);
  }
  if (exportNom !== cas.export) {
    fail(`export de ${cas.reference} : ${exportNom} ≠ ${cas.export}`);
  }
}
ok(`normalisations (${String(vecteurs.normalisations.length)})`);

if (!Array.isArray(vecteurs.citations) || vecteurs.citations.length === 0) {
  fail("vecteurs.citations vides");
}
if (!vecteurs.citations.some((c) => c.citee) || !vecteurs.citations.some((c) => !c.citee)) {
  fail("citations : il faut au moins un vrai et un faux");
}
for (const cas of vecteurs.citations) {
  const citee = referenceCitee(cas.reference, cas.texte);
  if (citee !== cas.citee) {
    fail(`${cas.reference} dans ${JSON.stringify(cas.texte)} : ${String(citee)} ≠ ${String(cas.citee)}`);
  }
}
ok(`citations (${String(vecteurs.citations.length)})`);

if (!Array.isArray(vecteurs.collisions) || vecteurs.collisions.length === 0) {
  fail("vecteurs.collisions vides");
}
if (!vecteurs.collisions.some((c) => c.redonnee) || !vecteurs.collisions.some((c) => !c.redonnee)) {
  fail("collisions : il faut au moins un vrai et un faux");
}
for (const cas of vecteurs.collisions) {
  let modele;
  try {
    modele = analyserPour(cas.modele, cas.remise);
  } catch (err) {
    fail(`${cas.modele} : ${err instanceof Error ? err.message : err}`);
  }
  const redonnee = modele.pourraitRedonner(cas.remise, cas.annee, cas.prochain, cas.reference);
  if (redonnee !== cas.redonnee) {
    fail(
      `${cas.modele} (${cas.remise}, ${cas.annee} n° ${cas.prochain}) face à ${cas.reference} : ${String(redonnee)} ≠ ${String(cas.redonnee)}`,
    );
  }
}
ok(`collisions (${String(vecteurs.collisions.length)})`);

if (!Array.isArray(vecteurs.initiales) || vecteurs.initiales.length === 0) {
  fail("vecteurs.initiales vides");
}
for (const cas of vecteurs.initiales) {
  const initiales = initialesDepuis(cas.source);
  if (initiales !== cas.initiales) {
    fail(`initiales de ${cas.source} : ${initiales} ≠ ${cas.initiales}`);
  }
  if (!initialesValides(initiales)) {
    fail(`initiales invalides pour ${cas.source} : ${initiales}`);
  }
}
if (initialesValides("") || initialesValides("ABCDE") || initialesValides("md")) {
  fail("initialesValides accepte un cas interdit");
}
ok(`initiales (${String(vecteurs.initiales.length)})`);

for (const cas of vecteurs.modeles) {
  const canonique = cas.texte;
  const allerRetour = texteDepuisBlocs(blocsDepuisTexte(cas.modele));
  if (allerRetour !== canonique) {
    fail(`constructeur ${cas.modele} : ${allerRetour} ≠ ${canonique}`);
  }
}
const saisis = ["{AAAA}/{N:3}", "RN/{AA}/{N:4}", "{N}/{AAAA}", "{AAAA}{N:4}", "Dossier {N:5}"];
for (const saisi of saisis) {
  const retour = texteDepuisBlocs(blocsDepuisTexte(saisi));
  if (retour !== saisi) {
    fail(`constructeur saisi ${saisi} : ${retour}`);
  }
}
ok("constructeur aller-retour");

if (echapperMotifLike("%") !== "\\%" || echapperMotifLike("_") !== "\\_" || echapperMotifLike("\\") !== "\\\\") {
  fail(`échappement LIKE : ${JSON.stringify({
    p: echapperMotifLike("%"),
    u: echapperMotifLike("_"),
    b: echapperMotifLike("\\"),
  })}`);
}
if (echapperMotifLike("26_042") !== "26\\_042") {
  fail(`échappement LIKE 26_042 : ${echapperMotifLike("26_042")}`);
}
ok("échappement LIKE");

if (libelleReferenceDossier("2026/042") !== "2026/042") {
  fail(`libellé 2026/042 : ${libelleReferenceDossier("2026/042")}`);
}
if (libelleReferenceDossier(null) !== REFERENCE_EN_ATTENTE) {
  fail(`libellé null : ${libelleReferenceDossier(null)}`);
}
if (libelleReferenceDossier("   ") !== REFERENCE_EN_ATTENTE) {
  fail("libellé blanc");
}
if (libelleEtiquetteReference("2026/042") !== "Dossier 2026/042") {
  fail(`étiquette 2026/042 : ${libelleEtiquetteReference("2026/042")}`);
}
if (libelleEtiquetteReference(null) !== REFERENCE_EN_ATTENTE) {
  fail("étiquette null");
}
if (libelleReferenceDossier("RN/26/0007") !== "RN/26/0007") {
  fail("libellé RN/26/0007");
}
ok("libellés");

const client = readFileSync(join(root, "apps/poste/src/lib/referenceCabinet.ts"), "utf8");
if (!/objet\.prochain_numero/.test(client)) {
  fail("GET : prochain_numero absent de referenceCabinet.ts");
}
if (!/idempotence_cle/.test(client)) {
  fail("PUT : idempotence_cle absente de referenceCabinet.ts");
}
const parseurSource = readFileSync(
  join(root, "apps/poste/src/lib/erreurReferenceCabinet.ts"),
  "utf8",
);
if (!/numero_depart_minimal/.test(parseurSource) || !/erreurReferenceDepuisCorps/.test(parseurSource)) {
  fail("409 : parseur numero_depart_minimal absent de erreurReferenceCabinet.ts");
}
if (!/erreurReferenceDepuisCorps/.test(client)) {
  fail("enregistrerReferenceCabinet n’utilise pas erreurReferenceDepuisCorps");
}
ok("contrat GET prochain_numero et PUT idempotence_cle");

const collision = erreurReferenceDepuisCorps(
  {
    code: "reference_existante",
    message: "Ce modèle redonnerait une référence déjà attribuée.",
    numero_depart_minimal: 42,
  },
  "repli",
);
if (collision.message !== "Ce modèle redonnerait une référence déjà attribuée.") {
  fail(`parseur message : ${collision.message}`);
}
if (collision.numero_depart_minimal !== 42) {
  fail(`parseur numero_depart_minimal : ${String(collision.numero_depart_minimal)}`);
}
const sansMinimal = erreurReferenceDepuisCorps(
  { code: "reference_existante", message: "Collision." },
  "repli",
);
if (sansMinimal.numero_depart_minimal !== null) {
  fail("parseur sans numero_depart_minimal doit renvoyer null");
}
const repli = erreurReferenceDepuisCorps(null, "Erreur serveur (409).");
if (repli.message !== "Erreur serveur (409)." || repli.numero_depart_minimal !== null) {
  fail("parseur repli");
}
ok("parseur 409 numero_depart_minimal");

const schema = readFileSync(join(root, "apps/poste/src/sync/AppSchema.ts"), "utf8");
if (!/responsable_id:\s*column\.text/.test(schema)) {
  fail("AppSchema dossiers.responsable_id (column.text) absent");
}
const ecrire = readFileSync(join(root, "apps/poste/src/dossiers/ecrireDossier.ts"), "utf8");
if (!/responsableId/.test(ecrire) || !/responsable_id/.test(ecrire)) {
  fail("ecrireDossier n’envoie pas responsable_id");
}
if (/reference\s*[:=]\s*[`'"]?\d{4}-/.test(ecrire)) {
  fail("ecrireDossier génère une référence côté poste");
}
const connecteur = readFileSync(
  join(root, "apps/poste/src-tauri/src/powersync_connect.rs"),
  "utf8",
);
if (!/responsable_id/.test(connecteur)) {
  fail("upload_dossier n’envoie pas responsable_id");
}
const payload = Buffer.from(
  JSON.stringify({ sub: "11111111-1111-1111-1111-111111111111", typ: "access" }),
).toString("base64url");
const jeton = `hdr.${payload}.sig`;
if (utilisateurIdDepuisJeton(jeton) !== "11111111-1111-1111-1111-111111111111") {
  fail(`utilisateurIdDepuisJeton : ${utilisateurIdDepuisJeton(jeton)}`);
}
if (utilisateurIdDepuisJeton(null) !== null || utilisateurIdDepuisJeton("pas-un-jwt") !== null) {
  fail("utilisateurIdDepuisJeton accepte un jeton invalide");
}
ok("responsable_id (schéma, écriture, upload, session)");

const reglages = readFileSync(join(root, "apps/poste/src/screens/Reglages.tsx"), "utf8");
if (!/reglages-reference-numero-minimal/.test(reglages)) {
  fail("Réglages : data-testid reglages-reference-numero-minimal absent");
}
ok("Réglages affiche numero_depart_minimal");

console.log("reference-modele-poste: OK");
