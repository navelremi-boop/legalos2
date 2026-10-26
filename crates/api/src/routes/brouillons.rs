//! Brouillons de message (J11, étape 1b).
//!
//! Un brouillon est une ligne `brouillons_message` propre à son auteur : le poste l'écrit (hors
//! ligne, par la file d'upload) et la reçoit en retour par le flux `brouillons_titulaire`. L'API
//! en recopie chaque version dans le dossier Brouillons du serveur IMAP (voir
//! `crate::depot_brouillons`). Dernière écriture gagnante : pas de contrôle de révision, il n'y a
//! qu'un auteur. L'envoi crée la ligne de `file_envoi` puis retire le brouillon et sa copie.
//!
//! Aucun contenu de mail, objet ni adresse dans les journaux ou les erreurs.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use legalos_messagerie::{
    champ_en_tete_valide, nettoyer_html, texte_depuis_html, type_mime_piece, GenreRedaction,
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{Postgres, Transaction};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::jwt::AccessClaims;
use crate::depot_brouillons::DepotBrouillons;
use crate::error::ApiError;
use crate::identite_envoi::{expediteur_pour_utilisateur, identite_pour_utilisateur};
use crate::routes::dossiers::dossier_visible;
use crate::routes::file_envoi::{charger_reponse, FileEnvoiResponse};
use crate::routes::messagerie::assurer_compte_classement;
use crate::routes::redaction::{
    charger_message, genre_depuis_texte, genre_vers_texte, lire_origine, liste_depuis_texte,
    nouvel_identifiant, sortant_depuis_contenu, texte_depuis_liste, verifier_champs_en_tete,
    ContenuEnvoi, HTML_MAX, OBJET_MAX, TAILLE_MAX_PIECES,
};
use crate::state::AppState;

const ADRESSES_MAX: usize = 200;
const ADRESSE_LONGUEUR_MAX: usize = 320;
const REFERENCES_MAX: usize = 100;
const IDENTIFIANT_LONGUEUR_MAX: usize = 998;
const NOM_PIECE_MAX: usize = 255;
const PIECES_MAX: i64 = 50;

macro_rules! colonnes {
    () => {
        "id, cabinet_id, auteur_id, compte_id, genre, origine_message_id, dossier_id, a, cc, cci, \
         objet, corps_html, corps, message_id, en_reponse_a, references_texte, pieces_texte, \
         expediteur, imap_etat, revision, cree_le, modifie_le"
    };
}

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
struct LigneBrouillon {
    id: Uuid,
    cabinet_id: Uuid,
    auteur_id: Uuid,
    compte_id: Uuid,
    genre: String,
    origine_message_id: Option<Uuid>,
    dossier_id: Option<Uuid>,
    a: String,
    cc: String,
    cci: String,
    objet: String,
    corps_html: String,
    corps: String,
    message_id: String,
    en_reponse_a: Option<String>,
    references_texte: String,
    pieces_texte: String,
    expediteur: String,
    imap_etat: String,
    revision: i64,
    cree_le: OffsetDateTime,
    modifie_le: OffsetDateTime,
}

/// Résumé d'une pièce : seul ce résumé est synchronisé avec le poste, jamais le contenu.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PieceBrouillon {
    pub id: Uuid,
    pub nom: String,
    pub type_mime: String,
    pub taille: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BrouillonResponse {
    pub id: Uuid,
    pub compte_id: Uuid,
    /// `nouveau`, `reponse`, `reponse_a_tous` ou `transfert`.
    pub genre: String,
    pub origine_message_id: Option<Uuid>,
    pub dossier_id: Option<Uuid>,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    pub objet: String,
    pub corps_html: String,
    pub corps: String,
    /// Figé à la création, repris tel quel par l'envoi.
    pub message_id: String,
    pub en_reponse_a: Option<String>,
    pub references: Vec<String>,
    pub pieces: Vec<PieceBrouillon>,
    /// État de la copie dans le dossier Brouillons du serveur : `a_deposer`, `depose`, `erreur`.
    pub imap_etat: String,
    pub revision: i64,
    pub cree_le: String,
    pub modifie_le: String,
}

fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Écriture partielle d'un brouillon. Tout champ absent est laissé tel quel ; `compte_id`,
/// `genre`, `origine_message_id` et `message_id` se fixent à la création et ne changent plus
/// (les redonner à l'identique est accepté : l'écriture reste rejouable).
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct EcrireBrouillonRequest {
    pub compte_id: Option<Uuid>,
    pub genre: Option<String>,
    pub origine_message_id: Option<Uuid>,
    /// `null` détache le brouillon de son dossier.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<Uuid>)]
    pub dossier_id: Option<Option<Uuid>>,
    pub a: Option<Vec<String>>,
    pub cc: Option<Vec<String>>,
    pub cci: Option<Vec<String>>,
    pub objet: Option<String>,
    /// HTML saisi, nettoyé avant stockage.
    pub corps_html: Option<String>,
    /// Texte brut ; tiré du HTML si absent ou vide.
    pub corps: Option<String>,
    pub message_id: Option<String>,
    /// Vide : efface le fil.
    pub en_reponse_a: Option<String>,
    pub references: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct PieceQuery {
    /// Nom de la pièce (obligatoire).
    pub nom: Option<String>,
    /// Identifiant choisi par le client : rejouer la requête ne crée pas de doublon.
    pub piece_id: Option<Uuid>,
}

// ---------------------------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------------------------

/// Écriture validée et normalisée : rien n'est lu ni écrit avant qu'elle soit entièrement valide.
struct Champs {
    compte_id: Option<Uuid>,
    genre: Option<GenreRedaction>,
    origine_message_id: Option<Uuid>,
    dossier_id: Option<Option<Uuid>>,
    a: Option<Vec<String>>,
    cc: Option<Vec<String>>,
    cci: Option<Vec<String>>,
    objet: Option<String>,
    corps_html: Option<String>,
    corps: Option<String>,
    message_id: Option<String>,
    en_reponse_a: Option<Option<String>>,
    references: Option<Vec<String>>,
}

fn identifiant_valide(brut: &str) -> Result<String, ApiError> {
    let nu = brut
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim();
    if !champ_en_tete_valide(brut)
        || nu.is_empty()
        || nu.contains([' ', '<', '>'])
        || nu.len() > IDENTIFIANT_LONGUEUR_MAX
    {
        return Err(ApiError::bad_request("Identifiant de message invalide"));
    }
    Ok(format!("<{nu}>"))
}

fn liste_adresses(liste: &[String]) -> Result<Vec<String>, ApiError> {
    let propre: Vec<String> = liste
        .iter()
        .map(|adresse| adresse.trim().to_owned())
        .filter(|adresse| !adresse.is_empty())
        .collect();
    if propre.len() > ADRESSES_MAX
        || propre
            .iter()
            .any(|adresse| adresse.chars().count() > ADRESSE_LONGUEUR_MAX)
    {
        return Err(ApiError::bad_request("Liste d'adresses trop longue"));
    }
    Ok(propre)
}

impl Champs {
    fn depuis(body: EcrireBrouillonRequest) -> Result<Self, ApiError> {
        let vide: Vec<String> = Vec::new();
        // Contrôle sur les valeurs brutes, avant tout nettoyage : un retour à la ligne est refusé,
        // jamais retiré en silence.
        verifier_champs_en_tete(
            body.objet.as_deref().unwrap_or_default(),
            &[
                body.a.as_deref().unwrap_or(vide.as_slice()),
                body.cc.as_deref().unwrap_or(vide.as_slice()),
                body.cci.as_deref().unwrap_or(vide.as_slice()),
            ],
        )?;
        let genre = body
            .genre
            .as_deref()
            .map(|texte| {
                genre_depuis_texte(texte)
                    .ok_or_else(|| ApiError::bad_request("Genre de message inconnu"))
            })
            .transpose()?;
        if body
            .objet
            .as_deref()
            .is_some_and(|objet| objet.chars().count() > OBJET_MAX)
        {
            return Err(ApiError::bad_request("Objet trop long"));
        }
        if body
            .corps_html
            .as_deref()
            .is_some_and(|h| h.len() > HTML_MAX)
            || body.corps.as_deref().is_some_and(|t| t.len() > HTML_MAX)
        {
            return Err(ApiError::bad_request("Corps du message trop long"));
        }
        let message_id = body
            .message_id
            .as_deref()
            .map(identifiant_valide)
            .transpose()?;
        let en_reponse_a = match body.en_reponse_a.as_deref() {
            None => None,
            Some(valeur) if valeur.trim().is_empty() => Some(None),
            Some(valeur) => Some(Some(identifiant_valide(valeur)?)),
        };
        let references = match body.references.as_deref() {
            None => None,
            Some(liste) => {
                if liste.len() > REFERENCES_MAX {
                    return Err(ApiError::bad_request("Trop de références de fil"));
                }
                let mut sortie = Vec::new();
                for brut in liste.iter().filter(|r| !r.trim().is_empty()) {
                    sortie.push(identifiant_valide(brut)?);
                }
                Some(sortie)
            }
        };
        let corps_html = body.corps_html.as_deref().map(nettoyer_html);
        // Le texte suit le HTML : sinon une ancienne version resterait dans `corps`.
        let corps = match (&body.corps, &corps_html) {
            (Some(texte), _) if !texte.trim().is_empty() => Some(texte.clone()),
            (_, Some(html)) => Some(texte_depuis_html(html).trim().to_owned()),
            (Some(_), None) => Some(String::new()),
            (None, None) => None,
        };
        Ok(Self {
            compte_id: body.compte_id,
            genre,
            origine_message_id: body.origine_message_id,
            dossier_id: body.dossier_id,
            a: body.a.as_deref().map(liste_adresses).transpose()?,
            cc: body.cc.as_deref().map(liste_adresses).transpose()?,
            cci: body.cci.as_deref().map(liste_adresses).transpose()?,
            objet: body.objet.as_deref().map(|o| o.trim().to_owned()),
            corps_html,
            corps,
            message_id,
            en_reponse_a,
            references,
        })
    }
}

fn nom_piece_valide(brut: &str) -> Result<String, ApiError> {
    let nom = brut.trim();
    if nom.is_empty()
        || nom.chars().count() > NOM_PIECE_MAX
        || nom.chars().any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(ApiError::bad_request("Nom de pièce invalide"));
    }
    Ok(nom.to_owned())
}

fn repond(genre: &str) -> bool {
    matches!(genre, "reponse" | "reponse_a_tous")
}

fn resume_json(pieces: &[PieceBrouillon]) -> String {
    serde_json::to_string(pieces).unwrap_or_else(|_| "[]".to_owned())
}

fn pieces_depuis_json(texte: &str) -> Vec<PieceBrouillon> {
    serde_json::from_str(texte).unwrap_or_default()
}

