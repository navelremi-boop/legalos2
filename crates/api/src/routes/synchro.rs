//! Boîte nominative (§ 3.8.6 étape 3) : relève, IDLE, actions IMAP, recherche.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use legalos_messagerie::{
    chemin_veille, CheminVeille, CurseurDossier, FournisseurMail, SessionActions, VeilleReception,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::routes::messagerie::assurer_compte_classement;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ReleveNominatif {
    pub chemin: String,
    pub resynchronisation: bool,
    pub ajoutes: usize,
    pub uid_validity: i64,
    pub dernier_uid: i64,
}

#[derive(Debug, Serialize)]
pub struct AttenteNominatif {
    pub notifie: bool,
    pub chemin: String,
}

#[derive(Debug, Deserialize)]
pub struct UidCorps {
    pub uid: u32,
    pub lu: Option<bool>,
    pub destination: Option<String>,
    pub drapeau: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActionNominatif {
    pub applique: bool,
    pub lu: bool,
}

#[derive(Debug, Deserialize)]
pub struct RechercheQuery {
    pub q: String,
}

#[derive(Debug, Serialize)]
pub struct Trouve {
    pub message_id: String,
    pub objet: String,
    pub texte: String,
}

#[derive(Debug, Deserialize)]
pub struct ContenuQuery {
    pub message_id: String,
}

#[derive(Debug, Serialize)]
pub struct Contenu {
    pub html: String,
    pub texte: String,
    pub lu: bool,
    pub uid: i64,
}

pub async fn relever_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<ReleveNominatif>, ApiError> {
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let compte = assurer_compte_classement(&state.pool, claims.cabinet_id, imap).await?;
    let mut session = SessionActions::connecter(imap).map_err(|_| ApiError::internal("Connexion IMAP"))?;
    let caps = session
        .capacites()
        .map_err(|_| ApiError::internal("Capacités IMAP"))?;
    let chemin = chemin_de(chemin_veille(&caps));
    let (connu_validity, dernier_uid) = curseur(&state, compte).await?;
    let suite = session
        .relever_dossier(
            "INBOX",
            connu_validity.map(|v| CurseurDossier {
                uid_validity: u32::try_from(v).unwrap_or(0),
            }),
        )
        .map_err(|_| ApiError::internal("Examen IMAP"))?;
    let (resynchronisation, uid_validity, apres) = match suite {
        legalos_messagerie::SuiteDossier::Incrementale { uid_validity } => {
            (false, uid_validity, Some(dernier_uid))
        }
        legalos_messagerie::SuiteDossier::ResynchronisationComplete { uid_validity } => {
            (true, uid_validity, None)
        }
    };
    let (_, entetes) = session
        .relever_entetes(
            "INBOX",
            apres.filter(|uid| *uid > 0),
            None,
        )
        .map_err(|_| ApiError::internal("Relève IMAP"))?;
    let mut ajoutes = 0usize;
    let mut max_uid = 0u32;
    for entete in entetes {
        max_uid = max_uid.max(entete.uid);
        let deja = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM messages WHERE compte_id = $1 AND message_id = $2",
        )
        .bind(compte)
        .bind(&entete.message_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Lecture message"))?;
        if deja > 0 {
            continue;
        }
        let corps = session
            .lire_corps("INBOX", entete.uid)
            .map_err(|_| ApiError::internal("Lecture corps IMAP"))?;
        let id = Uuid::now_v7();
        sqlx::query(
            r#"
            INSERT INTO messages (
                id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
                objet, expediteur, etat_classement, visibilite, restreint, dossier_imap, lu
            ) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,'a_classer','public',false,'INBOX',$9)
            "#,
        )
        .bind(id)
        .bind(claims.cabinet_id)
        .bind(compte)
        .bind(&entete.message_id)
        .bind(i64::from(uid_validity))
        .bind(i64::from(corps.uid))
        .bind(&corps.objet)
        .bind(&corps.expediteur)
        .bind(corps.lu)
        .execute(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Insertion message nominatif"))?;
        sqlx::query(
            r#"
            INSERT INTO contenus_messages (message_id_ref, cabinet_id, html_nettoye, texte_brut)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(id)
        .bind(claims.cabinet_id)
        .bind(&corps.html)
        .bind(&corps.texte)
        .execute(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Insertion contenu"))?;
        ajoutes += 1;
    }
    sauver_curseur(&state, compte, i64::from(uid_validity), i64::from(max_uid)).await?;
    Ok(Json(ReleveNominatif {
        chemin,
        resynchronisation,
        ajoutes,
        uid_validity: i64::from(uid_validity),
        dernier_uid: i64::from(max_uid),
    }))
}

pub async fn attendre_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(_claims): AuthAccess,
) -> Result<Json<AttenteNominatif>, ApiError> {
    let imap = state
        .messagerie
        .clone()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let notifie = tokio::task::spawn_blocking(move || {
        let veille = VeilleReception::ouvrir(&imap)?;
        let chemin = chemin_de(veille.chemin());
        let recu = veille.attendre(Duration::from_secs(12))?;
        Ok::<_, legalos_messagerie::ErreurMail>((recu, chemin))
    })
    .await
    .map_err(|_| ApiError::internal("Veille interrompue"))?
    .map_err(|_| ApiError::internal("Veille IMAP"))?;
    Ok(Json(AttenteNominatif {
        notifie: notifie.0,
        chemin: notifie.1,
    }))
}

pub async fn marquer_lu(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let lu = corps.lu.unwrap_or(true);
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let mut session = SessionActions::connecter(imap).map_err(|_| ApiError::internal("Connexion IMAP"))?;
    match session.marquer_lu("INBOX", corps.uid, lu) {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE messages SET lu = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3 AND dossier_imap = 'INBOX'",
            )
            .bind(lu)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            Ok(Json(ActionNominatif { applique: true, lu }))
        }
        Err(_) => {
            let reel = session.lire_lu("INBOX", corps.uid).unwrap_or(!lu);
            Ok(Json(ActionNominatif {
                applique: false,
                lu: reel,
            }))
        }
    }
}

