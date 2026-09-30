//! Boîte nominative (§ 3.8.6 étape 3) : relève, IDLE, actions IMAP, recherche.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ReleveNominatif {
    pub chemin: String,
    pub resynchronisation: bool,
    pub ajoutes: usize,
    pub uid_validity: i64,
    pub dernier_uid: i64,
}

#[derive(Debug, Serialize)]
pub struct AttenteNominatif {
    pub notifie: bool,
    pub chemin: String,
}

#[derive(Debug, Deserialize)]
pub struct UidCorps {
    pub uid: u32,
    pub lu: Option<bool>,
    pub destination: Option<String>,
    pub drapeau: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActionNominatif {
    pub applique: bool,
    pub lu: bool,
}

#[derive(Debug, Deserialize)]
pub struct RechercheQuery {
    pub q: String,
}

#[derive(Debug, Serialize)]
pub struct Trouve {
    pub message_id: String,
    pub objet: String,
    pub texte: String,
}

#[derive(Debug, Deserialize)]
pub struct ContenuQuery {
    pub message_id: String,
}

#[derive(Debug, Serialize)]
pub struct Contenu {
    pub html: String,
    pub texte: String,
    pub lu: bool,
    pub uid: i64,
}

pub async fn relever_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<ReleveNominatif>, ApiError> {
    // Lecture seule. La synchronisation complète est le moteur, pas cette requête.
    let row = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        SELECT c.uid_validity, c.dernier_uid,
               (SELECT COUNT(*) FROM messages m WHERE m.compte_id = c.compte_id)
        FROM releve_curseurs c
        JOIN comptes_mail a ON a.id = c.compte_id
        WHERE a.cabinet_id = $1 AND a.titulaire_id = $2 AND c.dossier_imap = 'INBOX'
        ORDER BY c.dernier_uid DESC
        LIMIT 1
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture curseur"))?;
    let (uid_validity, dernier_uid, ajoutes) = row.unwrap_or((0, 0, 0));
    Ok(Json(ReleveNominatif {
        chemin: "moteur".into(),
        resynchronisation: false,
        ajoutes: usize::try_from(ajoutes).unwrap_or(0),
        uid_validity,
        dernier_uid,
    }))
}

pub async fn attendre_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(_claims): AuthAccess,
) -> Result<Json<AttenteNominatif>, ApiError> {
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let notifie = tokio::task::spawn_blocking(move || {
        crate::moteur_mail::attendre_idle(&imap, Duration::from_secs(12))
    })
    .await
    .map_err(|_| ApiError::internal("Veille interrompue"))?
    .map_err(|_| ApiError::internal("Veille IMAP"))?;
    Ok(Json(AttenteNominatif {
        notifie: notifie.0,
        chemin: notifie.1,
    }))
}

pub async fn marquer_lu(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let lu = corps.lu.unwrap_or(true);
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let uid = corps.uid;
    let resultat =
        tokio::task::spawn_blocking(move || crate::moteur_mail::marquer_lu_imap(&imap, uid, lu))
            .await
            .map_err(|_| ApiError::internal("Action interrompue"))?;
    match resultat {
        Ok(reel) => {
            let _ = sqlx::query(
                "UPDATE messages SET lu = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3 AND dossier_imap = 'INBOX'",
            )
            .bind(lu)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            Ok(Json(ActionNominatif {
                applique: true,
                lu: reel,
            }))
        }
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: !lu,
        })),
    }
}

pub async fn deplacer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let destination = corps
        .destination
        .filter(|d| !d.is_empty())
        .ok_or_else(|| ApiError::bad_request("Dossier de destination absent"))?;
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let uid = corps.uid;
    let dossier = destination.clone();
    let resultat = tokio::task::spawn_blocking(move || {
        crate::moteur_mail::deplacer_imap(&imap, uid, &dossier)
    })
    .await
    .map_err(|_| ApiError::internal("Action interrompue"))?;
    match resultat {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE messages SET dossier_imap = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3",
            )
            .bind(&destination)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            Ok(Json(ActionNominatif {
                applique: true,
                lu: false,
            }))
        }
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: false,
        })),
    }
}

pub async fn supprimer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let uid = corps.uid;
    let resultat =
        tokio::task::spawn_blocking(move || crate::moteur_mail::supprimer_imap(&imap, uid))
            .await
            .map_err(|_| ApiError::internal("Action interrompue"))?;
    match resultat {
        Ok(()) => {
            let _ = sqlx::query("DELETE FROM messages WHERE cabinet_id = $1 AND uid = $2 AND dossier_imap = 'INBOX'")
                .bind(claims.cabinet_id)
                .bind(i64::from(corps.uid))
                .execute(&state.pool)
                .await;
            Ok(Json(ActionNominatif {
                applique: true,
                lu: false,
            }))
        }
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: false,
        })),
    }
}

pub async fn poser_drapeau(
    State(state): State<Arc<AppState>>,
    AuthAccess(_claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let drapeau = corps
        .drapeau
        .filter(|d| !d.is_empty())
        .ok_or_else(|| ApiError::bad_request("Drapeau absent"))?;
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let uid = corps.uid;
    let nom = drapeau.clone();
    let resultat = tokio::task::spawn_blocking(move || {
        crate::moteur_mail::poser_drapeau_imap(&imap, uid, &nom)
    })
    .await
    .map_err(|_| ApiError::internal("Action interrompue"))?;
    Ok(Json(ActionNominatif {
        applique: resultat.is_ok(),
        lu: resultat.unwrap_or(false),
    }))
}

pub async fn rechercher(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(q): Query<RechercheQuery>,
) -> Result<Json<Vec<Trouve>>, ApiError> {
    if q.q.trim().is_empty() {
        return Err(ApiError::bad_request("Recherche vide"));
    }
    let rows = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT m.message_id, m.objet, c.texte_brut
        FROM contenus_messages c
        INNER JOIN messages m ON m.id = c.message_id_ref
        WHERE c.cabinet_id = $1
          AND c.texte_tsv @@ plainto_tsquery('french', $2)
        ORDER BY c.cree_le DESC
        LIMIT 20
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.q)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Recherche messages"))?;
    Ok(Json(
        rows.into_iter()
            .map(|r| Trouve {
                message_id: r.0,
                objet: r.1,
                texte: r.2,
            })
            .collect(),
    ))
}

pub async fn lire_contenu(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(q): Query<ContenuQuery>,
) -> Result<Json<Contenu>, ApiError> {
    let row = sqlx::query_as::<_, (String, String, bool, i64)>(
        r#"
        SELECT c.html_nettoye, c.texte_brut, m.lu, m.uid
        FROM contenus_messages c
        INNER JOIN messages m ON m.id = c.message_id_ref
        WHERE m.cabinet_id = $1 AND m.message_id = $2
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.message_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture contenu"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
    Ok(Json(Contenu {
        html: row.0,
        texte: row.1,
        lu: row.2,
        uid: row.3,
    }))
}
