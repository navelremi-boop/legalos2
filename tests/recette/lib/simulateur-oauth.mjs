/**
 * Fournisseur OAuth 2.0 simulé pour les recettes de la messagerie (J11, critère v-OAuth). Données fictives.
 *
 * Il se comporte comme Microsoft 365 et Gmail sur ce qui compte :
 *  - `GET /authorize` : code d'autorisation avec PKCE S256 (RFC 7636) et redirection de bouclage (RFC 8252),
 *    `state` renvoyé tel quel ;
 *  - `POST /token` : `authorization_code` (le vérificateur PKCE est contrôlé, le code ne sert qu'une fois, la
 *    redirection doit être celle de la demande) et `refresh_token` (le jeton de rafraîchissement TOURNE : l'ancien
 *    est refusé ensuite, ce qui révèle deux renouvellements concurrents) ;
 *  - `POST /introspect` : RFC 7662, interrogé par Dovecot pour valider un jeton XOAUTH2 ;
 *  - `POST /admin/revoquer` et `/admin/expirer` : pilotent les essais (jeton révoqué, jeton d'accès expiré).
 *
 * Le simulateur ne journalise ni code ni jeton.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export const CLIENT_ID = "legalos-simulateur";

const base64url = (octets) => Buffer.from(octets).toString("base64url");
const aleatoire = (prefixe) => `${prefixe}-${base64url(randomBytes(18))}`;

/**
 * @param {{ port: number, dureeJetonSecondes?: number, hote?: string }} options
 */