fn vers_reponse(ligne: LigneBrouillon) -> BrouillonResponse {
    let formater = |instant: OffsetDateTime| instant.format(&Rfc3339).unwrap_or_default();
    BrouillonResponse {
        id: ligne.id,
        compte_id: ligne.compte_id,
        genre: ligne.genre,
        origine_message_id: ligne.origine_message_id,
        dossier_id: ligne.dossier_id,
        a: liste_depuis_texte(&ligne.a),
        cc: liste_depuis_texte(&ligne.cc),
        cci: liste_depuis_texte(&ligne.cci),
        objet: ligne.objet,
        corps_html: ligne.corps_html,
        corps: ligne.corps,
        message_id: ligne.message_id,
        en_reponse_a: ligne.en_reponse_a,
        references: liste_depuis_texte(&ligne.references_texte),
        pieces: pieces_depuis_json(&ligne.pieces_texte),
        imap_etat: ligne.imap_etat,
        revision: ligne.revision,
        cree_le: formater(ligne.cree_le),
        modifie_le: formater(ligne.modifie_le),
    }
}

// ---------------------------------------------------------------------------------------------
// Accès à la base
// ---------------------------------------------------------------------------------------------

fn depot_de(state: &AppState) -> DepotBrouillons {
    DepotBrouillons::new(
        state.pool.clone(),
        state.totp_cipher_key,
        state.messagerie.clone(),
    )
}

/// Dépose la nouvelle version dans le dossier Brouillons, hors de la requête.
fn deposer_en_fond(state: &AppState, id: Uuid) {
    let depot = depot_de(state);
    tokio::spawn(async move {
        depot.deposer(id).await;
    });
}

/// Brouillon de l'appelant, visible : un brouillon d'un autre auteur ou d'un autre cabinet, ou
/// déjà retiré, est introuvable (404, jamais « interdit »).
fn doit_etre_a_lui(
    ligne: Option<LigneBrouillon>,
    claims: &AccessClaims,
) -> Result<LigneBrouillon, ApiError> {
    ligne
        .filter(|l| {
            l.cabinet_id == claims.cabinet_id
                && l.auteur_id == claims.sub
                && l.imap_etat != "a_retirer"
        })
        .ok_or_else(|| ApiError::not_found("Brouillon introuvable"))
}

async fn lire_ligne(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<LigneBrouillon>, ApiError> {
    sqlx::query_as::<_, LigneBrouillon>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM brouillons_message WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture brouillon"))
}

async fn verrouiller(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    claims: &AccessClaims,
) -> Result<LigneBrouillon, ApiError> {
    let ligne = sqlx::query_as::<_, LigneBrouillon>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM brouillons_message WHERE id = $1 FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("Lecture brouillon"))?;
    doit_etre_a_lui(ligne, claims)
}

async fn relire(pool: &sqlx::PgPool, id: Uuid) -> Result<BrouillonResponse, ApiError> {
    lire_ligne(pool, id)
        .await?
        .map(vers_reponse)
        .ok_or_else(|| ApiError::not_found("Brouillon introuvable"))
}

/// Recompte les pièces, met le résumé à jour et relance la copie IMAP.
async fn rafraichir_pieces(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), ApiError> {
    let pieces = sqlx::query_as::<_, (Uuid, String, String, i32)>(
        "SELECT id, nom, type_mime, taille FROM brouillons_message_pieces WHERE brouillon_id = $1 ORDER BY ordre",
    )
    .bind(id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("Lecture pièces"))?
    .into_iter()
    .map(|(id, nom, type_mime, taille)| PieceBrouillon {
        id,
        nom,
        type_mime,
        taille: i64::from(taille),
    })
    .collect::<Vec<_>>();
    sqlx::query(
        r#"
        UPDATE brouillons_message
        SET pieces_texte = $2, revision = revision + 1, modifie_le = NOW(),
            imap_etat = 'a_deposer', imap_maj_le = NOW()
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(resume_json(&pieces))
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("Écriture pièces"))?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Écriture, lecture, suppression
// ---------------------------------------------------------------------------------------------

#[utoipa::path(
    put,
    path = "/messagerie/brouillons/{id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = EcrireBrouillonRequest,
    responses(
        (status = 200, description = "Brouillon créé ou mis à jour (écriture partielle, rejouable)", body = BrouillonResponse),
        (status = 400, description = "Champ invalide ou champ figé modifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Brouillon d'un autre auteur, message ou dossier introuvable", body = crate::error::ApiErrorBody),
        (status = 409, description = "Brouillon déjà envoyé ou identifiant de message déjà utilisé", body = crate::error::ApiErrorBody),
    )
)]
pub async fn ecrire_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
    Json(body): Json<EcrireBrouillonRequest>,
) -> Result<Json<BrouillonResponse>, ApiError> {
    let champs = Champs::depuis(body)?;
    // Deux passages au plus : une création concurrente du même identifiant fait basculer le
    // second appel sur la mise à jour.
    for _ in 0..2 {
        let (ligne, a_deposer) = match lire_ligne(&state.pool, id).await? {
            Some(existante) => {
                doit_etre_a_lui(Some(existante), &claims)?;
                match mettre_a_jour(&state, &claims, id, &champs).await? {
                    Some(resultat) => resultat,
                    None => continue,
                }
            }
            None => match creer(&state, &claims, id, &champs).await? {
                Some(ligne) => (ligne, true),
                None => continue,
            },
        };
        if a_deposer {
            deposer_en_fond(&state, id);
        }
        return Ok(Json(vers_reponse(ligne)));
    }
    Err(ApiError::conflict("Brouillon modifié simultanément"))
}

/// Un brouillon de cet identifiant déjà parti en file d'envoi : le rejouer ne le ressuscite pas.
async fn deja_envoye(
    pool: &sqlx::PgPool,
    id: Uuid,
    claims: &AccessClaims,
) -> Result<bool, ApiError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM file_envoi WHERE id = $1 AND cabinet_id = $2 AND auteur_id = $3",
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(pool)
    .await
    .map(|ligne| ligne.is_some())
    .map_err(|_| ApiError::internal("Lecture file envoi"))
}

