//! Contacts du cabinet et dossiers liés (§ 4.2 n° 1 et 2).

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::conflits::{
    appliquer_champ_texte, cle_idempotence, noter_historique, reserver_idempotence,
    valider_base_revision, ContexteChamp,
};
use crate::error::ApiError;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;

const NATURES: &[&str] = &["physique", "morale"];
const TYPES_CLIENT: &[&str] = &["professionnel", "particulier", "etranger"];

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerContactRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub nature: String,
    pub nom: String,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: String,
    pub email: Option<String>,
    pub civilite: Option<String>,
    pub accord: Option<String>,
    pub prenoms: Option<String>,
    pub nom_naissance: Option<String>,
    pub date_naissance: Option<String>,
    pub lieu_naissance: Option<String>,
    pub nationalite: Option<String>,
    pub profession: Option<String>,
    pub forme: Option<String>,
    pub capital_centimes: Option<i64>,
    pub monnaie: Option<String>,
    pub greffe_rcs: Option<String>,
    pub activite: Option<String>,
    pub profession_reglementee: Option<String>,
    pub barreau: Option<String>,
    pub toque: Option<String>,
    pub specialite: Option<String>,
    pub cour_appel: Option<String>,
    pub situation_familiale: Option<String>,
    /// Vrai quand la fiche est créée à partir d'une proposition de registre retenue.
    #[serde(default)]
    pub depuis_registre: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContactResponse {
    pub id: Uuid,
    pub nature: String,
    pub nom: String,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: String,
    pub revision: i64,
    pub civilite: Option<String>,
    pub accord: Option<String>,
    pub prenoms: Option<String>,
    pub nom_naissance: Option<String>,
    pub date_naissance: Option<String>,
    pub lieu_naissance: Option<String>,
    pub nationalite: Option<String>,
    pub profession: Option<String>,
    pub forme: Option<String>,
    pub capital_centimes: Option<i64>,
    pub monnaie: Option<String>,
    pub greffe_rcs: Option<String>,
    pub activite: Option<String>,
    pub profession_reglementee: Option<String>,
    pub barreau: Option<String>,
    pub toque: Option<String>,
    pub specialite: Option<String>,
    pub cour_appel: Option<String>,
    pub situation_familiale: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchContactRequest {
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    pub siren: Option<String>,
    pub numero_tva: Option<String>,
    pub type_client: Option<String>,
    pub civilite: Option<String>,
    pub accord: Option<String>,
    pub prenoms: Option<String>,
    pub nom_naissance: Option<String>,
    pub date_naissance: Option<String>,
    pub lieu_naissance: Option<String>,
    pub nationalite: Option<String>,
    pub profession: Option<String>,
    pub forme: Option<String>,
    pub capital_centimes: Option<i64>,
    pub monnaie: Option<String>,
    pub greffe_rcs: Option<String>,
    pub activite: Option<String>,
    pub profession_reglementee: Option<String>,
    pub barreau: Option<String>,
    pub toque: Option<String>,
    pub specialite: Option<String>,
    pub cour_appel: Option<String>,
    pub situation_familiale: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerCoordonneeRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub genre: String,
    pub usage: String,
    pub valeur: String,
    pub principale: bool,
    pub pays: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerLienContactRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub contact_cible_id: Uuid,
    pub type_lien: String,
    pub fonction: Option<String>,
    pub libelle: Option<String>,
    pub represente_societe: bool,
    pub pour_le_compte_de: Option<Uuid>,
    pub debut: Option<String>,
    pub fin: Option<String>,
    pub source: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LienContactResponse {
    pub id: Uuid,
    pub contact_source_id: Uuid,
    pub contact_cible_id: Uuid,
    pub revision: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CoordonneeResponse {
    pub id: Uuid,
    pub contact_id: Uuid,
    pub genre: String,
    pub usage: String,
    pub valeur: String,
    pub principale: bool,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerIntervenantRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub contact_id: Uuid,
    pub qualite_id: Uuid,
    pub rattache_a: Option<Uuid>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IntervenantResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub contact_id: Uuid,
    pub qualite_id: Uuid,
    pub rattache_a: Option<Uuid>,
    pub revision: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LierDossiersRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub lie_a_id: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LienResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub lie_a_id: Uuid,
    pub id_inverse: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HistoriqueLigne {
    pub champ: String,
    pub valeur_remplacee: Option<String>,
    pub valeur_appliquee: String,
    pub cree_le: String,
}

#[utoipa::path(
    post,
    path = "/contacts",
    tag = "contacts",
    security(("bearer_auth" = [])),
    request_body = CreerContactRequest,
    responses(
        (status = 200, description = "Contact créé ou déjà présent", body = ContactResponse),
        (status = 400, description = "Requête invalide (nom, nature, type de client, SIREN ou TVA)", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerContactRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = body.nom.trim();
    if nom.is_empty() {
        return Err(ApiError::bad_request("Nom de contact requis"));
    }
    if !NATURES.contains(&body.nature.as_str()) {
        return Err(ApiError::bad_request("Nature de contact inconnue"));
    }
    if !TYPES_CLIENT.contains(&body.type_client.as_str()) {
        return Err(ApiError::bad_request("type_client inconnu"));
    }
    crate::identifiants::verifier_siren_tva(body.siren.as_deref(), body.numero_tva.as_deref())?;
    controler_fiche(
        body.civilite.as_deref(),
        body.accord.as_deref(),
        body.date_naissance.as_deref(),
        body.profession_reglementee.as_deref(),
        body.capital_centimes,
        body.situation_familiale.as_deref(),
    )?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_contact(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    sqlx::query(
        r#"
        INSERT INTO contacts (
            id, cabinet_id, nature, nom, siren, numero_tva, type_client, email,
            civilite, accord, prenoms, nom_naissance, date_naissance, lieu_naissance,
            nationalite, profession, forme, capital_centimes, monnaie, greffe_rcs, activite,
            profession_reglementee, barreau, toque, specialite, cour_appel, situation_familiale, revision
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21,
            $22, $23, $24, $25, $26, $27, 1
        )
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&body.nature)
    .bind(nom)
    .bind(
        body.siren
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        body.numero_tva
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(&body.type_client)
    .bind(
        body.email
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase()),
    )
    .bind(texte_option(&body.civilite))
    .bind(texte_option(&body.accord))
    .bind(texte_option(&body.prenoms))
    .bind(texte_option(&body.nom_naissance))
    .bind(texte_option(&body.date_naissance))
    .bind(texte_option(&body.lieu_naissance))
    .bind(texte_option(&body.nationalite))
    .bind(texte_option(&body.profession))
    .bind(texte_option(&body.forme))
    .bind(body.capital_centimes)
    .bind(texte_option(&body.monnaie))
    .bind(texte_option(&body.greffe_rcs))
    .bind(texte_option(&body.activite))
    .bind(texte_option(&body.profession_reglementee))
    .bind(texte_option(&body.barreau))
    .bind(texte_option(&body.toque))
    .bind(texte_option(&body.specialite))
    .bind(texte_option(&body.cour_appel))
    .bind(texte_option(&body.situation_familiale))
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création contact"))?;
    if body.depuis_registre {
        crate::recherche_entreprises::poser_marque(&mut tx, body.id).await?;
    }
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "contacts",
            dossier_id: None,
        },
        "nature",
        &body.nature,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_contact(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

#[utoipa::path(
    patch,
    path = "/contacts/{contact_id}",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Identifiant du contact")),
    request_body = PatchContactRequest,
    responses(
        (status = 200, description = "Contact mis à jour", body = ContactResponse),
        (status = 400, description = "Requête invalide (clé d'idempotence, version de base, type de client, SIREN ou TVA)", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchContactRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if let Some(ref t) = body.type_client {
        if !TYPES_CLIENT.contains(&t.as_str()) {
            return Err(ApiError::bad_request("type_client inconnu"));
        }
    }
    controler_fiche(
        body.civilite.as_deref(),
        body.accord.as_deref(),
        body.date_naissance.as_deref(),
        body.profession_reglementee.as_deref(),
        body.capital_centimes,
        body.situation_familiale.as_deref(),
    )?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_contact(&state, claims.cabinet_id, contact_id)
            .await
            .map(Json);
    }
    let courant = sqlx::query_as::<_, (String, Option<String>, Option<String>, String, i64)>(
        "SELECT nom, siren, numero_tva, type_client, revision FROM contacts WHERE id = $1 AND cabinet_id = $2 FOR UPDATE",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_optional(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    valider_base_revision(body.base_revision, courant.4)?;
    let mut revision = courant.4;
    let contexte = ContexteChamp {
        cabinet_id: claims.cabinet_id,
        poste_id: claims.poste_id,
        auteur_id: claims.sub,
        base_revision: body.base_revision,
        enregistrement_id: contact_id,
        table_cible: "contacts",
        dossier_id: None,
    };
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "nom",
        body.nom.as_deref(),
        &courant.0,
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "siren",
        body.siren.as_deref(),
        courant.1.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "numero_tva",
        body.numero_tva.as_deref(),
        courant.2.as_deref().unwrap_or(""),
        &mut revision,
    )
    .await?;
    appliquer_champ_texte(
        &mut tx,
        &contexte,
        "type_client",
        body.type_client.as_deref(),
        &courant.3,
        &mut revision,
    )
    .await?;
    let fiche = lire_fiche(&mut tx, contact_id).await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "civilite",
        body.civilite.as_deref(),
        fiche.civilite.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "accord",
        body.accord.as_deref(),
        fiche.accord.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "prenoms",
        body.prenoms.as_deref(),
        fiche.prenoms.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "nom_naissance",
        body.nom_naissance.as_deref(),
        fiche.nom_naissance.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "date_naissance",
        body.date_naissance.as_deref(),
        fiche.date_naissance.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "lieu_naissance",
        body.lieu_naissance.as_deref(),
        fiche.lieu_naissance.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "nationalite",
        body.nationalite.as_deref(),
        fiche.nationalite.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "profession",
        body.profession.as_deref(),
        fiche.profession.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "situation_familiale",
        body.situation_familiale.as_deref(),
        fiche.situation_familiale.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "forme",
        body.forme.as_deref(),
        fiche.forme.as_deref(),
        &mut revision,
    )
    .await?;
    if let Some(centimes) = body.capital_centimes {
        crate::conflits::appliquer_champ_i64(
            &mut tx,
            &contexte,
            "capital_centimes",
            Some(centimes),
            fiche.capital_centimes.unwrap_or(-1),
            &mut revision,
        )
        .await?;
    }
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "monnaie",
        body.monnaie.as_deref(),
        fiche.monnaie.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "greffe_rcs",
        body.greffe_rcs.as_deref(),
        fiche.greffe_rcs.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "activite",
        body.activite.as_deref(),
        fiche.activite.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "profession_reglementee",
        body.profession_reglementee.as_deref(),
        fiche.profession_reglementee.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "barreau",
        body.barreau.as_deref(),
        fiche.barreau.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "toque",
        body.toque.as_deref(),
        fiche.toque.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "specialite",
        body.specialite.as_deref(),
        fiche.specialite.as_deref(),
        &mut revision,
    )
    .await?;
    appliquer_texte_fiche(
        &mut tx,
        &contexte,
        "cour_appel",
        body.cour_appel.as_deref(),
        fiche.cour_appel.as_deref(),
        &mut revision,
    )
    .await?;
    let nom_f = body.nom.as_deref().unwrap_or(&courant.0);
    let siren_f = body.siren.as_deref().or(courant.1.as_deref());
    let tva_f = body.numero_tva.as_deref().or(courant.2.as_deref());
    if body.siren.is_some() || body.numero_tva.is_some() {
        crate::identifiants::verifier_siren_tva(siren_f, tva_f)?;
    }
    let type_f = body.type_client.as_deref().unwrap_or(&courant.3);
    if revision != courant.4 {
        sqlx::query(
            r#"
            UPDATE contacts SET
                nom = $1, siren = $2, numero_tva = $3, type_client = $4, revision = $5,
                civilite = $6, accord = $7, prenoms = $8, nom_naissance = $9, date_naissance = $10,
                lieu_naissance = $11, nationalite = $12, profession = $13, forme = $14,
                capital_centimes = $15, monnaie = $16, greffe_rcs = $17, activite = $18,
                profession_reglementee = $19, barreau = $20, toque = $21, specialite = $22, cour_appel = $23
            WHERE id = $24
            "#,
        )
        .bind(nom_f)
        .bind(siren_f.filter(|s| !s.is_empty()))
        .bind(tva_f.filter(|s| !s.is_empty()))
        .bind(type_f)
        .bind(revision)
        .bind(texte_final(body.civilite.as_deref(), fiche.civilite))
        .bind(texte_final(body.accord.as_deref(), fiche.accord))
        .bind(texte_final(body.prenoms.as_deref(), fiche.prenoms))
        .bind(texte_final(body.nom_naissance.as_deref(), fiche.nom_naissance))
        .bind(texte_final(body.date_naissance.as_deref(), fiche.date_naissance))
        .bind(texte_final(body.lieu_naissance.as_deref(), fiche.lieu_naissance))
        .bind(texte_final(body.nationalite.as_deref(), fiche.nationalite))
        .bind(texte_final(body.profession.as_deref(), fiche.profession))
        .bind(texte_final(body.forme.as_deref(), fiche.forme))
        .bind(body.capital_centimes.or(fiche.capital_centimes))
        .bind(texte_final(body.monnaie.as_deref(), fiche.monnaie))
        .bind(texte_final(body.greffe_rcs.as_deref(), fiche.greffe_rcs))
        .bind(texte_final(body.activite.as_deref(), fiche.activite))
        .bind(texte_final(body.profession_reglementee.as_deref(), fiche.profession_reglementee))
        .bind(texte_final(body.barreau.as_deref(), fiche.barreau))
        .bind(texte_final(body.toque.as_deref(), fiche.toque))
        .bind(texte_final(body.specialite.as_deref(), fiche.specialite))
        .bind(texte_final(body.cour_appel.as_deref(), fiche.cour_appel))
        .bind(contact_id)
        .execute(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
        .await
        .map_err(|_| ApiError::internal("mise à jour contact"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_contact(&state, claims.cabinet_id, contact_id)
        .await
        .map(Json)
}

#[utoipa::path(
    get,
    path = "/contacts/{contact_id}/historique",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Identifiant du contact")),
    responses(
        (status = 200, description = "Historique des modifications du contact et de ses parties, du plus ancien au plus récent", body = Vec<HistoriqueLigne>),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn historique_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
) -> Result<Json<Vec<HistoriqueLigne>>, ApiError> {
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !existe {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let rows = sqlx::query_as::<_, (String, Option<String>, String, String)>(
        r#"
        SELECT champ, valeur_remplacee, valeur_appliquee, cree_le::text
        FROM journal_modifications
        WHERE cabinet_id = $1
          AND (
            (table_cible = 'contacts' AND enregistrement_id = $2)
            OR (
              table_cible = 'parties'
              AND enregistrement_id IN (SELECT id FROM parties WHERE contact_id = $2)
            )
          )
        ORDER BY cree_le ASC
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(contact_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("historique"))?;
    Ok(Json(
        rows.into_iter()
            .map(|row| HistoriqueLigne {
                champ: row.0,
                valeur_remplacee: row.1,
                valeur_appliquee: row.2,
                cree_le: row.3,
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/dossiers/{dossier_id}/liens",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("dossier_id" = Uuid, Path, description = "Identifiant du dossier à lier")),
    request_body = LierDossiersRequest,
    responses(
        (status = 200, description = "Lien créé dans les deux sens, ou déjà présent", body = LienResponse),
        (status = 400, description = "Requête invalide (clé d'idempotence, dossier lié à lui-même)", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier introuvable ou hors de vos droits", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lier_dossiers(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<LierDossiersRequest>,
) -> Result<Json<LienResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if dossier_id == body.lie_a_id {
        return Err(ApiError::bad_request("Un dossier ne se lie pas à lui-même"));
    }
    if !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, dossier_id).await?
        || !dossier_visible(state.as_ref(), claims.cabinet_id, claims.sub, body.lie_a_id).await?
    {
        return Err(ApiError::not_found("Dossier introuvable"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        let inverse = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM dossier_liens WHERE dossier_id = $1 AND lie_a_id = $2",
        )
        .bind(body.lie_a_id)
        .bind(dossier_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lien de dossiers"))?;
        return Ok(Json(LienResponse {
            id: body.id,
            dossier_id,
            lie_a_id: body.lie_a_id,
            id_inverse: inverse.unwrap_or(body.id),
        }));
    }
    let id_inverse = Uuid::now_v7();
    inserer_lien(
        &mut tx,
        claims.cabinet_id,
        body.id,
        dossier_id,
        body.lie_a_id,
    )
    .await?;
    inserer_lien(
        &mut tx,
        claims.cabinet_id,
        id_inverse,
        body.lie_a_id,
        dossier_id,
    )
    .await?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "dossier_liens",
            dossier_id: Some(dossier_id),
        },
        "lie_a_id",
        &body.lie_a_id.to_string(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(LienResponse {
        id: body.id,
        dossier_id,
        lie_a_id: body.lie_a_id,
        id_inverse,
    }))
}

async fn inserer_lien(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    id: Uuid,
    dossier_id: Uuid,
    lie_a_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO dossier_liens (
            id, cabinet_id, dossier_id, lie_a_id, revision, visibilite, restreint, lie_restreint
        )
        SELECT $1, $2, $3, $4, 1,
            CASE WHEN a.visibilite = 'restreint' OR b.visibilite = 'restreint' THEN 'restreint' ELSE 'public' END,
            (a.visibilite = 'restreint' OR b.visibilite = 'restreint'),
            (b.visibilite = 'restreint')
        FROM dossiers a, dossiers b
        WHERE a.id = $3 AND b.id = $4 AND a.cabinet_id = $2 AND b.cabinet_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM dossier_liens AS deja
            WHERE deja.dossier_id = $3 AND deja.lie_a_id = $4
          )
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .bind(dossier_id)
    .bind(lie_a_id)
    .execute(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
    .await
    .map_err(|_| ApiError::internal("lien de dossiers"))?;
    Ok(())
}

#[utoipa::path(
    get,
    path = "/contacts/recherche-siren/{siren}",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("siren" = String, Path, description = "SIREN à proposer depuis le registre public")),
    responses(
        (status = 200, description = "Proposition, non appliquée à la fiche", body = crate::recherche_entreprises::PropositionSiren),
        (status = 400, description = "SIREN invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "SIREN inconnu du registre", body = crate::error::ApiErrorBody),
        (status = 503, description = "Registre indisponible", body = crate::error::ApiErrorBody),
    )
)]
pub async fn rechercher_siren(
    AuthAccess(_claims): AuthAccess,
    axum::extract::Path(siren): axum::extract::Path<String>,
) -> Result<Json<crate::recherche_entreprises::PropositionSiren>, ApiError> {
    let maintenant = time::OffsetDateTime::now_utc();
    crate::recherche_entreprises::resoudre(
        crate::recherche_entreprises::cache_partage(),
        &siren,
        maintenant,
        |normalise| async move { crate::recherche_entreprises::interroger_http(&normalise).await },
    )
    .await
    .map(Json)
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AppliquerImportRequest {
    pub idempotence_cle: String,
    pub denomination: Option<String>,
    pub forme: Option<String>,
    pub activite: Option<String>,
    pub adresse_siege: Option<String>,
    pub adresse_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportEnregistre {
    pub source_import: String,
    pub importe_le: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DoublonResponse {
    pub id: Uuid,
    pub nom: String,
    pub motif: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct FusionRequest {
    pub idempotence_cle: String,
    pub absorbee_id: Uuid,
    pub champs_absorbes: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetirerContactRequest {
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RetraitContactResponse {
    pub effet: String,
}

#[utoipa::path(
    post,
    path = "/contacts/{contact_id}/import-siren",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Fiche à mettre à jour")),
    request_body = AppliquerImportRequest,
    responses(
        (status = 200, description = "Champs retenus enregistrés, source et date consignées", body = ImportEnregistre),
        (status = 400, description = "Aucun champ retenu", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn appliquer_import_siren(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<AppliquerImportRequest>,
) -> Result<Json<ImportEnregistre>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let (champs, adresse_id) = crate::recherche_entreprises::retenir_champs(
        body.denomination,
        body.forme,
        body.activite,
        body.adresse_siege,
        body.adresse_id,
    )?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_import(&state, claims.cabinet_id, contact_id)
            .await
            .map(Json);
    }
    crate::recherche_entreprises::enregistrer_import(
        &mut tx,
        claims.cabinet_id,
        contact_id,
        adresse_id,
        &champs,
    )
    .await?;
    if let Some(denomination) = champs.denomination.as_deref() {
        noter_historique(
            &mut tx,
            &ContexteChamp {
                cabinet_id: claims.cabinet_id,
                poste_id: claims.poste_id,
                auteur_id: claims.sub,
                base_revision: 1,
                enregistrement_id: contact_id,
                table_cible: "contacts",
                dossier_id: None,
            },
            "nom",
            denomination,
        )
        .await?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_import(&state, claims.cabinet_id, contact_id)
        .await
        .map(Json)
}

async fn lire_import(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<ImportEnregistre, ApiError> {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT source_import, importe_le::text FROM contacts WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture import"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    let source = row
        .0
        .ok_or_else(|| ApiError::not_found("Import introuvable"))?;
    let importe = row
        .1
        .ok_or_else(|| ApiError::not_found("Import introuvable"))?;
    Ok(ImportEnregistre {
        source_import: source,
        importe_le: importe,
    })
}

#[utoipa::path(
    post,
    path = "/contacts/{contact_id}/coordonnees",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Identifiant du contact")),
    request_body = CreerCoordonneeRequest,
    responses(
        (status = 200, description = "Coordonnée créée ou déjà présente", body = CoordonneeResponse),
        (status = 400, description = "Requête invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_coordonnee(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerCoordonneeRequest>,
) -> Result<Json<CoordonneeResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let valeur = body.valeur.trim();
    if valeur.is_empty() {
        return Err(ApiError::bad_request("Coordonnée requise"));
    }
    crate::fiche_contact::valider_genre_coordonnee(&body.genre)?;
    crate::fiche_contact::valider_usage_coordonnee(&body.usage)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !existe {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_coordonnee(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    if body.principale {
        sqlx::query(
            r#"
            UPDATE contact_coordonnees
            SET principale = FALSE, revision = revision + 1
            WHERE contact_id = $1 AND cabinet_id = $2 AND genre = $3 AND principale
            "#,
        )
        .bind(contact_id)
        .bind(claims.cabinet_id)
        .bind(&body.genre)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("coordonnée principale"))?;
    }
    sqlx::query(
        r#"
        INSERT INTO contact_coordonnees (
            id, cabinet_id, contact_id, genre, usage, valeur, principale, pays, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(contact_id)
    .bind(&body.genre)
    .bind(&body.usage)
    .bind(valeur)
    .bind(body.principale)
    .bind(texte_option(&body.pays))
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création coordonnée"))?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "contact_coordonnees",
            dossier_id: None,
        },
        "valeur",
        valeur,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_coordonnee(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

async fn lire_coordonnee(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<CoordonneeResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, bool, i64)>(
        r#"
        SELECT contact_id, genre, usage, valeur, principale, revision
        FROM contact_coordonnees WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture coordonnée"))?
    .ok_or_else(|| ApiError::not_found("Coordonnée introuvable"))?;
    Ok(CoordonneeResponse {
        id,
        contact_id: row.0,
        genre: row.1,
        usage: row.2,
        valeur: row.3,
        principale: row.4,
        revision: row.5,
    })
}

#[utoipa::path(
    post,
    path = "/contacts/{contact_id}/liens",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Contact source du lien")),
    request_body = CreerLienContactRequest,
    responses(
        (status = 200, description = "Lien créé ou déjà présent", body = LienContactResponse),
        (status = 400, description = "Lien refusé", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_lien(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerLienContactRequest>,
) -> Result<Json<LienContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.contact_cible_id == contact_id {
        return Err(ApiError::bad_request("Un contact ne se lie pas à lui-même"));
    }
    let fonction = texte_option(&body.fonction);
    let libelle = texte_option(&body.libelle);
    let debut = texte_option(&body.debut);
    let fin = texte_option(&body.fin);
    crate::fiche_contact::valider_lien(
        &body.type_lien,
        fonction.as_deref(),
        libelle.as_deref(),
        debut.as_deref(),
        fin.as_deref(),
        body.represente_societe,
    )?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let source_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !source_ok {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let nature_cible = sqlx::query_scalar::<_, String>(
        "SELECT nature FROM contacts WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(body.contact_cible_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    let Some(nature_cible) = nature_cible else {
        return Err(ApiError::not_found("Contact introuvable"));
    };
    if body.type_lien == "mandat_social" && nature_cible != "morale" {
        return Err(ApiError::bad_request(
            "Un mandat social vise une personne morale",
        ));
    }
    if let Some(compte) = body.pour_le_compte_de {
        let ok = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
        )
        .bind(compte)
        .bind(claims.cabinet_id)
        .fetch_one(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("lecture contact"))?;
        if !ok {
            return Err(ApiError::not_found("Le mandant est introuvable"));
        }
    }
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_lien(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    if body.represente_societe {
        let deja = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM contact_liens
                WHERE contact_cible_id = $1 AND fonction = $2
                  AND represente_societe AND fin IS NULL AND type_lien = 'mandat_social'
            )
            "#,
        )
        .bind(body.contact_cible_id)
        .bind(fonction.as_deref())
        .fetch_one(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::internal("lecture lien"))?;
        if deja {
            return Err(ApiError::bad_request(
                "Un mandat en cours représente déjà la société pour cette fonction",
            ));
        }
    }
    sqlx::query(
        r#"
        INSERT INTO contact_liens (
            id, cabinet_id, contact_source_id, contact_cible_id, type_lien, fonction, libelle,
            represente_societe, pour_le_compte_de, debut, fin, source, note, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(contact_id)
    .bind(body.contact_cible_id)
    .bind(&body.type_lien)
    .bind(fonction.as_deref())
    .bind(libelle.as_deref())
    .bind(body.represente_societe)
    .bind(body.pour_le_compte_de)
    .bind(debut.as_deref())
    .bind(fin.as_deref())
    .bind(texte_option(&body.source))
    .bind(texte_option(&body.note))
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("création lien"))?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "contact_liens",
            dossier_id: None,
        },
        "type_lien",
        &body.type_lien,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_lien(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

async fn lire_lien(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<LienContactResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, i64)>(
        r#"
        SELECT contact_source_id, contact_cible_id, revision
        FROM contact_liens WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture lien"))?
    .ok_or_else(|| ApiError::not_found("Lien introuvable"))?;
    Ok(LienContactResponse {
        id,
        contact_source_id: row.0,
        contact_cible_id: row.1,
        revision: row.2,
    })
}

#[utoipa::path(
    post,
    path = "/dossiers/{dossier_id}/intervenants",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("dossier_id" = Uuid, Path, description = "Identifiant du dossier")),
    request_body = CreerIntervenantRequest,
    responses(
        (status = 200, description = "Intervenant créé ou déjà présent", body = IntervenantResponse),
        (status = 400, description = "Rattachement refusé", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier, contact ou qualité introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_intervenant(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerIntervenantRequest>,
) -> Result<Json<IntervenantResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.rattache_a == Some(body.id) {
        return Err(ApiError::bad_request(
            "Un intervenant ne se rattache pas à lui-même",
        ));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let dossier = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dossiers WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(dossier_id)
    .bind(claims.cabinet_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture dossier"))?;
    if !dossier {
        return Err(ApiError::not_found("Dossier introuvable"));
    }
    let contact = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2)",
    )
    .bind(body.contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !contact {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let qualite = sqlx::query_as::<_, (bool, bool)>(
        "SELECT admet_rattachement, archivee FROM qualites WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(body.qualite_id)
    .bind(claims.cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture qualité"))?;
    let Some((admet, archivee)) = qualite else {
        return Err(ApiError::not_found("Qualité introuvable"));
    };
    if archivee {
        return Err(ApiError::bad_request("Qualité archivée"));
    }
    if let Some(cible) = body.rattache_a {
        let meme = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM dossier_intervenants WHERE id = $1 AND dossier_id = $2 AND cabinet_id = $3)",
        )
        .bind(cible)
        .bind(dossier_id)
        .bind(claims.cabinet_id)
        .fetch_one(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
        .await
        .map_err(|_| ApiError::internal("lecture intervenant"))?;
        crate::fiche_contact::controler_rattachement(false, meme, admet)?;
    }
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_intervenant(&state, claims.cabinet_id, body.id)
            .await
            .map(Json);
    }
    sqlx::query(
        r#"
        INSERT INTO dossier_intervenants (
            id, cabinet_id, dossier_id, contact_id, qualite_id, rattache_a, note, visibilite, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'public', 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(dossier_id)
    .bind(body.contact_id)
    .bind(body.qualite_id)
    .bind(body.rattache_a)
    .bind(texte_option(&body.note))
    .execute(tx.acquire().await.map_err(|_| ApiError::internal("Transaction"))?)
    .await
    .map_err(|_| ApiError::internal("création intervenant"))?;
    noter_historique(
        &mut tx,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: body.id,
            table_cible: "dossier_intervenants",
            dossier_id: Some(dossier_id),
        },
        "qualite_id",
        &body.qualite_id.to_string(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_intervenant(&state, claims.cabinet_id, body.id)
        .await
        .map(Json)
}

async fn lire_intervenant(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<IntervenantResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, Uuid, Option<Uuid>, i64)>(
        r#"
        SELECT dossier_id, contact_id, qualite_id, rattache_a, revision
        FROM dossier_intervenants WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture intervenant"))?
    .ok_or_else(|| ApiError::not_found("Intervenant introuvable"))?;
    Ok(IntervenantResponse {
        id,
        dossier_id: row.0,
        contact_id: row.1,
        qualite_id: row.2,
        rattache_a: row.3,
        revision: row.4,
    })
}

async fn lire_contact(
    state: &AppState,
    cabinet_id: Uuid,
    contact_id: Uuid,
) -> Result<ContactResponse, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT nature, nom, siren, numero_tva, type_client, revision,
            civilite, accord, prenoms, nom_naissance, date_naissance, lieu_naissance,
            nationalite, profession, forme, capital_centimes, monnaie, greffe_rcs, activite,
            profession_reglementee, barreau, toque, specialite, cour_appel, situation_familiale
        FROM contacts WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(contact_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    let texte = |nom: &str| -> Result<Option<String>, ApiError> {
        row.try_get(nom)
            .map_err(|_| ApiError::internal("lecture contact"))
    };
    Ok(ContactResponse {
        id: contact_id,
        nature: texte("nature")?.unwrap_or_default(),
        nom: texte("nom")?.unwrap_or_default(),
        siren: texte("siren")?,
        numero_tva: texte("numero_tva")?,
        type_client: texte("type_client")?.unwrap_or_default(),
        revision: row
            .try_get("revision")
            .map_err(|_| ApiError::internal("lecture contact"))?,
        civilite: texte("civilite")?,
        accord: texte("accord")?,
        prenoms: texte("prenoms")?,
        nom_naissance: texte("nom_naissance")?,
        date_naissance: texte("date_naissance")?,
        lieu_naissance: texte("lieu_naissance")?,
        nationalite: texte("nationalite")?,
        profession: texte("profession")?,
        forme: texte("forme")?,
        capital_centimes: row
            .try_get("capital_centimes")
            .map_err(|_| ApiError::internal("lecture contact"))?,
        monnaie: texte("monnaie")?,
        greffe_rcs: texte("greffe_rcs")?,
        activite: texte("activite")?,
        profession_reglementee: texte("profession_reglementee")?,
        barreau: texte("barreau")?,
        toque: texte("toque")?,
        specialite: texte("specialite")?,
        cour_appel: texte("cour_appel")?,
        situation_familiale: texte("situation_familiale")?,
    })
}

struct FicheLue {
    civilite: Option<String>,
    accord: Option<String>,
    prenoms: Option<String>,
    nom_naissance: Option<String>,
    date_naissance: Option<String>,
    lieu_naissance: Option<String>,
    nationalite: Option<String>,
    profession: Option<String>,
    forme: Option<String>,
    capital_centimes: Option<i64>,
    monnaie: Option<String>,
    greffe_rcs: Option<String>,
    activite: Option<String>,
    profession_reglementee: Option<String>,
    barreau: Option<String>,
    toque: Option<String>,
    specialite: Option<String>,
    cour_appel: Option<String>,
    situation_familiale: Option<String>,
}

async fn lire_fiche(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contact_id: Uuid,
) -> Result<FicheLue, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT civilite, accord, prenoms, nom_naissance, date_naissance, lieu_naissance,
            nationalite, profession, forme, capital_centimes, monnaie, greffe_rcs, activite,
            profession_reglementee, barreau, toque, specialite, cour_appel, situation_familiale
        FROM contacts WHERE id = $1
        "#,
    )
    .bind(contact_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?
    .ok_or_else(|| ApiError::not_found("Contact introuvable"))?;
    let texte = |nom: &str| -> Result<Option<String>, ApiError> {
        row.try_get(nom)
            .map_err(|_| ApiError::internal("lecture contact"))
    };
    Ok(FicheLue {
        civilite: texte("civilite")?,
        accord: texte("accord")?,
        prenoms: texte("prenoms")?,
        nom_naissance: texte("nom_naissance")?,
        date_naissance: texte("date_naissance")?,
        lieu_naissance: texte("lieu_naissance")?,
        nationalite: texte("nationalite")?,
        profession: texte("profession")?,
        forme: texte("forme")?,
        capital_centimes: row
            .try_get("capital_centimes")
            .map_err(|_| ApiError::internal("lecture contact"))?,
        monnaie: texte("monnaie")?,
        greffe_rcs: texte("greffe_rcs")?,
        activite: texte("activite")?,
        profession_reglementee: texte("profession_reglementee")?,
        barreau: texte("barreau")?,
        toque: texte("toque")?,
        specialite: texte("specialite")?,
        cour_appel: texte("cour_appel")?,
        situation_familiale: texte("situation_familiale")?,
    })
}

#[utoipa::path(
    get,
    path = "/contacts/{contact_id}/doublons",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Fiche de référence")),
    responses(
        (status = 200, description = "Doublons du même cabinet", body = Vec<DoublonResponse>),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn doublons_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
) -> Result<Json<Vec<DoublonResponse>>, ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1 AND cabinet_id = $2 AND NOT archivee)",
    )
    .bind(contact_id)
    .bind(claims.cabinet_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture contact"))?;
    if !existe {
        return Err(ApiError::not_found("Contact introuvable"));
    }
    let doublons =
        crate::fusion_contacts::chercher_doublons(&mut tx, claims.cabinet_id, contact_id).await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(
        doublons
            .into_iter()
            .map(|doublon| DoublonResponse {
                id: doublon.id,
                nom: doublon.nom,
                motif: doublon.motif,
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/contacts/{contact_id}/fusion",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Fiche conservée")),
    request_body = FusionRequest,
    responses(
        (status = 200, description = "Fusion faite, ou déjà faite", body = ContactResponse),
        (status = 400, description = "Fusion refusée", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn fusionner_contact(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<FusionRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_contact(&state, claims.cabinet_id, contact_id)
            .await
            .map(Json);
    }
    crate::fusion_contacts::fusionner(
        &mut tx,
        claims.cabinet_id,
        contact_id,
        body.absorbee_id,
        &body.champs_absorbes,
        Some(&ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: contact_id,
            table_cible: "contacts",
            dossier_id: None,
        }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_contact(&state, claims.cabinet_id, contact_id)
        .await
        .map(Json)
}

#[utoipa::path(
    delete,
    path = "/contacts/{contact_id}",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("contact_id" = Uuid, Path, description = "Fiche à retirer")),
    request_body = RetirerContactRequest,
    responses(
        (status = 200, description = "Archivée si elle est liée, supprimée sinon", body = RetraitContactResponse),
        (status = 400, description = "Clé d'idempotence manquante", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Contact introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn retirer_fiche(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(contact_id): axum::extract::Path<Uuid>,
    Json(body): Json<RetirerContactRequest>,
) -> Result<Json<RetraitContactResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        let existe = sqlx::query_scalar::<_, bool>(
            "SELECT archivee FROM contacts WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(contact_id)
        .bind(claims.cabinet_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture contact"))?;
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        let effet = match existe {
            None => "supprime",
            Some(true) => "archive",
            Some(false) => "archive",
        };
        return Ok(Json(RetraitContactResponse {
            effet: effet.into(),
        }));
    }
    let effet = crate::fusion_contacts::retirer_contact(
        &mut tx,
        claims.cabinet_id,
        contact_id,
        &ContexteChamp {
            cabinet_id: claims.cabinet_id,
            poste_id: claims.poste_id,
            auteur_id: claims.sub,
            base_revision: 1,
            enregistrement_id: contact_id,
            table_cible: "contacts",
            dossier_id: None,
        },
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let libelle = match effet {
        crate::fusion_contacts::EffetRetrait::Archive => "archive",
        crate::fusion_contacts::EffetRetrait::Supprime => "supprime",
    };
    Ok(Json(RetraitContactResponse {
        effet: libelle.into(),
    }))
}

fn texte_option(valeur: &Option<String>) -> Option<String> {
    valeur
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn texte_final(nouveau: Option<&str>, actuel: Option<String>) -> Option<String> {
    match nouveau {
        Some(valeur) => {
            let net = valeur.trim();
            if net.is_empty() {
                None
            } else {
                Some(net.to_string())
            }
        }
        None => actuel,
    }
}

fn controler_fiche(
    civilite: Option<&str>,
    accord: Option<&str>,
    date_naissance: Option<&str>,
    profession: Option<&str>,
    capital: Option<i64>,
    situation_familiale: Option<&str>,
) -> Result<(), ApiError> {
    if let Some(valeur) = civilite.map(str::trim).filter(|s| !s.is_empty()) {
        crate::fiche_contact::valider_civilite(valeur)?;
    }
    if let Some(valeur) = accord.map(str::trim).filter(|s| !s.is_empty()) {
        crate::fiche_contact::valider_accord(valeur)?;
    }
    if let Some(valeur) = date_naissance.map(str::trim).filter(|s| !s.is_empty()) {
        crate::fiche_contact::valider_date_naissance(valeur)?;
    }
    if let Some(valeur) = profession.map(str::trim).filter(|s| !s.is_empty()) {
        crate::fiche_contact::valider_profession_reglementee(valeur)?;
    }
    if let Some(centimes) = capital {
        crate::fiche_contact::valider_capital(centimes)?;
    }
    if let Some(valeur) = situation_familiale.map(str::trim).filter(|s| !s.is_empty()) {
        crate::fiche_contact::valider_situation_familiale(valeur)?;
    }
    Ok(())
}

async fn appliquer_texte_fiche(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    contexte: &ContexteChamp,
    champ: &str,
    nouveau: Option<&str>,
    actuel: Option<&str>,
    revision: &mut i64,
) -> Result<(), ApiError> {
    let net = nouveau.map(str::trim).filter(|s| !s.is_empty());
    appliquer_champ_texte(
        tx,
        contexte,
        champ,
        net.or(if nouveau.is_some() { Some("") } else { None }),
        actuel.unwrap_or(""),
        revision,
    )
    .await
}
