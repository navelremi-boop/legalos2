use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
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

    let annee = sqlx::query_as::<_, (i32,)>(
        "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("année civile"))?
    .0;

    let numero = sqlx::query_as::<_, (i64,)>(
        r#"
        INSERT INTO sequences_dossiers (cabinet_id, annee, prochain)
        VALUES ($1, $2, 2)
        ON CONFLICT (cabinet_id, annee) DO UPDATE
            SET prochain = sequences_dossiers.prochain + 1
        RETURNING prochain - 1
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(annee)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("référence dossier"))?
    .0;

    let reference = formater_reference(annee, numero);

    sqlx::query(
        r#"
        INSERT INTO dossiers (
            id, cabinet_id, nom, chemise, juridiction, numero_rg,
            reference, reference_annee, reference_numero,
            restreint, visibilite, revision
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9,
            $10, CASE WHEN $10 THEN 'restreint' ELSE 'public' END, 1
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

/// Format affichable `YYYY-NNN` (zéros à gauche, largeur minimale 3 — hypothèse R0).
pub(crate) fn formater_reference(annee: i32, numero: i64) -> String {
    format!("{annee}-{numero:03}")
}

#[cfg(test)]
mod tests {
    use super::formater_reference;

    #[test]
    fn reference_trois_chiffres_avec_zeros() {
        assert_eq!(formater_reference(2026, 42), "2026-042");
        assert_eq!(formater_reference(2026, 1), "2026-001");
    }

    #[test]
    fn reference_au_dela_de_999_sans_tronquer() {
        assert_eq!(formater_reference(2026, 1000), "2026-1000");
    }
}
