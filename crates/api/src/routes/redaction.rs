//! Rédaction (J11, étape 1a) : composition d'une réponse, d'une réponse à tous, d'un transfert
//! ou d'un message neuf ; signature par compte ; modèles de message du cabinet.
//!
//! Le MIME reste `mail-parser` (lecture) et `lettre` (construction), dans `legalos-messagerie`.
//! Aucun contenu de mail, objet ni adresse dans les journaux : identifiants techniques seulement.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use legalos_messagerie::{
    analyser_composition, champ_en_tete_valide, construire_message, construire_message_brouillon,
    construire_message_sortant, nettoyer_html, origine_depuis_octets, texte_depuis_html,
    DemandeRedaction, FilMessage, GenreRedaction, MessageComposition, MessageOrigine,
    MessageSortant, ParametresCompte, PieceJointe, SessionActions,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::jwt::AccessClaims;
use crate::error::ApiError;
use crate::identite_envoi::expediteur_pour_utilisateur;
use crate::routes::dossiers::dossier_visible;
use crate::routes::messagerie::assurer_compte_classement;
use crate::state::AppState;

/// Taille cumulée maximale des pièces d'un envoi, annoncée à l'écran de rédaction.
pub const TAILLE_MAX_PIECES: usize = 25 * 1024 * 1024;
const NOM_MAX: usize = 120;
pub(crate) const OBJET_MAX: usize = 300;
pub(crate) const HTML_MAX: usize = 200_000;
/// Destinataire provisoire d'un message de départ sans destinataire (message neuf, transfert) :
/// la construction exige un destinataire, la réponse n'en garde pas.
const DESTINATAIRE_PROVISOIRE: &str = "a-saisir@invalid.example";
const SIGNATURE_MAX: usize = 20_000;

// ---------------------------------------------------------------------------------------------
// Fonctions pures (testées sans service)
// ---------------------------------------------------------------------------------------------

/// Genre de rédaction depuis le texte de l'API. `None` si inconnu.
pub fn genre_depuis_texte(texte: &str) -> Option<GenreRedaction> {
    match texte {
        "nouveau" => Some(GenreRedaction::Nouveau),
        "reponse" => Some(GenreRedaction::Reponse),
        "reponse_a_tous" => Some(GenreRedaction::ReponseATous),
        "transfert" => Some(GenreRedaction::Transfert),
        _ => None,
    }
}

pub fn genre_vers_texte(genre: GenreRedaction) -> &'static str {
    match genre {
        GenreRedaction::Nouveau => "nouveau",
        GenreRedaction::Reponse => "reponse",
        GenreRedaction::ReponseATous => "reponse_a_tous",
        GenreRedaction::Transfert => "transfert",
    }
}

/// Refuse tout retour à la ligne ou caractère de contrôle dans l'objet et les adresses
/// (injection d'en-tête, par exemple un `Bcc:` glissé dans l'objet).
pub fn verifier_champs_en_tete(objet: &str, listes: &[&[String]]) -> Result<(), ApiError> {
    if !champ_en_tete_valide(objet) {
        return Err(ApiError::bad_request(
            "Retour à la ligne interdit dans l'objet",
        ));
    }
    let toutes_valides = listes
        .iter()
        .flat_map(|liste| liste.iter())
        .all(|adresse| champ_en_tete_valide(adresse));
    if !toutes_valides {
        return Err(ApiError::bad_request(
            "Retour à la ligne interdit dans une adresse",
        ));
    }
    Ok(())
}

