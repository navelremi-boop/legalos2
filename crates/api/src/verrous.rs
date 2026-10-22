//! Verrous consultatifs transactionnels (`pg_advisory_xact_lock`) : tous les appels passent ici.
//!
//! sqlx garde, par connexion, une requête préparée par texte SQL, avec les types de ses paramètres. Deux appels
//! au même texte SQL qui lient des types différents (un `Uuid` ici, un `String` là) se heurtent : le second
//! réutilise la requête préparée du premier et envoie ses octets bruts dans un paramètre d'un autre type
//! (`invalid byte sequence for encoding "UTF8"`, 500 à la création d'un dossier le 22/10/2026, après qu'un
//! renouvellement de jeton OAuth avait préparé le même texte avec un `String`). Règle : **une fonction par texte
//! SQL, un seul type de liaison par fonction** ; aucun autre fichier n'écrit `pg_advisory_xact_lock`
//! (contrôle : `tests/verrous_centralises.rs`).

use sqlx::PgConnection;
use uuid::Uuid;

/// Verrou sur un texte libre (clé de boîte, d'invitation…), lié en `text`.
pub async fn verrouiller_texte(connexion: &mut PgConnection, cle: &str) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(cle)
        .execute(connexion)
        .await?;
    Ok(())
}

/// Verrou sur un identifiant (dossier, message), lié en `uuid`.
pub async fn verrouiller_uuid(connexion: &mut PgConnection, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))")
        .bind(id)
        .execute(connexion)
        .await?;
    Ok(())
}

/// Verrou de la numérotation des versions d'un document, lié en `uuid`.
pub async fn verrouiller_versions_document(
    connexion: &mut PgConnection,
    document_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(872014, hashtext($1::uuid::text))")
        .bind(document_id)
        .execute(connexion)
        .await?;
    Ok(())
}
