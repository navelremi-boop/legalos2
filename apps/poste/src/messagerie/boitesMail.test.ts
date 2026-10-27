import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boiteDuMessage,
  compteDepartMessageNeuf,
  comptesEnvoi,
  compterNonLusReception,
  construireRail,
  identifiantUtilisateur,
  libelleCompteEnvoi,
  mailsDuDossier,
  vueParDefaut,
} from "./boitesMail.ts";
import type { CompteLocal, MailLocal } from "./typesMails.ts";

const MOI = "u-moi";
const comptes: CompteLocal[] = [
  { id: "c1", adresse: "j.marchal@cabinet.example", type_compte: "nominatif", titulaire_id: MOI },
  { id: "c2", adresse: "contact@cabinet.example", type_compte: "partage" },
];

function mail(id: string, dossier_imap: string | null, titulaire_id: string | null, lu: number): MailLocal {
  return {
    id,
    objet: id,
    expediteur: "x@example.com",
    etat_classement: "classe",
    dossier_id: null,
    suggestion_dossier_id: null,
    titulaire_id,
    dossier_imap,
    lu,
    cree_le: "2026-10-09T09:00:00+02:00",
  };
}

const mails = [
  mail("p1", "INBOX", MOI, 0),
  mail("p2", "INBOX", MOI, 1),
  mail("p3", "INBOX", MOI, 0),
  mail("p4", "Sent", MOI, 1),
  mail("p5", "Drafts", MOI, 1),
  mail("p6", "Trash", MOI, 1),
  mail("s1", "INBOX", null, 0),
  mail("autre", "INBOX", "u-confrere", 0),
];

describe("identité et boîte d'un message", () => {
  it("l'utilisateur est le titulaire de son compte nominatif", () => {
    assert.equal(identifiantUtilisateur(comptes), MOI);
    assert.equal(identifiantUtilisateur([]), null);
    assert.equal(identifiantUtilisateur([{ id: "c2", adresse: "a@b", type_compte: "partage" }]), null);
  });
  it("boîte personnelle, boîte partagée, et rien pour le mail d'un confrère", () => {
    assert.equal(boiteDuMessage({ titulaire_id: MOI }, MOI), "perso");
    assert.equal(boiteDuMessage({ titulaire_id: null }, MOI), "partagee");
    assert.equal(boiteDuMessage({ titulaire_id: "u-confrere" }, MOI), null);
  });
  it("essai négatif : sans compte nominatif, aucun mail n'est « à moi »", () => {
    assert.equal(boiteDuMessage({ titulaire_id: MOI }, null), null);
  });
});

describe("construireRail", () => {
  const rail = construireRail(comptes, mails, MOI);

  it("Ma boîte puis Boîte partagée", () => {
    assert.deepEqual(rail.map((b) => [b.id, b.titre]), [
      ["perso", "Ma boîte"],
      ["partagee", "Boîte partagée"],
    ]);
    assert.deepEqual(rail[0]?.adresses.map((a) => a.adresse), ["j.marchal@cabinet.example"]);
  });

  it("dossiers de Ma boîte en français, dans l'ordre, avec compteurs", () => {
    const dossiers = rail[0]?.dossiers ?? [];
    assert.deepEqual(
      dossiers.map((d) => [d.libelle, d.compteur, d.nature]),
      [
        ["Boîte de réception", 2, "non-lus"],
        ["Brouillons", 1, "total"],
        ["Envoyés", null, null],
        ["Archives", null, null],
        ["Corbeille", null, null],
      ],
    );
  });

  it("essai négatif : aucun nom IMAP brut dans le rail", () => {
    const libelles = rail.flatMap((b) => b.dossiers.map((d) => d.libelle));
    for (const brut of ["INBOX", "Sent", "Drafts", "Trash"]) {
      assert.equal(libelles.includes(brut), false, brut);
    }
  });

  it("la boîte partagée ne montre que sa réception tant qu'elle n'a rien d'autre", () => {
    assert.deepEqual(
      rail[1]?.dossiers.map((d) => [d.cle, d.compteur]),
      [["reception", 1]],
    );
  });

  it("pas de boîte partagée sans compte partagé ni message sans titulaire", () => {
    const seul = construireRail([comptes[0] as CompteLocal], mails.filter((m) => m.titulaire_id === MOI), MOI);
    assert.deepEqual(seul.map((b) => b.id), ["perso"]);
  });

  it("sans compte : rail vide", () => {
    assert.deepEqual(construireRail([], [], null), []);
  });

  it("un dossier inconnu est ajouté après les dossiers connus, sous son nom", () => {
    const avecClients = construireRail(comptes, [...mails, mail("k1", "INBOX.Clients", MOI, 1)], MOI);
    const libelles = avecClients[0]?.dossiers.map((d) => d.libelle) ?? [];
    assert.equal(libelles[libelles.length - 1], "Clients");
  });

  it("signale des identifiants refusés", () => {
    const refus = construireRail([comptes[0] as CompteLocal], [], MOI, new Set([comptes[0]?.id ?? ""]));
    assert.equal(refus[0]?.adresses[0]?.identifiantsRefuses, true);
    assert.equal(rail[0]?.adresses[0]?.identifiantsRefuses, false);
  });
});

