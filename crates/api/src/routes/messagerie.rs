//! Boîte de classement (§ 3.8.6 étape 1) : relève IMAP, décision, chrono.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use legalos_messagerie::{
    borner_date_entete, decider, integrer_releve, CurseurReleve, DecisionClassement,
    DossierPourClassement, EntreeClassement, FournisseurMail, MessageReleve, ParametresCompte,
    ReleveConnue, SessionActions,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::identite_envoi::ReglagesEnvoi;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ReleverQuery {
    /// Coupe la relève après N messages (test d'interruption).
    pub limite: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ReleverResponse {
    pub traites: usize,
    pub total_messages: i64,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub id: Uuid,
    pub dossier_id: Option<Uuid>,
    pub etat_classement: String,
    pub suggestion_dossier_id: Option<Uuid>,
    pub objet: String,
    pub expediteur: String,
    pub message_id: String,
}

#[derive(Debug, Serialize)]
pub struct ChronoMailResponse {
    pub id: Uuid,
    pub message_id: String,
    pub objet: String,
    pub expediteur: String,
    pub etat_classement: String,
}

pub async fn relever_classement(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(query): Query<ReleverQuery>,
) -> Result<Json<ReleverResponse>, ApiError> {
    let parametres = state.messagerie.as_ref().ok_or_else(|| {
        ApiError::bad_request("Messagerie de classement non configurée sur l'instance")
    })?;
    let compte_id = assurer_compte_classement(&state.pool, claims.cabinet_id, parametres).await?;
    let dossiers = charger_dossiers_classement(&state.pool, claims.cabinet_id).await?;
    let mut connue = charger_releve(&state.pool, compte_id).await?;

    let mut session = match SessionActions::connecter(parametres) {
        Ok(session) => session,
        Err(e) => {
            // Tableau de santé : la boîte de classement n'a pas de tâche de fond, ses relèves
            // sont notées ici.
            crate::moteur_mail::noter_releve(&state.pool, compte_id, Err(&e)).await;
            return Err(match e {
                legalos_messagerie::ErreurMail::Authentification => {
                    ApiError::internal("Authentification IMAP refusée")
                }
                legalos_messagerie::ErreurMail::Connexion => {
                    ApiError::internal("Connexion IMAP impossible")
                }
                legalos_messagerie::ErreurMail::Protocole => {
                    ApiError::internal("Protocole IMAP refusé à la connexion")
                }
            });
        }
    };
    // Le curseur ne vaut que pour la UIDVALIDITY où il a été lu : la comparaison se fait dans la
    // relève, avant la requête (un serveur réinitialisé repart du début de la boîte).
    let apres = (connue.dernier_uid > 0).then_some(CurseurReleve {
        uid_validity: connue.uid_validity,
        dernier_uid: connue.dernier_uid,
    });
    let (uid_validity, entetes) = session
        .relever_entetes("INBOX", apres, query.limite)
        .map_err(|_| ApiError::internal("Relève IMAP refusée"))?;
    crate::moteur_mail::noter_releve(&state.pool, compte_id, Ok(())).await;

    let lots: Vec<MessageReleve> = entetes
        .iter()
        .map(|e| MessageReleve {
            uid: e.uid,
            identifiant: e.message_id.clone(),
        })
        .collect();
    let neufs = integrer_releve(&mut connue, uid_validity, &lots);
    let maintenant = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut traites = 0usize;

    for neuf in &neufs {
        let entete = entetes
            .iter()
            .find(|e| e.uid == neuf.uid)
            .ok_or_else(|| ApiError::internal("En-tête manquant après relève"))?;
        let decision = decider(
            &EntreeClassement {
                destinataires: entete.destinataires.clone(),
                objet: entete.objet.clone(),
                expediteur: entete.expediteur.clone(),
            },
            &dossiers,
        );
        inserer_message(
            &state.pool,
            claims.cabinet_id,
            compte_id,
            uid_validity,
            entete.uid,
            &entete.message_id,
            &entete.objet,
            &entete.expediteur,
            &entete.destinataires.join(", "),
            &entete.pieces.join("\n"),
            borner_date_entete(entete.date, maintenant),
            &decision,
        )
        .await?;
        traites += 1;
    }

    sauver_releve(&state.pool, compte_id, &connue).await?;
    let total = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)::bigint FROM messages WHERE compte_id = $1"#,
    )
    .bind(compte_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Comptage messages"))?;

    Ok(Json(ReleverResponse {
        traites,
        total_messages: total,
    }))
}

