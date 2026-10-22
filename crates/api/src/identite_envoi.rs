//! Identité d'envoi d'un mail (J11, critère (i)).
//!
//! Un mail part de l'adresse du **compte choisi à la rédaction** (boîte nominative ou partagée) :
//!
//! * le `From` et l'expéditeur d'enveloppe sont l'adresse du compte ; seule la boîte de
//!   classement du cabinet écrit avec l'adresse d'envoi de l'instance (`MESSAGERIE_FROM`) ;
//! * `Reply-To` n'est écrit que si le compte en définit un (`comptes_mail.repondre_a`) ;
//! * le relais SMTP est celui du compte (`smtp_hote`). **Repli** : si le compte ne définit pas de
//!   SMTP, le SMTP du cabinet (variables `MESSAGERIE_SMTP_*`) sert de relais, avec l'enveloppe et
//!   le `From` du compte. Ce repli ne vaut que pour un compte sans SMTP propre et il est
//!   journalisé (identifiant de compte seulement) ;
//! * la copie va dans le dossier « Envoyés » **du compte d'envoi** (ses identifiants IMAP).
//!
//! Droit d'écrire : boîte nominative, son titulaire ; boîte partagée, ses membres ; boîte de
//! classement, tout le cabinet. Le compte d'un autre est introuvable (404, jamais 403) avant tout effet.

use legalos_messagerie::{
    adresse_et_nom, champ_en_tete_valide, ChiffrementSmtp, ParametresCompte, ParametresSmtp,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::jwt::AccessClaims;
use crate::error::ApiError;
use crate::routes::redaction::parametres_imap_depuis;
use crate::state::AppState;

/// Port SMTP de soumission quand un compte définit un hôte sans port.
const PORT_SMTP_DEFAUT: u16 = 587;

/// Ce qu'il faut pour envoyer depuis un compte et y ranger la copie.
#[derive(Clone)]
pub struct IdentiteEnvoi {
    pub compte_id: Uuid,
    pub type_compte: String,
    /// Adresse du `From` et de l'enveloppe.
    pub de: String,
    /// `Reply-To` du compte, s'il en définit un.
    pub repondre_a: Option<String>,
    /// Relais SMTP (du compte, ou repli sur celui du cabinet).
    pub smtp: ParametresSmtp,
    /// Vrai si le relais est celui du cabinet faute de SMTP propre au compte.
    pub smtp_du_cabinet: bool,
    /// IMAP du compte, pour la copie dans « Envoyés ».
    pub imap: ParametresCompte,
}

/// SMTP propre à un compte, tel que lu en base (secret déjà déchiffré).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmtpDuCompte {
    pub hote: String,
    pub port: Option<u16>,
    pub utilisateur: String,
    /// Secret SMTP propre, sinon celui d'IMAP ; vide si pas d'authentification.
    pub mot_de_passe: String,
    /// Chiffrement du transport ; à défaut, déduit du port (465 TLS, 587 STARTTLS, sinon en clair).
    pub chiffrement: Option<ChiffrementSmtp>,
    /// Jeton d'accès OAuth : le relais est alors authentifié en XOAUTH2.
    pub jeton_acces: Option<String>,
}

/// Adresse du `From` : celle du compte, sauf pour la boîte de classement du cabinet qui écrit avec
/// l'adresse d'envoi de l'instance (son « adresse » en base est un identifiant IMAP).
#[must_use]
pub fn expediteur_du_compte(
    type_compte: &str,
    adresse_compte: &str,
    adresse_cabinet: Option<&str>,
) -> Option<String> {
    if type_compte == "classement" {
        return adresse_cabinet.map(str::to_owned);
    }
    let adresse = adresse_compte.trim();
    (!adresse.is_empty()).then(|| adresse.to_owned())
}

/// Relais SMTP : celui du compte s'il en définit un, sinon (repli documenté) celui du cabinet.
/// `None` si ni l'un ni l'autre n'existe. Le booléen dit si le repli a servi.
#[must_use]
pub fn choisir_smtp(
    compte: Option<&SmtpDuCompte>,
    cabinet: Option<&ParametresSmtp>,
    de: &str,
) -> Option<(ParametresSmtp, bool)> {
    if let Some(propre) = compte {
        let port = propre.port.unwrap_or(PORT_SMTP_DEFAUT);
        return Some((
            ParametresSmtp {
                hote: propre.hote.clone(),
                port,
                utilisateur: propre.utilisateur.clone(),
                mot_de_passe: propre.mot_de_passe.clone(),
                adresse_from: de.to_owned(),
                chiffrement: propre
                    .chiffrement
                    .unwrap_or_else(|| ChiffrementSmtp::selon_le_port(port)),
                jeton_acces: propre.jeton_acces.clone(),
            },
            false,
        ));
    }
    let cabinet = cabinet?;
    Some((
        ParametresSmtp {
            adresse_from: de.to_owned(),
            ..cabinet.clone()
        },
        true,
    ))
}

