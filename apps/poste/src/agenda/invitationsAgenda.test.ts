import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  elementInvitation,
  elementsInvitations,
  invitationsDuJour,
  presenterInvitationAgenda,
} from "./invitationsAgenda.ts";
import type { InvitationLocale } from "../messagerie/typesMails.ts";

/** Espaces insécables et fines remplacés par une espace : les assertions lisent le texte, pas la typographie. */
const lisible = (texte: string): string => texte.replace(/[  ]/gu, " ");

function invitation(extra: Partial<InvitationLocale> = {}): InvitationLocale {
  return {
    id: "i1",
    uid_ical: "uid-1",
    sequence: 0,
    effet: "demande",
    fuseau: "Europe/Paris",
    debut: "2026-10-08T10:00:00",
    fin: "2026-10-08T11:00:00",
    debut_utc: "2026-10-08T08:00:00.000Z",
    fin_utc: "2026-10-08T09:00:00.000Z",
    objet: "Signature de l'acte de partage",
    organisateur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
    verifiee: 1,
    message_id: "<m1@etude-garnier.example>",
    reponse: null,
    ...extra,
  };
}

function el(extra: Partial<InvitationLocale> = {}) {
  const element = elementInvitation(invitation(extra));
  assert.notEqual(element, null);
  return element as NonNullable<typeof element>;
}

describe("heure locale d'une invitation", () => {
  it("Europe/Paris en été : l'heure civile est conservée", () => {
    const e = el();
    assert.equal(e.jour, "2026-10-08");
    assert.equal(lisible(e.heure), "10 h 00");
    assert.equal(e.fuseauNonConverti, null);
  });

  it("fuseau étranger : l'instant UTC est converti à l'heure de Paris", () => {
    // 10 h à New York le 8 octobre 2026 (UTC-4) = 16 h à Paris (UTC+2).
    const e = el({ fuseau: "America/New_York", debut: "2026-10-08T10:00:00", debut_utc: "2026-10-08T14:00:00.000Z" });
    assert.equal(e.jour, "2026-10-08");
    assert.equal(lisible(e.heure), "16 h 00");
    assert.equal(e.fuseauNonConverti, null);
  });

  it("le jour local peut différer du jour civil du fuseau de l'invitation", () => {
    // 6 h 30 le 9 octobre à Tokyo (UTC+9) = 23 h 30 le 8 octobre à Paris.
    const e = el({ fuseau: "Asia/Tokyo", debut: "2026-10-09T06:30:00", debut_utc: "2026-10-08T21:30:00.000Z" });
    assert.equal(e.jour, "2026-10-08");
    assert.equal(lisible(e.heure), "23 h 30");
  });

  it("passage à l'heure d'hiver (25 octobre 2026) : 2 h 30 existe deux fois, minuit et 3 h 30 restent justes", () => {
    const premiere = el({ id: "a", debut_utc: "2026-10-25T00:30:00.000Z", debut: "2026-10-25T02:30:00" });
    const seconde = el({ id: "b", debut_utc: "2026-10-25T01:30:00.000Z", debut: "2026-10-25T02:30:00" });
    assert.equal(lisible(premiere.heure), "2 h 30");
    assert.equal(lisible(seconde.heure), "2 h 30");
    const apres = el({ id: "c", debut_utc: "2026-10-25T02:30:00.000Z", debut: "2026-10-25T03:30:00" });
    assert.equal(lisible(apres.heure), "3 h 30");
    const veille = el({ id: "d", debut_utc: "2026-10-24T22:30:00.000Z", debut: "2026-10-25T00:30:00" });
    assert.equal(veille.jour, "2026-10-25");
    assert.equal(lisible(veille.heure), "0 h 30");
  });

  it("en hiver, 9 h UTC est 10 h à Paris ; en été, 9 h UTC est 11 h", () => {
    assert.equal(lisible(el({ debut_utc: "2026-12-15T09:00:00.000Z", debut: "2026-12-15T10:00:00" }).heure), "10 h 00");
    assert.equal(lisible(el({ debut_utc: "2026-07-15T09:00:00.000Z", debut: "2026-07-15T11:00:00" }).heure), "11 h 00");
  });

  it("sans instant UTC (heure flottante, fuseau inconnu), l'heure civile est montrée telle quelle, fuseau signalé s'il n'est pas Paris", () => {
    const flottante = el({ debut_utc: null, fin_utc: null });
    assert.equal(lisible(flottante.heure), "10 h 00");
    assert.equal(flottante.fuseauNonConverti, null);
    const inconnu = el({ debut_utc: null, fuseau: "Mars/Olympus" });
    assert.equal(lisible(inconnu.heure), "10 h 00");
    assert.equal(inconnu.fuseauNonConverti, "Mars/Olympus");
    assert.equal(lisible(presenterInvitationAgenda(inconnu).fuseau ?? ""), "heure du fuseau Mars/Olympus");
  });

  it("journée entière : un jour, aucune heure", () => {
    const e = el({ debut: "2026-10-08", fin: "2026-10-09", debut_utc: null, fin_utc: null });
    assert.equal(e.jour, "2026-10-08");
    assert.equal(e.heure, "");
    assert.equal(e.minutes, null);
  });

  it("un début illisible n'est pas affiché", () => {
    assert.equal(elementInvitation(invitation({ debut: "pas une date", debut_utc: null })), null);
  });
});

