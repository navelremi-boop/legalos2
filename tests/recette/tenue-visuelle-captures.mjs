#!/usr/bin/env node
/**
 * Captures Tenue visuelle : jour et nuit, 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440,
 * pour Dossiers, un dossier, Mails, Agenda, La journée, Temps, Réglages et Contacts
 * (liste avec fiche affichée, fiche d'une société, fiche d'une personne, création par SIREN),
 * soit 11 écrans × 2 thèmes × 3 tailles = 66 captures sous design/captures/tenue/.
 * Usage : node tests/recette/tenue-visuelle-captures.mjs
 * Prérequis : l'instance de démonstration (port 8188) chargée par `node tests/recette/tenue-demo.mjs`.
 * Création par SIREN : le registre n'est jamais le service public. Un petit serveur local répond avec une société
 * fictive ; l'API de démonstration est relancée avec `LEGALOS_RECHERCHE_ENTREPRISES_URL` vers ce serveur (sans toucher
 * aux volumes), puis remise dans son état d'origine à la fin, y compris en cas d'échec.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep } from "./lib/poste-session.mjs";

process.env.LEGALOS_INSTANCE_URL ??= "http://127.0.0.1:8188";
if (new URL(process.env.LEGALOS_INSTANCE_URL).port === "8088") {
  console.error("tenue-captures: FAIL — les captures visent l'instance des recettes");
  process.exit(1);
}

const TAILLES = [
  { largeur: 1366, hauteur: 768 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1440 },
];
const THEMES = [
  { valeur: "light", nom: "jour" },
  { valeur: "dark", nom: "nuit" },
];
const ECRANS = [
  { id: "dossiers", nav: "nav-dossiers", testid: "ecran-dossiers" },
  { id: "dossier", nav: "nav-dossiers", testid: "ecran-dossier", ouvrir: true },
  { id: "mails", nav: "nav-mails", testid: "ecran-mails" },
  { id: "agenda", nav: "nav-agenda", testid: "ecran-agenda" },
  { id: "journee", nav: "nav-journee", testid: "ecran-journee" },
  { id: "temps", menu: "menu-compte-temps", testid: "ecran-temps" },
  { id: "reglages", menu: "menu-reglages", testid: "ecran-reglages" },
  { id: "contacts-liste", nav: "nav-contacts", testid: "ecran-contacts", contacts: "liste" },
  { id: "contacts-societe", nav: "nav-contacts", testid: "ecran-contacts", contacts: "societe" },
  { id: "contacts-personne", nav: "nav-contacts", testid: "ecran-contacts", contacts: "personne" },
  { id: "contacts-siren", nav: "nav-contacts", testid: "ecran-contacts", contacts: "siren" },
];

/** Registre fictif : SIREN fictif de la forme 1000000xx, sans rapport avec une entreprise réelle. */
const SIREN_REGISTRE = "100000058";
const PORT_REGISTRE = 18188;
const URL_REGISTRE = `http://host.docker.internal:${PORT_REGISTRE}/search`;

const session = creerSession("tenue-captures");
const { fail, ok, evaluate, setField } = session;
const dossier = join(session.root, "design", "captures", "tenue");
mkdirSync(dossier, { recursive: true });

