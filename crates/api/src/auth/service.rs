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

/// Nouveau jeton d'accès à partir du jeton de rafraîchissement. Le registre des postes est relu :
/// un poste révoqué ou inconnu est refusé. Le jeton de rafraîchissement n'est pas tourné.
pub async fn rafraichir_acces(state: &AppState, refresh_token: &str) -> Result<String, ApiError> {
    let claims = state
        .jwt
        .decode_refresh(&state.jwt_issuer, refresh_token)
        .map_err(|_| ApiError::unauthorized("Jeton de rafraîchissement refusé"))?;
    if !poste_utilisable(&state.pool, claims.poste_id, claims.sub).await? {
        return Err(ApiError::unauthorized("Jeton de rafraîchissement refusé"));
    }
    let user = charger_utilisateur_par_id(&state.pool, claims.sub)
        .await?
        .ok_or_else(|| ApiError::unauthorized("Jeton de rafraîchissement refusé"))?;
    if user.cabinet_id != claims.cabinet_id {
        return Err(ApiError::unauthorized("Jeton de rafraîchissement refusé"));
    }
    mettre_a_jour_derniere_connexion(&state.pool, claims.poste_id).await?;
    state
        .jwt
        .sign_access(
            &state.jwt_issuer,
            &state.jwt_audience,
            user.id,
            user.cabinet_id,
            claims.poste_id,
            state.access_token_ttl_secs,
        )
        .map_err(|_| ApiError::internal("Émission du jeton d'accès"))
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
        INSERT INTO postes (
            id, cabinet_id, utilisateur_id, nom_appareil, derniere_connexion_le, chiffrement_disque
        )
        VALUES ($1, $2, $3, $4, NOW(), 'non_confirme')
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

async fn poste_utilisable(
    pool: &PgPool,
    poste_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<bool, ApiError> {
    let row: Option<(Uuid, Option<time::OffsetDateTime>)> =
        sqlx::query_as("SELECT utilisateur_id, revoque_le FROM postes WHERE id = $1")
            .bind(poste_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| ApiError::internal("Base de données"))?;
    Ok(match row {
        Some((titulaire, None)) => titulaire == utilisateur_id,
        _ => false,
    })
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
    Ok(Arc::new(charger_cle(
        config.jwt_rsa_private_key_pem.as_deref(),
        config.jwt_key_file.as_deref(),
        crate::config::mode_developpement(),
    )?))
}

/// Clé de signature des jetons : la variable d'environnement, sinon le fichier du volume. Le fichier absent est
/// créé en développement seulement ; hors développement, sans clé fournie, le démarrage est refusé (une clé qui
/// change à chaque démarrage invaliderait les jetons de tous les postes et le cache JWKS de PowerSync).
pub(crate) fn charger_cle(
    pem: Option<&str>,
    fichier: Option<&std::path::Path>,
    developpement: bool,
) -> anyhow::Result<JwtKeys> {
    if let Some(pem) = pem {
        return JwtKeys::from_rsa_pem(pem);
    }
    if let Some(chemin) = fichier {
        return match std::fs::read_to_string(chemin) {
            Ok(texte) => JwtKeys::from_rsa_pem(&texte)
                .map_err(|e| anyhow::anyhow!("{} : {e}", chemin.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && developpement => {
                let (cle, pem) = JwtKeys::generer()?;
                ecrire_cle_nouvelle(chemin, &pem)?;
                tracing::warn!(
                    fichier = %chemin.display(),
                    "clé de signature créée au premier démarrage (développement) ; elle survit aux redémarrages"
                );
                Ok(cle)
            }
            Err(e) => Err(anyhow::anyhow!(
                "lecture de la clé de signature ({}) : {e}",
                chemin.display()
            )),
        };
    }
    if developpement {
        tracing::warn!(
            "ni JWT_RSA_PRIVATE_KEY_PEM ni JWT_KEY_FILE — clé éphémère (développement seulement ; les jetons ne survivent pas au redémarrage)"
        );
        return Ok(JwtKeys::generer()?.0);
    }
    anyhow::bail!(
        "JWT_RSA_PRIVATE_KEY_PEM (ou JWT_KEY_FILE vers une clé existante) est requis hors LEGALOS_MODE=development"
    )
}

fn ecrire_cle_nouvelle(chemin: &std::path::Path, pem: &str) -> anyhow::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut fichier = options.open(chemin).map_err(|e| {
        anyhow::anyhow!(
            "création de la clé de signature ({}) : {e}",
            chemin.display()
        )
    })?;
    fichier
        .write_all(pem.as_bytes())
        .map_err(|e| anyhow::anyhow!("écriture de la clé de signature : {e}"))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests_cle {
    use super::charger_cle;
    use crate::auth::jwt::JwtKeys;

    fn dossier_neuf(nom: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("legalos-cle-{nom}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dossier");
        dir
    }

    #[test]
    fn hors_developpement_sans_cle_le_demarrage_est_refuse() {
        assert!(charger_cle(None, None, false).is_err());
        let absent = dossier_neuf("absent").join("jwt.pem");
        assert!(charger_cle(None, Some(&absent), false).is_err());
        assert!(!absent.exists(), "hors développement, rien n'est créé");
    }

    #[test]
    fn en_developpement_la_cle_du_volume_est_creee_puis_reprise() {
        let chemin = dossier_neuf("volume").join("jwt.pem");
        let premiere = charger_cle(None, Some(&chemin), true).expect("création");
        assert!(chemin.exists());
        let seconde = charger_cle(None, Some(&chemin), true).expect("reprise");
        assert_eq!(premiere.kid, seconde.kid, "même clé, donc même kid");
    }

    #[test]
    fn la_cle_fournie_est_reprise_et_un_fichier_illisible_est_refuse() {
        let (cle, pem) = JwtKeys::generer().expect("clé");
        let fournie = charger_cle(Some(&pem), None, false).expect("fournie");
        assert_eq!(fournie.kid, cle.kid);
        let chemin = dossier_neuf("illisible").join("jwt.pem");
        std::fs::write(&chemin, "pas une clé").expect("écriture");
        assert!(charger_cle(None, Some(&chemin), true).is_err());
        assert!(charger_cle(None, Some(&chemin), false).is_err());
    }

    #[test]
    fn en_developpement_sans_rien_une_cle_ephemere_est_permise() {
        let a = charger_cle(None, None, true).expect("éphémère");
        let b = charger_cle(None, None, true).expect("éphémère");
        assert_ne!(a.kid, b.kid);
    }
}
