//! Recherche serveur dans les messages (J11, critère iv) : objet, expéditeur, destinataires et
//! corps, dans les limites des droits de l'utilisateur.
//!
//! **Index** : `messages.recherche_tsv` (migration 045), plein texte français, accents et casse
//! repliés, adresses coupées en mots. Le corps recherché est ce qui est déjà stocké : le début du
//! corps (`extrait_texte`) de tous les messages et le corps complet (`texte_brut`) de ceux qui ont
//! été ouverts.
//!
//! **Saisie** : jamais interprétée par SQL. Elle est réduite à des mots (lettres et chiffres),
//! chacun cherché comme préfixe, tous requis (`mot:* & mot:*`), puis transmise comme paramètre à
//! `requete_recherche_messages`. Aucun joker n'existe donc : `%` et `_` ne sont que des séparateurs.
//!
//! **Droits** : les mêmes que la lecture (`message_lisible_par`, source des flux de
//! synchronisation) : boîte nominative de son titulaire, boîte partagée de ses membres, dossier
//! restreint réservé à ses accès. Un message illisible n'est jamais compté ni renvoyé, même
//! trouvé par un terme exact.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

/// Longueur maximale de la saisie, en caractères.
pub const SAISIE_MAX: usize = 256;
/// Mots retenus dans la saisie (les suivants sont ignorés).
const MOTS_MAX: usize = 8;
/// Longueur maximale d'un mot retenu, en caractères.
const MOT_MAX: usize = 64;
const LIMITE_DEFAUT: i64 = 25;
const LIMITE_MAX: i64 = 100;
const DECALAGE_MAX: i64 = 5_000;
const DOSSIER_MAX: usize = 200;

/// Pourquoi une saisie est refusée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaisieRefusee {
    Vide,
    TropLongue,
    /// Ni lettre ni chiffre (`%`, `_`, ponctuation) ou aucun mot d'au moins deux caractères.
    SansMot,
}

impl SaisieRefusee {
    fn erreur(self) -> ApiError {
        match self {
            Self::Vide => ApiError::bad_request("Recherche vide"),
            Self::TropLongue => ApiError::bad_request("Recherche trop longue"),
            Self::SansMot => {
                ApiError::bad_request("Saisissez au moins un mot de deux lettres ou chiffres")
            }
        }
    }
}

/// Saisie → texte de requête `mot:* & mot:*`. Les mots sont des suites de lettres et de chiffres ;
/// tout le reste (jokers, ponctuation, opérateurs de requête) sépare les mots et disparaît.
pub fn requete_de_saisie(saisie: &str) -> Result<String, SaisieRefusee> {
    if saisie.trim().is_empty() {
        return Err(SaisieRefusee::Vide);
    }
    if saisie.chars().count() > SAISIE_MAX {
        return Err(SaisieRefusee::TropLongue);
    }
    let mots: Vec<String> = saisie
        .split(|c: char| !c.is_alphanumeric())
        .filter(|mot| !mot.is_empty())
        .take(MOTS_MAX)
        .map(|mot| mot.chars().take(MOT_MAX).collect())
        .collect();
    if !mots.iter().any(|mot| mot.chars().count() >= 2) {
        return Err(SaisieRefusee::SansMot);
    }
    Ok(mots
        .iter()
        .map(|mot| format!("{mot}:*"))
        .collect::<Vec<_>>()
        .join(" & "))
}

