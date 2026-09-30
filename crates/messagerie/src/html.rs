//! Nettoyage HTML avant stockage (§ 3.8.2). Aucun contenu n'est journalisé.

use ammonia::Builder;
use std::sync::LazyLock;

static NETTOYEUR: LazyLock<Builder<'static>> = LazyLock::new(Builder::default);

/// HTML nettoyé (`ammonia`) prêt pour le stockage. Entrée vide → chaîne vide.
pub fn nettoyer_html(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    NETTOYEUR.clean(html).to_string()
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
}