/// Réglages d'envoi donnés à la création d'un compte (nominatif ou partagé). Tout est facultatif :
/// sans `smtp_hote`, le compte envoie par le SMTP du cabinet (repli).
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ReglagesEnvoi {
    pub smtp_hote: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_utilisateur: Option<String>,
    pub smtp_mot_de_passe: Option<String>,
    /// Adresse `Reply-To` du compte.
    pub repondre_a: Option<String>,
    /// `aucun`, `starttls` ou `implicite` ; à défaut, déduit du port SMTP.
    pub smtp_chiffrement: Option<String>,
}

/// Réglages validés, prêts à être stockés (secret SMTP chiffré).
#[derive(Debug, Default)]
pub struct ReglagesEnvoiStockes {
    pub smtp_hote: Option<String>,
    pub smtp_port: Option<i32>,
    pub smtp_utilisateur: Option<String>,
    pub smtp_secret_chiffre: Option<String>,
    pub repondre_a: Option<String>,
    pub smtp_chiffrement: Option<String>,
}

fn non_vide(valeur: Option<String>) -> Option<String> {
    valeur
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

impl ReglagesEnvoi {
    /// Valide (aucun retour à la ligne, `Reply-To` lisible, SMTP complet) et chiffre le secret.
    pub fn preparer(self, cle: &[u8; 32]) -> Result<ReglagesEnvoiStockes, ApiError> {
        let smtp_hote = non_vide(self.smtp_hote);
        let smtp_utilisateur = non_vide(self.smtp_utilisateur);
        let secret = self.smtp_mot_de_passe.filter(|v| !v.is_empty());
        let repondre_a = non_vide(self.repondre_a);
        if smtp_hote.is_none()
            && (self.smtp_port.is_some() || smtp_utilisateur.is_some() || secret.is_some())
        {
            return Err(ApiError::bad_request(
                "Paramètres SMTP incomplets : le serveur SMTP est manquant",
            ));
        }
        if let Some(hote) = &smtp_hote {
            if hote.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return Err(ApiError::bad_request("Serveur SMTP invalide"));
            }
        }
        if let Some(utilisateur) = &smtp_utilisateur {
            if !champ_en_tete_valide(utilisateur) {
                return Err(ApiError::bad_request("Identifiant SMTP invalide"));
            }
        }
        if let Some(adresse) = &repondre_a {
            if !champ_en_tete_valide(adresse) || adresse_et_nom(adresse).is_none() {
                return Err(ApiError::bad_request("Adresse de réponse invalide"));
            }
        }
        let smtp_chiffrement = match non_vide(self.smtp_chiffrement) {
            Some(valeur) => Some(
                ChiffrementSmtp::depuis_texte(&valeur)
                    .ok_or_else(|| ApiError::bad_request("Chiffrement SMTP invalide"))?
                    .texte()
                    .to_owned(),
            ),
            None => None,
        };
        let smtp_secret_chiffre = match secret {
            Some(clair) => Some(
                crate::moteur_mail::chiffrer_mot_de_passe(&clair, cle)
                    .map_err(|_| ApiError::internal("Chiffrement"))?,
            ),
            None => None,
        };
        Ok(ReglagesEnvoiStockes {
            smtp_hote,
            smtp_port: self.smtp_port.map(i32::from),
            smtp_utilisateur,
            smtp_secret_chiffre,
            repondre_a,
            smtp_chiffrement,
        })
    }
}

/// Compte d'envoi tel que lu en base, après vérification du droit d'écrire.
struct CompteEnvoi {
    type_compte: String,
    adresse: String,
    repondre_a: Option<String>,
    smtp_hote: Option<String>,
    smtp_port: Option<i32>,
    smtp_utilisateur: Option<String>,
    smtp_secret_chiffre: Option<String>,
    secret_imap_chiffre: Option<String>,
    smtp_chiffrement: Option<String>,
    oauth: bool,
}

type LigneCompte = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<i32>,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<String>,
    String,
);

