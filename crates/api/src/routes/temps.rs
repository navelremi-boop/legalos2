use crate::auth::access::AuthAccess;
use crate::conflits::{
    appliquer_champ_i32, appliquer_champ_i64, appliquer_champ_texte, cle_idempotence,
    reserver_idempotence, valider_base_revision, ContexteChamp,
};
use crate::error::ApiError;
use crate::facturation::ht_temps_centimes;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerTempsRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub minutes: i32,
    pub libelle: String,
    pub taux_centimes_heure: i64,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct TempsResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub minutes: i32,
    pub ht_centimes: i64,
    pub taux_centimes_heure: i64,
    pub revision: i64,
}
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerBrouillonTempsRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub temps_id: Uuid,
    pub libelle: String,
    pub ht_centimes: i64,
    pub taux_centimes_heure: i64,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct BrouillonTempsResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub numero: Option<i64>,
    pub ht_centimes: i64,
    pub revision: i64,
}
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerTauxRequest {
    pub id: Uuid,
    pub centimes_par_heure: i64,
    pub dossier_id: Option<Uuid>,
    pub client_partie_id: Option<Uuid>,
    pub intervenant_id: Option<Uuid>,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct TauxResponse {
    pub id: Uuid,
    pub centimes_par_heure: i64,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchTempsRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub minutes: Option<i32>,
    pub libelle: Option<String>,
    pub taux_centimes_heure: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchBrouillonRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub libelle: Option<String>,
    pub taux_centimes_heure: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchTauxRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub centimes_par_heure: Option<i64>,
}

#[utoipa::path(post, path = "/temps", tag = "factures", security(("bearer_auth" = [])), request_body = CreerTempsRequest, responses((status = 200, body = TempsResponse)))]
pub async fn creer_temps(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerTempsRequest>,
) -> Result<Json<TempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = texte_requis(&body.libelle, "Libellé requis")?;
    let ht = ht_temps_centimes(body.minutes, body.taux_centimes_heure)
        .ok_or_else(|| ApiError::bad_request("Minutes ou taux invalides"))?;
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
    let meta = meta_dossier(&state, body.dossier_id).await?;
    sqlx::query(
        r#"
        INSERT INTO temps_saisis (
            id, cabinet_id, dossier_id, intervenant_id, minutes, libelle,
            taux_centimes_heure, ht_centimes, visibilite, dossier_texte, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.dossier_id)
    .bind(claims.sub)
    .bind(body.minutes)
    .bind(&libelle)
    .bind(body.taux_centimes_heure)
    .bind(ht)
    .bind(&meta.0)
    .bind(&meta.1)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création temps"))?;
    let revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM temps_saisis WHERE id = $1")
        .bind(body.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture temps"))?;
    Ok(Json(TempsResponse {
        id: body.id,
        dossier_id: body.dossier_id,
        minutes: body.minutes,
        ht_centimes: ht,
        taux_centimes_heure: body.taux_centimes_heure,
        revision,
    }))
}

#[utoipa::path(post, path = "/brouillons-facture", tag = "factures", security(("bearer_auth" = [])), request_body = CreerBrouillonTempsRequest, responses((status = 200, body = BrouillonTempsResponse)))]
pub async fn creer_brouillon_temps(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerBrouillonTempsRequest>,
) -> Result<Json<BrouillonTempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = texte_requis(&body.libelle, "Libellé requis")?;
    if body.ht_centimes <= 0 || body.taux_centimes_heure <= 0 {
        return Err(ApiError::bad_request("Montant ou taux invalides"));
    }
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
    let meta = meta_dossier(&state, body.dossier_id).await?;
    sqlx::query(
        r#"
        INSERT INTO brouillons_facture (
            id, cabinet_id, dossier_id, temps_id, numero, ht_centimes, libelle,
            intervenant_id, taux_centimes_heure, visibilite, dossier_texte, revision
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, 1)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.dossier_id)
    .bind(body.temps_id)
    .bind(body.ht_centimes)
    .bind(&libelle)
    .bind(claims.sub)
    .bind(body.taux_centimes_heure)
    .bind(&meta.0)
    .bind(&meta.1)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création brouillon"))?;
    let row = sqlx::query_as::<_, (Option<i64>, i64)>(
        "SELECT numero, revision FROM brouillons_facture WHERE id = $1",
    )
    .bind(body.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture brouillon"))?;
    Ok(Json(BrouillonTempsResponse {
        id: body.id,
        dossier_id: body.dossier_id,
        numero: row.0,
        ht_centimes: body.ht_centimes,
        revision: row.1,
    }))
}

#[utoipa::path(post, path = "/taux-horaires", tag = "factures", security(("bearer_auth" = [])), request_body = CreerTauxRequest, responses((status = 200, body = TauxResponse)))]
pub async fn creer_taux(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerTauxRequest>,
) -> Result<Json<TauxResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.centimes_par_heure <= 0 {
        return Err(ApiError::bad_request("Taux invalide"));
    }
    let (visibilite, dossier_texte) = if let Some(dossier_id) = body.dossier_id {
        exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, dossier_id).await?;
        let meta = meta_dossier(&state, dossier_id).await?;
        (meta.0, Some(meta.1))
    } else {
        ("public".to_owned(), None)
    };
    sqlx::query(
        r#"
        INSERT INTO taux_horaires (
            id, cabinet_id, client_partie_id, dossier_id, intervenant_id,
            centimes_par_heure, visibilite, dossier_texte, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.client_partie_id)
    .bind(body.dossier_id)
    .bind(body.intervenant_id)
    .bind(body.centimes_par_heure)
    .bind(&visibilite)
    .bind(dossier_texte)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création taux"))?;
    let revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM taux_horaires WHERE id = $1")
        .bind(body.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture taux"))?;
    Ok(Json(TauxResponse {
        id: body.id,
        centimes_par_heure: body.centimes_par_heure,
        revision,
    }))
}

#[utoipa::path(patch, path = "/temps/{temps_id}", tag = "factures", security(("bearer_auth" = [])), request_body = PatchTempsRequest, responses((status = 200, body = TempsResponse)))]
pub async fn patch_temps(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(temps_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchTempsRequest>,
) -> Result<Json<TempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = champ_texte_optionnel(body.libelle)?;
    if body.minutes.is_none() && libelle.is_none() && body.taux_centimes_heure.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }
    if let Some(m) = body.minutes {
        if m <= 0 {
            return Err(ApiError::bad_request("Minutes invalides"));
        }
    }
    if let Some(t) = body.taux_centimes_heure {
        if t <= 0 {
            return Err(ApiError::bad_request("Taux invalide"));
        }
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
        return charger_temps(&state, claims.cabinet_id, claims.sub, temps_id)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (Uuid, Uuid, i32, String, i64, i64, i64)>(
        r#"
        SELECT cabinet_id, dossier_id, minutes, libelle, taux_centimes_heure, ht_centimes, revision
        FROM temps_saisis WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(temps_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture temps"))?
    .ok_or_else(|| ApiError::not_found("Temps introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Temps hors cabinet"));
    }
    if !dossier_autorise_tx(&mut tx, claims.cabinet_id, claims.sub, courant.1).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }

    let immuable = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM brouillons_facture
            WHERE temps_id = $1 AND numero IS NOT NULL
        )
        "#,
    )
    .bind(temps_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("immuabilité temps"))?;
    if immuable {
        return Err(ApiError::conflict(
            "Ce temps est référencé par un brouillon numéroté et ne peut plus être modifié.",
        ));
    }

    valider_base_revision(body.base_revision, courant.6)?;

    let mut revision = courant.6;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: temps_id,
        table_cible: "temps_saisis",
        dossier_id: Some(courant.1),
    };
    appliquer_champ_i32(
        &mut tx,
        &contexte,
        "minutes",
        body.minutes,
        courant.2,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "libelle",
        libelle.as_deref(),
        &courant.3,
        &mut revision,
    )
    .await?;
    appliquer_champ_i64(
        &mut tx,
        &contexte,
        "taux_centimes_heure",
        body.taux_centimes_heure,
        courant.4,
        &mut revision,
    )
    .await?;

    let minutes_f = body.minutes.unwrap_or(courant.2);
    let libelle_f = libelle.as_deref().unwrap_or(&courant.3);
    let taux_f = body.taux_centimes_heure.unwrap_or(courant.4);
    let ht = ht_temps_centimes(minutes_f, taux_f)
        .ok_or_else(|| ApiError::bad_request("Minutes ou taux invalides"))?;

    if revision != courant.6 {
        sqlx::query(
            r#"
            UPDATE temps_saisis
            SET minutes = $1, libelle = $2, taux_centimes_heure = $3, ht_centimes = $4, revision = $5
            WHERE id = $6
            "#,
        )
        .bind(minutes_f)
        .bind(libelle_f)
        .bind(taux_f)
        .bind(ht)
        .bind(revision)
        .bind(temps_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour temps"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(TempsResponse {
        id: temps_id,
        dossier_id: courant.1,
        minutes: minutes_f,
        ht_centimes: ht,
        taux_centimes_heure: taux_f,
        revision,
    }))
}

