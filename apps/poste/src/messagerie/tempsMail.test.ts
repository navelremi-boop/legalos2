import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  centimesDepuisEuros,
  enregistrerTemps,
  eurosDepuisCentimes,
  htTempsCentimes,
  TAUX_PAR_DEFAUT_CENTIMES,
  tauxHoraireParDefaut,
  type BaseTemps,
} from "../facturation/ecrireTemps.ts";
import type { StockageTexte } from "./cacheRedaction.ts";
import {
  CLE_JOURNAL_MAILS,
  ecrireJournal,
  journalVide,
  lireJournal,
  lireJournalDepuisTexte,
  MAILS_GARDES_MAX,
  noterActe,
  noterRegle,
  suiteDuMail,
} from "./journalMails.ts";
import { saisirTempsDuMail } from "./saisieTempsMail.ts";
import {
  BAREME_MINUTES,
  libelleBoutonSaisie,
  MINUTES_MAX_PAR_MAIL,
  minutesValides,
  propositionTemps,
  proposer,
} from "./tempsMail.ts";

describe("barème de la suggestion de temps (hypothèse produit, à valider par l'avocat)", () => {
  it("le barème est une constante nommée : lecture 6 min, réponse 12 min, transfert 6 min", () => {
    assert.deepEqual({ ...BAREME_MINUTES }, { lecture: 6, reponse: 12, transfert: 6 });
  });

  it("un mail lu sans suite : la lecture", () => {
    const proposition = propositionTemps([]);
    assert.equal(proposition.minutes, 6);
    assert.deepEqual(proposition.motifs, ["lecture"]);
    assert.equal(proposition.libelle, "Lecture d'un mail");
  });

  it("une réponse envoyée : 12 minutes, la lecture est comprise", () => {
    const proposition = propositionTemps(["reponse"]);
    assert.equal(proposition.minutes, 12);
    assert.deepEqual(proposition.motifs, ["reponse"]);
    assert.equal(proposition.libelle, "Réponse à un mail");
  });

  it("un transfert envoyé : 6 minutes", () => {
    assert.equal(propositionTemps(["transfert"]).minutes, 6);
    assert.equal(propositionTemps(["transfert"]).libelle, "Transfert d'un mail");
  });

  it("réponse et transfert : les deux traitements s'additionnent, chacun une fois", () => {
    const proposition = propositionTemps(["transfert", "reponse", "reponse", "transfert"]);
    assert.equal(proposition.minutes, 18);
    assert.deepEqual(proposition.motifs, ["reponse", "transfert"]);
    assert.equal(proposition.libelle, "Réponse à un mail et transfert d'un mail");
  });

  it("le libellé de la saisie ne porte ni objet, ni expéditeur, ni contenu du mail", () => {
    for (const actes of [[], ["reponse"], ["transfert"], ["reponse", "transfert"]] as const) {
      assert.match(propositionTemps(actes).libelle, /^(Lecture|Réponse|Transfert)[^:]*$/u);
    }
  });

  it("bouton de validation : « Saisir 6 min »", () => {
    assert.equal(libelleBoutonSaisie(6), "Saisir 6 min");
    assert.equal(libelleBoutonSaisie(propositionTemps(["reponse"]).minutes), "Saisir 12 min");
  });
});

describe("minutes corrigées par l'utilisateur avant de saisir", () => {
  it("un entier de 1 à 480", () => {
    assert.equal(minutesValides("6"), 6);
    assert.equal(minutesValides(" 25 "), 25);
    assert.equal(minutesValides("1"), 1);
    assert.equal(minutesValides(String(MINUTES_MAX_PAR_MAIL)), MINUTES_MAX_PAR_MAIL);
  });

  it("essai négatif : zéro, négatif, décimal, texte, trop grand, vide", () => {
    for (const refuse of ["0", "-5", "1,5", "1.5", "six", "", "  ", "481", "12 min", "99999"]) {
      assert.equal(minutesValides(refuse), null, JSON.stringify(refuse));
    }
  });
});

