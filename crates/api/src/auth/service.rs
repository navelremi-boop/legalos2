use std::sync::Arc;

use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::jwt::JwtKeys;
use crate::auth::password;
use crate::auth::totp;
use crate::error::ApiError;
use crate::state::AppState;

pub struct ConnexionResult {
    pub totp_requis: bool,
    pub access_token: Option<String>,
    pub session_token: Option<String>,
}

pub struct TotpResult {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(sqlx::FromRow)]
struct UtilisateurRow {
    id: Uuid,
    cabinet_id: Uuid,
    email: String,
    password_hash: String,
    totp_secret_chiffre: Option<String>,
    actif: bool,
    totp_obligatoire: bool,
}

#[derive(sqlx::FromRow)]
struct PosteRow {
    id: Uuid,
    revoque_le: Option<time::OffsetDateTime>,
}

const UTILISATEUR_SELECT: &str = r#"
    SELECT
        u.id,
        u.cabinet_id,
        u.email,
        u.password_hash,
        u.totp_secret_chiffre,
        u.actif,
        c.totp_obligatoire
    FROM utilisateurs u
    INNER JOIN cabinets c ON c.id = u.cabinet_id
"#;

pub async fn connexion(
    state: &AppState,
    email: &str,
    password_plain: &str,
    nom_appareil: &str,
) -> Result<ConnexionResult, ApiError> {
    let email = email.trim().to_lowercase();
    if email.is_empty() || password_plain.is_empty() || nom_appareil.trim().is_empty() {
        return Err(ApiError::bad_request("Champs de connexion incomplets"));
    }

    let user = charger_utilisateur_par_email(&state.pool, &email)
        .await?
        .ok_or_else(|| ApiError::unauthorized("Identifiants invalides"))?;

    if !user.actif {
        return Err(ApiError::unauthorized("Compte désactivé"));
    }

    if !password::verify_password(password_plain, &user.password_hash) {
        return Err(ApiError::unauthorized("Identifiants invalides"));
    }

    let poste_id =
        enregistrer_poste(&state.pool, user.cabinet_id, user.id, nom_appareil.trim()).await?;

    let totp_requis = user.totp_obligatoire
        && user
            .totp_secret_chiffre
            .as_ref()
            .is_some_and(|s| !s.is_empty());

    if totp_requis {
        let session_token = state
            .jwt
            .sign_session(
                &state.jwt_issuer,
                user.id,
                user.cabinet_id,
                poste_id,
                state.session_token_ttl_secs,
            )
            .map_err(|_| ApiError::internal("Émission du jeton de session"))?;
        return Ok(ConnexionResult {
            totp_requis: true,
            access_token: None,
            session_token: Some(session_token),
        });
    }

    let access_token = state
        .jwt
        .sign_access(
            &state.jwt_issuer,
            &state.jwt_audience,
            user.id,
            user.cabinet_id,
            poste_id,
            state.access_token_ttl_secs,
        )
        .map_err(|_| ApiError::internal("Émission du jeton d'accès"))?;

    Ok(ConnexionResult {
        totp_requis: false,
        access_token: Some(access_token),
        session_token: None,
    })
}

pub async fn verifier_totp(
    state: &AppState,
    session_token: &str,
    code_totp: &str,
) -> Result<TotpResult, ApiError> {
    if session_token.trim().is_empty() || code_totp.trim().is_empty() {
        return Err(ApiError::bad_request("Session ou code TOTP manquant"));
    }

    let claims = state
        .jwt
        .decode_session(&state.jwt_issuer, session_token.trim())
        .map_err(|_| ApiError::unauthorized("Session expirée ou invalide"))?;

    if poste_revoque(&state.pool, claims.poste_id).await? {
        return Err(ApiError::unauthorized("Poste révoqué"));
    }

    let user = charger_utilisateur_par_id(&state.pool, claims.sub)
        .await?
        .ok_or_else(|| ApiError::unauthorized("Utilisateur introuvable"))?;

    let secret_enc = user
        .totp_secret_chiffre
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Double authentification non configurée"))?;

    let secret_bytes = totp::dechiffrer_secret_totp(secret_enc, &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("Secret TOTP"))?;
    let secret_base32 =
        String::from_utf8(secret_bytes).map_err(|_| ApiError::internal("Secret TOTP"))?;

    let ok = totp::verifier_code_totp(&secret_base32, &user.email, code_totp.trim())
        .map_err(|_| ApiError::internal("Vérification TOTP"))?;
    if !ok {
        return Err(ApiError::unauthorized("Code TOTP invalide"));
    }

    mettre_a_jour_derniere_connexion(&state.pool, claims.poste_id).await?;

    let access_token = state
        .jwt
        .sign_access(
            &state.jwt_issuer,
            &state.jwt_audience,
            user.id,
            user.cabinet_id,
            claims.poste_id,
            state.access_token_ttl_secs,
        )
        .map_err(|_| ApiError::internal("Émission du jeton d'accès"))?;

    let refresh_token = state
        .jwt
        .sign_refresh(
            &state.jwt_issuer,
            user.id,
            user.cabinet_id,
            claims.poste_id,
            state.refresh_token_ttl_secs,
        )
        .map_err(|_| ApiError::internal("Émission du jeton de rafraîchissement"))?;

    Ok(TotpResult {
        access_token,
        refresh_token,
    })
}

