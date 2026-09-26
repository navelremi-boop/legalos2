/**
 * Simulateur de plateforme agréée (dépôt idempotent, statuts, encaissement partiel).
 * Mémoire seulement. Données fictives.
 */
import { createServer } from "node:http";

const depots = new Map();
const factures = new Map();

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on("data", (c) => morceaux.push(c));
    req.on("end", () => {
      const brut = Buffer.concat(morceaux).toString("utf8");
      if (!brut) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(brut));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function envoyer(res, code, corps) {
  const json = JSON.stringify(corps);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(json);
}

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    envoyer(res, 200, { ok: true });
    return;
  }
  try {
    if (req.method === "POST" && url.pathname === "/v1/factures/deposer") {
      const cle = req.headers["idempotency-key"];
      if (typeof cle !== "string" || cle.length < 8) {
        envoyer(res, 400, { message: "Idempotency-Key requise" });
        return;
      }
      const deja = depots.get(cle);
      if (deja) {
        envoyer(res, 200, { ...factures.get(deja), doublon: false, reprise: true });
        return;
      }
      const corps = await lireCorps(req);
      const id = `pa-${depots.size + 1}`;
      const fiche = {
        id,
        reference: String(corps.reference ?? ""),
        statut: "deposee",
        encaissements: [],
      };
      depots.set(cle, id);
      factures.set(id, fiche);
      factures.set(String(corps.reference ?? ""), fiche);
      envoyer(res, 201, { ...fiche, reprise: false });
      return;
    }
    const statuts = /^\/v1\/factures\/([^/]+)\/statuts$/.exec(url.pathname);
    if (req.method === "GET" && statuts) {
      const fiche = factures.get(decodeURIComponent(statuts[1]));
      if (!fiche) {
        envoyer(res, 404, { message: "inconnue" });
        return;
      }
      envoyer(res, 200, fiche);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/encaissements") {
      const cle = req.headers["idempotency-key"];
      if (typeof cle !== "string" || cle.length < 8) {
        envoyer(res, 400, { message: "Idempotency-Key requise" });
        return;
      }
      const corps = await lireCorps(req);
      const fiche = factures.get(String(corps.reference ?? ""));
      if (!fiche) {
        envoyer(res, 404, { message: "facture inconnue" });
        return;
      }
      if (!fiche.encaissements.some((e) => e.cle === cle)) {
        fiche.encaissements.push({
          cle,
          montant_centimes: Number(corps.montant_centimes),
          taux_tva_bp: Number(corps.taux_tva_bp),
        });
      }
      const total = fiche.encaissements.reduce((s, e) => s + e.montant_centimes, 0);
      fiche.statut = total >= Number(corps.montant_ttc_centimes) ? "encaissee" : "partiellement_encaissee";
      envoyer(res, 200, fiche);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/e-reporting") {
      const cle = req.headers["idempotency-key"];
      if (typeof cle !== "string" || cle.length < 8) {
        envoyer(res, 400, { message: "Idempotency-Key requise" });
        return;
      }
      envoyer(res, 200, { ok: true, cle });
      return;
    }
    const annuaire = /^\/v1\/annuaire\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && annuaire) {
      envoyer(res, 200, {
        siren: decodeURIComponent(annuaire[1]),
        adresse_facturation_electronique: "box-fictive@annuaire.example",
      });
      return;
    }
    envoyer(res, 404, { message: "route inconnue" });
  } catch {
    envoyer(res, 400, { message: "json illisible" });
  }
});

serveur.listen(8090, "0.0.0.0");