/// Liste d'adresses depuis la colonne texte (une adresse par ligne).
pub fn liste_depuis_texte(texte: &str) -> Vec<String> {
    texte
        .split('\n')
        .map(str::trim)
        .filter(|ligne| !ligne.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Colonne texte depuis une liste d'adresses (une par ligne, vides retirées). Une adresse
/// validée ne contient jamais de retour à la ligne.
pub fn texte_depuis_liste(liste: &[String]) -> String {
    liste
        .iter()
        .map(|a| a.trim())
        .filter(|a| !a.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Identifiant de message neuf, propre au domaine de l'expéditeur. Appelé une seule fois par
/// message : l'identifiant figé n'est plus jamais régénéré.
pub fn nouvel_identifiant(expediteur: &str) -> String {
    let domaine: String = expediteur
        .rsplit_once('@')
        .map(|(_, d)| d)
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
        .collect();
    let domaine = if domaine.is_empty() {
        "cabinet.example"
    } else {
        domaine.as_str()
    };
    format!("<envoi-{}@{}>", Uuid::now_v7(), domaine)
}

/// Champ reçu d'un tiers (objet, expéditeur) : les caractères de contrôle deviennent des
/// espaces pour que la réponse reste constructible. Ce qui vient de l'utilisateur est refusé,
/// jamais nettoyé en silence.
fn assainir_champ_recu(valeur: &str) -> String {
    valeur
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_owned()
}

fn assainir_origine(origine: &mut MessageOrigine) {
    origine.objet = assainir_champ_recu(&origine.objet);
    origine.expediteur = assainir_champ_recu(&origine.expediteur);
    origine.a = origine.a.iter().map(|a| assainir_champ_recu(a)).collect();
    origine.cc = origine.cc.iter().map(|a| assainir_champ_recu(a)).collect();
}

/// Contenu d'un envoi en file, tel que stocké.
#[derive(Debug, Clone)]
pub struct ContenuEnvoi {
    pub message_id: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    pub objet: String,
    pub corps: String,
    pub corps_html: String,
    pub en_reponse_a: Option<String>,
    pub references: Vec<String>,
    pub pieces: Vec<PieceJointe>,
    /// `Reply-To` du compte d'envoi, s'il en définit un ; `None` sinon (aucun en-tête).
    pub repondre_a: Option<String>,
}

/// Construit le message d'un envoi : copie avec `Bcc` (dossier « Envoyés »), transport sans
/// `Bcc`, enveloppe avec les destinataires en copie cachée. Le `Message-ID` est celui figé à la
/// création ; In-Reply-To et References viennent du fil enregistré.
pub fn sortant_depuis_contenu(
    expediteur: &str,
    contenu: &ContenuEnvoi,
) -> Result<MessageSortant, legalos_messagerie::ErreurMail> {
    let (demande, fil) = demande_depuis_contenu(expediteur, contenu);
    construire_message_sortant(&demande, fil.as_ref())
}

/// Copie d'un brouillon pour le dossier Brouillons du serveur : la même demande que l'envoi,
/// avec `Bcc` et pièces, tolérante aux destinataires absents ou incomplets.
pub fn octets_brouillon(
    expediteur: &str,
    contenu: &ContenuEnvoi,
) -> Result<Vec<u8>, legalos_messagerie::ErreurMail> {
    let (demande, fil) = demande_depuis_contenu(expediteur, contenu);
    construire_message_brouillon(&demande, fil.as_ref())
}

fn demande_depuis_contenu(
    expediteur: &str,
    contenu: &ContenuEnvoi,
) -> (DemandeRedaction, Option<FilMessage>) {
    let demande = DemandeRedaction {
        de: expediteur.to_owned(),
        adresse_compte: expediteur.to_owned(),
        a: contenu.a.clone(),
        cc: contenu.cc.clone(),
        cci: contenu.cci.clone(),
        objet: contenu.objet.clone(),
        corps: contenu.corps.clone(),
        html: contenu.corps_html.clone(),
        signature: String::new(),
        signature_html: String::new(),
        repondre_a: contenu.repondre_a.clone().unwrap_or_default(),
        identifiant: contenu.message_id.clone(),
        origine: None,
        pieces: contenu.pieces.clone(),
    };
    let fil = contenu
        .en_reponse_a
        .as_ref()
        .filter(|id| !id.trim().is_empty())
        .map(|id| FilMessage {
            en_reponse_a: id.clone(),
            references: contenu.references.clone(),
        });
    (demande, fil)
}

/// Message de départ d'une rédaction : le même assemblage que l'envoi (lettre, MIME), relu pour
/// l'éditeur. Sans destinataire (message neuf, transfert), un destinataire provisoire permet la
/// construction et n'apparaît pas dans le résultat.
pub fn composer_depart(
    genre: GenreRedaction,
    mut demande: DemandeRedaction,
) -> Result<MessageComposition, legalos_messagerie::ErreurMail> {
    let sans_destinataire = demande.a.is_empty()
        && demande.cc.is_empty()
        && demande.cci.is_empty()
        && matches!(genre, GenreRedaction::Nouveau | GenreRedaction::Transfert);
    if sans_destinataire {
        demande.a = vec![DESTINATAIRE_PROVISOIRE.to_owned()];
    }
    let octets = construire_message(genre, &demande)?;
    let mut compose = analyser_composition(&octets)?;
    compose
        .a
        .retain(|adresse| !adresse.contains(DESTINATAIRE_PROVISOIRE));
    Ok(compose)
}

pub(crate) fn est_doublon(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(e) if e.code().as_deref() == Some("23505"))
}

// ---------------------------------------------------------------------------------------------
// Droits et accès aux comptes
// ---------------------------------------------------------------------------------------------

/// Compte du cabinet que l'utilisateur a le droit d'utiliser : la boîte nominative d'un autre
/// collaborateur, ou une boîte partagée dont il n'est pas membre, est introuvable (404), pas
/// interdite, pour ne rien révéler.
pub(crate) async fn compte_accessible(
    state: &AppState,
    claims: &AccessClaims,
    compte_id: Uuid,
) -> Result<(String, String), ApiError> {
    let ligne = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT type_compte, adresse FROM comptes_mail
        WHERE id = $1 AND cabinet_id = $2 AND compte_mail_lisible_par(id, $3)
        "#,
    )
    .bind(compte_id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture compte"))?
    .ok_or_else(|| ApiError::not_found("Compte introuvable"))?;
    Ok((ligne.0, ligne.1))
}

/// Paramètres IMAP d'un compte : ses propres identifiants (compte nominatif) ou la boîte de
/// classement de l'instance. Un compte sans secret lisible ici (OAuth) est refusé.
async fn parametres_imap(
    state: &AppState,
    compte_id: Uuid,
    type_compte: &str,
) -> Result<ParametresCompte, ApiError> {
    parametres_imap_depuis(
        &state.pool,
        &state.totp_cipher_key,
        state.messagerie.as_ref(),
        compte_id,
        type_compte,
    )
    .await
}

/// Comme [`parametres_imap`], sans l'état de l'API : le moteur de fond (reprise des copies de
/// brouillons) n'a que la base, la clé de chiffrement et la boîte de classement.
pub(crate) async fn parametres_imap_depuis(
    pool: &sqlx::PgPool,
    cle: &[u8; 32],
    classement: Option<&ParametresCompte>,
    compte_id: Uuid,
    type_compte: &str,
) -> Result<ParametresCompte, ApiError> {
    let ligne = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<i32>,
            Option<String>,
            bool,
            Option<String>,
        ),
    >(
        "SELECT hote, port, utilisateur, tls, secret_chiffre FROM comptes_mail WHERE id = $1",
    )
    .bind(compte_id)
    .fetch_one(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture compte"))?;
    if let (Some(hote), Some(port), Some(utilisateur), Some(secret)) =
        (ligne.0, ligne.1, ligne.2, ligne.4)
    {
        let clair = crate::auth::totp::dechiffrer_secret_totp(&secret, cle)
            .map_err(|_| ApiError::internal("Déchiffrement"))?;
        let mot_de_passe =
            String::from_utf8(clair).map_err(|_| ApiError::internal("Déchiffrement"))?;
        return Ok(ParametresCompte {
            hote,
            port: u16::try_from(port).map_err(|_| ApiError::bad_request("Port IMAP invalide"))?,
            utilisateur,
            mot_de_passe,
            tls: ligne.3,
        });
    }
    if type_compte == "classement" {
        return classement
            .cloned()
            .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"));
    }
    Err(ApiError::bad_request(
        "Compte non lisible depuis le serveur à cette étape",
    ))
}

/// Message d'origine d'une réponse ou d'un transfert, avec ses droits.
pub(crate) struct LigneMessage {
    pub compte_id: Uuid,
    pub type_compte: String,
    pub uid: i64,
    pub dossier_imap: String,
    pub message_id: String,
}

/// Charge la ligne du message si l'utilisateur peut le lire : boîte nominative du seul
/// titulaire, boîte partagée de ses seuls membres, dossier restreint réservé à ses accès. Sinon
/// 404.
pub(crate) async fn charger_message(
    state: &AppState,
    claims: &AccessClaims,
    message_uuid: Uuid,
) -> Result<LigneMessage, ApiError> {
    let ligne = sqlx::query_as::<
        _,
        (
            Uuid,
            Option<bool>,
            Option<Uuid>,
            i64,
            String,
            String,
            String,
        ),
    >(
        r#"
        SELECT m.compte_id, compte_mail_lisible_par(m.compte_id, $3), m.dossier_id, m.uid,
               m.dossier_imap, m.message_id, c.type_compte
        FROM messages m
        INNER JOIN comptes_mail c ON c.id = m.compte_id
        WHERE m.id = $1 AND m.cabinet_id = $2
        "#,
    )
    .bind(message_uuid)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture message"))?
    .ok_or_else(|| ApiError::not_found("Message introuvable"))?;
    if ligne.1 != Some(true) {
        return Err(ApiError::not_found("Message introuvable"));
    }
    if let Some(dossier_id) = ligne.2 {
        if !dossier_visible(state, claims.cabinet_id, claims.sub, dossier_id).await? {
            return Err(ApiError::not_found("Message introuvable"));
        }
    }
    Ok(LigneMessage {
        compte_id: ligne.0,
        type_compte: ligne.6,
        uid: ligne.3,
        dossier_imap: ligne.4,
        message_id: ligne.5,
    })
}

/// Lit le message d'origine sur le serveur IMAP. Les pièces ne sont reprises qu'au transfert.
pub(crate) async fn lire_origine(
    state: &AppState,
    ligne: &LigneMessage,
    avec_pieces: bool,
) -> Result<MessageOrigine, ApiError> {
    let parametres = parametres_imap(state, ligne.compte_id, &ligne.type_compte).await?;
    let uid = u32::try_from(ligne.uid)
        .ok()
        .filter(|uid| *uid > 0)
        .ok_or_else(|| ApiError::bad_request("UID invalide"))?;
    let dossier = if ligne.dossier_imap.is_empty() {
        "INBOX".to_owned()
    } else {
        ligne.dossier_imap.clone()
    };
    let octets = tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        session.lire_rfc822(&dossier, uid)
    })
    .await
    .map_err(|_| ApiError::internal("Lecture interrompue"))?
    .map_err(|_| {
        ApiError::with_code(
            StatusCode::BAD_GATEWAY,
            "messagerie_indisponible",
            "Lecture du message d'origine impossible",
        )
    })?;
    let mut origine = origine_depuis_octets(&octets, avec_pieces)
        .map_err(|_| ApiError::internal("Message d'origine illisible"))?;
    if origine.identifiant.is_empty() {
        origine.identifiant = ligne.message_id.clone();
    }
    assainir_origine(&mut origine);
    Ok(origine)
}

// ---------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct CompositionRequest {
    /// `nouveau`, `reponse`, `reponse_a_tous` ou `transfert`.
    pub genre: String,
    /// Message d'origine (obligatoire hors `nouveau`).
    pub message_id: Option<Uuid>,
    /// Compte de rédaction d'un message neuf ; par défaut la boîte de classement.
    pub compte_id: Option<Uuid>,
    #[serde(default)]
    pub a: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub cci: Vec<String>,
    pub objet: Option<String>,
    /// Modèle de message dont l'objet et le corps de départ sont repris.
    pub modele_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PieceResume {
    pub nom: String,
    pub type_mime: String,
    pub taille: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CompositionResponse {
    pub genre: String,
    /// Identifiant du message, généré ici une seule fois ; l'envoi le reprend tel quel.
    pub message_id: String,
    pub compte_id: Uuid,
    pub de: String,
    pub objet: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    pub texte: String,
    /// HTML nettoyé : saisie de départ, signature, historique cité.
    pub html: String,
    pub en_reponse_a: Option<String>,
    pub references: Vec<String>,
    pub pieces: Vec<PieceResume>,
    pub origine_message_id: Option<Uuid>,
    pub signature_inseree: bool,
    pub taille_max_pieces: usize,
}

#[utoipa::path(
    post,
    path = "/messagerie/composition",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = CompositionRequest,
    responses(
        (status = 200, description = "Message de départ composé", body = CompositionResponse),
        (status = 400, description = "Requête ou en-tête invalide", body = crate::error::ApiErrorBody),
        (status = 404, description = "Message ou compte introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn composer(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CompositionRequest>,
) -> Result<Json<CompositionResponse>, ApiError> {
    let genre = genre_depuis_texte(&body.genre)
        .ok_or_else(|| ApiError::bad_request("Genre de message inconnu"))?;
    let objet_demande = body.objet.clone().unwrap_or_default();
    verifier_champs_en_tete(
        &objet_demande,
        &[body.a.as_slice(), body.cc.as_slice(), body.cci.as_slice()],
    )?;
    if genre != GenreRedaction::Nouveau && body.message_id.is_none() {
        return Err(ApiError::bad_request("Message d'origine requis"));
    }

    let (origine, ligne) = match body.message_id {
        Some(message_uuid) => {
            let ligne = charger_message(&state, &claims, message_uuid).await?;
            let origine = lire_origine(&state, &ligne, genre == GenreRedaction::Transfert).await?;
            (Some(origine), Some(ligne))
        }
        None => (None, None),
    };

    let compte_id = match (&ligne, body.compte_id) {
        (Some(ligne), _) => ligne.compte_id,
        (None, Some(compte_id)) => compte_id,
        (None, None) => {
            let parametres = state
                .messagerie
                .as_ref()
                .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
            assurer_compte_classement(&state.pool, claims.cabinet_id, parametres).await?
        }
    };
    // « De » : l'adresse du compte (droit d'écrire vérifié : 403 sinon).
    let de = expediteur_pour_utilisateur(&state, &claims, compte_id).await?;

    let modele = match body.modele_id {
        Some(modele_id) => Some(
            sqlx::query_as::<_, (String, String)>(
                "SELECT objet, corps_html FROM modeles_message WHERE id = $1 AND cabinet_id = $2 AND actif",
            )
            .bind(modele_id)
            .bind(claims.cabinet_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| ApiError::internal("Lecture modèle"))?
            .ok_or_else(|| ApiError::not_found("Modèle introuvable"))?,
        ),
        None => None,
    };
    let signature = sqlx::query_as::<_, (String, String)>(
        "SELECT texte, html FROM signatures_messagerie WHERE compte_id = $1 AND utilisateur_id = $2",
    )
    .bind(compte_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture signature"))?
    .unwrap_or_default();
    let signature_inseree = !signature.0.trim().is_empty() || !signature.1.trim().is_empty();

    let objet_de_depart = if !objet_demande.trim().is_empty() {
        objet_demande
    } else if let Some(origine) = &origine {
        origine.objet.clone()
    } else {
        modele.as_ref().map(|m| m.0.clone()).unwrap_or_default()
    };
    let demande = DemandeRedaction {
        de: de.clone(),
        adresse_compte: de.clone(),
        a: body.a,
        cc: body.cc,
        cci: body.cci,
        objet: objet_de_depart,
        corps: String::new(),
        html: modele.map(|m| m.1).unwrap_or_default(),
        signature: signature.0,
        signature_html: signature.1,
        repondre_a: String::new(),
        identifiant: nouvel_identifiant(&de),
        origine,
        pieces: Vec::new(),
    };
    let identifiant = demande.identifiant.clone();
    let compose = composer_depart(genre, demande).map_err(|_| {
        ApiError::bad_request("Composition impossible : destinataires ou en-têtes invalides")
    })?;

    Ok(Json(CompositionResponse {
        genre: genre_vers_texte(genre).to_owned(),
        message_id: identifiant,
        compte_id,
        de,
        objet: compose.objet,
        a: compose.a,
        cc: compose.cc,
        cci: compose.cci,
        texte: compose.texte,
        html: compose.html,
        en_reponse_a: compose.en_reponse_a,
        references: compose.references,
        pieces: compose
            .pieces
            .iter()
            .map(|p| PieceResume {
                nom: p.nom.clone(),
                type_mime: p.type_mime.clone(),
                taille: p.contenu.len(),
            })
            .collect(),
        origine_message_id: body.message_id,
        signature_inseree,
        taille_max_pieces: TAILLE_MAX_PIECES,
    }))
}

// ---------------------------------------------------------------------------------------------
// Signature : une par compte et par utilisateur
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct SignatureResponse {
    pub compte_id: Uuid,
    pub texte: String,
    pub html: String,
    /// 0 tant qu'aucune signature n'est enregistrée.
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EcrireSignatureRequest {
    #[serde(default)]
    pub texte: String,
    #[serde(default)]
    pub html: String,
}

#[utoipa::path(
    get,
    path = "/messagerie/comptes/{compte_id}/signature",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Signature du compte pour l'utilisateur", body = SignatureResponse),
        (status = 404, description = "Compte introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_signature(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
) -> Result<Json<SignatureResponse>, ApiError> {
    compte_accessible(&state, &claims, compte_id).await?;
    let ligne = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT texte, html, revision FROM signatures_messagerie WHERE compte_id = $1 AND utilisateur_id = $2",
    )
    .bind(compte_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture signature"))?
    .unwrap_or_default();
    Ok(Json(SignatureResponse {
        compte_id,
        texte: ligne.0,
        html: ligne.1,
        revision: ligne.2,
    }))
}

#[utoipa::path(
    put,
    path = "/messagerie/comptes/{compte_id}/signature",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = EcrireSignatureRequest,
    responses(
        (status = 200, description = "Signature enregistrée", body = SignatureResponse),
        (status = 400, description = "Signature invalide", body = crate::error::ApiErrorBody),
        (status = 404, description = "Compte introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn ecrire_signature(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
    Json(body): Json<EcrireSignatureRequest>,
) -> Result<Json<SignatureResponse>, ApiError> {
    compte_accessible(&state, &claims, compte_id).await?;
    if body.texte.len() > SIGNATURE_MAX || body.html.len() > SIGNATURE_MAX {
        return Err(ApiError::bad_request("Signature trop longue"));
    }
    let html = nettoyer_html(&body.html);
    let texte = if body.texte.trim().is_empty() {
        texte_depuis_html(&html).trim().to_owned()
    } else {
        body.texte.trim_end().to_owned()
    };
    let ligne = sqlx::query_as::<_, (String, String, i64)>(
        r#"
        INSERT INTO signatures_messagerie (id, cabinet_id, compte_id, utilisateur_id, texte, html)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (compte_id, utilisateur_id) DO UPDATE
            SET texte = EXCLUDED.texte,
                html = EXCLUDED.html,
                revision = signatures_messagerie.revision + 1,
                modifie_le = NOW()
        RETURNING texte, html, revision
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(claims.cabinet_id)
    .bind(compte_id)
    .bind(claims.sub)
    .bind(&texte)
    .bind(&html)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Écriture signature"))?;
    Ok(Json(SignatureResponse {
        compte_id,
        texte: ligne.0,
        html: ligne.1,
        revision: ligne.2,
    }))
}

// ---------------------------------------------------------------------------------------------
// Modèles de message du cabinet
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct ModeleResponse {
    pub id: Uuid,
    pub nom: String,
    pub objet: String,
    pub corps_html: String,
    pub ordre: i32,
    pub actif: bool,
    pub revision: i64,
}

type LigneModele = (Uuid, String, String, String, i32, bool, i64);

fn vers_modele(ligne: LigneModele) -> ModeleResponse {
    ModeleResponse {
        id: ligne.0,
        nom: ligne.1,
        objet: ligne.2,
        corps_html: ligne.3,
        ordre: ligne.4,
        actif: ligne.5,
        revision: ligne.6,
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerModeleRequest {
    pub id: Uuid,
    pub nom: String,
    #[serde(default)]
    pub objet: String,
    #[serde(default)]
    pub corps_html: String,
    #[serde(default)]
    pub ordre: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchModeleRequest {
    pub nom: Option<String>,
    pub objet: Option<String>,
    pub corps_html: Option<String>,
    pub ordre: Option<i32>,
    pub actif: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ListeModelesQuery {
    /// `true` : les modèles désactivés sont listés aussi (écran de gestion).
    pub tous: Option<bool>,
}

fn verifier_nom_modele(nom: &str) -> Result<String, ApiError> {
    let nom = nom.trim();
    if nom.is_empty() || nom.chars().count() > NOM_MAX || nom.chars().any(char::is_control) {
        return Err(ApiError::bad_request("Nom de modèle invalide"));
    }
    Ok(nom.to_owned())
}

fn verifier_objet_modele(objet: &str) -> Result<String, ApiError> {
    if objet.chars().count() > OBJET_MAX || !champ_en_tete_valide(objet) {
        return Err(ApiError::bad_request("Objet de modèle invalide"));
    }
    Ok(objet.trim().to_owned())
}

fn verifier_corps_modele(corps_html: &str) -> Result<String, ApiError> {
    if corps_html.len() > HTML_MAX {
        return Err(ApiError::bad_request("Corps de modèle trop long"));
    }
    Ok(nettoyer_html(corps_html))
}

/// Un modèle du cabinet porte déjà ce nom, majuscules et accents compris : la comparaison est
/// faite ici (Unicode) parce que l'index unique de la base ne replie que l'ASCII selon la
/// collation ; il reste le filet contre deux créations simultanées.
async fn nom_modele_pris(
    pool: &sqlx::PgPool,
    cabinet_id: Uuid,
    nom: &str,
    sauf: Option<Uuid>,
) -> Result<bool, ApiError> {
    let noms = sqlx::query_scalar::<_, String>(
        "SELECT nom FROM modeles_message WHERE cabinet_id = $1 AND ($2::uuid IS NULL OR id <> $2)",
    )
    .bind(cabinet_id)
    .bind(sauf)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture modèles"))?;
    let cherche = nom.to_lowercase();
    Ok(noms
        .iter()
        .any(|existant| existant.to_lowercase() == cherche))
}

#[utoipa::path(
    get,
    path = "/messagerie/modeles",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Modèles du cabinet", body = Vec<ModeleResponse>))
)]
pub async fn lister_modeles(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(query): Query<ListeModelesQuery>,
) -> Result<Json<Vec<ModeleResponse>>, ApiError> {
    let lignes = sqlx::query_as::<_, LigneModele>(
        r#"
        SELECT id, nom, objet, corps_html, ordre, actif, revision
        FROM modeles_message
        WHERE cabinet_id = $1 AND (actif OR $2)
        ORDER BY ordre ASC, lower(nom) ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(query.tous.unwrap_or(false))
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture modèles"))?;
    Ok(Json(lignes.into_iter().map(vers_modele).collect()))
}

#[utoipa::path(
    post,
    path = "/messagerie/modeles",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = CreerModeleRequest,
    responses(
        (status = 200, description = "Modèle créé ou déjà présent", body = ModeleResponse),
        (status = 400, description = "Modèle invalide", body = crate::error::ApiErrorBody),
        (status = 409, description = "Nom déjà utilisé", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerModeleRequest>,
) -> Result<Json<ModeleResponse>, ApiError> {
    let nom = verifier_nom_modele(&body.nom)?;
    let objet = verifier_objet_modele(&body.objet)?;
    let corps_html = verifier_corps_modele(&body.corps_html)?;
    let rejeu = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM modeles_message WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture modèle"))?
    .is_some();
    if !rejeu && nom_modele_pris(&state.pool, claims.cabinet_id, &nom, None).await? {
        return Err(ApiError::conflict("Un modèle porte déjà ce nom"));
    }
    let resultat = sqlx::query_as::<_, LigneModele>(
        r#"
        INSERT INTO modeles_message (id, cabinet_id, nom, objet, corps_html, ordre)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, nom, objet, corps_html, ordre, actif, revision
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&nom)
    .bind(&objet)
    .bind(&corps_html)
    .bind(body.ordre)
    .fetch_optional(&state.pool)
    .await;
    let ligne = match resultat {
        Ok(Some(ligne)) => ligne,
        // Rejeu du même identifiant : la ligne existante, si elle est celle du cabinet.
        Ok(None) => sqlx::query_as::<_, LigneModele>(
            "SELECT id, nom, objet, corps_html, ordre, actif, revision FROM modeles_message WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(body.id)
        .bind(claims.cabinet_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Lecture modèle"))?
        .ok_or_else(|| ApiError::conflict("Identifiant de modèle déjà utilisé"))?,
        Err(err) if est_doublon(&err) => {
            return Err(ApiError::conflict("Un modèle porte déjà ce nom"));
        }
        Err(_) => return Err(ApiError::internal("Création modèle")),
    };
    Ok(Json(vers_modele(ligne)))
}

#[utoipa::path(
    patch,
    path = "/messagerie/modeles/{modele_id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = PatchModeleRequest,
    responses(
        (status = 200, description = "Modèle modifié", body = ModeleResponse),
        (status = 400, description = "Modèle invalide", body = crate::error::ApiErrorBody),
        (status = 404, description = "Modèle introuvable", body = crate::error::ApiErrorBody),
        (status = 409, description = "Nom déjà utilisé", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(modele_id): Path<Uuid>,
    Json(body): Json<PatchModeleRequest>,
) -> Result<Json<ModeleResponse>, ApiError> {
    let nom = body.nom.as_deref().map(verifier_nom_modele).transpose()?;
    let objet = body
        .objet
        .as_deref()
        .map(verifier_objet_modele)
        .transpose()?;
    let corps_html = body
        .corps_html
        .as_deref()
        .map(verifier_corps_modele)
        .transpose()?;
    if let Some(nom) = &nom {
        if nom_modele_pris(&state.pool, claims.cabinet_id, nom, Some(modele_id)).await? {
            return Err(ApiError::conflict("Un modèle porte déjà ce nom"));
        }
    }
    let resultat = sqlx::query_as::<_, LigneModele>(
        r#"
        UPDATE modeles_message
        SET nom = COALESCE($3, nom),
            objet = COALESCE($4, objet),
            corps_html = COALESCE($5, corps_html),
            ordre = COALESCE($6, ordre),
            actif = COALESCE($7, actif),
            revision = revision + 1,
            modifie_le = NOW()
        WHERE id = $1 AND cabinet_id = $2
        RETURNING id, nom, objet, corps_html, ordre, actif, revision
        "#,
    )
    .bind(modele_id)
    .bind(claims.cabinet_id)
    .bind(nom)
    .bind(objet)
    .bind(corps_html)
    .bind(body.ordre)
    .bind(body.actif)
    .fetch_optional(&state.pool)
    .await;
    match resultat {
        Ok(Some(ligne)) => Ok(Json(vers_modele(ligne))),
        Ok(None) => Err(ApiError::not_found("Modèle introuvable")),
        Err(err) if est_doublon(&err) => Err(ApiError::conflict("Un modèle porte déjà ce nom")),
        Err(_) => Err(ApiError::internal("Modification modèle")),
    }
}

#[utoipa::path(
    delete,
    path = "/messagerie/modeles/{modele_id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Modèle supprimé"),
        (status = 404, description = "Modèle introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn supprimer_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(modele_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let efface = sqlx::query("DELETE FROM modeles_message WHERE id = $1 AND cabinet_id = $2")
        .bind(modele_id)
        .bind(claims.cabinet_id)
        .execute(&state.pool)
        .await
        .map_err(|_| ApiError::internal("Suppression modèle"))?
        .rows_affected();
    if efface == 0 {
        return Err(ApiError::not_found("Modèle introuvable"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use legalos_messagerie::{
        analyser_composition, DemandeRedaction, GenreRedaction, MessageOrigine, PieceJointe,
    };

    use super::{
        composer_depart, genre_depuis_texte, genre_vers_texte, liste_depuis_texte,
        nouvel_identifiant, sortant_depuis_contenu, texte_depuis_liste, verifier_champs_en_tete,
        ContenuEnvoi,
    };

    fn contenu() -> ContenuEnvoi {
        ContenuEnvoi {
            message_id: "<envoi-j11-1a@cabinet.example>".to_owned(),
            a: vec!["Confrere Fictif <confrere@example.com>".to_owned()],
            cc: vec!["copie@example.com".to_owned()],
            cci: vec!["cachee@example.com".to_owned()],
            objet: "Re: Audience".to_owned(),
            corps: "Texte du cabinet.".to_owned(),
            corps_html: "<p>Texte du cabinet.</p>".to_owned(),
            en_reponse_a: Some("<origine-j11@example.com>".to_owned()),
            references: vec!["<ancien-j11@example.com>".to_owned()],
            pieces: vec![PieceJointe {
                nom: "note-fictive.txt".to_owned(),
                type_mime: "text/plain".to_owned(),
                contenu: b"contenu fictif".to_vec(),
            }],
            repondre_a: None,
        }
    }

    fn en_tetes(octets: &[u8]) -> String {
        let texte = String::from_utf8_lossy(octets).to_string();
        texte
            .split("\r\n\r\n")
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
    }

    #[test]
    fn le_transport_ne_porte_pas_la_copie_cachee_mais_l_enveloppe_oui() {
        let sortant = sortant_depuis_contenu("demo@cabinet.example", &contenu()).expect("sortant");
        assert!(!en_tetes(&sortant.transport).contains("bcc"));
        assert!(!en_tetes(&sortant.transport).contains("cachee@example.com"));
        assert!(sortant
            .destinataires
            .iter()
            .any(|d| d == "cachee@example.com"));
        assert!(sortant
            .destinataires
            .iter()
            .any(|d| d == "confrere@example.com"));
        assert_eq!(sortant.expediteur, "demo@cabinet.example");
    }

    #[test]
    fn la_copie_envoyes_garde_la_copie_cachee() {
        let sortant = sortant_depuis_contenu("demo@cabinet.example", &contenu()).expect("sortant");
        let relu = analyser_composition(&sortant.copie).expect("relecture");
        assert_eq!(relu.cci, vec!["cachee@example.com".to_owned()]);
        assert_eq!(
            relu.a,
            vec!["\"Confrere Fictif\" <confrere@example.com>".to_owned()]
        );
    }

    #[test]
    fn identifiant_fil_et_pieces_identiques_dans_les_deux_variantes() {
        let sortant = sortant_depuis_contenu("demo@cabinet.example", &contenu()).expect("sortant");
        let copie = analyser_composition(&sortant.copie).expect("copie");
        let transport = analyser_composition(&sortant.transport).expect("transport");
        assert_eq!(copie.message_id, "<envoi-j11-1a@cabinet.example>");
        assert_eq!(transport.message_id, copie.message_id);
        assert_eq!(
            transport.en_reponse_a.as_deref(),
            Some("<origine-j11@example.com>")
        );
        assert_eq!(
            transport.references,
            vec![
                "<ancien-j11@example.com>".to_owned(),
                "<origine-j11@example.com>".to_owned()
            ]
        );
        assert_eq!(transport.pieces.len(), 1);
        assert!(transport.cci.is_empty());
    }

    #[test]
    fn un_retour_a_la_ligne_dans_l_objet_ou_une_adresse_est_refuse() {
        let mut injecte = contenu();
        injecte.objet = "Audience\r\nBcc: pirate@example.com".to_owned();
        assert!(sortant_depuis_contenu("demo@cabinet.example", &injecte).is_err());
        let mut adresse = contenu();
        adresse.a = vec!["confrere@example.com\r\nBcc: pirate@example.com".to_owned()];
        assert!(sortant_depuis_contenu("demo@cabinet.example", &adresse).is_err());
        assert!(verifier_champs_en_tete("Audience\nBcc: x@example.com", &[]).is_err());
        let adresses = vec!["a@example.com\r\nX: y".to_owned()];
        assert!(verifier_champs_en_tete("Audience", &[adresses.as_slice()]).is_err());
        assert!(verifier_champs_en_tete("Audience", &[]).is_ok());
    }

    #[test]
    fn sans_destinataire_le_message_est_refuse() {
        let mut vide = contenu();
        vide.a.clear();
        vide.cc.clear();
        vide.cci.clear();
        assert!(sortant_depuis_contenu("demo@cabinet.example", &vide).is_err());
    }

    #[test]
    fn genres_et_listes_d_adresses() {
        for genre in ["nouveau", "reponse", "reponse_a_tous", "transfert"] {
            let lu = genre_depuis_texte(genre).expect("genre");
            assert_eq!(genre_vers_texte(lu), genre);
        }
        assert!(genre_depuis_texte("repondre").is_none());
        let liste = vec![
            " a@example.com ".to_owned(),
            String::new(),
            "b@example.com".to_owned(),
        ];
        let texte = texte_depuis_liste(&liste);
        assert_eq!(texte, "a@example.com\nb@example.com");
        assert_eq!(
            liste_depuis_texte(&texte),
            vec!["a@example.com".to_owned(), "b@example.com".to_owned()]
        );
    }

    #[test]
    fn le_contrat_openapi_decrit_les_routes_de_redaction() {
        use utoipa::OpenApi;
        let doc = serde_json::to_value(crate::openapi::ApiDoc::openapi()).expect("openapi");
        let chemins = doc["paths"].as_object().expect("paths");
        for chemin in [
            "/messagerie/composition",
            "/messagerie/comptes/{compte_id}/signature",
            "/messagerie/modeles",
            "/messagerie/modeles/{modele_id}",
            "/messagerie/brouillons",
            "/messagerie/brouillons/{id}",
            "/messagerie/brouillons/{id}/pieces",
            "/messagerie/brouillons/{id}/pieces/{piece_id}",
            "/messagerie/brouillons/{id}/envoyer",
            "/messagerie/destinataires",
        ] {
            assert!(chemins.contains_key(chemin), "chemin absent : {chemin}");
        }
        assert!(doc["components"]["schemas"]["CompositionResponse"].is_object());
        assert!(doc["components"]["schemas"]["BrouillonResponse"].is_object());
        assert!(doc["components"]["schemas"]["DestinataireSuggere"].is_object());
        // Les méthodes sont celles du contrat : écriture partielle (PUT), suppression, envoi.
        let brouillon = &doc["paths"]["/messagerie/brouillons/{id}"];
        for methode in ["get", "put", "delete"] {
            assert!(
                brouillon[methode].is_object(),
                "méthode absente : {methode}"
            );
        }
    }

    fn origine() -> MessageOrigine {
        MessageOrigine {
            identifiant: "<origine-j11@example.com>".to_owned(),
            references: vec!["<ancien-j11@example.com>".to_owned()],
            objet: "Audience".to_owned(),
            expediteur: "Confrere Fictif <confrere@example.com>".to_owned(),
            a: vec![
                "Demo <DEMO@cabinet.example>".to_owned(),
                "Client Fictif <client@example.com>".to_owned(),
            ],
            cc: vec!["Secretariat <secretariat@example.com>".to_owned()],
            texte: "Bonjour, merci de confirmer le creneau.".to_owned(),
            html: "<p>Bonjour, merci de confirmer le creneau.</p><script>alert(1)</script>"
                .to_owned(),
            pieces: vec![PieceJointe {
                nom: "Convocation.pdf".to_owned(),
                type_mime: "application/pdf".to_owned(),
                contenu: b"%PDF-fictif".to_vec(),
            }],
        }
    }

    fn demande(origine: Option<MessageOrigine>) -> DemandeRedaction {
        DemandeRedaction {
            de: "demo@cabinet.example".to_owned(),
            adresse_compte: "demo@cabinet.example".to_owned(),
            a: Vec::new(),
            cc: Vec::new(),
            cci: Vec::new(),
            objet: origine
                .as_ref()
                .map(|o| o.objet.clone())
                .unwrap_or_default(),
            corps: String::new(),
            html: String::new(),
            signature: "Me Test Fictif".to_owned(),
            signature_html: String::new(),
            repondre_a: String::new(),
            identifiant: nouvel_identifiant("demo@cabinet.example"),
            origine,
            pieces: Vec::new(),
        }
    }

    #[test]
    fn depart_de_reponse_pose_le_fil_la_signature_et_l_historique() {
        let compose =
            composer_depart(GenreRedaction::Reponse, demande(Some(origine()))).expect("reponse");
        assert_eq!(compose.objet, "Re: Audience");
        assert_eq!(
            compose.en_reponse_a.as_deref(),
            Some("<origine-j11@example.com>")
        );
        assert_eq!(
            compose.references,
            vec![
                "<ancien-j11@example.com>".to_owned(),
                "<origine-j11@example.com>".to_owned()
            ]
        );
        assert_eq!(compose.a.len(), 1);
        assert!(compose.a[0].contains("confrere@example.com"));
        assert!(compose.cc.is_empty());
        assert!(compose.texte.contains("Me Test Fictif"));
        assert!(compose
            .texte
            .contains("> Bonjour, merci de confirmer le creneau."));
        assert!(compose.html.to_ascii_lowercase().contains("blockquote"));
        assert!(!compose.html.to_ascii_lowercase().contains("script"));
        assert!(compose.pieces.is_empty());
    }

    #[test]
    fn depart_de_reponse_a_tous_exclut_l_expediteur_meme_en_majuscules() {
        let compose = composer_depart(GenreRedaction::ReponseATous, demande(Some(origine())))
            .expect("reponse a tous");
        let tout: Vec<String> = compose
            .a
            .iter()
            .chain(compose.cc.iter())
            .map(|a| a.to_ascii_lowercase())
            .collect();
        assert!(tout.iter().all(|a| !a.contains("demo@cabinet.example")));
        assert!(tout.iter().any(|a| a.contains("confrere@example.com")));
        assert!(tout.iter().any(|a| a.contains("client@example.com")));
        assert!(tout.iter().any(|a| a.contains("secretariat@example.com")));
        // Essai négatif : la réponse simple ne reprend pas les autres destinataires.
        let simple =
            composer_depart(GenreRedaction::Reponse, demande(Some(origine()))).expect("reponse");
        assert!(simple.cc.is_empty() && simple.a.len() == 1);
    }

    #[test]
    fn depart_de_transfert_garde_les_pieces_sans_fil_ni_destinataire() {
        let compose = composer_depart(GenreRedaction::Transfert, demande(Some(origine())))
            .expect("transfert");
        assert_eq!(compose.objet, "Fwd: Audience");
        assert!(compose.a.is_empty() && compose.cc.is_empty() && compose.cci.is_empty());
        assert!(compose.en_reponse_a.is_none() && compose.references.is_empty());
        assert_eq!(compose.pieces.len(), 1);
        assert_eq!(compose.pieces[0].nom, "Convocation.pdf");
        assert!(compose
            .texte
            .contains("> Bonjour, merci de confirmer le creneau."));
    }

    #[test]
    fn depart_de_message_neuf_sans_destinataire_porte_la_signature() {
        let mut neuf = demande(None);
        neuf.objet = "Note interne".to_owned();
        let compose = composer_depart(GenreRedaction::Nouveau, neuf).expect("neuf");
        assert!(compose.a.is_empty());
        assert_eq!(compose.objet, "Note interne");
        assert!(compose.texte.contains("Me Test Fictif"));
        assert!(compose.en_reponse_a.is_none());
    }

    #[test]
    fn depart_refuse_un_objet_ou_une_adresse_injectes() {
        let mut injecte = demande(None);
        injecte.objet = "Note
Bcc: pirate@example.com"
            .to_owned();
        assert!(composer_depart(GenreRedaction::Nouveau, injecte).is_err());
        let mut adresse = demande(None);
        adresse.a = vec!["x@example.com
Bcc: pirate@example.com"
            .to_owned()];
        assert!(composer_depart(GenreRedaction::Nouveau, adresse).is_err());
        // Une réponse sans message d'origine n'a ni fil ni destinataire : refusée.
        assert!(composer_depart(GenreRedaction::Reponse, demande(None)).is_err());
    }

    #[test]
    fn identifiant_neuf_au_domaine_de_l_expediteur() {
        let premier = nouvel_identifiant("Cabinet <demo@cabinet.example>");
        let second = nouvel_identifiant("demo@cabinet.example");
        assert!(premier.starts_with("<envoi-") && premier.ends_with("@cabinet.example>"));
        assert_ne!(premier, second);
        assert!(nouvel_identifiant("sans-arobase").ends_with("@cabinet.example>"));
    }
}