pub async fn deplacer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let destination = corps
        .destination
        .filter(|d| !d.is_empty())
        .ok_or_else(|| ApiError::bad_request("Dossier de destination absent"))?;
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let mut session = SessionActions::connecter(imap).map_err(|_| ApiError::internal("Connexion IMAP"))?;
    match session.deplacer("INBOX", corps.uid, &destination) {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE messages SET dossier_imap = $1, revision = revision + 1 WHERE cabinet_id = $2 AND uid = $3",
            )
            .bind(&destination)
            .bind(claims.cabinet_id)
            .bind(i64::from(corps.uid))
            .execute(&state.pool)
            .await;
            Ok(Json(ActionNominatif {
                applique: true,
                lu: false,
            }))
        }
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: session.lire_lu("INBOX", corps.uid).unwrap_or(false),
        })),
    }
}

pub async fn supprimer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let mut session = SessionActions::connecter(imap).map_err(|_| ApiError::internal("Connexion IMAP"))?;
    match session.supprimer("INBOX", corps.uid) {
        Ok(()) => {
            let _ = sqlx::query("DELETE FROM messages WHERE cabinet_id = $1 AND uid = $2 AND dossier_imap = 'INBOX'")
                .bind(claims.cabinet_id)
                .bind(i64::from(corps.uid))
                .execute(&state.pool)
                .await;
            Ok(Json(ActionNominatif {
                applique: true,
                lu: false,
            }))
        }
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: session.lire_lu("INBOX", corps.uid).unwrap_or(false),
        })),
    }
}

pub async fn poser_drapeau(
    State(state): State<Arc<AppState>>,
    AuthAccess(_claims): AuthAccess,
    Json(corps): Json<UidCorps>,
) -> Result<Json<ActionNominatif>, ApiError> {
    let drapeau = corps
        .drapeau
        .filter(|d| !d.is_empty())
        .ok_or_else(|| ApiError::bad_request("Drapeau absent"))?;
    let imap = state
        .messagerie
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
    let mut session = SessionActions::connecter(imap).map_err(|_| ApiError::internal("Connexion IMAP"))?;
    match session.poser_drapeau("INBOX", corps.uid, &drapeau) {
        Ok(()) => Ok(Json(ActionNominatif {
            applique: true,
            lu: session.lire_lu("INBOX", corps.uid).unwrap_or(false),
        })),
        Err(_) => Ok(Json(ActionNominatif {
            applique: false,
            lu: session.lire_lu("INBOX", corps.uid).unwrap_or(false),
        })),
    }
}

pub async fn rechercher(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(q): Query<RechercheQuery>,
) -> Result<Json<Vec<Trouve>>, ApiError> {
    if q.q.trim().is_empty() {
        return Err(ApiError::bad_request("Recherche vide"));
    }
    let rows = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT m.message_id, m.objet, c.texte_brut
        FROM contenus_messages c
        INNER JOIN messages m ON m.id = c.message_id_ref
        WHERE c.cabinet_id = $1
          AND c.texte_tsv @@ plainto_tsquery('french', $2)
        ORDER BY c.cree_le DESC
        LIMIT 20
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.q)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Recherche messages"))?;
    Ok(Json(
        rows.into_iter()
            .map(|r| Trouve {
                message_id: r.0,
                objet: r.1,
                texte: r.2,
            })
            .collect(),
    ))
}

pub async fn lire_contenu(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(q): Query<ContenuQuery>,
) -> Result<Json<Contenu>, ApiError> {
    let row = sqlx::query_as::<_, (String, String, bool, i64)>(
        r#"
        SELECT c.html_nettoye, c.texte_brut, m.lu, m.uid
        FROM contenus_messages c
        INNER JOIN messages m ON m.id = c.message_id_ref
        WHERE m.cabinet_id = $1 AND m.message_id = $2
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&q.message_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture contenu"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
    Ok(Json(Contenu {
        html: row.0,
        texte: row.1,
        lu: row.2,
        uid: row.3,
    }))
}

fn chemin_de(chemin: CheminVeille) -> String {
    match chemin {
        CheminVeille::Qresync => "qresync".into(),
        CheminVeille::Repli => "repli".into(),
    }
}

async fn curseur(state: &AppState, compte: Uuid) -> Result<(Option<i64>, u32), ApiError> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT uid_validity, dernier_uid FROM releve_curseurs WHERE compte_id = $1 AND dossier_imap = 'INBOX'",
    )
    .bind(compte)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture curseur"))?;
    Ok(match row {
        Some((validity, dernier)) => (Some(validity), u32::try_from(dernier).unwrap_or(0)),
        None => (None, 0),
    })
}

async fn sauver_curseur(
    state: &AppState,
    compte: Uuid,
    uid_validity: i64,
    dernier_uid: i64,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO releve_curseurs (compte_id, dossier_imap, uid_validity, dernier_uid)
        VALUES ($1, 'INBOX', $2, $3)
        ON CONFLICT (compte_id, dossier_imap)
        DO UPDATE SET uid_validity = EXCLUDED.uid_validity, dernier_uid = EXCLUDED.dernier_uid
        "#,
    )
    .bind(compte)
    .bind(uid_validity)
    .bind(dernier_uid)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Écriture curseur"))?;
    Ok(())
}
