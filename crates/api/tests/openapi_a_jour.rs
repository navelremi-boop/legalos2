//! D9 (consigne de l'architecte du 24/10/2026) : le contrat OpenAPI engagé dans le dépôt (`crates/api/openapi.json`)
//! est celui que produit le code. Les types TypeScript du poste sont générés depuis ce fichier ; sans ce contrôle, un
//! changement de route ou de schéma laisserait le client généré en retard sans que rien ne le signale.
//!
//! Règle vérifiable = règle outillée : cette vérification tourne avec `cargo test` (CI, job rust).
//! Régénérer : `LEGALOS_REGENERER_OPENAPI=1 cargo test -p legalos-api --test openapi_a_jour`, puis
//! `pnpm --filter @legal-os/poste gen:api`.
#![allow(clippy::expect_used)]

use std::fs;
use std::path::PathBuf;

use legalos_api::openapi::ApiDoc;
use utoipa::OpenApi;

/// Le contrat engagé (fins de ligne normalisées) est exactement celui du code.
fn contrat_a_jour(engage: &str, code: &str) -> bool {
    engage.replace("\r\n", "\n") == code
}

fn chemin_contrat() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("openapi.json")
}

/// Contrat produit par le code, en JSON indenté terminé par un retour à la ligne (LF).
fn contrat_du_code() -> String {
    let mut texte =
        serde_json::to_string_pretty(&ApiDoc::openapi()).expect("sérialisation du contrat");
    texte.push('\n');
    texte
}

#[test]
fn le_contrat_engage_est_celui_du_code() {
    let attendu = contrat_du_code();
    let chemin = chemin_contrat();
    if std::env::var_os("LEGALOS_REGENERER_OPENAPI").is_some() {
        fs::write(&chemin, &attendu).expect("écriture du contrat");
        return;
    }
    let engage = fs::read_to_string(&chemin)
        .expect("crates/api/openapi.json absent : LEGALOS_REGENERER_OPENAPI=1 cargo test -p legalos-api --test openapi_a_jour")
        .replace("\r\n", "\n");
    assert!(
        contrat_a_jour(&engage, &attendu),
        "crates/api/openapi.json n'est plus celui du code : LEGALOS_REGENERER_OPENAPI=1 cargo test -p legalos-api --test openapi_a_jour, puis pnpm --filter @legal-os/poste gen:api"
    );
}

/// Essai négatif : le contrôle voit un contrat engagé qui a pris du retard (route ou schéma retiré, champ renommé).
#[test]
fn un_contrat_en_retard_est_vu() {
    let code = contrat_du_code();
    assert!(
        contrat_a_jour(&code, &code),
        "contrôle positif : le contrat du code est à jour"
    );
    let sans_chemins = code.replacen("\"paths\"", "\"chemins\"", 1);
    assert!(!contrat_a_jour(&sans_chemins, &code));
    let tronque = &code[..code.len() - 2];
    assert!(!contrat_a_jour(tronque, &code));
    let sans_retour_final = code.trim_end().to_owned();
    assert!(!contrat_a_jour(&sans_retour_final, &code));
}
