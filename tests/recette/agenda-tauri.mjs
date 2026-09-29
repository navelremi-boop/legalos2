#!/usr/bin/env node
/**
 * Agenda — audiences, rendez-vous, tâches, rappels, notification Tauri, échéance calculée.
 * Deux postes. Un élément d'un dossier restreint est absent du SQLite du poste non autorisé
 * (fichier legalos-powersync-b.db). Les invitations mail restent au jalon J11.
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal } from "./lib/poste-session.mjs";

const session = creerSession("agenda-tauri");
const { fail, ok } = session;
const collabEmail = "collab-j5@cabinet-fictif.example";
const collabPassword = "MotDePasseCollab123!";
const collabTotp = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";

await session.assurerInstance();
const table = await sqliteAttenteTable();
if (table !== "1") fail("table agenda_elements absente (migration 022)");

const jeton = await demoAccessToken(`${session.instanceUrl}/api`, `agenda-${session.marque}`);
const dossierR = randomUUID();
const elementR = randomUUID();
const refuse = await session.apiJson(jeton, "POST", `/dossiers/${dossierR}/agenda`, {
  id: randomUUID(),
  idempotence_cle: `ag-inv-${session.marque}`,
  type_element: "invitation",
  titre: "Invitation mail",
  debut: "2026-10-01T09:00:00.000Z",
});
if (refuse.status !== 403 && refuse.status !== 404 && refuse.status !== 400) {
  fail(`invitation mail acceptée (${refuse.status})`);
}
const creeR = await session.apiJson(jeton, "POST", "/dossiers", {
  id: dossierR,
  idempotence_cle: `ag-dr-${dossierR}`,
  nom: `Restreint agenda ${session.marque}`,
  chemise: "gris-perle",
  juridiction: "TJ Paris",
  numero_rg: `AR${session.marque}`,
  restreint: true,
});
if (creeR.status !== 200) fail(`dossier restreint ${creeR.status}`);
const agendaR = await session.apiJson(jeton, "POST", `/dossiers/${dossierR}/agenda`, {
  id: elementR,
  idempotence_cle: `ag-er-${elementR}`,
  type_element: "audience",
  titre: `Audience restreinte ${session.marque}`,
  debut: "2026-11-02T09:00:00.000Z",
  rappel_le: "2026-11-01T09:00:00.000Z",
});
if (agendaR.status !== 200) fail(`agenda restreint ${agendaR.status} ${agendaR.texte.slice(0, 160)}`);
const invitation = await session.apiJson(jeton, "POST", `/dossiers/${dossierR}/agenda`, {
  id: randomUUID(),
  idempotence_cle: `ag-inv2-${session.marque}`,
  type_element: "invitation",
  titre: "Invitation mail",
  debut: "2026-10-01T09:00:00.000Z",
});
if (invitation.status !== 400) fail(`type invitation accepté (${invitation.status})`);
ok("API : audience restreinte créée, invitation mail refusée");

async function sqliteAttenteTable() {
  const { sqlServeur } = await import("./lib/poste-session.mjs");
  return sqlServeur(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agenda_elements'`,
  ).catch(() => "");
}

const creation = await fetch(`${session.instanceUrl}/api/collaborateurs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
  body: JSON.stringify({
    email: collabEmail,
    password: collabPassword,
    totp_secret_base32: collabTotp,
  }),
});
if (!creation.ok && creation.status !== 409 && creation.status !== 400) {
  fail(`collaborateur ${creation.status}`);
}

session.resetPostes(["aga", "b"]);
const posteA = session.startApp("aga", "9281", "dev");
let dossierPublic = "";
try {
  await session.waitCdp(posteA);
  const a = await session.connectCdp(posteA.port);
  await session.login(a.send, demoEmail, demoPassword, totpSecretB32, `Agenda A ${session.marque}`);
  dossierPublic = await session.creerDossier(a.send, {
    nom: `Dossier agenda ${session.marque}`,
    juridiction: "TJ Lyon",
    rg: `AG${session.marque}`,
    partie: `Client ${session.marque}`,
    typeDossier: "contentieux",
    etape: "instruction",
  });
  await session.ouvrirDossier(a.send, dossierPublic);

  async function ajouter(type, titre, debut, rappel) {
    await session.evaluate(
      a.send,
      `([...document.querySelectorAll("button")].find((b) => /^Agenda$/u.test((b.textContent || "").trim())) || null)?.click()`,
    );
    const debutNav = Date.now();
    while (Date.now() - debutNav < 15_000) {
      if (await session.evaluate(a.send, `Boolean(document.getElementById("agenda-titre"))`)) break;
      await sleep(200);
    }
    await session.setField(a.send, "agenda-type", type);
    await session.setField(a.send, "agenda-dossier", dossierPublic);
    await session.setField(a.send, "agenda-titre", titre);
    await session.setField(a.send, "agenda-debut", debut);
    await session.setField(a.send, "agenda-rappel", rappel);
    await session.evaluate(a.send, `document.getElementById("agenda-titre")?.closest("form")?.requestSubmit()`);
    await sleep(400);
  }
  const passe = "2020-01-01T08:00:00.000Z";
  await ajouter("audience", `Audience ${session.marque}`, "2026-12-01T09:00:00.000Z", passe);
  await ajouter("rendez_vous", `Rendez-vous ${session.marque}`, "2026-12-02T10:00:00.000Z", passe);
  await ajouter("tache", `Tâche ${session.marque}`, "2026-12-03T11:00:00.000Z", passe);

  const debutListe = Date.now();
  let liste = "";
  while (Date.now() - debutListe < 20_000) {
    liste = await session.texte(a.send, "agenda-liste");
    if (liste.includes(`Audience ${session.marque}`) && liste.includes(`Rendez-vous ${session.marque}`) && liste.includes(`Tâche ${session.marque}`)) {
      break;
    }
    await sleep(300);
  }
  if (!liste.includes("audience") || !liste.includes("rendez_vous") || !liste.includes("tache")) {
    fail(`liste agenda incomplète (${liste.slice(0, 180)})`);
  }
  ok("audiences, rendez-vous et tâches inscrits avec rappel");

  const debutNotif = Date.now();
  let notif = false;
  while (Date.now() - debutNotif < 30_000) {
    const rows = await session.evaluate(
      a.send,
      `window.__legalosRecette.lireNotifications()`,
    );
    if (Array.isArray(rows) && rows.some((n) => String(n.titre).includes(`Audience ${session.marque}`))) {
      notif = true;
      break;
    }
    await sleep(500);
  }
  if (!notif) fail("notification Tauri absente pour le rappel échu");
  ok("notification Tauri émise");

  await session.ouvrirDossier(a.send, dossierPublic);
  await session.evaluate(
    a.send,
    `([...document.querySelectorAll("button")].find((b) => /délai/i.test(b.textContent || "")) || null)?.click()`,
  );
  const debutForm = Date.now();
  while (Date.now() - debutForm < 15_000) {
    if (await session.evaluate(a.send, `Boolean(document.getElementById("delai-origine"))`)) break;
    await sleep(200);
  }
  await session.setField(a.send, "delai-origine", "2026-01-06");
  await session.setField(a.send, "delai-jours", "15");
  await session.evaluate(a.send, `document.getElementById("delai-origine")?.closest("form")?.requestSubmit()`);
  const debutEch = Date.now();
  let echeance = "";
  while (Date.now() - debutEch < 10_000) {
    echeance = (await session.texte(a.send, "delai-echeance")).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(echeance)) break;
    await sleep(200);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(echeance)) fail(`échéance non calculée (${echeance})`);
  await session.evaluate(a.send, `document.querySelector("[data-testid=delai-inscrire]")?.click()`);
  const debutInscrit = Date.now();
  let inscrit = "";
  while (Date.now() - debutInscrit < 10_000) {
    inscrit = (await session.texte(a.send, "delai-inscrit")).trim();
    if (inscrit === echeance) break;
    await sleep(200);
  }
  if (inscrit !== echeance) fail("échéance non inscrite à l'agenda");
  ok(`échéance ${echeance} inscrite à l'agenda`);
} finally {
  await session.stopApp(posteA);
}

const posteB = session.startApp("b", "9282", "dev");
try {
  await session.waitCdp(posteB);
  const b = await session.connectCdp(posteB.port);
  await session.login(b.send, collabEmail, collabPassword, collabTotp, `Agenda B ${session.marque}`);
  const debutSync = Date.now();
  let publicVu = false;
  while (Date.now() - debutSync < 120_000) {
    const n = Number(
      await session.evaluate(
        b.send,
        `(async () => {
          const rows = await window.__legalosRecette.lireSqlite(
            "SELECT COUNT(*) AS n FROM agenda_elements WHERE dossier_id = ? AND type_element = 'audience'",
            [${JSON.stringify(dossierPublic)}],
          );
          return Number(rows?.[0]?.n ?? 0);
        })()`,
      ),
    );
    if (n >= 1) {
      publicVu = true;
      break;
    }
    await sleep(500);
  }
  if (!publicVu) fail("audience publique absente du second poste");
  const restreint = Number(
    await sqliteLocal("b", `SELECT COUNT(*) FROM agenda_elements WHERE dossier_id = '${dossierR}'`),
  );
  if (restreint !== 0) {
    fail(`élément d'agenda restreint présent chez le poste non autorisé (${restreint})`);
  }
  ok("second poste : public reçu, restreint absent du SQLite");
} finally {
  await session.stopApp(posteB);
  session.fermer();
}

ok("tous les critères");
