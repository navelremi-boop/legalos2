//! Contacts du cabinet et dossiers liés (§ 4.2 n° 1 et 2).

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

const NATURES: &[&str] = &["physique", "morale"];
const TYPES_CLIENT: &[&str] = &["professionnel", "particulier", "etranger"];

#[derive(Debug, Deserialize)]
pub struct CreerContactRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub nature: String,
    pub nom: String,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: String,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContactResponse {
    pub id: Uuid,
    pub nature: String,
    pub nom: String,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: String,
    pub revision: i64,
}

#[derive(Debug, Deserialize)]
pub struct PatchContactRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LierDossiersRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub lie_a_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct LienResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub lie_a_id: Uuid,
    pub id_inverse: Uuid,
}

#[derive(Debug, Serialize)]
pub struct HistoriqueLigne {
    pub champ: String,
    pub valeur_remplacee: Option<String>,
    pub valeur_appliquee: String,
    pub cree_le: String,
}

pub async fn creer_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerContactRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = body.nom.trim();
    if nom.is_empty() {
        return Err(ApiError::bad_request("Nom de contact requis"));
    }
    if !NATURES.contains(&body.nature.as_str()) {
        return Err(ApiError::bad_request("Nature de contact inconnue"));
    }
    if !TYPES_CLIENT.contains(&body.type_client.as_str()) {
        return Err(ApiError::bad_request("type_client inconnu"));
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
        return lire_contact(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    sqlx::query(
        r#"
        INSERT INTO contacts (id, cabinet_id, nature, nom, siren, numero_tva, type_client, email, revision)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&body.nature)
    .bind(nom)
    .bind(
        body.siren
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        body.numero_tva
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(&body.type_client)
    .bind(
        body.email
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase()),
    )
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création contact"))?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "contacts",
            dossier_id: None,
        },
        "nature",
        &body.nature,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_contact(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

pub async fn patch_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchContactRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if let Some(ref t) = body.type_client {
        if !TYPES_CLIENT.contains(&t.as_str()) {
            return Err(ApiError::bad_request("type_client inconnu"));
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
        return lire_contact(&state, claims.cabinet_id, contact_id)
            .await
            .map(Json);
    }
    let courant = sqlx::query_as::<_, (String, Option<String>, Option<String>, String, i64)>(
        "SELECT nom, siren, numero_tva, type_client, revision FROM contacts WHERE id = $1 AND cabinet_id = $2 FOR UPDATE",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_optional(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    valider_base_revision(body.base_revision, courant.4)?;
    let mut revision = courant.4;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: contact_id,
        table_cible: "contacts",
        dossier_id: None,
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "nom",
        body.nom.as_deref(),
        &courant.0,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "siren",
        body.siren.as_deref(),
        courant.1.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "numero_tva",
        body.numero_tva.as_deref(),
        courant.2.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "type_client",
        body.type_client.as_deref(),
        &courant.3,
        &mut revision,
    )
    .await?;
    let nom_f = body.nom.as_deref().unwrap_or(&courant.0);
    let siren_f = body.siren.as_deref().or(courant.1.as_deref());
    let tva_f = body.numero_tva.as_deref().or(courant.2.as_deref());
    let type_f = body.type_client.as_deref().unwrap_or(&courant.3);
    if revision != courant.4 {
        sqlx::query(
            "UPDATE contacts SET nom = $1, siren = $2, numero_tva = $3, type_client = $4, revision = $5 WHERE id = $6",
        )
        .bind(nom_f)
        .bind(siren_f.filter(|s| !s.is_empty()))
        .bind(tva_f.filter(|s| !s.is_empty()))
        .bind(type_f)
        .bind(revision)
        .bind(contact_id)
        .execute(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
        .await
        .map_err(|_| ApiError::internal("mise à jour contact"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_contact(&state, claims.cabinet_id, contact_id)
        .await
        .map(Json)
}

pub async fn historique_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
) -> Result<Json<Vec<HistoriqueLigne>>, ApiError> {
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !existe {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let rows = sqlx::query_as::<_, (String, Option<String>, String, String)>(
        r#"
        SELECT champ, valeur_remplacee, valeur_appliquee, cree_le::text
        FROM journal_modifications
        WHERE cabinet_id = $1
          AND (
            (table_cible = 'contacts' AND enregistrement_id = $2)
            OR (
              table_cible = 'parties'
              AND enregistrement_id IN (SELECT id FROM parties WHERE contact_id = $2)
            )
          )
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(contact_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("historique"))?;
    Ok(Json(
        rows.into_iter()
            .map(|row| HistoriqueLigne {
                champ: row.0,
                valeur_remplacee: row.1,
                valeur_appliquee: row.2,
                cree_le: row.3,
            })
            .collect(),
    ))
}

pub async fn lier_dossiers(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<LierDossiersRequest>,
) -> Result<Json<LienResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if dossier_id == body.lie_a_id {
        return Err(ApiError::bad_request("Un dossier ne se lie pas à lui-même"));
    }
    if !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, dossier_id).await?
        || !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, body.lie_a_id).await?
    {
        return Err(ApiError::forbidden("Dossier non autorisé"));
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
        let inverse = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM dossier_liens WHERE dossier_id = $1 AND lie_a_id = $2",
        )
        .bind(body.lie_a_id)
        .bind(dossier_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lien de dossiers"))?;
        return Ok(Json(LienResponse {
            id: body.id,
            dossier_id,
            lie_a_id: body.lie_a_id,
            id_inverse: inverse.unwrap_or(body.id),
        }));
    }
    let id_inverse = Uuid::now_v7();
    inserer_lien(
        &mut tx,
        claims.cabinet_id,
        body.id,
        dossier_id,
        body.lie_a_id,
    )
    .await?;
    inserer_lien(
        &mut tx,
        claims.cabinet_id,
        id_inverse,
        body.lie_a_id,
        dossier_id,
    )
    .await?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "dossier_liens",
            dossier_id: Some(dossier_id),
        },
        "lie_a_id",
        &body.lie_a_id.to_string(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(LienResponse {
        id: body.id,
        dossier_id,
        lie_a_id: body.lie_a_id,
        id_inverse,
    }))
}

async fn inserer_lien(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    id: Uuid,
    dossier_id: Uuid,
    lie_a_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO dossier_liens (
            id, cabinet_id, dossier_id, lie_a_id, revision, visibilite, restreint, lie_restreint
        )
        SELECT $1, $2, $3, $4, 1,
            CASE WHEN a.visibilite = 'restreint' OR b.visibilite = 'restreint' THEN 'restreint' ELSE 'public' END,
            (a.visibilite = 'restreint' OR b.visibilite = 'restreint'),
            (b.visibilite = 'restreint')
        FROM dossiers a, dossiers b
        WHERE a.id = $3 AND b.id = $4 AND a.cabinet_id = $2 AND b.cabinet_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM dossier_liens AS deja
            WHERE deja.dossier_id = $3 AND deja.lie_a_id = $4
          )
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .bind(dossier_id)
    .bind(lie_a_id)
    .execute(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
    .await
    .map_err(|_| ApiError::internal("lien de dossiers"))?;
    Ok(())
}

async fn lire_contact(
    state: &AppState,
    cabinet_id: Uuid,
    contact_id: Uuid,
) -> Result<ContactResponse, ApiError> {
    let row = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String, i64)>(
        "SELECT nature, nom, siren, numero_tva, type_client, revision FROM contacts WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(contact_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    Ok(ContactResponse {
        id: contact_id,
        nature: row.0,
        nom: row.1,
        siren: row.2,
        numero_tva: row.3,
        type_client: row.4,
        revision: row.5,
    })
}
