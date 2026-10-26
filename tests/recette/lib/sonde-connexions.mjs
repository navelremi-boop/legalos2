/**
 * Sonde des connexions IMAP simultanées par boîte, relevées **côté serveur** (`doveadm who` dans le conteneur Dovecot) :
 * critère de J11 de la consigne de l'architecte du 26/10/2026 (le moteur tient au plus 5 connexions par boîte).
 * Échantillonnage espacé (une commande `docker exec` toutes les quelques secondes, jamais en rafale : un échantillonnage
 * à 1,5 s pendant des heures a figé Docker Desktop le 26/10).
 */
import { spawn } from "node:child_process";

/** Plafond du moteur par boîte (`PLAFOND_PAR_DEFAUT` de `crates/messagerie/src/plafond.rs`). */
export const PLAFOND_CONNEXIONS = 5;

/**
 * Connexions par utilisateur d'après la sortie de `doveadm who` (colonnes : utilisateur, nombre, protocole, pids, adresses).
 * @param {string} sortie
 * @returns {Map<string, number>}
 */
export function lireConnexions(sortie) {
  const parUtilisateur = new Map();
  for (const ligne of String(sortie).split(/\r?\n/u).slice(1)) {
    const champs = ligne.trim().split(/\s+/u);
    const nombre = Number(champs[1]);
    if (champs[0] === "" || !Number.isInteger(nombre)) continue;
    parUtilisateur.set(champs[0], (parUtilisateur.get(champs[0]) ?? 0) + nombre);
  }
  return parUtilisateur;
}

function doveadmWho(conteneur) {
  return new Promise((resolve) => {
    const enfant = spawn("docker", ["exec", conteneur, "doveadm", "who"], { windowsHide: true });
    let sortie = "";
    const minuteur = setTimeout(() => {
      enfant.kill();
      resolve("");
    }, 15_000);
    enfant.stdout.on("data", (morceau) => {
      sortie += morceau.toString();
    });
    enfant.on("close", () => {
      clearTimeout(minuteur);
      resolve(sortie);
    });
    enfant.on("error", () => {
      clearTimeout(minuteur);
      resolve("");
    });
  });
}

/**
 * Démarre la sonde. `arreter()` rend le maximum vu par conteneur et par utilisateur, et le nombre d'échantillons.
 * @param {{ conteneurs: string[], intervalleMs?: number }} options
 */
export function demarrerSondeConnexions({ conteneurs, intervalleMs = 4_000 }) {
  let actif = true;
  let echantillons = 0;
  /** @type {{ conteneur: string, utilisateur: string, nombre: number }} */
  let maximum = { conteneur: "", utilisateur: "", nombre: 0 };
  const boucle = (async () => {
    while (actif) {
      for (const conteneur of conteneurs) {
        const sortie = await doveadmWho(conteneur);
        echantillons += 1;
        for (const [utilisateur, nombre] of lireConnexions(sortie)) {
          if (nombre > maximum.nombre) maximum = { conteneur, utilisateur, nombre };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalleMs));
    }
  })();
  return {
    async arreter() {
      actif = false;
      await boucle;
      return { maximum, echantillons };
    },
  };
}