/// `None` : un autre appel a créé la ligne entre-temps.
async fn creer(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
    champs: &Champs,
) -> Result<Option<LigneBrouillon>, ApiError> {
    if deja_envoye(&state.pool, id, claims).await? {
        return Err(ApiError::conflict("Ce brouillon a déjà été envoyé"));
    }
    let genre = champs.genre.unwrap_or(GenreRedaction::Nouveau);
    let genre_texte = genre_vers_texte(genre);
    if genre != GenreRedaction::Nouveau && champs.origine_message_id.is_none() {
        return Err(ApiError::bad_request("Message d'origine requis"));
    }
    // Message d'origine : droits vérifiés comme à la composition (boîte nominative du seul
    // titulaire, dossier restreint réservé à ses accès).
    let origine = match champs.origine_message_id {
        Some(origine_id) => Some((
            origine_id,
            charger_message(state, claims, origine_id).await?,
        )),
        None => None,
    };
    let compte_id = match (&origine, champs.compte_id) {
        (Some((_, ligne)), Some(demande)) if demande != ligne.compte_id => {
            return Err(ApiError::bad_request(
                "Le compte d'un brouillon est celui du message d'origine",
            ));
        }
        (Some((_, ligne)), _) => ligne.compte_id,
        (None, Some(compte_id)) => compte_id,
        (None, None) => {
            let parametres = state
                .messagerie
                .as_ref()
                .ok_or_else(|| ApiError::bad_request("Messagerie non configurée"))?;
            assurer_compte_classement(&state.pool, claims.cabinet_id, parametres).await?
        }
    };
    // Le brouillon est écrit depuis ce compte : droit d'écrire vérifié ici (403 sinon).
    let expediteur = expediteur_pour_utilisateur(state, claims, compte_id).await?;
    let message_id = match &champs.message_id {
        Some(identifiant) => identifiant.clone(),
        None => nouvel_identifiant(&expediteur),
    };
    let en_reponse_a = match champs.en_reponse_a.clone() {
        Some(valeur) => valeur,
        None if repond(genre_texte) => origine.as_ref().map(|(_, l)| l.message_id.clone()),
        None => None,
    };
    let dossier_id = champs.dossier_id.flatten();
    if let Some(dossier_id) = dossier_id {
        if !dossier_visible(state, claims.cabinet_id, claims.sub, dossier_id).await? {
            return Err(ApiError::not_found("Dossier introuvable"));
        }
    }
    // Un transfert garde les pièces d'origine : copiées ici, elles deviennent des pièces du
    // brouillon, que l'utilisateur voit et peut retirer.
    let mut pieces: Vec<(Uuid, String, String, Vec<u8>)> = Vec::new();
    if genre == GenreRedaction::Transfert {
        if let Some((_, ligne)) = &origine {
            let message = lire_origine(state, ligne, true).await?;
            pieces = message
                .pieces
                .into_iter()
                .map(|p| (Uuid::now_v7(), p.nom, p.type_mime, p.contenu))
                .collect();
            if pieces.iter().map(|p| p.3.len()).sum::<usize>() > TAILLE_MAX_PIECES {
                return Err(ApiError::bad_request(
                    "Pièces jointes trop volumineuses : 25 Mio au plus par message",
                ));
            }
        }
    }
    let resume: Vec<PieceBrouillon> = pieces
        .iter()
        .map(|(id, nom, type_mime, contenu)| PieceBrouillon {
            id: *id,
            nom: nom.clone(),
            type_mime: type_mime.clone(),
            taille: i64::try_from(contenu.len()).unwrap_or(i64::MAX),
        })
        .collect();

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Création brouillon"))?;
    let insertion = sqlx::query_as::<_, LigneBrouillon>(concat!(
        "INSERT INTO brouillons_message (id, cabinet_id, auteur_id, compte_id, genre, \
         origine_message_id, dossier_id, a, cc, cci, objet, corps_html, corps, message_id, \
         en_reponse_a, references_texte, pieces_texte, expediteur) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) \
         ON CONFLICT (id) DO NOTHING RETURNING ",
        colonnes!()
    ))
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(compte_id)
    .bind(genre_texte)
    .bind(origine.as_ref().map(|(origine_id, _)| *origine_id))
    .bind(dossier_id)
    .bind(texte_depuis_liste(champs.a.as_deref().unwrap_or_default()))
    .bind(texte_depuis_liste(champs.cc.as_deref().unwrap_or_default()))
    .bind(texte_depuis_liste(
        champs.cci.as_deref().unwrap_or_default(),
    ))
    .bind(champs.objet.clone().unwrap_or_default())
    .bind(champs.corps_html.clone().unwrap_or_default())
    .bind(champs.corps.clone().unwrap_or_default())
    .bind(&message_id)
    .bind(&en_reponse_a)
    .bind(texte_depuis_liste(
        champs.references.as_deref().unwrap_or_default(),
    ))
    .bind(resume_json(&resume))
    .bind(&expediteur)
    .fetch_optional(&mut *tx)
    .await;
    let ligne = match insertion {
        Ok(Some(ligne)) => ligne,
        Ok(None) => return Ok(None),
        Err(err) if super::redaction::est_doublon(&err) => {
            return Err(ApiError::conflict("Identifiant de message déjà utilisé"));
        }
        Err(_) => return Err(ApiError::internal("Création brouillon")),
    };
    for (ordre, (piece_id, nom, type_mime, contenu)) in pieces.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO brouillons_message_pieces
                (id, brouillon_id, cabinet_id, ordre, nom, type_mime, taille, contenu)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(piece_id)
        .bind(id)
        .bind(claims.cabinet_id)
        .bind(i32::try_from(ordre + 1).unwrap_or(i32::MAX))
        .bind(nom)
        .bind(type_mime)
        .bind(i32::try_from(contenu.len()).unwrap_or(i32::MAX))
        .bind(contenu)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Enregistrement des pièces"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Création brouillon"))?;
    Ok(Some(ligne))
}