describe("version courante, mise à jour, annulation", () => {
  it("une demande n'est ni annulée ni marquée mise à jour", () => {
    const e = el();
    assert.deepEqual([e.effet, e.annulee, e.miseAJour], ["demande", false, false]);
    assert.equal(presenterInvitationAgenda(e).etat, null);
  });

  it("une mise à jour déplace l'élément et le signale", () => {
    const avant = elementsInvitations([invitation()]);
    const apres = elementsInvitations([
      invitation({
        sequence: 1,
        effet: "mise_a_jour",
        debut: "2026-10-09T14:00:00",
        debut_utc: "2026-10-09T12:00:00.000Z",
        objet: "Signature reportée",
      }),
    ]);
    assert.equal(avant[0]?.jour, "2026-10-08");
    assert.equal(apres[0]?.jour, "2026-10-09");
    assert.equal(lisible(apres[0]?.heure ?? ""), "14 h 00");
    assert.equal(presenterInvitationAgenda(apres[0] as NonNullable<(typeof apres)[0]>).etat, "Mise à jour");
    assert.equal(apres[0]?.titre, "Signature reportée");
  });

  it("une annulation reste dans l'agenda, marquée annulée, sans réponse à donner", () => {
    const e = el({ sequence: 2, effet: "annulation" });
    const p = presenterInvitationAgenda(e);
    assert.equal(e.annulee, true);
    assert.equal(p.etat, "Annulée");
    assert.equal(p.reponse, null);
  });

  it("une seule ligne par UID : la plus grande SEQUENCE l'emporte, quel que soit l'ordre", () => {
    const v0 = invitation({ id: "v0", sequence: 0, objet: "v0" });
    const v2 = invitation({ id: "v2", sequence: 2, effet: "mise_a_jour", objet: "v2" });
    const v1 = invitation({ id: "v1", sequence: 1, effet: "mise_a_jour", objet: "v1" });
    for (const ordre of [
      [v0, v1, v2],
      [v2, v1, v0],
      [v1, v2, v0],
    ]) {
      const elements = elementsInvitations(ordre);
      assert.equal(elements.length, 1);
      assert.equal(elements[0]?.titre, "v2");
    }
  });

  it("deux UID distincts font deux éléments", () => {
    assert.equal(elementsInvitations([invitation(), invitation({ id: "i2", uid_ical: "uid-2" })]).length, 2);
  });
});

describe("réponse et origine", () => {
  it("la réponse déjà envoyée vient de la colonne synchronisée", () => {
    const libelle = (reponse: string | null) => presenterInvitationAgenda(el({ reponse })).reponse;
    assert.equal(libelle("accepte"), "Accepté");
    assert.equal(libelle("refuse"), "Refusé");
    assert.equal(libelle("peut_etre"), "Peut-être");
    assert.equal(libelle(null), "À répondre");
    assert.equal(libelle("autre chose"), "À répondre");
  });

  it("origine non vérifiée signalée ; vérifiée, rien", () => {
    assert.equal(presenterInvitationAgenda(el({ verifiee: 0 })).avertissement, "Origine non vérifiée");
    assert.equal(presenterInvitationAgenda(el({ verifiee: null })).avertissement, "Origine non vérifiée");
    assert.equal(presenterInvitationAgenda(el({ verifiee: 1 })).avertissement, null);
    assert.equal(presenterInvitationAgenda(el({ verifiee: true })).avertissement, null);
  });

  it("libellé « Invitation », organisateur lisible, lien vers le mail", () => {
    const e = el();
    const p = presenterInvitationAgenda(e);
    assert.equal(p.libelle, "Invitation — Signature de l'acte de partage");
    assert.equal(p.organisateur, "Organisateur : Me Lucas Garnier");
    assert.equal(e.messageId, "<m1@etude-garnier.example>");
    assert.equal(el({ message_id: null }).messageId, null);
    assert.equal(el({ message_id: "  " }).messageId, null);
  });

  it("objet vide : « (sans titre) »", () => {
    assert.equal(el({ objet: "  " }).titre, "(sans titre)");
  });
});

describe("invitationsDuJour", () => {
  it("ne garde que le jour demandé : une invitation d'un autre jour n'y est pas", () => {
    const elements = elementsInvitations([
      invitation({ id: "a", uid_ical: "a" }),
      invitation({ id: "b", uid_ical: "b", debut: "2026-10-09T10:00:00", debut_utc: "2026-10-09T08:00:00.000Z" }),
    ]);
    assert.deepEqual(invitationsDuJour(elements, "2026-10-08").map((e) => e.id), ["a"]);
    assert.deepEqual(invitationsDuJour(elements, "2026-10-09").map((e) => e.id), ["b"]);
    assert.deepEqual(invitationsDuJour(elements, "2026-10-10"), []);
  });

  it("journée entière d'abord, puis par heure, puis par titre", () => {
    const elements = elementsInvitations([
      invitation({ id: "tard", uid_ical: "tard", debut_utc: "2026-10-08T15:00:00.000Z", objet: "Tard" }),
      invitation({ id: "b", uid_ical: "b", objet: "B" }),
      invitation({ id: "a", uid_ical: "a", objet: "A" }),
      invitation({ id: "jour", uid_ical: "jour", debut: "2026-10-08", debut_utc: null, objet: "Toute la journée" }),
    ]);
    assert.deepEqual(invitationsDuJour(elements, "2026-10-08").map((e) => e.id), ["jour", "a", "b", "tard"]);
  });
});