/// Le message existe dans le cabinet et l'utilisateur peut le lire : boîte nominative de son
/// titulaire, boîte partagée de ses membres, boîte de classement du cabinet (dossier restreint
/// fermé aux autres). Un message illisible est introuvable, comme un message absent.
pub(crate) async fn message_lisible(
    pool: &PgPool,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    message_id: Uuid,
) -> Result<bool, ApiError> {
    let lisible = sqlx::query_scalar::<_, Option<bool>>(
        r#"
        SELECT message_lisible_par(m.compte_id, m.dossier_id, $3)
        FROM messages m
        WHERE m.id = $1 AND m.cabinet_id = $2
        "#,
    )
    .bind(message_id)
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des droits du message"))?;
    Ok(lisible.flatten().unwrap_or(false))
}

pub async fn lister_messages(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            Option<Uuid>,
            String,
            Option<Uuid>,
            String,
            String,
            String,
        ),
    >(
        r#"
        SELECT id, dossier_id, etat_classement, suggestion_dossier_id, objet, expediteur, message_id
        FROM messages
        WHERE cabinet_id = $1 AND message_lisible_par(compte_id, dossier_id, $2)
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture messages"))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| MessageResponse {
                id: r.0,
                dossier_id: r.1,
                etat_classement: r.2,
                suggestion_dossier_id: r.3,
                objet: r.4,
                expediteur: r.5,
                message_id: r.6,
            })
            .collect(),
    ))
}

#[derive(Debug, Serialize)]
pub struct CorpsMessage {
    pub texte: String,
}

pub async fn lire_corps_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(message_id): Path<Uuid>,
) -> Result<Json<CorpsMessage>, ApiError> {
    let row = sqlx::query_as::<_, (i64, String, Uuid, String)>(
        r#"
        SELECT m.uid, m.dossier_imap, m.compte_id, a.type_compte
        FROM messages m
        INNER JOIN comptes_mail a ON a.id = m.compte_id
        WHERE m.id = $1 AND m.cabinet_id = $2
          AND message_lisible_par(m.compte_id, m.dossier_id, $3)
        "#,
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture message"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;

    if let Some(texte) = sqlx::query_scalar::<_, String>(
        "SELECT texte_brut FROM contenus_messages WHERE message_id_ref = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture corps"))?
    {
        return Ok(Json(CorpsMessage { texte }));
    }

    let uid = u32::try_from(row.0).map_err(|_| ApiError::bad_request("UID invalide"))?;
    if uid == 0 {
        return Err(ApiError::bad_request("UID invalide"));
    }
    let dossier = if row.1.is_empty() {
        "INBOX".to_owned()
    } else {
        row.1
    };
    // Identifiants du compte : mot de passe déchiffré, ou jeton d'accès OAuth renouvelé au besoin.
    let parametres = crate::routes::redaction::parametres_imap_depuis(
        &state.pool,
        &state.totp_cipher_key,
        state.messagerie.as_ref(),
        row.2,
        &row.3,
    )
    .await?;
    let corps = tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        session.lire_corps(&dossier, uid)
    })
    .await
    .map_err(|_| ApiError::internal("Lecture interrompue"))?
    .map_err(|_| ApiError::internal("Lecture IMAP refusée"))?;

    sqlx::query(
        r#"
        INSERT INTO contenus_messages (message_id_ref, cabinet_id, html_nettoye, texte_brut)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (message_id_ref) DO UPDATE
            SET html_nettoye = EXCLUDED.html_nettoye,
                texte_brut = EXCLUDED.texte_brut,
                revision = contenus_messages.revision + 1
        "#,
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .bind(&corps.html)
    .bind(&corps.texte)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Enregistrement du corps"))?;

    Ok(Json(CorpsMessage { texte: corps.texte }))
}

