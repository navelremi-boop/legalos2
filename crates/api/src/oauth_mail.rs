//! OAuth 2.0 (RFC 6749) pour les boîtes Microsoft 365 et Gmail : flux code d'autorisation avec PKCE (RFC 7636) et
//! redirection de bouclage locale (RFC 8252). Voir `docs/oauth-messagerie.md`.
//!
//! Le poste demande l'adresse d'autorisation à l'instance (`debut`), ouvre le navigateur du système, capte le code
//! sur `http://127.0.0.1:<port>/` et le transmet à l'instance (`echange`). Le vérificateur PKCE n'existe que dans
//! l'instance ; les jetons d'accès et de rafraîchissement sont chiffrés en base, jamais renvoyés au poste, jamais
//! synchronisés, jamais journalisés.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::Json;
use oauth2::basic::{BasicClient, BasicErrorResponseType};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, RefreshToken, RequestTokenError, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::totp::dechiffrer_secret_totp;
use crate::config::mode_developpement;
use crate::error::ApiError;
use crate::moteur_mail::chiffrer_mot_de_passe;
use crate::state::AppState;

const CLIENT_SIMULATEUR: &str = "legalos-simulateur";
/// Durée de vie d'une demande de connexion (`state`).
pub const VIE_DEMANDE_MINUTES: i64 = 10;
/// Un jeton d'accès qui expire dans moins de cette durée est renouvelé avant usage.
const MARGE_RENOUVELLEMENT_SECS: i64 = 120;
const DELAI_FOURNISSEUR_SECS: u64 = 20;
/// Demandes en attente conservées par utilisateur (les plus anciennes sont écartées).
const DEMANDES_PAR_UTILISATEUR: i64 = 5;

// ---------------------------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------------------------

/// Serveurs IMAP et SMTP d'une boîte OAuth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct Hotes {
    pub imap_hote: String,
    pub imap_port: u16,
    pub imap_tls: bool,
    pub smtp_hote: String,
    pub smtp_port: u16,
    /// `aucun`, `starttls` ou `implicite`.
    pub smtp_chiffrement: String,
}

struct Fournisseur {
    id: &'static str,
    auth_url: String,
    jeton_url: String,
    client_id: String,
    client_secret: Option<String>,
    portee: String,
    /// Paramètres d'autorisation propres au fournisseur.
    extras: Vec<(&'static str, &'static str)>,
    hotes: Hotes,
}

fn variable(nom: &str) -> Option<String> {
    std::env::var(nom)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Identifiants d'application du fournisseur (variables d'environnement de l'instance), `None` s'ils manquent.
fn identifiants(id: &str) -> Option<(String, Option<String>)> {
    let prefixe = match id {
        "microsoft" => "LEGALOS_OAUTH_MICROSOFT",
        "gmail" => "LEGALOS_OAUTH_GMAIL",
        _ => return None,
    };
    let client_id = variable(&format!("{prefixe}_CLIENT_ID"))?;
    Some((client_id, variable(&format!("{prefixe}_CLIENT_SECRET"))))
}

/// Fournisseurs offerts par cette instance : ceux dont les identifiants d'application sont configurés.
#[must_use]
pub fn fournisseurs_configures() -> Vec<&'static str> {
    ["microsoft", "gmail"]
        .into_iter()
        .filter(|id| identifiants(id).is_some())
        .collect()
}

fn url_locale(url: &str) -> bool {
    let Ok(url) = url::Url::parse(url) else {
        return false;
    };
    url.scheme() == "http"
        && matches!(
            url.host_str(),
            Some("127.0.0.1") | Some("host.docker.internal")
        )
        && url.port().is_some()
}

/// Résout un fournisseur. Le « simulateur » n'existe qu'en développement : ses adresses viennent de la
/// demande, une instance de production le refuse comme tout fournisseur inconnu.
fn fournisseur(id: &str, demande: Option<&DemandeDebut>) -> Result<Fournisseur, ApiError> {
    fournisseur_selon_mode(id, demande, mode_developpement())
}

