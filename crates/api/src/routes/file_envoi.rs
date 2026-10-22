//! File d'envoi (§ 3.8.3 / étape 2). Message-ID unique, copie Envoyés confirmée.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use legalos_messagerie::{
    appliquer, champ_en_tete_valide, decider_action, envoyer_octets, nettoyer_html,
    texte_depuis_html, ActionEnvoi, EntreeFileEnvoi, EtatFileEnvoi, GenreRedaction, PieceJointe,
    SessionActions,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::jwt::AccessClaims;
use crate::error::ApiError;
use crate::identite_envoi::{identite_pour_utilisateur, IdentiteEnvoi};
use crate::routes::dossiers::dossier_visible;
use crate::routes::messagerie::assurer_compte_classement;
use crate::routes::redaction::{
    charger_message, genre_depuis_texte, genre_vers_texte, lire_origine, liste_depuis_texte,
    nouvel_identifiant, sortant_depuis_contenu, texte_depuis_liste, verifier_champs_en_tete,
    ContenuEnvoi, TAILLE_MAX_PIECES,
};
use crate::state::AppState;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreerEnvoiBody {
    pub id: Uuid,
    pub idempotence_cle: String,
    #[serde(default)]
    pub dossier_id: Option<Uuid>,
    /// Compte d'envoi (boîte nominative ou partagée) : le `From`, l'enveloppe, le relais SMTP et
    /// le dossier « Envoyés » sont les siens. Absent : la boîte de classement du cabinet. Refusé
    /// (404, comme une boîte absente) si l'utilisateur ne peut pas lire ce compte.
    #[serde(default)]
    pub compte_id: Option<Uuid>,
    /// Champ « à » historique (une adresse) ; repris avec `a`.
    #[serde(default)]
    pub destinataire: String,
    #[serde(default)]
    pub a: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub cci: Vec<String>,
    pub objet: String,
    /// Texte brut. Si absent, tiré du HTML.
    #[serde(default)]
    pub corps: String,
    /// HTML saisi, nettoyé avant stockage.
    #[serde(default)]
    pub corps_html: String,
    /// Si absent, généré une seule fois ici.
    pub message_id: Option<String>,
    /// `nouveau` (défaut), `reponse`, `reponse_a_tous` ou `transfert`.
    #[serde(default)]
    pub genre: Option<String>,
    /// Message d'origine d'une réponse ou d'un transfert (`messages.id`).
    #[serde(default)]
    pub origine_message_id: Option<Uuid>,
    #[serde(default)]
    pub en_reponse_a: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileEnvoiResponse {
    pub id: Uuid,
    pub dossier_id: Option<Uuid>,
    pub message_id: String,
    /// Adresses « à », séparées par une virgule.
    pub destinataire: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    pub objet: String,
    pub etat: String,
    pub tentatives: i32,
    pub genre: String,
    pub en_reponse_a: Option<String>,
    pub references: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct TraiterQuery {
    /// `smtp` : s'arrête après acceptation SMTP (simule coupure réseau).
    pub couper_apres: Option<String>,
}

/// id, dossier, Message-ID, « à », objet, état, tentatives, cc, cci, genre, In-Reply-To,
/// References.
type LigneEnvoi = (
    Uuid,
    Option<Uuid>,
    String,
    String,
    String,
    String,
    i32,
    String,
    String,
    String,
    Option<String>,
    String,
);

fn repond(genre: GenreRedaction) -> bool {
    matches!(
        genre,
        GenreRedaction::Reponse | GenreRedaction::ReponseATous
    )
}

#[utoipa::path(
    post,
    path = "/messagerie/file-envoi",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = CreerEnvoiBody,
    responses(
        (status = 200, description = "Envoi inscrit dans la file à l'état brouillon (ou ligne existante rendue si l'appel est rejoué)", body = FileEnvoiResponse),
        (status = 400, description = "Message invalide : genre, destinataires, en-têtes, message d'origine, pièces ou SMTP non configuré", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier, compte ou message d'origine introuvable, ou illisible pour l'utilisateur", body = crate::error::ApiErrorBody),
        (status = 409, description = "Identifiant de message déjà utilisé, ou jeton refusé par le fournisseur OAuth de la boîte", body = crate::error::ApiErrorBody),
        (status = 502, description = "Fournisseur de messagerie injoignable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerEnvoiBody>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let genre = match body.genre.as_deref() {
        None => GenreRedaction::Nouveau,
        Some(texte) => genre_depuis_texte(texte)
            .ok_or_else(|| ApiError::bad_request("Genre de message inconnu"))?,
    };
    let mut a = body.a.clone();
    if !body.destinataire.trim().is_empty() {
        a.push(body.destinataire.clone());
    }
    // En-têtes non injectables : refus avant tout effet (essai négatif du critère d).
    verifier_champs_en_tete(
        &body.objet,
        &[a.as_slice(), body.cc.as_slice(), body.cci.as_slice()],
    )?;
    let identifiants_fournis: Vec<&String> = body
        .en_reponse_a
        .iter()
        .chain(body.references.iter())
        .chain(body.message_id.iter())
        .collect();
    if identifiants_fournis
        .iter()
        .any(|id| !champ_en_tete_valide(id))
    {
        return Err(ApiError::bad_request(
            "Retour à la ligne interdit dans un identifiant de message",
        ));
    }
    if [&a, &body.cc, &body.cci]
        .iter()
        .all(|liste| liste.iter().all(|adresse| adresse.trim().is_empty()))
    {
        return Err(ApiError::bad_request("Aucun destinataire"));
    }
    if (repond(genre) || genre == GenreRedaction::Transfert) && body.origine_message_id.is_none() {
        return Err(ApiError::bad_request("Message d'origine requis"));
    }
    if let Some(dossier_id) = body.dossier_id {
        if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
            return Err(ApiError::not_found("Dossier introuvable"));
        }
    }
    let compte_id = match body.compte_id {
        Some(compte_id) => compte_id,
        None => {
            let parametres = state
                .messagerie
                .as_ref()
                .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
            assurer_compte_classement(&state.pool, claims.cabinet_id, parametres).await?
        }
    };
    // Droit d'écrire depuis ce compte : vérifié avant tout effet (403 sinon).
    let identite = identite_pour_utilisateur(&state, &claims, compte_id).await?;
    let message_id = body
        .message_id
        .clone()
        .unwrap_or_else(|| nouvel_identifiant(&identite.de));
    let message_id = if message_id.starts_with('<') {
        message_id
    } else {
        format!("<{message_id}>")
    };

    // Rejeu : la ligne existante de l'auteur, sans rien recréer.
    let existant = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM file_envoi
        WHERE compte_id = $1 AND message_id = $2 AND (auteur_id IS NULL OR auteur_id = $3)
        "#,
    )
    .bind(compte_id)
    .bind(&message_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture file envoi"))?;
    if let Some(existant) = existant {
        return charger_reponse(&state, &claims, existant).await;
    }

    // Origine : droits vérifiés (boîte nominative du titulaire, dossier visible). Au transfert,
    // les pièces sont copiées dans la file ; l'envoi ne dépend plus du serveur IMAP d'origine.
    let mut en_reponse_a = body.en_reponse_a.clone().filter(|id| !id.trim().is_empty());
    let mut pieces: Vec<PieceJointe> = Vec::new();
    if let Some(origine_uuid) = body.origine_message_id {
        let ligne = charger_message(&state, &claims, origine_uuid).await?;
        if repond(genre) && en_reponse_a.is_none() {
            en_reponse_a = Some(ligne.message_id.clone());
        }
        if genre == GenreRedaction::Transfert {
            let origine = lire_origine(&state, &ligne, true).await?;
            pieces = origine.pieces;
        }
    }
    if repond(genre) && en_reponse_a.is_none() {
        return Err(ApiError::bad_request("Réponse sans message d'origine"));
    }
    if pieces.iter().map(|p| p.contenu.len()).sum::<usize>() > TAILLE_MAX_PIECES {
        return Err(ApiError::bad_request("Pièces jointes trop volumineuses"));
    }

    let corps_html = nettoyer_html(&body.corps_html);
    let corps = if body.corps.trim().is_empty() && !corps_html.trim().is_empty() {
        texte_depuis_html(&corps_html).trim().to_owned()
    } else {
        body.corps.clone()
    };
    let contenu = ContenuEnvoi {
        message_id: message_id.clone(),
        a: a.clone(),
        cc: body.cc.clone(),
        cci: body.cci.clone(),
        objet: body.objet.clone(),
        corps: corps.clone(),
        corps_html: corps_html.clone(),
        en_reponse_a: en_reponse_a.clone(),
        references: body.references.clone(),
        pieces,
        repondre_a: identite.repondre_a.clone(),
    };
    // Construction à blanc : adresses, en-têtes et fil validés à la création, jamais à l'envoi.
    sortant_depuis_contenu(&identite.de, &contenu).map_err(|_| {
        ApiError::bad_request("Message invalide : destinataires, adresses ou en-têtes")
    })?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Création file envoi"))?;
    let insertion = sqlx::query(
        r#"
        INSERT INTO file_envoi (
            id, cabinet_id, compte_id, dossier_id, message_id,
            destinataire, cc, cci, objet, corps, corps_html,
            genre, origine_message_id, en_reponse_a, references_texte,
            auteur_id, etat, tentatives
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'brouillon',0)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(compte_id)
    .bind(body.dossier_id)
    .bind(&message_id)
    .bind(texte_depuis_liste(&a))
    .bind(texte_depuis_liste(&body.cc))
    .bind(texte_depuis_liste(&body.cci))
    .bind(&body.objet)
    .bind(&corps)
    .bind(&corps_html)
    .bind(genre_vers_texte(genre))
    .bind(body.origine_message_id)
    .bind(&en_reponse_a)
    .bind(texte_depuis_liste(&body.references))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await;
    if let Err(err) = insertion {
        return Err(
            if matches!(&err, sqlx::Error::Database(e) if e.code().as_deref() == Some("23505")) {
                ApiError::conflict("Identifiant de message déjà utilisé")
            } else {
                ApiError::internal("Création file envoi")
            },
        );
    }
    for (ordre, piece) in contenu.pieces.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO file_envoi_pieces (id, envoi_id, ordre, nom, type_mime, contenu)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(body.id)
        .bind(i32::try_from(ordre).unwrap_or(i32::MAX))
        .bind(&piece.nom)
        .bind(&piece.type_mime)
        .bind(&piece.contenu)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Enregistrement des pièces"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Création file envoi"))?;

    charger_reponse(&state, &claims, body.id).await
}

#[utoipa::path(
    post,
    path = "/messagerie/file-envoi/{id}/mettre-en-attente",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Brouillon passé en attente d'envoi", body = FileEnvoiResponse),
        (status = 400, description = "Seul un brouillon passe en attente", body = crate::error::ApiErrorBody),
        (status = 404, description = "Envoi introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn mettre_en_attente(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let mut entree = charger_entree(&state, &claims, id).await?;
    if entree.etat != EtatFileEnvoi::Brouillon {
        return Err(ApiError::bad_request("Seul un brouillon passe en attente"));
    }
    appliquer(&mut entree, ActionEnvoi::MettreEnAttente, true);
    sauver_entree(&state, id, &entree).await?;
    charger_reponse(&state, &claims, id).await
}

#[utoipa::path(
    post,
    path = "/messagerie/file-envoi/{id}/annuler",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Envoi en attente rendu à l'état de brouillon", body = FileEnvoiResponse),
        (status = 400, description = "Seul un envoi en attente est annulable", body = crate::error::ApiErrorBody),
        (status = 404, description = "Envoi introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn annuler_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let entree = charger_entree(&state, &claims, id).await?;
    if entree.etat != EtatFileEnvoi::EnAttente {
        return Err(ApiError::bad_request(
            "Seul un envoi en attente est annulable",
        ));
    }
    sqlx::query(
        r#"
        UPDATE file_envoi SET etat = 'brouillon', revision = revision + 1
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Annulation envoi"))?;
    charger_reponse(&state, &claims, id).await
}

#[utoipa::path(
    post,
    path = "/messagerie/file-envoi/{id}/traiter",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(
        ("couper_apres" = Option<String>, Query, description = "Essai de coupure : `smtp` s'arrête après acceptation SMTP, `echec` force un échec d'envoi"),
    ),
    responses(
        (status = 200, description = "État de l'envoi après avancement dans la file (jusqu'à la copie dans Envoyés confirmée, ou jusqu'au premier échec)", body = FileEnvoiResponse),
        (status = 400, description = "SMTP de messagerie non configuré", body = crate::error::ApiErrorBody),
        (status = 404, description = "Envoi ou compte d'envoi introuvable", body = crate::error::ApiErrorBody),
        (status = 409, description = "Jeton refusé par le fournisseur OAuth de la boîte", body = crate::error::ApiErrorBody),
        (status = 500, description = "Connexion, authentification ou protocole refusés par le serveur de messagerie", body = crate::error::ApiErrorBody),
        (status = 502, description = "Fournisseur de messagerie injoignable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn traiter_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
    Query(query): Query<TraiterQuery>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let (couper_smtp, forcer_echec) = match query.couper_apres.as_deref() {
        Some(v) if v.eq_ignore_ascii_case("smtp") => (true, false),
        Some(v) if v.eq_ignore_ascii_case("echec") => (false, true),
        _ => (false, false),
    };
    traiter(&state, &claims, id, couper_smtp, forcer_echec).await
}

/// Fait avancer un envoi de la file jusqu'à « copie dans Envoyés confirmée » (ou jusqu'au premier
/// échec). Reprenable à tout moment : « Envoyés » est consulté avant chaque nouvelle tentative.
///
/// L'envoi part du compte de la ligne (`file_envoi.compte_id`) : son `From`, son relais SMTP, son
/// `Reply-To` éventuel et son dossier « Envoyés ». Le droit d'écrire depuis ce compte est revérifié
/// à chaque passage : un collaborateur retiré d'une boîte partagée ne peut plus reprendre un envoi
/// (la ligne reste dans la file).
pub(crate) async fn traiter(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
    couper_smtp: bool,
    forcer_echec: bool,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let compte_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT compte_id FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2 AND (auteur_id IS NULL OR auteur_id = $3)
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    let identite = identite_pour_utilisateur(state, claims, compte_id).await?;

    loop {
        let mut entree = charger_entree(state, claims, id).await?;
        if entree.etat == EtatFileEnvoi::CopieEnvoyesConfirmee {
            break;
        }
        let mut session = SessionActions::connecter(&identite.imap).map_err(map_err_mail)?;
        let dossier_envoyes = session.dossier_envoyes().map_err(map_err_mail)?;
        let deja = session
            .message_id_present(&dossier_envoyes, &entree.message_id)
            .map_err(map_err_mail)?;
        let action = decider_action(&entree, deja);
        match action {
            ActionEnvoi::Rien => break,
            ActionEnvoi::ConfirmerCopie => {
                appliquer(&mut entree, action, true);
                sauver_entree(state, id, &entree).await?;
                classer_copie(state, claims.cabinet_id, id, &entree, &identite.de).await?;
                break;
            }
            ActionEnvoi::MettreEnAttente => {
                appliquer(&mut entree, action, true);
                sauver_entree(state, id, &entree).await?;
            }
            ActionEnvoi::EnvoyerSmtp | ActionEnvoi::Retenter => {
                // Transport sans Bcc ; les destinataires en copie cachée sont dans l'enveloppe.
                let ok = if forcer_echec {
                    false
                } else {
                    match preparer_sortant(state, claims, id, &identite).await? {
                        Some(sortant) => {
                            let smtp = identite.smtp.clone();
                            tokio::task::spawn_blocking(move || {
                                envoyer_octets(
                                    &smtp,
                                    &sortant.expediteur,
                                    &sortant.destinataires,
                                    &sortant.transport,
                                )
                                .is_ok()
                            })
                            .await
                            .unwrap_or(false)
                        }
                        None => false,
                    }
                };
                appliquer(&mut entree, action, ok);
                sauver_entree(state, id, &entree).await?;
                if !ok || couper_smtp {
                    break;
                }
            }
            ActionEnvoi::CopierDansEnvoyes => {
                // La copie « Envoyés » garde le Bcc ; elle va dans les envoyés du compte d'envoi.
                let ok = match preparer_sortant(state, claims, id, &identite).await? {
                    Some(sortant) => session.appender(&dossier_envoyes, &sortant.copie).is_ok(),
                    None => false,
                };
                appliquer(&mut entree, action, ok);
                sauver_entree(state, id, &entree).await?;
                if ok {
                    classer_copie(state, claims.cabinet_id, id, &entree, &identite.de).await?;
                }
                break;
            }
        }
    }
    charger_reponse(state, claims, id).await
}

#[utoipa::path(
    get,
    path = "/messagerie/file-envoi",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Envois et brouillons de l'utilisateur, les plus anciens d'abord", body = Vec<FileEnvoiResponse>),
    )
)]
pub async fn lister_file_envoi(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<FileEnvoiResponse>>, ApiError> {
    // Chaque collaborateur ne voit que ses propres envois et brouillons ; les lignes
    // antérieures à la migration 038 n'ont pas d'auteur et restent visibles du cabinet.
    let rows = sqlx::query_as::<_, LigneEnvoi>(
        r#"
        SELECT id, dossier_id, message_id, destinataire, objet, etat, tentatives,
               cc, cci, genre, en_reponse_a, references_texte
        FROM file_envoi
        WHERE cabinet_id = $1 AND (auteur_id IS NULL OR auteur_id = $2)
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture file envoi"))?;
    Ok(Json(rows.into_iter().map(vers_reponse).collect()))
}

fn map_err_mail(e: legalos_messagerie::ErreurMail) -> ApiError {
    match e {
        legalos_messagerie::ErreurMail::Authentification => {
            ApiError::internal("Authentification messagerie refusée")
        }
        legalos_messagerie::ErreurMail::Connexion => {
            ApiError::internal("Connexion messagerie impossible")
        }
        legalos_messagerie::ErreurMail::Protocole => {
            ApiError::internal("Protocole messagerie refusé")
        }
    }
}

fn vers_reponse(row: LigneEnvoi) -> FileEnvoiResponse {
    let a = liste_depuis_texte(&row.3);
    FileEnvoiResponse {
        id: row.0,
        dossier_id: row.1,
        message_id: row.2,
        destinataire: a.join(", "),
        a,
        cc: liste_depuis_texte(&row.7),
        cci: liste_depuis_texte(&row.8),
        objet: row.4,
        etat: row.5,
        tentatives: row.6,
        genre: row.9,
        en_reponse_a: row.10,
        references: liste_depuis_texte(&row.11),
    }
}

pub(crate) async fn charger_reponse(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    let row = sqlx::query_as::<_, LigneEnvoi>(
        r#"
        SELECT id, dossier_id, message_id, destinataire, objet, etat, tentatives,
               cc, cci, genre, en_reponse_a, references_texte
        FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2 AND (auteur_id IS NULL OR auteur_id = $3)
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    Ok(Json(vers_reponse(row)))
}

async fn charger_entree(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
) -> Result<EntreeFileEnvoi, ApiError> {
    let row = sqlx::query_as::<_, (String, String, i32)>(
        r#"
        SELECT message_id, etat, tentatives FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2 AND (auteur_id IS NULL OR auteur_id = $3)
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    let etat = EtatFileEnvoi::parse(&row.1)
        .ok_or_else(|| ApiError::internal("État file envoi inconnu"))?;
    Ok(EntreeFileEnvoi {
        message_id: row.0,
        etat,
        tentatives: u32::try_from(row.2).unwrap_or(0),
    })
}

/// Contenu stocké d'un envoi, pièces comprises.
async fn charger_contenu(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
) -> Result<ContenuEnvoi, ApiError> {
    let row = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
        ),
    >(
        r#"
        SELECT message_id, destinataire, cc, cci, objet, corps, corps_html,
               en_reponse_a, references_texte
        FROM file_envoi
        WHERE id = $1 AND cabinet_id = $2 AND (auteur_id IS NULL OR auteur_id = $3)
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture corps envoi"))?
    .ok_or_else(|| ApiError::not_found("Envoi introuvable"))?;
    let pieces = sqlx::query_as::<_, (String, String, Vec<u8>)>(
        "SELECT nom, type_mime, contenu FROM file_envoi_pieces WHERE envoi_id = $1 ORDER BY ordre",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture pièces envoi"))?
    .into_iter()
    .map(|(nom, type_mime, contenu)| PieceJointe {
        nom,
        type_mime,
        contenu,
    })
    .collect();
    Ok(ContenuEnvoi {
        message_id: row.0,
        a: liste_depuis_texte(&row.1),
        cc: liste_depuis_texte(&row.2),
        cci: liste_depuis_texte(&row.3),
        objet: row.4,
        corps: row.5,
        corps_html: row.6,
        en_reponse_a: row.7,
        references: liste_depuis_texte(&row.8),
        pieces,
        repondre_a: None,
    })
}

/// Message prêt à partir (copie avec Bcc, transport sans Bcc, enveloppe). `None` si le contenu
/// stocké ne se construit plus : l'envoi passe alors en échec, sans rien partir. Le `From` et le
/// `Reply-To` sont ceux du compte d'envoi, relus à chaque passage.
async fn preparer_sortant(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
    identite: &IdentiteEnvoi,
) -> Result<Option<legalos_messagerie::MessageSortant>, ApiError> {
    let mut contenu = charger_contenu(state, claims, id).await?;
    contenu.repondre_a = identite.repondre_a.clone();
    match sortant_depuis_contenu(&identite.de, &contenu) {
        Ok(sortant) => Ok(Some(sortant)),
        Err(_) => {
            tracing::warn!(envoi = %id, "construction du message impossible");
            Ok(None)
        }
    }
}

async fn sauver_entree(
    state: &AppState,
    id: Uuid,
    entree: &EntreeFileEnvoi,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        UPDATE file_envoi
        SET etat = $2, tentatives = $3, revision = revision + 1
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(entree.etat.as_str())
    .bind(i32::try_from(entree.tentatives).unwrap_or(0))
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Écriture file envoi"))?;
    Ok(())
}

async fn classer_copie(
    state: &AppState,
    cabinet_id: Uuid,
    envoi_id: Uuid,
    entree: &EntreeFileEnvoi,
    expediteur: &str,
) -> Result<(), ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Uuid)>(
        r#"
        SELECT f.compte_id, f.dossier_id, f.objet, f.cabinet_id
        FROM file_envoi f WHERE f.id = $1 AND f.cabinet_id = $2
        "#,
    )
    .bind(envoi_id)
    .bind(cabinet_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture copie classée"))?;
    let Some(dossier_id) = row.1 else {
        return Ok(());
    };
    let uid_synthetique = {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in entree.message_id.as_bytes() {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x100000001b3);
        }
        u32::try_from(h & 0xffff_ffff).unwrap_or(1).max(1)
    };
    sqlx::query(
        r#"
        INSERT INTO messages (
            id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
            objet, expediteur, etat_classement, suggestion_dossier_id
        ) VALUES (
            $1, $2, $3, $4, $5, 0, $6, $7, $8, 'classe', NULL
        )
        ON CONFLICT (compte_id, message_id) DO NOTHING
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(row.3)
    .bind(row.0)
    .bind(dossier_id)
    .bind(&entree.message_id)
    .bind(i64::from(uid_synthetique))
    .bind(&row.2)
    .bind(expediteur)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Insertion copie classée"))?;
    Ok(())
}