#[utoipa::path(patch, path = "/brouillons-facture/{brouillon_id}", tag = "factures", security(("bearer_auth" = [])), request_body = PatchBrouillonRequest, responses((status = 200, body = BrouillonTempsResponse)))]
pub async fn patch_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(brouillon_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchBrouillonRequest>,
) -> Result<Json<BrouillonTempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = champ_texte_optionnel(body.libelle)?;
    if libelle.is_none() && body.taux_centimes_heure.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }
    if let Some(t) = body.taux_centimes_heure {
        if t <= 0 {
            return Err(ApiError::bad_request("Taux invalide"));
        }
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
        return charger_brouillon(&state, claims.cabinet_id, claims.sub, brouillon_id)
            .await
            .map(Json);
    }

    let courant =
        sqlx::query_as::<_, (Uuid, Uuid, Option<Uuid>, Option<i64>, i64, String, i64, i64)>(
            r#"
        SELECT cabinet_id, dossier_id, temps_id, numero, ht_centimes, libelle,
               taux_centimes_heure, revision
        FROM brouillons_facture WHERE id = $1 FOR UPDATE
        "#,
        )
        .bind(brouillon_id)
        .fetch_optional(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("lecture brouillon"))?
        .ok_or_else(|| ApiError::not_found("Brouillon introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Brouillon hors cabinet"));
    }
    if !dossier_autorise_tx(&mut tx, claims.cabinet_id, claims.sub, courant.1).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    if courant.3.is_some() {
        return Err(ApiError::conflict(
            "Ce brouillon est numéroté et ne peut plus être modifié.",
        ));
    }
    valider_base_revision(body.base_revision, courant.7)?;

    let mut revision = courant.7;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: brouillon_id,
        table_cible: "brouillons_facture",
        dossier_id: Some(courant.1),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "libelle",
        libelle.as_deref(),
        &courant.5,
        &mut revision,
    )
    .await?;
    appliquer_champ_i64(
        &mut tx,
        &contexte,
        "taux_centimes_heure",
        body.taux_centimes_heure,
        courant.6,
        &mut revision,
    )
    .await?;

    let libelle_f = libelle.as_deref().unwrap_or(&courant.5);
    let taux_f = body.taux_centimes_heure.unwrap_or(courant.6);
    let ht = if let Some(temps_id) = courant.2 {
        let minutes =
            sqlx::query_scalar::<_, i32>("SELECT minutes FROM temps_saisis WHERE id = $1")
                .bind(temps_id)
                .fetch_optional(
                    tx.acquire()
                        .await
                        .map_err(|_| ApiError::internal("Transaction"))?,
                )
                .await
                .map_err(|_| ApiError::internal("lecture temps lié"))?
                .ok_or_else(|| ApiError::bad_request("Temps lié introuvable"))?;
        ht_temps_centimes(minutes, taux_f)
            .ok_or_else(|| ApiError::bad_request("Minutes ou taux invalides"))?
    } else {
        courant.4
    };

    if revision != courant.7 {
        sqlx::query(
            r#"
            UPDATE brouillons_facture
            SET libelle = $1, taux_centimes_heure = $2, ht_centimes = $3, revision = $4
            WHERE id = $5
            "#,
        )
        .bind(libelle_f)
        .bind(taux_f)
        .bind(ht)
        .bind(revision)
        .bind(brouillon_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour brouillon"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(BrouillonTempsResponse {
        id: brouillon_id,
        dossier_id: courant.1,
        numero: courant.3,
        ht_centimes: ht,
        revision,
    }))
}