fn fournisseur_selon_mode(
    id: &str,
    demande: Option<&DemandeDebut>,
    developpement: bool,
) -> Result<Fournisseur, ApiError> {
    match id {
        "microsoft" => {
            let (client_id, client_secret) = identifiants("microsoft")
                .ok_or_else(|| ApiError::bad_request("Application Microsoft non configurée"))?;
            let locataire =
                variable("LEGALOS_OAUTH_MICROSOFT_TENANT").unwrap_or_else(|| "common".into());
            if !locataire
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            {
                return Err(ApiError::bad_request("Locataire Microsoft invalide"));
            }
            Ok(Fournisseur {
                id: "microsoft",
                auth_url: format!(
                    "https://login.microsoftonline.com/{locataire}/oauth2/v2.0/authorize"
                ),
                jeton_url: format!(
                    "https://login.microsoftonline.com/{locataire}/oauth2/v2.0/token"
                ),
                client_id,
                client_secret,
                portee: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access".into(),
                extras: Vec::new(),
                hotes: Hotes {
                    imap_hote: "outlook.office365.com".into(),
                    imap_port: 993,
                    imap_tls: true,
                    smtp_hote: "smtp.office365.com".into(),
                    smtp_port: 587,
                    smtp_chiffrement: "starttls".into(),
                },
            })
        }
        "gmail" => {
            let (client_id, client_secret) = identifiants("gmail")
                .ok_or_else(|| ApiError::bad_request("Application Gmail non configurée"))?;
            Ok(Fournisseur {
                id: "gmail",
                auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
                jeton_url: "https://oauth2.googleapis.com/token".into(),
                client_id,
                client_secret,
                portee: "https://mail.google.com/".into(),
                extras: vec![("access_type", "offline"), ("prompt", "consent")],
                hotes: Hotes {
                    imap_hote: "imap.gmail.com".into(),
                    imap_port: 993,
                    imap_tls: true,
                    smtp_hote: "smtp.gmail.com".into(),
                    smtp_port: 587,
                    smtp_chiffrement: "starttls".into(),
                },
            })
        }
        "simulateur" if developpement => {
            let demande =
                demande.ok_or_else(|| ApiError::bad_request("Fournisseur OAuth inconnu"))?;
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
            let hotes = demande
                .hotes
                .clone()
                .ok_or_else(|| ApiError::bad_request("Serveurs du simulateur requis"))?;
            Ok(Fournisseur {
                id: "simulateur",
                auth_url,
                jeton_url,
                client_id: CLIENT_SIMULATEUR.into(),
                client_secret: None,
                portee: "mail".into(),
                extras: Vec::new(),
                hotes,
            })
        }
        _ => Err(ApiError::bad_request("Fournisseur OAuth inconnu")),
    }
}

/// Fournisseur d'un compte déjà connecté, pour renouveler ses jetons (adresse de jeton lue en base).
fn fournisseur_du_compte(id: &str, jeton_url: &str) -> Result<(String, Option<String>), ApiError> {
    match id {
        "simulateur" if mode_developpement() => {
            let _ = jeton_url;
            Ok((CLIENT_SIMULATEUR.into(), None))
        }
        "microsoft" | "gmail" => {
            identifiants(id).ok_or_else(|| ApiError::bad_request("Application non configurée"))
        }
        _ => Err(ApiError::bad_request("Fournisseur OAuth inconnu")),
    }
}

fn client_http() -> Result<reqwest::Client, ApiError> {
    reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(DELAI_FOURNISSEUR_SECS))
        .build()
        .map_err(|_| ApiError::internal("Client HTTP"))
}

/// Redirection de bouclage (RFC 8252 § 7.3) : `http://127.0.0.1:<port>/`, port non réservé, rien d'autre.
pub fn valider_redirection(redirection: &str) -> Result<url::Url, ApiError> {
    let refus = || ApiError::bad_request("Redirection de bouclage invalide");
    let url = url::Url::parse(redirection).map_err(|_| refus())?;
    let conforme = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some_and(|port| port >= 1024)
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    if conforme {
        Ok(url)
    } else {
        Err(refus())
    }
}

fn adresse_valide(adresse: &str) -> bool {
    let adresse = adresse.trim();
    !adresse.is_empty()
        && adresse.chars().count() <= 254
        && adresse.contains('@')
        && !adresse
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '"' | ','))
}

