//! Agenda du dossier : audiences, rendez-vous, tâches et rappels (§ 4.2 n° 4).

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::conflits::{
    appliquer_champ_texte, cle_idempotence, noter_historique, reserver_idempotence,
    valider_base_revision, ContexteChamp,
};
use crate::error::ApiError;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;

const TYPES: &[&str] = &["audience", "rendez_vous", "tache"];

#[derive(Debug, Deserialize)]
pub struct CreerAgendaRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub type_element: String,
    pub titre: String,
    pub debut: String,
    pub rappel_le: Option<String>,
    pub origine_calcul: Option<String>,
    pub jours_calcul: Option<i32>,
    pub mois_calcul: Option<i32>,
    pub annees_calcul: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct AgendaResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub type_element: String,
    pub titre: String,
    pub debut: String,
    pub rappel_le: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Deserialize)]
pub struct RetirerAgendaRequest {
    pub idempotence_cle: String,
    pub confirmer: bool,
}

#[derive(Debug, Deserialize)]
pub struct PatchAgendaRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub titre: Option<String>,
    pub debut: Option<String>,
    pub rappel_le: Option<String>,
    pub origine_calcul: Option<String>,
}

pub async fn creer_element(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerAgendaRequest>,
) -> Result<Json<AgendaResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if !TYPES.contains(&body.type_element.as_str()) {
        return Err(ApiError::bad_request("Type d'agenda inconnu"));
    }
    let titre = body.titre.trim();
    let debut = body.debut.trim();
    if titre.is_empty() || debut.is_empty() {
        return Err(ApiError::bad_request("Titre et début requis"));
    }
    if !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    let rappel = body
        .rappel_le
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire(&state, claims.cabinet_id, body.id).await.map(Json);
    }
    let insere = sqlx::query(
        r#"
        INSERT INTO agenda_elements (
            id, cabinet_id, dossier_id, type_element, titre, debut, rappel_le,
            origine_calcul, jours_calcul, mois_calcul, annees_calcul,
            revision, visibilite, restreint
        )
        SELECT $1, $2, dossiers.id, $3, $4, $5, $6, $7, $8, $9, $10,
               1, dossiers.visibilite, dossiers.restreint
        FROM dossiers
        WHERE dossiers.id = $11 AND dossiers.cabinet_id = $2
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&body.type_element)
    .bind(titre)
    .bind(debut)
    .bind(rappel)
    .bind(body.origine_calcul.as_deref())
    .bind(body.jours_calcul)
    .bind(body.mois_calcul)
    .bind(body.annees_calcul)
    .bind(dossier_id)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création agenda"))?;
    if insere.rows_affected() != 1 {
        return Err(ApiError::bad_request("Élément d'agenda impossible"));
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire(&state, claims.cabinet_id, body.id).await.map(Json)
}

pub async fn patch_element(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(element_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchAgendaRequest>,
) -> Result<Json<AgendaResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire(&state, claims.cabinet_id, element_id).await.map(Json);
    }
    let courant = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<String>, i64)>(
        r#"
        SELECT dossier_id, titre, debut, rappel_le, origine_calcul, revision
        FROM agenda_elements
        WHERE id = $1 AND cabinet_id = $2
        FOR UPDATE
        "#,
    )
    .bind(element_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture agenda"))?
    .ok_or_else(|| ApiError::not_found("Élément d'agenda introuvable"))?;
    if !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, courant.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    valider_base_revision(body.base_revision, courant.5)?;
    let mut revision = courant.5;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: element_id,
        table_cible: "agenda_elements",
        dossier_id: Some(courant.0),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "titre",
        body.titre.as_deref(),
        &courant.1,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "debut",
        body.debut.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "rappel_le",
        body.rappel_le.as_deref(),
        courant.3.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "origine_calcul",
        body.origine_calcul.as_deref(),
        courant.4.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    let titre_f = body.titre.as_deref().unwrap_or(&courant.1);
    let debut_f = body.debut.as_deref().unwrap_or(&courant.2);
    let rappel_f = body.rappel_le.as_deref().or(courant.3.as_deref());
    let origine_f = body.origine_calcul.as_deref().or(courant.4.as_deref());
    if revision != courant.5 {
        sqlx::query(
            r#"
            UPDATE agenda_elements
            SET titre = $1, debut = $2, rappel_le = $3, origine_calcul = $4, revision = $5
            WHERE id = $6
            "#,
        )
        .bind(titre_f)
        .bind(debut_f)
        .bind(rappel_f.filter(|s| !s.is_empty()))
        .bind(origine_f.filter(|s| !s.is_empty()))
        .bind(revision)
        .bind(element_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour agenda"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire(&state, claims.cabinet_id, element_id).await.map(Json)
}

pub async fn retirer_element(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(element_id): axum::extract::Path<Uuid>,
    Json(body): Json<RetirerAgendaRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !body.confirmer {
        return Err(ApiError::bad_request("Confirmation requise"));
    }
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return Ok(Json(serde_json::json!({ "retire": false })));
    }
    let courant = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT dossier_id, titre
        FROM agenda_elements
        WHERE id = $1 AND cabinet_id = $2
        FOR UPDATE
        "#,
    )
    .bind(element_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture agenda"))?
    .ok_or_else(|| ApiError::not_found("Élément d'agenda introuvable"))?;
    if !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, courant.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: element_id,
            table_cible: "agenda_elements",
            dossier_id: Some(courant.0),
        },
        "supprime",
        &courant.1,
    )
    .await?;
    sqlx::query("DELETE FROM agenda_elements WHERE id = $1")
        .bind(element_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("retrait agenda"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(serde_json::json!({ "retire": true })))
}

async fn lire(
    state: &AppState,
    cabinet_id: Uuid,
    element_id: Uuid,
) -> Result<AgendaResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, Option<String>, i64)>(
        r#"
        SELECT dossier_id, type_element, titre, debut, rappel_le, revision
        FROM agenda_elements
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(element_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture agenda"))?
    .ok_or_else(|| ApiError::not_found("Élément d'agenda introuvable"))?;
    Ok(AgendaResponse {
        id: element_id,
        dossier_id: row.0,
        type_element: row.1,
        titre: row.2,
        debut: row.3,
        rappel_le: row.4,
        revision: row.5,
    })
}