describe("quand proposer du temps", () => {
  it("un mail reçu, rangé dans un dossier, dont le temps n'est pas réglé", () => {
    assert.equal(proposer({ classeDansUnDossier: true, regle: false, ecritParLeCabinet: false }), true);
  });

  it("essai négatif : pas de dossier, déjà saisi ou écarté, message écrit par le cabinet", () => {
    assert.equal(proposer({ classeDansUnDossier: false, regle: false, ecritParLeCabinet: false }), false);
    assert.equal(proposer({ classeDansUnDossier: true, regle: true, ecritParLeCabinet: false }), false);
    assert.equal(proposer({ classeDansUnDossier: true, regle: false, ecritParLeCabinet: true }), false);
  });
});

describe("journal local des suites données aux mails", () => {
  it("une réponse envoyée est notée une fois, et rouvre une proposition déjà réglée", () => {
    let journal = journalVide("u1");
    journal = noterActe(journal, "m1", "reponse");
    journal = noterActe(journal, "m1", "reponse");
    assert.deepEqual(suiteDuMail(journal, "m1"), { actes: ["reponse"], regle: false });
    journal = noterRegle(journal, "m1");
    assert.equal(suiteDuMail(journal, "m1").regle, true);
    journal = noterActe(journal, "m1", "transfert");
    assert.deepEqual(suiteDuMail(journal, "m1"), { actes: ["reponse", "transfert"], regle: false });
  });

  it("un mail inconnu : aucun traitement, rien de réglé", () => {
    assert.deepEqual(suiteDuMail(journalVide("u1"), "inconnu"), { actes: [], regle: false });
  });

  it("le journal garde les derniers mails seulement", () => {
    let journal = journalVide("u1");
    for (let i = 0; i < MAILS_GARDES_MAX + 5; i += 1) journal = noterRegle(journal, `m${String(i)}`);
    assert.equal(Object.keys(journal.mails).length, MAILS_GARDES_MAX);
    assert.equal(journal.mails.m0, undefined);
    assert.equal(journal.mails[`m${String(MAILS_GARDES_MAX + 4)}`]?.regle, true);
  });

  it("écrit puis relu pour le même utilisateur ; jamais pour un autre", () => {
    const valeurs = new Map<string, string>();
    const stockage: StockageTexte = {
      getItem: (cle) => valeurs.get(cle) ?? null,
      setItem: (cle, valeur) => {
        valeurs.set(cle, valeur);
      },
    };
    ecrireJournal(stockage, noterActe(journalVide("u1"), "m1", "transfert"));
    assert.ok(valeurs.has(CLE_JOURNAL_MAILS));
    assert.deepEqual(lireJournal(stockage, "u1")?.mails.m1, { actes: ["transfert"], regle: false });
    assert.deepEqual(lireJournal(stockage, "u2")?.mails, {});
    assert.equal(lireJournal(stockage, null), null);
    assert.deepEqual(lireJournal(null, "u1")?.mails, {});
  });

  it("essai négatif : un journal illisible ou aux valeurs inattendues vaut un journal vide", () => {
    assert.deepEqual(lireJournalDepuisTexte("pas du json", "u1"), journalVide("u1"));
    const brut = '{"utilisateurId":"u1","mails":{"m1":{"actes":["reponse","pirate",3],"regle":"oui"},"m2":4}}';
    assert.deepEqual(lireJournalDepuisTexte(brut, "u1").mails, { m1: { actes: ["reponse"], regle: false } });
  });
});

/** Base locale fictive : mémorise les écritures de temps et sert les lectures que le chemin d'écriture fait. */
function baseFictive(options: { cabinet?: boolean; dossier?: { restreint: number } | null; taux?: number | null }) {
  const ecritures: { sql: string; valeurs: unknown[] }[] = [];
  const base: BaseTemps = {
    getAll: ((sql: string) => {
      if (sql.includes("FROM cabinets")) return Promise.resolve(options.cabinet === false ? [] : [{ id: "cabinet-1" }]);
      if (sql.includes("FROM dossiers")) return Promise.resolve(options.dossier === null ? [] : [options.dossier ?? { restreint: 0 }]);
      if (sql.includes("FROM taux_horaires")) {
        return Promise.resolve(options.taux === null || options.taux === undefined ? [] : [{ centimes_par_heure: options.taux }]);
      }
      if (sql.includes("FROM users")) return Promise.resolve([{ id: "utilisateur-local" }]);
      return Promise.resolve([]);
    }) as BaseTemps["getAll"],
    writeTransaction: ((travail: (tx: { execute: (sql: string, valeurs: unknown[]) => Promise<void> }) => Promise<unknown>) =>
      travail({
        execute: (sql, valeurs) => {
          ecritures.push({ sql, valeurs });
          return Promise.resolve();
        },
      })) as unknown as BaseTemps["writeTransaction"],
  };
  return { base, ecritures };
}

