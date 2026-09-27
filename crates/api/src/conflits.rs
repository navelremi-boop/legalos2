//! Dernière écriture gagnante par champ + journal des modifications (docs/conflits.md).

use sqlx::Acquire;
use uuid::Uuid;

use crate::error::ApiError;

pub struct ContexteChamp {
    pub cabinet_id: Uuid,
    pub poste_id: Uuid,
    pub auteur_id: Uuid,
    pub base_revision: i64,
    pub enregistrement_id: Uuid,
    pub table_cible: &'static str,
    /// Nul pour les enregistrements du cabinet (`cabinets`, taux sans dossier).
    pub dossier_id: Option<Uuid>,
}

/// Préfixe la clé d'idempotence par le poste (deux postes peuvent produire la même clé locale).
pub fn cle_idempotence(poste_id: Uuid, cle_locale: &str) -> String {
    format!("{poste_id}:{}", cle_locale.trim())
}

pub fn valider_base_revision(base_revision: i64, revision_serveur: i64) -> Result<(), ApiError> {
    if base_revision < 1 {
        return Err(ApiError::bad_request("Version de base invalide"));
    }
    if base_revision > revision_serveur {
        return Err(ApiError::bad_request(
            "Version de base postérieure au serveur",
        ));
    }
    Ok(())
}

/// Applique une valeur texte si elle diffère ; journalise la valeur remplacée.
/// Conflit seulement si un autre poste a écrit le champ depuis `base_revision`.
pub async fn appliquer_champ_texte(
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
    if nouvelle == actuelle {
        return Ok(());
    }
    let conflit = detecter_conflit(tx, contexte, champ).await?;
    *revision += 1;
    journaliser(tx, contexte, champ, Some(actuelle), nouvelle, *revision, conflit).await?;
    Ok(())
}

/// Variante pour un entier journalisé en décimal textuel.
pub async fn appliquer_champ_i64(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
    nouvelle: Option<i64>,
    actuelle: i64,
    revision: &mut i64,
) -> Result<(), ApiError> {
    let Some(nouvelle) = nouvelle else {
        return Ok(());
    };
    if nouvelle == actuelle {
        return Ok(());
    }
    let conflit = detecter_conflit(tx, contexte, champ).await?;
    *revision += 1;
    journaliser(
        tx,
        contexte,
        champ,
        Some(&actuelle.to_string()),
        &nouvelle.to_string(),
        *revision,
        conflit,
    )
    .await?;
    Ok(())
}

/// Variante pour un entier i32 (minutes).
pub async fn appliquer_champ_i32(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
    nouvelle: Option<i32>,
    actuelle: i32,
    revision: &mut i64,
) -> Result<(), ApiError> {
    let Some(nouvelle) = nouvelle else {
        return Ok(());
    };
    if nouvelle == actuelle {
        return Ok(());
    }
    let conflit = detecter_conflit(tx, contexte, champ).await?;
    *revision += 1;
    journaliser(
        tx,
        contexte,
        champ,
        Some(&actuelle.to_string()),
        &nouvelle.to_string(),
        *revision,
        conflit,
    )
    .await?;
    Ok(())
}

async fn detecter_conflit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
) -> Result<bool, ApiError> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM journal_modifications
            WHERE enregistrement_id = $1
              AND champ = $2
              AND revision_appliquee > $3
              AND poste_id IS DISTINCT FROM $4
        )
        "#,
    )
    .bind(contexte.enregistrement_id)
    .bind(champ)
    .bind(contexte.base_revision)
    .bind(contexte.poste_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))
}

async fn journaliser(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
    valeur_remplacee: Option<&str>,
    valeur_appliquee: &str,
    revision_appliquee: i64,
    conflit: bool,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO journal_modifications (
            id, cabinet_id, dossier_id, table_cible, enregistrement_id, champ,
            valeur_remplacee, valeur_appliquee, revision_base, revision_appliquee,
            poste_id, auteur_id, conflit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(contexte.cabinet_id)
    .bind(contexte.dossier_id)
    .bind(contexte.table_cible)
    .bind(contexte.enregistrement_id)
    .bind(champ)
    .bind(valeur_remplacee)
    .bind(valeur_appliquee)
    .bind(contexte.base_revision)
    .bind(revision_appliquee)
    .bind(contexte.poste_id)
    .bind(contexte.auteur_id)
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

/// Réserve la clé d'idempotence. `Ok(true)` si première écriture ; `Ok(false)` si rejeu.
pub async fn reserver_idempotence(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cle: &str,
) -> Result<bool, ApiError> {
    if cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let inserted = sqlx::query(
        r#"INSERT INTO upload_idempotence (cle) VALUES ($1) ON CONFLICT (cle) DO NOTHING"#,
    )
    .bind(cle.trim())
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Idempotence"))?;
    Ok(inserted.rows_affected() > 0)
}
