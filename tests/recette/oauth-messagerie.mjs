#!/usr/bin/env node
/**
 * Dette Avant J11 : OAuth Microsoft 365 et Gmail.
 * Le simulateur local parle le jeton RFC 6749. Le rafraîchissement ne quitte pas le serveur.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { demoAccessToken } from "./lib/demo-auth.mjs";
import { sqlServeur } from "./lib/poste-session.mjs";

const instance = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instance}/api`;
const port = 18766;
const rafraichissement = `RafraichissementSentinelle${randomUUID()}`;
let acces = 0;

function fail(message) {
  console.error(`oauth-messagerie: FAIL — ${message}`);
  process.exit(1);
}

function serveur() {
  return new Promise((resolve) => {
    const http = createServer((req, res) => {
      if (req.method === "GET" && req.url.startsWith("/authorize")) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("code-simulateur");
        return;
      }
      const morceaux = [];
      req.on("data", (c) => morceaux.push(c));
      req.on("end", () => {
        const corps = Buffer.concat(morceaux).toString("utf8");
        const params = new URLSearchParams(corps);
        acces += 1;
        const jeton = {
          access_token: `acces-${acces}`,
          refresh_token: rafraichissement,
          expires_in: 3600,
          token_type: "Bearer",
        };
        if (params.get("grant_type") !== "authorization_code" && params.get("grant_type") !== "refresh_token") {
          res.writeHead(400);
          res.end("grant");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(jeton));
      });
    });
    http.listen(port, "0.0.0.0", () => resolve(http));
  });
}

async function json(chemin, jeton, methode, corps) {
  const reponse = await fetch(`${api}${chemin}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { statut: reponse.status, texte };
}

async function main() {
  const sante = await fetch(`${instance}/health`).catch(() => null);
  if (!sante?.ok) fail("instance injoignable");
  const http = await serveur();
  try {
    const jeton = await demoAccessToken(api, `oauth-${randomUUID().slice(0, 8)}`);
    const inconnu = await json("/messagerie/oauth/autorisation", jeton, "POST", {
      id: randomUUID(),
      adresse: "inconnu@example.com",
      fournisseur: "autre",
    });
    if (inconnu.statut !== 400) fail(`fournisseur inconnu accepté (${inconnu.statut})`);
    const id = randomUUID();
    const demande = await json("/messagerie/oauth/autorisation", jeton, "POST", {
      id,
      adresse: `oauth.${id.slice(0, 8)}@cabinet.example`,
      fournisseur: "simulateur",
      auth_url: `http://127.0.0.1:${port}/authorize`,
      jeton_url: `http://host.docker.internal:${port}/token`,
    });
    if (demande.statut !== 200) fail(`autorisation ${demande.statut}`);
    if (demande.texte.includes(rafraichissement) || demande.texte.includes("secret-simulateur")) {
      fail("secret dans l'URL d'autorisation");
    }
    const cree = JSON.parse(demande.texte);
    const codeReponse = await fetch(cree.url);
    const code = (await codeReponse.text()).trim();
    if (code !== "code-simulateur") fail("code d'autorisation absent");
    const echange = await json("/messagerie/oauth/echange", jeton, "POST", {
      state: cree.state,
      code,
    });
    if (echange.statut !== 200) fail(`échange ${echange.statut}`);
    if (echange.texte.includes(rafraichissement) || echange.texte.includes("acces-")) {
      fail("jeton dans la réponse d'échange");
    }
    const clair = await sqlServeur(
      `SELECT CASE WHEN position('${rafraichissement}' in jeton_rafraichissement_chiffre) > 0 THEN 'clair' ELSE 'chiffre' END FROM comptes_mail WHERE id = '${id}'`,
    );
    if (clair !== "chiffre") fail(`rafraîchissement ${clair}`);
    const avant = await sqlServeur(
      `SELECT jeton_acces_chiffre FROM comptes_mail WHERE id = '${id}'`,
    );
    const renouvellement = await json("/messagerie/oauth/renouveler", jeton, "POST", { id });
    if (renouvellement.statut !== 200) fail(`renouvellement ${renouvellement.statut}`);
    if (renouvellement.texte.includes(rafraichissement) || renouvellement.texte.includes("acces-")) {
      fail("jeton dans la réponse de renouvellement");
    }
    const apres = await sqlServeur(
      `SELECT jeton_acces_chiffre FROM comptes_mail WHERE id = '${id}'`,
    );
    if (!avant || avant === apres) fail("le jeton d'accès n'a pas été renouvelé");
    const etat = await json("/messagerie/oauth/echange", jeton, "POST", {
      state: "etat-inconnu",
      code: "code-simulateur",
    });
    if (etat.statut !== 400) fail("état inconnu accepté");
    console.log("oauth-messagerie: OK secret chiffré, renouvellement, absent des réponses");
  } finally {
    http.close();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