describe("saisie du temps d'un mail : le chemin d'écriture des temps du poste", () => {
  const instant = new Date("2026-10-14T09:30:00.000Z");

  it("le montant est celui du temps et du taux figé à l'enregistrement : 12 min à 90 € de l'heure font 18 €", () => {
    assert.equal(htTempsCentimes(12, 9_000), 1_800);
    assert.equal(htTempsCentimes(6, 6_000), 600);
    assert.equal(eurosDepuisCentimes(6_000), "60");
    assert.equal(eurosDepuisCentimes(6_050), "60,50");
    assert.equal(centimesDepuisEuros("60"), 6_000);
    assert.equal(centimesDepuisEuros("60,5"), 6_050);
    assert.equal(centimesDepuisEuros("0"), null);
  });

  it("écrit la saisie et son brouillon de facture sans numéro, avec le taux du cabinet et le libellé du traitement", async () => {
    const { base, ecritures } = baseFictive({ taux: 9_000 });
    const resultat = await saisirTempsDuMail(base, {
      dossierId: "dossier-1",
      minutes: 12,
      actes: ["reponse"],
      intervenantId: "utilisateur-1",
      maintenant: instant,
    });
    assert.equal(resultat.ok, true);
    assert.equal(ecritures.length, 2);
    const [temps, brouillon] = ecritures;
    assert.match(temps?.sql ?? "", /INSERT INTO temps_saisis/u);
    assert.match(brouillon?.sql ?? "", /INSERT INTO brouillons_facture/u);
    // id, cabinet, dossier, intervenant, minutes, libellé, taux, HT, visibilité, date
    assert.deepEqual(temps?.valeurs.slice(1), [
      "cabinet-1",
      "dossier-1",
      "utilisateur-1",
      12,
      "Réponse à un mail",
      9_000,
      1_800,
      "public",
      "2026-10-14T09:30:00.000Z",
    ]);
    assert.match(brouillon?.sql ?? "", /NULL, \?, \?, \?, \?, \?, \?\)/u);
  });

  it("sans taux enregistré, le taux par défaut du cabinet s'applique", async () => {
    const { base } = baseFictive({ taux: null });
    assert.equal(await tauxHoraireParDefaut(base), TAUX_PAR_DEFAUT_CENTIMES);
  });

  it("un dossier restreint donne une saisie restreinte", async () => {
    const { base, ecritures } = baseFictive({ dossier: { restreint: 1 } });
    await saisirTempsDuMail(base, { dossierId: "d", minutes: 6, actes: [], intervenantId: null });
    assert.equal(ecritures[0]?.valeurs[8], "restreint");
    assert.equal(ecritures[0]?.valeurs[3], "utilisateur-local");
  });

  it("essai négatif : minutes nulles, dossier inconnu du poste, cabinet absent : rien n'est écrit", async () => {
    for (const [options, minutes] of [
      [{}, 0],
      [{}, -3],
      [{}, 1.5],
      [{ dossier: null }, 6],
      [{ cabinet: false }, 6],
    ] as const) {
      const { base, ecritures } = baseFictive(options);
      const resultat = await saisirTempsDuMail(base, { dossierId: "d", minutes, actes: [], intervenantId: null });
      assert.equal(resultat.ok, false);
      assert.equal(ecritures.length, 0);
    }
  });

  it("essai négatif : un libellé vide ou un taux nul est refusé par le chemin commun", async () => {
    const { base, ecritures } = baseFictive({});
    assert.equal((await enregistrerTemps(base, { dossierId: "d", minutes: 6, libelle: "  ", tauxCentimesHeure: 6_000 })).ok, false);
    assert.equal((await enregistrerTemps(base, { dossierId: "d", minutes: 6, libelle: "x", tauxCentimesHeure: 0 })).ok, false);
    assert.equal(ecritures.length, 0);
  });
});
