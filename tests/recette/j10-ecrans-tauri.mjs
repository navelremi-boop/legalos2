#!/usr/bin/env node
/**
 * J10 — écrans du § 7.6 dans l'app Tauri.
 * Hors dossier : fond neutre, barre du haut, feuille, barre d'actions, sans étiquette.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

process.env.LEGALOS_CARGO_TARGET = "C:\\Users\\PC\\legalos2\\.worktrees\\j9\\target";
const ui = creerSession("j10");
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
  fermer,
} = ui;

const ECRANS = [
  ["journee", "ecran-journee"],
  ["dossiers", "ecran-dossiers"],
  ["mails", "ecran-mails"],
  ["agenda", "ecran-agenda"],
  ["facturation", "ecran-facturation"],
];

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
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : {};
}

async function attendreSqlite(id, sql, predicat) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < 120_000) {
    try {
      dernier = await sqliteLocal(id, sql);
      if (predicat(dernier)) return;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`SQLite : ${dernier}`);
}

async function cliquer(send, selecteur) {
  await evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.click()`);
}

async function attendreSelecteur(send, selecteur) {
  const debut = Date.now();
  while (Date.now() - debut < 20_000) {
    const present = Boolean(
      await evaluate(send, `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`),
    );
    if (present) return;
    await sleep(250);
  }
  fail(`absent : ${selecteur}`);
}

async function assertHorsDossier(send, testid) {
  await attendreSelecteur(send, `[data-testid=${testid}]`);
  const etat = await evaluate(
    send,
    `(() => {
      const ecran = document.querySelector(${JSON.stringify(`[data-testid=${testid}]`)});
      return {
        fond: ecran?.getAttribute("data-fond") ?? "",
        barre: Boolean(document.querySelector("[data-testid=barre-haut]")),
        feuille: Boolean(ecran?.querySelector("[data-testid=feuille]")),
        actions: Boolean(document.querySelector("[data-testid=barre-actions]")),
        etiquette: Boolean(document.querySelector("[data-testid=etiquette-dossier]")),
      };
    })()`,
  );
  if (etat.fond !== "neutre") fail(`${testid} : fond ${etat.fond}`);
  if (!etat.barre) fail(`${testid} : barre du haut absente`);
  if (!etat.feuille) fail(`${testid} : feuille absente`);
  if (!etat.actions) fail(`${testid} : barre d'actions absente`);
  if (etat.etiquette) fail(`${testid} : étiquette de dossier hors dossier`);
}

async function main() {
  const sante = await fetch(`${api.replace(/\/api$/, "")}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");

  const marque = String(Date.now()).slice(-6);
  const jeton = await demoAccessToken(api, `j10-${marque}`);
  const dossierId = randomUUID();
  await json("/dossiers", jeton, "POST", {
    id: dossierId,
    idempotence_cle: `j10-${dossierId}`,
    nom: `J10 ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-J10-${marque}`,
    restreint: false,
  });
  const cabinet = await sqlServeur(
    `SELECT cabinet_id FROM dossiers WHERE id = '${dossierId}'`,
  );
  let compte = await sqlServeur(
    `SELECT id FROM comptes_mail WHERE type_compte = 'classement' AND cabinet_id = '${cabinet}' LIMIT 1`,
  );
  if (!compte) {
    compte = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref)
       VALUES ('${compte}', '${cabinet}', 'classement', 'classement@cabinet.example', 'srv:j10')`,
    );
  }
  const idClasse = randomUUID();
  const idAClasser = randomUUID();
  const uid = Date.now() % 1_000_000_000;
  await sqlServeur(
    `INSERT INTO messages (
       id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement
     ) VALUES (
       '${idClasse}', '${cabinet}', '${compte}', '${dossierId}',
       '<j10-classe-${marque}@cabinet.example>', 1, ${uid},
       'Mail classe J10', 'tiers@example.com', 'classe'
     )`,
  );
  await sqlServeur(
    `INSERT INTO messages (
       id, cabinet_id, compte_id, suggestion_dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement
     ) VALUES (
       '${idAClasser}', '${cabinet}', '${compte}', '${dossierId}',
       '<j10-aclasser-${marque}@cabinet.example>', 1, ${uid + 1},
       'Mail a classer J10', 'autre@example.com', 'a_classer'
     )`,
  );

  spawnSync("docker", ["restart", "legalos-instance-powersync-1"], { stdio: "inherit" });
  await sleep(8000);

  resetPostes(["j10a"]);
  const app = startApp("j10a", 9345);
  try {
    await waitCdp(app);
    const cdp = await connectCdp(app.port);
    await login(cdp.send, demoEmail, demoPassword, totpSecretB32, `J10 ${marque}`);
    await attendreSqlite(
      "j10a",
      `SELECT COUNT(*) FROM messages WHERE id = '${idAClasser}'`,
      (v) => v === "1",
    );

    for (const [nav, testid] of ECRANS) {
      await cliquer(cdp.send, `[data-testid=nav-${nav}]`);
      await assertHorsDossier(cdp.send, testid);
      ok(testid);
    }

    await cliquer(cdp.send, "[data-testid=nav-journee]");
    await attendreSelecteur(cdp.send, "[data-testid=section-audiences]");
    for (const id of ["audiences", "delais", "mails", "temps"]) {
      await attendreSelecteur(cdp.send, `[data-testid=section-${id}]`);
    }
    const actions = String(
      (await evaluate(cdp.send, `document.querySelector("[data-testid=barre-actions]")?.innerText ?? ""`)) ??
        "",
    );
    for (const libelle of ["Nouveau dossier", "Nouveau mail", "Saisir du temps"]) {
      if (!actions.includes(libelle)) fail(`barre d'actions sans ${libelle}`);
    }
    await attendreSelecteur(cdp.send, "[data-testid=pastille-dossier]");
    ok("journée");

    await cliquer(cdp.send, "[data-testid=nav-mails]");
    await attendreSelecteur(cdp.send, "[data-testid=mails-comptes]");
    await attendreSelecteur(cdp.send, "[data-testid=mails-liste]");
    await attendreSelecteur(cdp.send, "[data-testid=mails-lecture]");
    await evaluate(
      cdp.send,
      `document.querySelector("[data-testid=mail-ligne][data-etat=a_classer]")?.click()`,
    );
    const debut = Date.now();
    let banniere = "";
    while (Date.now() - debut < 15_000) {
      banniere = String(
        (await evaluate(
          cdp.send,
          `document.querySelector("[data-testid=banniere-classer]")?.textContent ?? ""`,
        )) ?? "",
      );
      if (banniere.includes("Classer dans")) break;
      await sleep(300);
    }
    if (!banniere.includes("Classer dans")) fail("bandeau de classement absent");
    const pastille = Boolean(
      await evaluate(cdp.send, `Boolean(document.querySelector("[data-testid=pastille-mail]"))`),
    );
    if (!pastille) fail("pastille absente d'un mail classé");
    ok("mails");

    await cliquer(cdp.send, "[data-testid=menu-compte]");
    await cliquer(cdp.send, "[data-testid=menu-reglages]");
    await assertHorsDossier(cdp.send, "ecran-reglages");
    ok("réglages");
    cdp.ws.close();
  } finally {
    await stopApp(app);
  }
  ok("OK");
}

main()
  .catch((err) => {
    fail(err instanceof Error ? err.message : err);
  })
  .finally(() => fermer());