export async function demarrerSimulateurOAuth({ port, dureeJetonSecondes = 3600, hote = "0.0.0.0" }) {
  const codes = new Map(); // code → { challenge, redirection, email }
  const acces = new Map(); // jeton d'accès → { email, expire }
  const rafraichissements = new Map(); // jeton de rafraîchissement → { email, actif }
  const etat = {
    dureeJetonSecondes,
    autorisations: 0,
    echangesDeCode: 0,
    renouvellements: 0,
    refusPkce: 0,
    derniereRedirection: "",
    derniersParametres: {},
    ancienRefusApresRotation: 0,
  };

  const emettre = (email) => {
    const jeton = aleatoire("acces");
    const rafraichi = aleatoire("rafraichi");
    acces.set(jeton, { email, expire: Date.now() + etat.dureeJetonSecondes * 1000 });
    rafraichissements.set(rafraichi, { email, actif: true });
    return {
      access_token: jeton,
      refresh_token: rafraichi,
      expires_in: etat.dureeJetonSecondes,
      token_type: "Bearer",
    };
  };

  const repondreJson = (res, statut, corps) => {
    res.writeHead(statut, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(corps));
  };

  const serveur = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/authorize") {
      const p = url.searchParams;
      const redirection = p.get("redirect_uri") ?? "";
      etat.derniersParametres = Object.fromEntries(p.entries());
      const conforme =
        p.get("client_id") === CLIENT_ID &&
        p.get("response_type") === "code" &&
        p.get("code_challenge_method") === "S256" &&
        (p.get("code_challenge") ?? "").length >= 43 &&
        (p.get("state") ?? "").length >= 16 &&
        /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(redirection);
      if (!conforme) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("demande d'autorisation non conforme");
        return;
      }
      etat.autorisations += 1;
      etat.derniereRedirection = redirection;
      if (url.searchParams.get("refus") === "1") {
        res.writeHead(302, { location: `${redirection}?error=access_denied&state=${encodeURIComponent(p.get("state"))}` });
        res.end();
        return;
      }
      const code = aleatoire("code");
      codes.set(code, { challenge: p.get("code_challenge"), redirection, email: p.get("login_hint") ?? "inconnu@example.invalid" });
      res.writeHead(302, { location: `${redirection}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(p.get("state"))}` });
      res.end();
      return;
    }

    const morceaux = [];
    req.on("data", (c) => morceaux.push(c));
    req.on("end", () => {
      const corps = Buffer.concat(morceaux).toString("utf8");
      const form = new URLSearchParams(corps);
      if (req.method === "POST" && url.pathname === "/token") {
        const grant = form.get("grant_type");
        if (form.get("client_id") !== CLIENT_ID && !(req.headers.authorization ?? "").startsWith("Basic ")) {
          repondreJson(res, 401, { error: "invalid_client" });
          return;
        }
        if (grant === "authorization_code") {
          const code = form.get("code") ?? "";
          const inscrit = codes.get(code);
          codes.delete(code); // un code ne sert qu'une fois, même mal présenté
          const verifier = form.get("code_verifier") ?? "";
          const empreinte = base64url(createHash("sha256").update(verifier).digest());
          if (!inscrit || form.get("redirect_uri") !== inscrit.redirection) {
            repondreJson(res, 400, { error: "invalid_grant" });
            return;
          }
          if (empreinte !== inscrit.challenge) {
            etat.refusPkce += 1;
            repondreJson(res, 400, { error: "invalid_grant", error_description: "PKCE" });
            return;
          }
          etat.echangesDeCode += 1;
          repondreJson(res, 200, emettre(inscrit.email));
          return;
        }
        if (grant === "refresh_token") {
          const jeton = form.get("refresh_token") ?? "";
          const connu = rafraichissements.get(jeton);
          if (!connu || !connu.actif) {
            if (connu) etat.ancienRefusApresRotation += 1;
            repondreJson(res, 400, { error: "invalid_grant" });
            return;
          }
          connu.actif = false; // rotation : l'ancien jeton ne sert plus
          etat.renouvellements += 1;
          repondreJson(res, 200, emettre(connu.email));
          return;
        }
        repondreJson(res, 400, { error: "unsupported_grant_type" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/introspect") {
        const connu = acces.get(form.get("token") ?? "");
        if (connu && connu.expire > Date.now()) repondreJson(res, 200, { active: true, email: connu.email });
        else repondreJson(res, 200, { active: false });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/revoquer") {
        for (const entree of rafraichissements.values()) entree.actif = false;
        for (const entree of acces.values()) entree.expire = 0;
        repondreJson(res, 200, { revoque: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/expirer") {
        for (const entree of acces.values()) entree.expire = 0;
        repondreJson(res, 200, { expire: true });
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    serveur.once("error", reject);
    serveur.listen(port, hote, resolve);
  });

  return {
    port,
    etat,
    /** Un jeton d'accès valide pour cet utilisateur ? (relais SMTP simulé) */
    accesValide: (jeton) => {
      const connu = acces.get(jeton);
      return connu && connu.expire > Date.now() ? connu.email : null;
    },
    jetonsEmis: () => ({ acces: [...acces.keys()], rafraichissements: [...rafraichissements.keys()] }),
    revoquer: () => {
      for (const entree of rafraichissements.values()) entree.actif = false;
      for (const entree of acces.values()) entree.expire = 0;
    },
    expirer: () => {
      for (const entree of acces.values()) entree.expire = 0;
    },
    arreter: () => new Promise((resolve) => serveur.close(() => resolve())),
  };
}

/**
 * Navigateur de l'utilisateur : suit l'adresse d'autorisation jusqu'à la redirection de bouclage et rend la
 * redirection brute (`Location`), sans la suivre. Le poste, lui, écoute le port de bouclage.
 */
export async function autoriserDansLeNavigateur(urlAutorisation, options = {}) {
  const url = new URL(urlAutorisation);
  // L'instance (conteneur) et la recette (hôte) n'ont pas le même nom pour l'hôte.
  if (url.hostname === "host.docker.internal") url.hostname = "127.0.0.1";
  for (const [nom, valeur] of Object.entries(options)) url.searchParams.set(nom, valeur);
  const reponse = await fetch(url, { redirect: "manual" });
  return { statut: reponse.status, location: reponse.headers.get("location") };
}

export { base64url };
