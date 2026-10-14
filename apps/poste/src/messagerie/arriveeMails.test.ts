import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boitesLues,
  contenuNotificationArrivee,
  decisionArrivee,
  plancherArrivee,
  type LigneArrivee,
} from "./arriveeMails.ts";

const MOI = "u-moi";
const AUTRE = "u-autre";

const ligne = (seq: number, extra: Partial<LigneArrivee> = {}): LigneArrivee => ({
  titulaire_id: MOI,
  arrivee_seq: seq,
  arrivee_notifiable: 1,
  ...extra,
});

describe("premier chargement", () => {
  it("pose le curseur au plus grand rang présent, sans notifier, même sur des messages notifiables", () => {
    const decision = decisionArrivee([ligne(3), ligne(7), ligne(5)], ["perso"], MOI, {});
    assert.deepEqual(decision.notifications, []);
    assert.deepEqual(decision.curseurs, { perso: 7 });
  });

  it("boîte vide : curseur à 0, aucune notification", () => {
    const decision = decisionArrivee([], ["perso"], MOI, {});
    assert.deepEqual(decision.curseurs, { perso: 0 });
    assert.deepEqual(decision.notifications, []);
  });
});

describe("arrivée", () => {
  it("un mail notifiable de rang supérieur au curseur est signalé, et le curseur avance", () => {
    const decision = decisionArrivee([ligne(7), ligne(8)], ["perso"], MOI, { perso: 7 });
    assert.deepEqual(decision.notifications, [{ boite: "perso", nombre: 1 }]);
    assert.deepEqual(decision.curseurs, { perso: 8 });
  });

  it("jamais deux fois pour le même rang : repasser avec le curseur avancé ne signale rien", () => {
    const lignes = [ligne(7), ligne(8)];
    const premiere = decisionArrivee(lignes, ["perso"], MOI, { perso: 7 });
    assert.equal(premiere.notifications.length, 1);
    const seconde = decisionArrivee(lignes, ["perso"], MOI, premiere.curseurs);
    assert.deepEqual(seconde.notifications, []);
    assert.deepEqual(seconde.curseurs, { perso: 8 });
  });

  it("essai négatif : avec l'ancien curseur, le même mail est signalé (le curseur est bien ce qui l'empêche)", () => {
    assert.equal(decisionArrivee([ligne(8)], ["perso"], MOI, { perso: 7 }).notifications.length, 1);
    assert.equal(decisionArrivee([ligne(8)], ["perso"], MOI, { perso: 8 }).notifications.length, 0);
  });

  it("plusieurs mails de la même boîte : une seule notification qui les compte", () => {
    const decision = decisionArrivee([ligne(8), ligne(9), ligne(10)], ["perso"], MOI, { perso: 7 });
    assert.deepEqual(decision.notifications, [{ boite: "perso", nombre: 3 }]);
    assert.deepEqual(decision.curseurs, { perso: 10 });
  });

  it("un mail non notifiable (historique) ne notifie pas, mais le curseur avance", () => {
    const decision = decisionArrivee(
      [ligne(8, { arrivee_notifiable: 0 }), ligne(9, { arrivee_notifiable: false }), ligne(10, { arrivee_notifiable: null })],
      ["perso"],
      MOI,
      { perso: 7 },
    );
    assert.deepEqual(decision.notifications, []);
    assert.deepEqual(decision.curseurs, { perso: 10 });
  });

  it("un mail devenu lu entre-temps est tout de même signalé une fois : le marquage dit « non lu à l'arrivée »", () => {
    const decision = decisionArrivee([{ ...ligne(8), lu: 1 } as LigneArrivee], ["perso"], MOI, { perso: 7 });
    assert.deepEqual(decision.notifications, [{ boite: "perso", nombre: 1 }]);
  });

  it("le curseur ne recule jamais (rang plus ancien reçu tard)", () => {
    const decision = decisionArrivee([ligne(5)], ["perso"], MOI, { perso: 9 });
    assert.deepEqual(decision.notifications, []);
    assert.deepEqual(decision.curseurs, { perso: 9 });
  });

  it("colonnes absentes ou illisibles : rien n'est signalé", () => {
    const decision = decisionArrivee(
      [{ titulaire_id: MOI }, { titulaire_id: MOI, arrivee_seq: Number.NaN, arrivee_notifiable: 1 }],
      ["perso"],
      MOI,
      { perso: 1 },
    );
    assert.deepEqual(decision.notifications, []);
  });
});

