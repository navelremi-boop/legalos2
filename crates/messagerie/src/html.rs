//! Nettoyage HTML avant stockage (§ 3.8.2). Aucun contenu n'est journalisé.

use ammonia::Builder;
use std::sync::LazyLock;

static NETTOYEUR: LazyLock<Builder<'static>> = LazyLock::new(|| {
    let mut nettoyeur = Builder::default();
    // Les images distantes ne sont pas conservées : le poste ne les chargerait pas.
    nettoyeur.rm_tags(["img", "picture", "source", "video", "audio", "svg"]);
    nettoyeur
});

/// HTML nettoyé (`ammonia`) prêt pour le stockage. Entrée vide → chaîne vide.
pub fn nettoyer_html(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    NETTOYEUR.clean(html).to_string()
}

/// Texte indexable à partir du HTML déjà nettoyé.
pub fn texte_depuis_html(html: &str) -> String {
    let mut brut = String::new();
    let mut balise = false;
    for car in html.chars() {
        match car {
            '<' => balise = true,
            '>' => {
                balise = false;
                brut.push(' ');
            }
            _ if !balise => brut.push(car),
            _ => {}
        }
    }
    brut.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::nettoyer_html;

    #[test]
    fn retire_les_scripts() {
        let sale = r#"<p>ok</p><script>alert(1)</script>"#;
        let propre = nettoyer_html(sale);
        assert!(propre.contains("ok"));
        assert!(!propre.to_ascii_lowercase().contains("script"));
    }

    #[test]
    fn conserve_le_texte_utile() {
        let html = "<p>Référence <strong>2026-001</strong></p>";
        let propre = nettoyer_html(html);
        assert!(propre.contains("2026-001"));
        assert!(propre.contains("Référence") || propre.contains("R&#"));
    }

    #[test]
    fn retire_les_images_distantes() {
        let sale = r#"<p>visible</p><img src="https://exemple.test/pixel.png">"#;
        let propre = nettoyer_html(sale);
        assert!(propre.contains("visible"));
        assert!(!propre.contains("exemple.test"));
        assert!(!propre.contains("<img"));
    }
}
