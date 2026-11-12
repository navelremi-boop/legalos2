//! Détection et fusion des doublons de l'annuaire. Une transaction, idempotente.

use sqlx::Row;
use uuid::Uuid;

use crate::conflits::{noter_historique, ContexteChamp};
use crate::error::ApiError;

const CHAMPS: &[&str] = &[
    "nom",
    "prenoms",
    "siren",
    "email",
    "date_naissance",
    "civilite",
    "forme",
    "activite",
    "profession",
    "situation_familiale",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Doublon {
    pub id: Uuid,
    pub nom: String,
    pub motif: String,
}

pub async fn chercher_doublons(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    contact_id: Uuid,
) -> Result<Vec<Doublon>, ApiError> {
    let rows = sqlx::query(
        r#"
        WITH moi AS (
            SELECT id, cabinet_id, siren, email, nom, prenoms, date_naissance
            FROM contacts
            WHERE id = $1 AND cabinet_id = $2 AND NOT archivee
        )
        SELECT DISTINCT c.id, c.nom, motif.motif
        FROM contacts c
        JOIN moi ON moi.cabinet_id = c.cabinet_id AND c.id <> moi.id AND NOT c.archivee
        JOIN LATERAL (
            SELECT 'siren' AS motif
            WHERE NULLIF(regexp_replace(COALESCE(moi.siren, ''), '\D', '', 'g'), '') IS NOT NULL
              AND regexp_replace(COALESCE(c.siren, ''), '\D', '', 'g')
                = regexp_replace(COALESCE(moi.siren, ''), '\D', '', 'g')
            UNION ALL
            SELECT 'email'
            WHERE NULLIF(lower(btrim(COALESCE(moi.email, ''))), '') IS NOT NULL
              AND lower(btrim(COALESCE(c.email, ''))) = lower(btrim(COALESCE(moi.email, '')))
            UNION ALL
            SELECT 'email'
            WHERE EXISTS (
                SELECT 1
                FROM contact_coordonnees a
                JOIN contact_coordonnees b
                  ON b.contact_id = c.id AND b.genre = 'email'
                 AND lower(btrim(b.valeur)) = lower(btrim(a.valeur))
                WHERE a.contact_id = moi.id AND a.genre = 'email' AND btrim(a.valeur) <> ''
            )
            UNION ALL
            SELECT 'identite'
            WHERE btrim(COALESCE(moi.nom, '')) <> ''
              AND btrim(COALESCE(moi.prenoms, '')) <> ''
              AND btrim(COALESCE(moi.date_naissance, '')) <> ''
              AND normaliser_nom_contact(c.nom) = normaliser_nom_contact(moi.nom)
              AND normaliser_nom_contact(COALESCE(c.prenoms, '')) = normaliser_nom_contact(moi.prenoms)
              AND c.date_naissance = moi.date_naissance
        ) AS motif ON TRUE
        ORDER BY c.nom, motif.motif
        "#,
    )
    .bind(contact_id)
    .bind(cabinet_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("recherche de doublons"))?;
    let mut doublons = Vec::new();
    for row in rows {
        doublons.push(Doublon {
            id: row
                .try_get("id")
                .map_err(|_| ApiError::internal("recherche de doublons"))?,
            nom: row
                .try_get("nom")
                .map_err(|_| ApiError::internal("recherche de doublons"))?,
            motif: row
                .try_get("motif")
                .map_err(|_| ApiError::internal("recherche de doublons"))?,
        });
    }
    Ok(doublons)
}

pub async fn fusionner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    conservee: Uuid,
    absorbee: Uuid,
    champs_absorbes: &[String],
    contexte: Option<&ContexteChamp>,
) -> Result<(), ApiError> {
    if conservee == absorbee {
        return Err(ApiError::bad_request(
            "Une fiche ne fusionne pas avec elle-même",
        ));
    }
    for champ in champs_absorbes {
        if !CHAMPS.contains(&champ.as_str()) {
            return Err(ApiError::bad_request("Champ de fusion inconnu"));
        }
    }
    let deja = sqlx::query_as::<_, (bool, Option<Uuid>)>(
        "SELECT archivee, fusionnee_dans FROM contacts WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(absorbee)
    .bind(cabinet_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    if deja.0 && deja.1 == Some(conservee) {
        return Ok(());
    }
    if deja.0 {
        return Err(ApiError::bad_request("La fiche absorbée est déjà archivée"));
    }
    let conservee_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2 AND NOT archivee)",
    )
    .bind(conservee)
    .bind(cabinet_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !conservee_ok {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    copier_champs(tx, conservee, absorbee, champs_absorbes).await?;
    reporter_references(tx, cabinet_id, conservee, absorbee).await?;
    sqlx::query(
        r#"
        UPDATE contacts
        SET archivee = TRUE, fusionnee_dans = $2, email = NULL, revision = revision + 1
        WHERE id = $1 AND cabinet_id = $3
        "#,
    )
    .bind(absorbee)
    .bind(conservee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("archivage"))?;
    if let Some(contexte) = contexte {
        noter_historique(tx, contexte, "fusion", &absorbee.to_string()).await?;
    }
    Ok(())
}

async fn copier_champs(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    conservee: Uuid,
    absorbee: Uuid,
    champs: &[String],
) -> Result<(), ApiError> {
    if champs.is_empty() {
        return Ok(());
    }
    let liste = format!(",{},", champs.join(","));
    sqlx::query(
            r#"
            UPDATE contacts AS garde
            SET
                nom = CASE WHEN position(',nom,' in $3) > 0 THEN prise.nom ELSE garde.nom END,
                prenoms = CASE WHEN position(',prenoms,' in $3) > 0 THEN prise.prenoms ELSE garde.prenoms END,
                siren = CASE WHEN position(',siren,' in $3) > 0 THEN prise.siren ELSE garde.siren END,
                date_naissance = CASE WHEN position(',date_naissance,' in $3) > 0 THEN prise.date_naissance ELSE garde.date_naissance END,
                civilite = CASE WHEN position(',civilite,' in $3) > 0 THEN prise.civilite ELSE garde.civilite END,
                forme = CASE WHEN position(',forme,' in $3) > 0 THEN prise.forme ELSE garde.forme END,
                activite = CASE WHEN position(',activite,' in $3) > 0 THEN prise.activite ELSE garde.activite END,
                profession = CASE WHEN position(',profession,' in $3) > 0 THEN prise.profession ELSE garde.profession END,
                situation_familiale = CASE WHEN position(',situation_familiale,' in $3) > 0 THEN prise.situation_familiale ELSE garde.situation_familiale END,
                revision = garde.revision + 1
            FROM contacts AS prise
            WHERE garde.id = $1 AND prise.id = $2
            "#,
        )
    .bind(conservee)
    .bind(absorbee)
    .bind(liste)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("copie des champs"))?;
    if champs.iter().any(|champ| champ == "email") {
        sqlx::query(
            r#"
            UPDATE contacts
            SET email = CASE WHEN id = $1 THEN (SELECT email FROM contacts WHERE id = $2) ELSE NULL END
            WHERE id IN ($1, $2)
            "#,
        )
        .bind(conservee)
        .bind(absorbee)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("copie de l'e-mail"))?;
    }
    Ok(())
}

