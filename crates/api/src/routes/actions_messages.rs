//! Actions sur les messages d'une boîte nominative ou partagée (J11, critère iii) : marquer lu ou
//! non lu, archiver, supprimer, déplacer.
//!
//! **Droits** : l'action porte sur un message que l'utilisateur peut lire (boîte nominative de son
//! seul titulaire, boîte partagée de ses seuls membres, dossier restreint réservé à ses accès :
//! `message_lisible_par`, la règle des flux de synchronisation). Tout autre message est
//! « introuvable » (404), comme pour les brouillons : rien n'est révélé.
//!
//! **File** : la demande est inscrite dans `actions_messages` (clé d'idempotence par utilisateur),
//! puis tentée tout de suite, sans dépasser `ATTENTE_IMMEDIATE`. Serveur IMAP coupé : la réponse
//! dit `en_attente`, le balayage du moteur reprend l'action (voir `crate::actions_messages`).
//! Lu et dossier ne changent dans `messages`, donc pour le poste, qu'une fois le serveur IMAP
//! passé. « Supprimer » déplace vers la Corbeille ; aucun message n'est jamais expurgé.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::actions_messages::{ActionsMessages, GenreAction};
use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::routes::messagerie::message_lisible;
use crate::state::AppState;

/// Temps laissé à la première tentative avant de répondre `en_attente`. Une tentative plus longue
/// continue en tâche de fond.
const ATTENTE_IMMEDIATE: Duration = Duration::from_secs(8);
const CLE_MAX: usize = 200;
const DOSSIER_MAX: usize = 200;
const LIMITE_DEFAUT: i64 = 50;
const LIMITE_MAX: i64 = 200;