describe("contenu des vues", () => {
  it("le dossier d'une boîte ne contient que ses messages", () => {
    assert.deepEqual(mailsDuDossier(mails, "perso", "reception", MOI).map((m) => m.id), ["p1", "p2", "p3"]);
    assert.deepEqual(mailsDuDossier(mails, "perso", "envoyes", MOI).map((m) => m.id), ["p4"]);
    assert.deepEqual(mailsDuDossier(mails, "partagee", "reception", MOI).map((m) => m.id), ["s1"]);
  });
  it("essai négatif : le mail d'un confrère n'apparaît dans aucune boîte", () => {
    assert.equal(mailsDuDossier(mails, "perso", "reception", MOI).some((m) => m.id === "autre"), false);
    assert.equal(mailsDuDossier(mails, "partagee", "reception", MOI).some((m) => m.id === "autre"), false);
  });
  it("non lus : réception de l'utilisateur et de la boîte partagée, pas ceux d'un confrère", () => {
    assert.equal(compterNonLusReception(mails, MOI), 3);
  });
  it("vue de départ : la réception de l'utilisateur, sinon celle de la boîte partagée quand elle seule a des messages", () => {
    assert.deepEqual(vueParDefaut(mails, MOI), { boite: "perso", dossier: "reception" });
    assert.deepEqual(vueParDefaut(mails.filter((m) => m.titulaire_id === null), MOI), {
      boite: "partagee",
      dossier: "reception",
    });
    assert.deepEqual(vueParDefaut([], MOI), { boite: "perso", dossier: "reception" });
  });
});

describe("comptes d'envoi", () => {
  const autre: CompteLocal = { id: "c3", adresse: "autre@cabinet.example", type_compte: "nominatif", titulaire_id: "u-autre" };
  const classement: CompteLocal = { id: "c4", adresse: "classement@cabinet.example", type_compte: "classement" };

  it("ma boîte d'abord, puis les boîtes partagées ; jamais le compte d'un confrère ni la boîte de classement", () => {
    assert.deepEqual(comptesEnvoi([autre, comptes[1] as CompteLocal, classement, comptes[0] as CompteLocal], MOI).map((c) => c.id), ["c1", "c2"]);
  });

  it("sans identifiant d'utilisateur, aucun compte nominatif n'est proposé", () => {
    assert.deepEqual(comptesEnvoi(comptes, null).map((c) => c.id), ["c2"]);
  });

  it("libellé : la boîte partagée se reconnaît", () => {
    assert.equal(libelleCompteEnvoi(comptes[0] as CompteLocal), "j.marchal@cabinet.example");
    assert.equal(libelleCompteEnvoi(comptes[1] as CompteLocal), "contact@cabinet.example (boîte partagée)");
  });
});

describe("compteDepartMessageNeuf", () => {
  const partage2: CompteLocal = { id: "c3", adresse: "greffe@cabinet.example", type_compte: "partage" };
  const dossierPerso = { genre: "dossier", boite: "perso", dossier: "reception" } as const;
  const dossierPartage = { genre: "dossier", boite: "partagee", dossier: "reception" } as const;

  it("depuis un dossier de Ma boîte, la boîte nominative", () => {
    assert.equal(compteDepartMessageNeuf(dossierPerso, comptes, MOI), "c1");
  });
  it("depuis « À classer » ou la barre d'actions (aucune vue), la boîte nominative", () => {
    assert.equal(compteDepartMessageNeuf({ genre: "a-classer" }, comptes, MOI), "c1");
    assert.equal(compteDepartMessageNeuf(null, comptes, MOI), "c1");
  });
  it("une boîte partagée sélectionnée dans le rail, avec un seul compte partagé, part de ce compte", () => {
    assert.equal(compteDepartMessageNeuf(dossierPartage, comptes, MOI), "c2");
  });
  it("essai négatif : plusieurs boîtes partagées, le rail ne désigne pas un compte, la boîte nominative part", () => {
    assert.equal(compteDepartMessageNeuf(dossierPartage, [...comptes, partage2], MOI), "c1");
  });
  it("essai négatif : sans compte nominatif, aucun compte (le serveur désigne la boîte du cabinet), jamais celui d'un confrère", () => {
    const autre: CompteLocal = { id: "c9", adresse: "autre@cabinet.example", type_compte: "nominatif", titulaire_id: "u-autre" };
    assert.equal(compteDepartMessageNeuf(dossierPerso, [autre, comptes[1] as CompteLocal], MOI), null);
  });
});