describe("boîtes de l'utilisateur", () => {
  it("un mail de la boîte nominative d'un AUTRE collaborateur ne notifie jamais", () => {
    const decision = decisionArrivee([ligne(9, { titulaire_id: AUTRE })], ["perso", "partagee"], MOI, {
      perso: 7,
      partagee: 7,
    });
    assert.deepEqual(decision.notifications, []);
    // contrôle positif : le même mail dans MA boîte notifie.
    const chezMoi = decisionArrivee([ligne(9)], ["perso", "partagee"], MOI, { perso: 7, partagee: 7 });
    assert.equal(chezMoi.notifications.length, 1);
  });

  it("un mail d'un autre collaborateur ne fait pas avancer le curseur de ma boîte", () => {
    const decision = decisionArrivee([ligne(99, { titulaire_id: AUTRE })], ["perso"], MOI, { perso: 7 });
    assert.deepEqual(decision.curseurs, { perso: 7 });
  });

  it("la boîte partagée (sans titulaire) notifie sous son nom, séparément de la mienne", () => {
    const decision = decisionArrivee(
      [ligne(9, { titulaire_id: null }), ligne(10, { titulaire_id: "" }), ligne(11)],
      ["perso", "partagee"],
      MOI,
      { perso: 7, partagee: 7 },
    );
    assert.deepEqual(decision.notifications, [
      { boite: "perso", nombre: 1 },
      { boite: "partagee", nombre: 2 },
    ]);
    assert.deepEqual(decision.curseurs, { perso: 11, partagee: 10 });
  });

  it("une boîte non lue n'a ni curseur ni notification", () => {
    const decision = decisionArrivee([ligne(9, { titulaire_id: null })], ["perso"], MOI, { perso: 7 });
    assert.deepEqual(decision.notifications, []);
    assert.equal(decision.curseurs.partagee, undefined);
  });

  it("boîte qui vient d'être ouverte à l'utilisateur (sans curseur) : son contenu est de l'historique", () => {
    const decision = decisionArrivee(
      [ligne(5, { titulaire_id: null }), ligne(6, { titulaire_id: null })],
      ["perso", "partagee"],
      MOI,
      { perso: 7 },
    );
    assert.deepEqual(decision.notifications, []);
    assert.deepEqual(decision.curseurs, { perso: 7, partagee: 6 });
  });
});

describe("boitesLues et plancher", () => {
  it("la boîte nominative est lue dès que son compte ou un de ses messages est là", () => {
    assert.deepEqual(boitesLues([{ type_compte: "nominatif" }], { perso: false, partagee: false }), ["perso"]);
    assert.deepEqual(boitesLues([], { perso: true, partagee: false }), ["perso"]);
    assert.deepEqual(boitesLues([], { perso: false, partagee: false }), []);
  });
  it("la boîte partagée est lue avec un compte partagé ou un message sans titulaire", () => {
    assert.deepEqual(boitesLues([{ type_compte: "partage" }], { perso: false, partagee: false }), ["partagee"]);
    assert.deepEqual(boitesLues([], { perso: false, partagee: true }), ["partagee"]);
    assert.deepEqual(boitesLues([{ type_compte: "nominatif" }], { perso: true, partagee: true }), ["perso", "partagee"]);
  });
  it("le plancher est 0 tant qu'une boîte lue n'a pas de curseur, sinon le plus petit", () => {
    assert.equal(plancherArrivee(["perso", "partagee"], { perso: 9 }), 0);
    assert.equal(plancherArrivee(["perso", "partagee"], { perso: 9, partagee: 4 }), 4);
    assert.equal(plancherArrivee([], {}), 0);
  });
});

describe("contenu de la notification", () => {
  it("un mail : « Nouveau mail » et le nom de la boîte", () => {
    assert.deepEqual(contenuNotificationArrivee({ boite: "perso", nombre: 1 }), {
      titre: "Nouveau mail",
      corps: "Ma boîte",
    });
    assert.deepEqual(contenuNotificationArrivee({ boite: "partagee", nombre: 1 }), {
      titre: "Nouveau mail",
      corps: "Boîte partagée",
    });
  });
  it("plusieurs mails : leur nombre", () => {
    assert.equal(contenuNotificationArrivee({ boite: "perso", nombre: 3 }).titre, "3 nouveaux mails");
  });
  it("ne porte que le nom de la boîte et le nombre : aucun champ du mail n'y entre", () => {
    const contenu = contenuNotificationArrivee({ boite: "perso", nombre: 2 });
    assert.deepEqual(Object.keys(contenu).sort(), ["corps", "titre"]);
    assert.match(`${contenu.titre} ${contenu.corps}`, /^[\p{L}\d\s  '’]+$/u);
  });
});
