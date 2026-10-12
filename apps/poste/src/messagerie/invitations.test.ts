import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invitationDuMessage, normaliserObjet, presenterInvitation, quandInvitation } from "./invitations.ts";
import type { InvitationLocale } from "./typesMails.ts";

function invitation(extra: Partial<InvitationLocale> = {}): InvitationLocale {
  return {
    id: "i1",
    uid_ical: "uid-1",
    sequence: 0,
    effet: "demande",
    fuseau: "Europe/Paris",
    debut: "2026-10-08T10:00:00",
    fin: "2026-10-08T11:00:00",
    objet: "Signature de l'acte de partage",
    organisateur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
    ...extra,
  };
}

const MAIL = {
  objet: "Invitation : signature de l’acte de partage",
  expediteur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
};

describe("invitationDuMessage", () => {
  it("rapproche l'objet (préfixe d'invitation et apostrophes ignorés) et l'organisateur", () => {
    assert.equal(invitationDuMessage(MAIL, [invitation()])?.id, "i1");
  });
  it("l'adresse de l'organisateur peut s'écrire en mailto:", () => {
    const inv = invitation({ organisateur: "mailto:L.Garnier@etude-garnier.example" });
    assert.equal(invitationDuMessage(MAIL, [inv])?.id, "i1");
  });
  it("retient la version la plus récente (SEQUENCE)", () => {
    const retenue = invitationDuMessage(MAIL, [
      invitation({ id: "v0", sequence: 0 }),
      invitation({ id: "v2", sequence: 2 }),
      invitation({ id: "v1", sequence: 1 }),
    ]);
    assert.equal(retenue?.id, "v2");
  });
  it("essai négatif : un autre organisateur ne porte pas l'invitation", () => {
    const autre = invitation({ organisateur: "Me Anne Perrin <a.perrin@perrin-avocats.example>" });
    assert.equal(invitationDuMessage(MAIL, [autre]), null);
  });
  it("essai négatif : un autre objet ne porte pas l'invitation", () => {
    const autre = invitation({ objet: "Audience de plaidoirie" });
    assert.equal(invitationDuMessage(MAIL, [autre]), null);
  });
  it("essai négatif : sans expéditeur ou sans objet, rien", () => {
    assert.equal(invitationDuMessage({ objet: "", expediteur: MAIL.expediteur }, [invitation()]), null);
    assert.equal(invitationDuMessage({ objet: MAIL.objet, expediteur: null }, [invitation()]), null);
    assert.equal(invitationDuMessage(MAIL, []), null);
  });
  it("normalise l'objet", () => {
    assert.equal(normaliserObjet("Re : Tr : Invitation : Réunion de l’équipe"), "reunion de l'equipe");
    assert.equal(normaliserObjet("Mise à jour : Réunion"), "reunion");
    assert.equal(normaliserObjet("Annulation : Réunion"), "reunion");
  });
});

describe("quandInvitation", () => {
  it("heure murale du fuseau de Paris, avec début et fin", () => {
    const quand = quandInvitation("2026-10-08T10:00:00", "2026-10-08T11:00:00", "Europe/Paris");
    assert.equal(quand?.texte, "jeudi 8 octobre, 10 h 00 à 11 h 00");
    assert.equal(quand?.jour, "2026-10-08");
  });
  it("un instant UTC est ramené à l'heure de Paris, l'été comme l'hiver", () => {
    assert.equal(quandInvitation("2026-10-08T08:00:00Z", null, null)?.texte, "jeudi 8 octobre, 10 h 00");
    assert.equal(quandInvitation("2026-12-10T09:00:00Z", null, null)?.texte, "jeudi 10 décembre, 10 h 00");
  });
  it("une heure sans décalage dans un fuseau étranger est annoncée avec ce fuseau", () => {
    const quand = quandInvitation("2026-10-08T10:00:00", null, "America/New_York");
    assert.match(quand?.texte ?? "", /\(heure du fuseau America\/New_York\)$/u);
  });
  it("essai négatif : à Paris, aucune mention de fuseau", () => {
    assert.doesNotMatch(quandInvitation("2026-10-08T10:00:00", null, "Europe/Paris")?.texte ?? "", /fuseau/u);
  });
  it("le premier du mois s'écrit « 1er »", () => {
    assert.equal(quandInvitation("2026-11-01T10:00:00", null, null)?.texte, "dimanche 1er novembre, 10 h 00");
  });
  it("valeur illisible : null", () => {
    assert.equal(quandInvitation("bientôt", null, null), null);
  });
});

describe("presenterInvitation", () => {
  it("tuile de calendrier, titre, organisateur", () => {
    const p = presenterInvitation(invitation());
    assert.equal(p?.mois, "oct.");
    assert.equal(p?.jour, "8");
    assert.equal(p?.titre, "Signature de l'acte de partage");
    assert.equal(p?.organisateur, "Organisateur : Me Lucas Garnier");
    assert.equal(p?.annulee, false);
    assert.equal(p?.miseAJour, false);
  });
  it("« 1er » sur la tuile", () => {
    assert.equal(presenterInvitation(invitation({ debut: "2026-10-01T10:00:00", fin: null }))?.jour, "1er");
  });
  it("annulation et mise à jour", () => {
    assert.equal(presenterInvitation(invitation({ effet: "annulation" }))?.annulee, true);
    assert.equal(presenterInvitation(invitation({ effet: "mise_a_jour" }))?.miseAJour, true);
  });
  it("organisateur réduit à une adresse", () => {
    const p = presenterInvitation(invitation({ organisateur: "mailto:org@example.com" }));
    assert.equal(p?.organisateur, "Organisateur : org@example.com");
  });
  it("sans date lisible, pas de carte", () => {
    assert.equal(presenterInvitation(invitation({ debut: "?" })), null);
  });
});
