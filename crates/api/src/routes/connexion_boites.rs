//! Connexion d'une boîte nominative (J11, critère v) : mise à jour des identifiants IMAP et du relais SMTP d'une boîte
//! déjà créée (« Reconnecter »), et validation commune à la création.
//!
//! Aucun réglage de connexion ne ressort de l'API : le poste ne reçoit jamais l'adresse du serveur ni l'identifiant, et
//! le formulaire de reconnexion les redemande. Seul le titulaire d'une boîte nominative peut la modifier ; pour tout
//! autre collaborateur elle est introuvable (404), pas interdite. Une boîte OAuth se reconnecte auprès de son
//! fournisseur, pas par un mot de passe.
//!
//! Le moteur relit les comptes toutes les 5 s et compare l'empreinte des identifiants à celle du dernier refus :
//! de nouveaux identifiants relancent donc la relève d'une boîte suspendue sans autre geste.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::identite_envoi::ReglagesEnvoi;
use crate::state::AppState;

const HOTE_MAX: usize = 253;
const UTILISATEUR_MAX: usize = 254;
const MOT_DE_PASSE_MAX: usize = 1024;

/// Contrôle des réglages IMAP saisis : rien d'exécutable ni d'ambigu n'entre dans la base.
pub fn valider_connexion(
    hote: &str,
    port: u16,
    utilisateur: &str,
    mot_de_passe: &str,
) -> Result<(), ApiError> {
    if hote.is_empty() || utilisateur.is_empty() || mot_de_passe.is_empty() {
        return Err(ApiError::bad_request("Compte incomplet"));
    }
    if hote.chars().count() > HOTE_MAX || hote.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(ApiError::bad_request("Serveur IMAP invalide"));
    }
    if port == 0 {
        return Err(ApiError::bad_request("Port IMAP invalide"));
    }
    if utilisateur.chars().count() > UTILISATEUR_MAX || utilisateur.chars().any(char::is_control) {
        return Err(ApiError::bad_request("Identifiant IMAP invalide"));
    }
    if mot_de_passe.chars().count() > MOT_DE_PASSE_MAX {
        return Err(ApiError::bad_request("Mot de passe trop long"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ModifierConnexion {
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    pub tls: Option<bool>,
    #[serde(flatten)]
    pub envoi: ReglagesEnvoi,
}

#[derive(Debug, Serialize)]
pub struct ConnexionModifiee {
    pub id: Uuid,
    pub adresse: String,
}

/// Remplace les identifiants IMAP et le relais SMTP d'une boîte nominative du demandeur. L'état de connexion repart de
/// « inconnu » : le tableau de santé annonce le résultat dès que le moteur a essayé.
pub async fn modifier_connexion(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
    Json(corps): Json<ModifierConnexion>,
) -> Result<Json<ConnexionModifiee>, ApiError> {
    let compte = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT adresse, secret_ref
        FROM comptes_mail
        WHERE id = $1 AND cabinet_id = $2 AND type_compte = 'nominatif' AND titulaire_id = $3
        "#,
    )
    .bind(compte_id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du compte"))?
    .ok_or_else(|| ApiError::not_found("Boîte introuvable"))?;
    if compte.1 == "oauth" {
        return Err(ApiError::bad_request(
            "Cette boîte se connecte par son fournisseur (Microsoft 365 ou Gmail), pas par un mot de passe",
        ));
    }
    valider_connexion(
        &corps.hote,
        corps.port,
        &corps.utilisateur,
        &corps.mot_de_passe,
    )?;
    let secret =
        crate::moteur_mail::chiffrer_mot_de_passe(&corps.mot_de_passe, &state.totp_cipher_key)
            .map_err(|_| ApiError::internal("Chiffrement"))?;
    let envoi = corps.envoi.preparer(&state.totp_cipher_key)?;
    sqlx::query(
        r#"
        UPDATE comptes_mail
        SET hote = $2, port = $3, utilisateur = $4, tls = $5, secret_chiffre = $6, secret_ref = 'chiffre',
            smtp_hote = $7, smtp_port = $8, smtp_utilisateur = $9, smtp_secret_chiffre = $10, repondre_a = $11,
            smtp_chiffrement = $12,
            etat_connexion = 'inconnu', empreinte_refus = NULL
        WHERE id = $1
        "#,
    )
    .bind(compte_id)
    .bind(&corps.hote)
    .bind(i32::from(corps.port))
    .bind(&corps.utilisateur)
    .bind(corps.tls.unwrap_or(false))
    .bind(&secret)
    .bind(&envoi.smtp_hote)
    .bind(envoi.smtp_port)
    .bind(&envoi.smtp_utilisateur)
    .bind(&envoi.smtp_secret_chiffre)
    .bind(&envoi.repondre_a)
    .bind(&envoi.smtp_chiffrement)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Mise à jour de la connexion"))?;
    Ok(Json(ConnexionModifiee {
        id: compte_id,
        adresse: compte.0,
    }))
}

#[cfg(test)]
mod tests {
    use super::valider_connexion;

    #[test]
    fn des_reglages_ordinaires_passent() {
        assert!(valider_connexion("imap.cabinet.example", 993, "j.marchal", "secret").is_ok());
        assert!(valider_connexion("127.0.0.1", 1143, "capa", "x").is_ok());
    }

    #[test]
    fn un_champ_vide_est_refuse() {
        assert!(valider_connexion("", 993, "u", "p").is_err());
        assert!(valider_connexion("h", 993, "", "p").is_err());
        assert!(valider_connexion("h", 993, "u", "").is_err());
    }

    #[test]
    fn un_serveur_avec_espace_ou_retour_a_la_ligne_est_refuse() {
        assert!(valider_connexion("imap exemple", 993, "u", "p").is_err());
        assert!(valider_connexion("imap.exemple\r\nX: y", 993, "u", "p").is_err());
        assert!(valider_connexion("imap.exemple\t", 993, "u", "p").is_err());
    }

    #[test]
    fn le_port_zero_et_les_champs_demesures_sont_refuses() {
        assert!(valider_connexion("h", 0, "u", "p").is_err());
        assert!(valider_connexion(&"h".repeat(254), 993, "u", "p").is_err());
        assert!(valider_connexion("h", 993, &"u".repeat(255), "p").is_err());
        assert!(valider_connexion("h", 993, "u", &"p".repeat(1025)).is_err());
        assert!(valider_connexion("h", 993, "u\nv", "p").is_err());
    }
}
