//! CORS : `tauri://localhost` toujours ; Vite `:1420` seulement en développement.
//! Exercice réel de la couche (requête OPTIONS), sans Postgres.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::Router;
use legalos_api::couche_cors_selon_developpement;
use tower::ServiceExt;

fn routeur_cors(developpement: bool) -> Router {
    Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .layer(couche_cors_selon_developpement(developpement))
}

async fn preflight(app: Router, origin: &str) -> Option<String> {
    let reponse = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/health")
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "GET")
                .body(Body::empty())
                .expect("requête"),
        )
        .await
        .expect("oneshot");
    reponse
        .headers()
        .get("access-control-allow-origin")
        .map(|v| v.to_str().expect("acao utf-8").to_owned())
}

#[tokio::test]
async fn developpement_autorise_vite_et_tauri() {
    let app = routeur_cors(true);
    assert_eq!(
        preflight(app.clone(), "http://localhost:1420")
            .await
            .as_deref(),
        Some("http://localhost:1420")
    );
    assert_eq!(
        preflight(app.clone(), "http://127.0.0.1:1420")
            .await
            .as_deref(),
        Some("http://127.0.0.1:1420")
    );
    assert_eq!(
        preflight(app.clone(), "tauri://localhost").await.as_deref(),
        Some("tauri://localhost")
    );
    assert_eq!(
        preflight(app, "http://tauri.localhost").await.as_deref(),
        Some("http://tauri.localhost")
    );
}

#[tokio::test]
async fn hors_developpement_refuse_vite_autorise_tauri() {
    let app = routeur_cors(false);
    assert_eq!(
        preflight(app.clone(), "http://localhost:1420").await,
        None,
        "localhost:1420 ne doit pas recevoir d'en-tête CORS hors développement"
    );
    assert_eq!(
        preflight(app.clone(), "http://127.0.0.1:1420").await,
        None,
        "127.0.0.1:1420 ne doit pas recevoir d'en-tête CORS hors développement"
    );
    assert_eq!(
        preflight(app.clone(), "tauri://localhost").await.as_deref(),
        Some("tauri://localhost")
    );
    assert_eq!(
        preflight(app.clone(), "https://tauri.localhost")
            .await
            .as_deref(),
        Some("https://tauri.localhost")
    );
    assert_eq!(
        preflight(app, "http://asset.localhost").await.as_deref(),
        Some("http://asset.localhost")
    );
}