macro_rules! client_oauth {
    ($fournisseur:expr, $redirection:expr) => {{
        let auth = AuthUrl::new($fournisseur.auth_url.clone())
            .map_err(|_| ApiError::bad_request("URL d'autorisation"))?;
        let jeton = TokenUrl::new($fournisseur.jeton_url.clone())
            .map_err(|_| ApiError::bad_request("URL de jeton"))?;
        let redirect = RedirectUrl::new($redirection.to_owned())
            .map_err(|_| ApiError::bad_request("Redirection de bouclage invalide"))?;
        let client = BasicClient::new(ClientId::new($fournisseur.client_id.clone()))
            .set_auth_uri(auth)
            .set_token_uri(jeton)
            .set_redirect_uri(redirect);
        match &$fournisseur.client_secret {
            Some(secret) => client.set_client_secret(ClientSecret::new(secret.clone())),
            None => client,
        }
    }};
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FournisseurDisponible {
    pub id: &'static str,
    pub libelle: &'static str,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Fournisseurs {
    pub fournisseurs: Vec<FournisseurDisponible>,
}

/// Fournisseurs que l'instance sait connecter (identifiants d'application configurés). Aucun secret.
#[utoipa::path(
    get,
    path = "/messagerie/oauth/fournisseurs",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Fournisseurs que l'instance sait connecter (aucun secret)", body = Fournisseurs),
    )
)]
pub async fn lister_fournisseurs(AuthAccess(_claims): AuthAccess) -> Json<Fournisseurs> {
    Json(Fournisseurs {
        fournisseurs: fournisseurs_configures()
            .into_iter()
            .map(|id| FournisseurDisponible {
                id,
                libelle: if id == "microsoft" {
                    "Microsoft 365"
                } else {
                    "Gmail"
                },
            })
            .collect(),
    })
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DemandeDebut {
    /// Identifiant du compte : celui d'une boîte OAuth du demandeur (reconnexion) ou un nouvel identifiant.
    pub id: Uuid,
    pub adresse: String,
    pub fournisseur: String,
    /// `http://127.0.0.1:<port>/`, écouté par le poste pendant la connexion.
    pub redirection: String,
    /// Développement seulement (fournisseur « simulateur »).
    pub auth_url: Option<String>,
    pub jeton_url: Option<String>,
    pub hotes: Option<Hotes>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Autorisation {
    pub state: String,
    pub url: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct EchangeCode {
    pub state: String,
    pub code: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CompteOAuth {
    pub id: Uuid,
    pub adresse: String,
    pub fournisseur: String,
    pub reconnexion: bool,
}

/// Début de la connexion : enregistre le `state` (usage unique, 10 minutes, lié à l'utilisateur et au compte) et
/// le vérificateur PKCE, rend l'adresse d'autorisation à ouvrir dans le navigateur du système.
#[utoipa::path(
    post,
    path = "/messagerie/oauth/debut",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = DemandeDebut,
    responses(
        (status = 200, description = "Demande de connexion enregistrée (usage unique, dix minutes) et adresse d'autorisation à ouvrir dans le navigateur", body = Autorisation),
        (status = 400, description = "Fournisseur inconnu ou non configuré, redirection de bouclage invalide, ou adresse de la boîte invalide", body = crate::error::ApiErrorBody),
        (status = 404, description = "Boîte introuvable ou dont l'utilisateur n'est pas le titulaire", body = crate::error::ApiErrorBody),
        (status = 500, description = "Enregistrement de la demande impossible", body = crate::error::ApiErrorBody),
    )
)]
pub async fn debut(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(demande): Json<DemandeDebut>,
) -> Result<Json<Autorisation>, ApiError> {
    let fournisseur = fournisseur(&demande.fournisseur, Some(&demande))?;
    let redirection = valider_redirection(&demande.redirection)?;
    // Reconnexion : la boîte existe, elle est OAuth et appartient au demandeur ; sinon, pour tout autre, elle
    // n'existe pas (404).
    let existant = sqlx::query_as::<_, (String, String)>(
        "SELECT adresse, secret_ref FROM comptes_mail WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(demande.id)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du compte"))?;
    let adresse = match existant {
        Some(_) => {
            let propre = sqlx::query_scalar::<_, String>(
                r#"
                SELECT adresse FROM comptes_mail
                WHERE id = $1 AND cabinet_id = $2 AND type_compte = 'nominatif'
                  AND titulaire_id = $3 AND secret_ref = 'oauth'
                "#,
            )
            .bind(demande.id)
            .bind(claims.cabinet_id)
            .bind(claims.sub)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| ApiError::internal("Lecture du compte"))?;
            propre.ok_or_else(|| ApiError::not_found("Boîte introuvable"))?
        }
        None => {
            if !adresse_valide(&demande.adresse) {
                return Err(ApiError::bad_request("Adresse de la boîte invalide"));
            }
            demande.adresse.trim().to_owned()
        }
    };
    let client = client_oauth!(fournisseur, redirection.as_str());
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let valeur = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let etat = valeur.clone();
    let mut requete = client
        .authorize_url(move || CsrfToken::new(etat.clone()))
        .set_pkce_challenge(challenge)
        .add_extra_param("login_hint", adresse.clone());
    for portee in fournisseur.portee.split_whitespace() {
        requete = requete.add_scope(Scope::new(portee.to_owned()));
    }
    for (nom, valeur) in &fournisseur.extras {
        requete = requete.add_extra_param(*nom, *valeur);
    }
    let (url, _) = requete.url();
    let hotes = if fournisseur.id == "simulateur" {
        Some(
            serde_json::to_value(&fournisseur.hotes)
                .map_err(|_| ApiError::internal("Réglages du simulateur"))?,
        )
    } else {
        None
    };
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    sqlx::query("DELETE FROM oauth_etats WHERE expire_le < NOW()")
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    sqlx::query(
        r#"
        DELETE FROM oauth_etats
        WHERE titulaire_id = $1
          AND state NOT IN (
              SELECT state FROM oauth_etats WHERE titulaire_id = $1
              ORDER BY cree_le DESC LIMIT $2
          )
        "#,
    )
    .bind(claims.sub)
    .bind(DEMANDES_PAR_UTILISATEUR - 1)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    sqlx::query(
        r#"
        INSERT INTO oauth_etats (
            state, cabinet_id, titulaire_id, compte_id, adresse, fournisseur, jeton_url, auth_url,
            pkce_verifier, redirect_uri, expire_le, hotes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + ($11::bigint * INTERVAL '1 minute'), $12)
        "#,
    )
    .bind(&valeur)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(demande.id)
    .bind(&adresse)
    .bind(fournisseur.id)
    .bind(&fournisseur.jeton_url)
    .bind(&fournisseur.auth_url)
    .bind(verifier.secret())
    .bind(redirection.as_str())
    .bind(VIE_DEMANDE_MINUTES)
    .bind(hotes)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Enregistrement OAuth"))?;
    Ok(Json(Autorisation {
        state: valeur,
        url: url.to_string(),
    }))
}

