//! Identité des membres du cabinet : civilité, prénom, nom, qualité, barreau, toque.
//!
//! Écriture en ligne par l'API (jamais par la file d'envoi PowerSync) : l'identité descend vers les postes
//! par le flux `utilisateurs_cabinet`. Aucune valeur n'est déduite de l'adresse e-mail.

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::jwt::AccessClaims;
use crate::conflits::{
    appliquer_champ_texte, cle_idempotence, reserver_idempotence, valider_base_revision,
    ContexteChamp,
};
use crate::error::ApiError;
use crate::routes::brouillons::double_option;
use crate::routes::collaborateurs::exiger_administrateur;
use crate::state::AppState;

const CIVILITES: &[&str] = &["madame", "monsieur"];
const QUALITES: &[&str] = &[
    "avocat",
    "avocat_collaborateur",
    "juriste",
    "assistant",
    "autre",
];
const QUALITES_AVOCAT: &[&str] = &["avocat", "avocat_collaborateur"];
const LONGUEUR_MAX: usize = 100;
const LONGUEUR_TOQUE_MAX: usize = 20;

/// Identité d'un membre, telle que l'API la lit et la renvoie.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilMembreResponse {
    pub id: Uuid,
    pub email: String,
    /// `administrateur` ou `collaborateur` ; ne se modifie pas par ces routes.
    pub role: String,
    pub actif: bool,
    /// `madame` ou `monsieur`, nul tant que non saisi.
    pub civilite: Option<String>,
    pub prenom: Option<String>,
    pub nom: Option<String>,
    /// `avocat`, `avocat_collaborateur`, `juriste`, `assistant` ou `autre`, nul tant que non saisi.
    pub qualite: Option<String>,
    pub barreau: Option<String>,
    pub toque: Option<String>,
    pub initiales: Option<String>,
    pub revision: i64,
}

/// Modification d'identité. Un champ absent reste tel quel ; `null` ou une chaîne vide l'efface (NULL).
/// Le rôle, l'adresse e-mail, l'état actif et les initiales ne se modifient pas ici : tout champ
/// inconnu du corps est ignoré.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ModifierProfilRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub civilite: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub prenom: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub nom: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub qualite: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub barreau: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub toque: Option<Option<String>>,
}

/// Texte rogné ; une chaîne vide devient `None`.
fn net(valeur: &str) -> Option<String> {
    let rogne = valeur.trim();
    (!rogne.is_empty()).then(|| rogne.to_string())
}

struct Identite {
    civilite: Option<String>,
    prenom: Option<String>,
    nom: Option<String>,
    qualite: Option<String>,
    barreau: Option<String>,
    toque: Option<String>,
}

