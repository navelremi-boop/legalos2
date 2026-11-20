import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  champsModifies,
  controlerLien,
  dateLienValide,
  saisieDepuisLien,
  saisieLienVide,
  type ContexteLien,
  type SaisieLien,
} from "./controleLien.ts";
import type { LienAffiche } from "./liensContacts.ts";

const SOCIETE = { id: "societe", nature: "morale" as const };
const PERSONNE = { id: "claire", nature: "physique" as const };

const contexte = (reste: Partial<ContexteLien> = {}): ContexteLien => ({
  sourceId: "antoine",
  cible: SOCIETE,
  liensExistants: [],
  lienId: null,
  ...reste,
});

const saisie = (reste: Partial<SaisieLien> = {}): SaisieLien => ({ ...saisieLienVide(), ...reste });

const MANDAT: LienAffiche = {
  id: "l1",
  sourceId: "marie",
  cibleId: "societe",
  sourceCivilite: "Madame",
  sourcePrenoms: "Marie",
  sourceNom: "Duclos",
  cibleNom: "SAS Duclos",
  typeLien: "mandat_social",
  fonction: "gerant",
  libelle: null,
  representeSociete: true,
  debut: "2018-05-01",
  fin: null,
  source: "Kbis",
};

function refus(resultat: ReturnType<typeof controlerLien>): string {
  assert.equal(resultat.ok, false);
  return resultat.ok ? "" : resultat.message;
}

