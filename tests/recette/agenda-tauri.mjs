#!/usr/bin/env node
/**
 * Agenda — audiences, rendez-vous, tâches, rappels, notification Tauri, échéance calculée.
 * Deux postes. Un élément d'un dossier restreint est absent du SQLite du poste non autorisé
 * (fichier legalos-powersync-b.db). Les invitations mail restent au jalon J11.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
let posteA = session.startApp("aga", "9281", "dev");
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
    echeance = String(
      (await session.evaluate(
        a.send,
        `document.querySelector("[data-testid=delai-echeance]")?.getAttribute("data-echeance") ?? ""`,
      )) ?? "",
    ).trim();
    const visible = (await session.texte(a.send, "delai-echeance")).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(echeance) && visible !== "" && !/\d{4}-\d{2}-\d{2}/.test(visible)) break;
    await sleep(200);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(echeance)) fail(`échéance non calculée (${echeance})`);
  const visibleEcheance = (await session.texte(a.send, "delai-echeance")).trim();
  if (/\d{4}-\d{2}-\d{2}/.test(visibleEcheance)) fail(`date ISO affichée (${visibleEcheance})`);
  await session.evaluate(a.send, `document.querySelector("[data-testid=delai-inscrire]")?.click()`);
  const debutInscrit = Date.now();
  let inscrit = "";
  while (Date.now() - debutInscrit < 10_000) {
    inscrit = String(
      (await session.evaluate(
        a.send,
        `document.querySelector("[data-testid=delai-inscrit]")?.getAttribute("data-echeance") ?? ""`,
      )) ?? "",
    ).trim();
    if (inscrit === echeance) break;
    await sleep(200);
  }
  if (inscrit !== echeance) fail("échéance non inscrite à l'agenda");
  const visibleInscrit = (await session.texte(a.send, "delai-inscrit")).trim();
  if (/\d{4}-\d{2}-\d{2}/.test(visibleInscrit)) fail(`date ISO affichée après inscription (${visibleInscrit})`);
  ok(`échéance ${echeance} inscrite à l'agenda`);

  await ajouter("rendez_vous", `Hiver ${session.marque}`, "2026-10-27T09:30", "2026-10-26T08:00");
  const hiver = await session.evaluate(
    a.send,
    `(async () => {
      const rows = await window.__legalosRecette.lireSqlite(
        "SELECT debut FROM agenda_elements WHERE titre = ?",
        [${JSON.stringify(`Hiver ${session.marque}`)}],
      );
      return rows?.[0]?.debut ?? "";
    })()`,
  );
  if (hiver !== "2026-10-27T08:30:00.000Z") {
    fail(`9 h 30 le 27/10/2026 stocké ${hiver}`);
  }
  ok("rendez-vous du 27/10/2026 conservé à 9 h 30 Europe/Paris");

  await session.evaluate(
    a.send,
    `([...document.querySelectorAll("button")].find((b) => /^Agenda$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  const debutId = Date.now();
  let idEcheance = "";
  while (Date.now() - debutId < 20_000) {
    idEcheance = await session.evaluate(
      a.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          "SELECT id FROM agenda_elements WHERE titre LIKE 'Échéance du %' AND debut LIKE ? ORDER BY cree_le DESC LIMIT 1",
          [${JSON.stringify(`${echeance}%`)}],
        );
        return rows?.[0]?.id ?? "";
      })()`,
    );
    const present = idEcheance
      ? await session.evaluate(
          a.send,
          `Boolean(document.getElementById(${JSON.stringify(`echeance-origine-${idEcheance}`)}))`,
        )
      : false;
    if (present) break;
    await sleep(300);
  }
  if (!idEcheance) fail("échéance absente de l'agenda local");
  const origineVisible = await session.evaluate(
    a.send,
    `Boolean(document.getElementById(${JSON.stringify(`echeance-origine-${idEcheance}`)}))`,
  );
  if (!origineVisible) fail("origine de l'échéance absente de l'écran");
  await session.setField(a.send, `echeance-origine-${idEcheance}`, "2026-02-06");
  await session.evaluate(
    a.send,
    `document.getElementById(${JSON.stringify(`echeance-origine-${idEcheance}`)})?.parentElement?.querySelector("[data-testid=echeance-recalculer]")?.click()`,
  );
  const debutRecalc = Date.now();
  let recalculee = false;
  while (Date.now() - debutRecalc < 15_000) {
    const debutSql = await session.evaluate(
      a.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          "SELECT debut, origine_calcul FROM agenda_elements WHERE id = ?",
          [${JSON.stringify(idEcheance)}],
        );
        return rows?.[0] ?? null;
      })()`,
    );
    if (debutSql && debutSql.origine_calcul === "2026-02-06" && debutSql.debut !== `attente`) {
      const mur = String(debutSql.debut);
      if (!mur.startsWith(echeance)) {
        recalculee = true;
        break;
      }
    }
    await sleep(300);
  }
  if (!recalculee) fail("changement de date de départ sans recalcul");
  ok("échéance recalculée");

  await session.evaluate(
    a.send,
    `window.__legalosRecette.decalerOrigineSansRecalcul(${JSON.stringify(idEcheance)}, "2026-03-01")`,
  );
  const debutPerimee = Date.now();
  let perimee = false;
  while (Date.now() - debutPerimee < 10_000) {
    perimee = Boolean(
      await session.evaluate(a.send, `Boolean(document.querySelector("[data-testid=echeance-perimee]"))`),
    );
    if (perimee) break;
    await sleep(300);
  }
  if (!perimee) fail("essai négatif muet : origine changée sans signal de péremption");
  ok("échéance périmée signalée");

  const avantSuppr = await session.texte(a.send, "agenda-liste");
  await session.evaluate(
    a.send,
    `document.getElementById(${JSON.stringify(`echeance-origine-${idEcheance}`)})?.parentElement?.querySelector("[data-testid=echeance-supprimer]")?.click()`,
  );
  await sleep(400);
  const apresUnClic = await session.texte(a.send, "agenda-liste");
  if (!apresUnClic.includes(`Échéance ${echeance}`) && !apresUnClic.includes("Échéance")) {
    fail("suppression sans confirmation");
  }
  if (avantSuppr.length > 0 && apresUnClic.length === 0) fail("liste vidée sans confirmation");
  await session.evaluate(a.send, `document.querySelector("[data-testid=echeance-confirmer]")?.click()`);
  const debutTrace = Date.now();
  let retiree = false;
  while (Date.now() - debutTrace < 40_000) {
    const partie = await session.evaluate(
      a.send,
      `(async () => window.__legalosRecette.lireSqlite(
        "SELECT COUNT(*) AS n FROM agenda_elements WHERE id = ?",
        [${JSON.stringify(idEcheance)}],
      ))()`,
    );
    if (Number(partie?.[0]?.n ?? 1) === 0) {
      retiree = true;
      break;
    }
    await sleep(300);
  }
  if (!retiree) fail("échéance encore présente après confirmation");
  ok("suppression confirmée");
  const { sqlServeur } = await import("./lib/poste-session.mjs");
  const debutJournal = Date.now();
  let trace = "";
  while (Date.now() - debutJournal < 60_000) {
    trace = await sqlServeur(
      `SELECT CASE WHEN auteur_id IS NULL THEN '' ELSE 'qui' END || '|' || COALESCE(cree_le::text, '')
       FROM journal_modifications
       WHERE table_cible = 'agenda_elements' AND champ = 'supprime'
         AND enregistrement_id = '${idEcheance}'`,
    ).catch(() => "");
    if (trace.startsWith("qui|") && trace.length > 4) break;
    await sleep(500);
  }
  if (!trace.startsWith("qui|")) fail(`trace de suppression absente (${trace})`);
  ok("trace de suppression consultable");

  await ajouter("tache", `Rappel fermé ${session.marque}`, "2026-12-04T09:00", "2026-12-03T08:00");
  const debutRappel = Date.now();
  let idRappel = "";
  let revisionRappel = "";
  while (Date.now() - debutRappel < 40_000) {
    idRappel = await session.evaluate(
      a.send,
      `(async () => {
        const rows = await window.__legalosRecette.lireSqlite(
          "SELECT id FROM agenda_elements WHERE titre = ?",
          [${JSON.stringify(`Rappel fermé ${session.marque}`)}],
        );
        return rows?.[0]?.id ?? "";
      })()`,
    );
    if (idRappel) {
      revisionRappel = await sqlServeur(
        `SELECT revision FROM agenda_elements WHERE id = '${idRappel}'`,
      ).catch(() => "");
      if (revisionRappel) break;
    }
    await sleep(400);
  }
  if (!idRappel || !revisionRappel) fail("rappel futur absent du serveur");
  await sleep(2_500);
  const notifsFutur = await session.evaluate(a.send, `window.__legalosRecette.lireNotifications()`);
  if (
    Array.isArray(notifsFutur) &&
    notifsFutur.some((n) => String(n.titre).includes(`Rappel fermé ${session.marque}`))
  ) {
    fail("essai négatif muet : un rappel encore futur est notifié");
  }
  ok("rappel futur non notifié");
  await session.stopApp(posteA);
  const patchRappel = await session.apiJson(jeton, "PATCH", `/agenda/${idRappel}`, {
    base_revision: Number(revisionRappel),
    idempotence_cle: `ag-rappel-${session.marque}`,
    rappel_le: "2020-01-01T00:00:00.000Z",
  });
  if (patchRappel.status !== 200) {
    fail(`rappel échu non enregistré (${patchRappel.status} ${patchRappel.texte.slice(0, 160)})`);
  }
  await new Promise((resolve, reject) => {
    const enfant = spawn(
      "python",
      [
        "-c",
        `import json, os, sqlite3, sys
p = os.path.join(os.environ["APPDATA"], "fr.legalos.poste", "legalos-powersync-aga.db")
c = sqlite3.connect(p)
row = c.execute("SELECT data FROM ps_data__agenda_elements WHERE id = ?", (sys.argv[1],)).fetchone()
if row is None:
    raise SystemExit(2)
data = json.loads(row[0])
data["rappel_le"] = "2020-01-01T00:00:00.000Z"
c.execute("UPDATE ps_data__agenda_elements SET data = ? WHERE id = ?", (json.dumps(data, ensure_ascii=False), sys.argv[1]))
c.commit()`,
        idRappel,
      ],
      { stdio: "inherit" },
    );
    enfant.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sqlite rappel ${code}`))));
  });
  posteA = session.startApp("aga", "9281", "dev");
  await session.waitCdp(posteA);
  const relance = await session.connectCdp(posteA.port);
  await session.login(relance.send, demoEmail, demoPassword, totpSecretB32, `Agenda A2 ${session.marque}`);
  const debutFerme = Date.now();
  let notifieFerme = false;
  while (Date.now() - debutFerme < 40_000) {
    const rows = await session.evaluate(relance.send, `window.__legalosRecette.lireNotifications()`);
    if (Array.isArray(rows) && rows.some((n) => String(n.titre).includes(`Rappel fermé ${session.marque}`))) {
      notifieFerme = true;
      break;
    }
    await sleep(500);
  }
  if (!notifieFerme) fail("rappel échu app fermée non notifié au lancement");
  ok("rappel notifié au lancement suivant");
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

  const { sqlServeur } = await import("./lib/poste-session.mjs");
  const audienceId = await sqlServeur(
    `SELECT id FROM agenda_elements WHERE dossier_id = '${dossierPublic}' AND type_element = 'audience' LIMIT 1`,
  ).catch(() => "");
  if (!audienceId) fail("audience publique absente du serveur");
  const titreA = `ConflitA-${session.marque}`;
  const titreB = `ConflitB-${session.marque}`;
  const dataDir = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "fr.legalos.poste");
  for (const idPoste of ["agc", "agd"]) {
    for (const ext of ["", "-shm", "-wal"]) {
      rmSync(join(dataDir, `legalos-powersync-${idPoste}.db${ext}`), { force: true });
    }
  }

  async function attendreAudience(send) {
    const debut = Date.now();
    while (Date.now() - debut < 120_000) {
      const n = Number(
        await session.evaluate(
          send,
          `(async () => {
            const rows = await window.__legalosRecette.lireSqlite(
              "SELECT COUNT(*) AS n FROM agenda_elements WHERE id = ?",
              [${JSON.stringify(audienceId)}],
            );
            return Number(rows?.[0]?.n ?? 0);
          })()`,
        ),
      );
      if (n === 1) return;
      await sleep(500);
    }
    fail("audience absente du poste pour le conflit");
  }

  async function fileNonVide(send) {
    const nFile = Number(
      await session.evaluate(
        send,
        `(async () => {
          const rows = await window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud");
          return Number(rows?.[0]?.n ?? 0);
        })()`,
      ),
    );
    if (nFile < 1) fail("file du poste vide après écriture hors ligne");
  }

  let copieA = null;
  let copieD = null;
  let repriseA = null;
  let repriseD = null;
  try {
    copieA = session.startApp("agc", "9281", "copie");
    copieD = session.startApp("agd", "9283", "copie");
    await session.waitCdp(copieA);
    await session.waitCdp(copieD);
    const ca = await session.connectCdp(copieA.port);
    const cd = await session.connectCdp(copieD.port);
    await session.login(ca.send, demoEmail, demoPassword, totpSecretB32, `Agenda CA ${session.marque}`);
    await session.login(cd.send, demoEmail, demoPassword, totpSecretB32, `Agenda CD ${session.marque}`);
    await attendreAudience(ca.send);
    await attendreAudience(cd.send);
    await session.evaluate(ca.send, `window.__legalosRecette.disconnectSync()`);
    await session.evaluate(cd.send, `window.__legalosRecette.disconnectSync()`);
    await sleep(400);
    await session.evaluate(
      ca.send,
      `window.__legalosRecette.patchChamp("agenda_elements", ${JSON.stringify(audienceId)}, "titre", ${JSON.stringify(titreA)})`,
    );
    await session.evaluate(
      cd.send,
      `window.__legalosRecette.patchChamp("agenda_elements", ${JSON.stringify(audienceId)}, "titre", ${JSON.stringify(titreB)})`,
    );
    await fileNonVide(ca.send);
    await fileNonVide(cd.send);
    ok("écritures d'agenda hors ligne dans la file");
  } finally {
    await session.stopApp(copieA);
    await session.stopApp(copieD);
  }

  await session.stopApp(posteB);
  repriseA = session.startApp("agc", "9281", "dev");
  try {
    await session.waitCdp(repriseA);
    const ra = await session.connectCdp(repriseA.port);
    await session.login(ra.send, demoEmail, demoPassword, totpSecretB32, `Agenda RA ${session.marque}`);
    const debutTitre = Date.now();
    let titreServeur = "";
    while (Date.now() - debutTitre < 90_000) {
      titreServeur = await sqlServeur(
        `SELECT titre FROM agenda_elements WHERE id = '${audienceId}'`,
      ).catch(() => "");
      if (titreServeur === titreA || titreServeur === titreB) break;
      await sleep(500);
    }
    if (titreServeur !== titreA && titreServeur !== titreB) {
      fail(`premier titre hors ligne absent (${titreServeur})`);
    }
    const compte = await sqlServeur(
      `SELECT COUNT(*) FILTER (WHERE conflit) || '|' || COUNT(*) FILTER (WHERE NOT conflit)
       FROM journal_modifications
       WHERE table_cible = 'agenda_elements' AND champ = 'titre'
         AND enregistrement_id = '${audienceId}'`,
    );
    const [avecConflit, sansConflit] = compte.split("|");
    if (Number(sansConflit) < 1) fail("écriture seule absente du journal");
    if (Number(avecConflit) !== 0) fail("essai négatif muet : écriture seule marquée en conflit");
    ok("écriture seule sans conflit");
  } finally {
    await session.stopApp(repriseA);
  }

  repriseD = session.startApp("agd", "9282", "dev");
  try {
    await session.waitCdp(repriseD);
    const rd = await session.connectCdp(repriseD.port);
    await session.login(rd.send, demoEmail, demoPassword, totpSecretB32, `Agenda RD ${session.marque}`);
    const debutConflit = Date.now();
    let traceConflit = "";
    while (Date.now() - debutConflit < 90_000) {
      traceConflit = await sqlServeur(
        `SELECT COUNT(*) FROM journal_modifications
         WHERE conflit AND revision_base IS NOT NULL
           AND table_cible = 'agenda_elements' AND champ = 'titre'
           AND enregistrement_id = '${audienceId}'`,
      ).catch(() => "0");
      if (Number(traceConflit) >= 1) break;
      await sleep(500);
    }
    if (Number(traceConflit) < 1) fail("conflit d'agenda sans révision de base");
    ok("conflit journalisé avec révision de base");
    await session.evaluate(
      rd.send,
      `([...document.querySelectorAll("button")].find((btn) => /^Agenda$/u.test((btn.textContent || "").trim())) || null)?.click()`,
    );
    const debutSignal = Date.now();
    let signal = "";
    while (Date.now() - debutSignal < 120_000) {
      signal = await session.texte(rd.send, "agenda-conflit");
      if (signal.includes(titreA) || signal.includes(titreB)) break;
      await sleep(500);
    }
    if (!signal.includes(titreA) && !signal.includes(titreB)) {
      fail(`signal d'agenda absent (${signal.slice(0, 120)})`);
    }
    ok("conflit d'agenda signalé dans l'app");
  } finally {
    await session.stopApp(repriseD);
  }
} finally {
  await session.stopApp(posteB);
  session.fermer();
}

ok("tous les critères");