type LigneEtat = (
    Uuid,
    Uuid,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<serde_json::Value>,
);

/// Fin de la connexion : le code reçu sur le bouclage est échangé contre les jetons, avec le vérificateur PKCE
/// que seule l'instance détient. La demande est consommée dès la lecture : un `state` ne sert qu'une fois, même
/// si l'échange échoue. Un `state` inconnu, expiré ou d'un autre utilisateur est introuvable (404).
#[utoipa::path(
    post,
    path = "/messagerie/oauth/echange",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = EchangeCode,
    responses(
        (status = 200, description = "Boîte connectée ou reconnectée (aucun jeton n'est renvoyé)", body = CompteOAuth),
        (status = 400, description = "Échange du code refusé par le fournisseur, ou jeton de rafraîchissement absent", body = crate::error::ApiErrorBody),
        (status = 404, description = "Demande de connexion inconnue, expirée ou d'un autre utilisateur, ou boîte introuvable", body = crate::error::ApiErrorBody),
        (status = 500, description = "Chiffrement ou enregistrement des jetons impossible", body = crate::error::ApiErrorBody),
    )
)]
pub async fn echange(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(corps): Json<EchangeCode>,
) -> Result<Json<CompteOAuth>, ApiError> {
    let ligne: LigneEtat = sqlx::query_as(
        r#"
        DELETE FROM oauth_etats
        WHERE state = $1 AND titulaire_id = $2 AND cabinet_id = $3 AND expire_le > NOW()
        RETURNING compte_id, cabinet_id, adresse, fournisseur, jeton_url, auth_url, pkce_verifier,
                  redirect_uri, hotes
        "#,
    )
    .bind(&corps.state)
    .bind(claims.sub)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture OAuth"))?
    .ok_or_else(|| ApiError::not_found("Demande de connexion inconnue ou expirée"))?;
    let (compte_id, cabinet_id, adresse, id_fournisseur, jeton_url, auth_url, verifier) = (
        ligne.0, ligne.1, ligne.2, ligne.3, ligne.4, ligne.5, ligne.6,
    );
    let redirection = ligne.7;
    let (client_id, client_secret) = fournisseur_du_compte(&id_fournisseur, &jeton_url)?;
    let hotes = match (id_fournisseur.as_str(), ligne.8) {
        ("simulateur", Some(valeur)) => serde_json::from_value::<Hotes>(valeur)
            .map_err(|_| ApiError::internal("Réglages du simulateur"))?,
        ("simulateur", None) => return Err(ApiError::internal("Réglages du simulateur")),
        _ => fournisseur(&id_fournisseur, None)?.hotes,
    };
    let descripteur = Fournisseur {
        id: "",
        auth_url,
        jeton_url: jeton_url.clone(),
        client_id,
        client_secret,
        portee: String::new(),
        extras: Vec::new(),
        hotes: hotes.clone(),
    };
    let client = client_oauth!(descripteur, redirection.as_str());
    let http = client_http()?;
    let reponse = client
        .exchange_code(AuthorizationCode::new(corps.code))
        .set_pkce_verifier(PkceCodeVerifier::new(verifier))
        .request_async(&http)
        .await
        .map_err(|erreur| {
            tracing::warn!(
                fournisseur = %id_fournisseur,
                cause = %cause_echange(&erreur),
                "échange du code OAuth refusé"
            );
            ApiError::bad_request("Échange du code refusé")
        })?;
    let (acces, rafraichi, secondes) = lire_jetons(&reponse);
    let rafraichi =
        rafraichi.ok_or_else(|| ApiError::bad_request("Jeton de rafraîchissement absent"))?;
    let acces_chiffre = chiffrer_mot_de_passe(&acces, &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("Chiffrement"))?;
    let rafraichi_chiffre = chiffrer_mot_de_passe(&rafraichi, &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("Chiffrement"))?;
    let existant = sqlx::query_as::<_, (Uuid, String, String, Option<Uuid>)>(
        "SELECT cabinet_id, type_compte, secret_ref, titulaire_id FROM comptes_mail WHERE id = $1",
    )
    .bind(compte_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du compte"))?;
    let reconnexion = existant.is_some();
    match existant {
        Some((cabinet, type_compte, secret_ref, titulaire))
            if cabinet == cabinet_id
                && type_compte == "nominatif"
                && secret_ref == "oauth"
                && titulaire == Some(claims.sub) =>
        {
            sqlx::query(
                r#"
                UPDATE comptes_mail
                SET jeton_rafraichissement_chiffre = $2, jeton_acces_chiffre = $3,
                    jeton_expire_le = NOW() + ($4::bigint * INTERVAL '1 second'),
                    fournisseur = $5, jeton_url = $6,
                    oauth_generation = oauth_generation + 1,
                    etat_connexion = 'inconnu', empreinte_refus = NULL
                WHERE id = $1
                "#,
            )
            .bind(compte_id)
            .bind(&rafraichi_chiffre)
            .bind(&acces_chiffre)
            .bind(secondes)
            .bind(&id_fournisseur)
            .bind(&jeton_url)
            .execute(&state.pool)
            .await
            .map_err(|_| ApiError::internal("Écriture des jetons"))?;
        }
        Some(_) => return Err(ApiError::not_found("Boîte introuvable")),
        None => {
            sqlx::query(
                r#"
                INSERT INTO comptes_mail (
                    id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref,
                    hote, port, utilisateur, tls, fournisseur, jeton_url,
                    jeton_rafraichissement_chiffre, jeton_acces_chiffre, jeton_expire_le,
                    smtp_hote, smtp_port, smtp_utilisateur, smtp_chiffrement
                ) VALUES (
                    $1, $2, 'nominatif', $3, $4, 'oauth',
                    $5, $6, $4, $7, $8, $9, $10, $11, NOW() + ($12::bigint * INTERVAL '1 second'),
                    $13, $14, $4, $15
                )
                "#,
            )
            .bind(compte_id)
            .bind(cabinet_id)
            .bind(claims.sub)
            .bind(&adresse)
            .bind(&hotes.imap_hote)
            .bind(i32::from(hotes.imap_port))
            .bind(hotes.imap_tls)
            .bind(&id_fournisseur)
            .bind(&jeton_url)
            .bind(&rafraichi_chiffre)
            .bind(&acces_chiffre)
            .bind(secondes)
            .bind(&hotes.smtp_hote)
            .bind(i32::from(hotes.smtp_port))
            .bind(&hotes.smtp_chiffrement)
            .execute(&state.pool)
            .await
            .map_err(|_| ApiError::internal("Création du compte OAuth"))?;
        }
    }
    Ok(Json(CompteOAuth {
        id: compte_id,
        adresse,
        fournisseur: id_fournisseur,
        reconnexion,
    }))
}

fn lire_jetons(reponse: &impl TokenResponse) -> (String, Option<String>, i64) {
    let acces = reponse.access_token().secret().to_owned();
    let rafraichi = reponse
        .refresh_token()
        .map(|valeur| valeur.secret().to_owned());
    let secondes = reponse
        .expires_in()
        .unwrap_or(Duration::from_secs(3600))
        .as_secs();
    (acces, rafraichi, i64::try_from(secondes).unwrap_or(3600))
}

/// Cause d'un échec d'échange, sans rien du contenu de la réponse (jamais de code ni de jeton dans les journaux).
fn cause_echange<E: std::error::Error + 'static, T: oauth2::ErrorResponse + 'static>(
    erreur: &RequestTokenError<E, T>,
) -> &'static str {
    match erreur {
        RequestTokenError::ServerResponse(_) => "réponse d'erreur du fournisseur",
        RequestTokenError::Request(_) => "fournisseur injoignable",
        RequestTokenError::Parse(_, _) => "réponse illisible",
        RequestTokenError::Other(_) => "autre",
    }
}