/// Contrôles de l'identité telle qu'elle sera enregistrée (valeurs déjà rognées).
fn valider_identite(identite: &Identite) -> Result<(), ApiError> {
    if let Some(civilite) = identite.civilite.as_deref() {
        if !CIVILITES.contains(&civilite) {
            return Err(ApiError::bad_request("Civilité inconnue"));
        }
    }
    if let Some(qualite) = identite.qualite.as_deref() {
        if !QUALITES.contains(&qualite) {
            return Err(ApiError::bad_request("Qualité inconnue"));
        }
    }
    for (valeur, maximum, message) in [
        (&identite.prenom, LONGUEUR_MAX, "Prénom trop long"),
        (&identite.nom, LONGUEUR_MAX, "Nom trop long"),
        (&identite.barreau, LONGUEUR_MAX, "Barreau trop long"),
        (&identite.toque, LONGUEUR_TOQUE_MAX, "Toque trop longue"),
    ] {
        if valeur
            .as_deref()
            .is_some_and(|v| v.chars().count() > maximum)
        {
            return Err(ApiError::bad_request(message));
        }
    }
    let avocat = identite
        .qualite
        .as_deref()
        .is_some_and(|q| QUALITES_AVOCAT.contains(&q));
    if !avocat && (identite.barreau.is_some() || identite.toque.is_some()) {
        return Err(ApiError::bad_request(
            "Le barreau et la toque ne se renseignent que pour un avocat ou un avocat collaborateur",
        ));
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct LigneProfil {
    id: Uuid,
    email: String,
    role: String,
    actif: bool,
    civilite: Option<String>,
    prenom: Option<String>,
    nom: Option<String>,
    qualite: Option<String>,
    barreau: Option<String>,
    toque: Option<String>,
    initiales: Option<String>,
    revision: i64,
}

impl From<LigneProfil> for ProfilMembreResponse {
    fn from(l: LigneProfil) -> Self {
        Self {
            id: l.id,
            email: l.email,
            role: l.role,
            actif: l.actif,
            civilite: l.civilite,
            prenom: l.prenom,
            nom: l.nom,
            qualite: l.qualite,
            barreau: l.barreau,
            toque: l.toque,
            initiales: l.initiales,
            revision: l.revision,
        }
    }
}

async fn lire_profil(
    pool: &PgPool,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<ProfilMembreResponse, ApiError> {
    sqlx::query_as::<_, LigneProfil>(
        r#"
        SELECT id, email, role, actif, civilite, prenom, nom, qualite, barreau, toque, initiales, revision
        FROM utilisateurs WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(utilisateur_id)
    .bind(cabinet_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("lecture du profil"))?
    .map(ProfilMembreResponse::from)
    .ok_or_else(|| ApiError::not_found("Utilisateur introuvable"))
}

#[utoipa::path(
    get,
    path = "/moi/profil",
    tag = "identite",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Identité de l'utilisateur du jeton", body = ProfilMembreResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Utilisateur introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_mon_profil(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<ProfilMembreResponse>, ApiError> {
    lire_profil(&state.pool, claims.cabinet_id, claims.sub)
        .await
        .map(Json)
}

#[utoipa::path(
    patch,
    path = "/moi/profil",
    tag = "identite",
    security(("bearer_auth" = [])),
    request_body = ModifierProfilRequest,
    responses(
        (status = 200, description = "Identité modifiée, ou déjà dans cet état (rejeu)", body = ProfilMembreResponse),
        (status = 400, description = "Valeur refusée (civilité, qualité, longueur, barreau ou toque pour une qualité qui n'est pas avocat), version de base, clé d'idempotence", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Utilisateur introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn modifier_mon_profil(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<ModifierProfilRequest>,
) -> Result<Json<ProfilMembreResponse>, ApiError> {
    modifier_identite(&state.pool, &claims, claims.sub, body)
        .await
        .map(Json)
}

#[utoipa::path(
    get,
    path = "/utilisateurs",
    tag = "identite",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Membres du cabinet (actifs ou non) avec leur identité", body = Vec<ProfilMembreResponse>),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Réservé aux administrateurs du cabinet", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lister_utilisateurs(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<ProfilMembreResponse>>, ApiError> {
    exiger_administrateur(&state.pool, &claims).await?;
    let lignes = sqlx::query_as::<_, LigneProfil>(
        r#"
        SELECT id, email, role, actif, civilite, prenom, nom, qualite, barreau, toque, initiales, revision
        FROM utilisateurs WHERE cabinet_id = $1 ORDER BY email
        "#,
    )
    .bind(claims.cabinet_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture des utilisateurs"))?;
    Ok(Json(lignes.into_iter().map(Into::into).collect()))
}

#[utoipa::path(
    patch,
    path = "/utilisateurs/{utilisateur_id}/profil",
    tag = "identite",
    security(("bearer_auth" = [])),
    params(("utilisateur_id" = Uuid, Path, description = "Membre du cabinet dont l'identité change")),
    request_body = ModifierProfilRequest,
    responses(
        (status = 200, description = "Identité modifiée, ou déjà dans cet état (rejeu)", body = ProfilMembreResponse),
        (status = 400, description = "Valeur refusée, version de base, clé d'idempotence", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Réservé aux administrateurs du cabinet", body = crate::error::ApiErrorBody),
        (status = 404, description = "Utilisateur introuvable ou d'un autre cabinet", body = crate::error::ApiErrorBody),
    )
)]
pub async fn modifier_profil_membre(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(utilisateur_id): axum::extract::Path<Uuid>,
    Json(body): Json<ModifierProfilRequest>,
) -> Result<Json<ProfilMembreResponse>, ApiError> {
    exiger_administrateur(&state.pool, &claims).await?;
    modifier_identite(&state.pool, &claims, utilisateur_id, body)
        .await
        .map(Json)
}

type LigneIdentite = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
);

/// Écriture d'identité : verrou de la ligne, rejeu par clé, version de base, contrôles sur les valeurs
/// finales, dernière écriture gagnante par champ journalisée.
async fn modifier_identite(
    pool: &PgPool,
    claims: &AccessClaims,
    cible: Uuid,
    body: ModifierProfilRequest,
) -> Result<ProfilMembreResponse, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.civilite.is_none()
        && body.prenom.is_none()
        && body.nom.is_none()
        && body.qualite.is_none()
        && body.barreau.is_none()
        && body.toque.is_none()
    {
        return Err(ApiError::bad_request("Aucune modification demandée"));
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let (civilite, prenom, nom, qualite, barreau, toque, revision_actuelle) =
        sqlx::query_as::<_, LigneIdentite>(
            r#"
            SELECT civilite, prenom, nom, qualite, barreau, toque, revision
            FROM utilisateurs WHERE id = $1 AND cabinet_id = $2 FOR UPDATE
            "#,
        )
        .bind(cible)
        .bind(claims.cabinet_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture utilisateur"))?
        .ok_or_else(|| ApiError::not_found("Utilisateur introuvable"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_profil(pool, claims.cabinet_id, cible).await;
    }
    valider_base_revision(body.base_revision, revision_actuelle)?;

    let final_de = |nouveau: &Option<Option<String>>, actuel: &Option<String>| match nouveau {
        Some(valeur) => valeur.as_deref().and_then(net),
        None => actuel.clone(),
    };
    let finale = Identite {
        civilite: final_de(&body.civilite, &civilite),
        prenom: final_de(&body.prenom, &prenom),
        nom: final_de(&body.nom, &nom),
        qualite: final_de(&body.qualite, &qualite),
        barreau: final_de(&body.barreau, &barreau),
        toque: final_de(&body.toque, &toque),
    };
    valider_identite(&finale)?;

    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: cible,
        table_cible: "utilisateurs",
        dossier_id: None,
    };
    let valeur_demandee = |nouveau: &Option<Option<String>>| {
        nouveau
            .as_ref()
            .map(|valeur| valeur.as_deref().and_then(net).unwrap_or_default())
    };
    let changements = [
        (
            "civilite",
            valeur_demandee(&body.civilite),
            civilite.unwrap_or_default(),
        ),
        (
            "prenom",
            valeur_demandee(&body.prenom),
            prenom.unwrap_or_default(),
        ),
        ("nom", valeur_demandee(&body.nom), nom.unwrap_or_default()),
        (
            "qualite",
            valeur_demandee(&body.qualite),
            qualite.unwrap_or_default(),
        ),
        (
            "barreau",
            valeur_demandee(&body.barreau),
            barreau.unwrap_or_default(),
        ),
        (
            "toque",
            valeur_demandee(&body.toque),
            toque.unwrap_or_default(),
        ),
    ];
    let mut revision = revision_actuelle;
    for (champ, nouveau, actuel) in &changements {
        appliquer_champ_texte(
            &mut tx,
            &contexte,
            champ,
            nouveau.as_deref(),
            actuel,
            &mut revision,
        )
        .await?;
    }
    if revision != revision_actuelle {
        sqlx::query(
            r#"
            UPDATE utilisateurs
            SET civilite = $1, prenom = $2, nom = $3, qualite = $4, barreau = $5, toque = $6,
                revision = $7
            WHERE id = $8
            "#,
        )
        .bind(finale.civilite.as_deref())
        .bind(finale.prenom.as_deref())
        .bind(finale.nom.as_deref())
        .bind(finale.qualite.as_deref())
        .bind(finale.barreau.as_deref())
        .bind(finale.toque.as_deref())
        .bind(revision)
        .bind(cible)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("mise à jour de l'identité"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_profil(pool, claims.cabinet_id, cible).await
}

#[cfg(test)]
mod tests {
    use super::{net, valider_identite, Identite};

    fn identite(qualite: Option<&str>, barreau: Option<&str>, toque: Option<&str>) -> Identite {
        Identite {
            civilite: Some("madame".into()),
            prenom: Some("Camille".into()),
            nom: Some("Exemple".into()),
            qualite: qualite.map(str::to_string),
            barreau: barreau.map(str::to_string),
            toque: toque.map(str::to_string),
        }
    }

    #[test]
    fn le_texte_est_rogne_et_le_vide_devient_absent() {
        assert_eq!(net("  Camille "), Some("Camille".to_string()));
        assert_eq!(net("   "), None);
        assert_eq!(net(""), None);
    }

    #[test]
    fn barreau_et_toque_reserves_aux_avocats() {
        assert!(valider_identite(&identite(Some("avocat"), Some("Paris"), Some("P0123"))).is_ok());
        assert!(
            valider_identite(&identite(Some("avocat_collaborateur"), Some("Paris"), None)).is_ok()
        );
        assert!(valider_identite(&identite(Some("juriste"), Some("Paris"), None)).is_err());
        assert!(valider_identite(&identite(None, None, Some("P0123"))).is_err());
        assert!(valider_identite(&identite(Some("assistant"), None, None)).is_ok());
    }

    #[test]
    fn valeurs_inconnues_ou_trop_longues_refusees() {
        let mut i = identite(Some("avocat"), None, None);
        i.civilite = Some("mademoiselle".into());
        assert!(valider_identite(&i).is_err());
        let mut i = identite(Some("stagiaire"), None, None);
        i.civilite = None;
        assert!(valider_identite(&i).is_err());
        let mut i = identite(None, None, None);
        i.prenom = Some("x".repeat(101));
        assert!(valider_identite(&i).is_err());
        let i = identite(Some("avocat"), None, Some("T".repeat(21).as_str()));
        assert!(valider_identite(&i).is_err());
    }
}