pub fn jwks(state: &AppState) -> serde_json::Value {
    state.jwt.jwks_json()
}

async fn charger_utilisateur_par_email(
    pool: &PgPool,
    email: &str,
) -> Result<Option<UtilisateurRow>, ApiError> {
    let sql = format!("{UTILISATEUR_SELECT} WHERE LOWER(u.email) = $1");
    sqlx::query_as::<_, UtilisateurRow>(&sql)
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|_| ApiError::internal("Base de données"))
}

async fn charger_utilisateur_par_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<UtilisateurRow>, ApiError> {
    let sql = format!("{UTILISATEUR_SELECT} WHERE u.id = $1");
    sqlx::query_as::<_, UtilisateurRow>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|_| ApiError::internal("Base de données"))
}

async fn enregistrer_poste(
    pool: &PgPool,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    nom_appareil: &str,
) -> Result<Uuid, ApiError> {
    let existing = sqlx::query_as::<_, PosteRow>(
        r#"
        SELECT id, revoque_le
        FROM postes
        WHERE cabinet_id = $1 AND utilisateur_id = $2 AND nom_appareil = $3
        "#,
    )
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .bind(nom_appareil)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Base de données"))?;

    if let Some(row) = existing {
        if row.revoque_le.is_some() {
            return Err(ApiError::unauthorized("Poste révoqué"));
        }
        sqlx::query("UPDATE postes SET derniere_connexion_le = NOW() WHERE id = $1")
            .bind(row.id)
            .execute(pool)
            .await
            .map_err(|_| ApiError::internal("Base de données"))?;
        return Ok(row.id);
    }

    let poste_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO postes (id, cabinet_id, utilisateur_id, nom_appareil, derniere_connexion_le)
        VALUES ($1, $2, $3, $4, NOW())
        "#,
    )
    .bind(poste_id)
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .bind(nom_appareil)
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("Base de données"))?;

    Ok(poste_id)
}

async fn poste_revoque(pool: &PgPool, poste_id: Uuid) -> Result<bool, ApiError> {
    let row: Option<(Option<time::OffsetDateTime>,)> =
        sqlx::query_as("SELECT revoque_le FROM postes WHERE id = $1")
            .bind(poste_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| ApiError::internal("Base de données"))?;

    Ok(row.and_then(|r| r.0).is_some())
}

async fn mettre_a_jour_derniere_connexion(pool: &PgPool, poste_id: Uuid) -> Result<(), ApiError> {
    sqlx::query("UPDATE postes SET derniere_connexion_le = NOW() WHERE id = $1")
        .bind(poste_id)
        .execute(pool)
        .await
        .map_err(|_| ApiError::internal("Base de données"))?;
    Ok(())
}

pub async fn build_jwt_keys(config: &crate::config::Config) -> anyhow::Result<Arc<JwtKeys>> {
    if let Some(pem) = config.jwt_rsa_private_key_pem.as_ref() {
        Ok(Arc::new(JwtKeys::from_rsa_pem(
            pem.as_bytes(),
            config.jwt_key_id.clone(),
        )?))
    } else {
        tracing::warn!(
            "JWT_RSA_PRIVATE_KEY_PEM absent — génération éphémère (dev uniquement ; JWKS change à chaque redémarrage)"
        );
        Ok(Arc::new(JwtKeys::generate_ephemeral(
            config.jwt_key_id.clone(),
        )?))
    }
}
