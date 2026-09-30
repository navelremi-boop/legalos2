#!/usr/bin/env node
/**
 * S7 — S5 poste : mail d'un dossier restreint absent du SQLite non autorisé ;
 * compte nominatif visible seulement de son titulaire ; aucun secret IMAP sur le poste.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const session = creerSession("s7-poste");
const { api, fail, ok, resetPostes, startApp, stopApp, waitCdp, connectCdp, login, fermer } =
  session;

const marque = String(Date.now()).slice(-6);
const collabEmail = `s7-collab-${marque}@cabinet-fictif.example`;
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const messageId = `<s7-poste-${randomUUID()}@cabinet.example>`;
const adresseDemo = `demo.nominatif.${marque}@cabinet.example`;
const adresseCollab = `collab.nominatif.${marque}@cabinet.example`;

async function json(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 240)}`);
  return texte ? JSON.parse(texte) : {};
}

async function attendre(id, sql, predicat, delai = 120_000) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < delai) {
    try {
      dernier = await sqliteLocal(id, sql);
      if (predicat(dernier)) return dernier;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`SQLite ${id} : ${dernier}`);
}

async function main() {
  const sante = await fetch(`${api.replace(/\/api$/, "")}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");

  const jeton = await demoAccessToken(api, `s7-poste-${marque}`);
  const collab = await json("/collaborateurs", jeton, "POST", {
    email: collabEmail,
    password: collabPassword,
    totp_secret_base32: collabTotp,
  });
  const dossierId = randomUUID();
  const dossier = await json("/dossiers", jeton, "POST", {
    id: dossierId,
    idempotence_cle: `s7-poste-${dossierId}`,
    nom: `Restreint mail ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-S7P-${marque}`,
    restreint: true,
  });
  if (!dossier.restreint) fail("dossier non restreint");

  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = '${demoEmail}'`);
  if (!demoId) fail("utilisateur démo absent");
  const compteDemo = randomUUID();
  const compteCollab = randomUUID();
  const cabinet = await sqlServeur(`SELECT cabinet_id FROM utilisateurs WHERE id = '${demoId}'`);
  await sqlServeur(
    `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
     VALUES ('${compteDemo}', '${cabinet}', 'nominatif', '${demoId}', '${adresseDemo}', 'srv:s7-poste-demo'),
            ('${compteCollab}', '${cabinet}', 'nominatif', '${collab.id}', '${adresseCollab}', 'srv:s7-poste-collab')`,
  );
  const msg = randomUUID();
  await sqlServeur(
    `INSERT INTO messages (
       id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement
     ) VALUES (
       '${msg}', '${cabinet}', '${compteDemo}', '${dossierId}', '${messageId}',
       1, ${Date.now() % 1_000_000_000}, 'Objet restreint', 'tiers@example.com', 'classe'
     )`,
  );
  const groupe = await sqlServeur(
    `SELECT CASE WHEN groupe_acces IS NULL THEN 'f' ELSE 't' END FROM messages WHERE id = '${msg}'`,
  );
  if (groupe !== "t") fail("message restreint sans groupe d'accès");

  spawnSync("docker", ["restart", "legalos-instance-powersync-1"], { stdio: "inherit" });
  await sleep(8000);

  resetPostes(["s7a", "s7b"]);
  const posteA = startApp("s7a", 9341);
  try {
    await waitCdp(posteA);
    const cdpA = await connectCdp(posteA.port);
    await login(cdpA.send, demoEmail, demoPassword, totpSecretB32, `Poste A ${marque}`);
    await attendre(
      "s7a",
      `SELECT COUNT(*) FROM messages WHERE message_id = '${messageId}'`,
      (v) => v === "1",
    );
    await attendre(
      "s7a",
      `SELECT COUNT(*) FROM comptes_mail WHERE adresse = '${adresseDemo}'`,
      (v) => v === "1",
    );
    const autre = await sqliteLocal(
      "s7a",
      `SELECT COUNT(*) FROM comptes_mail WHERE adresse = '${adresseCollab}'`,
    );
    if (autre !== "0") fail("compte du collaborateur visible chez le démo");
    const secretsA = await sqliteLocal(
      "s7a",
      "SELECT COUNT(*) FROM sqlite_master WHERE sql LIKE '%secret_ref%' OR sql LIKE '%mot_de_passe%' OR sql LIKE '%imap_password%'",
    );
    if (secretsA !== "0") fail("schéma SQLite avec un secret de messagerie");
    ok("poste titulaire : mail restreint et compte nominatif, sans secret");
    cdpA.ws.close();
  } finally {
    await stopApp(posteA);
  }

  const posteB = startApp("s7b", 9342);
  try {
    await waitCdp(posteB);
    const cdpB = await connectCdp(posteB.port);
    await login(cdpB.send, collabEmail, collabPassword, collabTotp, `Poste B ${marque}`);
    await attendre(
      "s7b",
      `SELECT COUNT(*) FROM comptes_mail WHERE adresse = '${adresseCollab}'`,
      (v) => v === "1",
    );
    await sleep(5000);
    const mail = await sqliteLocal(
      "s7b",
      `SELECT COUNT(*) FROM messages WHERE message_id = '${messageId}' OR dossier_id = '${dossierId}'`,
    );
    if (mail !== "0") fail(`mail restreint présent chez le non autorisé (${mail})`);
    const compteDemoLocal = await sqliteLocal(
      "s7b",
      `SELECT COUNT(*) FROM comptes_mail WHERE adresse = '${adresseDemo}'`,
    );
    if (compteDemoLocal !== "0") fail("compte nominatif du démo visible chez le collaborateur");
    const secretsB = await sqliteLocal(
      "s7b",
      "SELECT COUNT(*) FROM sqlite_master WHERE sql LIKE '%secret_ref%' OR sql LIKE '%mot_de_passe%' OR sql LIKE '%imap_password%'",
    );
    if (secretsB !== "0") fail("schéma SQLite collaborateur avec un secret");
    ok("poste non autorisé : ni mail restreint, ni compte d'autrui, ni secret");
    cdpB.ws.close();
  } finally {
    await stopApp(posteB);
  }
  ok("OK");
}

main()
  .catch((err) => {
    fail(err instanceof Error ? err.message : err);
  })
  .finally(() => fermer());