/// Colonnes lues d'une action (littéral assemblé à la compilation, jamais par concaténation).
macro_rules! colonnes {
    () => {
        "a.id, a.message_ref, a.compte_id, a.genre, a.destination, a.etat, a.tentatives,          a.erreur, a.dossier_final,          to_char(a.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS cree_le,          to_char(a.applique_le AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')              AS applique_le"
    };
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerActionRequest {
    /// `lu`, `non_lu`, `archiver`, `supprimer` ou `deplacer`.
    pub genre: String,
    /// Dossier IMAP de destination (obligatoire pour `deplacer`, refusé sinon). Créé au besoin.
    #[serde(default)]
    pub destination: Option<String>,
    /// Clé choisie par l'appelant, unique par utilisateur : le même appel rejoué rend la même
    /// action sans en créer de seconde ; la même clé avec d'autres paramètres est refusée (409).
    pub idempotence_cle: String,
}

#[derive(Debug, sqlx::FromRow)]
struct LigneAction {
    id: Uuid,
    message_ref: Uuid,
    compte_id: Uuid,
    genre: String,
    destination: Option<String>,
    etat: String,
    tentatives: i32,
    erreur: Option<String>,
    dossier_final: Option<String>,
    cree_le: String,
    applique_le: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActionMessageResponse {
    pub id: Uuid,
    /// Message visé (`messages.id`).
    pub message_id: Uuid,
    pub compte_id: Uuid,
    pub genre: String,
    pub destination: Option<String>,
    /// `en_attente` (pas encore passée sur le serveur IMAP, reprise automatique), `appliquee` ou
    /// `echec` (abandonnée : message disparu du serveur, commande refusée, serveur injoignable
    /// trop longtemps).
    pub etat: String,
    pub tentatives: i32,
    /// Code technique de la dernière tentative manquée (`connexion`, `authentification`,
    /// `protocole`, `compte`, `message_absent`) ; absent quand l'action est appliquée.
    pub erreur: Option<String>,
    /// Dossier IMAP où le message se trouve une fois l'action appliquée (déplacements).
    pub dossier_final: Option<String>,
    /// Vrai si cette réponse est celle d'un appel déjà reçu avec la même clé d'idempotence.
    pub rejeu: bool,
    pub cree_le: String,
    pub applique_le: Option<String>,
}

impl ActionMessageResponse {
    fn depuis(ligne: LigneAction, rejeu: bool) -> Self {
        Self {
            id: ligne.id,
            message_id: ligne.message_ref,
            compte_id: ligne.compte_id,
            genre: ligne.genre,
            destination: ligne.destination,
            etat: ligne.etat,
            tentatives: ligne.tentatives,
            erreur: ligne.erreur,
            dossier_final: ligne.dossier_final,
            rejeu,
            cree_le: ligne.cree_le,
            applique_le: ligne.applique_le,
        }
    }
}

/// Clé d'idempotence acceptée : non vide, bornée, sans caractère de contrôle.
pub fn cle_valide(cle: &str) -> bool {
    !cle.trim().is_empty() && cle.chars().count() <= CLE_MAX && !cle.chars().any(char::is_control)
}

/// Nom de dossier IMAP acceptable : non vide, borné, sans caractère de contrôle ni espace en
/// bordure, sans joker de LIST (`*`, `%`).
pub fn dossier_valide(nom: &str) -> bool {
    !nom.is_empty()
        && nom.trim() == nom
        && nom.chars().count() <= DOSSIER_MAX
        && !nom.chars().any(|c| c.is_control() || c == '*' || c == '%')
}

async fn lire(
    state: &AppState,
    id: Uuid,
    utilisateur_id: Uuid,
    cabinet_id: Uuid,
) -> Result<Option<LigneAction>, ApiError> {
    sqlx::query_as::<_, LigneAction>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM actions_messages a \
         WHERE a.id = $1 AND a.utilisateur_id = $2 AND a.cabinet_id = $3"
    ))
    .bind(id)
    .bind(utilisateur_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de l'action"))
}

/// Demande une action sur un message : inscrite dans la file, tentée aussitôt, reprise ensuite si
/// le serveur IMAP ne répond pas.
#[utoipa::path(
    post,
    path = "/messagerie/messages/{message_id}/actions",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = CreerActionRequest,
    responses(
        (status = 200, description = "Action inscrite (ou rejouée) avec son état", body = ActionMessageResponse),
        (status = 400, description = "Genre inconnu, destination absente ou invalide, clé d'idempotence invalide", body = crate::error::ApiErrorBody),
        (status = 404, description = "Message introuvable, ou d'une boîte ou d'un dossier que l'utilisateur ne peut pas lire", body = crate::error::ApiErrorBody),
        (status = 409, description = "Clé d'idempotence déjà utilisée pour une autre demande", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_action(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(message_id): Path<Uuid>,
    Json(corps): Json<CreerActionRequest>,
) -> Result<Json<ActionMessageResponse>, ApiError> {
    // Les droits d'abord : un message illisible est introuvable, quelle que soit la demande.
    if !message_lisible(&state.pool, claims.cabinet_id, claims.sub, message_id).await? {
        return Err(ApiError::not_found("Message introuvable"));
    }
    let genre = GenreAction::depuis_texte(&corps.genre).ok_or_else(|| {
        ApiError::bad_request("Action inconnue : lu, non_lu, archiver, supprimer ou deplacer")
    })?;
    if !cle_valide(&corps.idempotence_cle) {
        return Err(ApiError::bad_request(
            "Clé d'idempotence requise (200 caractères au plus, sans caractère de contrôle)",
        ));
    }
    let destination = match (genre, corps.destination.as_deref()) {
        (GenreAction::Deplacer, Some(nom)) if dossier_valide(nom) => Some(nom.to_owned()),
        (GenreAction::Deplacer, _) => {
            return Err(ApiError::bad_request(
                "Dossier de destination absent ou invalide",
            ))
        }
        (_, Some(_)) => {
            return Err(ApiError::bad_request(
                "Une destination ne se donne que pour déplacer",
            ))
        }
        (_, None) => None,
    };

    let id = Uuid::now_v7();
    // Le rang est attribué à l'INSERT, mais une transaction concurrente peut être validée avant
    // une autre de rang plus petit : l'exécuteur verrait alors la plus récente sans voir la plus
    // ancienne et les jouerait en parallèle depuis la même position. Le verrou consultatif du
    // message tient jusqu'à la validation : l'ordre des rangs est celui des validations.
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Inscription de l'action"))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))")
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Inscription de l'action"))?;
    let inseree = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO actions_messages (
            id, cabinet_id, utilisateur_id, compte_id, message_ref, message_id,
            genre, destination, idempotence_cle
        )
        SELECT $1, m.cabinet_id, $2, m.compte_id, m.id, m.message_id, $4, $5, $6
        FROM messages m
        WHERE m.id = $3 AND m.cabinet_id = $7
        ON CONFLICT (utilisateur_id, idempotence_cle) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(id)
    .bind(claims.sub)
    .bind(message_id)
    .bind(genre.texte())
    .bind(destination.as_deref())
    .bind(&corps.idempotence_cle)
    .bind(claims.cabinet_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Inscription de l'action"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Inscription de l'action"))?;

    let (id, rejeu) = match inseree {
        Some(id) => (id, false),
        None => {
            // Clé déjà vue : même demande (rejeu) ou autre demande (conflit).
            let (existante, message, genre_existant, destination_existante) =
                sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>)>(
                    "SELECT id, message_ref, genre, destination FROM actions_messages \
                     WHERE utilisateur_id = $1 AND idempotence_cle = $2",
                )
                .bind(claims.sub)
                .bind(&corps.idempotence_cle)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| ApiError::internal("Lecture de l'action"))?
                .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
            if message != message_id
                || genre_existant != genre.texte()
                || destination_existante != destination
            {
                return Err(ApiError::conflict(
                    "Cette clé d'idempotence a déjà servi pour une autre demande",
                ));
            }
            (existante, true)
        }
    };

    // Tentative immédiate. La tâche est détachée : si elle dépasse l'attente, elle se poursuit et
    // conclut l'action ; la réponse dit alors `en_attente`.
    let executeur = ActionsMessages::new(
        state.pool.clone(),
        state.totp_cipher_key,
        state.messagerie.clone(),
    );
    let tache = tokio::spawn(async move { executeur.appliquer(id).await });
    let _ = tokio::time::timeout(ATTENTE_IMMEDIATE, tache).await;

    let ligne = lire(&state, id, claims.sub, claims.cabinet_id)
        .await?
        .ok_or_else(|| ApiError::internal("Action introuvable après inscription"))?;
    Ok(Json(ActionMessageResponse::depuis(ligne, rejeu)))
}

/// État d'une action de l'utilisateur.
#[utoipa::path(
    get,
    path = "/messagerie/actions/{action_id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Action de l'utilisateur", body = ActionMessageResponse),
        (status = 404, description = "Action introuvable ou d'un autre utilisateur", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_action(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(action_id): Path<Uuid>,
) -> Result<Json<ActionMessageResponse>, ApiError> {
    let ligne = lire(&state, action_id, claims.sub, claims.cabinet_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Action introuvable"))?;
    Ok(Json(ActionMessageResponse::depuis(ligne, false)))
}

#[derive(Debug, Deserialize)]
pub struct ListeActionsQuery {
    /// `en_attente`, `appliquee` ou `echec` ; absent : toutes.
    pub etat: Option<String>,
    pub limite: Option<i64>,
}

/// Actions de l'utilisateur, les plus récentes d'abord (jamais celles d'un autre collaborateur).
#[utoipa::path(
    get,
    path = "/messagerie/actions",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(
        ("etat" = Option<String>, Query, description = "en_attente, appliquee ou echec"),
        ("limite" = Option<i64>, Query, description = "50 par défaut, 200 au plus"),
    ),
    responses(
        (status = 200, description = "Actions de l'utilisateur", body = [ActionMessageResponse]),
        (status = 400, description = "État inconnu", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lister_actions(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(requete): Query<ListeActionsQuery>,
) -> Result<Json<Vec<ActionMessageResponse>>, ApiError> {
    if let Some(etat) = requete.etat.as_deref() {
        if !matches!(etat, "en_attente" | "appliquee" | "echec") {
            return Err(ApiError::bad_request(
                "État inconnu : en_attente, appliquee ou echec",
            ));
        }
    }
    let limite = requete.limite.unwrap_or(LIMITE_DEFAUT).clamp(1, LIMITE_MAX);
    let lignes = sqlx::query_as::<_, LigneAction>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM actions_messages a \
         WHERE a.utilisateur_id = $1 AND a.cabinet_id = $2 AND ($3::text IS NULL OR a.etat = $3) \
         ORDER BY a.rang DESC LIMIT $4"
    ))
    .bind(claims.sub)
    .bind(claims.cabinet_id)
    .bind(requete.etat.as_deref())
    .bind(limite)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des actions"))?;
    Ok(Json(
        lignes
            .into_iter()
            .map(|ligne| ActionMessageResponse::depuis(ligne, false))
            .collect(),
    ))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::{cle_valide, dossier_valide};

    #[test]
    fn le_contrat_openapi_decrit_les_actions_et_la_recherche() {
        use utoipa::OpenApi;
        let doc = serde_json::to_value(crate::openapi::ApiDoc::openapi()).expect("openapi");
        let chemins = doc["paths"].as_object().expect("paths");
        for (chemin, methode) in [
            ("/messagerie/messages/{message_id}/actions", "post"),
            ("/messagerie/actions", "get"),
            ("/messagerie/actions/{action_id}", "get"),
            ("/messagerie/recherche", "get"),
        ] {
            let route = chemins.get(chemin).unwrap_or(&serde_json::Value::Null);
            assert!(
                route[methode].is_object(),
                "route absente : {methode} {chemin}"
            );
        }
        for schema in [
            "CreerActionRequest",
            "ActionMessageResponse",
            "MessageTrouve",
            "RechercheResponse",
        ] {
            assert!(
                doc["components"]["schemas"][schema].is_object(),
                "schéma absent : {schema}"
            );
        }
        // Les refus de droits sont dans le contrat : 404 (jamais 403) et 409 pour la clé réutilisée.
        let reponses =
            &doc["paths"]["/messagerie/messages/{message_id}/actions"]["post"]["responses"];
        for statut in ["200", "400", "404", "409"] {
            assert!(reponses[statut].is_object(), "statut absent : {statut}");
        }
    }

    #[test]
    fn cle_d_idempotence_bornee_et_sans_controle() {
        assert!(cle_valide("poste-1/lu/abc"));
        assert!(!cle_valide(""));
        assert!(!cle_valide("   "));
        assert!(!cle_valide("cle\navec retour"));
        assert!(!cle_valide(&"x".repeat(201)));
        assert!(cle_valide(&"x".repeat(200)));
    }

    #[test]
    fn nom_de_dossier_sans_joker_ni_controle() {
        assert!(dossier_valide("Archives"));
        assert!(dossier_valide("Clients/Dupont fictif"));
        assert!(dossier_valide("Éléments supprimés"));
        for faux in ["", " Archives", "Archives ", "A*", "100%", "a\r\nb", "a\0b"] {
            assert!(!dossier_valide(faux), "{faux:?}");
        }
        assert!(!dossier_valide(&"d".repeat(201)));
    }
}
