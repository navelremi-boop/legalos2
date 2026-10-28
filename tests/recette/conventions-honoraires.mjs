#!/usr/bin/env node
/**
 * Conventions d'honoraires — production par la fusion, statuts, modes repris à la facturation, alerte.
 * Usage : node tests/recette/conventions-honoraires.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep } from "./lib/poste-session.mjs";

const session = creerSession("conventions-honoraires");
const { fail, ok, assurerInstance, evaluate, setField } = session;

await assurerInstance();
const creds = {
  email: demoEmail,
  password: demoPassword,
  secret: totpSecretB32,
  nomAppareil: `Conventions ${session.marque}`,
  mode: "dev",
};
const { child, page } = await session.ouvrirPoste("cho", "9299", { ...creds, forcer: true });
const send = page.send;

async function attendre(nom, expression, delaiMs = 25_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(250);
  }
  fail(`${nom} : condition non atteinte`);
}

async function referencePrete(dossierId) {
  await attendre(
    "référence",
    `(async () => {
      const rows = await window.__legalosRecette.lireSqlite("SELECT reference FROM dossiers WHERE id = ?", [${JSON.stringify(dossierId)}]);
      return Boolean(rows?.[0]?.reference);
    })()`,
    60_000,
  );
}

try {
  const id = await session.creerDossier(send, {
    nom: `Convention ${session.marque}`,
    juridiction: "TJ Paris",
    rg: `CV${session.marque}`,
    partie: `Client ${session.marque}`,
    typeDossier: "contentieux",
    etape: "ouverture",
  });
  await session.ouvrirDossier(send, id);
  await referencePrete(id);
  await attendre("alerte", `Boolean(document.querySelector("[data-testid=alerte-convention]"))`);
  await setField(send, "convention-mode", "forfait");
  await evaluate(send, `document.querySelector("[data-testid=convention-produire]")?.click()`);
  await attendre(
    "brouillon",
    `document.querySelector("[data-testid=convention-ligne]")?.getAttribute("data-statut") === "brouillon" && document.querySelector("[data-testid=convention-ligne]")?.getAttribute("data-mode") === "forfait"`,
    40_000,
  );
  ok("convention produite, brouillon, mode forfait");
  await evaluate(send, `document.querySelector("[data-testid=convention-envoyer]")?.click()`);
  await attendre(
    "envoyée",
    `document.querySelector("[data-testid=convention-ligne]")?.getAttribute("data-statut") === "envoyee"`,
  );
  const dossierTemp = mkdtempSync(join(tmpdir(), "convention-signee-"));
  const chemin = join(dossierTemp, "exemplaire-signe.pdf");
  writeFileSync(chemin, "exemplaire fictif");
  const doc = await send("DOM.getDocument", { depth: 0 });
  const noeud = await send("DOM.querySelector", {
    nodeId: doc.result.root.nodeId,
    selector: "[data-testid=convention-signe]",
  });
  if (!noeud.result.nodeId) fail("dépôt de l'exemplaire signé absent");
  await send("DOM.setFileInputFiles", { files: [chemin], nodeId: noeud.result.nodeId });
  await attendre(
    "signée",
    `document.querySelector("[data-testid=convention-ligne]")?.getAttribute("data-statut") === "signee" && !document.querySelector("[data-testid=alerte-convention]")`,
    20_000,
  );
  const ligne = await evaluate(
    send,
    `(async () => (await window.__legalosRecette.lireSqlite(
      "SELECT statut, mode, document_id, signe_nom FROM conventions_honoraires WHERE dossier_id = ?",
      [${JSON.stringify(id)}],
    ))?.[0])()`,
  );
  if (ligne?.statut !== "signee" || ligne?.mode !== "forfait" || !ligne?.document_id || !String(ligne?.signe_nom).includes("exemplaire-signe")) {
    fail(`ligne locale inattendue (${JSON.stringify(ligne)})`);
  }
  ok("exemplaire signé déposé, alerte levée par la signature");

  for (const mode of ["temps", "resultat"]) {
    await setField(send, "convention-mode", mode);
    await evaluate(send, `document.querySelector("[data-testid=convention-produire]")?.click()`);
    await attendre(
      mode,
      `[...document.querySelectorAll("[data-testid=convention-ligne]")].some((ligne) => ligne.getAttribute("data-mode") === ${JSON.stringify(mode)})`,
      40_000,
    );
  }
  ok("modes temps passé et résultat enregistrés");

  await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
  await attendre("menu temps", `Boolean(document.querySelector("[data-testid=menu-compte-temps]"))`, 5_000);
  await evaluate(send, `document.querySelector("[data-testid=menu-compte-temps]")?.click()`);
  await attendre("temps", `Boolean(document.getElementById("temps-dossier"))`);
  await attendre(
    "dossier dans le temps",
    `Boolean(document.querySelector(${JSON.stringify(`#temps-dossier option[value="${id}"]`)}))`,
    20_000,
  );
  await setField(send, "temps-dossier", id);
  await attendre(
    "mode repris",
    `document.querySelector("[data-testid=convention-mode-facture]")?.textContent?.includes("forfait")`,
  );
  ok("la facturation reprend le forfait");

  const idLevee = await session.creerDossier(send, {
    nom: `Levee ${session.marque}`,
    juridiction: "TJ Lyon",
    rg: `LV${session.marque}`,
    partie: `Client levee ${session.marque}`,
    typeDossier: "conseil",
    etape: "ouverture",
    precedent: id,
  });
  await session.ouvrirDossier(send, idLevee);
  await attendre("alerte levée", `Boolean(document.querySelector("[data-testid=alerte-convention]"))`);
  await setField(send, "convention-motif", "dossier_interne");
  await evaluate(send, `document.querySelector("[data-testid=convention-lever]")?.click()`);
  await attendre("alerte partie", `!document.querySelector("[data-testid=alerte-convention]")`);
  const motif = await evaluate(
    send,
    `(async () => (await window.__legalosRecette.lireSqlite(
      "SELECT motif_levee FROM conventions_honoraires WHERE dossier_id = ?",
      [${JSON.stringify(idLevee)}],
    ))?.[0]?.motif_levee)()`,
  );
  if (motif !== "dossier_interne") fail(`motif non consigné (${motif})`);
  ok("levée consignée pour un dossier interne");

  const idNu = await session.creerDossier(send, {
    nom: `Sans convention ${session.marque}`,
    juridiction: "TJ Lille",
    rg: `SC${session.marque}`,
    partie: `Client nu ${session.marque}`,
    typeDossier: "autre",
    etape: "ouverture",
    precedent: idLevee,
  });
  await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
  await attendre("menu temps 2", `Boolean(document.querySelector("[data-testid=menu-compte-temps]"))`, 5_000);
  await evaluate(send, `document.querySelector("[data-testid=menu-compte-temps]")?.click()`);
  await attendre(
    "dossier nu",
    `Boolean(document.querySelector(${JSON.stringify(`#temps-dossier option[value="${idNu}"]`)}))`,
    20_000,
  );
  await setField(send, "temps-dossier", idNu);
  await attendre("alerte facture", `Boolean(document.querySelector("[data-testid=alerte-convention-facture]"))`);
  ok("alerte à la création d'une facture");
  console.log("conventions-honoraires: OK");
} finally {
  try {
    page.ws.close();
  } catch {
    /* déjà fermé */
  }
  await session.stopApp(child);
  session.fermer();
}
