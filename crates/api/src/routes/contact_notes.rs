//! Notes de la fiche d'annuaire : communes au cabinet, écrites depuis le poste par la file d'envoi.
//!
//! L'auteur et la date de modification sont posés par le serveur (jeton), jamais lus du corps.

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::conflits::{
    appliquer_champ_texte, cle_idempotence, reserver_idempotence, valider_base_revision,
    ContexteChamp,
};
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerNoteContactRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub texte: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchNoteContactRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub texte: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NoteContactResponse {
    pub id: Uuid,
    pub contact_id: Uuid,
    pub texte: String,
    /// Utilisateur du jeton qui a écrit la note en dernier ; nul pour une note antérieure à la migration 065.
    pub auteur_id: Option<Uuid>,
    /// Libellé de l'auteur figé à l'écriture.
    pub auteur_libelle: Option<String>,
    pub revision: i64,
    pub cree_le: String,
    pub modifie_le: String,
}

/// Libellé d'auteur : l'adresse e-mail de l'utilisateur telle qu'enregistrée (donnée lue, rien de calculé).
///
/// La table des utilisateurs ne porte ni civilité, ni prénom, ni nom. Quand la décision sur les noms
/// d'utilisateur sera prise, ce libellé deviendra « Me Prénom Nom », lu des mêmes colonnes.
pub fn libelle_auteur_depuis_email(email: &str) -> String {
    email.trim().to_string()
}

async fn libelle_auteur(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<String, ApiError> {
    let email = sqlx::query_scalar::<_, String>(
        "SELECT email FROM utilisateurs WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(utilisateur_id)
    .bind(cabinet_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("lecture utilisateur"))?
    .ok_or_else(|| ApiError::not_found("Utilisateur introuvable"))?;
    Ok(libelle_auteur_depuis_email(&email))
}

#[utoipa::path(
    post,
    path = "/contacts/{contact_id}/notes",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Contact auquel la note se rattache")),
    request_body = CreerNoteContactRequest,
    responses(
        (status = 200, description = "Note créée ou déjà présente (rejeu par clé ou par identifiant)", body = NoteContactResponse),
        (status = 400, description = "Texte vide ou clé d'idempotence absente", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
        (status = 409, description = "Identifiant déjà utilisé par une autre note", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_note(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerNoteContactRequest>,
) -> Result<Json<NoteContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let texte = body.texte.trim();
    if texte.is_empty() {
        return Err(ApiError::bad_request("Texte de la note requis"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let existant = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT cabinet_id, contact_id FROM contact_notes WHERE id = $1",
    )
    .bind(body.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture note"))?;
    match existant {
        Some((cabinet, contact)) if cabinet == claims.cabinet_id && contact == contact_id => {
            tx.commit()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?;
            return lire_note(&state.pool, claims.cabinet_id, body.id)
                .await
                .map(Json);
        }
        Some(_) => return Err(ApiError::conflict("Identifiant déjà utilisé")),
        None => {}
    }
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_note(&state.pool, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !existe {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let libelle = libelle_auteur(&mut tx, claims.cabinet_id, claims.sub).await?;
    sqlx::query(
        r#"
        INSERT INTO contact_notes (
            id, cabinet_id, contact_id, texte, auteur_id, auteur_libelle, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(contact_id)
    .bind(texte)
    .bind(claims.sub)
    .bind(&libelle)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("création note"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_note(&state.pool, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

#[utoipa::path(
    patch,
    path = "/contact-notes/{note_id}",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("note_id" = Uuid, Path, description = "Identifiant de la note")),
    request_body = PatchNoteContactRequest,
    responses(
        (status = 200, description = "Note modifiée, ou déjà dans cet état (rejeu)", body = NoteContactResponse),
        (status = 400, description = "Texte vide ou absent, version de base, clé d'idempotence", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Note introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_note(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(note_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchNoteContactRequest>,
) -> Result<Json<NoteContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let Some(texte) = body.texte.as_deref().map(str::trim) else {
        return Err(ApiError::bad_request("Texte de la note requis"));
    };
    if texte.is_empty() {
        return Err(ApiError::bad_request("Texte de la note requis"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let (actuel, revision_actuelle) = sqlx::query_as::<_, (String, i64)>(
        "SELECT texte, revision FROM contact_notes WHERE id = $1 AND cabinet_id = $2 FOR UPDATE",
    )
    .bind(note_id)
    .bind(claims.cabinet_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture note"))?
    .ok_or_else(|| ApiError::not_found("Note introuvable"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_note(&state.pool, claims.cabinet_id, note_id)
            .await
            .map(Json);
    }
    valider_base_revision(body.base_revision, revision_actuelle)?;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: note_id,
        table_cible: "contact_notes",
        dossier_id: None,
    };
    let mut revision = revision_actuelle;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "texte",
        Some(texte),
        &actuel,
        &mut revision,
    )
    .await?;
    if revision != revision_actuelle {
        let libelle = libelle_auteur(&mut tx, claims.cabinet_id, claims.sub).await?;
        sqlx::query(
            r#"
            UPDATE contact_notes
            SET texte = $1, revision = $2, auteur_id = $3, auteur_libelle = $4, modifie_le = NOW()
            WHERE id = $5
            "#,
        )
        .bind(texte)
        .bind(revision)
        .bind(claims.sub)
        .bind(&libelle)
        .bind(note_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("mise à jour note"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_note(&state.pool, claims.cabinet_id, note_id)
        .await
        .map(Json)
}

async fn lire_note(
    pool: &PgPool,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<NoteContactResponse, ApiError> {
    let ligne = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<Uuid>,
            Option<String>,
            i64,
            String,
            String,
        ),
    >(
        r#"
        SELECT contact_id, texte, auteur_id, auteur_libelle, revision,
               cree_le::text, modifie_le::text
        FROM contact_notes WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("lecture note"))?
    .ok_or_else(|| ApiError::not_found("Note introuvable"))?;
    Ok(NoteContactResponse {
        id,
        contact_id: ligne.0,
        texte: ligne.1,
        auteur_id: ligne.2,
        auteur_libelle: ligne.3,
        revision: ligne.4,
        cree_le: ligne.5,
        modifie_le: ligne.6,
    })
}

#[cfg(test)]
mod tests {
    use super::libelle_auteur_depuis_email;

    #[test]
    fn le_libelle_d_auteur_est_l_adresse_enregistree() {
        assert_eq!(
            libelle_auteur_depuis_email("julien.marchal@cabinet.example"),
            "julien.marchal@cabinet.example"
        );
        assert_eq!(
            libelle_auteur_depuis_email(" demo@cabinet.example "),
            "demo@cabinet.example"
        );
    }
}
