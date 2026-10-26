//! Boîtes (J11 étape 3, cahier § 3.8.5) : comptes lisibles, boîtes partagées et leurs membres,
//! tableau de santé.
//!
//! Droits : une boîte nominative n'est connue que de son titulaire, une boîte partagée que de ses
//! membres ; pour tout autre collaborateur elle est introuvable (404), pas interdite, pour ne rien
//! révéler. La règle vit dans la base (`compte_mail_lisible_par`), source unique des routes et des
//! flux de synchronisation. Aucun mot de passe ni adresse de serveur ne sort d'ici.

use std::collections::BTreeSet;
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
use crate::routes::redaction::est_doublon;
use crate::state::AppState;

/// Au-delà, un compte relevé par le moteur est « en retard » : le moteur relève au moins toutes
/// les 10 minutes (`RELEVE_SANS_REVEIL_SECS`), la marge couvre une relève lente.
pub const SEUIL_RETARD_SECS: i64 = 20 * 60;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CompteResume {
    pub id: Uuid,
    pub adresse: String,
    pub type_compte: String,
    pub etat_connexion: String,
}

/// Comptes que l'utilisateur peut lire : ses boîtes nominatives, les boîtes partagées dont il est
/// membre, la boîte de classement du cabinet.
#[utoipa::path(
    get,
    path = "/messagerie/comptes",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Comptes lisibles par l'utilisateur : ses boîtes nominatives, les boîtes partagées dont il est membre, la boîte de classement", body = Vec<CompteResume>),
    )
)]
pub async fn lister_comptes(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<CompteResume>>, ApiError> {
    let lignes = sqlx::query_as::<_, (Uuid, String, String, String)>(
        r#"
        SELECT c.id, c.adresse, c.type_compte, c.etat_connexion
        FROM comptes_mail c
        WHERE c.cabinet_id = $1 AND compte_mail_lisible_par(c.id, $2)
        ORDER BY c.cree_le ASC, c.id ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture comptes"))?;
    Ok(Json(
        lignes
            .into_iter()
            .map(|l| CompteResume {
                id: l.0,
                adresse: l.1,
                type_compte: l.2,
                etat_connexion: l.3,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreerBoitePartagee {
    pub id: Uuid,
    pub adresse: String,
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    pub tls: Option<bool>,
    /// Membres (identifiants d'utilisateurs du cabinet). Le créateur en fait toujours partie.
    #[serde(default)]
    pub membres: Vec<Uuid>,
    /// SMTP et `Reply-To` de la boîte (facultatifs, voir `identite_envoi`).
    #[serde(flatten)]
    pub envoi: ReglagesEnvoi,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BoitePartagee {
    pub id: Uuid,
    pub adresse: String,
    pub membres: Vec<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DefinirMembres {
    pub membres: Vec<Uuid>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Membre {
    pub utilisateur_id: Uuid,
    pub email: String,
}

/// Les membres demandés existent tous dans le cabinet de l'appelant.
async fn membres_du_cabinet(
    pool: &sqlx::PgPool,
    cabinet_id: Uuid,
    membres: &BTreeSet<Uuid>,
) -> Result<(), ApiError> {
    let ids: Vec<Uuid> = membres.iter().copied().collect();
    let trouves = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM utilisateurs WHERE cabinet_id = $1 AND id = ANY($2)",
    )
    .bind(cabinet_id)
    .bind(&ids)
    .fetch_one(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des membres"))?;
    if usize::try_from(trouves).ok() != Some(ids.len()) {
        return Err(ApiError::bad_request("Membre inconnu dans le cabinet"));
    }
    Ok(())
}

/// Crée une boîte partagée : mot de passe chiffré, jamais renvoyé ; le créateur est membre.
#[utoipa::path(
    post,
    path = "/messagerie/boites-partagees",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = CreerBoitePartagee,
    responses(
        (status = 200, description = "Boîte partagée créée ; le créateur en est membre (le mot de passe n'est jamais renvoyé)", body = BoitePartagee),
        (status = 400, description = "Boîte incomplète, membre inconnu du cabinet, ou réglages SMTP invalides", body = crate::error::ApiErrorBody),
        (status = 409, description = "Identifiant de compte déjà utilisé", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_boite_partagee(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerBoitePartagee>,
) -> Result<Json<BoitePartagee>, ApiError> {
    if body.mot_de_passe.is_empty()
        || body.hote.is_empty()
        || body.utilisateur.is_empty()
        || body.adresse.trim().is_empty()
    {
        return Err(ApiError::bad_request("Boîte incomplète"));
    }
    let mut membres: BTreeSet<Uuid> = body.membres.iter().copied().collect();
    membres.insert(claims.sub);
    membres_du_cabinet(&state.pool, claims.cabinet_id, &membres).await?;
    let secret =
        crate::moteur_mail::chiffrer_mot_de_passe(&body.mot_de_passe, &state.totp_cipher_key)
            .map_err(|_| ApiError::internal("Chiffrement"))?;
    let envoi = body.envoi.preparer(&state.totp_cipher_key)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Création boîte partagée"))?;
    let insertion = sqlx::query(
        r#"
        INSERT INTO comptes_mail (
            id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref,
            hote, port, utilisateur, tls, secret_chiffre,
            smtp_hote, smtp_port, smtp_utilisateur, smtp_secret_chiffre, repondre_a, smtp_chiffrement
        ) VALUES ($1, $2, 'partage', NULL, $3, 'chiffre', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.adresse.trim())
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
    .execute(&mut *tx)
    .await;
    if let Err(err) = insertion {
        return Err(if est_doublon(&err) {
            ApiError::conflict("Identifiant de compte déjà utilisé")
        } else {
            ApiError::internal("Création boîte partagée")
        });
    }
    for membre in &membres {
        sqlx::query(
            "INSERT INTO membres_boite_partagee (compte_id, utilisateur_id, cabinet_id) VALUES ($1, $2, $3)",
        )
        .bind(body.id)
        .bind(membre)
        .bind(claims.cabinet_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Enregistrement des membres"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Création boîte partagée"))?;
    Ok(Json(BoitePartagee {
        id: body.id,
        adresse: body.adresse.trim().to_owned(),
        membres: membres.into_iter().collect(),
    }))
}

/// Une boîte partagée dont l'appelant est membre ; sinon 404 (même réponse qu'une boîte absente).
async fn exiger_membre(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    compte_id: Uuid,
) -> Result<(), ApiError> {
    let membre = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM comptes_mail c
            INNER JOIN membres_boite_partagee b ON b.compte_id = c.id
            WHERE c.id = $1 AND c.cabinet_id = $2 AND c.type_compte = 'partage'
              AND b.utilisateur_id = $3
        )
        "#,
    )
    .bind(compte_id)
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des droits"))?;
    if membre {
        Ok(())
    } else {
        Err(ApiError::not_found("Boîte introuvable"))
    }
}

/// Membres d'une boîte partagée, visibles de ses seuls membres.
#[utoipa::path(
    get,
    path = "/messagerie/boites-partagees/{compte_id}/membres",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Membres de la boîte partagée, par adresse", body = Vec<Membre>),
        (status = 404, description = "Boîte introuvable, ou dont l'utilisateur n'est pas membre", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lister_membres(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
) -> Result<Json<Vec<Membre>>, ApiError> {
    exiger_membre(&state, claims.cabinet_id, claims.sub, compte_id).await?;
    let lignes = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT u.id, u.email
        FROM membres_boite_partagee b
        INNER JOIN utilisateurs u ON u.id = b.utilisateur_id
        WHERE b.compte_id = $1
        ORDER BY u.email ASC
        "#,
    )
    .bind(compte_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des membres"))?;
    Ok(Json(
        lignes
            .into_iter()
            .map(|l| Membre {
                utilisateur_id: l.0,
                email: l.1,
            })
            .collect(),
    ))
}

/// Remplace la liste des membres. Seul un membre actuel le peut ; la liste ne devient jamais vide
/// (une boîte sans membre serait orpheline).
#[utoipa::path(
    put,
    path = "/messagerie/boites-partagees/{compte_id}/membres",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = DefinirMembres,
    responses(
        (status = 200, description = "Liste des membres remplacée", body = BoitePartagee),
        (status = 400, description = "Liste vide ou membre inconnu du cabinet", body = crate::error::ApiErrorBody),
        (status = 404, description = "Boîte introuvable, ou dont l'utilisateur n'est pas membre", body = crate::error::ApiErrorBody),
    )
)]
pub async fn definir_membres(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
    Json(body): Json<DefinirMembres>,
) -> Result<Json<BoitePartagee>, ApiError> {
    exiger_membre(&state, claims.cabinet_id, claims.sub, compte_id).await?;
    let membres: BTreeSet<Uuid> = body.membres.iter().copied().collect();
    if membres.is_empty() {
        return Err(ApiError::bad_request(
            "Une boîte partagée garde au moins un membre",
        ));
    }
    membres_du_cabinet(&state.pool, claims.cabinet_id, &membres).await?;
    let ids: Vec<Uuid> = membres.iter().copied().collect();
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Mise à jour des membres"))?;
    sqlx::query(
        "DELETE FROM membres_boite_partagee WHERE compte_id = $1 AND NOT (utilisateur_id = ANY($2))",
    )
    .bind(compte_id)
    .bind(&ids)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Mise à jour des membres"))?;
    sqlx::query(
        r#"
        INSERT INTO membres_boite_partagee (compte_id, utilisateur_id, cabinet_id)
        SELECT $1, u, $3 FROM unnest($2::uuid[]) AS u
        ON CONFLICT (compte_id, utilisateur_id) DO NOTHING
        "#,
    )
    .bind(compte_id)
    .bind(&ids)
    .bind(claims.cabinet_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Mise à jour des membres"))?;
    let adresse = sqlx::query_scalar::<_, String>("SELECT adresse FROM comptes_mail WHERE id = $1")
        .bind(compte_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Mise à jour des membres"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Mise à jour des membres"))?;
    Ok(Json(BoitePartagee {
        id: compte_id,
        adresse,
        membres: ids,
    }))
}

// ---------------------------------------------------------------------------------------------
// Tableau de santé
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SanteCompte {
    pub compte_id: Uuid,
    pub adresse: String,
    pub type_compte: String,
    pub etat_connexion: String,
    /// Dernière relève réussie (UTC, RFC 3339) ; `None` si le compte n'a jamais été relevé.
    pub derniere_releve_le: Option<String>,
    /// Secondes écoulées depuis la dernière relève réussie (ou la création du compte). `None`
    /// pour la boîte de classement, relevée à la demande et non en continu.
    pub retard_secondes: Option<i64>,
    /// Refus d'authentification depuis la dernière relève réussie.
    pub erreurs_authentification: i64,
    pub derniere_erreur_authentification_le: Option<String>,
    /// Envois de l'utilisateur restés en échec dans la file, sur ce compte.
    pub envois_en_echec: i64,
    pub alerte: bool,
    /// `identifiants_refuses`, `serveur_indisponible`, `retard`, `envoi_en_echec`.
    pub motifs: Vec<String>,
    /// Boîte connectée par OAuth (Microsoft 365, Gmail) : « Reconnecter » repasse par le fournisseur, pas par un
    /// formulaire de mot de passe. Aucun jeton ne sort ici.
    pub oauth: bool,
    /// `microsoft` ou `gmail` pour une boîte OAuth.
    pub fournisseur: Option<String>,
    /// Indexation de fond du corps des messages (recherche sur les messages jamais ouverts) : messages indexés.
    pub corps_indexes: i64,
    /// Messages qu'il reste à indexer (hors abandons).
    pub corps_restants: i64,
    /// Messages abandonnés après cinq lectures impossibles (attente croissante entre deux).
    pub corps_abandonnes: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Sante {
    pub seuil_retard_secondes: i64,
    pub comptes: Vec<SanteCompte>,
    /// Envois de l'utilisateur en échec, tous comptes confondus.
    pub envois_en_echec: i64,
    /// Au moins un compte en alerte : le poste l'affiche dès qu'un compte ne se synchronise plus.
    pub alerte: bool,
}

type LigneSante = (
    Uuid,
    String,
    String,
    String,
    Option<String>,
    i64,
    i64,
    Option<String>,
    i64,
    bool,
    Option<String>,
);

/// Motifs d'alerte d'un compte (fonction pure : les règles sont testées sans base).
#[must_use]
pub fn motifs_alerte(
    type_compte: &str,
    etat_connexion: &str,
    retard_secondes: Option<i64>,
    envois_en_echec: i64,
) -> Vec<String> {
    let mut motifs = Vec::new();
    if etat_connexion == "identifiants_refuses" {
        motifs.push("identifiants_refuses".to_owned());
    }
    // Panne du serveur de messagerie depuis plusieurs tentatives : jamais présentée comme un refus d'identifiants.
    if etat_connexion == "indisponible" {
        motifs.push("serveur_indisponible".to_owned());
    }
    if type_compte != "classement" && retard_secondes.is_some_and(|s| s > SEUIL_RETARD_SECS) {
        motifs.push("retard".to_owned());
    }
    if envois_en_echec > 0 {
        motifs.push("envoi_en_echec".to_owned());
    }
    motifs
}

#[utoipa::path(
    get,
    path = "/messagerie/sante",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Tableau de santé des boîtes lisibles par l'utilisateur", body = Sante),
    )
)]
pub async fn sante_boites(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Sante>, ApiError> {
    // Les relèves et refus sont notés par le moteur dans `moteur_connexions` (issue `ok`,
    // `authentification`, `connexion`) ; l'état de connexion est celui de `comptes_mail`.
    let lignes: Vec<LigneSante> = sqlx::query_as(
        r#"
        SELECT c.id, c.adresse, c.type_compte, c.etat_connexion,
               to_char(rel.derniere AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               EXTRACT(EPOCH FROM (NOW() - COALESCE(rel.derniere, c.cree_le)))::bigint,
               (SELECT COUNT(*)::bigint FROM moteur_connexions k
                 WHERE k.compte_id = c.id AND k.issue = 'authentification'
                   AND k.cree_le > COALESCE(rel.derniere, '-infinity'::timestamptz)),
               to_char(aut.derniere AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               (SELECT COUNT(*)::bigint FROM file_envoi f
                 WHERE f.compte_id = c.id AND f.etat = 'echec'
                   AND (f.auteur_id IS NULL OR f.auteur_id = $2)),
               (c.secret_ref = 'oauth'), c.fournisseur
        FROM comptes_mail c
        LEFT JOIN LATERAL (
            SELECT MAX(k.cree_le) AS derniere FROM moteur_connexions k
            WHERE k.compte_id = c.id AND k.issue = 'ok'
        ) rel ON TRUE
        LEFT JOIN LATERAL (
            SELECT MAX(k.cree_le) AS derniere FROM moteur_connexions k
            WHERE k.compte_id = c.id AND k.issue = 'authentification'
        ) aut ON TRUE
        WHERE c.cabinet_id = $1 AND compte_mail_lisible_par(c.id, $2)
        ORDER BY c.cree_le ASC, c.id ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de la santé des boîtes"))?;
    let total_echecs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::bigint FROM file_envoi
        WHERE cabinet_id = $1 AND etat = 'echec' AND (auteur_id IS NULL OR auteur_id = $2)
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des envois en échec"))?;

    // Une seule définition de « à venir », celle de l'indexation de fond : ni les messages d'une UIDVALIDITY périmée
    // (attendent leur resynchronisation) ni les abandonnés ne comptent, sinon la progression ne finit jamais.
    let mut progressions = Vec::with_capacity(lignes.len());
    for l in &lignes {
        progressions.push(
            crate::indexation_corps::progression(&state.pool, l.0)
                .await
                .map_err(|_| ApiError::internal("Lecture de la santé des boîtes"))?,
        );
    }
    let comptes: Vec<SanteCompte> = lignes
        .into_iter()
        .zip(progressions)
        .map(|(l, p)| {
            let retard = (l.2 != "classement").then_some(l.5);
            let motifs = motifs_alerte(&l.2, &l.3, retard, l.8);
            SanteCompte {
                compte_id: l.0,
                adresse: l.1,
                type_compte: l.2,
                etat_connexion: l.3,
                derniere_releve_le: l.4,
                retard_secondes: retard,
                erreurs_authentification: l.6,
                derniere_erreur_authentification_le: l.7,
                envois_en_echec: l.8,
                alerte: !motifs.is_empty(),
                motifs,
                oauth: l.9,
                fournisseur: if l.9 { l.10 } else { None },
                corps_indexes: p.indexes,
                corps_restants: p.restants,
                corps_abandonnes: p.abandonnes,
            }
        })
        .collect();
    let alerte = comptes.iter().any(|c| c.alerte) || total_echecs > 0;
    Ok(Json(Sante {
        seuil_retard_secondes: SEUIL_RETARD_SECS,
        comptes,
        envois_en_echec: total_echecs,
        alerte,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compte_sain_sans_alerte() {
        assert!(motifs_alerte("nominatif", "connecte", Some(30), 0).is_empty());
    }

    #[test]
    fn refus_d_authentification_donne_une_alerte() {
        assert_eq!(
            motifs_alerte("nominatif", "identifiants_refuses", Some(30), 0),
            ["identifiants_refuses"]
        );
    }

    #[test]
    fn serveur_indisponible_donne_son_propre_motif_et_jamais_celui_des_identifiants() {
        let motifs = motifs_alerte("nominatif", "indisponible", Some(30), 0);
        assert_eq!(motifs, ["serveur_indisponible"]);
        assert!(!motifs.contains(&"identifiants_refuses".to_owned()));
    }

    #[test]
    fn retard_au_dela_du_seuil_seulement() {
        assert!(motifs_alerte("partage", "connecte", Some(SEUIL_RETARD_SECS), 0).is_empty());
        assert_eq!(
            motifs_alerte("partage", "connecte", Some(SEUIL_RETARD_SECS + 1), 0),
            ["retard"]
        );
    }

    #[test]
    fn la_boite_de_classement_n_est_jamais_en_retard() {
        assert!(motifs_alerte("classement", "connecte", Some(10_000_000), 0).is_empty());
    }

    #[test]
    fn envoi_en_echec_donne_une_alerte() {
        assert_eq!(
            motifs_alerte("classement", "inconnu", None, 2),
            ["envoi_en_echec"]
        );
    }
}