/// `None` : la ligne a disparu entre-temps (envoi ou suppression concurrents).
async fn mettre_a_jour(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
    champs: &Champs,
) -> Result<Option<(LigneBrouillon, bool)>, ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Écriture brouillon"))?;
    let Some(ligne) = sqlx::query_as::<_, LigneBrouillon>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM brouillons_message WHERE id = $1 FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Lecture brouillon"))?
    else {
        return Ok(None);
    };
    let ligne = doit_etre_a_lui(Some(ligne), claims)?;

    // Champs figés à la création.
    let fige = |message: &'static str| ApiError::bad_request(message);
    if champs.compte_id.is_some_and(|c| c != ligne.compte_id) {
        return Err(fige("Le compte d'un brouillon ne change pas"));
    }
    if champs
        .genre
        .is_some_and(|g| genre_vers_texte(g) != ligne.genre)
    {
        return Err(fige("Le genre d'un brouillon ne change pas"));
    }
    if champs
        .origine_message_id
        .is_some_and(|o| Some(o) != ligne.origine_message_id)
    {
        return Err(fige("Le message d'origine d'un brouillon ne change pas"));
    }
    if champs
        .message_id
        .as_ref()
        .is_some_and(|m| *m != ligne.message_id)
    {
        return Err(fige("L'identifiant de message est figé à la création"));
    }

    let mut nouvelle = ligne.clone();
    match champs.dossier_id {
        Some(Some(dossier_id)) if Some(dossier_id) != ligne.dossier_id => {
            if !dossier_visible(state, claims.cabinet_id, claims.sub, dossier_id).await? {
                return Err(ApiError::not_found("Dossier introuvable"));
            }
            nouvelle.dossier_id = Some(dossier_id);
        }
        Some(None) => nouvelle.dossier_id = None,
        _ => {}
    }
    if let Some(a) = &champs.a {
        nouvelle.a = texte_depuis_liste(a);
    }
    if let Some(cc) = &champs.cc {
        nouvelle.cc = texte_depuis_liste(cc);
    }
    if let Some(cci) = &champs.cci {
        nouvelle.cci = texte_depuis_liste(cci);
    }
    if let Some(objet) = &champs.objet {
        nouvelle.objet = objet.clone();
    }
    if let Some(html) = &champs.corps_html {
        nouvelle.corps_html = html.clone();
    }
    if let Some(corps) = &champs.corps {
        nouvelle.corps = corps.clone();
    }
    if let Some(fil) = &champs.en_reponse_a {
        nouvelle.en_reponse_a = fil.clone();
    }
    if let Some(references) = &champs.references {
        nouvelle.references_texte = texte_depuis_liste(references);
    }
    if nouvelle == ligne {
        // Rejeu à l'identique : rien n'est réécrit, la copie IMAP n'est pas relancée.
        return Ok(Some((ligne, false)));
    }
    let ecrite = sqlx::query_as::<_, LigneBrouillon>(concat!(
        "UPDATE brouillons_message SET dossier_id = $2, a = $3, cc = $4, cci = $5, objet = $6, \
         corps_html = $7, corps = $8, en_reponse_a = $9, references_texte = $10, \
         imap_etat = 'a_deposer', imap_maj_le = NOW(), revision = revision + 1, \
         modifie_le = NOW() WHERE id = $1 RETURNING ",
        colonnes!()
    ))
    .bind(id)
    .bind(nouvelle.dossier_id)
    .bind(&nouvelle.a)
    .bind(&nouvelle.cc)
    .bind(&nouvelle.cci)
    .bind(&nouvelle.objet)
    .bind(&nouvelle.corps_html)
    .bind(&nouvelle.corps)
    .bind(&nouvelle.en_reponse_a)
    .bind(&nouvelle.references_texte)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Écriture brouillon"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Écriture brouillon"))?;
    Ok(Some((ecrite, true)))
}

#[utoipa::path(
    get,
    path = "/messagerie/brouillons",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Brouillons de l'utilisateur, le plus récent d'abord", body = Vec<BrouillonResponse>))
)]
pub async fn lister_brouillons(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<BrouillonResponse>>, ApiError> {
    let lignes = sqlx::query_as::<_, LigneBrouillon>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM brouillons_message WHERE cabinet_id = $1 AND auteur_id = $2 \
         AND imap_etat <> 'a_retirer' ORDER BY modifie_le DESC"
    ))
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture brouillons"))?;
    Ok(Json(lignes.into_iter().map(vers_reponse).collect()))
}

