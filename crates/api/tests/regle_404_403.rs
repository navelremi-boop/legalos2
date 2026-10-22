//! Règle de l'architecte du 20/10/2026, sur toute l'API : **404** pour une ressource que l'utilisateur ne doit pas voir
//! (autre cabinet, boîte d'un autre, dossier restreint), **403** seulement pour une ressource visible dont l'action
//! est interdite. Un 403 écrit à la main doit donc dire pourquoi la ressource est visible : le commentaire
//! `// 403 :` sur la ligne qui précède l'appel à `ApiError::forbidden(` porte cette justification.
//!
//! Règle vérifiable = règle outillée : ce test échoue sur tout `forbidden(` non justifié.
#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

fn fichiers_rust(dossier: &Path, sortie: &mut Vec<PathBuf>) {
    for entree in fs::read_dir(dossier).expect("dossier") {
        let chemin = entree.expect("entrée").path();
        if chemin.is_dir() {
            fichiers_rust(&chemin, sortie);
        } else if chemin.extension().is_some_and(|e| e == "rs") {
            sortie.push(chemin);
        }
    }
}

/// Lignes (fichier, numéro) qui appellent `forbidden(` sans le commentaire de justification juste avant.
fn forbidden_non_justifies(source: &str) -> Vec<usize> {
    let lignes: Vec<&str> = source.lines().collect();
    lignes
        .iter()
        .enumerate()
        .filter(|(i, ligne)| {
            let appel = ligne.contains("ApiError::forbidden(") || ligne.contains(".forbidden(");
            let definition = ligne.contains("pub fn forbidden(");
            appel
                && !definition
                && !lignes[..*i]
                    .iter()
                    .rev()
                    .take(2)
                    .any(|precedente| precedente.trim_start().starts_with("// 403 :"))
        })
        .map(|(i, _)| i + 1)
        .collect()
}

#[test]
fn aucun_403_ne_designe_une_ressource_invisible() {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut fichiers = Vec::new();
    fichiers_rust(&racine, &mut fichiers);
    assert!(!fichiers.is_empty(), "sources introuvables");
    let mut fautes = Vec::new();
    for fichier in fichiers {
        let source = fs::read_to_string(&fichier).expect("lecture");
        for numero in forbidden_non_justifies(&source) {
            fautes.push(format!("{}:{numero}", fichier.display()));
        }
    }
    assert!(
        fautes.is_empty(),
        "403 sans justification (404 pour ce que l'utilisateur ne doit pas voir) :\n{}",
        fautes.join("\n")
    );
}

#[test]
fn le_controle_voit_un_403_non_justifie_et_accepte_un_403_justifie() {
    let nu = "fn f() -> Result<(), ApiError> {\n    Err(ApiError::forbidden(\"x\"))\n}\n";
    assert_eq!(forbidden_non_justifies(nu), vec![2]);
    let justifie = "fn f() -> Result<(), ApiError> {\n    // 403 : le dossier est visible, l'action est réservée au titulaire.\n    Err(ApiError::forbidden(\"x\"))\n}\n";
    assert!(forbidden_non_justifies(justifie).is_empty());
}
