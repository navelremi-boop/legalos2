import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateEtHeure, dureeRelative, lireSante, presenterIndexation, presenterSante, type SanteCompte } from "./formesSanteMessagerie.ts";

function compte(extra: Partial<SanteCompte> = {}): SanteCompte {
  return {
    compteId: "c1",
    adresse: "a@cabinet.example",
    typeCompte: "nominatif",
    etatConnexion: "connecte",
    derniereReleveLe: "2026-10-17T07:00:00Z",
    retardSecondes: 60,
    erreursAuthentification: 0,
    derniereErreurAuthentificationLe: null,
    envoisEnEchec: 0,
    alerte: false,
    motifs: [],
    oauth: false,
    fournisseur: null,
    corpsIndexes: 0,
    corpsRestants: 0,
    corpsAbandonnes: 0,
    ...extra,
  };
}

describe("lecture du tableau de santé", () => {
  it("lit les comptes et ignore ce qui n'a pas d'identifiant", () => {
    const sante = lireSante({
      seuil_retard_secondes: 1200,
      comptes: [
        {
          compte_id: "c1",
          adresse: "a@cabinet.example",
          type_compte: "nominatif",
          etat_connexion: "connecte",
          derniere_releve_le: "2026-10-17T07:00:00Z",
          retard_secondes: 90,
          erreurs_authentification: 0,
          derniere_erreur_authentification_le: null,
          envois_en_echec: 2,
          alerte: true,
          motifs: ["envoi_en_echec", 3],
        },
        { adresse: "sans identifiant" },
        "x",
      ],
      envois_en_echec: 2,
      alerte: true,
    });
    assert.equal(sante.comptes.length, 1);
    assert.deepEqual(sante.comptes[0]?.motifs, ["envoi_en_echec"]);
    assert.equal(sante.comptes[0]?.envoisEnEchec, 2);
    assert.equal(sante.alerte, true);
  });

  it("lit le mode de connexion : OAuth et fournisseur, mot de passe par défaut", () => {
    const sante = lireSante({
      comptes: [
        { compte_id: "o", oauth: true, fournisseur: "microsoft" },
        { compte_id: "m", oauth: false, fournisseur: null },
        { compte_id: "a" },
        { compte_id: "x", oauth: "true", fournisseur: 3 },
      ],
    });
    assert.deepEqual(sante.comptes.map((c) => [c.oauth, c.fournisseur]), [[true, "microsoft"], [false, null], [false, null], [false, null]]);
  });

  it("une réponse illisible donne un tableau vide, jamais une boîte saine", () => {
    assert.deepEqual(lireSante(null), { comptes: [], envoisEnEchec: 0, alerte: false });
    assert.deepEqual(lireSante("x"), { comptes: [], envoisEnEchec: 0, alerte: false });
  });
});

describe("durées et dates", () => {
  it("durée relative arrondie vers le bas", () => {
    assert.equal(dureeRelative(5), "à l'instant");
    assert.equal(dureeRelative(60), "il y a 1 min");
    assert.equal(dureeRelative(119), "il y a 1 min");
    assert.equal(dureeRelative(3_599), "il y a 59 min");
    assert.equal(dureeRelative(3_600), "il y a 1 h");
    assert.equal(dureeRelative(86_400), "il y a 1 j");
    assert.equal(dureeRelative(-30), "à l'instant");
  });

  it("date et heure murales de Paris, premier du mois en « 1er »", () => {
    assert.equal(dateEtHeure("2026-10-17T06:12:00Z"), "le 17 oct., 8 h 12");
    assert.equal(dateEtHeure("2026-11-01T11:05:00Z"), "le 1er nov., 12 h 05");
    assert.equal(dateEtHeure(null), "");
    assert.equal(dateEtHeure("pas une date"), "");
  });
});

