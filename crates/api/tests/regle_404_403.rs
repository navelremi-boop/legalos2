//! Règle de l'architecte du 20/10/2026, sur toute l'API : **404** pour une ressource que l'utilisateur ne doit pas voir
//! (autre cabinet, boîte d'un autre, dossier restreint), **403** seulement pour une ressource visible dont l'action
//! est interdite. Contrôle étendu le 22/10/2026 après le refus du contrôleur (le premier test ne surveillait que
//! `forbidden(` et passait à vide, alors que l'API répondait 401 ou 400) :
//!
//! 1. un `ApiError::forbidden(` doit être précédé d'un commentaire `// 403 :` qui dit pourquoi la ressource est
//!    visible ;
//! 2. un `ApiError::unauthorized(` (401) hors de l'authentification elle-même (`src/auth/`, `routes/auth.rs`) doit
//!    être précédé d'un commentaire `// 401 :` : un 401 dit « jeton invalide », jamais « ressource interdite » (le
//!    poste le lit comme une session expirée, et sa file d'envoi ne le tient pas pour un refus définitif) ;
//! 3. une ressource désignée par son identifiant et absente ne se dit jamais `bad_request("… introuvable")` : c'est
//!    un 404, le même que pour une ressource qu'on n'a pas le droit de voir.
//!
//! Règle vérifiable = règle outillée : ce test échoue sur chacun de ces cas, et prouve qu'il sait les voir.
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

/// Vrai si l'une des deux lignes qui précèdent la ligne d'index `index` commence par `marqueur`.
fn justifiee(lignes: &[&str], index: usize, marqueur: &str) -> bool {
    lignes[..index]
        .iter()
        .rev()
        .take(2)
        .any(|precedente| precedente.trim_start().starts_with(marqueur))
}

/// Numéros de ligne des appels (hors définition) qui ne portent pas le commentaire `marqueur`.
fn non_justifies(source: &str, appels: &[&str], marqueur: &str) -> Vec<usize> {
    let lignes: Vec<&str> = source.lines().collect();
    lignes
        .iter()
        .enumerate()
        .filter(|(i, ligne)| {
            let definition = ligne.contains("pub fn ");
            let appel = appels.iter().any(|a| ligne.contains(a));
            appel && !definition && !justifiee(&lignes, *i, marqueur)
        })
        .map(|(i, _)| i + 1)
        .collect()
}

/// Numéros de ligne des `bad_request("… introuvable …")`.
fn bad_request_introuvable(source: &str) -> Vec<usize> {
    source
        .lines()
        .enumerate()
        .filter(|(_, ligne)| {
            ligne.split("bad_request(\"").skip(1).any(|reste| {
                reste
                    .split('"')
                    .next()
                    .is_some_and(|message| message.contains("introuvable"))
            })
        })
        .map(|(i, _)| i + 1)
        .collect()
}

fn est_authentification(chemin: &str) -> bool {
    chemin.contains("/src/auth/") || chemin.ends_with("/src/routes/auth.rs")
}

fn sources() -> Vec<(String, String)> {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut fichiers = Vec::new();
    fichiers_rust(&racine, &mut fichiers);
    assert!(fichiers.len() > 20, "sources introuvables");
    fichiers
        .iter()
        .map(|f| {
            (
                f.to_string_lossy().replace('\\', "/"),
                fs::read_to_string(f).expect("lecture"),
            )
        })
        .collect()
}

#[test]
fn aucun_403_ne_designe_une_ressource_invisible() {
    let mut fautes = Vec::new();
    for (nom, source) in sources() {
        for numero in non_justifies(
            &source,
            &["ApiError::forbidden(", ".forbidden("],
            "// 403 :",
        ) {
            fautes.push(format!("{nom}:{numero}"));
        }
    }
    assert!(
        fautes.is_empty(),
        "403 sans justification (404 pour ce que l'utilisateur ne doit pas voir) :\n{}",
        fautes.join("\n")
    );
}

#[test]
fn aucun_401_ne_designe_une_ressource_interdite() {
    let mut fautes = Vec::new();
    let mut justifies = 0;
    for (nom, source) in sources() {
        if est_authentification(&nom) {
            continue;
        }
        justifies += source.matches("// 401 :").count();
        for numero in non_justifies(
            &source,
            &["ApiError::unauthorized(", ".unauthorized("],
            "// 401 :",
        ) {
            fautes.push(format!("{nom}:{numero}"));
        }
    }
    assert!(
        justifies >= 1,
        "le contrôle ne voit plus aucun 401 justifié : il ne prouve plus rien"
    );
    assert!(
        fautes.is_empty(),
        "401 hors authentification, sans justification (404 pour une ressource invisible) :\n{}",
        fautes.join("\n")
    );
}

#[test]
fn aucune_ressource_absente_ne_repond_400() {
    let mut fautes = Vec::new();
    for (nom, source) in sources() {
        for numero in bad_request_introuvable(&source) {
            fautes.push(format!("{nom}:{numero}"));
        }
    }
    assert!(
        fautes.is_empty(),
        "400 « introuvable » (c'est un 404, le même que pour une ressource invisible) :\n{}",
        fautes.join("\n")
    );
}

#[test]
fn le_controle_voit_chaque_faute() {
    let faux_401 =
        "fn f() {\n    return Err(ApiError::unauthorized(\"Dossier non autorisé\"));\n}\n";
    assert_eq!(
        non_justifies(faux_401, &["ApiError::unauthorized("], "// 401 :"),
        vec![2]
    );
    let juste_401 =
        "fn f() {\n    // 401 : jeton invalide\n    return Err(ApiError::unauthorized(\"x\"));\n}\n";
    assert!(non_justifies(juste_401, &["ApiError::unauthorized("], "// 401 :").is_empty());
    let faux_403 = "    Err(ApiError::forbidden(\"non\"))\n";
    assert_eq!(
        non_justifies(faux_403, &["ApiError::forbidden("], "// 403 :"),
        vec![1]
    );
    let definition = "    pub fn forbidden(message: impl Into<String>) -> Self {\n";
    assert!(non_justifies(
        definition,
        &["ApiError::forbidden(", ".forbidden("],
        "// 403 :"
    )
    .is_empty());
    let faux_400 = "    .ok_or_else(|| ApiError::bad_request(\"Facture introuvable\"))?;\n";
    assert_eq!(bad_request_introuvable(faux_400), vec![1]);
    let bon_400 = "    return Err(ApiError::bad_request(\"Clé d'idempotence requise\"));\n";
    assert!(bad_request_introuvable(bon_400).is_empty());
    assert!(est_authentification("/x/src/auth/service.rs"));
    assert!(!est_authentification("/x/src/routes/dossiers.rs"));
}