/// Lit le compte et vérifie que l'utilisateur peut écrire depuis lui. 404 si le compte n'existe
/// pas dans le cabinet ; 403 (message en français) si l'utilisateur n'a pas le droit d'écrire
/// depuis ce compte.
async fn compte_autorise(
    state: &AppState,
    claims: &AccessClaims,
    compte_id: Uuid,
) -> Result<CompteEnvoi, ApiError> {
    let ligne = sqlx::query_as::<_, LigneCompte>(
        r#"
        SELECT type_compte, adresse, repondre_a, smtp_hote, smtp_port, smtp_utilisateur,
               smtp_secret_chiffre, secret_chiffre,
               COALESCE(compte_mail_lisible_par(id, $3), FALSE), smtp_chiffrement, secret_ref
        FROM comptes_mail
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(compte_id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du compte d'envoi"))?
    .ok_or_else(|| ApiError::not_found("Compte introuvable"))?;
    // Une boîte que l'utilisateur ne peut pas lire n'existe pas pour lui : 404, jamais 403 (rien n'est révélé).
    if !ligne.8 {
        return Err(ApiError::not_found("Compte introuvable"));
    }
    Ok(CompteEnvoi {
        type_compte: ligne.0,
        adresse: ligne.1,
        repondre_a: ligne.2,
        smtp_hote: ligne.3,
        smtp_port: ligne.4,
        smtp_utilisateur: ligne.5,
        smtp_secret_chiffre: ligne.6,
        secret_imap_chiffre: ligne.7,
        smtp_chiffrement: ligne.9,
        oauth: ligne.10 == "oauth",
    })
}

fn expediteur_de_l_instance(state: &AppState, compte: &CompteEnvoi) -> Result<String, ApiError> {
    expediteur_du_compte(
        &compte.type_compte,
        &compte.adresse,
        state
            .messagerie_smtp
            .as_ref()
            .map(|smtp| smtp.adresse_from.as_str()),
    )
    .ok_or_else(|| ApiError::bad_request("SMTP de messagerie non configuré"))
}

/// Adresse du `From` pour ce compte, après vérification du droit d'écrire (écriture d'un
/// brouillon). Ne lit ni le SMTP ni l'IMAP du compte.
pub async fn expediteur_pour_utilisateur(
    state: &AppState,
    claims: &AccessClaims,
    compte_id: Uuid,
) -> Result<String, ApiError> {
    let compte = compte_autorise(state, claims, compte_id).await?;
    expediteur_de_l_instance(state, &compte)
}

/// Identité d'envoi complète de l'utilisateur pour ce compte (404 / 403 comme ci-dessus).
pub async fn identite_pour_utilisateur(
    state: &AppState,
    claims: &AccessClaims,
    compte_id: Uuid,
) -> Result<IdentiteEnvoi, ApiError> {
    let compte = compte_autorise(state, claims, compte_id).await?;
    let de = expediteur_de_l_instance(state, &compte)?;
    let cabinet = state.messagerie_smtp.as_ref();

    let propre = match compte
        .smtp_hote
        .clone()
        .filter(|hote| !hote.trim().is_empty())
    {
        Some(hote) => {
            let utilisateur = compte.smtp_utilisateur.clone().unwrap_or_default();
            // Authentification : secret SMTP propre, à défaut le secret IMAP du compte.
            let chiffre = compte
                .smtp_secret_chiffre
                .clone()
                .or_else(|| compte.secret_imap_chiffre.clone());
            let mot_de_passe = match (utilisateur.is_empty(), chiffre) {
                (false, Some(chiffre)) => {
                    let clair =
                        crate::auth::totp::dechiffrer_secret_totp(&chiffre, &state.totp_cipher_key)
                            .map_err(|_| ApiError::internal("Déchiffrement"))?;
                    String::from_utf8(clair).map_err(|_| ApiError::internal("Déchiffrement"))?
                }
                _ => String::new(),
            };
            let (utilisateur, jeton_acces) = if compte.oauth {
                // Boîte OAuth : SMTP authentifié en XOAUTH2 avec le jeton d'accès, au nom de l'adresse de la boîte.
                let jeton = crate::oauth_mail::acces_valide(
                    &state.pool,
                    &state.totp_cipher_key,
                    compte_id,
                )
                .await
                .map_err(|erreur| match erreur {
                    crate::oauth_mail::ErreurJeton::Revoque => ApiError::conflict(
                        "Le fournisseur a refusé le jeton de cette boîte : reconnectez-la depuis Réglages.",
                    ),
                    _ => ApiError::with_code(
                        axum::http::StatusCode::BAD_GATEWAY,
                        "fournisseur_injoignable",
                        "Le fournisseur de messagerie ne répond pas, réessayez dans un instant.",
                    ),
                })?;
                (compte.adresse.clone(), Some(jeton))
            } else {
                (utilisateur, None)
            };
            Some(SmtpDuCompte {
                hote,
                port: compte.smtp_port.and_then(|port| u16::try_from(port).ok()),
                utilisateur,
                mot_de_passe,
                chiffrement: compte
                    .smtp_chiffrement
                    .as_deref()
                    .and_then(ChiffrementSmtp::depuis_texte),
                jeton_acces,
            })
        }
        None => None,
    };
    let (smtp, smtp_du_cabinet) = choisir_smtp(propre.as_ref(), cabinet, &de)
        .ok_or_else(|| ApiError::bad_request("SMTP de messagerie non configuré"))?;
    if smtp_du_cabinet && compte.type_compte != "classement" {
        // Le compte n'a pas de SMTP propre : le relais du cabinet sert (identifiant seulement).
        tracing::info!(
            compte = %compte_id,
            "envoi par le SMTP du cabinet : le compte n'a pas de SMTP propre"
        );
    }
    let imap = parametres_imap_depuis(
        &state.pool,
        &state.totp_cipher_key,
        state.messagerie.as_ref(),
        compte_id,
        &compte.type_compte,
    )
    .await?;
    Ok(IdentiteEnvoi {
        compte_id,
        type_compte: compte.type_compte,
        de,
        repondre_a: compte
            .repondre_a
            .map(|valeur| valeur.trim().to_owned())
            .filter(|valeur| !valeur.is_empty()),
        smtp,
        smtp_du_cabinet,
        imap,
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn cabinet() -> ParametresSmtp {
        ParametresSmtp {
            hote: "relais.cabinet.example".into(),
            port: 25,
            utilisateur: "relais".into(),
            mot_de_passe: "secret-fictif".into(),
            adresse_from: "cabinet@cabinet.example".into(),
            chiffrement: ChiffrementSmtp::Aucun,
            jeton_acces: None,
        }
    }

    #[test]
    fn le_from_est_l_adresse_du_compte_sauf_pour_la_boite_de_classement() {
        let cabinet = Some("cabinet@cabinet.example");
        assert_eq!(
            expediteur_du_compte("nominatif", "me.durand@cabinet.example", cabinet).as_deref(),
            Some("me.durand@cabinet.example")
        );
        assert_eq!(
            expediteur_du_compte("partage", "secretariat@cabinet.example", cabinet).as_deref(),
            Some("secretariat@cabinet.example")
        );
        // Essai négatif : l'adresse du cabinet ne remplace jamais celle d'un compte nominatif.
        assert_ne!(
            expediteur_du_compte("nominatif", "me.durand@cabinet.example", cabinet).as_deref(),
            cabinet
        );
        // Classement : l'« adresse » en base est un identifiant IMAP, l'envoi se fait au nom du
        // cabinet ; sans adresse d'envoi configurée, rien ne part.
        assert_eq!(
            expediteur_du_compte("classement", "demo", cabinet).as_deref(),
            cabinet
        );
        assert_eq!(expediteur_du_compte("classement", "demo", None), None);
        assert_eq!(expediteur_du_compte("nominatif", "  ", cabinet), None);
    }

    #[test]
    fn le_smtp_du_compte_l_emporte_et_le_repli_sert_seulement_sans_smtp_propre() {
        let propre = SmtpDuCompte {
            hote: "smtp.exemple.test".into(),
            port: Some(465),
            utilisateur: "me.durand".into(),
            mot_de_passe: "autre-secret".into(),
            chiffrement: None,
            jeton_acces: None,
        };
        let (smtp, repli) =
            choisir_smtp(Some(&propre), Some(&cabinet()), "me.durand@cabinet.example")
                .expect("smtp");
        assert!(!repli);
        assert_eq!(smtp.hote, "smtp.exemple.test");
        assert_eq!(smtp.port, 465);
        assert_eq!(smtp.adresse_from, "me.durand@cabinet.example");

        // Repli : relais du cabinet, enveloppe du compte (jamais l'adresse du cabinet).
        let (smtp, repli) =
            choisir_smtp(None, Some(&cabinet()), "me.durand@cabinet.example").expect("repli");
        assert!(repli);
        assert_eq!(smtp.hote, "relais.cabinet.example");
        assert_eq!(smtp.adresse_from, "me.durand@cabinet.example");

        // Port par défaut quand le compte donne un hôte sans port.
        let sans_port = SmtpDuCompte {
            port: None,
            ..propre
        };
        assert_eq!(
            choisir_smtp(Some(&sans_port), None, "x@y.example")
                .expect("sans cabinet")
                .0
                .port,
            PORT_SMTP_DEFAUT
        );
        // Ni SMTP propre ni SMTP du cabinet : refus, pas d'envoi.
        assert!(choisir_smtp(None, None, "x@y.example").is_none());
    }
}
