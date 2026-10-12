import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageEchecReponse, messageErreurHttp, MESSAGE_ROUTE_ABSENTE } from "./erreursHttp.ts";
import {
  analyserCorrespondant,
  destinatairesAffiches,
  monogramme,
  nomAffiche,
  separerDestinataires,
} from "./expediteurs.ts";
import { presenterEnvoi } from "./fileEnvoi.ts";
import { libelleReleve } from "./releve.ts";

describe("réponse à une invitation : message d'erreur en français", () => {
  it("route absente (404, 405, 501 sans message) : message dédié, en français", () => {
    for (const statut of [404, 405, 501]) {
      assert.equal(messageEchecReponse(statut, null), MESSAGE_ROUTE_ABSENTE);
      assert.equal(messageEchecReponse(statut, {}), MESSAGE_ROUTE_ABSENTE);
    }
    assert.match(MESSAGE_ROUTE_ABSENTE, /pas encore disponible/u);
  });
  it("un message de l'API est repris tel quel, même sur un 404", () => {
    assert.equal(messageEchecReponse(404, { code: "not_found", message: "Invitation introuvable" }), "Invitation introuvable");
  });
  it("essai négatif : une erreur serveur ne passe pas pour une route absente", () => {
    assert.notEqual(messageEchecReponse(500, null), MESSAGE_ROUTE_ABSENTE);
    assert.equal(messageEchecReponse(401, null), "La session a expiré. Reconnectez-vous.");
    assert.equal(messageErreurHttp(403, null), "Vous n'avez pas le droit de faire cela.");
  });
});

describe("expéditeurs et destinataires", () => {
  it("nom et adresse", () => {
    assert.deepEqual(analyserCorrespondant("Me Clément Vasseur <c.vasseur@cabinet.example>"), {
      nom: "Me Clément Vasseur",
      adresse: "c.vasseur@cabinet.example",
    });
    assert.deepEqual(analyserCorrespondant('"Greffe, CA Lyon" <greffe@justice.example>'), {
      nom: "Greffe, CA Lyon",
      adresse: "greffe@justice.example",
    });
    assert.deepEqual(analyserCorrespondant("tiers@example.com"), { nom: "", adresse: "tiers@example.com" });
    assert.deepEqual(analyserCorrespondant(null), { nom: "", adresse: "" });
  });
  it("nom affiché et monogramme", () => {
    const c = analyserCorrespondant("Me Clément Vasseur <c.vasseur@cabinet.example>");
    assert.equal(nomAffiche(c), "Me Clément Vasseur");
    assert.equal(monogramme(c), "CV");
    assert.equal(monogramme(analyserCorrespondant("Mme Inès Ferrand <i@x>")), "IF");
    assert.equal(monogramme(analyserCorrespondant("Me Lucas Garnier <l@x>")), "LG");
    assert.equal(monogramme(analyserCorrespondant("Me <me@x>")), "M");
    assert.equal(monogramme(analyserCorrespondant("tiers@example.com")), "T");
    assert.equal(monogramme({ nom: "", adresse: "" }), "?");
  });
  it("sépare les destinataires hors guillemets et chevrons", () => {
    assert.deepEqual(separerDestinataires('A <a@x>, "B, C" <b@x>; d@x'), ['A <a@x>', '"B, C" <b@x>', "d@x"]);
  });
  it("« vous » pour une adresse de l'utilisateur, pas pour une autre", () => {
    assert.equal(destinatairesAffiches("j@cabinet.example", ["J@cabinet.example"]), "vous");
    assert.equal(destinatairesAffiches("Me X <x@e>, j@cabinet.example", ["j@cabinet.example"]), "Me X, vous");
    assert.equal(destinatairesAffiches("contact@cabinet.example", ["j@cabinet.example"]), "contact@cabinet.example");
    assert.equal(destinatairesAffiches(null, []), "");
  });
});

describe("file d'envoi : présentation des états", () => {
  it("brouillon, en attente (annulable), envoyé, copie confirmée, échec (nouvelle tentative)", () => {
    const d = "Me Anne Perrin";
    assert.deepEqual(presenterEnvoi({ etat: "brouillon", destinataire: d }), {
      ton: "attente",
      etat: "Brouillon, à Me Anne Perrin",
      annulable: false,
      relancable: false,
    });
    assert.equal(presenterEnvoi({ etat: "en_attente", destinataire: d }).annulable, true);
    assert.equal(presenterEnvoi({ etat: "envoye", destinataire: d }).ton, "attente");
    assert.deepEqual(presenterEnvoi({ etat: "copie_envoyes_confirmee", destinataire: d }), {
      ton: "ok",
      etat: "Copie dans « Envoyés » confirmée",
      annulable: false,
      relancable: false,
    });
    const echec = presenterEnvoi({ etat: "echec", destinataire: d });
    assert.equal(echec.ton, "echec");
    assert.equal(echec.relancable, true);
  });
  it("essai négatif : seul un envoi en attente s'annule, seul un échec se relance", () => {
    for (const etat of ["brouillon", "envoye", "copie_envoyes_confirmee", "echec"]) {
      assert.equal(presenterEnvoi({ etat, destinataire: "" }).annulable, false, etat);
    }
    for (const etat of ["brouillon", "en_attente", "envoye", "copie_envoyes_confirmee"]) {
      assert.equal(presenterEnvoi({ etat, destinataire: "" }).relancable, false, etat);
    }
  });
});

describe("témoin de relève", () => {
  const maintenant = new Date("2026-10-09T10:00:00Z");
  it("n'affiche rien sans date de relève", () => {
    assert.equal(libelleReleve(null, maintenant), null);
    assert.equal(libelleReleve(undefined, maintenant), null);
    assert.equal(libelleReleve("  ", maintenant), null);
    assert.equal(libelleReleve("pas une date", maintenant), null);
  });
  it("minutes, heures, jours", () => {
    assert.equal(libelleReleve("2026-10-09T09:59:00Z", maintenant), "Boîtes relevées il y a 1 min");
    assert.equal(libelleReleve("2026-10-09T09:30:00Z", maintenant), "Boîtes relevées il y a 30 min");
    assert.equal(libelleReleve("2026-10-09T08:00:00Z", maintenant), "Boîtes relevées il y a 2 h");
    assert.equal(libelleReleve("2026-10-07T10:00:00Z", maintenant), "Boîtes relevées il y a 2 jours");
    assert.equal(libelleReleve("2026-10-08T09:00:00Z", maintenant), "Boîtes relevées il y a 1 jour");
    assert.equal(libelleReleve("2026-10-09T09:59:40Z", maintenant), "Boîtes relevées à l'instant");
  });
});