#[utoipa::path(
    get,
    path = "/messagerie/brouillons/{id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Brouillon de l'utilisateur", body = BrouillonResponse),
        (status = 404, description = "Brouillon introuvable ou d'un autre auteur", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<BrouillonResponse>, ApiError> {
    let ligne = doit_etre_a_lui(lire_ligne(&state.pool, id).await?, &claims)?;
    Ok(Json(vers_reponse(ligne)))
}

#[utoipa::path(
    delete,
    path = "/messagerie/brouillons/{id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Brouillon supprimé, copie IMAP retirée (ou retrait repris plus tard si le serveur est injoignable)"),
        (status = 404, description = "Brouillon introuvable ou d'un autre auteur", body = crate::error::ApiErrorBody),
    )
)]
pub async fn supprimer_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Suppression brouillon"))?;
    verrouiller(&mut tx, id, &claims).await?;
    sqlx::query(
        r#"
        UPDATE brouillons_message
        SET imap_etat = 'a_retirer', imap_maj_le = NOW(), revision = revision + 1,
            modifie_le = NOW()
        WHERE id = $1
        "#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Suppression brouillon"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Suppression brouillon"))?;
    // La ligne est déjà masquée : si le serveur IMAP est injoignable, le balayage finit le travail.
    depot_de(&state).retirer(id).await;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// Pièces
// ---------------------------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/messagerie/brouillons/{id}/pieces",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body(content = Vec<u8>, content_type = "application/octet-stream", description = "Contenu brut de la pièce ; paramètres de requête : `nom` (obligatoire) et `piece_id` (optionnel, rend la requête rejouable) ; le type MIME est celui de l'en-tête Content-Type s'il est valable, sinon déduit du nom"),
    responses(
        (status = 200, description = "Brouillon avec la pièce ajoutée", body = BrouillonResponse),
        (status = 400, description = "Pièce vide, nom invalide ou 25 Mio cumulés dépassés", body = crate::error::ApiErrorBody),
        (status = 404, description = "Brouillon introuvable ou d'un autre auteur", body = crate::error::ApiErrorBody),
        (status = 413, description = "Corps de requête supérieur à la limite de la route", body = crate::error::ApiErrorBody),
    )
)]
pub async fn ajouter_piece(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
    Query(query): Query<PieceQuery>,
    en_tetes: HeaderMap,
    contenu: Bytes,
) -> Result<Json<BrouillonResponse>, ApiError> {
    let nom = nom_piece_valide(query.nom.as_deref().unwrap_or_default())?;
    if contenu.is_empty() {
        return Err(ApiError::bad_request("Pièce vide"));
    }
    let annonce = en_tetes
        .get(header::CONTENT_TYPE)
        .and_then(|valeur| valeur.to_str().ok());
    let type_mime = type_mime_piece(&nom, annonce);
    let taille = i64::try_from(contenu.len()).unwrap_or(i64::MAX);

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Ajout de pièce"))?;
    // Le verrou de la ligne sérialise les ajouts : la limite cumulée est tenue sans course.
    verrouiller(&mut tx, id, &claims).await?;
    if let Some(piece_id) = query.piece_id {
        let rejeu = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM brouillons_message_pieces WHERE id = $1 AND brouillon_id = $2",
        )
        .bind(piece_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Lecture pièces"))?;
        if rejeu.is_some() {
            drop(tx);
            return Ok(Json(relire(&state.pool, id).await?));
        }
    }
    let (cumul, dernier_ordre, nombre) = sqlx::query_as::<_, (i64, i32, i64)>(
        r#"
        SELECT COALESCE(SUM(taille), 0)::bigint, COALESCE(MAX(ordre), 0), COUNT(*)
        FROM brouillons_message_pieces WHERE brouillon_id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Lecture pièces"))?;
    if cumul.saturating_add(taille) > i64::try_from(TAILLE_MAX_PIECES).unwrap_or(i64::MAX) {
        return Err(ApiError::bad_request(
            "Pièces jointes trop volumineuses : 25 Mio au plus par message",
        ));
    }
    if nombre >= PIECES_MAX {
        return Err(ApiError::bad_request("Trop de pièces jointes"));
    }
    let insertion = sqlx::query(
        r#"
        INSERT INTO brouillons_message_pieces
            (id, brouillon_id, cabinet_id, ordre, nom, type_mime, taille, contenu)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(query.piece_id.unwrap_or_else(Uuid::now_v7))
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(dernier_ordre.saturating_add(1))
    .bind(&nom)
    .bind(&type_mime)
    .bind(i32::try_from(taille).unwrap_or(i32::MAX))
    .bind(contenu.as_ref())
    .execute(&mut *tx)
    .await;
    if let Err(err) = insertion {
        return Err(if super::redaction::est_doublon(&err) {
            ApiError::conflict("Identifiant de pièce déjà utilisé")
        } else {
            ApiError::internal("Enregistrement de la pièce")
        });
    }
    rafraichir_pieces(&mut tx, id).await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Ajout de pièce"))?;
    deposer_en_fond(&state, id);
    Ok(Json(relire(&state.pool, id).await?))
}

#[utoipa::path(
    delete,
    path = "/messagerie/brouillons/{id}/pieces/{piece_id}",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Brouillon sans la pièce", body = BrouillonResponse),
        (status = 404, description = "Brouillon ou pièce introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn retirer_piece(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path((id, piece_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<BrouillonResponse>, ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Retrait de pièce"))?;
    verrouiller(&mut tx, id, &claims).await?;
    let retiree =
        sqlx::query("DELETE FROM brouillons_message_pieces WHERE id = $1 AND brouillon_id = $2")
            .bind(piece_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("Retrait de pièce"))?
            .rows_affected();
    if retiree == 0 {
        return Err(ApiError::not_found("Pièce introuvable"));
    }
    rafraichir_pieces(&mut tx, id).await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Retrait de pièce"))?;
    deposer_en_fond(&state, id);
    Ok(Json(relire(&state.pool, id).await?))
}

// ---------------------------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------------------------

