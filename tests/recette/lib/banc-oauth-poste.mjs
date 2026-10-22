/**
 * Banc de la recette « connexion OAuth depuis l'écran Comptes » (J11, v-OAuth, côté poste) : fournisseur OAuth simulé
 * (jetons de 100 s pour forcer les renouvellements), relais SMTP XOAUTH2 simulé, Dovecot qui valide XOAUTH2 par
 * introspection auprès du fournisseur. Même banc que `tests/recette/oauth-messagerie.mjs` (recette serveur), avec son
 * propre conteneur et son propre port IMAP hôte : les deux recettes ne tournent pas ensemble (ports 18766 et 18767).
 * Données fictives ; aucun jeton n'est journalisé.
 */
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import { connecterAuReseauApi } from "./moteur-mail.mjs";
import { racineInstance, sleep } from "./poste-session.mjs";
import { demarrerSimulateurOAuth } from "./simulateur-oauth.mjs";
import { demarrerSmtpXoauth2 } from "./smtp-xoauth2.mjs";

export const PORT_FOURNISSEUR = 18766; // écrit aussi dans instance/imap-test/dovecot-oauth2.conf.ext
export const PORT_SMTP = 18767;
const PORT_IMAP_HOTE = 21144;
const NOM_DOVECOT = "legalos-j11-dovecot-oauth-poste";

/** Vrai si quelque chose répond (connexion TCP acceptée) sur 127.0.0.1:port. */
export function portRepond(port, delaiMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const fin = (valeur) => {
      socket.destroy();
      resolve(valeur);
    };
    socket.setTimeout(delaiMs, () => fin(false));
    socket.once("connect", () => fin(true));
    socket.once("error", () => fin(false));
  });
}

/** Attend la bannière IMAP de Dovecot (`* OK`) sur le port publié. */
function banniereImap(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let texte = "";
    const fin = (valeur) => {
      socket.destroy();
      resolve(valeur);
    };
    socket.setTimeout(2000, () => fin(false));
    socket.once("error", () => fin(false));
    socket.on("data", (morceau) => {
      texte += morceau.toString("utf8");
      if (texte.includes("\n")) fin(texte.startsWith("* OK"));
    });
  });
}

/**
 * Démarre le banc. Rend le fournisseur simulé, ce que le poste doit joindre au début de connexion pour le
 * fournisseur « simulateur » (le champ `supplement` du crochet de recette) et l'arrêt du banc.
 */
export async function demarrerBancOauth({ fail }) {
  const fournisseur = await demarrerSimulateurOAuth({ port: PORT_FOURNISSEUR, dureeJetonSecondes: 100 });
  const smtp = await demarrerSmtpXoauth2({ port: PORT_SMTP, verifier: (jeton) => fournisseur.accesValide(jeton) });
  const racine = racineInstance();
  spawnSync("docker", ["rm", "-f", NOM_DOVECOT], { encoding: "utf8", timeout: 120_000 });
  const lance = spawnSync(
    "docker",
    [
      "run", "-d", "--name", NOM_DOVECOT, "-p", `127.0.0.1:${PORT_IMAP_HOTE}:143`,
      "-v", `${join(racine, "instance/imap-test/dovecot-oauth.conf")}:/etc/dovecot/dovecot.conf:ro`,
      "-v", `${join(racine, "instance/imap-test/dovecot-oauth2.conf.ext")}:/etc/dovecot/dovecot-oauth2.conf.ext:ro`,
      "--entrypoint", "sh", "dovecot/dovecot:2.3.21.1",
      "-c", "mkdir -p /tmp/mail && chown -R dovecot:dovecot /tmp/mail && exec dovecot -F",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  const arreter = async () => {
    spawnSync("docker", ["rm", "-f", NOM_DOVECOT], { encoding: "utf8", timeout: 120_000 });
    await smtp.arreter();
    await fournisseur.arreter();
  };
  if (lance.status !== 0) {
    await arreter();
    fail(`Dovecot OAuth : ${(lance.stderr || "").slice(0, 300)}`);
  }
  connecterAuReseauApi(NOM_DOVECOT);
  const debut = Date.now();
  while (!(await banniereImap(PORT_IMAP_HOTE))) {
    if (Date.now() - debut > 40_000) {
      await arreter();
      fail("Dovecot OAuth : pas de bannière IMAP en 40 s");
    }
    await sleep(700);
  }
  return {
    fournisseur,
    smtp,
    /** Champs de `POST /messagerie/oauth/debut` propres au fournisseur simulé (développement seulement). */
    supplement: {
      auth_url: `http://127.0.0.1:${PORT_FOURNISSEUR}/authorize`,
      jeton_url: `http://host.docker.internal:${PORT_FOURNISSEUR}/token`,
      hotes: {
        imap_hote: NOM_DOVECOT,
        imap_port: 143,
        imap_tls: false,
        smtp_hote: "host.docker.internal",
        smtp_port: PORT_SMTP,
        smtp_chiffrement: "aucun",
      },
    },
    arreter,
  };
}