describe("contrôle d'un lien avant l'écriture locale", () => {
  it("accepte un mandat social complet vers une société", () => {
    const resultat = controlerLien(saisie({ debut: "2020-01-01", source: " Kbis " }), contexte());
    assert.equal(resultat.ok, true);
    if (resultat.ok) {
      assert.equal(resultat.lien.fonction, "gerant");
      assert.equal(resultat.lien.source, "Kbis");
      assert.equal(resultat.lien.fin, null);
      assert.equal(resultat.lien.libelle, null);
    }
  });

  it("refuse un contact lié à lui-même", () => {
    assert.equal(
      refus(controlerLien(saisie({ typeLien: "parent" }), contexte({ cible: { id: "antoine", nature: "physique" } }))),
      "Un contact ne se lie pas à lui-même.",
    );
  });

  it("refuse un lien sans contact choisi", () => {
    assert.equal(refus(controlerLien(saisie(), contexte({ cible: null }))), "Choisissez le contact à relier.");
  });

  it("refuse un mandat social vers une personne physique", () => {
    assert.equal(
      refus(controlerLien(saisie(), contexte({ cible: PERSONNE }))),
      "Un mandat social vise une personne morale.",
    );
  });

  it("accepte un lien de famille vers une personne physique", () => {
    assert.equal(controlerLien(saisie({ typeLien: "conjoint_pacs" }), contexte({ cible: PERSONNE })).ok, true);
  });

  it("exige la fonction d'un mandat et le libellé d'un lien « Autre »", () => {
    assert.equal(refus(controlerLien(saisie({ fonction: "" }), contexte())), "Choisissez la fonction du mandat.");
    assert.equal(
      refus(controlerLien(saisie({ typeLien: "autre", libelle: "  " }), contexte({ cible: PERSONNE }))),
      "Précisez le libellé du lien.",
    );
  });

  it("n'écrit ni fonction ni libellé quand le type n'en a pas l'usage", () => {
    const resultat = controlerLien(
      saisie({ typeLien: "salarie", fonction: "gerant", libelle: "x" }),
      contexte({ cible: SOCIETE }),
    );
    assert.equal(resultat.ok, true);
    if (resultat.ok) {
      assert.equal(resultat.lien.fonction, null);
      assert.equal(resultat.lien.libelle, null);
    }
  });

  it("seul un mandat social représente la société", () => {
    assert.equal(
      refus(controlerLien(saisie({ typeLien: "salarie", representeSociete: true }), contexte())),
      "Seul un mandat social représente la société.",
    );
  });

  it("refuse une fin antérieure ou égale au début", () => {
    assert.equal(
      refus(controlerLien(saisie({ debut: "2024-01-01", fin: "2020-01-01" }), contexte())),
      "La fin doit être postérieure au début.",
    );
    assert.equal(
      refus(controlerLien(saisie({ debut: "2024-01-01", fin: "2024-01-01" }), contexte())),
      "La fin doit être postérieure au début.",
    );
    assert.equal(controlerLien(saisie({ debut: "2020-01-01", fin: "2024-01-02" }), contexte()).ok, true);
  });

  it("refuse une fin sans début", () => {
    assert.equal(
      refus(controlerLien(saisie({ fin: "2024-01-01" }), contexte())),
      "Indiquez la date de début pour poser une date de fin.",
    );
  });

  it("refuse une date qui n'est pas AAAA-MM-JJ ou qui n'existe pas", () => {
    assert.equal(
      refus(controlerLien(saisie({ debut: "1er mars 2020" }), contexte())),
      "La date de début doit être au format AAAA-MM-JJ.",
    );
    assert.equal(
      refus(controlerLien(saisie({ debut: "2020-01-01", fin: "2021-02-30" }), contexte())),
      "La date de fin doit être au format AAAA-MM-JJ.",
    );
    assert.equal(dateLienValide("2024-02-29"), true);
    assert.equal(dateLienValide("2023-02-29"), false);
    assert.equal(dateLienValide("2023-13-01"), false);
    assert.equal(dateLienValide("14/03/2023"), false);
  });

  it("refuse un second mandat en cours qui représente la société pour la même fonction", () => {
    const resultat = controlerLien(
      saisie({ representeSociete: true, debut: "2024-01-01" }),
      contexte({ liensExistants: [MANDAT] }),
    );
    assert.equal(refus(resultat), "Un mandat en cours représente déjà la société pour cette fonction.");
  });

  it("accepte un autre mandat représentant la société pour une autre fonction, ou terminé, ou sans représentation", () => {
    const base = contexte({ liensExistants: [MANDAT] });
    assert.equal(
      controlerLien(saisie({ representeSociete: true, fonction: "president" }), base).ok,
      true,
    );
    assert.equal(controlerLien(saisie({ representeSociete: false }), base).ok, true);
    assert.equal(
      controlerLien(saisie({ representeSociete: true }), contexte({ liensExistants: [{ ...MANDAT, fin: "2023-01-01" }] })).ok,
      true,
    );
    assert.equal(
      controlerLien(saisie({ representeSociete: true }), contexte({ liensExistants: [{ ...MANDAT, cibleId: "autre" }] })).ok,
      true,
    );
  });

  it("poser une fin au mandat qui représente la société ne se heurte pas à lui-même", () => {
    const actuel = saisieDepuisLien(MANDAT);
    const resultat = controlerLien(
      { ...actuel, fin: "2025-06-30" },
      contexte({ sourceId: "marie", liensExistants: [MANDAT], lienId: "l1" }),
    );
    assert.equal(resultat.ok, true);
  });

  it("une modification qui laisse le mandat en cours face à un autre refuse la représentation double", () => {
    const autre: LienAffiche = { ...MANDAT, id: "l2", sourceId: "paul" };
    const resultat = controlerLien(
      { ...saisieDepuisLien(MANDAT), debut: "2019-01-01" },
      contexte({ sourceId: "marie", liensExistants: [MANDAT, autre], lienId: "l1" }),
    );
    assert.equal(refus(resultat), "Un mandat en cours représente déjà la société pour cette fonction.");
  });
});

describe("modification d'un lien : champs changés", () => {
  it("ne retient que la fin posée", () => {
    const champs = champsModifies(MANDAT, { ...saisieDepuisLien(MANDAT), fin: "2025-06-30" });
    assert.deepEqual(champs, { fin: "2025-06-30" });
  });

  it("efface la fin par null et ne change rien sans écart", () => {
    const termine: LienAffiche = { ...MANDAT, fin: "2025-06-30" };
    assert.deepEqual(champsModifies(termine, { ...saisieDepuisLien(termine), fin: "" }), { fin: null });
    assert.deepEqual(champsModifies(MANDAT, saisieDepuisLien(MANDAT)), {});
  });

  it("n'envoie jamais le type, la fonction ni la représentation", () => {
    const champs = champsModifies(MANDAT, {
      ...saisieDepuisLien(MANDAT),
      typeLien: "salarie",
      fonction: "president",
      representeSociete: false,
      source: "Statuts",
    });
    assert.deepEqual(champs, { source: "Statuts" });
  });
});
