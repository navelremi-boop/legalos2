/**
 * Banc de l'étape de révocation OAuth (consigne du 27/10/2026).
 * Poste construit, au moins 50 répétitions de : révocation, « Identifiants refusés », reconnexion.
 * Itérations 1 à 25 : fenêtre visible. Itérations 26 à 50 : fenêtre réduite.
 * Chaque itération consigne le code de sortie, un cliché éventuel et l'état de la session.
 * La série officielle des 10 passes n'est pas relancée.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demarrerBancOauth, portRepond } from "./lib/banc-oauth-poste.mjs";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { DOSSIER_CLICHES_POSTE, creerSession, sleep, sqlServeur } from "./lib/poste-session.mjs";
import { autoriserDansLeNavigateur } from "./lib/simulateur-oauth.mjs";
import { creerUi, lit, norm } from "./lib/ui-mails.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cible = join(racine, "target-recette");
const exe = join(cible, "debug", "legal-os-poste.exe");
const ITERATIONS = 50;
const JOURNAL = join(tmpdir(), "j11-revocation-banc.jsonl");
const session = creerSession("j11-revocation");
const { api, fail, ok, resetPostes, stopApp, ouvrirPoste, fermer } = session;
const marque = String(Date.now()).slice(-6);
let send;
const ui = creerUi({ getSend: () => send, fail, dossierCaptures: tmpdir() });
const { js, cliquer, texteDe, present, saisir, attendre } = ui;

const CROCHET = "window.__legalosRecette.oauth";
const BOUTON = "[data-testid=connexion-fournisseur-simulateur]";
const ETAPE = "[data-testid=connexion-oauth-etape]";
const ATTENTE = "En attente de l'autorisation dans le navigateur…";
const ligne = (id) => `[data-testid=compte-sante][data-compte-id="${id}"]`;
const etatEcran = (id) => texteDe(`${ligne(id)} [data-testid=compte-etat]`);

const SCRIPT_FENETRE = join(tmpdir(), "legalos-fenetre-recette.ps1");
writeFileSync(
  SCRIPT_FENETRE,
  [
    "param([int]$Cible, [int]$Code)",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class LegalosFenetre {",
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
    "}",
    "'@",
    "$p = Get-Process -Id $Cible -ErrorAction SilentlyContinue",
    "if (-not $p -or $p.MainWindowHandle -eq 0) { 'pas-de-fenetre' } else { [LegalosFenetre]::ShowWindow($p.MainWindowHandle, $Code) | Out-Null; 'ok' }",
    "",
  ].join("\n"),
  "utf8",
);

function poserFenetre(pid, reduite) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-File", SCRIPT_FENETRE, "-Cible", String(pid), "-Code", reduite ? "6" : "9"],
    { encoding: "utf8", windowsHide: true },
  );
  return String(r.stdout ?? "").includes("ok");
}

function cliches() {
  if (!existsSync(DOSSIER_CLICHES_POSTE)) return [];
  return readdirSync(DOSSIER_CLICHES_POSTE).filter((nom) => nom.endsWith(".dmp"));
}

function consigner(ligneJournal) {
  console.log(`j11-revocation: ${ligneJournal}`);
  appendFileSync(JOURNAL, `${ligneJournal}\n`, "utf8");
}

async function attendreClotureFilet(child) {
  const filet = child?.filet;
  if (!filet) return;
  const debut = Date.now();
  while (filet.exitCode === null && Date.now() - debut < 120_000) await sleep(500);
}

async function navigateur(url, redirection) {
  const reponse = await autoriserDansLeNavigateur(url);
  if (reponse.statut !== 302 || !String(reponse.location).startsWith(redirection)) {
    throw new Error(`redirection inattendue ${reponse.statut}`);
  }
  const retour = await fetch(reponse.location, { signal: AbortSignal.timeout(10_000) });
  if (retour.status !== 200) throw new Error(`bouclage ${retour.status}`);
}

async function connecter(adresse, banc) {
  await js(
    `${CROCHET}.configurer(${JSON.stringify({
      fournisseurs: [{ id: "simulateur", libelle: "Fournisseur de test" }],
      supplementsDebut: { simulateur: banc.supplement },
    })})`,
  );
  await cliquer("[data-testid=compte-ajouter]");
  await attendre("choix du mode", () => present(BOUTON), Boolean, 20_000);
  await cliquer(BOUTON);
  await attendre("adresse demandée", () => present("[data-testid=connexion-oauth-adresse]"), Boolean, 10_000);
  const avant = await js(`${CROCHET}.adressesOuvertes.length`);
  if (!(await saisir("[data-testid=connexion-oauth-adresse]", adresse))) throw new Error("saisie impossible");
  await cliquer("[data-testid=connexion-oauth-ouvrir]");
  await attendre("navigateur appelé", () => js(`${CROCHET}.adressesOuvertes.length`), (n) => n === avant + 1, 30_000);
  await attendre("attente de l'autorisation", () => texteDe(ETAPE), (t) => norm(t) === ATTENTE, 15_000);
  const url = new URL(await js(`${CROCHET}.adressesOuvertes.at(-1)`));
  const redirection = url.searchParams.get("redirect_uri") ?? "";
  await navigateur(url.href, redirection);
  const id = await attendre(
    "boîte au serveur",
    () => sqlServeur(`SELECT id FROM comptes_mail WHERE adresse = ${lit(adresse)}`),
    (v) => /^[0-9a-f-]{36}$/u.test(String(v)),
    30_000,
  );
  await attendre("boîte connectée", () => etatEcran(id), (t) => norm(t) === "Connectée", 150_000);
  return id;
}

async function reconnecter(id) {
  const bouton = `${ligne(id)} [data-testid=compte-reconnecter]`;
  const avant = await js(`${CROCHET}.adressesOuvertes.length`);
  await cliquer(bouton);
  await attendre("navigateur de reconnexion", () => js(`${CROCHET}.adressesOuvertes.length`), (n) => n === avant + 1, 30_000);
  const url = new URL(await js(`${CROCHET}.adressesOuvertes.at(-1)`));
  const redirection = url.searchParams.get("redirect_uri") ?? "";
  await navigateur(url.href, redirection);
  await attendre("boîte reconnectée", () => etatEcran(id), (t) => norm(t) === "Connectée", 150_000);
}

async function ouvrirReglages(poste) {
  send = poste.page.send;
  await cliquer("[data-testid=menu-compte]");
  await cliquer("[data-testid=menu-reglages]");
  await attendre("rubrique Messagerie", () => present("[data-testid=reglages-messagerie]"), Boolean, 30_000);
}

async function main() {
  if (!existsSync(exe)) fail(`binaire construit absent (${exe}). La série ne reconstruit pas un autre binaire pour ce banc.`);
  process.env.CARGO_TARGET_DIR = cible;
  await session.assurerInstance();
  const jeton = await demoAccessToken(api, `j11-revocation-${marque}`);
  const demoId = await sqlServeur(`SELECT id FROM utilisateurs WHERE email = ${lit(demoEmail)}`);
  if (!/^[0-9a-f-]{36}$/u.test(demoId)) fail("utilisateur démo absent");
  const adresse = `revocation.oauth.${marque}@cabinet.example`;
  const banc = await demarrerBancOauth({ fail });
  resetPostes(["jrev"]);
  let poste = null;
  let idOauth = null;
  const deja = new Set(cliches());
  try {
    poste = await ouvrirPoste("jrev", 9393, {
      email: demoEmail,
      password: demoPassword,
      secret: totpSecretB32,
      nomAppareil: `Revocation ${marque}`,
      mode: "copie",
    });
    await ouvrirReglages(poste);
    idOauth = await connecter(adresse, banc);
    ok(`boîte de banc prête (${idOauth})`);
    for (let i = 1; i <= ITERATIONS; i += 1) {
      const reduite = i > ITERATIONS / 2;
      const debut = Date.now();
      let code = "vivant";
      let etat = "inconnu";
      let nouveau = "";
      let fenetre = reduite ? "reduite" : "visible";
      let issue = "ok";
      try {
        if (!poste || poste.child.exitCode !== null) {
          if (poste) {
            await attendreClotureFilet(poste.child);
            await stopApp(poste.child);
          }
          poste = await ouvrirPoste("jrev", 9393, {
            email: demoEmail,
            password: demoPassword,
            secret: totpSecretB32,
            nomAppareil: `Revocation ${marque}`,
            mode: "copie",
          });
          await ouvrirReglages(poste);
          await js(
            `${CROCHET}.configurer(${JSON.stringify({
              fournisseurs: [{ id: "simulateur", libelle: "Fournisseur de test" }],
              supplementsDebut: { simulateur: banc.supplement },
            })})`,
          );
          await attendre("la boîte est revenue", () => present(ligne(idOauth)), Boolean, 120_000);
        }
        if (!poserFenetre(poste.child.pid, reduite)) fenetre = `${fenetre}-non-posee`;
        banc.fournisseur.revoquer();
        await attendre("identifiants refusés", () => etatEcran(idOauth), (t) => norm(t) === "Identifiants refusés", 180_000);
        if (poste.child.exitCode !== null) throw new Error(`poste mort pendant l'attente, code ${poste.child.exitCode}`);
        await reconnecter(idOauth);
        if (!(await portRepond(18766, 1000))) issue = "fournisseur-injoignable";
      } catch (err) {
        issue = String(err instanceof Error ? err.message : err).replaceAll(adresse, "boite").slice(0, 180);
      }
      if (poste?.child.exitCode !== null) {
        await attendreClotureFilet(poste.child);
        code = String(poste.child.exitCode);
      }
      try {
        etat = (await sqlServeur(`SELECT etat_connexion FROM comptes_mail WHERE id = '${idOauth}'`)) || "absent";
      } catch {
        etat = "illisible";
      }
      nouveau = cliches().filter((nom) => !deja.has(nom)).join(",") || "aucun";
      for (const nom of cliches()) deja.add(nom);
      consigner(
        `iteration=${i} fenetre=${fenetre} sortie=${code} cliche=${nouveau} etat=${etat} issue=${issue} duree_s=${Math.round((Date.now() - debut) / 1000)} compte=${idOauth}`,
      );
      if (poste && (code !== "vivant" || issue !== "ok")) {
        await attendreClotureFilet(poste.child);
        await stopApp(poste.child);
        poste = null;
      }
    }
    ok(`banc terminé, journal ${JOURNAL}`);
  } finally {
    if (poste) {
      await attendreClotureFilet(poste.child);
      await stopApp(poste.child);
    }
    try {
      await banc.arreter();
    } catch (err) {
      console.error(`j11-revocation: arrêt du banc impossible : ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
    }
    try {
      await sqlServeur(`DELETE FROM oauth_etats WHERE adresse = ${lit(adresse)}`);
      const ids = `SELECT id FROM comptes_mail WHERE adresse = ${lit(adresse)}`;
      for (const requete of [
        `DELETE FROM actions_messages WHERE compte_id IN (${ids})`,
        `DELETE FROM file_envoi WHERE compte_id IN (${ids})`,
        `DELETE FROM releve_curseurs WHERE compte_id IN (${ids})`,
        `DELETE FROM moteur_connexions WHERE compte_id IN (${ids})`,
        `DELETE FROM messages WHERE compte_id IN (${ids})`,
        `DELETE FROM comptes_mail WHERE adresse = ${lit(adresse)}`,
      ]) {
        await sqlServeur(requete);
      }
    } catch (err) {
      console.error(`j11-revocation: nettoyage impossible : ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
    }
    void jeton;
  }
}

main()
  .catch((err) => {
    console.error(`j11-revocation: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fermer();
  });
