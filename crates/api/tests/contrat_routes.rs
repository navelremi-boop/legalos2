//! Règle de l'architecte du 20/10/2026 : toute route de l'API figure dans le contrat OpenAPI, et le contrat ne
//! décrit aucune route qui n'existe pas. Le contrat est généré depuis le code (`#[utoipa::path]`) ; le routeur est
//! lu dans `src/routes/mod.rs`, seul endroit où les routes sont déclarées.
//!
//! Règle vérifiable = règle outillée : cette vérification tourne avec `cargo test` (CI, job rust).
#![allow(clippy::expect_used)]

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use legalos_api::openapi::ApiDoc;
use utoipa::OpenApi;

const METHODES: [&str; 5] = ["get", "post", "put", "patch", "delete"];

/// (MÉTHODE, chemin) de chaque `.route("chemin", get(h).post(h2)…)` du routeur.
fn routes_du_routeur(source: &str) -> BTreeSet<(String, String)> {
    let mut routes = BTreeSet::new();
    let octets = source.as_bytes();
    let mut position = 0;
    while let Some(trouve) = source[position..].find(".route(") {
        let debut = position + trouve + ".route(".len();
        position = debut;
        // Chemin : premier littéral entre guillemets.
        let Some(ouvrant) = source[debut..].find('"').map(|i| debut + i) else {
            break;
        };
        let Some(fermant) = source[ouvrant + 1..].find('"').map(|i| ouvrant + 1 + i) else {
            break;
        };
        let chemin = &source[ouvrant + 1..fermant];
        // Corps de l'appel : jusqu'à la parenthèse qui ferme `.route(`.
        let mut profondeur = 1_i32;
        let mut fin = fermant + 1;
        while fin < octets.len() && profondeur > 0 {
            match octets[fin] {
                b'(' => profondeur += 1,
                b')' => profondeur -= 1,
                _ => {}
            }
            fin += 1;
        }
        let corps = &source[fermant + 1..fin];
        for methode in METHODES {
            let motif = format!("{methode}(");
            let mut depart = 0;
            while let Some(i) = corps[depart..].find(&motif) {
                let absolu = depart + i;
                let precedent = corps[..absolu].chars().next_back();
                // Un vrai appel de méthode, pas la fin d'un autre mot (`budget(`, `target(`…).
                if precedent.map_or(true, |c| !(c.is_alphanumeric() || c == '_')) {
                    routes.insert((methode.to_uppercase(), chemin.to_owned()));
                }
                depart = absolu + motif.len();
            }
        }
    }
    routes
}

fn routes_du_contrat() -> BTreeSet<(String, String)> {
    let contrat = ApiDoc::openapi();
    let mut routes = BTreeSet::new();
    for (chemin, item) in &contrat.paths.paths {
        let operations = [
            ("GET", &item.get),
            ("POST", &item.post),
            ("PUT", &item.put),
            ("PATCH", &item.patch),
            ("DELETE", &item.delete),
        ];
        for (methode, operation) in operations {
            if operation.is_some() {
                routes.insert((methode.to_owned(), chemin.clone()));
            }
        }
    }
    routes
}

#[test]
fn toute_route_de_l_api_figure_au_contrat_et_reciproquement() {
    let source =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes/mod.rs"))
            .expect("routes/mod.rs");
    let routeur = routes_du_routeur(&source);
    assert!(
        routeur.len() > 50,
        "le routeur n'a pas été lu ({} routes)",
        routeur.len()
    );
    let contrat = routes_du_contrat();
    let absentes_du_contrat: Vec<String> = routeur
        .difference(&contrat)
        .map(|(m, c)| format!("{m} {c}"))
        .collect();
    let absentes_du_routeur: Vec<String> = contrat
        .difference(&routeur)
        .map(|(m, c)| format!("{m} {c}"))
        .collect();
    assert!(
        absentes_du_contrat.is_empty(),
        "routes absentes du contrat OpenAPI ({}) :\n{}",
        absentes_du_contrat.len(),
        absentes_du_contrat.join("\n")
    );
    assert!(
        absentes_du_routeur.is_empty(),
        "routes du contrat que le routeur ne sert pas :\n{}",
        absentes_du_routeur.join("\n")
    );
}

#[test]
fn le_controle_lit_les_routes_a_plusieurs_methodes() {
    let source = r#"
        .route("/a", get(h::lire).post(h::creer))
        .route("/b/{id}", patch(h::modifier).delete(h::supprimer))
        .route("/c", put(h::remplacer))
    "#;
    let lues = routes_du_routeur(source);
    let attendues: BTreeSet<(String, String)> = [
        ("GET", "/a"),
        ("POST", "/a"),
        ("PATCH", "/b/{id}"),
        ("DELETE", "/b/{id}"),
        ("PUT", "/c"),
    ]
    .into_iter()
    .map(|(m, c)| (m.to_owned(), c.to_owned()))
    .collect();
    assert_eq!(lues, attendues);
}
