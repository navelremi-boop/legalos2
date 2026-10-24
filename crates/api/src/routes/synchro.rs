//! Boîte nominative (§ 3.8.6 étape 3) : relève, IDLE, actions IMAP, recherche.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

/// Boîte de classement du cabinet de l'utilisateur, à condition qu'il puisse la lire (règle unique de la base,
/// `compte_mail_lisible_par`, la même que celle de `/messagerie/comptes` et des actions). Sinon 404 « Boîte
/// introuvable », sans rien dire du cabinet ni de la boîte. Les routes `/messagerie/nominatif/*` qui agissent sur
/// le serveur IMAP de l'instance passent toutes par ce contrôle avant de toucher à IMAP.
async fn exiger_boite_classement(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<Uuid, ApiError> {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT c.id FROM comptes_mail c
        WHERE c.cabinet_id = $1 AND c.type_compte = 'classement' AND compte_mail_lisible_par(c.id, $2)
        ORDER BY c.cree_le ASC, c.id ASC
        LIMIT 1
        "#,
    )
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de la boîte de classement"))?
    .ok_or_else(|| ApiError::not_found("Boîte introuvable"))
}

/// Le message (UID de l'INBOX de la boîte de classement) doit exister et être lisible par l'utilisateur
/// (`message_lisible_par`, la règle de la base : un message classé dans un dossier restreint reste fermé à qui n'a pas
/// accès au dossier). Absent ou fermé : le même 404 « Message introuvable ».
async fn exiger_message_classement(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    uid: u32,
) -> Result<(), ApiError> {
    let lisible = sqlx::query_scalar::<_, Option<bool>>(
        r#"
        SELECT bool_and(message_lisible_par(m.compte_id, m.dossier_id, $3))
        FROM messages m
        JOIN comptes_mail c ON c.id = m.compte_id
        WHERE m.cabinet_id = $1 AND c.type_compte = 'classement'
          AND m.dossier_imap = 'INBOX' AND m.uid = $2
        "#,
    )
    .bind(cabinet_id)
    .bind(i64::from(uid))
    .bind(utilisateur_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du message"))?;
    if lisible == Some(true) {
        Ok(())
    } else {
        Err(ApiError::not_found("Message introuvable"))
    }
}

/// Une mise à jour SQL qui suit une action IMAP déjà faite ne change pas la réponse (le moteur resynchronise),
/// mais son échec n'est jamais avalé : il est journalisé, sans contenu.
fn journaliser_echec_sql(
    contexte: &str,
    resultat: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
) {
    if resultat.is_err() {
        tracing::warn!(
            action = contexte,
            "mise à jour SQL échouée après l'action IMAP ; le moteur resynchronisera"
        );
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ReleveNominatif {
    pub chemin: String,
    pub resynchronisation: bool,
    pub ajoutes: usize,
    pub uid_validity: i64,
    pub dernier_uid: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AttenteNominatif {
    pub notifie: bool,
    pub chemin: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UidCorps {
    pub uid: u32,
    pub lu: Option<bool>,
    pub destination: Option<String>,
    pub drapeau: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ActionNominatif {
    pub applique: bool,
    pub lu: bool,
}

#[derive(Debug, Deserialize)]
pub struct RechercheQuery {
    pub q: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Trouve {
    pub message_id: String,
    pub objet: String,
    pub texte: String,
}

#[derive(Debug, Deserialize)]
pub struct ContenuQuery {
    pub message_id: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Contenu {
    pub html: String,
    pub texte: String,
    pub lu: bool,
    pub uid: i64,
}

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/relever",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "État du curseur de relève de la boîte (lecture seule : la synchronisation est faite par le moteur)", body = ReleveNominatif),
    )
)]
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

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/attendre",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Résultat de la veille IMAP (douze secondes au plus)", body = AttenteNominatif),
        (status = 400, description = "Messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Le cabinet n'a pas de boîte de classement lisible par l'utilisateur, ou message absent ou fermé à l'utilisateur (dossier restreint hors accès), même réponse", body = crate::error::ApiErrorBody),
        (status = 500, description = "Veille IMAP interrompue ou refusée", body = crate::error::ApiErrorBody),
    )
)]
pub async fn attendre_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<AttenteNominatif>, ApiError> {
    exiger_boite_classement(&state, claims.cabinet_id, claims.sub).await?;
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

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/lu",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = UidCorps,
    responses(
        (status = 200, description = "Résultat de l'action ; `applique` est faux quand le serveur IMAP l'a refusée", body = ActionNominatif),
        (status = 400, description = "Messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Le cabinet n'a pas de boîte de classement lisible par l'utilisateur, ou message absent ou fermé à l'utilisateur (dossier restreint hors accès), même réponse", body = crate::error::ApiErrorBody),
        (status = 500, description = "Action interrompue", body = crate::error::ApiErrorBody),
    )
)]
pub async fn marquer_lu(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    exiger_boite_classement(&state, claims.cabinet_id, claims.sub).await?;
    exiger_message_classement(&state, claims.cabinet_id, claims.sub, corps.uid).await?;
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
            let maj = sqlx::query(
                "UPDATE messages SET lu = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3 AND dossier_imap = 'INBOX' AND compte_id IN (SELECT id FROM comptes_mail WHERE cabinet_id = $2 AND type_compte = 'classement')",
            )
            .bind(lu)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            journaliser_echec_sql("lu", maj);
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

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/deplacer",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = UidCorps,
    responses(
        (status = 200, description = "Résultat de l'action ; `applique` est faux quand le serveur IMAP l'a refusée", body = ActionNominatif),
        (status = 400, description = "Dossier de destination absent, ou messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Le cabinet n'a pas de boîte de classement lisible par l'utilisateur, ou message absent ou fermé à l'utilisateur (dossier restreint hors accès), même réponse", body = crate::error::ApiErrorBody),
        (status = 500, description = "Action interrompue", body = crate::error::ApiErrorBody),
    )
)]
pub async fn deplacer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    exiger_boite_classement(&state, claims.cabinet_id, claims.sub).await?;
    exiger_message_classement(&state, claims.cabinet_id, claims.sub, corps.uid).await?;
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
            let maj = sqlx::query(
                "UPDATE messages SET dossier_imap = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3 AND compte_id IN (SELECT id FROM comptes_mail WHERE cabinet_id = $2 AND type_compte = 'classement')",
            )
            .bind(&destination)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            journaliser_echec_sql("deplacer", maj);
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

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/supprimer",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = UidCorps,
    responses(
        (status = 200, description = "Résultat de l'action ; `applique` est faux quand le serveur IMAP l'a refusée", body = ActionNominatif),
        (status = 400, description = "Messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Le cabinet n'a pas de boîte de classement lisible par l'utilisateur, ou message absent ou fermé à l'utilisateur (dossier restreint hors accès), même réponse", body = crate::error::ApiErrorBody),
        (status = 500, description = "Action interrompue", body = crate::error::ApiErrorBody),
    )
)]
pub async fn supprimer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    exiger_boite_classement(&state, claims.cabinet_id, claims.sub).await?;
    exiger_message_classement(&state, claims.cabinet_id, claims.sub, corps.uid).await?;
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
            let maj = sqlx::query("DELETE FROM messages WHERE cabinet_id = $1 AND uid = $2 AND dossier_imap = 'INBOX' AND compte_id IN (SELECT id FROM comptes_mail WHERE cabinet_id = $1 AND type_compte = 'classement')")
                .bind(claims.cabinet_id)
                .bind(i64::from(corps.uid))
                .execute(&state.pool)
                .await;
            journaliser_echec_sql("supprimer", maj);
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