describe("ce que l'écran dit d'une boîte", () => {
  it("une panne du serveur est dite « serveur indisponible », jamais « identifiants refusés », sans bouton de reconnexion", () => {
    const p = presenterSante(compte({ etatConnexion: "indisponible", motifs: ["serveur_indisponible"], alerte: true }));
    assert.equal(p.titre, "Serveur indisponible");
    assert.equal(p.niveau, "alerte");
    assert.equal(p.reconnecter, false);
    assert.match(p.detail, /Nouvelle tentative automatique/u);
    // Essai négatif : ni le titre ni le détail ne parlent d'identifiants refusés ni de tentatives suspendues.
    assert.doesNotMatch(`${p.titre} ${p.detail}`, /refus|suspendu/iu);
    // Un refus d'identifiants garde son propre texte et son bouton.
    const refus = presenterSante(compte({ etatConnexion: "identifiants_refuses", motifs: ["identifiants_refuses"] }));
    assert.equal(refus.titre, "Identifiants refusés");
    assert.equal(refus.reconnecter, true);
  });

  it("boîte saine", () => {
    const p = presenterSante(compte());
    assert.deepEqual(p, { niveau: "ok", titre: "Connectée", detail: "Relevée il y a 1 min, aucun envoi en échec.", reconnecter: false, fournisseur: null });
  });

  it("identifiants refusés : alerte, reconnecter, tentatives suspendues", () => {
    const p = presenterSante(
      compte({ etatConnexion: "identifiants_refuses", motifs: ["identifiants_refuses"], derniereErreurAuthentificationLe: "2026-10-17T06:12:00Z" }),
    );
    assert.equal(p.niveau, "alerte");
    assert.equal(p.titre, "Identifiants refusés");
    assert.equal(p.reconnecter, true);
    assert.equal(p.detail, "Depuis le 17 oct., 8 h 12. Les tentatives sont suspendues.");
  });

  it("boîte OAuth connectée : le fournisseur est nommé, pas de bouton de reconnexion", () => {
    const p = presenterSante(compte({ oauth: true, fournisseur: "microsoft" }));
    assert.equal(p.titre, "Connectée");
    assert.equal(p.fournisseur, "Microsoft 365");
    assert.equal(p.reconnecter, false);
    assert.equal(presenterSante(compte({ oauth: true, fournisseur: "gmail" })).fournisseur, "Gmail");
  });

  it("boîte OAuth dont le fournisseur a refusé le jeton : identifiants refusés, Reconnecter", () => {
    const p = presenterSante(
      compte({ oauth: true, fournisseur: "gmail", etatConnexion: "identifiants_refuses", motifs: ["identifiants_refuses"], derniereErreurAuthentificationLe: "2026-10-17T06:12:00Z" }),
    );
    assert.equal(p.niveau, "alerte");
    assert.equal(p.titre, "Identifiants refusés");
    assert.equal(p.reconnecter, true);
    assert.equal(p.fournisseur, "Gmail");
    assert.equal(p.detail, "Depuis le 17 oct., 8 h 12. Les tentatives sont suspendues. L'autorisation est à renouveler.");
  });

  it("une boîte à mot de passe ne nomme aucun fournisseur, même si le serveur en envoyait un", () => {
    assert.equal(presenterSante(compte({ oauth: false, fournisseur: "gmail" })).fournisseur, null);
  });

  it("les identifiants refusés l'emportent sur le retard et les envois en échec", () => {
    const p = presenterSante(compte({ etatConnexion: "identifiants_refuses", motifs: ["retard", "envoi_en_echec", "identifiants_refuses"], envoisEnEchec: 3 }));
    assert.equal(p.titre, "Identifiants refusés");
  });

  it("retard : le dit avec la durée, et mentionne les envois en échec", () => {
    const p = presenterSante(compte({ motifs: ["retard"], retardSecondes: 3 * 3600, alerte: true }));
    assert.equal(p.titre, "Relève en retard");
    assert.equal(p.detail, "Dernière relève il y a 3 h.");
    assert.equal(presenterSante(compte({ motifs: ["retard"], retardSecondes: 7200, envoisEnEchec: 1 })).detail.includes("1 envoi en échec"), true);
  });

  it("envois en échec seuls : alerte au singulier et au pluriel", () => {
    assert.equal(presenterSante(compte({ motifs: ["envoi_en_echec"], envoisEnEchec: 1 })).detail, "1 envoi en échec, à relancer depuis la file d'envoi.");
    assert.equal(presenterSante(compte({ motifs: ["envoi_en_echec"], envoisEnEchec: 2 })).detail, "2 envois en échec, à relancer depuis la file d'envoi.");
  });

  it("une boîte jamais relevée n'est pas dite connectée", () => {
    const jamais = presenterSante(compte({ derniereReleveLe: null, etatConnexion: "inconnu", retardSecondes: 30 }));
    assert.equal(jamais.titre, "Connexion en cours");
    assert.equal(jamais.niveau, "neutre");
    assert.notEqual(jamais.titre, "Connectée");
  });

  it("la boîte du cabinet est relevée à la demande, pas en retard", () => {
    const p = presenterSante(compte({ typeCompte: "classement", retardSecondes: null, derniereReleveLe: null, etatConnexion: "inconnu" }));
    assert.equal(p.titre, "Relevée à la demande");
    assert.equal(p.niveau, "ok");
  });
});

describe("progression de l'indexation de fond", () => {
  it("lit les trois compteurs du serveur, 0 quand ils manquent", () => {
    const lue = lireSante({ comptes: [{ compte_id: "c", corps_indexes: 120, corps_restants: 30, corps_abandonnes: 2 }, { compte_id: "d" }] });
    assert.deepEqual(
      lue.comptes.map((c) => [c.corpsIndexes, c.corpsRestants, c.corpsAbandonnes]),
      [[120, 30, 2], [0, 0, 0]],
    );
  });

  it("rien à dire tant que rien n'a été indexé ni attendu", () => {
    assert.equal(presenterIndexation(compte()), null);
  });

  it("en cours : indexés et restants", () => {
    assert.equal(
      presenterIndexation(compte({ corpsIndexes: 120, corpsRestants: 30 })),
      "Recherche dans le texte des messages : 120 messages préparés, 30 à venir.",
    );
    assert.equal(
      presenterIndexation(compte({ corpsIndexes: 1, corpsRestants: 5 })),
      "Recherche dans le texte des messages : 1 message préparé, 5 à venir.",
    );
    assert.equal(
      presenterIndexation(compte({ corpsIndexes: 0, corpsRestants: 1 })),
      "Recherche dans le texte des messages : 0 message préparé, 1 à venir.",
    );
  });

  it("terminée seulement quand il ne reste rien, avec les abandons dits", () => {
    assert.equal(
      presenterIndexation(compte({ corpsIndexes: 150 })),
      "Recherche dans le texte des messages : tous les messages sont préparés (150).",
    );
    assert.match(presenterIndexation(compte({ corpsIndexes: 150, corpsAbandonnes: 2 })) ?? "", /2 messages illisibles ont été laissés de côté/u);
    assert.match(presenterIndexation(compte({ corpsIndexes: 150, corpsAbandonnes: 1 })) ?? "", /1 message illisible a été laissé de côté/u);
  });

  it("essai négatif : il reste des messages, la recherche n'est jamais dite terminée", () => {
    assert.doesNotMatch(presenterIndexation(compte({ corpsIndexes: 100, corpsRestants: 1 })) ?? "", /tous les messages/u);
  });
});