async fn reporter_references(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    conservee: Uuid,
    absorbee: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        DELETE FROM contact_liens
        WHERE cabinet_id = $1 AND (
            (contact_source_id = $2 AND contact_cible_id = $3)
            OR (contact_source_id = $3 AND contact_cible_id = $2)
        )
        "#,
    )
    .bind(cabinet_id)
    .bind(absorbee)
    .bind(conservee)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("liens entre les deux fiches"))?;
    sqlx::query(
        r#"
        UPDATE contact_liens AS moved
        SET represente_societe = FALSE
        WHERE moved.cabinet_id = $1
          AND moved.represente_societe
          AND moved.fin IS NULL
          AND moved.type_lien = 'mandat_social'
          AND (moved.contact_source_id = $2 OR moved.contact_cible_id = $2)
          AND EXISTS (
            SELECT 1 FROM contact_liens AS kept
            WHERE kept.cabinet_id = moved.cabinet_id
              AND kept.contact_cible_id = CASE WHEN moved.contact_cible_id = $2 THEN $3 ELSE moved.contact_cible_id END
              AND kept.fonction = moved.fonction
              AND kept.represente_societe
              AND kept.fin IS NULL
              AND kept.type_lien = 'mandat_social'
              AND kept.id <> moved.id
          )
        "#,
    )
    .bind(cabinet_id)
    .bind(absorbee)
    .bind(conservee)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("mandat représentant"))?;
    sqlx::query(
        r#"
        UPDATE contact_coordonnees AS moved
        SET principale = FALSE
        WHERE moved.contact_id = $2 AND moved.principale
          AND EXISTS (
            SELECT 1 FROM contact_coordonnees AS kept
            WHERE kept.contact_id = $1 AND kept.genre = moved.genre AND kept.principale
          )
        "#,
    )
    .bind(conservee)
    .bind(absorbee)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("coordonnée principale"))?;
    sqlx::query(
        "UPDATE dossier_intervenants SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("intervenants"))?;
    sqlx::query("UPDATE parties SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3")
        .bind(conservee)
        .bind(absorbee)
        .bind(cabinet_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("parties"))?;
    sqlx::query(
        "UPDATE contact_coordonnees SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("coordonnées"))?;
    sqlx::query("UPDATE factures SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3")
        .bind(conservee)
        .bind(absorbee)
        .bind(cabinet_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("factures"))?;
    sqlx::query(
        "UPDATE message_contacts SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("mails"))?;
    sqlx::query(
        "UPDATE contact_notes SET contact_id = $1 WHERE contact_id = $2 AND cabinet_id = $3",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("notes"))?;
    sqlx::query(
        r#"
        UPDATE contact_liens
        SET contact_source_id = $1
        WHERE cabinet_id = $3 AND contact_source_id = $2 AND contact_cible_id <> $1
        "#,
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("liens source"))?;
    sqlx::query(
        r#"
        UPDATE contact_liens
        SET contact_cible_id = $1
        WHERE cabinet_id = $3 AND contact_cible_id = $2 AND contact_source_id <> $1
        "#,
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("liens cible"))?;
    sqlx::query(
        "UPDATE contact_liens SET pour_le_compte_de = $1 WHERE cabinet_id = $3 AND pour_le_compte_de = $2",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("mandant"))?;
    sqlx::query(
        r#"
        DELETE FROM contact_liens AS a
        USING contact_liens AS b
        WHERE a.cabinet_id = $1 AND b.cabinet_id = $1
          AND a.id > b.id
          AND a.contact_source_id = b.contact_source_id
          AND a.contact_cible_id = b.contact_cible_id
          AND a.type_lien = b.type_lien
          AND a.fonction IS NOT DISTINCT FROM b.fonction
          AND COALESCE(a.libelle, '') = COALESCE(b.libelle, '')
        "#,
    )
    .bind(cabinet_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("doublons de liens"))?;
    Ok(())
}

pub enum EffetRetrait {
    Archive,
    Supprime,
}

pub async fn retirer_contact(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    contact_id: Uuid,
    contexte: &ContexteChamp,
) -> Result<EffetRetrait, ApiError> {
    let etat = sqlx::query_as::<_, (bool,)>(
        "SELECT archivee FROM contacts WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(contact_id)
    .bind(cabinet_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    let Some((archivee,)) = etat else {
        return Err(ApiError::not_found("Contact introuvable"));
    };
    if archivee {
        return Ok(EffetRetrait::Archive);
    }
    let lie = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM dossier_intervenants WHERE contact_id = $1 AND cabinet_id = $2
            UNION ALL
            SELECT 1 FROM parties WHERE contact_id = $1 AND cabinet_id = $2
            UNION ALL
            SELECT 1 FROM factures WHERE contact_id = $1 AND cabinet_id = $2
            UNION ALL
            SELECT 1 FROM message_contacts WHERE contact_id = $1 AND cabinet_id = $2
            UNION ALL
            SELECT 1 FROM contact_notes WHERE contact_id = $1 AND cabinet_id = $2
            UNION ALL
            SELECT 1 FROM contact_liens
            WHERE cabinet_id = $2 AND (
                contact_source_id = $1 OR contact_cible_id = $1 OR pour_le_compte_de = $1
            )
            UNION ALL
            SELECT 1 FROM contacts WHERE fusionnee_dans = $1 AND cabinet_id = $2
        )
        "#,
    )
    .bind(contact_id)
    .bind(cabinet_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("liens du contact"))?;
    if lie {
        sqlx::query(
            "UPDATE contacts SET archivee = TRUE, revision = revision + 1 WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(contact_id)
        .bind(cabinet_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("archivage"))?;
        noter_historique(tx, contexte, "archive", "archivee").await?;
        return Ok(EffetRetrait::Archive);
    }
    noter_historique(tx, contexte, "suppression", &contact_id.to_string()).await?;
    sqlx::query("DELETE FROM contact_coordonnees WHERE contact_id = $1 AND cabinet_id = $2")
        .bind(contact_id)
        .bind(cabinet_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("coordonnées"))?;
    sqlx::query("DELETE FROM contacts WHERE id = $1 AND cabinet_id = $2")
        .bind(contact_id)
        .bind(cabinet_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("suppression"))?;
    Ok(EffetRetrait::Supprime)
}
