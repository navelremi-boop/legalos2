use std::collections::BTreeMap;
use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
use crate::texte_document::extraire_texte;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerDocumentRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
    pub idempotence_cle: String,
    /// Absent ou nul = racine du dossier.
    #[serde(default)]
    pub repertoire_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchDocumentRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    /// Absent = inchangé ; `null` JSON = racine.
    #[serde(default)]
    pub repertoire_id: Option<Option<Uuid>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
    pub repertoire_id: Option<Uuid>,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerRepertoireRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    pub nom: String,
    pub idempotence_cle: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchRepertoireRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    /// Absent = inchangé ; `null` JSON = racine.
    #[serde(default)]
    pub parent_id: Option<Option<Uuid>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RepertoireResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub nom: String,
    pub revision: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DepotDocument {
    pub document_id: Uuid,
    pub numero: i32,
    pub methode: &'static str,
    pub url: String,
    pub entetes: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, ToSchema, Default)]
pub struct PreparerVersionRequest {
    #[serde(default)]
    pub base_numero: Option<i32>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScellerVersionRequest {
    pub empreinte: String,
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VersionScellee {
    pub document_id: Uuid,
    pub numero: i32,
    pub empreinte: String,
    pub taille: i64,
    pub parent_numero: Option<i32>,
    pub divergence: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LectureDocument {
    pub url: String,
}

#[utoipa::path(
    post,
    path = "/repertoires",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = CreerRepertoireRequest,
    responses((status = 200, description = "Répertoire créé", body = RepertoireResponse))
)]
pub async fn creer_repertoire(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerRepertoireRequest>,
) -> Result<Json<RepertoireResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() || body.nom.trim().is_empty() {
        return Err(ApiError::bad_request("Nom et clé d'idempotence requis"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, body.dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
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
        return lire_repertoire(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    if let Some(parent_id) = body.parent_id {
        verifier_parent_repertoire(&mut tx, claims.cabinet_id, body.dossier_id, parent_id, None)
            .await?;
    }
    let insere = sqlx::query(
        r#"
        INSERT INTO repertoires (
            id, cabinet_id, dossier_id, parent_id, nom, visibilite, dossier_texte, revision
        )
        SELECT $1, $2, dossiers.id, $3, $4, dossiers.visibilite, dossiers.id::text, 1
        FROM dossiers
        WHERE dossiers.id = $5 AND dossiers.cabinet_id = $2
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.parent_id)
    .bind(body.nom.trim())
    .bind(body.dossier_id)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création répertoire"))?;
    if insere.rows_affected() != 1 {
        let deja = sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM repertoires WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(body.id)
        .bind(claims.cabinet_id)
        .fetch_optional(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("lecture répertoire"))?;
        if deja.is_none() {
            return Err(ApiError::bad_request("Dossier introuvable"));
        }
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_repertoire(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

#[utoipa::path(
    patch,
    path = "/repertoires/{repertoire_id}",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = PatchRepertoireRequest,
    responses((status = 200, description = "Répertoire mis à jour", body = RepertoireResponse))
)]
pub async fn patch_repertoire(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(repertoire_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchRepertoireRequest>,
) -> Result<Json<RepertoireResponse>, ApiError> {
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
        return lire_repertoire(&state, claims.cabinet_id, repertoire_id)
            .await
            .map(Json);
    }
    let courant = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i32)>(
        r#"
        SELECT dossier_id, parent_id, nom, revision
        FROM repertoires
        WHERE id = $1 AND cabinet_id = $2
        FOR UPDATE
        "#,
    )
    .bind(repertoire_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture répertoire"))?
    .ok_or_else(|| ApiError::not_found("Répertoire introuvable"))?;
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, courant.0).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    let revision_courante = i64::from(courant.3);
    valider_base_revision(body.base_revision, revision_courante)?;
    let mut revision = revision_courante;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: repertoire_id,
        table_cible: "repertoires",
        dossier_id: Some(courant.0),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "nom",
        body.nom.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;
    let parent_actuel = courant.1.map(|u| u.to_string()).unwrap_or_default();
    let parent_nouveau_str: Option<String> = match &body.parent_id {
        None => None,
        Some(None) => Some(String::new()),
        Some(Some(id)) => Some(id.to_string()),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "parent_id",
        parent_nouveau_str.as_deref(),
        &parent_actuel,
        &mut revision,
    )
    .await?;
    let nom_f = body.nom.as_deref().unwrap_or(&courant.2);
    let parent_f = match &body.parent_id {
        None => courant.1,
        Some(v) => *v,
    };
    if body.parent_id.is_some() {
        if let Some(parent_id) = parent_f {
            verifier_parent_repertoire(
                &mut tx,
                claims.cabinet_id,
                courant.0,
                parent_id,
                Some(repertoire_id),
            )
            .await?;
        }
    }
    if revision != revision_courante {
        if nom_f.trim().is_empty() {
            return Err(ApiError::bad_request("Nom requis"));
        }
        sqlx::query(
            r#"
            UPDATE repertoires
            SET nom = $1, parent_id = $2, revision = $3
            WHERE id = $4
            "#,
        )
        .bind(nom_f.trim())
        .bind(parent_f)
        .bind(i32::try_from(revision).map_err(|_| ApiError::internal("révision"))?)
        .bind(repertoire_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour répertoire"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_repertoire(&state, claims.cabinet_id, repertoire_id)
        .await
        .map(Json)
}

#[utoipa::path(
    post,
    path = "/documents",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = CreerDocumentRequest,
    responses((status = 200, description = "Dépôt de la version 1", body = DepotDocument))
)]
pub async fn creer_document(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerDocumentRequest>,
) -> Result<Json<DepotDocument>, ApiError> {
    if body.idempotence_cle.trim().is_empty() || body.nom.trim().is_empty() {
        return Err(ApiError::bad_request("Nom et clé d'idempotence requis"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, body.dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    if let Some(repertoire_id) = body.repertoire_id {
        verifier_repertoire_du_dossier(&state, claims.cabinet_id, body.dossier_id, repertoire_id)
            .await?;
    }
    let insere = sqlx::query(
        r#"
        INSERT INTO documents (
            id, cabinet_id, dossier_id, nom, repertoire_id, revision, visibilite, dossier_texte
        )
        SELECT $1, $2, dossiers.id, $4, $5, 1, dossiers.visibilite, dossiers.id::text
        FROM dossiers
        WHERE dossiers.id = $3 AND dossiers.cabinet_id = $2
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.dossier_id)
    .bind(body.nom.trim())
    .bind(body.repertoire_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création document"))?;
    if insere.rows_affected() == 0 {
        let deja = sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM documents WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(body.id)
        .bind(claims.cabinet_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture document"))?;
        if deja.is_none() {
            return Err(ApiError::bad_request("Dossier introuvable"));
        }
    }
    depot(&state, body.id, 1).await.map(Json)
}

#[utoipa::path(
    patch,
    path = "/documents/{document_id}",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = PatchDocumentRequest,
    responses((status = 200, description = "Document mis à jour", body = DocumentResponse))
)]
pub async fn patch_document(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(document_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchDocumentRequest>,
) -> Result<Json<DocumentResponse>, ApiError> {
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
        return lire_document(&state, claims.cabinet_id, document_id)
            .await
            .map(Json);
    }
    let courant = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i32)>(
        r#"
        SELECT dossier_id, repertoire_id, nom, revision
        FROM documents
        WHERE id = $1 AND cabinet_id = $2
        FOR UPDATE
        "#,
    )
    .bind(document_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture document"))?
    .ok_or_else(|| ApiError::not_found("Document introuvable"))?;
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, courant.0).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    let revision_courante = i64::from(courant.3);
    valider_base_revision(body.base_revision, revision_courante)?;
    let mut revision = revision_courante;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: document_id,
        table_cible: "documents",
        dossier_id: Some(courant.0),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "nom",
        body.nom.as_deref(),
        &courant.2,
        &mut revision,
    )
    .await?;
    let rep_actuel = courant.1.map(|u| u.to_string()).unwrap_or_default();
    let rep_nouveau: Option<String> = match &body.repertoire_id {
        None => None,
        Some(None) => Some(String::new()),
        Some(Some(id)) => Some(id.to_string()),
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "repertoire_id",
        rep_nouveau.as_deref(),
        &rep_actuel,
        &mut revision,
    )
    .await?;
    let nom_f = body.nom.as_deref().unwrap_or(&courant.2);
    let rep_f = match &body.repertoire_id {
        None => courant.1,
        Some(v) => *v,
    };
    if let Some(repertoire_id) = rep_f {
        let ok = sqlx::query_as::<_, (Uuid,)>(
            r#"
            SELECT id FROM repertoires
            WHERE id = $1 AND dossier_id = $2 AND cabinet_id = $3
            "#,
        )
        .bind(repertoire_id)
        .bind(courant.0)
        .bind(claims.cabinet_id)
        .fetch_optional(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("lecture répertoire"))?;
        if ok.is_none() {
            return Err(ApiError::bad_request("Répertoire hors dossier"));
        }
    }
    if revision != revision_courante {
        if nom_f.trim().is_empty() {
            return Err(ApiError::bad_request("Nom requis"));
        }
        sqlx::query(
            r#"
            UPDATE documents
            SET nom = $1, repertoire_id = $2, revision = $3
            WHERE id = $4
            "#,
        )
        .bind(nom_f.trim())
        .bind(rep_f)
        .bind(i32::try_from(revision).map_err(|_| ApiError::internal("révision"))?)
        .bind(document_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("mise à jour document"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_document(&state, claims.cabinet_id, document_id)
        .await
        .map(Json)
}

#[utoipa::path(
    post,
    path = "/documents/{document_id}/versions",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = PreparerVersionRequest,
    responses((status = 200, description = "Dépôt de la version suivante", body = DepotDocument))
)]
pub async fn preparer_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(document_id): axum::extract::Path<Uuid>,
    octets: axum::body::Bytes,
) -> Result<Json<DepotDocument>, ApiError> {
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    // Corps optionnel : s6 envoie POST sans corps (Content-Type JSON possible).
    let req = if octets.is_empty() {
        PreparerVersionRequest::default()
    } else {
        serde_json::from_slice::<PreparerVersionRequest>(&octets)
            .map_err(|_| ApiError::bad_request("Corps de préparation invalide"))?
    };
    let base_numero = req.base_numero;
    if let Some(base) = base_numero {
        if base < 1 {
            return Err(ApiError::bad_request("base_numero invalide"));
        }
        let existe = sqlx::query_as::<_, (i32,)>(
            "SELECT numero FROM document_versions WHERE document_id = $1 AND numero = $2",
        )
        .bind(document_id)
        .bind(base)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture version"))?;
        if existe.is_none() {
            return Err(ApiError::bad_request("Version de base inconnue"));
        }
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    // Verrou transactionnel : deux préparations concurrentes obtiennent des numéros distincts.
    sqlx::query("SELECT pg_advisory_xact_lock(872014, hashtext($1::text))")
        .bind(document_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("verrou version"))?;
    let numero = sqlx::query_as::<_, (i32,)>(
        r#"
        SELECT GREATEST(
            COALESCE((SELECT MAX(numero) FROM document_versions WHERE document_id = $1), 0),
            COALESCE((SELECT MAX(numero) FROM document_versions_en_cours WHERE document_id = $1), 0)
        ) + 1
        "#,
    )
    .bind(document_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("numéro de version"))?
    .0;
    sqlx::query(
        r#"
        INSERT INTO document_versions_en_cours (document_id, numero, parent_numero)
        VALUES ($1, $2, $3)
        ON CONFLICT (document_id, numero) DO UPDATE SET parent_numero = EXCLUDED.parent_numero
        "#,
    )
    .bind(document_id)
    .bind(numero)
    .bind(base_numero)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("préparation version"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    depot(&state, document_id, numero).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/documents/{document_id}/versions/{numero}/sceller",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = ScellerVersionRequest,
    responses((status = 200, description = "Version enregistrée", body = VersionScellee))
)]
pub async fn sceller_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path((document_id, numero)): axum::extract::Path<(Uuid, i32)>,
    Json(body): Json<ScellerVersionRequest>,
) -> Result<Json<VersionScellee>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    let existante = sqlx::query_as::<_, (String, i64, Option<i32>)>(
        "SELECT empreinte, taille, parent_numero FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if let Some((empreinte, taille, parent_numero)) = existante {
        let divergence = calculer_divergence(&state, document_id, numero, parent_numero).await?;
        return Ok(Json(VersionScellee {
            document_id,
            numero,
            empreinte,
            taille,
            parent_numero,
            divergence,
        }));
    }
    let parent_numero = sqlx::query_as::<_, (Option<i32>,)>(
        "SELECT parent_numero FROM document_versions_en_cours WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture préparation"))?
    .map(|r| r.0)
    .unwrap_or(None);
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let octets = stockage
        .lire(&cle_objet(document_id, numero))
        .await
        .map_err(|err| ApiError::bad_request(format!("lecture stockage : {err}")))?;
    let empreinte = hex::encode(Sha256::digest(&octets));
    if empreinte != body.empreinte.trim().to_lowercase() {
        return Err(ApiError::bad_request(
            "Empreinte différente du fichier déposé",
        ));
    }
    let taille = i64::try_from(octets.len()).unwrap_or(0);
    let nom = sqlx::query_as::<_, (String,)>(
        "SELECT nom FROM documents WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(document_id)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture document"))?
    .map(|r| r.0)
    .unwrap_or_default();
    let texte = extraire_texte(&nom, &octets);
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    sqlx::query(
        r#"
        INSERT INTO document_versions (
            id, document_id, numero, empreinte, taille, auteur_id, cle_objet,
            cabinet_id, dossier_id, visibilite, dossier_texte, texte, parent_numero
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, cabinet_id, dossier_id, visibilite, dossier_texte, $8, $9
        FROM documents WHERE id = $2
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(document_id)
    .bind(numero)
    .bind(&empreinte)
    .bind(taille)
    .bind(claims.sub)
    .bind(cle_objet(document_id, numero))
    .bind(&texte)
    .bind(parent_numero)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("scellement"))?;
    sqlx::query("DELETE FROM document_versions_en_cours WHERE document_id = $1 AND numero = $2")
        .bind(document_id)
        .bind(numero)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("nettoyage préparation"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let divergence = calculer_divergence(&state, document_id, numero, parent_numero).await?;
    Ok(Json(VersionScellee {
        document_id,
        numero,
        empreinte,
        taille,
        parent_numero,
        divergence,
    }))
}

#[utoipa::path(
    get,
    path = "/documents/{document_id}/versions/{numero}",
    tag = "documents",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Lien de lecture", body = LectureDocument))
)]
pub async fn lire_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path((document_id, numero)): axum::extract::Path<(Uuid, i32)>,
) -> Result<Json<LectureDocument>, ApiError> {
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    let presente = sqlx::query_as::<_, (i32,)>(
        "SELECT numero FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if presente.is_none() {
        return Err(ApiError::bad_request("Version inconnue"));
    }
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let url = stockage
        .url_lecture(&cle_objet(document_id, numero))
        .await
        .map_err(|_| ApiError::internal("lien de lecture"))?;
    Ok(Json(LectureDocument { url }))
}

async fn depot(
    state: &AppState,
    document_id: Uuid,
    numero: i32,
) -> Result<DepotDocument, ApiError> {
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let cle = cle_objet(document_id, numero);
    let scellee = sqlx::query_as::<_, (i32,)>(
        "SELECT numero FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if scellee.is_some() {
        return Err(ApiError::conflict("Version déjà scellée"));
    }
    if stockage
        .existe(&cle)
        .await
        .map_err(|_| ApiError::internal("lecture stockage"))?
    {
        return Err(ApiError::conflict("Objet déjà présent"));
    }
    let url = stockage
        .url_depot(&cle)
        .await
        .map_err(|_| ApiError::internal("lien de dépôt"))?;
    Ok(DepotDocument {
        document_id,
        numero,
        methode: "PUT",
        url,
        entetes: BTreeMap::new(),
    })
}

async fn verifier_document(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    document_id: Uuid,
) -> Result<(), ApiError> {
    let dossier = sqlx::query_as::<_, (Uuid,)>(
        "SELECT dossier_id FROM documents WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(document_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture document"))?
    .ok_or_else(|| ApiError::bad_request("Document introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, dossier.0).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    Ok(())
}

async fn verifier_repertoire_du_dossier(
    state: &AppState,
    cabinet_id: Uuid,
    dossier_id: Uuid,
    repertoire_id: Uuid,
) -> Result<(), ApiError> {
    let ok = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM repertoires WHERE id = $1 AND dossier_id = $2 AND cabinet_id = $3",
    )
    .bind(repertoire_id)
    .bind(dossier_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture répertoire"))?;
    if ok.is_none() {
        return Err(ApiError::bad_request("Répertoire hors dossier"));
    }
    Ok(())
}

async fn verifier_parent_repertoire(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    dossier_id: Uuid,
    parent_id: Uuid,
    exclus: Option<Uuid>,
) -> Result<(), ApiError> {
    let parent = sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
        "SELECT dossier_id, parent_id FROM repertoires WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(parent_id)
    .bind(cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture parent"))?
    .ok_or_else(|| ApiError::bad_request("Répertoire parent introuvable"))?;
    if parent.0 != dossier_id {
        return Err(ApiError::bad_request("Répertoire parent hors dossier"));
    }
    if let Some(id) = exclus {
        let mut courant = Some(parent_id);
        while let Some(courant_id) = courant {
            if courant_id == id {
                return Err(ApiError::bad_request("Cycle de répertoires"));
            }
            courant = sqlx::query_as::<_, (Option<Uuid>,)>(
                "SELECT parent_id FROM repertoires WHERE id = $1",
            )
            .bind(courant_id)
            .fetch_optional(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("parcours parent"))?
            .and_then(|r| r.0);
        }
    }
    Ok(())
}

async fn calculer_divergence(
    state: &AppState,
    document_id: Uuid,
    numero: i32,
    parent_numero: Option<i32>,
) -> Result<bool, ApiError> {
    let Some(parent) = parent_numero else {
        return Ok(false);
    };
    let autre = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM document_versions
            WHERE document_id = $1
              AND numero <> $2
              AND parent_numero = $3
        )
        "#,
    )
    .bind(document_id)
    .bind(numero)
    .bind(parent)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("divergence"))?;
    Ok(autre)
}

async fn lire_repertoire(
    state: &AppState,
    cabinet_id: Uuid,
    repertoire_id: Uuid,
) -> Result<RepertoireResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i32)>(
        r#"
        SELECT dossier_id, parent_id, nom, revision
        FROM repertoires
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(repertoire_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture répertoire"))?
    .ok_or_else(|| ApiError::not_found("Répertoire introuvable"))?;
    Ok(RepertoireResponse {
        id: repertoire_id,
        dossier_id: row.0,
        parent_id: row.1,
        nom: row.2,
        revision: i64::from(row.3),
    })
}

async fn lire_document(
    state: &AppState,
    cabinet_id: Uuid,
    document_id: Uuid,
) -> Result<DocumentResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i32)>(
        r#"
        SELECT dossier_id, repertoire_id, nom, revision
        FROM documents
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(document_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture document"))?
    .ok_or_else(|| ApiError::not_found("Document introuvable"))?;
    Ok(DocumentResponse {
        id: document_id,
        dossier_id: row.0,
        repertoire_id: row.1,
        nom: row.2,
        revision: i64::from(row.3),
    })
}

fn cle_objet(document_id: Uuid, numero: i32) -> String {
    format!("documents/{document_id}/v{numero}")
}
