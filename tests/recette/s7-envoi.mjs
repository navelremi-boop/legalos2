#!/usr/bin/env node
/**
 * S7 / J9 étape 2 — file d'envoi (§ 3.8.3) contre GreenMail.
 * Cycle brouillon → en attente → envoyé → copie Envoyés confirmée ;
 * coupure après SMTP sans perte ni doublon ; copie classée dans le dossier.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, racineInstance, sleep } from "./lib/poste-session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;

function fail(message) {
  console.error(`s7-envoi: FAIL — ${message}`);
  process.exit(1);
}

async function json(chemin, jeton, methode = "GET", corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 400)}`);
  return texte ? JSON.parse(texte) : {};
}

async function main() {
  const envPath = existsSync(join(racineInstance(), ".env"))
    ? join(racineInstance(), ".env")
    : join(root, ".env");
  if (!existsSync(envPath)) fail(".env introuvable");

  const jeton = await demoAccessToken(api, `s7-envoi-${randomUUID().slice(0, 8)}`);

  const dossierId = randomUUID();
  const cree = await json("/dossiers", jeton, "POST", {
    id: dossierId,
    idempotence_cle: `s7-envoi-d-${dossierId}`,
    nom: "Envoi depuis dossier",
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-S7E-${Date.now()}`,
    restreint: false,
  });
  if (!cree.reference) fail("référence dossier absente");

  const mid = `<s7-envoi-${randomUUID()}@cabinet.example>`;
  const envoiId = randomUUID();
  let envoi = await json("/messagerie/file-envoi", jeton, "POST", {
    id: envoiId,
    idempotence_cle: `s7-envoi-${envoiId}`,
    dossier_id: dossierId,
    destinataire: "destinataire.envoi@example.com",
    objet: `Envoi ${cree.reference}`,
    corps: "Corps fictif file d'envoi.",
    message_id: mid,
  });
  if (envoi.etat !== "brouillon") fail(`brouillon attendu, obtenu ${envoi.etat}`);
  if (envoi.message_id !== mid) fail("message_id modifié à la création");

  envoi = await json(`/messagerie/file-envoi/${envoiId}/mettre-en-attente`, jeton, "POST");
  if (envoi.etat !== "en_attente") fail("en_attente attendu");

  // Annulation pendant le délai
  envoi = await json(`/messagerie/file-envoi/${envoiId}/annuler`, jeton, "POST");
  if (envoi.etat !== "brouillon") fail("annulation doit ramener au brouillon");
  envoi = await json(`/messagerie/file-envoi/${envoiId}/mettre-en-attente`, jeton, "POST");

  // Coupure après SMTP
  envoi = await json(
    `/messagerie/file-envoi/${envoiId}/traiter?couper_apres=smtp`,
    jeton,
    "POST",
  );
  if (envoi.etat !== "envoye") fail(`après SMTP : envoye attendu, obtenu ${envoi.etat}`);
  if (envoi.tentatives < 1) fail("tentative SMTP non comptée");
  const midApresSmtp = envoi.message_id;

  // Reprise : ne renvoie pas (vérifie Envoyés / APPEND seulement)
  envoi = await json(`/messagerie/file-envoi/${envoiId}/traiter`, jeton, "POST");
  if (envoi.etat !== "copie_envoyes_confirmee") {
    fail(`copie Envoyés confirmée attendue, obtenu ${envoi.etat}`);
  }
  if (envoi.message_id !== midApresSmtp) fail("message_id changé après reprise");

  // Idempotence : retraiter ne re-envoie pas
  const avant = envoi.tentatives;
  envoi = await json(`/messagerie/file-envoi/${envoiId}/traiter`, jeton, "POST");
  if (envoi.etat !== "copie_envoyes_confirmee") fail("état final perdu");
  if (envoi.tentatives !== avant) fail("nouvelle tentative après confirmation");

  // Copie classée dans le dossier
  const chrono = await json(`/dossiers/${dossierId}/chrono-mails`, jeton);
  if (!chrono.some((m) => m.message_id === mid)) {
    fail("copie classée absente du chrono dossier");
  }

  // Second envoi avec échec simulé puis succès (cycle visible)
  const mid2 = `<s7-envoi-ok-${randomUUID()}@cabinet.example>`;
  const id2 = randomUUID();
  await json("/messagerie/file-envoi", jeton, "POST", {
    id: id2,
    idempotence_cle: `s7-envoi-${id2}`,
    dossier_id: dossierId,
    destinataire: "autre@example.com",
    objet: "Second envoi",
    corps: "ok",
    message_id: mid2,
  });
  await json(`/messagerie/file-envoi/${id2}/mettre-en-attente`, jeton, "POST");
  const fin = await json(`/messagerie/file-envoi/${id2}/traiter`, jeton, "POST");
  if (fin.etat !== "copie_envoyes_confirmee") fail(`second envoi : ${fin.etat}`);

  const liste = await json("/messagerie/file-envoi", jeton);
  if (!liste.some((e) => e.id === envoiId && e.etat === "copie_envoyes_confirmee")) {
    fail("cycle de vie absent de la liste");
  }

  // Échec simulé puis nouvelle tentative : le message reste dans la file, un seul envoi réel.
  const midEchec = `<s7-envoi-echec-${randomUUID()}@cabinet.example>`;
  const idEchec = randomUUID();
  await json("/messagerie/file-envoi", jeton, "POST", {
    id: idEchec,
    idempotence_cle: `s7-envoi-${idEchec}`,
    dossier_id: dossierId,
    destinataire: "echec.envoi@example.com",
    objet: "Echec puis reprise",
    corps: "echec",
    message_id: midEchec,
  });
  await json(`/messagerie/file-envoi/${idEchec}/mettre-en-attente`, jeton, "POST");
  const echec = await json(
    `/messagerie/file-envoi/${idEchec}/traiter?couper_apres=echec`,
    jeton,
    "POST",
  );
  if (echec.etat !== "echec") fail(`échec attendu, obtenu ${echec.etat}`);
  if (echec.message_id !== midEchec) fail("message_id changé après échec");
  const repriseEchec = await json(`/messagerie/file-envoi/${idEchec}/traiter`, jeton, "POST");
  if (repriseEchec.etat !== "copie_envoyes_confirmee") {
    fail(`reprise après échec : ${repriseEchec.etat}`);
  }
  if (repriseEchec.message_id !== midEchec) fail("message_id changé à la reprise d'échec");
  if (repriseEchec.tentatives < 2) fail("la reprise n'a pas retenté");

  const marque = String(Date.now()).slice(-6);
  const pares = [
    { id: randomUUID(), etat: "brouillon", objet: `Brouillon visible ${marque}` },
    { id: randomUUID(), etat: "en_attente", objet: `Attente visible ${marque}` },
    { id: randomUUID(), etat: "envoye", objet: `Envoye visible ${marque}` },
    { id: randomUUID(), etat: "echec", objet: `Echec visible ${marque}` },
  ];
  for (const pare of pares) {
    await json("/messagerie/file-envoi", jeton, "POST", {
      id: pare.id,
      idempotence_cle: `s7-envoi-ui-${pare.id}`,
      dossier_id: dossierId,
      destinataire: "visible.envoi@example.com",
      objet: pare.objet,
      corps: "visible dans l'app",
      message_id: `<s7-envoi-ui-${pare.id}@cabinet.example>`,
    });
    if (pare.etat === "brouillon") continue;
    await json(`/messagerie/file-envoi/${pare.id}/mettre-en-attente`, jeton, "POST");
    if (pare.etat === "en_attente") continue;
    const coupe = pare.etat === "echec" ? "?couper_apres=echec" : "?couper_apres=smtp";
    const obtenu = await json(`/messagerie/file-envoi/${pare.id}/traiter${coupe}`, jeton, "POST");
    if (obtenu.etat !== pare.etat) fail(`état ${pare.etat} attendu, obtenu ${obtenu.etat}`);
  }

  const ui = creerSession("s7-envoi-ui");
  ui.resetPostes(["s7e"]);
  const app = ui.startApp("s7e", 9343);
  try {
    await ui.waitCdp(app);
    const cdp = await ui.connectCdp(app.port);
    await ui.login(cdp.send, demoEmail, demoPassword, totpSecretB32, `Envoi ${marque}`);
    const debut = Date.now();
    let manquants = pares.map((p) => p.etat);
    while (Date.now() - debut < 30_000) {
      const vus = await ui.evaluate(
        cdp.send,
        `[...document.querySelectorAll("[data-testid=file-envoi-ligne]")].map((n) => n.getAttribute("data-etat"))`,
      );
      const liste = Array.isArray(vus) ? vus : [];
      manquants = ["brouillon", "en_attente", "envoye", "copie_envoyes_confirmee", "echec"].filter(
        (etat) => !liste.includes(etat),
      );
      const annuler = await ui.evaluate(
        cdp.send,
        `Boolean(document.querySelector("[data-etat=en_attente] [data-testid=file-envoi-annuler]"))`,
      );
      const reessayer = await ui.evaluate(
        cdp.send,
        `Boolean(document.querySelector("[data-etat=echec] [data-testid=file-envoi-reessayer]"))`,
      );
      if (manquants.length === 0 && annuler && reessayer) break;
      await ui.evaluate(cdp.send, `document.querySelector("[data-testid=nav-mails]")?.click()`);
      await sleep(400);
    }
    if (manquants.length > 0) fail(`cycle absent de l'app : ${manquants.join(", ")}`);
    cdp.ws.close();
  } finally {
    await ui.stopApp(app);
    ui.fermer();
  }

  await sleep(200);
  console.log("s7-envoi: OK");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
