use std::sync::Arc;

use axum::http::StatusCode;
use axum::{extract::State, Json};
use legalos_domaine::reference::{initiales_depuis, initiales_valides};
use legalos_domaine::{ModeleReference, RemiseAZero};
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct CabinetResponse {
    pub id: Uuid,
    pub slug: String,
    pub nom: String,
    pub totp_obligatoire: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchCabinetRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    pub slug: Option<String>,
}

#[utoipa::path(
    get,
    path = "/cabinets/me",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Cabinet courant (JWT)", body = CabinetResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn cabinet_me(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<CabinetResponse>, ApiError> {
    charger_cabinet(&state, claims.cabinet_id).await.map(Json)
}

#[utoipa::path(
    patch,
    path = "/cabinets/{cabinet_id}",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    request_body = PatchCabinetRequest,
    responses(
        (status = 200, description = "Cabinet mis à jour", body = CabinetResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Cabinet interdit", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_cabinet(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(cabinet_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchCabinetRequest>,
) -> Result<Json<CabinetResponse>, ApiError> {
    if cabinet_id != claims.cabinet_id {
        return Err(ApiError::unauthorized("Cabinet non autorisé pour ce jeton"));
    }
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.base_revision < 1 {
        return Err(ApiError::bad_request("Version de base invalide"));
    }
    let nom = champ_optionnel(body.nom)?;
    let slug = champ_optionnel(body.slug)?;
    if nom.is_none() && slug.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    let inserted = sqlx::query(
        r#"INSERT INTO upload_idempotence (cle) VALUES ($1) ON CONFLICT (cle) DO NOTHING"#,
    )
    .bind(body.idempotence_cle.trim())
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Idempotence"))?;

    if inserted.rows_affected() == 0 {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return charger_cabinet(&state, cabinet_id).await.map(Json);
    }

    let courant = sqlx::query_as::<_, (i64, String, String)>(
        r#"SELECT revision, nom, slug FROM cabinets WHERE id = $1 FOR UPDATE"#,
    )
    .bind(cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    if body.base_revision > courant.0 {
        return Err(ApiError::bad_request(
            "Version de base postérieure au serveur",
        ));
    }

    let mut revision = courant.0;
    let contexte = ContexteChamp {
        cabinet_id,
        poste_id: claims.poste_id,
        base_revision: body.base_revision,
    };
    appliquer_champ(
        &mut tx,
        &contexte,
        "nom",
        nom.as_deref(),
        &courant.1,
        &mut revision,
    )
    .await?;
    appliquer_champ(
        &mut tx,
        &contexte,
        "slug",
        slug.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;

    if revision != courant.0 {
        sqlx::query(r#"UPDATE cabinets SET revision = $1 WHERE id = $2"#)
            .bind(revision)
            .bind(cabinet_id)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("Révision cabinet"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    charger_cabinet(&state, cabinet_id).await.map(Json)
}

fn champ_optionnel(valeur: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(valeur) = valeur else {
        return Ok(None);
    };
    let valeur = valeur.trim().to_owned();
    if valeur.is_empty() {
        return Err(ApiError::bad_request("Champ vide"));
    }
    Ok(Some(valeur))
}

struct ContexteChamp {
    cabinet_id: Uuid,
    poste_id: Uuid,
    base_revision: i64,
}

async fn appliquer_champ(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
    nouvelle: Option<&str>,
    actuelle: &str,
    revision: &mut i64,
) -> Result<(), ApiError> {
    let Some(nouvelle) = nouvelle else {
        return Ok(());
    };
    let conflit = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM journal_modifications
            WHERE enregistrement_id = $1 AND champ = $2 AND revision_appliquee > $3
        )
        "#,
    )
    .bind(contexte.cabinet_id)
    .bind(champ)
    .bind(contexte.base_revision)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))?;

    let colonne = match champ {
        "nom" => "nom",
        "slug" => "slug",
        _ => return Err(ApiError::bad_request("Champ non autorisé")),
    };
    let sql = format!("UPDATE cabinets SET {colonne} = $1 WHERE id = $2");
    sqlx::query(&sql)
        .bind(nouvelle)
        .bind(contexte.cabinet_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::bad_request("Champ refusé"))?;

    *revision += 1;
    sqlx::query(
        r#"
        INSERT INTO journal_modifications (
            id, cabinet_id, table_cible, enregistrement_id, champ,
            valeur_remplacee, valeur_appliquee, revision_base, revision_appliquee,
            poste_id, conflit
        )
        VALUES ($1, $2, 'cabinets', $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(contexte.cabinet_id)
    .bind(champ)
    .bind(actuelle)
    .bind(nouvelle)
    .bind(contexte.base_revision)
    .bind(*revision)
    .bind(contexte.poste_id)
    .bind(conflit)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))?;
    Ok(())
}

async fn charger_cabinet(state: &AppState, cabinet_id: Uuid) -> Result<CabinetResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, bool)>(
        r#"SELECT id, slug, nom, totp_obligatoire FROM cabinets WHERE id = $1"#,
    )
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    Ok(CabinetResponse {
        id: row.0,
        slug: row.1,
        nom: row.2,
        totp_obligatoire: row.3,
    })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RemiseAZeroApi {
    Annuelle,
    Jamais,
}

impl From<RemiseAZeroApi> for RemiseAZero {
    fn from(valeur: RemiseAZeroApi) -> Self {
        match valeur {
            RemiseAZeroApi::Annuelle => RemiseAZero::Annuelle,
            RemiseAZeroApi::Jamais => RemiseAZero::Jamais,
        }
    }
}

impl From<RemiseAZero> for RemiseAZeroApi {
    fn from(valeur: RemiseAZero) -> Self {
        match valeur {
            RemiseAZero::Annuelle => RemiseAZeroApi::Annuelle,
            RemiseAZero::Jamais => RemiseAZeroApi::Jamais,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReferenceCabinetResponse {
    pub modele: String,
    pub remise_a_zero: RemiseAZeroApi,
    pub annee: i32,
    pub prochain_numero: i64,
    pub initiales: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PutReferenceRequest {
    pub idempotence_cle: String,
    pub modele: String,
    pub remise_a_zero: RemiseAZeroApi,
    pub numero_depart: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/cabinets/{cabinet_id}/reference",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    params(("cabinet_id" = Uuid, Path, description = "Identifiant du cabinet")),
    responses(
        (status = 200, description = "Modèle et prochain numéro", body = ReferenceCabinetResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_reference(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(cabinet_id): axum::extract::Path<Uuid>,
) -> Result<Json<ReferenceCabinetResponse>, ApiError> {
    if cabinet_id != claims.cabinet_id {
        return Err(ApiError::unauthorized("Cabinet non autorisé pour ce jeton"));
    }
    charger_etat_reference(&state, cabinet_id, claims.sub)
        .await
        .map(Json)
}

#[utoipa::path(
    put,
    path = "/cabinets/{cabinet_id}/reference",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    params(("cabinet_id" = Uuid, Path, description = "Identifiant du cabinet")),
    request_body = PutReferenceRequest,
    responses(
        (status = 200, description = "Modèle enregistré", body = ReferenceCabinetResponse),
        (status = 400, description = "modele_invalide ou numero_depart_invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 409, description = "reference_existante", body = crate::error::ApiErrorBody),
    )
)]
pub async fn ecrire_reference(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(cabinet_id): axum::extract::Path<Uuid>,
    Json(body): Json<PutReferenceRequest>,
) -> Result<Json<ReferenceCabinetResponse>, ApiError> {
    if cabinet_id != claims.cabinet_id {
        return Err(ApiError::unauthorized("Cabinet non autorisé pour ce jeton"));
    }
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    let cle = format!("{}:{}", claims.poste_id, body.idempotence_cle.trim());
    let inserted = sqlx::query(
        r#"INSERT INTO upload_idempotence (cle) VALUES ($1) ON CONFLICT (cle) DO NOTHING"#,
    )
    .bind(&cle)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Idempotence"))?;

    if inserted.rows_affected() == 0 {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return charger_etat_reference(&state, cabinet_id, claims.sub)
            .await
            .map(Json);
    }

    let courant = sqlx::query_as::<_, (String, String, i64)>(
        r#"
        SELECT reference_modele, reference_remise_a_zero, revision
        FROM cabinets WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    let remise = RemiseAZero::from(body.remise_a_zero);
    let modele = ModeleReference::analyser_pour(&body.modele, remise).map_err(|e| {
        ApiError::with_code(StatusCode::BAD_REQUEST, "modele_invalide", e.to_string())
    })?;
    let modele_texte = modele.texte();
    let annee = annee_civile_paris(&mut tx).await?;
    let prochain_actuel = prochain_actuel(&mut tx, cabinet_id, remise, annee).await?;
    let dernier = dernier_numero_periode(&mut tx, cabinet_id, remise, annee).await?;

    let prochain = if let Some(depart) = body.numero_depart {
        if depart < 1 || depart <= dernier {
            return Err(ApiError::with_code(
                StatusCode::BAD_REQUEST,
                "numero_depart_invalide",
                "Le numéro de départ doit être un entier strictement supérieur au dernier numéro déjà attribué dans la période.",
            ));
        }
        depart
    } else {
        prochain_actuel
    };

    let prochain_u64 =
        u64::try_from(prochain).map_err(|_| ApiError::internal("numéro de référence"))?;
    let existantes = sqlx::query_as::<_, (String,)>(
        r#"SELECT reference FROM dossiers WHERE cabinet_id = $1 AND reference IS NOT NULL"#,
    )
    .bind(cabinet_id)
    .fetch_all(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("références existantes"))?;

    let references: Vec<&str> = existantes.iter().map(|(r,)| r.as_str()).collect();
    if references
        .iter()
        .any(|reference| modele.pourrait_redonner(remise, annee, prochain_u64, reference))
    {
        let plancher = (dernier + 1).max(1);
        let plancher_u64 =
            u64::try_from(plancher).map_err(|_| ApiError::internal("numéro de départ"))?;
        let numero_depart_minimal =
            numero_depart_minimal_acceptable(&modele, remise, annee, plancher_u64, &references)
                .and_then(|n| i64::try_from(n).ok());
        let message = match numero_depart_minimal {
            Some(n) => format!(
                "Ce changement redonnerait une référence déjà attribuée. Un numéro de départ d'au moins {n} le rendrait acceptable."
            ),
            None => {
                "Ce changement redonnerait une référence déjà attribuée.".to_owned()
            }
        };
        return Err(ApiError::with_code_et_numero_depart(
            StatusCode::CONFLICT,
            "reference_existante",
            message,
            numero_depart_minimal,
        ));
    }

    sqlx::query(
        r#"
        UPDATE cabinets
        SET reference_modele = $1, reference_remise_a_zero = $2
        WHERE id = $3
        "#,
    )
    .bind(&modele_texte)
    .bind(remise_sql(remise))
    .bind(cabinet_id)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("modèle de référence"))?;

    upsert_sequence(&mut tx, cabinet_id, remise, annee, prochain).await?;

    let mut revision = courant.2;
    journaliser_si_change(
        &mut tx,
        cabinet_id,
        claims.poste_id,
        claims.sub,
        courant.2,
        "reference_modele",
        &courant.0,
        &modele_texte,
        &mut revision,
    )
    .await?;
    journaliser_si_change(
        &mut tx,
        cabinet_id,
        claims.poste_id,
        claims.sub,
        courant.2,
        "reference_remise_a_zero",
        &courant.1,
        remise_sql(remise),
        &mut revision,
    )
    .await?;
    if let Some(depart) = body.numero_depart {
        journaliser_si_change(
            &mut tx,
            cabinet_id,
            claims.poste_id,
            claims.sub,
            courant.2,
            "reference_numero_depart",
            &prochain_actuel.to_string(),
            &depart.to_string(),
            &mut revision,
        )
        .await?;
    }

    if revision != courant.2 {
        sqlx::query(r#"UPDATE cabinets SET revision = $1 WHERE id = $2"#)
            .bind(revision)
            .bind(cabinet_id)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("Révision cabinet"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    charger_etat_reference(&state, cabinet_id, claims.sub)
        .await
        .map(Json)
}

pub(crate) async fn charger_etat_reference(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<ReferenceCabinetResponse, ApiError> {
    let row = sqlx::query_as::<_, (String, String)>(
        r#"SELECT reference_modele, reference_remise_a_zero FROM cabinets WHERE id = $1"#,
    )
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    let remise = remise_depuis_sql(&row.1)?;
    let annee = sqlx::query_as::<_, (i32,)>(
        "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("année civile"))?
    .0;
    let prochain_numero = prochain_periode(&state.pool, cabinet_id, remise, annee).await?;
    let initiales = initiales_utilisateur(&state.pool, utilisateur_id).await?;

    Ok(ReferenceCabinetResponse {
        modele: row.0,
        remise_a_zero: RemiseAZeroApi::from(remise),
        annee,
        prochain_numero,
        initiales,
    })
}

pub(crate) async fn annee_civile_paris(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<i32, ApiError> {
    sqlx::query_as::<_, (i32,)>(
        "SELECT EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'))::integer",
    )
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map(|row| row.0)
    .map_err(|_| ApiError::internal("année civile"))
}

pub(crate) async fn initiales_utilisateur(
    executant: impl sqlx::Executor<'_, Database = sqlx::Postgres>,
    utilisateur_id: Uuid,
) -> Result<String, ApiError> {
    let row = sqlx::query_as::<_, (Option<String>, String)>(
        r#"SELECT initiales, email FROM utilisateurs WHERE id = $1"#,
    )
    .bind(utilisateur_id)
    .fetch_optional(executant)
    .await
    .map_err(|_| ApiError::internal("utilisateur"))?
    .ok_or_else(|| ApiError::unauthorized("Utilisateur introuvable"))?;
    Ok(match row.0 {
        Some(ini) if initiales_valides(&ini) => ini,
        _ => initiales_depuis(&row.1),
    })
}

async fn prochain_periode(
    pool: &sqlx::PgPool,
    cabinet_id: Uuid,
    remise: RemiseAZero,
    annee: i32,
) -> Result<i64, ApiError> {
    let prochain =
        match remise {
            RemiseAZero::Annuelle => sqlx::query_scalar::<_, i64>(
                r#"SELECT prochain FROM sequences_dossiers WHERE cabinet_id = $1 AND annee = $2"#,
            )
            .bind(cabinet_id)
            .bind(annee)
            .fetch_optional(pool)
            .await,
            RemiseAZero::Jamais => {
                sqlx::query_scalar::<_, i64>(
                    r#"SELECT prochain FROM sequences_dossiers_continues WHERE cabinet_id = $1"#,
                )
                .bind(cabinet_id)
                .fetch_optional(pool)
                .await
            }
        }
        .map_err(|_| ApiError::internal("séquence dossier"))?;
    Ok(prochain.unwrap_or(1))
}

async fn prochain_actuel(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    remise: RemiseAZero,
    annee: i32,
) -> Result<i64, ApiError> {
    let seq_annee = sqlx::query_scalar::<_, i64>(
        r#"SELECT prochain FROM sequences_dossiers WHERE cabinet_id = $1 AND annee = $2"#,
    )
    .bind(cabinet_id)
    .bind(annee)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("séquence annuelle"))?
    .unwrap_or(1);

    let dernier_annee = sqlx::query_scalar::<_, Option<i64>>(
        r#"
        SELECT MAX(reference_numero)
        FROM dossiers
        WHERE cabinet_id = $1 AND reference_annee = $2
        "#,
    )
    .bind(cabinet_id)
    .bind(annee)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("dernier numéro"))?
    .unwrap_or(0);

    match remise {
        RemiseAZero::Annuelle => Ok(seq_annee.max(dernier_annee.saturating_add(1)).max(1)),
        RemiseAZero::Jamais => {
            let seq_continue = sqlx::query_scalar::<_, i64>(
                r#"SELECT prochain FROM sequences_dossiers_continues WHERE cabinet_id = $1"#,
            )
            .bind(cabinet_id)
            .fetch_optional(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("séquence continue"))?
            .unwrap_or(1);
            Ok(seq_continue
                .max(seq_annee)
                .max(dernier_annee.saturating_add(1))
                .max(1))
        }
    }
}

async fn dernier_numero_periode(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    remise: RemiseAZero,
    annee: i32,
) -> Result<i64, ApiError> {
    let dernier = match remise {
        RemiseAZero::Annuelle => {
            sqlx::query_scalar::<_, Option<i64>>(
                r#"
                SELECT MAX(reference_numero)
                FROM dossiers
                WHERE cabinet_id = $1 AND reference_annee = $2
                "#,
            )
            .bind(cabinet_id)
            .bind(annee)
            .fetch_one(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
        }
        RemiseAZero::Jamais => {
            sqlx::query_scalar::<_, Option<i64>>(
                r#"SELECT MAX(reference_numero) FROM dossiers WHERE cabinet_id = $1"#,
            )
            .bind(cabinet_id)
            .fetch_one(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
        }
    }
    .map_err(|_| ApiError::internal("dernier numéro"))?;
    Ok(dernier.unwrap_or(0))
}

async fn upsert_sequence(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    remise: RemiseAZero,
    annee: i32,
    prochain: i64,
) -> Result<(), ApiError> {
    match remise {
        RemiseAZero::Annuelle => {
            sqlx::query(
                r#"
                INSERT INTO sequences_dossiers (cabinet_id, annee, prochain)
                VALUES ($1, $2, $3)
                ON CONFLICT (cabinet_id, annee) DO UPDATE
                    SET prochain = EXCLUDED.prochain
                "#,
            )
            .bind(cabinet_id)
            .bind(annee)
            .bind(prochain)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("séquence annuelle"))?;
        }
        RemiseAZero::Jamais => {
            sqlx::query(
                r#"
                INSERT INTO sequences_dossiers_continues (cabinet_id, prochain)
                VALUES ($1, $2)
                ON CONFLICT (cabinet_id) DO UPDATE
                    SET prochain = EXCLUDED.prochain
                "#,
            )
            .bind(cabinet_id)
            .bind(prochain)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("séquence continue"))?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn journaliser_si_change(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    poste_id: Uuid,
    auteur_id: Uuid,
    revision_base: i64,
    champ: &str,
    actuelle: &str,
    nouvelle: &str,
    revision: &mut i64,
) -> Result<(), ApiError> {
    if actuelle == nouvelle {
        return Ok(());
    }
    *revision += 1;
    sqlx::query(
        r#"
        INSERT INTO journal_modifications (
            id, cabinet_id, table_cible, enregistrement_id, champ,
            valeur_remplacee, valeur_appliquee, revision_base, revision_appliquee,
            poste_id, auteur_id, conflit
        )
        VALUES ($1, $2, 'cabinets', $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(cabinet_id)
    .bind(champ)
    .bind(actuelle)
    .bind(nouvelle)
    .bind(revision_base)
    .bind(*revision)
    .bind(poste_id)
    .bind(auteur_id)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))?;
    Ok(())
}

/// Plus petit numéro de départ (≥ `plancher`) tel qu'aucune référence existante ne serait
/// redonnée. `None` s'il n'existe pas de tel numéro (ex. collision avec une année future
/// sous politique annuelle).
fn numero_depart_minimal_acceptable(
    modele: &ModeleReference,
    remise: RemiseAZero,
    annee: i32,
    plancher: u64,
    references: &[&str],
) -> Option<u64> {
    const PLAFOND: u64 = 1_000_000_000;
    if !references
        .iter()
        .any(|r| modele.pourrait_redonner(remise, annee, plancher, r))
    {
        return Some(plancher);
    }
    let mut hi = plancher.saturating_add(1).max(2);
    while references
        .iter()
        .any(|r| modele.pourrait_redonner(remise, annee, hi, r))
    {
        if hi >= PLAFOND {
            return None;
        }
        hi = hi.saturating_mul(2).min(PLAFOND);
    }
    let mut lo = plancher;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if references
            .iter()
            .any(|r| modele.pourrait_redonner(remise, annee, mid, r))
        {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    Some(lo)
}

fn remise_sql(remise: RemiseAZero) -> &'static str {
    match remise {
        RemiseAZero::Annuelle => "annuelle",
        RemiseAZero::Jamais => "jamais",
    }
}

pub(crate) fn remise_depuis_sql(valeur: &str) -> Result<RemiseAZero, ApiError> {
    match valeur {
        "annuelle" => Ok(RemiseAZero::Annuelle),
        "jamais" => Ok(RemiseAZero::Jamais),
        _ => Err(ApiError::internal("politique de remise inconnue")),
    }
}
