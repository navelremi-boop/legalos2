"""Produit la variante d'interface d'Atkinson Hyperlegible Next : zéro sans barre.

La police d'origine ne dessine qu'un zéro barré (aucune fonction OpenType ne le retire).
L'interface veut des zéros ordinaires, sauf dans les références (docs/design.md, § Chiffres).
Le contre-poinçon fendu par la barre (deux contours) est remplacé par un seul contour :
le contour extérieur du zéro, réduit pour occuper le même cadre que les deux moitiés,
recalculé pour chaque maître de l'axe de graisse.

Usage : python design/fonts/zero-sans-barre.py  (fontTools requis)
Licence : SIL OFL 1.1, sans nom réservé ; la variante porte un nom de famille distinct.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

DOSSIER = Path(__file__).resolve().parents[2] / "apps/poste/public/fonts/atkinson-hyperlegible-next"
SOURCE = DOSSIER / "AtkinsonHyperlegibleNext-Variable.ttf"
CIBLE = DOSSIER / "AtkinsonHyperlegibleNext-Interface-Variable.ttf"
FAMILLE = "Atkinson Hyperlegible Next Interface"


def cadre(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def contre_poincon(exterieur, contours_interieurs):
    """Contour extérieur ramené dans le cadre des contre-poinçons, sens inversé."""
    ex0, ey0, ex1, ey1 = cadre(exterieur)
    ix0, iy0, ix1, iy1 = cadre([p for c in contours_interieurs for p in c])
    sx = (ix1 - ix0) / (ex1 - ex0)
    sy = (iy1 - iy0) / (ey1 - ey0)
    points = [(ix0 + (x - ex0) * sx, iy0 + (y - ey0) * sy) for x, y in exterieur]
    return [points[0]] + points[:0:-1]


def main():
    police = TTFont(SOURCE)
    glyf = police["glyf"]
    glyphe = glyf["zero"]
    assert glyphe.numberOfContours == 3, "le zéro attendu a trois contours"
    fins = list(glyphe.endPtsOfContours)
    n_ext = fins[0] + 1
    n_tot = fins[-1] + 1
    drapeaux_ext = list(glyphe.flags[:n_ext])
    variations = police["gvar"].variations["zero"]

    def contours(coords):
        debut = 0
        sortie = []
        for fin in fins:
            sortie.append([tuple(coords[i]) for i in range(debut, fin + 1)])
            debut = fin + 1
        return sortie

    base = list(glyphe.coordinates)
    c_base = contours(base)
    nouveau_base = c_base[0] + contre_poincon(c_base[0], c_base[1:])

    # Chaque région de l'axe est seule active à son sommet : delta = maître - défaut.
    nouvelles = []
    for tv in variations:
        maitre = [(b[0] + d[0], b[1] + d[1]) for b, d in zip(base, tv.coordinates[:n_tot])]
        c_m = contours(maitre)
        nouveau_m = c_m[0] + contre_poincon(c_m[0], c_m[1:])
        deltas = [
            (round(m[0] - b[0]), round(m[1] - b[1])) for m, b in zip(nouveau_m, nouveau_base)
        ]
        tv.coordinates = deltas + list(tv.coordinates[n_tot:])
        nouvelles.append(tv)

    glyphe.coordinates = GlyphCoordinates([(round(x), round(y)) for x, y in nouveau_base])
    glyphe.endPtsOfContours = [n_ext - 1, 2 * n_ext - 1]
    glyphe.numberOfContours = 2
    drapeaux_int = [drapeaux_ext[0]] + drapeaux_ext[:0:-1]
    glyphe.flags = bytearray(drapeaux_ext + drapeaux_int)
    if hasattr(glyphe, "program"):
        from fontTools.ttLib.tables import ttProgram

        glyphe.program = ttProgram.Program()
        glyphe.program.fromBytecode(b"")
    glyphe.recalcBounds(glyf)
    police["gvar"].variations["zero"] = nouvelles

    for nom in police["name"].names:
        texte = nom.toUnicode()
        if nom.nameID in (1, 3, 4, 16, 21):
            nom.string = texte.replace("Atkinson Hyperlegible Next", FAMILLE)
        elif nom.nameID in (6, 20, 25):
            nom.string = texte.replace("AtkinsonHyperlegibleNext", FAMILLE.replace(" ", ""))
    police.save(CIBLE)
    print(f"écrit : {CIBLE.name}")


if __name__ == "__main__":
    main()
