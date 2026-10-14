import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adresseValide,
  ajouterDestinataires,
  contientCaractereDeControle,
  depuisLignes,
  formeEnTete,
  lireSaisie,
  retirerDestinataire,
  versLignes,
} from "./adressesRedaction.ts";
import {
  fusionnerSuggestions,
  suggestionsLocales,
  toucheValideSaisie,
} from "./completion.ts";

describe("adresses de rédaction : lecture d'une saisie", () => {
  it("une adresse seule, avec ou sans nom", () => {
    assert.deepEqual(lireSaisie("a.perrin@perrin-avocats.example").destinataires, [
      { adresse: "a.perrin@perrin-avocats.example", nom: "" },
    ]);
    assert.deepEqual(lireSaisie("Me Anne Perrin <a.perrin@perrin-avocats.example>").destinataires, [
      { adresse: "a.perrin@perrin-avocats.example", nom: "Me Anne Perrin" },
    ]);
  });

  it("une liste collée : virgules, points-virgules et retours à la ligne", () => {
    const lecture = lireSaisie("a@x.example, Me B <b@x.example>;\nc@x.example");
    assert.deepEqual(
      lecture.destinataires.map((d) => d.adresse),
      ["a@x.example", "b@x.example", "c@x.example"],
    );
    assert.deepEqual(lecture.invalides, []);
  });

  it("une virgule dans un nom entre guillemets ne coupe pas l'adresse", () => {
    const lecture = lireSaisie('"Greffe, CA Lyon" <greffe@justice.example>');
    assert.equal(lecture.destinataires.length, 1);
    assert.equal(lecture.destinataires[0]?.adresse, "greffe@justice.example");
  });

  it("essai négatif : ce qui n'est pas une adresse est rendu à part, jamais ajouté", () => {
    const lecture = lireSaisie("Anne, a@x.example, pas une adresse@, @x.example");
    assert.deepEqual(
      lecture.destinataires.map((d) => d.adresse),
      ["a@x.example"],
    );
    assert.equal(lecture.invalides.length, 3);
  });

  it("une adresse valable ne contient ni espace, ni chevron, ni guillemet, ni contrôle", () => {
    assert.equal(adresseValide("a@x.example"), true);
    assert.equal(adresseValide("a b@x.example"), false);
    assert.equal(adresseValide("a@x"), false);
    assert.equal(adresseValide('a"b@x.example'), false);
    assert.equal(adresseValide("a@x.example\nBcc: autre@x.example"), false);
    assert.equal(contientCaractereDeControle("a\r\nb"), true);
    assert.equal(contientCaractereDeControle("ab"), false);
  });

  it("essai négatif : un retour à la ligne glissé dans un nom ne survit pas dans l'en-tête", () => {
    const forme = formeEnTete({ adresse: "a@x.example", nom: "Anne\r\nBcc: autre@x.example" });
    assert.equal(/[\r\n]/u.test(forme), false);
    assert.equal(forme.startsWith("Anne Bcc: autre@x.example <a@x.example>"), true);
  });
});

describe("adresses de rédaction : liste du champ", () => {
  it("l'ajout ne crée pas de doublon, sans tenir compte de la casse, et garde le premier nom connu", () => {
    const liste = ajouterDestinataires(
      [{ adresse: "A@x.example", nom: "" }],
      [
        { adresse: "a@x.example", nom: "Anne" },
        { adresse: "b@x.example", nom: "" },
      ],
    );
    assert.equal(liste.length, 2);
    assert.equal(liste[0]?.nom, "Anne");
  });

  it("retirer une adresse ne touche pas les autres", () => {
    const liste = retirerDestinataire(
      [
        { adresse: "a@x.example", nom: "" },
        { adresse: "b@x.example", nom: "" },
      ],
      "A@X.example",
    );
    assert.deepEqual(liste, [{ adresse: "b@x.example", nom: "" }]);
  });

  it("aller-retour avec les lignes du brouillon (une adresse par ligne)", () => {
    const liste = [
      { adresse: "a@x.example", nom: "Me Anne Perrin" },
      { adresse: "b@x.example", nom: "" },
    ];
    const lignes = versLignes(liste);
    assert.deepEqual(lignes, ["Me Anne Perrin <a@x.example>", "b@x.example"]);
    assert.deepEqual(depuisLignes(lignes.join("\n")), liste);
    assert.deepEqual(depuisLignes(null), []);
    assert.deepEqual(depuisLignes("\n\n"), []);
  });
});

describe("complétion des destinataires", () => {
  const mails = [
    { expediteur: "Me Anne Perrin <a.perrin@perrin-avocats.example>", destinataires_texte: "moi@cabinet.example", cree_le: "2026-10-08T10:00:00Z" },
    { expediteur: "Greffe <greffe@justice.example>", destinataires_texte: "moi@cabinet.example, Anne Perrin <a.perrin@perrin-avocats.example>", cree_le: "2026-10-09T10:00:00Z" },
  ];

  it("hors ligne, les adresses des mails de la base locale prennent le relais, sans les adresses du cabinet", () => {
    const trouvees = suggestionsLocales("perrin", mails, ["moi@cabinet.example"]);
    assert.deepEqual(
      trouvees.map((s) => s.adresse),
      ["a.perrin@perrin-avocats.example"],
    );
    // Le nom retenu est celui du mail le plus récent.
    assert.equal(trouvees[0]?.nom, "Anne Perrin");
    assert.deepEqual(suggestionsLocales("cabinet", mails, ["moi@cabinet.example"]), []);
  });

  it("essai négatif : moins de deux caractères ne propose rien", () => {
    assert.deepEqual(suggestionsLocales("p", mails, []), []);
  });

  it("la fusion met l'API d'abord, retire les doublons et les adresses déjà présentes, et plafonne à huit", () => {
    const api = [{ adresse: "a@x.example", nom: "Annuaire", source: "annuaire" }];
    const locales = [
      { adresse: "A@x.example", nom: "", source: "recu" },
      { adresse: "deja@x.example", nom: "", source: "recu" },
      ...Array.from({ length: 12 }, (_, i) => ({ adresse: `n${String(i)}@x.example`, nom: "", source: "recu" })),
    ];
    const fusion = fusionnerSuggestions(api, locales, [{ adresse: "DEJA@x.example", nom: "" }]);
    assert.equal(fusion[0]?.source, "annuaire");
    assert.equal(fusion.filter((s) => s.adresse.toLowerCase() === "a@x.example").length, 1);
    assert.equal(fusion.some((s) => s.adresse === "deja@x.example"), false);
    assert.equal(fusion.length, 8);
  });

  it("Entrée, Tab, virgule et point-virgule valident une saisie non vide ; rien ne valide une saisie vide", () => {
    for (const touche of ["Enter", "Tab", ",", ";"]) assert.equal(toucheValideSaisie(touche, "a@x.example"), true);
    assert.equal(toucheValideSaisie("Enter", "  "), false);
    assert.equal(toucheValideSaisie("a", "a@x.example"), false);
    assert.equal(toucheValideSaisie(" ", "a@x.example"), true);
    assert.equal(toucheValideSaisie(" ", "Anne"), false);
  });
});