function dimensions(octets) {
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

const creds = {
  email: demoEmail,
  password: demoPassword,
  secret: totpSecretB32,
  nomAppareil: `Captures tenue ${session.marque}`,
  mode: "dev",
  forcer: true,
};

// Registre fictif et API de démonstration relancée vers lui. Les volumes de la pile de démonstration restent intacts.
let registre = null;
let apiRedirigee = false;

function relancerApiDemo(urlRegistre) {
  const env = { ...process.env };
  if (urlRegistre) env.LEGALOS_RECHERCHE_ENTREPRISES_URL = urlRegistre;
  else delete env.LEGALOS_RECHERCHE_ENTREPRISES_URL;
  const resultat = spawnSync(
    "docker",
    ["compose", "-p", "legalos-demo", "--env-file", ".env.demo", "-f", "instance/docker-compose.yml", "up", "-d", "--wait", "api"],
    { cwd: session.root, env, stdio: "inherit" },
  );
  return resultat.status === 0;
}

/** Remet l'API de démonstration dans son état d'origine (variable absente, valeur par défaut du compose). */
function restaurerApiDemo() {
  if (!apiRedirigee) return;
  if (relancerApiDemo(null)) {
    apiRedirigee = false;
    console.log("tenue-captures: API de démonstration remise dans son état d'origine");
  } else {
    console.error("tenue-captures: ATTENTION — l'API de démonstration n'a pas pu être remise dans son état d'origine");
  }
}
// Filet : un arrêt brutal du script (échec hors du bloc protégé) remet aussi l'API en l'état.
process.on("exit", restaurerApiDemo);

function demarrerRegistre() {
  registre = http.createServer((req, res) => {
    const q = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("q") ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    if (!q.includes(SIREN_REGISTRE)) {
      res.end(JSON.stringify({ results: [] }));
      return;
    }
    res.end(
      JSON.stringify({
        results: [
          {
            siren: SIREN_REGISTRE,
            nom_complet: "MAISON TESSIER ET FILS",
            nom_raison_sociale: "MAISON TESSIER ET FILS",
            nature_juridique: "5499",
            activite_principale: "43.32A",
            siege: { adresse: "8 QUAI SAINT-VINCENT 69001 LYON" },
            dirigeants: [
              {
                nom: "Tessier",
                prenoms: "Maxime",
                date_de_naissance: "1976-04-21",
                qualite: "Gérant",
                type_dirigeant: "personne physique",
              },
            ],
          },
        ],
      }),
    );
  });
  return new Promise((resolve, reject) => {
    registre.once("error", reject);
    registre.listen(PORT_REGISTRE, "0.0.0.0", resolve);
  });
}

let child;
let page;
try {
  await demarrerRegistre();
  apiRedirigee = true;
  if (!relancerApiDemo(URL_REGISTRE)) fail("API de démonstration non relancée vers le registre fictif");
  ({ child, page } = await session.ouvrirPoste("tvd", "9298", creds));
} catch (err) {
  registre?.close();
  restaurerApiDemo();
  throw err;
}
const send = page.send;

async function attendre(nom, expression, delaiMs = 20_000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await evaluate(send, expression)) return;
    await sleep(200);
  }
  fail(`${nom} : condition non atteinte`);
}