#[utoipa::path(
    post,
    path = "/messagerie/nominatif/drapeau",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = UidCorps,
    responses(
        (status = 200, description = "Résultat de l'action ; `applique` est faux quand le serveur IMAP l'a refusée", body = ActionNominatif),
        (status = 400, description = "Drapeau absent, ou messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Le cabinet n'a pas de boîte de classement lisible par l'utilisateur, ou message absent ou fermé à l'utilisateur (dossier restreint hors accès), même réponse", body = crate::error::ApiErrorBody),
        (status = 500, description = "Action interrompue", body = crate::error::ApiErrorBody),
    )
)]
pub async fn poser_drapeau(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    exiger_boite_classement(&state, claims.cabinet_id, claims.sub).await?;
    exiger_message_classement(&state, claims.cabinet_id, claims.sub, corps.uid).await?;
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

#[utoipa::path(
    get,
    path = "/messagerie/nominatif/recherche",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(
        ("q" = String, Query, description = "Mots cherchés dans le texte des messages déjà lus"),
    ),
    responses(
        (status = 200, description = "Vingt messages au plus, des plus récents aux plus anciens", body = Vec<Trouve>),
        (status = 400, description = "Recherche vide", body = crate::error::ApiErrorBody),
    )
)]
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
          AND compte_mail_lisible_par(m.compte_id, $3)
          AND c.texte_tsv @@ plainto_tsquery('french', $2)
        ORDER BY c.cree_le DESC
        LIMIT 20
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.q)
    .bind(claims.sub)
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

#[utoipa::path(
    get,
    path = "/messagerie/nominatif/contenu",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(
        ("message_id" = String, Query, description = "Identifiant de message (en-tête Message-ID)"),
    ),
    responses(
        (status = 200, description = "Contenu déjà conservé du message (HTML nettoyé et texte brut)", body = Contenu),
        (status = 404, description = "Message introuvable ou illisible pour l'utilisateur", body = crate::error::ApiErrorBody),
    )
)]
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
          AND compte_mail_lisible_par(m.compte_id, $3)
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.message_id)
    .bind(claims.sub)
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
