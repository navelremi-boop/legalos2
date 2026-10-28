#!/usr/bin/env node
/**
 * Tenue visuelle — feuille bornée et centrée, lignes sans troncature forcée,
 * panneau des parties, agenda de la période affichée.
 * Usage : node tests/recette/tenue-visuelle.mjs
 */
import { randomUUID } from "node:crypto";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";

const NOMS = [
  "Martin c/ Durand",
  "Bernard c/ Petit",
  "Dubois c/ Laurent",
  "Thomas c/ Simon",
  "Robert c/ Michel",
  "Richard c/ Leroy",
  "Moreau c/ Roux",
  "Fournier c/ Girard",
  "Mercier c/ Blanc",
  "Faure c/ Guerin",
  "Garnier c/ Chevalier",
  "Boyer c/ Colin",
  "Gauthier c/ Perrin",
  "Robin c/ Morin",
  "Nicolas c/ Clement",
  "Henry c/ Gautier",
  "Roussel c/ Mathieu",
  "David c/ Masson",
  "Bertrand c/ Denis",
  "Lambert c/ Morel",
  "Bonnet c/ Girard",
  "François c/ Lefebvre",
  "Legrand c/ Garcia",
  "Rousseau c/ Fontaine",
  "Vincent c/ Chevallier",
  "Muller c/ Roy",
  "Lefevre c/ Andre",
  "Picard c/ Meyer",
  "Gaillard c/ Barbier",
  "Caron c/ Roux",
];

const CHEMISES = ["kraft", "bleu-classeur", "vert-amande", "jaune-paille", "rose-buvard", "lilas", "vert-eau", "gris-perle"];

const session = creerSession("tenue-visuelle");
const { fail, ok, assurerInstance, evaluate, apiJson } = session;

await assurerInstance();
const deja = Number(await sqlServeur(`SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %'`));
if (deja < NOMS.length) {
  const jeton = await demoAccessToken(session.api, `tenue-${session.marque}`);
  for (let index = deja; index < NOMS.length; index += 1) {
    const nom = `Tenue — ${NOMS[index]}`;
    const reponse = await apiJson(jeton, "POST", "/dossiers", {
      id: randomUUID(),
      idempotence_cle: `tenue-${nom}`,
      nom,
      chemise: CHEMISES[index % CHEMISES.length],
      juridiction: "TJ Paris",
      numero_rg: `TV${String(index + 1).padStart(2, "0")}`,
      restreint: false,
      type_dossier: index % 2 === 0 ? "contentieux" : "conseil",
      etape: "instruction",
    });
    if (reponse.status !== 200) fail(`dossier ${nom} → ${reponse.status}`);
  }
  ok(`${NOMS.length - deja} dossiers du jeu de tenue créés`);
} else {
  ok(`jeu de tenue déjà présent (${deja})`);
}

const creds = {
  email: demoEmail,
  password: demoPassword,
  secret: totpSecretB32,
  nomAppareil: `Tenue ${session.marque}`,
  mode: "dev",
};
const { child, page } = await session.ouvrirPoste("tvi", "9296", creds);
const send = page.send;

async function attendre(nom, expression, delaiMs = 20_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(250);
  }
  fail(`${nom} : condition non atteinte`);
}

