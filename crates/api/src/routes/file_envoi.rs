//! File d'envoi (§ 3.8.3 / étape 2). Message-ID unique, copie Envoyés confirmée.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use legalos_messagerie::{
    appliquer, decider_action, envoyer_message_fixe, octets_rfc822, ActionEnvoi, EntreeFileEnvoi,
    EtatFileEnvoi, SessionActions,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::routes::dossiers::dossier_visible;
use crate::routes::messagerie::assurer_compte_classement;
use crate::state::AppState;

const DOSSIER_ENVOYES: &str = "Sent";

#[derive(Debug, Deserialize)]
pub struct CreerEnvoiBody {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub dossier_id: Uuid,
    pub destinataire: String,
    pub objet: String,
    pub corps: String,
    /// Si absent, généré une seule fois ici.
    pub message_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileEnvoiResponse {
    pub id: Uuid,
    pub dossier_id: Option<Uuid>,
    pub message_id: String,
    pub destinataire: String,
    pub objet: String,
    pub etat: String,
    pub tentatives: i32,
}

#[derive(Debug, Deserialize)]
pub struct TraiterQuery {
    /// `smtp` : s'arrête après acceptation SMTP (simule coupure réseau).
    pub couper_apres: Option<String>,
}

pub async fn creer_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerEnvoiBody>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, body.dossier_id).await? {
        return Err(ApiError::not_found("Dossier introuvable"));
    }
    let parametres = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let compte_id = assurer_compte_classement(&state.pool, claims.cabinet_id, parametres).await?;
    let message_id = body
        .message_id
        .unwrap_or_else(|| format!("<envoi-{}@cabinet.example>", Uuid::now_v7()));
    let message_id = if message_id.starts_with('<') {
        message_id
    } else {
        format!("<{message_id}>")
    };

    let existant = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, String, String, String, i32)>(
        r#"
        SELECT id, dossier_id, message_id, destinataire, objet, etat, tentatives
        FROM file_envoi
        WHERE compte_id = $1 AND message_id = $2
        "#,
    )
    .bind(compte_id)
    .bind(&message_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture file envoi"))?;
    if let Some(row) = existant {
        return Ok(Json(vers_reponse(row)));
    }

    sqlx::query(
        r#"
        INSERT INTO file_envoi (
            id, cabinet_id, compte_id, dossier_id, message_id,
            destinataire, objet, corps, etat, tentatives
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'brouillon',0)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(compte_id)
    .bind(body.dossier_id)
    .bind(&message_id)
    .bind(&body.destinataire)
    .bind(&body.objet)
    .bind(&body.corps)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Création file envoi"))?;

    charger_reponse(&state, claims.cabinet_id, body.id).await
}

pub async fn mettre_en_attente(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let mut entree = charger_entree(&state, claims.cabinet_id, id).await?;
    if entree.etat != EtatFileEnvoi::Brouillon {
        return Err(ApiError::bad_request("Seul un brouillon passe en attente"));
    }
    appliquer(&mut entree, ActionEnvoi::MettreEnAttente, true);
    sauver_entree(&state, id, &entree).await?;
    charger_reponse(&state, claims.cabinet_id, id).await
}

pub async fn annuler_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let entree = charger_entree(&state, claims.cabinet_id, id).await?;
    if entree.etat != EtatFileEnvoi::EnAttente {
        return Err(ApiError::bad_request(
            "Seul un envoi en attente est annulable",
        ));
    }
    sqlx::query(
        r#"
        UPDATE file_envoi SET etat = 'brouillon', revision = revision + 1
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Annulation envoi"))?;
    charger_reponse(&state, claims.cabinet_id, id).await
}

pub async fn traiter_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
    Query(query): Query<TraiterQuery>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let smtp = state
        .messagerie_smtp
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("SMTP de messagerie non configuré"))?;
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("IMAP de messagerie non configuré"))?;
    let (couper_smtp, forcer_echec) = match query.couper_apres.as_deref() {
        Some(v) if v.eq_ignore_ascii_case("smtp") => (true, false),
        Some(v) if v.eq_ignore_ascii_case("echec") => (false, true),
        _ => (false, false),
    };

    loop {
        let mut entree = charger_entree(&state, claims.cabinet_id, id).await?;
        if entree.etat == EtatFileEnvoi::CopieEnvoyesConfirmee {
            break;
        }
        let mut session = SessionActions::connecter(imap).map_err(map_err_mail)?;
        let deja = session
            .message_id_present(DOSSIER_ENVOYES, &entree.message_id)
            .map_err(map_err_mail)?;
        let action = decider_action(&entree, deja);
        match action {
            ActionEnvoi::Rien => break,
            ActionEnvoi::ConfirmerCopie => {
                appliquer(&mut entree, action, true);
                sauver_entree(&state, id, &entree).await?;
                classer_copie(&state, claims.cabinet_id, id, &entree).await?;
                break;
            }
            ActionEnvoi::MettreEnAttente => {
                appliquer(&mut entree, action, true);
                sauver_entree(&state, id, &entree).await?;
            }
            ActionEnvoi::EnvoyerSmtp | ActionEnvoi::Retenter => {
                let ok = if forcer_echec {
                    false
                } else {
                    let row = charger_corps(&state, claims.cabinet_id, id).await?;
                    envoyer_message_fixe(smtp, &entree.message_id, &row.0, &row.1, &row.2).is_ok()
                };
                appliquer(&mut entree, action, ok);
                sauver_entree(&state, id, &entree).await?;
                if !ok || couper_smtp {
                    break;
                }
            }
            ActionEnvoi::CopierDansEnvoyes => {
                let row = charger_corps(&state, claims.cabinet_id, id).await?;
                let octets = octets_rfc822(
                    &smtp.adresse_from,
                    &row.0,
                    &row.1,
                    &entree.message_id,
                    &row.2,
                );
                let ok = session.appender(DOSSIER_ENVOYES, &octets).is_ok();
                appliquer(&mut entree, action, ok);
                sauver_entree(&state, id, &entree).await?;
                if ok {
                    classer_copie(&state, claims.cabinet_id, id, &entree).await?;
                }
                break;
            }
        }
    }
    charger_reponse(&state, claims.cabinet_id, id).await
}

