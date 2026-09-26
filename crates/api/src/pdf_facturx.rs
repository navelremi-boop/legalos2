//! Génération PDF/A-3b Factur-X via le binaire Typst (hors processus async).
//! Typst n'est pas embarqué dans le code Rust : binaire hôte / image API (F7).

use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

pub struct DonneesPdf<'a> {
    pub cii_xml: &'a str,
    pub numero: i64,
    pub libelle: &'a str,
    pub ht_centimes: i64,
    pub tva_centimes: i64,
    pub ttc_centimes: i64,
}

/// Emplacements possibles du binaire Typst (env puis chemins usuels du dépôt / image).
pub fn chemin_typst() -> Option<PathBuf> {
    for cle in ["LEGALOS_TYPST", "TYPST"] {
        if let Ok(valeur) = std::env::var(cle) {
            let chemin = PathBuf::from(valeur);
            if chemin.is_file() {
                return Some(chemin);
            }
        }
    }
    let fixe = PathBuf::from("/usr/local/bin/typst");
    if fixe.is_file() {
        return Some(fixe);
    }
    Some(PathBuf::from("typst"))
}

fn euros(centimes: i64) -> String {
    let signe = if centimes < 0 { "-" } else { "" };
    let absolu = centimes.abs();
    format!("{signe}{},{:02}", absolu / 100, absolu % 100)
}

/// Compile un PDF/A-3b avec `factur-x.xml` joint (modèle Typst du crate).
pub fn generer_pdf_a3b(donnees: &DonneesPdf<'_>) -> Result<Vec<u8>, String> {
    let typst = chemin_typst().ok_or_else(|| {
        "binaire Typst introuvable (LEGALOS_TYPST / TYPST / /usr/local/bin/typst)".to_owned()
    })?;
    let dir = std::env::temp_dir().join(format!("legalos-facturx-{}", Uuid::now_v7()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("répertoire temporaire : {e}"))?;
    let resultat = generer_dans(&typst, &dir, donnees);
    let _ = std::fs::remove_dir_all(&dir);
    resultat
}

fn generer_dans(typst: &Path, dir: &Path, donnees: &DonneesPdf<'_>) -> Result<Vec<u8>, String> {
    let xml_path = dir.join("factur-x.xml");
    std::fs::write(&xml_path, donnees.cii_xml).map_err(|e| format!("écriture CII : {e}"))?;
    let mut modele = include_str!("../templates/facture.typ").to_owned();
    modele = modele.replace("NUMERO", &donnees.numero.to_string());
    modele = modele.replace("LIBELLE", &donnees.libelle.replace('"', "'"));
    modele = modele.replace("HT_EUR", &euros(donnees.ht_centimes));
    modele = modele.replace("TVA_EUR", &euros(donnees.tva_centimes));
    modele = modele.replace("TTC_EUR", &euros(donnees.ttc_centimes));
    let typ_path = dir.join("facture.typ");
    std::fs::write(&typ_path, modele).map_err(|e| format!("écriture Typst : {e}"))?;
    let pdf_path = dir.join("facture.pdf");
    let sortie = Command::new(typst)
        .arg("compile")
        .arg("--pdf-standard")
        .arg("a-3b")
        .arg(&typ_path)
        .arg(&pdf_path)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("exécution Typst : {e}"))?;
    if !sortie.status.success() {
        let err = String::from_utf8_lossy(&sortie.stderr);
        return Err(format!("Typst a échoué : {err}"));
    }
    std::fs::read(&pdf_path).map_err(|e| format!("lecture PDF : {e}"))
}

#[cfg(test)]
mod tests {
    use super::euros;

    #[test]
    fn euros_formate_les_centimes() {
        assert_eq!(euros(12_000), "120,00");
        assert_eq!(euros(-50), "-0,50");
    }
}