async function vue(largeur, hauteur) {
  const reponse = await send("Emulation.setDeviceMetricsOverride", {
    width: largeur,
    height: hauteur,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (reponse.error) fail(`vue ${largeur} : ${reponse.error.message ?? "refus"}`);
}

async function theme(valeur) {
  await evaluate(
    send,
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
  );
  await sleep(200);
  const deja = await evaluate(send, `Boolean(document.getElementById("theme") && document.getElementById("theme").offsetParent)`);
  if (!deja) {
    await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
    await attendre("menu", `Boolean(document.querySelector("[data-testid=menu-reglages]"))`, 5_000);
    await evaluate(send, `document.querySelector("[data-testid=menu-reglages]")?.click()`);
    await evaluate(send, `document.querySelector("[data-testid=reglages-section-apparence]")?.click()`);
  }
  await attendre("thème", `Boolean(document.getElementById("theme"))`);
  await setField(send, "theme", valeur);
  await attendre(
    `thème ${valeur}`,
    `document.documentElement.dataset.theme === ${JSON.stringify(valeur === "dark" ? "dark" : "light")}`,
  );
}

async function aller(ecran) {
  if (ecran.menu) {
    await evaluate(send, `document.querySelector("[data-testid=menu-compte]")?.click()`);
    await attendre(ecran.menu, `Boolean(document.querySelector("[data-testid=${ecran.menu}]"))`, 5_000);
    await evaluate(send, `document.querySelector("[data-testid=${ecran.menu}]")?.click()`);
  } else {
    await evaluate(send, `document.querySelector("[data-testid=${ecran.nav}]")?.click()`);
  }
  if (ecran.ouvrir) {
    await attendre("liste", `Boolean(document.querySelector("[data-testid=liste-dossier]"))`);
    await evaluate(
      send,
      `(() => {
        const lignes = [...document.querySelectorAll("[data-testid=liste-dossier]")];
        const tenue = lignes.find((ligne) => (ligne.textContent || "").includes("Tenue"));
        (tenue ?? lignes[0])?.click();
        return true;
      })()`,
    );
  }
  await attendre(ecran.id, `Boolean(document.querySelector("[data-testid=${ecran.testid}]"))`);
  if (ecran.contacts) await etapeContacts(ecran.contacts);
  await sleep(300);
}

/** Texte d'une ligne de la liste des contacts, espaces insécables compris. */
const LIGNE_CONTACT = `[...document.querySelectorAll("[data-testid=contacts-ligne]")]`;

/** Ouvre la fiche dont la ligne contient `contient` sans contenir `exclut`, et la ramène dans la liste visible. */
async function ouvrirFiche(nom, contient, exclut = []) {
  await attendre(`liste des contacts (${nom})`, `${LIGNE_CONTACT}.length > 10`);
  const choisie = await evaluate(
    send,
    `(() => {
      const contient = ${JSON.stringify(contient)};
      const exclut = ${JSON.stringify(exclut)};
      const ligne = ${LIGNE_CONTACT}.find((l) => {
        const t = (l.textContent || "").replace(/[\\u00a0\\u202f]/g, " ");
        return contient.every((m) => t.includes(m)) && !exclut.some((m) => t.includes(m));
      });
      if (!ligne) return false;
      ligne.click();
      return true;
    })()`,
  );
  if (!choisie) fail(`fiche de démonstration absente : ${nom} (node tests/recette/tenue-demo.mjs)`);
  await attendre(`fiche ${nom}`, `document.querySelector("[data-testid=contacts-ligne][data-selected=true]") !== null`);
  await sleep(500);
}

/**
 * Ramène la page en haut (le clic sur une ligne ne doit pas laisser l'écran défilé) et, si la liste a sa propre barre
 * de défilement, amène la ligne choisie au milieu de la liste. Relève les mesures de hauteur : un écran plus haut que la
 * fenêtre fait défiler la page et laisse la barre d'actions sous le bord de la capture.
 */
async function cadrerContacts(nom) {
  const mesure = await evaluate(
    send,
    `(() => {
      const liste = document.querySelector("[data-testid=contacts-liste]");
      const ligne = document.querySelector("[data-testid=contacts-ligne][data-selected=true]");
      if (liste && ligne && liste.scrollHeight > liste.clientHeight + 1) {
        liste.scrollTop += ligne.getBoundingClientRect().top - liste.getBoundingClientRect().top - liste.clientHeight / 2;
      }
      for (const el of [document.scrollingElement, ...document.querySelectorAll("*")]) {
        if (el && el.scrollTop > 0 && el !== liste) el.scrollTop = 0;
      }
      const rect = (testid) => {
        const r = document.querySelector("[data-testid=" + testid + "]")?.getBoundingClientRect();
        return r ? Math.round(r.top) + "-" + Math.round(r.bottom) : "absent";
      };
      return {
        fenetre: window.innerHeight,
        document: document.documentElement.scrollHeight,
        listeVisible: liste ? liste.clientHeight : -1,
        listeTotale: liste ? liste.scrollHeight : -1,
        ecran: rect("ecran-contacts"),
        barreActions: rect("barre-actions"),
      };
    })()`,
  );
  ok(`mesures ${nom} : ${JSON.stringify(mesure)}`);
  await sleep(300);
}

/** Écrans Contacts : liste, fiche d'une société, fiche d'une personne, création par SIREN. */
async function etapeContacts(etape) {
  await preparerContacts(etape);
  await cadrerContacts(etape);
}

async function preparerContacts(etape) {
  // Une création restée ouverte d'un passage précédent est refermée (Échap), l'onglet Général est rouvert.
  await evaluate(
    send,
    `(() => {
      document.querySelector("[data-testid=contacts-nouveau-contact]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    })()`,
  );
  await attendre("liste", `${LIGNE_CONTACT}.length > 10`);
  if (etape === "liste") {
    // Fiche affichée par défaut : celle de la première ligne.
    const selectionnee = await evaluate(send, `document.querySelector("[data-testid=contacts-ligne][data-selected=true]") !== null`);
    if (!selectionnee) {
      await evaluate(send, `${LIGNE_CONTACT}[0]?.click(); true`);
      await attendre("fiche par défaut", `document.querySelector("[data-testid=contacts-ligne][data-selected=true]") !== null`);
    }
    await sleep(500);
    return;
  }
  if (etape === "societe") {
    await ouvrirFiche("société", ["Ferrand Métal"]);
    await evaluate(send, `document.querySelector("[data-testid=contacts-onglet-general]")?.click(); true`);
    await attendre("fiche société", `Boolean(document.querySelector("[data-testid=contacts-siren]"))`);
    await sleep(300);
    return;
  }
  if (etape === "personne") {
    await ouvrirFiche("personne", ["Antoine", "Ferrand"], ["Métal"]);
    await evaluate(send, `document.querySelector("[data-testid=contacts-onglet-general]")?.click(); true`);
    await attendre("fiche personne", `Boolean(document.querySelector("[data-testid=contacts-date-naissance]"))`);
    await sleep(300);
    return;
  }
  if (etape === "siren") {
    await evaluate(send, `document.querySelector("[data-testid=contacts-importer-siren]")?.click(); true`);
    await attendre("création", `Boolean(document.querySelector("[data-testid=contacts-creation-siren]"))`);
    await evaluate(
      send,
      `(() => {
        const el = document.querySelector("[data-testid=contacts-creation-siren]");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(SIREN_REGISTRE)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await attendre("bouton du registre", `document.querySelector("[data-testid=contacts-creation-interroger]")?.disabled === false`, 5_000);
    await evaluate(send, `document.querySelector("[data-testid=contacts-creation-interroger]")?.click(); true`);
    await attendre(
      "proposition du registre",
      `Boolean(document.querySelector("[data-testid=contacts-creation-proposition]")) && (document.querySelector("[data-testid=contacts-creation-denomination]")?.value ?? "") !== ""`,
    );
    await sleep(500);
  }
}

async function capturer(chemin) {
  const reponse = await send("Page.captureScreenshot", { format: "png" });
  if (!reponse.result?.data) fail(`capture absente (${chemin})`);
  const octets = Buffer.from(reponse.result.data, "base64");
  writeFileSync(chemin, octets);
  return dimensions(octets);
}

try {
  let n = 0;
  for (const taille of TAILLES) {
    await vue(taille.largeur, taille.hauteur);
    for (const mode of THEMES) {
      await theme(mode.valeur);
      for (const ecran of ECRANS) {
        await aller(ecran);
        const nom = `${ecran.id}-${taille.largeur}x${taille.hauteur}-${mode.nom}.png`;
        const mesure = await capturer(join(dossier, nom));
        if (mesure.largeur < taille.largeur - 40 || mesure.hauteur < taille.hauteur - 80) {
          fail(`${nom} trop petit (${mesure.largeur}×${mesure.hauteur})`);
        }
        n += 1;
        ok(`${nom} ${mesure.largeur}×${mesure.hauteur}`);
      }
    }
  }
  if (n !== TAILLES.length * THEMES.length * ECRANS.length) fail(`captures ${n}`);
  console.log("tenue-visuelle-captures: OK");
} finally {
  try {
    page.ws.close();
  } catch {
    /* déjà fermé */
  }
  await session.stopApp(child);
  session.fermer();
  registre?.close();
  restaurerApiDemo();
}