pub async fn lister_file_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<FileEnvoiResponse>>, ApiError> {
    let rows = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, String, String, String, i32)>(
        r#"
        SELECT id, dossier_id, message_id, destinataire, objet, etat, tentatives
        FROM file_envoi
        WHERE cabinet_id = $1
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture file envoi"))?;
    Ok(Json(rows.into_iter().map(vers_reponse).collect()))
}

fn map_err_mail(e: legalos_messagerie::ErreurMail) -> ApiError {
    match e {
        legalos_messagerie::ErreurMail::Authentification => {
            ApiError::internal("Authentification messagerie refusée")
        }
        legalos_messagerie::ErreurMail::Connexion => {
            ApiError::internal("Connexion messagerie impossible")
        }
        legalos_messagerie::ErreurMail::Protocole => {
            ApiError::internal("Protocole messagerie refusé")
        }
    }
}

fn vers_reponse(
    row: (Uuid, Option<Uuid>, String, String, String, String, i32),
) -> FileEnvoiResponse {
    FileEnvoiResponse {
        id: row.0,
        dossier_id: row.1,
        message_id: row.2,
        destinataire: row.3,
        objet: row.4,
        etat: row.5,
        tentatives: row.6,
    }
}

async fn charger_reponse(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, String, String, String, i32)>(
        r#"
        SELECT id, dossier_id, message_id, destinataire, objet, etat, tentatives
        FROM file_envoi WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    Ok(Json(vers_reponse(row)))
}

async fn charger_entree(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<EntreeFileEnvoi, ApiError> {
    let row = sqlx::query_as::<_, (String, String, i32)>(
        r#"
        SELECT message_id, etat, tentatives FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    let etat = EtatFileEnvoi::parse(&row.1)
        .ok_or_else(|| ApiError::internal("État file envoi inconnu"))?;
    Ok(EntreeFileEnvoi {
        message_id: row.0,
        etat,
        tentatives: u32::try_from(row.2).unwrap_or(0),
    })
}

async fn charger_corps(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<(String, String, String), ApiError> {
    sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT destinataire, objet, corps FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture corps envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))
}

async fn sauver_entree(
    state: &AppState,
    id: Uuid,
    entree: &EntreeFileEnvoi,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        UPDATE file_envoi
        SET etat = $2, tentatives = $3, revision = revision + 1
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(entree.etat.as_str())
    .bind(i32::try_from(entree.tentatives).unwrap_or(0))
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Écriture file envoi"))?;
    Ok(())
}

async fn classer_copie(
    state: &AppState,
    cabinet_id: Uuid,
    envoi_id: Uuid,
    entree: &EntreeFileEnvoi,
) -> Result<(), ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Uuid)>(
        r#"
        SELECT f.compte_id, f.dossier_id, f.objet, f.cabinet_id
        FROM file_envoi f WHERE f.id = $1 AND f.cabinet_id = $2
        "#,
    )
    .bind(envoi_id)
    .bind(cabinet_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture copie classée"))?;
    let Some(dossier_id) = row.1 else {
        return Ok(());
    };
    let (visibilite, restreint) = sqlx::query_as::<_, (String, bool)>(
        r#"SELECT visibilite, restreint FROM dossiers WHERE id = $1"#,
    )
    .bind(dossier_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Visibilité dossier"))?;
    let parametres = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("IMAP non configuré"))?;
    let smtp = state.messagerie_smtp.as_ref();
    let expediteur = smtp
        .map(|s| s.adresse_from.clone())
        .unwrap_or_else(|| parametres.utilisateur.clone());
    let uid_synthetique = {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in entree.message_id.as_bytes() {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x100000001b3);
        }
        u32::try_from(h & 0xffff_ffff).unwrap_or(1).max(1)
    };
    sqlx::query(
        r#"
        INSERT INTO messages (
            id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
            objet, expediteur, etat_classement, suggestion_dossier_id, visibilite, restreint
        ) VALUES (
            $1, $2, $3, $4, $5, 0, $6, $7, $8, 'classe', NULL, $9, $10
        )
        ON CONFLICT (compte_id, message_id) DO NOTHING
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(row.3)
    .bind(row.0)
    .bind(dossier_id)
    .bind(&entree.message_id)
    .bind(i64::from(uid_synthetique))
    .bind(&row.2)
    .bind(&expediteur)
    .bind(visibilite)
    .bind(restreint)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Insertion copie classée"))?;
    Ok(())
}
