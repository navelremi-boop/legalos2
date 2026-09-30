//! OAuth 2.0 (RFC 6749) pour Microsoft 365 et Gmail.
//! Le jeton de rafraîchissement est chiffré côté serveur. Il ne sort pas dans les réponses HTTP.

use std::time::Duration;

use axum::extract::State;
use axum::Json;
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, RefreshToken, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::totp::dechiffrer_secret_totp;
use crate::error::ApiError;
use crate::moteur_mail::chiffrer_mot_de_passe;
use crate::state::AppState;

const CLIENT_SIMULATEUR: &str = "legalos-simulateur";
const SECRET_SIMULATEUR: &str = "secret-simulateur-legalos";
const REDIRECT: &str = "http://127.0.0.1:8088/api/messagerie/oauth/retour";

#[derive(Debug, Deserialize)]
pub struct DemandeAutorisation {
    pub id: Uuid,
    pub adresse: String,
    pub fournisseur: String,
    pub auth_url: Option<String>,
    pub jeton_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Autorisation {
    pub state: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct EchangeCode {
    pub state: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct CompteOAuth {
    pub id: Uuid,
    pub adresse: String,
    pub fournisseur: String,
}

#[derive(Debug, Deserialize)]
pub struct DemandeRenouvellement {
    pub id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct Renouvellement {
    pub renouvele: bool,
}

struct Points {
    auth_url: String,
    jeton_url: String,
    client_id: String,
    client_secret: String,
    portee: String,
}

fn url_locale(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:") || url.starts_with("http://host.docker.internal:")
}

fn points(demande: &DemandeAutorisation) -> Result<Points, ApiError> {
    match demande.fournisseur.as_str() {
        "microsoft" => Ok(Points {
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
            jeton_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
            client_id: std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_ID")
                .map_err(|_| ApiError::bad_request("Application Microsoft non configurée"))?,
            client_secret: std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET")
                .map_err(|_| ApiError::bad_request("Application Microsoft non configurée"))?,
            portee: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access".into(),
        }),
        "gmail" => Ok(Points {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            jeton_url: "https://oauth2.googleapis.com/token".into(),
            client_id: std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_ID")
                .map_err(|_| ApiError::bad_request("Application Gmail non configurée"))?,
            client_secret: std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_SECRET")
                .map_err(|_| ApiError::bad_request("Application Gmail non configurée"))?,
            portee: "https://mail.google.com/".into(),
        }),
        "simulateur" => {
            let auth_url = demande
                .auth_url
                .clone()
                .filter(|url| url_locale(url))
                .ok_or_else(|| ApiError::bad_request("URL d'autorisation locale requise"))?;
            let jeton_url = demande
                .jeton_url
                .clone()
                .filter(|url| url_locale(url))
                .ok_or_else(|| ApiError::bad_request("URL de jeton locale requise"))?;
            Ok(Points {
                auth_url,
                jeton_url,
                client_id: CLIENT_SIMULATEUR.into(),
                client_secret: SECRET_SIMULATEUR.into(),
                portee: "mail".into(),
            })
        }
        _ => Err(ApiError::bad_request("Fournisseur OAuth inconnu")),
    }
}

macro_rules! client_oauth {
    ($points:expr) => {{
        let auth = AuthUrl::new($points.auth_url.clone())
            .map_err(|_| ApiError::bad_request("URL d'autorisation"))?;
        let jeton = TokenUrl::new($points.jeton_url.clone())
            .map_err(|_| ApiError::bad_request("URL de jeton"))?;
        let redirect =
            RedirectUrl::new(REDIRECT.into()).map_err(|_| ApiError::internal("Redirection"))?;
        BasicClient::new(ClientId::new($points.client_id.clone()))
            .set_client_secret(ClientSecret::new($points.client_secret.clone()))
            .set_auth_uri(auth)
            .set_token_uri(jeton)
            .set_redirect_uri(redirect)
    }};
}

fn secret_jeton(jeton: &impl TokenResponse) -> Result<(String, Option<String>, i64), ApiError> {
    let acces = jeton.access_token().secret().to_owned();
    let rafraichi = jeton
        .refresh_token()
        .map(|valeur| valeur.secret().to_owned());
    let secondes = jeton
        .expires_in()
        .unwrap_or(Duration::from_secs(3600))
        .as_secs() as i64;
    Ok((acces, rafraichi, secondes))
}

pub async fn autorisation(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(demande): Json<DemandeAutorisation>,
) -> Result<Json<Autorisation>, ApiError> {
    if demande.adresse.is_empty() {
        return Err(ApiError::bad_request("Adresse absente"));
    }
    let points = points(&demande)?;
    let client = client_oauth!(points);
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let state_valeur = Uuid::now_v7().to_string();
    let etat = state_valeur.clone();
    let (url, _) = client
        .authorize_url(move || CsrfToken::new(etat.clone()))
        .add_scope(Scope::new(points.portee.clone()))
        .set_pkce_challenge(challenge)
        .url();
    sqlx::query(
        r#"
        INSERT INTO oauth_etats (
            state, cabinet_id, titulaire_id, compte_id, adresse, fournisseur, jeton_url, auth_url, pkce_verifier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(&state_valeur)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(demande.id)
    .bind(&demande.adresse)
    .bind(&demande.fournisseur)
    .bind(&points.jeton_url)
    .bind(&points.auth_url)
    .bind(verifier.secret())
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    Ok(Json(Autorisation {
        state: state_valeur,
        url: url.to_string(),
    }))
}

pub async fn echange(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<EchangeCode>,
) -> Result<Json<CompteOAuth>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, String, String)>(
        r#"
        SELECT compte_id, cabinet_id, adresse, fournisseur, jeton_url, auth_url, pkce_verifier
        FROM oauth_etats WHERE state = $1 AND titulaire_id = $2
        "#,
    )
    .bind(&corps.state)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture OAuth"))?
    .ok_or_else(|| ApiError::bad_request("État OAuth inconnu"))?;
    let points = Points {
        auth_url: row.5,
        jeton_url: row.4.clone(),
        client_id: if row.3 == "simulateur" {
            CLIENT_SIMULATEUR.into()
        } else if row.3 == "gmail" {
            std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_ID").unwrap_or_default()
        } else {
            std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_ID").unwrap_or_default()
        },
        client_secret: if row.3 == "simulateur" {
            SECRET_SIMULATEUR.into()
        } else if row.3 == "gmail" {
            std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_SECRET").unwrap_or_default()
        } else {
            std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET").unwrap_or_default()
        },
        portee: String::new(),
    };
    let client = client_oauth!(points);
    let http = reqwest::Client::new();
    let jeton = client
        .exchange_code(AuthorizationCode::new(corps.code))
        .set_pkce_verifier(PkceCodeVerifier::new(row.6))
        .request_async(&http)
        .await
        .map_err(|_| ApiError::bad_request("Échange du code refusé"))?;
    let (acces, rafraichi, secondes) = secret_jeton(&jeton)?;
    let rafraichi =
        rafraichi.ok_or_else(|| ApiError::bad_request("Jeton de rafraîchissement absent"))?;
    let acces_chiffre = chiffrer_mot_de_passe(&acces, &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("Chiffrement"))?;
    let rafraichi_chiffre = chiffrer_mot_de_passe(&rafraichi, &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("Chiffrement"))?;
    let (hote, port, tls) = hote_de(&row.3);
    sqlx::query(
        r#"
        INSERT INTO comptes_mail (
            id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref,
            hote, port, utilisateur, tls, fournisseur, jeton_url,
            jeton_rafraichissement_chiffre, jeton_acces_chiffre, jeton_expire_le
        ) VALUES (
            $1, $2, 'nominatif', $3, $4, 'oauth',
            $5, $6, $4, $7, $8, $9, $10, $11, NOW() + ($12::bigint * INTERVAL '1 second')
        )
        "#,
    )
    .bind(row.0)
    .bind(row.1)
    .bind(claims.sub)
    .bind(&row.2)
    .bind(hote)
    .bind(port)
    .bind(tls)
    .bind(&row.3)
    .bind(&row.4)
    .bind(&rafraichi_chiffre)
    .bind(&acces_chiffre)
    .bind(secondes)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Création compte OAuth"))?;
    sqlx::query("DELETE FROM oauth_etats WHERE state = $1")
        .bind(&corps.state)
        .execute(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Nettoyage OAuth"))?;
    Ok(Json(CompteOAuth {
        id: row.0,
        adresse: row.2,
        fournisseur: row.3,
    }))
}

fn hote_de(fournisseur: &str) -> (&'static str, i32, bool) {
    match fournisseur {
        "microsoft" => ("outlook.office365.com", 993, true),
        "gmail" => ("imap.gmail.com", 993, true),
        _ => ("127.0.0.1", 1, false),
    }
}

pub async fn renouveler(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(demande): Json<DemandeRenouvellement>,
) -> Result<Json<Renouvellement>, ApiError> {
    renouveler_compte(&state.pool, &state.totp_cipher_key, demande.id, claims.sub).await?;
    Ok(Json(Renouvellement { renouvele: true }))
}

pub async fn renouveler_compte(
    pool: &PgPool,
    cle: &[u8; 32],
    compte: Uuid,
    titulaire: Uuid,
) -> Result<(), ApiError> {
    let row = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT fournisseur, jeton_url, jeton_rafraichissement_chiffre
        FROM comptes_mail
        WHERE id = $1 AND titulaire_id = $2 AND jeton_rafraichissement_chiffre IS NOT NULL
        "#,
    )
    .bind(compte)
    .bind(titulaire)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture jeton"))?
    .ok_or_else(|| ApiError::not_found("Compte OAuth introuvable"))?;
    let points = Points {
        auth_url: "http://127.0.0.1/authorize".into(),
        jeton_url: row.1,
        client_id: if row.0 == "simulateur" {
            CLIENT_SIMULATEUR.into()
        } else if row.0 == "gmail" {
            std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_ID").unwrap_or_default()
        } else {
            std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_ID").unwrap_or_default()
        },
        client_secret: if row.0 == "simulateur" {
            SECRET_SIMULATEUR.into()
        } else if row.0 == "gmail" {
            std::env::var("LEGALOS_OAUTH_GMAIL_CLIENT_SECRET").unwrap_or_default()
        } else {
            std::env::var("LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET").unwrap_or_default()
        },
        portee: String::new(),
    };
    let octets =
        dechiffrer_secret_totp(&row.2, cle).map_err(|_| ApiError::internal("Déchiffrement"))?;
    let rafraichi = String::from_utf8(octets).map_err(|_| ApiError::internal("Déchiffrement"))?;
    let client = client_oauth!(points);
    let http = reqwest::Client::new();
    let jeton = client
        .exchange_refresh_token(&RefreshToken::new(rafraichi))
        .request_async(&http)
        .await
        .map_err(|_| ApiError::bad_request("Renouvellement refusé"))?;
    let (acces, nouveau, secondes) = secret_jeton(&jeton)?;
    let acces_chiffre =
        chiffrer_mot_de_passe(&acces, cle).map_err(|_| ApiError::internal("Chiffrement"))?;
    let rafraichi_chiffre = match nouveau {
        Some(valeur) => {
            chiffrer_mot_de_passe(&valeur, cle).map_err(|_| ApiError::internal("Chiffrement"))?
        }
        None => row.2,
    };
    sqlx::query(
        r#"
        UPDATE comptes_mail
        SET jeton_acces_chiffre = $1,
            jeton_rafraichissement_chiffre = $2,
            jeton_expire_le = NOW() + ($3::bigint * INTERVAL '1 second'),
            revision = revision + 1
        WHERE id = $4
        "#,
    )
    .bind(&acces_chiffre)
    .bind(&rafraichi_chiffre)
    .bind(secondes)
    .bind(compte)
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("Écriture jeton"))?;
    let _ = acces;
    Ok(())
}
