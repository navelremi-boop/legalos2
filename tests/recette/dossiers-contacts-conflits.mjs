#!/usr/bin/env node
/**
 * Conflits dossiers et contacts : révision de base, journal, signal dans l'app.
 * Deux postes, file locale (pas deux PATCH HTTP).
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";

const session = creerSession("dossiers-contacts-conflits");
const { fail, ok } = session;

await session.assurerInstance();
const jeton = await demoAccessToken(`${session.instanceUrl}/api`, `dc-conflit-${session.marque}`);
const dossierId = randomUUID();
const contactId = randomUUID();
const partieId = randomUUID();
const nomA = `NomA-${session.marque}`;
const nomB = `NomB-${session.marque}`;
const etapeA = "jugement";
const etapeB = "execution";

async function creer(chemin, corps) {
  const reponse = await session.apiJson(jeton, "POST", chemin, corps);
  if (reponse.status !== 200) fail(`${chemin} → ${reponse.status} ${reponse.texte.slice(0, 180)}`);
}

await creer("/dossiers", {
  id: dossierId,
  idempotence_cle: `dcc-d-${dossierId}`,
  nom: `Conflit ${session.marque}`,
  chemise: "kraft",
  juridiction: "TJ Nanterre",
  numero_rg: `CF${session.marque}`,
  restreint: false,
  type_dossier: "contentieux",
  etape: "ouverture",
});
await creer("/contacts", {
  id: contactId,
  idempotence_cle: `dcc-c-${contactId}`,
  nature: "morale",
  nom: `Contact conflit ${session.marque}`,
  siren: "100000017",
  numero_tva: "FR15100000017",
  type_client: "professionnel",
});
await creer(`/dossiers/${dossierId}/parties`, {
  id: partieId,
  idempotence_cle: `dcc-p-${partieId}`,
  role: "client",
  nom: `Contact conflit ${session.marque}`,
  contact_id: contactId,
});
ok("dossier et contact créés");

async function lancer(id, port, mode) {
  const child = session.startApp(id, port, mode);
  await session.waitCdp(child);
  const cdp = await session.connectCdp(child.port);
  return { child, send: cdp.send, ws: cdp.ws };
}

async function attendreLocal(send, sql, params, predicat, delai = 120_000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    const rows = await session.evaluate(
      send,
      `(async () => window.__legalosRecette.lireSqlite(${JSON.stringify(sql)}, ${JSON.stringify(params)}))()`,
    );
    if (predicat(rows)) return rows;
    await sleep(500);
  }
  return null;
}

async function attendreSql(requete, predicat, delai = 90_000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    const valeur = await sqlServeur(requete).catch(() => "");
    if (predicat(valeur)) return valeur;
    await sleep(500);
  }
  return null;
}

session.resetPostes(["dca", "dcb"]);
let a = await lancer("dca", "9271", "dev");
try {
  await session.login(a.send, demoEmail, demoPassword, totpSecretB32, `DCC A ${session.marque}`);
  const vu = await attendreLocal(
    a.send,
    "SELECT id FROM contacts WHERE id = ?",
    [contactId],
    (rows) => Array.isArray(rows) && rows.length === 1,
  );
  if (!vu) fail("contact absent du poste A");
  ok("poste A a le contact");

  const b = await lancer("dcb", "9272", "copie");
  await session.login(b.send, demoEmail, demoPassword, totpSecretB32, `DCC B ${session.marque}`);
  const vuB = await attendreLocal(
    b.send,
    "SELECT id FROM contacts WHERE id = ?",
    [contactId],
    (rows) => Array.isArray(rows) && rows.length === 1,
  );
  if (!vuB) fail("contact absent du poste B");
  ok("poste B a le contact");

  await session.evaluate(a.send, `window.__legalosRecette.disconnectSync()`);
  await session.evaluate(b.send, `window.__legalosRecette.disconnectSync()`);
  await sleep(400);
  await session.evaluate(
    a.send,
    `window.__legalosRecette.patchChamp("contacts", ${JSON.stringify(contactId)}, "nom", ${JSON.stringify(nomA)})`,
  );
  await session.evaluate(
    a.send,
    `window.__legalosRecette.patchChamp("dossiers", ${JSON.stringify(dossierId)}, "etape", ${JSON.stringify(etapeA)})`,
  );
  await session.evaluate(
    b.send,
    `window.__legalosRecette.patchChamp("contacts", ${JSON.stringify(contactId)}, "nom", ${JSON.stringify(nomB)})`,
  );
  await session.evaluate(
    b.send,
    `window.__legalosRecette.patchChamp("dossiers", ${JSON.stringify(dossierId)}, "etape", ${JSON.stringify(etapeB)})`,
  );
  for (const sessionPoste of [a, b]) {
    const nFile = await session.evaluate(
      sessionPoste.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud");
        return Number(rows?.[0]?.n ?? 0);
      })()`,
    );
    if (Number(nFile) < 1) fail("file du poste vide après écriture hors ligne");
  }
  ok("écritures hors ligne dans la file");
  await session.stopApp(b.child);
  await session.stopApp(a.child);

  a = await lancer("dca", "9271", "dev");
  await session.login(a.send, demoEmail, demoPassword, totpSecretB32, `DCC A2 ${session.marque}`);
  const nomServeur = await attendreSql(
    `SELECT nom FROM contacts WHERE id = '${contactId}'`,
    (v) => v === nomA || v === nomB,
  );
  if (!nomServeur) fail("premier envoi hors ligne absent du serveur");
  ok(`premier nom arrivé (${nomServeur})`);
  await session.stopApp(a.child);

  const b2 = await lancer("dcb", "9272", "dev");
  await session.login(b2.send, demoEmail, demoPassword, totpSecretB32, `DCC B2 ${session.marque}`);
  const conflits = await attendreSql(
    `SELECT COUNT(*) FROM journal_modifications
     WHERE conflit AND enregistrement_id IN ('${contactId}', '${dossierId}')`,
    (v) => Number(v) >= 1,
  );
  if (!conflits) fail("aucun conflit journalisé");
  const base = await sqlServeur(
    `SELECT COUNT(*) FROM journal_modifications
     WHERE conflit AND revision_base = 1
       AND enregistrement_id IN ('${contactId}', '${dossierId}')`,
  );
  if (Number(base) < 1) fail("conflit sans révision de base");
  ok("conflit journalisé avec révision de base");

  await session.evaluate(
    b2.send,
    `(() => {
      const compte = [...document.querySelectorAll("button")].find((el) =>
        /^Compte$/i.test((el.textContent || "").trim()),
      );
      compte?.click();
      return Boolean(compte);
    })()`,
  );
  await sleep(400);
  await session.evaluate(
    b2.send,
    `(() => {
      const reglages = [...document.querySelectorAll("button")].find((el) =>
        /réglages|reglages/i.test(el.textContent || ""),
      );
      reglages?.click();
      return Boolean(reglages);
    })()`,
  );
  await sleep(400);
  await session.evaluate(b2.send, `document.querySelector("[data-testid=se-reconnecter]")?.click()`);
  const debutAuth = Date.now();
  while (Date.now() - debutAuth < 15_000) {
    const ecran = await session.ecranAuth(b2.send);
    if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
    await sleep(200);
  }
  await session.login(b2.send, demoEmail, demoPassword, totpSecretB32, `DCC B3 ${session.marque}`);
  await session.ouvrirDossier(b2.send, dossierId);
  const debutSignal = Date.now();
  let signalContact = false;
  let signalDossier = false;
  while (Date.now() - debutSignal < 120_000) {
    const nContact = Number(
      await session.evaluate(
        b2.send,
        `(async () => {
          const rows = await window.__legalosRecette.lireSqlite(
            "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1 AND table_cible = 'contacts' AND enregistrement_id = ?",
            [${JSON.stringify(contactId)}],
          );
          return Number(rows?.[0]?.n ?? 0);
        })()`,
      ),
    );
    signalContact = Boolean(
      await session.evaluate(b2.send, `Boolean(document.querySelector("[data-testid=contact-conflit]"))`),
    );
    signalDossier = Boolean(
      await session.evaluate(b2.send, `Boolean(document.querySelector("[data-testid=dossier-conflit]"))`),
    );
    if (signalContact && signalDossier) break;
    if (nContact >= 1 && !signalContact && Date.now() - debutSignal > 8_000) {
      await session.ouvrirDossier(b2.send, dossierId);
    }
    await sleep(500);
  }
  if (!signalContact || !signalDossier) {
    fail(`conflit non signalé (contact ${signalContact}, étape ${signalDossier})`);
  }
  ok("conflits signalés dans l'interface");
  await session.stopApp(b2.child);
} finally {
  await session.stopApp(a.child);
}

ok("tous les critères");
session.fermer();
