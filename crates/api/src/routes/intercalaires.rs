//! Intercalaires personnalisés (§ 7.4) : API, conflits par champ, retrait explicite.

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::conflits::{
    appliquer_champ_texte, cle_idempotence, reserver_idempotence, valider_base_revision,
    ContexteChamp,
};
use crate::error::ApiError;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;

const TYPES_ELEMENT: &[&str] = &["mail", "piece", "facture", "audience", "note"];

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerIntercalaireRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub nom: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IntercalaireResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchIntercalaireRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetirerIntercalaireRequest {
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RetirerIntercalaireResponse {
    pub id: Uuid,
    pub retire: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RattacherElementRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub type_element: String,
    pub element_id: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ElementIntercalaireResponse {
    pub id: Uuid,
    pub intercalaire_id: Uuid,
    pub dossier_id: Uuid,
    pub type_element: String,
    pub element_id: Uuid,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DetacherElementRequest {
    pub idempotence_cle: String,
}

#[utoipa::path(
    post,
    path = "/dossiers/{dossier_id}/intercalaires",
    tag = "intercalaires",
    security(("bearer_auth" = [])),
    request_body = CreerIntercalaireRequest,
    responses(
        (status = 200, description = "Intercalaire créé ou déjà présent", body = IntercalaireResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_intercalaire(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerIntercalaireRequest>,
) -> Result<Json<IntercalaireResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = texte_requis(&body.nom, "Nom d'intercalaire requis")?;
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }

    sqlx::query(
        r#"
        INSERT INTO intercalaires_personnalises (
            id, cabinet_id, dossier_id, nom, revision, visibilite, restreint
        )
        VALUES (
            $1, $2, $3, $4, 1,
            (SELECT visibilite FROM dossiers WHERE id = $3),
            (SELECT restreint FROM dossiers WHERE id = $3)
        )
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(dossier_id)
    .bind(&nom)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création intercalaire"))?;

    let revision = charger_revision_intercalaire(&state, claims.cabinet_id, body.id).await?;
    Ok(Json(IntercalaireResponse {
        id: body.id,
        dossier_id,
        nom,
        revision,
    }))
}

#[utoipa::path(
    patch,
    path = "/intercalaires/{intercalaire_id}",
    tag = "intercalaires",
    security(("bearer_auth" = [])),
    request_body = PatchIntercalaireRequest,
    responses(
        (status = 200, description = "Intercalaire mis à jour", body = IntercalaireResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Dossier non autorisé", body = crate::error::ApiErrorBody),
        (status = 404, description = "Intercalaire introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_intercalaire(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(intercalaire_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchIntercalaireRequest>,
) -> Result<Json<IntercalaireResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = champ_texte_optionnel(body.nom)?;
    if nom.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
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
        return charger_intercalaire(&state, claims.cabinet_id, claims.sub, intercalaire_id)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (Uuid, Uuid, String, i64)>(
        r#"
        SELECT cabinet_id, dossier_id, nom, revision
        FROM intercalaires_personnalises WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(intercalaire_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture intercalaire"))?
    .ok_or_else(|| ApiError::not_found("Intercalaire introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Intercalaire hors cabinet"));
    }
    if !dossier_visible_tx(&mut tx, claims.cabinet_id, claims.sub, courant.1).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    valider_base_revision(body.base_revision, courant.3)?;

    let mut revision = courant.3;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: intercalaire_id,
        table_cible: "intercalaires_personnalises",
        dossier_id: Some(courant.1),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "nom",
        nom.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;

    let nom_f = nom.as_deref().unwrap_or(&courant.2);
    if revision != courant.3 {
        sqlx::query(
            r#"UPDATE intercalaires_personnalises SET nom = $1, revision = $2 WHERE id = $3"#,
        )
        .bind(nom_f)
        .bind(revision)
        .bind(intercalaire_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour intercalaire"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(IntercalaireResponse {
        id: intercalaire_id,
        dossier_id: courant.1,
        nom: nom_f.to_owned(),
        revision,
    }))
}

#[utoipa::path(
    delete,
    path = "/intercalaires/{intercalaire_id}",
    tag = "intercalaires",
    security(("bearer_auth" = [])),
    request_body = RetirerIntercalaireRequest,
    responses(
        (status = 200, description = "Intercalaire retiré (éléments métier conservés)", body = RetirerIntercalaireResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Dossier non autorisé", body = crate::error::ApiErrorBody),
        (status = 404, description = "Intercalaire introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn retirer_intercalaire(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(intercalaire_id): axum::extract::Path<Uuid>,
    Json(body): Json<RetirerIntercalaireRequest>,
) -> Result<Json<RetirerIntercalaireResponse>, ApiError> {
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
        let existe = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM intercalaires_personnalises
                WHERE id = $1 AND cabinet_id = $2
            )
            "#,
        )
        .bind(intercalaire_id)
        .bind(claims.cabinet_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture intercalaire"))?;
        return Ok(Json(RetirerIntercalaireResponse {
            id: intercalaire_id,
            retire: !existe,
        }));
    }

    let courant = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT cabinet_id, dossier_id
        FROM intercalaires_personnalises WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(intercalaire_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture intercalaire"))?
    .ok_or_else(|| ApiError::not_found("Intercalaire introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Intercalaire hors cabinet"));
    }
    if !dossier_visible_tx(&mut tx, claims.cabinet_id, claims.sub, courant.1).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }

    // CASCADE sur intercalaire_elements uniquement — pas sur mails / pièces / factures.
    sqlx::query(r#"DELETE FROM intercalaires_personnalises WHERE id = $1"#)
        .bind(intercalaire_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("retrait intercalaire"))?;

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(RetirerIntercalaireResponse {
        id: intercalaire_id,
        retire: true,
    }))
}

#[utoipa::path(
    post,
    path = "/intercalaires/{intercalaire_id}/elements",
    tag = "intercalaires",
    security(("bearer_auth" = [])),
    request_body = RattacherElementRequest,
    responses(
        (status = 200, description = "Élément rattaché (reste dans le chrono)", body = ElementIntercalaireResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Intercalaire ou élément introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn rattacher_element(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(intercalaire_id): axum::extract::Path<Uuid>,
    Json(body): Json<RattacherElementRequest>,
) -> Result<Json<ElementIntercalaireResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if !TYPES_ELEMENT.contains(&body.type_element.as_str()) {
        return Err(ApiError::bad_request("Type d'élément inconnu"));
    }

    let intercalaire = sqlx::query_as::<_, (Uuid, Uuid, String, bool)>(
        r#"
        SELECT cabinet_id, dossier_id, visibilite, restreint
        FROM intercalaires_personnalises WHERE id = $1
        "#,
    )
    .bind(intercalaire_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture intercalaire"))?
    .ok_or_else(|| ApiError::not_found("Intercalaire introuvable"))?;

    if intercalaire.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Intercalaire hors cabinet"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, intercalaire.1).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }

    verifier_element_metier(
        &state,
        claims.cabinet_id,
        intercalaire.1,
        &body.type_element,
        body.element_id,
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO intercalaire_elements (
            id, intercalaire_id, dossier_id, type_element, element_id,
            revision, visibilite, restreint
        )
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(intercalaire_id)
    .bind(intercalaire.1)
    .bind(&body.type_element)
    .bind(body.element_id)
    .bind(&intercalaire.2)
    .bind(intercalaire.3)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("intercalaire_elements_unique") {
                return ApiError::conflict("Élément déjà rattaché à cet intercalaire");
            }
        }
        ApiError::internal("rattachement élément")
    })?;

    Ok(Json(ElementIntercalaireResponse {
        id: body.id,
        intercalaire_id,
        dossier_id: intercalaire.1,
        type_element: body.type_element,
        element_id: body.element_id,
        revision: 1,
    }))
}

#[utoipa::path(
    delete,
    path = "/intercalaire-elements/{element_lien_id}",
    tag = "intercalaires",
    security(("bearer_auth" = [])),
    request_body = DetacherElementRequest,
    responses(
        (status = 200, description = "Rattachement retiré (élément métier conservé)", body = RetirerIntercalaireResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Rattachement introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn detacher_element(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(element_lien_id): axum::extract::Path<Uuid>,
    Json(body): Json<DetacherElementRequest>,
) -> Result<Json<RetirerIntercalaireResponse>, ApiError> {
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
        return Ok(Json(RetirerIntercalaireResponse {
            id: element_lien_id,
            retire: true,
        }));
    }

    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT e.dossier_id, i.cabinet_id
        FROM intercalaire_elements e
        INNER JOIN intercalaires_personnalises i ON i.id = e.intercalaire_id
        WHERE e.id = $1
        FOR UPDATE OF e
        "#,
    )
    .bind(element_lien_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture rattachement"))?
    .ok_or_else(|| ApiError::not_found("Rattachement introuvable"))?;

    if row.1 != claims.cabinet_id {
        return Err(ApiError::forbidden("Rattachement hors cabinet"));
    }
    if !dossier_visible_tx(&mut tx, claims.cabinet_id, claims.sub, row.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }

    sqlx::query(r#"DELETE FROM intercalaire_elements WHERE id = $1"#)
        .bind(element_lien_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("détachement élément"))?;

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(RetirerIntercalaireResponse {
        id: element_lien_id,
        retire: true,
    }))
}

async fn verifier_element_metier(
    state: &AppState,
    cabinet_id: Uuid,
    dossier_id: Uuid,
    type_element: &str,
    element_id: Uuid,
) -> Result<(), ApiError> {
    let existe = match type_element {
        "piece" => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM documents
                    WHERE id = $1 AND cabinet_id = $2 AND dossier_id = $3
                )
                "#,
            )
            .bind(element_id)
            .bind(cabinet_id)
            .bind(dossier_id)
            .fetch_one(&state.pool)
            .await
        }
        "facture" => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM factures
                    WHERE id = $1 AND cabinet_id = $2 AND dossier_id = $3
                )
                "#,
            )
            .bind(element_id)
            .bind(cabinet_id)
            .bind(dossier_id)
            .fetch_one(&state.pool)
            .await
        }
        // mail / audience / note : tables métier pas encore livrées ; pas de FK.
        "mail" | "audience" | "note" => return Ok(()),
        _ => return Err(ApiError::bad_request("Type d'élément inconnu")),
    }
    .map_err(|_| ApiError::internal("vérification élément"))?;

    if !existe {
        return Err(ApiError::not_found("Élément introuvable dans ce dossier"));
    }
    Ok(())
}