// ---------------------------------------------------------------------------------------------
// Jeton d'accès valide
// ---------------------------------------------------------------------------------------------

/// Pourquoi un jeton d'accès n'a pas pu être fourni.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErreurJeton {
    /// Le fournisseur refuse le jeton de rafraîchissement (révoqué, expiré, mot de passe changé) : la boîte est
    /// marquée « identifiants refusés » et l'utilisateur doit la reconnecter.
    Revoque,
    /// Fournisseur injoignable ou en erreur : on réessaie plus tard, sans rien marquer.
    Transitoire,
    /// Boîte inconnue ou qui n'est pas une boîte OAuth.
    Introuvable,
}

/// Jeton d'accès valide de la boîte, renouvelé s'il expire dans moins de deux minutes. Un verrou par boîte évite
/// que deux tâches renouvellent ensemble (le fournisseur peut invalider le jeton de rafraîchissement qui a servi).
pub async fn acces_valide(
    pool: &PgPool,
    cle: &[u8; 32],
    compte: Uuid,
) -> Result<String, ErreurJeton> {
    rafraichir(pool, cle, compte, false).await
}

type LigneJeton = (String, String, String, String, bool);

async fn rafraichir(
    pool: &PgPool,
    cle: &[u8; 32],
    compte: Uuid,
    forcer: bool,
) -> Result<String, ErreurJeton> {
    let transitoire = |_| ErreurJeton::Transitoire;
    let mut tx = pool.begin().await.map_err(transitoire)?;
    crate::verrous::verrouiller_texte(&mut tx, &compte.to_string())
        .await
        .map_err(transitoire)?;
    let ligne: Option<LigneJeton> = sqlx::query_as(
        r#"
        SELECT COALESCE(fournisseur, ''), COALESCE(jeton_url, ''),
               COALESCE(jeton_rafraichissement_chiffre, ''), COALESCE(jeton_acces_chiffre, ''),
               COALESCE(jeton_expire_le > NOW() + ($2::bigint * INTERVAL '1 second'), FALSE)
        FROM comptes_mail
        WHERE id = $1 AND secret_ref = 'oauth'
        "#,
    )
    .bind(compte)
    .bind(MARGE_RENOUVELLEMENT_SECS)
    .fetch_optional(&mut *tx)
    .await
    .map_err(transitoire)?;
    let Some((id_fournisseur, jeton_url, rafraichi_chiffre, acces_chiffre, valide)) = ligne else {
        return Err(ErreurJeton::Introuvable);
    };
    if valide && !forcer && !acces_chiffre.is_empty() {
        let octets =
            dechiffrer_secret_totp(&acces_chiffre, cle).map_err(|_| ErreurJeton::Transitoire)?;
        return String::from_utf8(octets).map_err(|_| ErreurJeton::Transitoire);
    }
    if rafraichi_chiffre.is_empty() {
        return Err(ErreurJeton::Revoque);
    }
    let (client_id, client_secret) =
        fournisseur_du_compte(&id_fournisseur, &jeton_url).map_err(|_| ErreurJeton::Transitoire)?;
    let descripteur = Fournisseur {
        id: "",
        auth_url: "http://127.0.0.1:1/".into(),
        jeton_url: jeton_url.clone(),
        client_id,
        client_secret,
        portee: String::new(),
        extras: Vec::new(),
        hotes: Hotes {
            imap_hote: String::new(),
            imap_port: 0,
            imap_tls: false,
            smtp_hote: String::new(),
            smtp_port: 0,
            smtp_chiffrement: "aucun".into(),
        },
    };
    let client =
        (|| -> Result<_, ApiError> { Ok(client_oauth!(descripteur, "http://127.0.0.1:1/")) })()
            .map_err(|_| ErreurJeton::Transitoire)?;
    let octets =
        dechiffrer_secret_totp(&rafraichi_chiffre, cle).map_err(|_| ErreurJeton::Transitoire)?;
    let rafraichi = String::from_utf8(octets).map_err(|_| ErreurJeton::Transitoire)?;
    let http = client_http().map_err(|_| ErreurJeton::Transitoire)?;
    let reponse = client
        .exchange_refresh_token(&RefreshToken::new(rafraichi))
        .request_async(&http)
        .await;
    let reponse = match reponse {
        Ok(reponse) => reponse,
        Err(RequestTokenError::ServerResponse(erreur))
            if *erreur.error() == BasicErrorResponseType::InvalidGrant =>
        {
            sqlx::query(
                r#"
                UPDATE comptes_mail
                SET etat_connexion = 'identifiants_refuses',
                    empreinte_refus = hote || '|' || port::text || '|' || utilisateur || '|oauth:' || oauth_generation::text
                WHERE id = $1
                "#,
            )
            .bind(compte)
            .execute(&mut *tx)
            .await
            .map_err(transitoire)?;
            tx.commit().await.map_err(transitoire)?;
            tracing::warn!(compte = %compte, "jeton de rafraîchissement refusé par le fournisseur");
            return Err(ErreurJeton::Revoque);
        }
        Err(erreur) => {
            tracing::warn!(compte = %compte, cause = %cause_echange(&erreur), "renouvellement du jeton impossible");
            return Err(ErreurJeton::Transitoire);
        }
    };
    let (acces, nouveau, secondes) = lire_jetons(&reponse);
    let acces_chiffre = chiffrer_mot_de_passe(&acces, cle).map_err(|_| ErreurJeton::Transitoire)?;
    // Le fournisseur peut tourner le jeton de rafraîchissement : l'ancien est alors jeté (RFC 6749 § 6).
    let rafraichi_chiffre = match nouveau {
        Some(valeur) => {
            chiffrer_mot_de_passe(&valeur, cle).map_err(|_| ErreurJeton::Transitoire)?
        }
        None => rafraichi_chiffre,
    };
    sqlx::query(
        r#"
        UPDATE comptes_mail
        SET jeton_acces_chiffre = $1, jeton_rafraichissement_chiffre = $2,
            jeton_expire_le = NOW() + ($3::bigint * INTERVAL '1 second')
        WHERE id = $4
        "#,
    )
    .bind(&acces_chiffre)
    .bind(&rafraichi_chiffre)
    .bind(secondes)
    .bind(compte)
    .execute(&mut *tx)
    .await
    .map_err(transitoire)?;
    tx.commit().await.map_err(transitoire)?;
    Ok(acces)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DemandeRenouvellement {
    pub id: Uuid,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Renouvellement {
    pub renouvele: bool,
}

/// Renouvellement demandé (poste ou recette) : force un nouveau jeton d'accès pour une boîte OAuth du demandeur.
#[utoipa::path(
    post,
    path = "/messagerie/oauth/renouveler",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = DemandeRenouvellement,
    responses(
        (status = 200, description = "Nouveau jeton d'accès obtenu (non renvoyé)", body = Renouvellement),
        (status = 400, description = "Renouvellement impossible, ou refusé par le fournisseur : la boîte doit être reconnectée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Boîte OAuth introuvable ou dont l'utilisateur n'est pas le titulaire", body = crate::error::ApiErrorBody),
    )
)]
pub async fn renouveler(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(demande): Json<DemandeRenouvellement>,
) -> Result<Json<Renouvellement>, ApiError> {
    let titulaire = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM comptes_mail
        WHERE id = $1 AND cabinet_id = $2 AND type_compte = 'nominatif' AND titulaire_id = $3
          AND secret_ref = 'oauth'
        "#,
    )
    .bind(demande.id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du compte"))?;
    let compte = titulaire.ok_or_else(|| ApiError::not_found("Boîte introuvable"))?;
    match rafraichir(&state.pool, &state.totp_cipher_key, compte, true).await {
        Ok(_) => Ok(Json(Renouvellement { renouvele: true })),
        Err(ErreurJeton::Revoque) => Err(ApiError::bad_request(
            "Le fournisseur refuse le renouvellement : reconnectez la boîte",
        )),
        Err(_) => Err(ApiError::bad_request("Renouvellement impossible")),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::{
        adresse_valide, fournisseur_selon_mode, url_locale, valider_redirection, DemandeDebut,
        Hotes,
    };
    use uuid::Uuid;

    fn demande_simulateur() -> DemandeDebut {
        DemandeDebut {
            id: Uuid::nil(),
            adresse: "a@b.example".into(),
            fournisseur: "simulateur".into(),
            redirection: "http://127.0.0.1:49152/".into(),
            auth_url: Some("http://127.0.0.1:9/authorize".into()),
            jeton_url: Some("http://127.0.0.1:9/token".into()),
            hotes: Some(Hotes {
                imap_hote: "127.0.0.1".into(),
                imap_port: 143,
                imap_tls: false,
                smtp_hote: "127.0.0.1".into(),
                smtp_port: 25,
                smtp_chiffrement: "aucun".into(),
            }),
        }
    }

    #[test]
    fn le_simulateur_n_existe_qu_en_developpement() {
        let demande = demande_simulateur();
        assert!(fournisseur_selon_mode("simulateur", Some(&demande), true).is_ok());
        // Essai négatif : la même demande, en production, est un fournisseur inconnu.
        assert!(fournisseur_selon_mode("simulateur", Some(&demande), false).is_err());
    }

    #[test]
    fn un_fournisseur_inconnu_est_refuse_dans_tous_les_modes() {
        for developpement in [true, false] {
            assert!(fournisseur_selon_mode("autre", None, developpement).is_err());
            assert!(fournisseur_selon_mode("", None, developpement).is_err());
        }
    }

    #[test]
    fn la_redirection_de_bouclage_est_strictement_validee() {
        assert!(valider_redirection("http://127.0.0.1:49152/").is_ok());
        for refusee in [
            "https://127.0.0.1:49152/",
            "http://localhost:49152/",
            "http://127.0.0.1/",
            "http://127.0.0.1:80/",
            "http://127.0.0.1:49152/autre",
            "http://127.0.0.1:49152/?x=1",
            "http://127.0.0.1:49152/#x",
            "http://utilisateur@127.0.0.1:49152/",
            "http://127.0.0.1.evil.example:49152/",
            "http://[::1]:49152/",
            "javascript:alert(1)",
            "",
        ] {
            assert!(valider_redirection(refusee).is_err(), "{refusee}");
        }
    }

    #[test]
    fn les_adresses_du_simulateur_sont_locales() {
        assert!(url_locale("http://127.0.0.1:9000/token"));
        assert!(url_locale("http://host.docker.internal:9000/token"));
        assert!(!url_locale("http://evil.example:9000/token"));
        assert!(!url_locale("https://127.0.0.1:9000/token"));
        assert!(!url_locale("http://127.0.0.1/token"));
        assert!(!url_locale("http://127.0.0.1.evil.example:9000/"));
    }

    #[test]
    fn l_adresse_de_la_boite_est_une_adresse_simple() {
        assert!(adresse_valide("me.durand@cabinet.example"));
        for refusee in [
            "",
            "sans-arobase",
            "a b@c.example",
            "a@b.example\r\nBcc: x@y",
            "<a@b.example>",
            "a@b.example,c@d.example",
        ] {
            assert!(!adresse_valide(refusee), "{refusee:?}");
        }
    }
}