try {
  await evaluate(send, `document.querySelector("[data-testid=nav-dossiers]")?.click()`);
  await attendre("liste", `Boolean(document.querySelector("[data-testid=liste-dossier]"))`, 40_000);
  const feuille = await evaluate(
    send,
    `(() => {
      const pile = document.querySelector(".feuille-pile");
      if (!pile) return null;
      const boite = pile.getBoundingClientRect();
      const parent = pile.parentElement.getBoundingClientRect();
      const style = getComputedStyle(pile);
      return {
        largeur: boite.width,
        marge: style.marginLeft,
        ecartGauche: boite.left - parent.left,
        ecartDroit: parent.right - boite.right,
      };
    })()`,
  );
  if (!feuille || feuille.largeur > 1120.5) fail(`feuille trop large (${JSON.stringify(feuille)})`);
  if (feuille.ecartGauche + 8 < feuille.ecartDroit && feuille.largeur < 1110) {
    fail(`feuille non centrée (${JSON.stringify(feuille)})`);
  }
  ok(`feuille bornée (${Math.round(feuille.largeur)} px)`);

  const proche = await evaluate(
    send,
    `(() => {
      const ligne = document.querySelector("[data-testid=liste-dossier]");
      const echeance = ligne?.querySelector("[data-testid=dossier-echeance]");
      const nom = ligne?.querySelector("[data-testid=dossier-nom-ligne]");
      if (!ligne || !echeance || !nom) return null;
      const a = nom.getBoundingClientRect();
      const b = echeance.getBoundingClientRect();
      return Math.round(b.left - a.right);
    })()`,
  );
  if (proche !== null && proche > 80) fail(`nom et échéance éloignés de ${proche} px`);
  ok(proche === null ? "pas d'échéance sur la première ligne" : `nom et échéance à ${proche} px`);

  await evaluate(send, `document.querySelector("[data-testid=liste-dossier]")?.click()`);
  await attendre("dossier", `Boolean(document.querySelector("[data-testid=panneau-parties]"))`);
  const panneau = await evaluate(
    send,
    `(() => {
      const texte = document.querySelector("[data-testid=panneau-parties]")?.innerText ?? "";
      return {
        recherche: Boolean(document.querySelector("[data-testid=lien-recherche]")),
        role: Boolean(document.querySelector("label[for=partie-role]")),
        nom: Boolean(document.querySelector("label[for=partie-nom]")),
        identifiant: /identifiant/i.test(texte),
      };
    })()`,
  );
  if (!panneau.recherche || !panneau.role || !panneau.nom || panneau.identifiant) {
    fail(`panneau des parties incomplet (${JSON.stringify(panneau)})`);
  }
  ok("panneau des parties : champs étiquetés, recherche, pas d'identifiant");

  await evaluate(send, `document.querySelector("[data-testid=nav-agenda]")?.click()`);
  await attendre("agenda", `Boolean(document.querySelector("[data-testid=agenda-grille]"))`);
  const agenda = await evaluate(
    send,
    `(() => {
      const lignes = document.querySelectorAll("[data-testid=agenda-ligne-heure]").length;
      const aujourdhui = document.querySelector("[data-aujourdhui=true]");
      const hors = document.querySelector("[data-testid=agenda-mini-jour][data-dans-mois=false]");
      const sans = document.querySelector("[data-testid=agenda-sans-heure-titre]");
      const titres = [...document.querySelectorAll("[data-testid=agenda-jour] h2")].map((el) => el.textContent.trim());
      const iso = titres.some((titre) => /\\d{4}-\\d{2}-\\d{2}/.test(titre));
      const compteurs = [...document.querySelectorAll("[data-testid^=agenda-filtre-]")].map((el) => el.textContent);
      return {
        lignes,
        aujourdhui: Boolean(aujourdhui),
        horsOpacite: hors ? getComputedStyle(hors).opacity : "",
        sansHeure: sans ? getComputedStyle(sans).whiteSpace : "",
        iso,
        compteurs,
      };
    })()`,
  );
  if (agenda.lignes < 1) fail("pas de ligne entre les heures");
  if (!agenda.aujourdhui) fail("jour courant non marqué");
  if (agenda.horsOpacite !== "" && Number(agenda.horsOpacite) > 0.7) fail(`jours voisins peu atténués (${agenda.horsOpacite})`);
  if (agenda.sansHeure !== "nowrap") fail(`« Sans heure » n'est pas sur une ligne (${agenda.sansHeure})`);
  if (agenda.iso) fail("un titre d'agenda est au format 2026-01-21");
  ok("agenda : lignes, jour courant, voisins atténués, dates en toutes lettres");

  const zero = await evaluate(
    send,
    `(() => {
      const reference = document.querySelector(".chiffres-reference");
      const compteur = document.querySelector("[data-testid^=agenda-filtre-] b");
      const style = (el) => (el ? getComputedStyle(el).fontVariantNumeric : "");
      return { reference: style(reference), compteur: style(compteur) };
    })()`,
  );
  if (zero.reference && !zero.reference.includes("slashed-zero")) fail(`référence sans zéro barré (${zero.reference})`);
  if (zero.compteur.includes("slashed-zero")) fail("un compteur a le zéro barré");
  ok("zéro barré réservé aux références");
  console.log("tenue-visuelle: OK");
} finally {
  try {
    page.ws.close();
  } catch {
    /* déjà fermé */
  }
  await session.stopApp(child);
  session.fermer();
}
