//! Règle du 22/10/2026 (`src/verrous.rs`) : tout verrou consultatif de l'API passe par `crate::verrous`, une
//! fonction par texte SQL et un seul type de liaison par fonction. Aucun autre fichier de `src/` n'écrit
//! `pg_advisory_xact_lock` ; sinon deux appels au même texte SQL avec des types différents se heurtent dans le
//! cache de requêtes préparées de sqlx (500 « verrou dossier » du 22/10/2026).
//!
//! Règle vérifiable = règle outillée : ce contrôle tourne avec `cargo test` (CI, job rust).
#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

fn fichiers_rust(dossier: &Path, sortie: &mut Vec<PathBuf>) {
    for entree in fs::read_dir(dossier).expect("lecture du dossier") {
        let chemin = entree.expect("entrée").path();
        if chemin.is_dir() {
            fichiers_rust(&chemin, sortie);
        } else if chemin.extension().is_some_and(|e| e == "rs") {
            sortie.push(chemin);
        }
    }
}

/// Fichiers (hors `verrous.rs`) dont le texte contient un verrou consultatif.
fn hors_du_module(fichiers: &[(String, String)]) -> Vec<&str> {
    fichiers
        .iter()
        .filter(|(nom, texte)| {
            !nom.ends_with("verrous.rs") && texte.contains("pg_advisory_xact_lock")
        })
        .map(|(nom, _)| nom.as_str())
        .collect()
}

#[test]
fn aucun_verrou_consultatif_hors_du_module_verrous() {
    let mut chemins = Vec::new();
    fichiers_rust(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut chemins,
    );
    let fichiers: Vec<(String, String)> = chemins
        .iter()
        .map(|c| {
            (
                c.to_string_lossy().replace('\\', "/"),
                fs::read_to_string(c).expect("lecture du fichier"),
            )
        })
        .collect();
    assert!(fichiers.len() > 20, "les sources n'ont pas été lues");
    assert!(
        fichiers
            .iter()
            .any(|(nom, texte)| nom.ends_with("verrous.rs")
                && texte.contains("pg_advisory_xact_lock")),
        "le module verrous ne contient plus de verrou : le contrôle ne prouve plus rien"
    );
    let fautifs = hors_du_module(&fichiers);
    assert!(
        fautifs.is_empty(),
        "verrous consultatifs écrits hors de src/verrous.rs : {fautifs:?}"
    );
}

#[test]
fn le_controle_refuse_un_verrou_ecrit_ailleurs() {
    let fichiers = vec![
        (
            "src/verrous.rs".to_owned(),
            "pg_advisory_xact_lock".to_owned(),
        ),
        (
            "src/routes/autre.rs".to_owned(),
            "SELECT pg_advisory_xact_lock($1)".to_owned(),
        ),
        ("src/propre.rs".to_owned(), "SELECT 1".to_owned()),
    ];
    assert_eq!(hors_du_module(&fichiers), vec!["src/routes/autre.rs"]);
}
