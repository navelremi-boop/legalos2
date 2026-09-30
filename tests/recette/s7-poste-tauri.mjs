#!/usr/bin/env node
/**
 * S7 — S5 poste : mail d'un dossier restreint absent du SQLite non autorisé ;
 * compte nominatif visible seulement de son titulaire ; aucun secret IMAP sur le poste.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const session = creerSession("s7-poste");
const {
  api,
  fail,
  ok,
  resetPostes,
  startApp,
  stopApp,
  waitCdp,
  connectCdp,
  login,
  evaluate,
  setField,
  fermer,
} = session;

const marque = String(Date.now()).slice(-6);
const collabEmail = `s7-collab-${marque}@cabinet-fictif.example`;
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const messageId = `<s7-poste-${randomUUID()}@cabinet.example>`;
const motRecherche = `fenetre${marque}`;
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

function sqliteContientMot(id, secret) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${id}.db`);
  return readFileSync(fichier).includes(Buffer.from(secret));
}

async function main() {
  const sante = await fetch(`${api.replace(/\/api$/, "")}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");

  const jeton = await demoAccessToken(api, `s7-poste-${marque}`);
  const motCompte = `SentinelleS7${marque}Xk9`;
  const idCompte = randomUUID();
  const reponseCompte = await fetch(`${api}/messagerie/comptes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: idCompte,
      adresse: `http.${marque}@cabinet.example`,
      hote: "injoignable.example",
      port: 143,
      utilisateur: "aucun",
      mot_de_passe: motCompte,
      tls: false,
    }),
  });
  const texteCompte = await reponseCompte.text();
  if (!reponseCompte.ok) fail(`création compte ${reponseCompte.status} ${texteCompte.slice(0, 180)}`);
  if (texteCompte.includes(motCompte)) fail("mot de passe dans la réponse HTTP");
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
       objet, expediteur, etat_classement, texte_brut
     ) VALUES (
       '${msg}', '${cabinet}', '${compteDemo}', '${dossierId}', '${messageId}',
       1, ${Date.now() % 1_000_000_000}, 'Objet restreint', 'tiers@example.com', 'classe',
       '${motRecherche} dans le corps'
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
    await attendre(
      "s7a",
      `SELECT COUNT(*) FROM comptes_mail WHERE adresse = 'http.${marque}@cabinet.example'`,
      (v) => v === "1",
    );
    if (sqliteContientMot("s7a", motCompte)) fail("mot de passe dans le SQLite du poste");
    const texteLocal = await sqliteLocal(
      "s7a",
      `SELECT texte_brut FROM messages WHERE message_id = '${messageId}'`,
    );
    if (!texteLocal.includes(motRecherche)) fail("texte du mail absent du poste");
    await attendre(
      "s7a",
      `SELECT COUNT(*) FROM dossiers WHERE id = '${dossierId}'`,
      (v) => v === "1",
    );
    await evaluate(cdpA.send, `document.querySelector("[data-testid=nav-dossiers]")?.click()`);
    const debutPalette = Date.now();
    while (Date.now() - debutPalette < 20_000) {
      const bouton = Boolean(await evaluate(cdpA.send, `Boolean(document.getElementById("ouvrir-palette"))`));
      if (bouton) break;
      await sleep(200);
    }
    await evaluate(cdpA.send, `document.getElementById("ouvrir-palette")?.click()`);
    await setField(cdpA.send, "palette-recherche", `Restreint mail ${marque}`);
    const debutChoix = Date.now();
    let choisi = false;
    while (Date.now() - debutChoix < 20_000) {
      choisi = Boolean(
        await evaluate(
          cdpA.send,
          `(() => {
            const b = document.querySelector("[data-testid=palette-resultat][data-dossier-id='${dossierId}']");
            if (!b) return false;
            b.click();
            return true;
          })()`,
        ),
      );
      if (choisi) break;
      await sleep(300);
    }
    if (!choisi) fail("dossier absent de la palette");
    const debutOuvert = Date.now();
    while (Date.now() - debutOuvert < 15_000) {
      const ouvert = Boolean(
        await evaluate(
          cdpA.send,
          `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === "${dossierId}"`,
        ),
      );
      if (ouvert) break;
      await sleep(200);
    }
    const debutChrono = Date.now();
    let chrono = "";
    while (Date.now() - debutChrono < 20_000) {
      chrono = String((await evaluate(cdpA.send, `document.body?.innerText ?? ""`)) ?? "");
      if (chrono.includes("Objet restreint")) break;
      await sleep(300);
    }
    if (!chrono.includes("Objet restreint")) fail("mail classé absent du chrono du dossier");
    if (chrono.includes("Communication de pièces adverses")) fail("jeu fictif dans le chrono réel");
    const debutNav = Date.now();
    while (Date.now() - debutNav < 15_000) {
      const present = Boolean(
        await evaluate(cdpA.send, `Boolean(document.getElementById("recherche-mails"))`),
      );
      if (present) break;
      await evaluate(cdpA.send, `document.querySelector("[data-testid=nav-mails]")?.click()`);
      await sleep(300);
    }
    await setField(cdpA.send, "recherche-mails", motRecherche);
    const debutRecherche = Date.now();
    let trouve = false;
    while (Date.now() - debutRecherche < 20_000) {
      trouve = Boolean(
        await evaluate(
          cdpA.send,
          `[...document.querySelectorAll("[data-testid=recherche-mail-hit]")].some((n) => (n.textContent || "").includes("Objet restreint"))`,
        ),
      );
      if (trouve) break;
      await sleep(400);
    }
    if (!trouve) fail("recherche FTS5 hors ligne muette");
    ok("poste titulaire : mail restreint, chrono, recherche hors ligne, sans secret");
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
    if (sqliteContientMot("s7b", motCompte)) fail("mot de passe dans le SQLite du collaborateur");
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