#[utoipa::path(patch, path = "/taux-horaires/{taux_id}", tag = "factures", security(("bearer_auth" = [])), request_body = PatchTauxRequest, responses((status = 200, body = TauxResponse)))]
pub async fn patch_taux(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(taux_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchTauxRequest>,
) -> Result<Json<TauxResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let Some(centimes) = body.centimes_par_heure else {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    };
    if centimes <= 0 {
        return Err(ApiError::bad_request("Taux invalide"));
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
        return charger_taux(&state, claims.cabinet_id, claims.sub, taux_id)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (Uuid, Option<Uuid>, i64, i64)>(
        r#"
        SELECT cabinet_id, dossier_id, centimes_par_heure, revision
        FROM taux_horaires WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(taux_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture taux"))?
    .ok_or_else(|| ApiError::not_found("Taux introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Taux hors cabinet"));
    }
    if let Some(dossier_id) = courant.1 {
        if !dossier_autorise_tx(&mut tx, claims.cabinet_id, claims.sub, dossier_id).await? {
            return Err(ApiError::forbidden("Dossier non autorisé"));
        }
    }
    valider_base_revision(body.base_revision, courant.3)?;

    let mut revision = courant.3;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: taux_id,
        table_cible: "taux_horaires",
        dossier_id: courant.1,
    };
    appliquer_champ_i64(
        &mut tx,
        &contexte,
        "centimes_par_heure",
        Some(centimes),
        courant.2,
        &mut revision,
    )
    .await?;

    if revision != courant.3 {
        sqlx::query(
            r#"UPDATE taux_horaires SET centimes_par_heure = $1, revision = $2 WHERE id = $3"#,
        )
        .bind(centimes)
        .bind(revision)
        .bind(taux_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour taux"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(TauxResponse {
        id: taux_id,
        centimes_par_heure: centimes,
        revision,
    }))
}

