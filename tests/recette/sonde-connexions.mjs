#!/usr/bin/env node
/**
 * Lecture des connexions simultanées par boîte relevées par `doveadm who` (sonde de J11, consigne du 26/10/2026) :
 * sans serveur, sur des sorties d'exemple. Essais négatifs : un dépassement du plafond est vu, une sortie vide ou
 * illisible ne rend aucune connexion (donc ne passe jamais pour un dépassement ni pour une preuve de conformité).
 */
import assert from "node:assert/strict";
import { PLAFOND_CONNEXIONS, lireConnexions } from "./lib/sonde-connexions.mjs";

const entete = "username # proto (pids) (ips)\n";

const cinq = lireConnexions(`${entete}capa 5 imap (101 102 103 104 105) (172.18.0.1)\n`);
assert.equal(cinq.get("capa"), 5);
assert.ok((cinq.get("capa") ?? 0) <= PLAFOND_CONNEXIONS, "cinq connexions respectent le plafond");

const six = lireConnexions(`${entete}capa 6 imap (1 2 3 4 5 6) (172.18.0.1)\n`);
assert.ok((six.get("capa") ?? 0) > PLAFOND_CONNEXIONS, "six connexions dépassent le plafond : la sonde les voit");

const plusieurs = lireConnexions(`${entete}capa 3 imap (1 2 3) (172.18.0.1)\ncapa 2 imap (4 5) (172.18.0.2)\nautre 1 imap (6) (172.18.0.1)\n`);
assert.equal(plusieurs.get("capa"), 5, "deux lignes du même utilisateur (deux adresses) s'additionnent");
assert.equal(plusieurs.get("autre"), 1);

assert.equal(lireConnexions("").size, 0, "sortie vide : aucune connexion");
assert.equal(lireConnexions(entete).size, 0, "en-tête seul : aucune connexion");
assert.equal(lireConnexions("n'importe quoi\nsans colonnes\n").size, 0, "sortie illisible : aucune connexion");
assert.equal(PLAFOND_CONNEXIONS, 5);

console.log("sonde-connexions: OK (lecture de doveadm who, plafond de 5, essais négatifs)");