pub async fn accepter_suggestion(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(message_id): Path<Uuid>,
) -> Result<Json<MessageResponse>, ApiError> {
    if !message_lisible(&state.pool, claims.cabinet_id, claims.sub, message_id).await? {
        return Err(ApiError::not_found("Suggestion introuvable"));
    }
    let suggestion = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT suggestion_dossier_id
        FROM messages
        WHERE id = $1 AND cabinet_id = $2 AND etat_classement = 'suggestion'
          AND suggestion_dossier_id IS NOT NULL
        "#,
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture suggestion"))?
    .ok_or_else(|| ApiError::not_found("Suggestion introuvable"))?;

    let dossier_id = suggestion;
    let (visibilite, restreint) = sqlx::query_as::<_, (String, bool)>(
        r#"SELECT visibilite, restreint FROM dossiers WHERE id = $1"#,
    )
    .bind(dossier_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Visibilité dossier"))?;

    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Option<Uuid>, String, String, String)>(
        r#"
        UPDATE messages
        SET dossier_id = $3,
            etat_classement = 'classe',
            suggestion_dossier_id = NULL,
            revision = revision + 1,
            visibilite = $4,
            restreint = $5
        WHERE id = $1 AND cabinet_id = $2
        RETURNING id, dossier_id, etat_classement, suggestion_dossier_id, objet, expediteur, message_id
        "#,
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .bind(dossier_id)
    .bind(visibilite)
    .bind(restreint)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Acceptation suggestion"))?;

    Ok(Json(MessageResponse {
        id: row.0,
        dossier_id: row.1,
        etat_classement: row.2,
        suggestion_dossier_id: row.3,
        objet: row.4,
        expediteur: row.5,
        message_id: row.6,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ClasserCorps {
    pub dossier_id: Uuid,
}

pub async fn classer_message(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(message_id): Path<Uuid>,
    Json(corps): Json<ClasserCorps>,
) -> Result<Json<MessageResponse>, ApiError> {
    if !message_lisible(&state.pool, claims.cabinet_id, claims.sub, message_id).await? {
        return Err(ApiError::not_found("Message introuvable"));
    }
    let etat = sqlx::query_scalar::<_, String>(
        "SELECT etat_classement FROM messages WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture message"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
    if etat != "a_classer" && etat != "suggestion" {
        return Err(ApiError::bad_request("Message déjà classé"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, corps.dossier_id).await? {
        return Err(ApiError::not_found("Dossier introuvable"));
    }
    let (visibilite, restreint) = sqlx::query_as::<_, (String, bool)>(
        "SELECT visibilite, restreint FROM dossiers WHERE id = $1",
    )
    .bind(corps.dossier_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Visibilité dossier"))?;
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Option<Uuid>, String, String, String)>(
        r#"
        UPDATE messages
        SET dossier_id = $3,
            etat_classement = 'classe',
            suggestion_dossier_id = NULL,
            revision = revision + 1,
            visibilite = $4,
            restreint = $5
        WHERE id = $1 AND cabinet_id = $2
          AND etat_classement IN ('a_classer', 'suggestion')
        RETURNING id, dossier_id, etat_classement, suggestion_dossier_id, objet, expediteur, message_id
        "#,
    )
    .bind(message_id)
    .bind(claims.cabinet_id)
    .bind(corps.dossier_id)
    .bind(visibilite)
    .bind(restreint)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Classement du message"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
    Ok(Json(MessageResponse {
        id: row.0,
        dossier_id: row.1,
        etat_classement: row.2,
        suggestion_dossier_id: row.3,
        objet: row.4,
        expediteur: row.5,
        message_id: row.6,
    }))
}

pub async fn chrono_mails_dossier(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(dossier_id): Path<Uuid>,
) -> Result<Json<Vec<ChronoMailResponse>>, ApiError> {
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::not_found("Dossier introuvable"));
    }
    let rows = sqlx::query_as::<_, (Uuid, String, String, String, String)>(
        r#"
        SELECT id, message_id, objet, expediteur, etat_classement
        FROM messages
        WHERE cabinet_id = $1 AND dossier_id = $2 AND etat_classement = 'classe'
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(dossier_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture chrono mails"))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| ChronoMailResponse {
                id: r.0,
                message_id: r.1,
                objet: r.2,
                expediteur: r.3,
                etat_classement: r.4,
            })
            .collect(),
    ))
}

pub async fn assurer_compte_classement(
    pool: &PgPool,
    cabinet_id: Uuid,
    parametres: &ParametresCompte,
) -> Result<Uuid, ApiError> {
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM comptes_mail WHERE cabinet_id = $1 AND type_compte = 'classement'"#,
    )
    .bind(cabinet_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture compte classement"))?
    {
        return Ok(id);
    }
    let id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
        VALUES ($1, $2, 'classement', NULL, $3, 'env:MESSAGERIE_IMAP')
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .bind(&parametres.utilisateur)
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("Création compte classement"))?;
    Ok(id)
}

async fn charger_dossiers_classement(
    pool: &PgPool,
    cabinet_id: Uuid,
) -> Result<Vec<DossierPourClassement>, ApiError> {
    let dossiers = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT id, reference, etape
        FROM dossiers
        WHERE cabinet_id = $1 AND reference IS NOT NULL
        "#,
    )
    .bind(cabinet_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture dossiers classement"))?;

    let mut sortie = Vec::with_capacity(dossiers.len());
    for (id, reference, etape) in dossiers {
        let emails = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT lower(c.email)
            FROM parties p
            INNER JOIN contacts c ON c.id = p.contact_id
            WHERE p.dossier_id = $1 AND c.email IS NOT NULL
            "#,
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|_| ApiError::internal("Lecture correspondants"))?;
        sortie.push(DossierPourClassement {
            id: id.to_string(),
            reference,
            actif: etape != "clos",
            correspondants: emails,
        });
    }
    Ok(sortie)
}

async fn charger_releve(pool: &PgPool, compte_id: Uuid) -> Result<ReleveConnue, ApiError> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT uid_validity, dernier_uid
        FROM releve_curseurs
        WHERE compte_id = $1 AND dossier_imap = 'INBOX'
        "#,
    )
    .bind(compte_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture curseur relève"))?;

    let identifiants =
        sqlx::query_scalar::<_, String>(r#"SELECT message_id FROM messages WHERE compte_id = $1"#)
            .bind(compte_id)
            .fetch_all(pool)
            .await
            .map_err(|_| ApiError::internal("Lecture identifiants relève"))?;

    let (uid_validity, dernier_uid) = row.unwrap_or((0, 0));
    Ok(ReleveConnue {
        uid_validity: u32::try_from(uid_validity).unwrap_or(0),
        dernier_uid: u32::try_from(dernier_uid).unwrap_or(0),
        identifiants,
    })
}

async fn sauver_releve(
    pool: &PgPool,
    compte_id: Uuid,
    connue: &ReleveConnue,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO releve_curseurs (compte_id, dossier_imap, uid_validity, dernier_uid)
        VALUES ($1, 'INBOX', $2, $3)
        ON CONFLICT (compte_id, dossier_imap) DO UPDATE
        SET uid_validity = EXCLUDED.uid_validity,
            dernier_uid = EXCLUDED.dernier_uid
        "#,
    )
    .bind(compte_id)
    .bind(i64::from(connue.uid_validity))
    .bind(i64::from(connue.dernier_uid))
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("Écriture curseur relève"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn inserer_message(
    pool: &PgPool,
    cabinet_id: Uuid,
    compte_id: Uuid,
    uid_validity: u32,
    uid: u32,
    message_id: &str,
    objet: &str,
    expediteur: &str,
    destinataires: &str,
    pieces: &str,
    date_entete: Option<i64>,
    decision: &DecisionClassement,
) -> Result<(), ApiError> {
    let id = Uuid::now_v7();
    let (etat, dossier_id, suggestion) = match decision {
        DecisionClassement::Classe { dossier_id } => {
            let dossier = Uuid::parse_str(dossier_id)
                .map_err(|_| ApiError::internal("Identifiant dossier invalide"))?;
            ("classe", Some(dossier), None)
        }
        DecisionClassement::Suggestion { dossier_id } => {
            let dossier = Uuid::parse_str(dossier_id)
                .map_err(|_| ApiError::internal("Identifiant dossier invalide"))?;
            ("suggestion", None, Some(dossier))
        }
        DecisionClassement::AClasser => ("a_classer", None, None),
    };

    sqlx::query(
        r#"
        INSERT INTO messages (
            id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
            objet, expediteur, destinataires_texte, pieces_texte, etat_classement, suggestion_dossier_id,
            date_entete
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, to_timestamp($14::bigint)
        )
        ON CONFLICT (compte_id, message_id) DO NOTHING
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .bind(compte_id)
    .bind(dossier_id)
    .bind(message_id)
    .bind(i64::from(uid_validity))
    .bind(i64::from(uid))
    .bind(objet)
    .bind(expediteur)
    .bind(destinataires)
    .bind(pieces)
    .bind(etat)
    .bind(suggestion)
    .bind(date_entete)
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("Insertion message"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CreerCompte {
    pub id: Uuid,
    pub adresse: String,
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    pub tls: Option<bool>,
    /// SMTP et `Reply-To` du compte (facultatifs, voir `identite_envoi`).
    #[serde(flatten)]
    pub envoi: ReglagesEnvoi,
}

#[derive(Debug, Serialize)]
pub struct CompteCree {
    pub id: Uuid,
    pub adresse: String,
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
}

pub async fn creer_compte_nominatif(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerCompte>,
) -> Result<Json<CompteCree>, ApiError> {
    crate::routes::connexion_boites::valider_connexion(
        &body.hote,
        body.port,
        &body.utilisateur,
        &body.mot_de_passe,
    )?;
    let secret =
        crate::moteur_mail::chiffrer_mot_de_passe(&body.mot_de_passe, &state.totp_cipher_key)
            .map_err(|_| ApiError::internal("Chiffrement"))?;
    let envoi = body.envoi.preparer(&state.totp_cipher_key)?;
    sqlx::query(
        r#"
        INSERT INTO comptes_mail (
            id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref,
            hote, port, utilisateur, tls, secret_chiffre,
            smtp_hote, smtp_port, smtp_utilisateur, smtp_secret_chiffre, repondre_a, smtp_chiffrement
        ) VALUES ($1, $2, 'nominatif', $3, $4, 'chiffre', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(&body.adresse)
    .bind(&body.hote)
    .bind(i32::from(body.port))
    .bind(&body.utilisateur)
    .bind(body.tls.unwrap_or(false))
    .bind(&secret)
    .bind(&envoi.smtp_hote)
    .bind(envoi.smtp_port)
    .bind(&envoi.smtp_utilisateur)
    .bind(&envoi.smtp_secret_chiffre)
    .bind(&envoi.repondre_a)
    .bind(&envoi.smtp_chiffrement)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Création compte nominatif"))?;
    Ok(Json(CompteCree {
        id: body.id,
        adresse: body.adresse,
        hote: body.hote,
        port: body.port,
        utilisateur: body.utilisateur,
    }))
}