async fn charger_intercalaire(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    intercalaire_id: Uuid,
) -> Result<IntercalaireResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, i64)>(
        r#"
        SELECT dossier_id, nom, revision
        FROM intercalaires_personnalises
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(intercalaire_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture intercalaire"))?
    .ok_or_else(|| ApiError::not_found("Intercalaire introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, row.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    Ok(IntercalaireResponse {
        id: intercalaire_id,
        dossier_id: row.0,
        nom: row.1,
        revision: row.2,
    })
}

async fn charger_revision_intercalaire(
    state: &AppState,
    cabinet_id: Uuid,
    intercalaire_id: Uuid,
) -> Result<i64, ApiError> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT revision FROM intercalaires_personnalises
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(intercalaire_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture intercalaire"))?
    .ok_or_else(|| ApiError::not_found("Intercalaire introuvable"))
}

async fn dossier_visible_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    dossier_id: Uuid,
) -> Result<bool, ApiError> {
    let row = sqlx::query_as::<_, (bool,)>(
        r#"
        SELECT (
            d.cabinet_id = $2
            AND (
                d.restreint = FALSE
                OR EXISTS (
                    SELECT 1 FROM dossier_acces a
                    WHERE a.dossier_id = d.id AND a.utilisateur_id = $3
                )
            )
        )
        FROM dossiers d
        WHERE d.id = $1
        "#,
    )
    .bind(dossier_id)
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture droit dossier"))?;
    Ok(row.is_some_and(|v| v.0))
}

fn champ_texte_optionnel(valeur: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(valeur) = valeur else {
        return Ok(None);
    };
    let valeur = valeur.trim().to_owned();
    if valeur.is_empty() {
        return Err(ApiError::bad_request("Champ vide"));
    }
    Ok(Some(valeur))
}

fn texte_requis(valeur: &str, message: &str) -> Result<String, ApiError> {
    let texte = valeur.trim();
    if texte.is_empty() {
        return Err(ApiError::bad_request(message));
    }
    Ok(texte.to_owned())
}