/// Envoie le brouillon : crée la ligne de la file d'envoi (identifiant = celui du brouillon,
/// donc rejouable sans doublon), lui copie les pièces, retire le brouillon et sa copie IMAP. La
/// mise en attente et le traitement continuent par les routes de la file d'envoi.
#[utoipa::path(
    post,
    path = "/messagerie/brouillons/{id}/envoyer",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Ligne de la file d'envoi (état brouillon), comme à la création d'un envoi", body = FileEnvoiResponse),
        (status = 400, description = "Aucun destinataire, adresses ou en-têtes invalides", body = crate::error::ApiErrorBody),
        (status = 404, description = "Brouillon introuvable ou d'un autre auteur", body = crate::error::ApiErrorBody),
        (status = 409, description = "Identifiant de message déjà utilisé", body = crate::error::ApiErrorBody),
    )
)]
pub async fn envoyer_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
) -> Result<Json<FileEnvoiResponse>, ApiError> {
    // Deux passages au plus : un envoi concurrent du même brouillon se règle au second.
    for _ in 0..2 {
        // Rejeu : la ligne de file existe déjà. On ne recrée rien ; on finit seulement le
        // nettoyage du brouillon si un premier appel s'est arrêté en route.
        if deja_envoye(&state.pool, id, &claims).await? {
            depot_de(&state).retirer(id).await;
            return charger_reponse(&state, &claims, id).await;
        }
        let ligne = doit_etre_a_lui(lire_ligne(&state.pool, id).await?, &claims)?;
        let a = liste_depuis_texte(&ligne.a);
        let cc = liste_depuis_texte(&ligne.cc);
        let cci = liste_depuis_texte(&ligne.cci);
        if a.is_empty() && cc.is_empty() && cci.is_empty() {
            return Err(ApiError::bad_request("Aucun destinataire"));
        }
        let en_reponse_a = ligne.en_reponse_a.clone().filter(|v| !v.trim().is_empty());
        if repond(&ligne.genre) && en_reponse_a.is_none() {
            return Err(ApiError::bad_request("Réponse sans message d'origine"));
        }
        if let Some(dossier_id) = ligne.dossier_id {
            if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
                return Err(ApiError::not_found("Dossier introuvable"));
            }
        }
        // Le message part du compte choisi à la rédaction : le droit d'écrire depuis ce compte
        // est revérifié ici (403 sinon), le `From` et le `Reply-To` sont ceux du compte.
        let compte_id = ligne.compte_id;
        let identite = identite_pour_utilisateur(&state, &claims, compte_id).await?;
        // Construction à blanc : adresses, en-têtes et fil validés avant tout effet.
        let essai = ContenuEnvoi {
            message_id: ligne.message_id.clone(),
            a: a.clone(),
            cc: cc.clone(),
            cci: cci.clone(),
            objet: ligne.objet.clone(),
            corps: ligne.corps.clone(),
            corps_html: ligne.corps_html.clone(),
            en_reponse_a: en_reponse_a.clone(),
            references: liste_depuis_texte(&ligne.references_texte),
            pieces: Vec::new(),
            repondre_a: identite.repondre_a.clone(),
        };
        sortant_depuis_contenu(&identite.de, &essai).map_err(|_| {
            ApiError::bad_request("Message invalide : destinataires, adresses ou en-têtes")
        })?;

        let mut tx = state
            .pool
            .begin()
            .await
            .map_err(|_| ApiError::internal("Envoi du brouillon"))?;
        // Si un autre appel a retiré le brouillon entre-temps, le second passage voit la file.
        let verrouille = match verrouiller(&mut tx, id, &claims).await {
            Ok(ligne) => ligne,
            Err(err) if err.status() == StatusCode::NOT_FOUND => continue,
            Err(err) => return Err(err),
        };
        let insertion = sqlx::query(
            r#"
            INSERT INTO file_envoi (
                id, cabinet_id, compte_id, dossier_id, message_id,
                destinataire, cc, cci, objet, corps, corps_html,
                genre, origine_message_id, en_reponse_a, references_texte,
                auteur_id, etat, tentatives
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'brouillon',0)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(claims.cabinet_id)
        .bind(compte_id)
        .bind(verrouille.dossier_id)
        .bind(&verrouille.message_id)
        .bind(texte_depuis_liste(&a))
        .bind(texte_depuis_liste(&cc))
        .bind(texte_depuis_liste(&cci))
        .bind(&verrouille.objet)
        .bind(&verrouille.corps)
        .bind(&verrouille.corps_html)
        .bind(&verrouille.genre)
        .bind(verrouille.origine_message_id)
        .bind(&en_reponse_a)
        .bind(&verrouille.references_texte)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await;
        match insertion {
            Ok(resultat) if resultat.rows_affected() == 1 => {}
            Ok(_) => return Err(ApiError::conflict("Identifiant de brouillon déjà utilisé")),
            Err(err) if super::redaction::est_doublon(&err) => {
                return Err(ApiError::conflict("Identifiant de message déjà utilisé"));
            }
            Err(_) => return Err(ApiError::internal("Envoi du brouillon")),
        }
        // Les pièces passent d'une table à l'autre dans la base, sans transiter par l'API.
        sqlx::query(
            r#"
            INSERT INTO file_envoi_pieces (id, envoi_id, ordre, nom, type_mime, contenu)
            SELECT gen_random_uuid(), $1, ordre - 1, nom, type_mime, contenu
            FROM brouillons_message_pieces WHERE brouillon_id = $1 ORDER BY ordre
            "#,
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Copie des pièces"))?;
        sqlx::query("DELETE FROM brouillons_message_pieces WHERE brouillon_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("Retrait des pièces"))?;
        sqlx::query(
            r#"
            UPDATE brouillons_message
            SET imap_etat = 'a_retirer', imap_maj_le = NOW(), pieces_texte = '[]',
                revision = revision + 1, modifie_le = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Envoi du brouillon"))?;
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Envoi du brouillon"))?;
        // L'envoi est enregistré : un échec du retrait de la copie IMAP ne le remet pas en cause,
        // le balayage le reprend.
        depot_de(&state).retirer(id).await;
        return charger_reponse(&state, &claims, id).await;
    }
    Err(ApiError::conflict("Brouillon envoyé simultanément"))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    fn requete(json: serde_json::Value) -> EcrireBrouillonRequest {
        serde_json::from_value(json).expect("requête")
    }

    #[test]
    fn dossier_absent_nul_ou_donne_se_distinguent() {
        let id = Uuid::now_v7();
        assert!(requete(serde_json::json!({})).dossier_id.is_none());
        assert_eq!(
            requete(serde_json::json!({"dossier_id": null})).dossier_id,
            Some(None)
        );
        assert_eq!(
            requete(serde_json::json!({"dossier_id": id})).dossier_id,
            Some(Some(id))
        );
    }

    #[test]
    fn les_retours_a_la_ligne_sont_refuses_jamais_retires() {
        for (nom, json) in [
            (
                "objet",
                serde_json::json!({"objet": "Note\r\nBcc: p@example.com"}),
            ),
            (
                "adresse a",
                serde_json::json!({"a": ["x@example.com\nBcc: p@example.com"]}),
            ),
            ("adresse cc", serde_json::json!({"cc": ["x@example.com\r"]})),
            (
                "adresse cci",
                serde_json::json!({"cci": ["\tx@example.com"]}),
            ),
            (
                "fil",
                serde_json::json!({"en_reponse_a": "<x@example.com>\r\nBcc: p@example.com"}),
            ),
            (
                "référence",
                serde_json::json!({"references": ["<x@example.com>\nX: y"]}),
            ),
            (
                "identifiant",
                serde_json::json!({"message_id": "<x@example.com>\r\n"}),
            ),
        ] {
            assert!(Champs::depuis(requete(json)).is_err(), "{nom} accepté");
        }
        // Contrôle positif : les mêmes champs sans retour à la ligne passent.
        let ok = Champs::depuis(requete(serde_json::json!({
            "objet": "Note", "a": ["x@example.com"], "cc": ["y@example.com"],
            "en_reponse_a": "<x@example.com>", "references": ["<w@example.com>"],
            "message_id": "x-1@cabinet.example"
        })))
        .expect("champs sains");
        assert_eq!(ok.message_id.as_deref(), Some("<x-1@cabinet.example>"));
    }

    #[test]
    fn le_html_est_nettoye_et_le_texte_suit_le_html() {
        let champs = Champs::depuis(requete(serde_json::json!({
            "corps_html": "<p>Bonjour</p><script>alert(1)</script>"
        })))
        .expect("champs");
        let html = champs.corps_html.expect("html");
        assert!(html.contains("Bonjour") && !html.contains("script"));
        assert_eq!(champs.corps.as_deref(), Some("Bonjour"));
        // Un texte fourni l'emporte sur le texte tiré du HTML.
        let champs = Champs::depuis(requete(serde_json::json!({
            "corps_html": "<p>Bonjour</p>", "corps": "Texte choisi"
        })))
        .expect("champs");
        assert_eq!(champs.corps.as_deref(), Some("Texte choisi"));
        // Rien envoyé : rien n'est touché.
        let champs = Champs::depuis(requete(serde_json::json!({}))).expect("champs");
        assert!(champs.corps.is_none() && champs.corps_html.is_none());
    }

    #[test]
    fn limites_de_taille_et_genre_inconnu() {
        assert!(Champs::depuis(requete(serde_json::json!({"genre": "repondre"}))).is_err());
        let long = "x".repeat(OBJET_MAX + 1);
        assert!(Champs::depuis(requete(serde_json::json!({"objet": long}))).is_err());
        let enorme = "x".repeat(HTML_MAX + 1);
        assert!(Champs::depuis(requete(serde_json::json!({"corps_html": enorme}))).is_err());
        let adresses: Vec<String> = (0..=ADRESSES_MAX)
            .map(|i| format!("a{i}@example.com"))
            .collect();
        assert!(Champs::depuis(requete(serde_json::json!({"a": adresses}))).is_err());
        assert!(Champs::depuis(requete(serde_json::json!({"message_id": "a b"}))).is_err());
    }

    #[test]
    fn nom_de_piece_sans_separateur_ni_caractere_de_controle() {
        assert_eq!(
            nom_piece_valide("  Convocation.pdf ").expect("nom"),
            "Convocation.pdf"
        );
        for mauvais in ["", "   ", "../secret.txt", "a\\b.txt", "a\r\nb.txt", "x\0y"] {
            assert!(nom_piece_valide(mauvais).is_err(), "{mauvais:?} accepté");
        }
    }

    #[test]
    fn le_resume_des_pieces_fait_l_aller_retour() {
        let pieces = vec![PieceBrouillon {
            id: Uuid::now_v7(),
            nom: "a.pdf".to_owned(),
            type_mime: "application/pdf".to_owned(),
            taille: 12,
        }];
        let relu = pieces_depuis_json(&resume_json(&pieces));
        assert_eq!(relu.len(), 1);
        assert_eq!(relu[0].nom, "a.pdf");
        assert!(pieces_depuis_json("pas du json").is_empty());
        assert_eq!(resume_json(&[]), "[]");
    }
}
