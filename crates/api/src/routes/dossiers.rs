use std::sync::Arc;

use axum::{extract::State, Json};
use legalos_domaine::ModeleReference;
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
use crate::routes::cabinets::{annee_civile_paris, initiales_utilisateur, remise_depuis_sql};
use crate::state::AppState;

const CHEMISES: &[&str] = &[
    "kraft",
    "bleu-classeur",
    "vert-amande",
    "jaune-paille",
    "rose-buvard",
    "lilas",
    "vert-eau",
    "gris-perle",
];

const ROLES_PARTIE: &[&str] = &["client", "adversaire", "confrere"];

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerDossierRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub nom: String,
    pub chemise: String,
    pub juridiction: String,
    pub numero_rg: String,
    pub restreint: bool,
    /// Avocat responsable (R0-b) ; défaut = créateur si omis.
    pub responsable_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DossierResponse {
    pub id: Uuid,
    pub nom: String,
    pub restreint: bool,
    /// Référence serveur `YYYY-NNN` (R0) ; `null` tant que non attribuée (hors ligne / en attente).
    pub reference: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerPartieRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub role: String,
    pub nom: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PartieResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchDossierRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    pub chemise: Option<String>,
    pub juridiction: Option<String>,
    pub numero_rg: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DossierDetailResponse {
    pub id: Uuid,
    pub nom: String,
    pub chemise: String,
    pub juridiction: String,
    pub numero_rg: String,
    pub restreint: bool,
    pub reference: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchPartieRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub role: Option<String>,
    pub nom: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PartieDetailResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub role: String,
    pub nom: String,
    pub revision: i64,
}

#[utoipa::path(
    post,
    path = "/dossiers",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerDossierRequest,
    responses(
        (status = 200, description = "Dossier créé ou déjà présent", body = DossierResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier restreint hors de vos droits", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_dossier(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerDossierRequest>,
) -> Result<Json<DossierResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = texte_requis(&body.nom, "Nom requis")?;
    let juridiction = texte_requis(&body.juridiction, "Juridiction requise")?;
    let numero_rg = texte_requis(&body.numero_rg, "Numéro RG requis")?;
    if !CHEMISES.contains(&body.chemise.as_str()) {
        return Err(ApiError::bad_request("Couleur de chemise inconnue"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    // Envois concurrents du même dossier (rejeu du poste) : sans ce verrou, deux transactions
    // voient le dossier absent et la seconde échoue sur la clé primaire (500).
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(body.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("verrou dossier"))?;
    let existant = sqlx::query_as::<_, (Uuid, bool, Option<String>)>(
        "SELECT cabinet_id, restreint, reference FROM dossiers WHERE id = $1",
    )
    .bind(body.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture dossier"))?;
    if let Some((cabinet_id, restreint, reference)) = existant {
        if cabinet_id != claims.cabinet_id {
            return Err(ApiError::unauthorized("Dossier hors cabinet"));
        }
        // Dossier restreint : le rejeu ne renvoie rien à un collaborateur hors dossier_acces
        // (droits par dossier, § 3.1).
        if restreint {
            let autorise = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM dossier_acces WHERE dossier_id = $1 AND utilisateur_id = $2)",
            )
            .bind(body.id)
            .bind(claims.sub)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("droit dossier"))?;
            if !autorise {
                return Err(ApiError::not_found("Dossier introuvable"));
            }
        }
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit idempotent"))?;
        return Ok(Json(DossierResponse {
            id: body.id,
            nom,
            restreint,
            reference,
        }));
    }

    let cabinet = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT reference_modele, reference_remise_a_zero
        FROM cabinets
        WHERE id = $1
        FOR SHARE
        "#,
    )
    .bind(claims.cabinet_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture cabinet"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;
    let remise = remise_depuis_sql(&cabinet.1)?;
    let modele = ModeleReference::analyser_pour(&cabinet.0, remise)
        .map_err(|_| ApiError::internal("modèle de référence"))?;

    let responsable_id = match body.responsable_id {
        None => claims.sub,
        Some(candidat) => {
            let meme_cabinet = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM utilisateurs
                    WHERE id = $1 AND cabinet_id = $2 AND actif
                )
                "#,
            )
            .bind(candidat)
            .bind(claims.cabinet_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("responsable"))?;
            if !meme_cabinet {
                return Err(ApiError::bad_request(
                    "Le responsable doit être un utilisateur actif du même cabinet.",
                ));
            }
            candidat
        }
    };

    let annee = annee_civile_paris(&mut tx).await?;
    let numero = attribuer_numero(&mut tx, claims.cabinet_id, remise, annee).await?;
    let numero_u64 =
        u64::try_from(numero).map_err(|_| ApiError::internal("numéro de référence"))?;
    let initiales = initiales_utilisateur(&mut *tx, responsable_id).await?;
    let reference = modele.produire(annee, numero_u64, &initiales);

    sqlx::query(
        r#"
        INSERT INTO dossiers (
            id, cabinet_id, nom, chemise, juridiction, numero_rg,
            reference, reference_annee, reference_numero,
            restreint, visibilite, revision, responsable_id
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9,
            $10, CASE WHEN $10 THEN 'restreint' ELSE 'public' END, 1, $11
        )
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&nom)
    .bind(&body.chemise)
    .bind(&juridiction)
    .bind(&numero_rg)
    .bind(&reference)
    .bind(annee)
    .bind(numero)
    .bind(body.restreint)
    .bind(responsable_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("création dossier"))?;

    if body.restreint {
        sqlx::query(
            r#"
            INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte)
            VALUES ($1, $2, $1::text, $2::text)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(body.id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("droit dossier"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("validation dossier"))?;
    Ok(Json(DossierResponse {
        id: body.id,
        nom,
        restreint: body.restreint,
        reference: Some(reference),
    }))
}

#[utoipa::path(
    post,
    path = "/dossiers/{dossier_id}/parties",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerPartieRequest,
    responses(
        (status = 200, description = "Partie créée ou déjà présente", body = PartieResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_partie(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerPartieRequest>,
) -> Result<Json<PartieResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = texte_requis(&body.nom, "Nom de partie requis")?;
    if !ROLES_PARTIE.contains(&body.role.as_str()) {
        return Err(ApiError::bad_request("Rôle de partie inconnu"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }

    sqlx::query(
        r#"
        INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, revision, restreint, visibilite)
        VALUES (
            $1, $2, $3, $4, $5, 1,
            (SELECT restreint FROM dossiers WHERE id = $2),
            (SELECT visibilite FROM dossiers WHERE id = $2)
        )
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(dossier_id)
    .bind(claims.cabinet_id)
    .bind(&body.role)
    .bind(&nom)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création partie"))?;

    Ok(Json(PartieResponse {
        id: body.id,
        dossier_id,
        nom,
    }))
}

#[utoipa::path(
    patch,
    path = "/dossiers/{dossier_id}",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = PatchDossierRequest,
    responses(
        (status = 200, description = "Dossier mis à jour", body = DossierDetailResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Dossier non autorisé", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_dossier(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchDossierRequest>,
) -> Result<Json<DossierDetailResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = champ_texte_optionnel(body.nom)?;
    let chemise = champ_texte_optionnel(body.chemise)?;
    let juridiction = champ_texte_optionnel(body.juridiction)?;
    let numero_rg = champ_texte_optionnel(body.numero_rg)?;
    if nom.is_none() && chemise.is_none() && juridiction.is_none() && numero_rg.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }
    if let Some(ref c) = chemise {
        if !CHEMISES.contains(&c.as_str()) {
            return Err(ApiError::bad_request("Couleur de chemise inconnue"));
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
        return charger_dossier(&state, claims.cabinet_id, claims.sub, dossier_id)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (Uuid, String, String, String, String, bool, Option<String>, i64)>(
        r#"
        SELECT cabinet_id, nom, chemise, juridiction, numero_rg, restreint, reference, revision
        FROM dossiers WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(dossier_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture dossier"))?
    .ok_or_else(|| ApiError::not_found("Dossier introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Dossier hors cabinet"));
    }
    if !dossier_visible_tx(&mut tx, claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    valider_base_revision(body.base_revision, courant.7)?;

    let mut revision = courant.7;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: dossier_id,
        table_cible: "dossiers",
        dossier_id: Some(dossier_id),
    };
    appliquer_champ_texte(&mut tx, &contexte, "nom", nom.as_deref(), &courant.1, &mut revision)
        .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "chemise",
        chemise.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "juridiction",
        juridiction.as_deref(),
        &courant.3,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "numero_rg",
        numero_rg.as_deref(),
        &courant.4,
        &mut revision,
    )
    .await?;

    let nom_f = nom.as_deref().unwrap_or(&courant.1);
    let chemise_f = chemise.as_deref().unwrap_or(&courant.2);
    let juridiction_f = juridiction.as_deref().unwrap_or(&courant.3);
    let numero_rg_f = numero_rg.as_deref().unwrap_or(&courant.4);

    if revision != courant.7 {
        sqlx::query(
            r#"
            UPDATE dossiers
            SET nom = $1, chemise = $2, juridiction = $3, numero_rg = $4, revision = $5
            WHERE id = $6
            "#,
        )
        .bind(nom_f)
        .bind(chemise_f)
        .bind(juridiction_f)
        .bind(numero_rg_f)
        .bind(revision)
        .bind(dossier_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour dossier"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(DossierDetailResponse {
        id: dossier_id,
        nom: nom_f.to_owned(),
        chemise: chemise_f.to_owned(),
        juridiction: juridiction_f.to_owned(),
        numero_rg: numero_rg_f.to_owned(),
        restreint: courant.5,
        reference: courant.6,
        revision,
    }))
}

#[utoipa::path(
    patch,
    path = "/parties/{partie_id}",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = PatchPartieRequest,
    responses(
        (status = 200, description = "Partie mise à jour", body = PartieDetailResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Dossier non autorisé", body = crate::error::ApiErrorBody),
        (status = 404, description = "Partie introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_partie(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(partie_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchPartieRequest>,
) -> Result<Json<PartieDetailResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let role = champ_texte_optionnel(body.role)?;
    let nom = champ_texte_optionnel(body.nom)?;
    if role.is_none() && nom.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }
    if let Some(ref r) = role {
        if !ROLES_PARTIE.contains(&r.as_str()) {
            return Err(ApiError::bad_request("Rôle de partie inconnu"));
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
        return charger_partie(&state, claims.cabinet_id, claims.sub, partie_id)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (Uuid, Uuid, String, String, i64)>(
        r#"
        SELECT cabinet_id, dossier_id, role, nom, revision
        FROM parties WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(partie_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture partie"))?
    .ok_or_else(|| ApiError::not_found("Partie introuvable"))?;

    if courant.0 != claims.cabinet_id {
        return Err(ApiError::forbidden("Partie hors cabinet"));
    }
    if !dossier_visible_tx(&mut tx, claims.cabinet_id, claims.sub, courant.1).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    valider_base_revision(body.base_revision, courant.4)?;

    let mut revision = courant.4;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: partie_id,
        table_cible: "parties",
        dossier_id: Some(courant.1),
    };
    appliquer_champ_texte(&mut tx, &contexte, "role", role.as_deref(), &courant.2, &mut revision)
        .await?;
    appliquer_champ_texte(&mut tx, &contexte, "nom", nom.as_deref(), &courant.3, &mut revision)
        .await?;

    let role_f = role.as_deref().unwrap_or(&courant.2);
    let nom_f = nom.as_deref().unwrap_or(&courant.3);

    if revision != courant.4 {
        sqlx::query(r#"UPDATE parties SET role = $1, nom = $2, revision = $3 WHERE id = $4"#)
            .bind(role_f)
            .bind(nom_f)
            .bind(revision)
            .bind(partie_id)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("mise à jour partie"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    Ok(Json(PartieDetailResponse {
        id: partie_id,
        dossier_id: courant.1,
        role: role_f.to_owned(),
        nom: nom_f.to_owned(),
        revision,
    }))
}

async fn charger_dossier(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    dossier_id: Uuid,
) -> Result<DossierDetailResponse, ApiError> {
    if !dossier_visible(state, cabinet_id, utilisateur_id, dossier_id).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    let row = sqlx::query_as::<_, (String, String, String, String, bool, Option<String>, i64)>(
        r#"
        SELECT nom, chemise, juridiction, numero_rg, restreint, reference, revision
        FROM dossiers WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(dossier_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture dossier"))?
    .ok_or_else(|| ApiError::not_found("Dossier introuvable"))?;
    Ok(DossierDetailResponse {
        id: dossier_id,
        nom: row.0,
        chemise: row.1,
        juridiction: row.2,
        numero_rg: row.3,
        restreint: row.4,
        reference: row.5,
        revision: row.6,
    })
}

async fn charger_partie(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    partie_id: Uuid,
) -> Result<PartieDetailResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, i64)>(
        r#"SELECT dossier_id, role, nom, revision FROM parties WHERE id = $1 AND cabinet_id = $2"#,
    )
    .bind(partie_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture partie"))?
    .ok_or_else(|| ApiError::not_found("Partie introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, row.0).await? {
        return Err(ApiError::forbidden("Dossier non autorisé"));
    }
    Ok(PartieDetailResponse {
        id: partie_id,
        dossier_id: row.0,
        role: row.1,
        nom: row.2,
        revision: row.3,
    })
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

pub(crate) async fn dossier_visible(
    state: &AppState,
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
    .fetch_optional(&state.pool)
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

async fn attribuer_numero(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    remise: legalos_domaine::RemiseAZero,
    annee: i32,
) -> Result<i64, ApiError> {
    let numero = match remise {
        legalos_domaine::RemiseAZero::Annuelle => {
            sqlx::query_as::<_, (i64,)>(
                r#"
                INSERT INTO sequences_dossiers (cabinet_id, annee, prochain)
                VALUES ($1, $2, 2)
                ON CONFLICT (cabinet_id, annee) DO UPDATE
                    SET prochain = sequences_dossiers.prochain + 1
                RETURNING prochain - 1
                "#,
            )
            .bind(cabinet_id)
            .bind(annee)
            .fetch_one(&mut **tx)
            .await
        }
        legalos_domaine::RemiseAZero::Jamais => {
            sqlx::query_as::<_, (i64,)>(
                r#"
                INSERT INTO sequences_dossiers_continues (cabinet_id, prochain)
                VALUES ($1, 2)
                ON CONFLICT (cabinet_id) DO UPDATE
                    SET prochain = sequences_dossiers_continues.prochain + 1
                RETURNING prochain - 1
                "#,
            )
            .bind(cabinet_id)
            .fetch_one(&mut **tx)
            .await
        }
    }
    .map_err(|_| ApiError::internal("référence dossier"))?
    .0;
    Ok(numero)
}

#[cfg(test)]
mod tests {
    use legalos_domaine::reference::MODELE_PAR_DEFAUT;
    use legalos_domaine::{ModeleReference, RemiseAZero};

    fn formater_defaut(annee: i32, numero: u64) -> Result<String, String> {
        ModeleReference::analyser_pour(MODELE_PAR_DEFAUT, RemiseAZero::Annuelle)
            .map(|modele| modele.produire(annee, numero, ""))
            .map_err(|e| e.to_string())
    }

    #[test]
    fn reference_trois_chiffres_avec_zeros() -> Result<(), String> {
        assert_eq!(formater_defaut(2026, 42)?, "2026-042");
        assert_eq!(formater_defaut(2026, 1)?, "2026-001");
        Ok(())
    }

    #[test]
    fn reference_au_dela_de_999_sans_tronquer() -> Result<(), String> {
        assert_eq!(formater_defaut(2026, 1000)?, "2026-1000");
        Ok(())
    }
}