async fn charger_temps(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    temps_id: Uuid,
) -> Result<TempsResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, i32, i64, i64, i64)>(
        r#"
        SELECT dossier_id, minutes, ht_centimes, taux_centimes_heure, revision
        FROM temps_saisis WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(temps_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture temps"))?
    .ok_or_else(|| ApiError::not_found("Temps introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, row.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    Ok(TempsResponse {
        id: temps_id,
        dossier_id: row.0,
        minutes: row.1,
        ht_centimes: row.2,
        taux_centimes_heure: row.3,
        revision: row.4,
    })
}

async fn charger_brouillon(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    brouillon_id: Uuid,
) -> Result<BrouillonTempsResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<i64>, i64, i64)>(
        r#"
        SELECT dossier_id, numero, ht_centimes, revision
        FROM brouillons_facture WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(brouillon_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture brouillon"))?
    .ok_or_else(|| ApiError::not_found("Brouillon introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, row.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    Ok(BrouillonTempsResponse {
        id: brouillon_id,
        dossier_id: row.0,
        numero: row.1,
        ht_centimes: row.2,
        revision: row.3,
    })
}

async fn charger_taux(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    taux_id: Uuid,
) -> Result<TauxResponse, ApiError> {
    let row = sqlx::query_as::<_, (Option<Uuid>, i64, i64)>(
        r#"
        SELECT dossier_id, centimes_par_heure, revision
        FROM taux_horaires WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(taux_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture taux"))?
    .ok_or_else(|| ApiError::not_found("Taux introuvable"))?;
    if let Some(dossier_id) = row.0 {
        if !dossier_visible(state, cabinet_id, utilisateur_id, dossier_id).await? {
            return Err(ApiError::forbidden("Dossier non autorisé"));
        }
    }
    Ok(TauxResponse {
        id: taux_id,
        centimes_par_heure: row.1,
        revision: row.2,
    })
}

pub(crate) async fn exiger_dossier_existant(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    dossier_id: Uuid,
) -> Result<(), ApiError> {
    let existe =
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM dossiers WHERE id = $1 AND cabinet_id = $2")
            .bind(dossier_id)
            .bind(cabinet_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| ApiError::internal("lecture dossier"))?;
    if existe.is_none() {
        return Err(ApiError::bad_request("Dossier introuvable"));
    }
    if !dossier_visible(state, cabinet_id, utilisateur_id, dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    Ok(())
}

async fn meta_dossier(state: &AppState, dossier_id: Uuid) -> Result<(String, String), ApiError> {
    sqlx::query_as::<_, (String,)>("SELECT visibilite FROM dossiers WHERE id = $1")
        .bind(dossier_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("visibilité dossier"))?
        .map(|row| (row.0, dossier_id.to_string()))
        .ok_or_else(|| ApiError::bad_request("Dossier introuvable"))
}

async fn dossier_autorise_tx(
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

fn texte_requis(valeur: &str, message: &str) -> Result<String, ApiError> {
    let texte = valeur.trim();
    if texte.is_empty() {
        return Err(ApiError::bad_request(message));
    }
    Ok(texte.to_owned())
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