#[derive(Debug, Deserialize)]
pub struct RechercheQuery {
    /// Mots cherchés (objet, expéditeur, destinataires, corps).
    pub q: Option<String>,
    /// Limite la recherche à une boîte.
    pub compte_id: Option<Uuid>,
    /// Limite la recherche à un dossier IMAP (`INBOX`, `Sent`, `Corbeille`…).
    pub dossier: Option<String>,
    /// 25 par défaut, 100 au plus.
    pub limite: Option<i64>,
    /// Résultats à sauter, 5 000 au plus.
    pub decalage: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
struct LigneTrouvee {
    id: Uuid,
    compte_id: Uuid,
    dossier_id: Option<Uuid>,
    dossier_imap: String,
    objet: String,
    expediteur: String,
    destinataires: String,
    extrait: String,
    date: String,
    lu: bool,
    etat_classement: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MessageTrouve {
    pub id: Uuid,
    pub compte_id: Uuid,
    /// Dossier du cabinet où le message est classé, s'il l'est.
    pub dossier_id: Option<Uuid>,
    /// Dossier IMAP du message dans sa boîte.
    pub dossier_imap: String,
    pub objet: String,
    pub expediteur: String,
    /// Destinataires, séparés par une virgule.
    pub destinataires: String,
    /// Début du corps.
    pub extrait: String,
    /// Date d'en-tête (sinon d'arrivée), en UTC.
    pub date: String,
    pub lu: bool,
    pub etat_classement: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RechercheResponse {
    pub resultats: Vec<MessageTrouve>,
    /// D'autres résultats existent après ceux-ci (`decalage` + `limite`).
    pub a_suivre: bool,
}

/// Cherche dans les messages que l'utilisateur peut lire, du plus récent au plus ancien.
#[utoipa::path(
    get,
    path = "/messagerie/recherche",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(
        ("q" = String, Query, description = "Mots cherchés, tous requis, en début de mot (deux caractères au moins, 256 au plus)"),
        ("compte_id" = Option<Uuid>, Query, description = "Limite à une boîte lisible par l'utilisateur"),
        ("dossier" = Option<String>, Query, description = "Limite à un dossier IMAP"),
        ("limite" = Option<i64>, Query, description = "25 par défaut, 100 au plus"),
        ("decalage" = Option<i64>, Query, description = "Résultats à sauter, 5000 au plus"),
    ),
    responses(
        (status = 200, description = "Messages lisibles qui correspondent", body = RechercheResponse),
        (status = 400, description = "Saisie vide, trop longue ou sans mot", body = crate::error::ApiErrorBody),
        (status = 404, description = "Boîte introuvable ou non lisible par l'utilisateur", body = crate::error::ApiErrorBody),
    )
)]
pub async fn rechercher_messages(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(requete): Query<RechercheQuery>,
) -> Result<Json<RechercheResponse>, ApiError> {
    let texte = requete_de_saisie(requete.q.as_deref().unwrap_or_default())
        .map_err(SaisieRefusee::erreur)?;
    if let Some(dossier) = requete.dossier.as_deref() {
        if dossier.is_empty() || dossier.chars().count() > DOSSIER_MAX {
            return Err(ApiError::bad_request("Dossier invalide"));
        }
    }
    let limite = requete.limite.unwrap_or(LIMITE_DEFAUT).clamp(1, LIMITE_MAX);
    let decalage = requete.decalage.unwrap_or(0).clamp(0, DECALAGE_MAX);
    if let Some(compte_id) = requete.compte_id {
        let lisible = sqlx::query_scalar::<_, Option<bool>>(
            "SELECT compte_mail_lisible_par(id, $3) FROM comptes_mail \
             WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(compte_id)
        .bind(claims.cabinet_id)
        .bind(claims.sub)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Lecture des droits de la boîte"))?;
        if lisible.flatten() != Some(true) {
            return Err(ApiError::not_found("Boîte introuvable"));
        }
    }

    // Les candidats (plein texte, boîtes lisibles) sont réduits à leur identifiant et leur date, et
    // triés une fois ; le droit de lire chaque message (dossier restreint) n'est vérifié que sur
    // les lignes qui sortent, dans l'ordre, jusqu'à la limite ; le texte n'est lu que pour la page.
    let mut lignes = sqlx::query_as::<_, LigneTrouvee>(
        r#"
        WITH comptes_lus AS (
            SELECT c.id
            FROM comptes_mail c
            WHERE c.cabinet_id = $1
              AND compte_mail_lisible_par(c.id, $2)
              AND ($3::uuid IS NULL OR c.id = $3)
        ),
        -- Deux sources, chacune sur son index : le vecteur complet des messages dont le corps est indexé
        -- (messages_corps_index), le vecteur d'en-tête (début du corps) des autres.
        candidats AS MATERIALIZED (
            SELECT * FROM (
                SELECT m.id, m.compte_id, m.dossier_id,
                       COALESCE(m.date_entete, m.cree_le) AS date_tri
                FROM messages_corps_index i
                INNER JOIN messages m ON m.id = i.message_ref
                WHERE i.cabinet_id = $1
                  AND i.compte_id IN (SELECT id FROM comptes_lus)
                  AND i.tsv @@ requete_recherche_messages($4)
                  AND ($5::text IS NULL OR m.dossier_imap = $5)
                UNION ALL
                SELECT m.id, m.compte_id, m.dossier_id,
                       COALESCE(m.date_entete, m.cree_le) AS date_tri
                FROM messages m
                WHERE m.cabinet_id = $1
                  AND m.compte_id IN (SELECT id FROM comptes_lus)
                  AND m.recherche_tsv @@ requete_recherche_messages($4)
                  AND ($5::text IS NULL OR m.dossier_imap = $5)
                  AND NOT EXISTS (SELECT 1 FROM messages_corps_index i WHERE i.message_ref = m.id)
            ) u
            ORDER BY date_tri DESC, id
        ),
        page AS (
            SELECT k.id, k.date_tri
            FROM candidats k
            WHERE message_lisible_par(k.compte_id, k.dossier_id, $2)
            ORDER BY k.date_tri DESC, k.id
            LIMIT $6 OFFSET $7
        )
        SELECT m.id, m.compte_id, m.dossier_id, m.dossier_imap, m.objet, m.expediteur,
               m.destinataires_texte AS destinataires, m.extrait_texte AS extrait,
               to_char(p.date_tri AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date,
               m.lu, m.etat_classement
        FROM page p
        INNER JOIN messages m ON m.id = p.id
        ORDER BY p.date_tri DESC, m.id
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(requete.compte_id)
    .bind(&texte)
    .bind(requete.dossier.as_deref())
    .bind(limite + 1)
    .bind(decalage)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Recherche dans les messages"))?;

    let a_suivre = i64::try_from(lignes.len()).is_ok_and(|n| n > limite);
    lignes.truncate(usize::try_from(limite).unwrap_or(0));
    Ok(Json(RechercheResponse {
        resultats: lignes
            .into_iter()
            .map(|ligne| MessageTrouve {
                id: ligne.id,
                compte_id: ligne.compte_id,
                dossier_id: ligne.dossier_id,
                dossier_imap: ligne.dossier_imap,
                objet: ligne.objet,
                expediteur: ligne.expediteur,
                destinataires: ligne.destinataires,
                extrait: ligne.extrait,
                date: ligne.date,
                lu: ligne.lu,
                etat_classement: ligne.etat_classement,
            })
            .collect(),
        a_suivre,
    }))
}

#[cfg(test)]
mod tests {
    use super::{requete_de_saisie, SaisieRefusee, SAISIE_MAX};

    fn ok(texte: &str) -> Result<String, SaisieRefusee> {
        Ok(texte.to_owned())
    }

    #[test]
    fn mots_requis_en_debut_de_mot() {
        assert_eq!(
            requete_de_saisie("Assignation Dupont"),
            ok("Assignation:* & Dupont:*")
        );
        // Adresse : coupée en mots, comme à l'indexation.
        assert_eq!(
            requete_de_saisie("jean.dupont@example.com"),
            ok("jean:* & dupont:* & example:* & com:*")
        );
        // Accents conservés (le repli est fait par la base, des deux côtés).
        assert_eq!(requete_de_saisie("Éric Müller"), ok("Éric:* & Müller:*"));
    }

    #[test]
    fn jokers_et_operateurs_ne_sont_que_des_separateurs() {
        assert_eq!(requete_de_saisie("%"), Err(SaisieRefusee::SansMot));
        assert_eq!(requete_de_saisie("_%_"), Err(SaisieRefusee::SansMot));
        assert_eq!(
            requete_de_saisie("a:* | !b ) ( & <->"),
            Err(SaisieRefusee::SansMot)
        );
        assert_eq!(
            requete_de_saisie("'; DROP TABLE messages; --"),
            ok("DROP:* & TABLE:* & messages:*")
        );
        assert_eq!(requete_de_saisie("50% dupont"), ok("50:* & dupont:*"));
        // Aucun caractère propre au langage des requêtes ne survit.
        let sortie =
            requete_de_saisie(r"dupont ab|cd&ef!gh(ij)kl:mn*op'qr\st<uv>wx").unwrap_or_default();
        assert!(sortie.contains("dupont:*"), "{sortie}");
        for interdit in ['|', '!', '(', ')', '\'', '\\', '<', '>'] {
            assert!(!sortie.contains(interdit), "{interdit}");
        }
        // Le seul « : », « * » et « & » sont ceux que la fonction ajoute.
        assert_eq!(sortie.matches(':').count(), sortie.matches(":*").count());
    }

    #[test]
    fn saisie_vide_trop_longue_ou_sans_mot_exploitable() {
        assert_eq!(requete_de_saisie(""), Err(SaisieRefusee::Vide));
        assert_eq!(requete_de_saisie("  \t\n "), Err(SaisieRefusee::Vide));
        assert_eq!(requete_de_saisie("a"), Err(SaisieRefusee::SansMot));
        assert_eq!(requete_de_saisie("a b c"), Err(SaisieRefusee::SansMot));
        assert_eq!(
            requete_de_saisie(&"x".repeat(SAISIE_MAX + 1)),
            Err(SaisieRefusee::TropLongue)
        );
        // À la limite exacte : acceptée, le mot est tronqué à 64 caractères.
        assert_eq!(
            requete_de_saisie(&"x".repeat(SAISIE_MAX)),
            Ok(format!("{}:*", "x".repeat(64)))
        );
    }

    #[test]
    fn mots_en_nombre_borne() {
        let saisie = (0..30)
            .map(|i| format!("mot{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let sortie = requete_de_saisie(&saisie).unwrap_or_default();
        assert_eq!(sortie.matches(":*").count(), 8);
    }
}
