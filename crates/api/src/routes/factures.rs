use std::sync::Arc;

use axum::http::header::{HeaderName, HeaderValue, CONTENT_TYPE};
use axum::response::IntoResponse;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::facturation::{cii_en16931, tva_centimes, FactureCii};
use crate::pdf_facturx;
use crate::plateforme::{
    DepotFacture, EncaissementPa, ErreurPlateforme, HttpPlateformeAgreee, PlateformeAgreee,
};
use crate::routes::dossiers::exiger_visible_pour;
use crate::routes::temps::exiger_dossier_existant;
use crate::state::AppState;

fn err_pa(err: ErreurPlateforme) -> ApiError {
    match err {
        ErreurPlateforme::Absente => ApiError::internal("plateforme absente"),
        ErreurPlateforme::Indisponible => ApiError::internal("plateforme indisponible"),
        ErreurPlateforme::Refusee => ApiError::bad_request("plateforme a refusé l'opération"),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LigneFacture {
    pub libelle: String,
    pub nature: String,
    pub montant_ht_centimes: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerFactureRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub taux_tva_bp: i32,
    pub lignes: Vec<LigneFacture>,
    /// professionnel (dépôt PA), particulier ou etranger (e-reporting). Défaut : professionnel.
    #[serde(default = "type_client_defaut")]
    pub type_client: String,
}

fn type_client_defaut() -> String {
    "professionnel".to_owned()
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FactureResponse {
    pub id: Uuid,
    pub statut: String,
    pub numero: Option<i64>,
    pub montant_ht_centimes: i64,
    pub montant_tva_centimes: i64,
    pub montant_ttc_centimes: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EmettreRequest {
    pub cle_idempotence: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EncaisserRequest {
    pub montant_centimes: i64,
    pub cle_idempotence: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AvoirRequest {
    pub id: Uuid,
}

/// Contenu binaire d'un PDF (PDF/A-3b Factur-X), pour la description du contrat.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
#[allow(dead_code)]
pub struct PdfFacturX(Vec<u8>);

#[utoipa::path(
    post,
    path = "/factures",
    tag = "factures",
    security(("bearer_auth" = [])),
    request_body = CreerFactureRequest,
    responses(
        (status = 200, description = "Brouillon de facture créé, ou déjà présent (rejeu du même identifiant) ; aucun numéro tant qu'il n'est pas validé", body = FactureResponse),
        (status = 400, description = "Type de client inconnu, lignes ou taux de TVA invalides, nature de ligne inconnue", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Dossier introuvable, d'un autre cabinet ou restreint hors accès (même réponse), ou identifiant déjà pris par une facture que l'utilisateur ne doit pas voir", body = crate::error::ApiErrorBody),
        (status = 500, description = "Erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerFactureRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    // La validation ne crée jamais de dossier : refus si absent.
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
    if !matches!(
        body.type_client.as_str(),
        "professionnel" | "particulier" | "etranger"
    ) {
        return Err(ApiError::bad_request("type_client inconnu"));
    }
    let montants = montants(&body.lignes, body.taux_tva_bp)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    sqlx::query(
        r#"
        INSERT INTO factures (
            id, cabinet_id, dossier_id, type, statut, montant_ht_centimes,
            montant_tva_centimes, montant_ttc_centimes, taux_tva_bp, type_client
        ) VALUES ($1, $2, $3, 'facture', 'brouillon', $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.dossier_id)
    .bind(montants.0)
    .bind(montants.1)
    .bind(montants.2)
    .bind(body.taux_tva_bp)
    .bind(&body.type_client)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("brouillon"))?;
    // `ON CONFLICT DO NOTHING` laisse en place la facture qui porte déjà cet identifiant : elle n'est rendue que si
    // elle est à ce cabinet et dans le dossier demandé (déjà contrôlé visible). Sinon l'identifiant est celui d'une
    // facture que l'utilisateur ne doit pas voir : 404, sans montants (transaction abandonnée).
    let existante = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT cabinet_id, dossier_id FROM factures WHERE id = $1",
    )
    .bind(body.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture brouillon"))?
    .ok_or_else(|| ApiError::internal("brouillon absent après insertion"))?;
    if existante.0 != claims.cabinet_id || existante.1 != body.dossier_id {
        return Err(ApiError::not_found("Facture introuvable"));
    }
    if sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM facture_lignes WHERE facture_id = $1")
        .bind(body.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lignes"))?
        .0
        > 0
    {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit"))?;
        return charger(&state, claims.cabinet_id, body.id).await.map(Json);
    }
    for ligne in &body.lignes {
        sqlx::query(
            "INSERT INTO facture_lignes (id, facture_id, libelle, nature, montant_ht_centimes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(body.id)
        .bind(ligne.libelle.trim())
        .bind(&ligne.nature)
        .bind(ligne.montant_ht_centimes)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("ligne"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("validation brouillon"))?;
    charger(&state, claims.cabinet_id, body.id).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/factures/{id}/valider",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture")),
    responses(
        (status = 200, description = "Facture validée : numéro définitif attribué par le serveur, PDF Factur-X et CII figés ; rejeu sans effet sur une facture déjà validée", body = FactureResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture introuvable, d'un autre cabinet ou d'un dossier restreint hors accès (même réponse)", body = crate::error::ApiErrorBody),
        (status = 500, description = "Erreur interne (numérotation, génération du PDF Factur-X)", body = crate::error::ApiErrorBody),
    )
)]
pub async fn valider(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<FactureResponse>, ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    let actuelle = sqlx::query_as::<_, (String, Option<i64>, Uuid)>(
        "SELECT statut, numero, dossier_id FROM factures WHERE id = $1 AND cabinet_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .ok_or_else(|| ApiError::not_found("Facture introuvable"))?;
    // Facture d'un dossier restreint hors `dossier_acces` : même réponse qu'une facture absente.
    exiger_visible_pour(
        &state,
        claims.cabinet_id,
        claims.sub,
        actuelle.2,
        "Facture introuvable",
    )
    .await?;
    if actuelle.0 == "validee" {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit"))?;
        assurer_artefacts(&state, claims.cabinet_id, claims.sub, id).await?;
        return charger(&state, claims.cabinet_id, id).await.map(Json);
    }
    let numero = sqlx::query_as::<_, (i64,)>(
        r#"
        INSERT INTO sequences_factures (cabinet_id, prochain) VALUES ($1, 2)
        ON CONFLICT (cabinet_id) DO UPDATE
            SET prochain = sequences_factures.prochain + 1
        RETURNING prochain - 1
        "#,
    )
    .bind(claims.cabinet_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("numéro"))?
    .0;
    sqlx::query("UPDATE factures SET statut = 'validee', numero = $2 WHERE id = $1 AND statut = 'brouillon'")
        .bind(id)
        .bind(numero)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("validation"))?;
    // Numéro attribué uniquement à la validation ; copie sur le brouillon synchronisé.
    sqlx::query("UPDATE brouillons_facture SET numero = $2 WHERE id = $1 AND numero IS NULL")
        .bind(id)
        .bind(numero)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("numéro brouillon"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("commit validation"))?;
    // PDF + Factur-X figés après attribution du numéro (cahier § 3.7).
    assurer_artefacts(&state, claims.cabinet_id, claims.sub, id).await?;
    charger(&state, claims.cabinet_id, id).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/factures/{id}/emettre",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture validée")),
    request_body = EmettreRequest,
    responses(
        (status = 200, description = "Facture transmise à la plateforme agréée (dépôt, ou e-reporting pour un particulier ou un client étranger) ; rejeu avec la même clé d'idempotence sans nouvel envoi", body = FactureResponse),
        (status = 400, description = "Clé d'idempotence trop courte (moins de 8 caractères), opération refusée par la plateforme", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture introuvable, d'un autre cabinet ou d'un dossier restreint hors accès (même réponse)", body = crate::error::ApiErrorBody),
        (status = 409, description = "Facture visible mais pas encore validée", body = crate::error::ApiErrorBody),
        (status = 500, description = "Plateforme absente ou indisponible, erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn emettre(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<EmettreRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let facture = facture_validee(&state, claims.cabinet_id, claims.sub, id).await?;
    let cle = body.cle_idempotence.trim();
    if cle.len() < 8 {
        return Err(ApiError::bad_request("Clé d'idempotence trop courte"));
    }
    let deja = sqlx::query_as::<_, (String,)>(
        "SELECT identifiant_pa FROM envois_plateforme WHERE cle_idempotence = $1",
    )
    .bind(cle)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture envoi"))?;
    if deja.is_some() {
        return charger(&state, claims.cabinet_id, id).await.map(Json);
    }
    let pa = HttpPlateformeAgreee::depuis_env().map_err(err_pa)?;
    let identifiant = match facture.type_client.as_str() {
        "particulier" | "etranger" => {
            pa.e_reporter(
                cle,
                serde_json::json!({
                    "reference": id.to_string(),
                    "numero": facture.numero,
                    "montant_ttc_centimes": facture.montant_ttc_centimes,
                    "type_client": facture.type_client,
                }),
            )
            .await
            .map_err(err_pa)?;
            format!("e-reporting-{id}")
        }
        _ => {
            let resultat = pa
                .deposer(
                    cle,
                    DepotFacture {
                        reference: id.to_string(),
                        numero: facture.numero,
                        montant_ttc_centimes: facture.montant_ttc_centimes,
                    },
                )
                .await
                .map_err(err_pa)?;
            resultat.id
        }
    };
    sqlx::query(
        "INSERT INTO envois_plateforme (cle_idempotence, facture_id, identifiant_pa) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(cle)
    .bind(id)
    .bind(identifiant)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("journal d'envoi"))?;
    charger(&state, claims.cabinet_id, id).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/factures/{id}/encaissements",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture validée")),
    request_body = EncaisserRequest,
    responses(
        (status = 200, description = "Règlement enregistré (montant en centimes) et statut « encaissée » transmis à la plateforme agréée ; idempotent par clé", body = FactureResponse),
        (status = 400, description = "Montant nul ou négatif, clé d'idempotence trop courte (moins de 8 caractères), opération refusée par la plateforme", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture introuvable, d'un autre cabinet ou d'un dossier restreint hors accès (même réponse)", body = crate::error::ApiErrorBody),
        (status = 409, description = "Facture visible mais pas encore validée", body = crate::error::ApiErrorBody),
        (status = 500, description = "Plateforme absente ou indisponible, erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn encaisser(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<EncaisserRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let facture = facture_validee(&state, claims.cabinet_id, claims.sub, id).await?;
    if body.montant_centimes <= 0 {
        return Err(ApiError::bad_request("Montant nul"));
    }
    let cle = body.cle_idempotence.trim();
    if cle.len() < 8 {
        return Err(ApiError::bad_request("Clé d'idempotence trop courte"));
    }
    sqlx::query(
        "INSERT INTO facture_encaissements (id, facture_id, montant_centimes, cle_idempotence) VALUES ($1, $2, $3, $4) ON CONFLICT (cle_idempotence) DO NOTHING",
    )
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(body.montant_centimes)
    .bind(cle)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("encaissement"))?;
    let pa = HttpPlateformeAgreee::depuis_env().map_err(err_pa)?;
    pa.envoyer_encaissement(
        cle,
        EncaissementPa {
            reference: id.to_string(),
            montant_centimes: body.montant_centimes,
            taux_tva_bp: facture.taux_tva_bp,
            montant_ttc_centimes: facture.montant_ttc_centimes,
        },
    )
    .await
    .map_err(err_pa)?;
    charger(&state, claims.cabinet_id, id).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/factures/{id}/avoir",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture d'origine, validée")),
    request_body = AvoirRequest,
    responses(
        (status = 200, description = "Avoir créé et validé (nouveau numéro, mêmes montants que la facture d'origine) ; rejeu avec le même identifiant d'avoir sans effet", body = FactureResponse),
        (status = 400, description = "Un avoir ne corrige qu'une facture (la source est déjà un avoir)", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture d'origine introuvable, d'un autre cabinet ou d'un dossier restreint hors accès ; ou identifiant d'avoir déjà pris par une autre facture, un autre avoir ou un autre cabinet (même réponse)", body = crate::error::ApiErrorBody),
        (status = 409, description = "Facture d'origine visible mais pas encore validée", body = crate::error::ApiErrorBody),
        (status = 500, description = "Erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn avoir(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(origine): axum::extract::Path<Uuid>,
    Json(body): Json<AvoirRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let source = facture_validee(&state, claims.cabinet_id, claims.sub, origine).await?;
    if source.type_document != "facture" {
        return Err(ApiError::bad_request("Un avoir ne corrige qu'une facture"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    // Rejeux concurrents du même avoir : sérialisés, le second voit le premier.
    crate::verrous::verrouiller_uuid(&mut tx, body.id)
        .await
        .map_err(|_| ApiError::internal("verrou avoir"))?;
    let deja = sqlx::query_as::<_, (Uuid, String, Option<Uuid>)>(
        "SELECT cabinet_id, type, facture_origine_id FROM factures WHERE id = $1",
    )
    .bind(body.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture avoir"))?;
    if let Some((cabinet_id, type_document, origine_existante)) = deja {
        // Un identifiant déjà pris par une autre facture, un autre avoir ou un autre cabinet n'est pas à rendre.
        if cabinet_id != claims.cabinet_id
            || type_document != "avoir"
            || origine_existante != Some(origine)
        {
            return Err(ApiError::not_found("Facture introuvable"));
        }
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit"))?;
        assurer_artefacts(&state, claims.cabinet_id, claims.sub, body.id).await?;
        return charger(&state, claims.cabinet_id, body.id).await.map(Json);
    }
    // Brouillon d'abord : le déclencheur d'immutabilité refuse les lignes si déjà validée.
    sqlx::query(
        r#"
        INSERT INTO factures (
            id, cabinet_id, dossier_id, type, statut, facture_origine_id,
            montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp, type_client
        ) VALUES ($1, $2, $3, 'avoir', 'brouillon', $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(source.dossier_id)
    .bind(origine)
    .bind(source.montant_ht_centimes)
    .bind(source.montant_tva_centimes)
    .bind(source.montant_ttc_centimes)
    .bind(source.taux_tva_bp)
    .bind(&source.type_client)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("création avoir"))?;
    let lignes = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT libelle, nature, montant_ht_centimes FROM facture_lignes WHERE facture_id = $1 ORDER BY id",
    )
    .bind(origine)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lignes source"))?;
    for (libelle, nature, montant) in lignes {
        // Logique avoir existante : mêmes montants, type document 381 (CII) ; pas d'invention fiscale.
        sqlx::query(
            "INSERT INTO facture_lignes (id, facture_id, libelle, nature, montant_ht_centimes) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::now_v7())
        .bind(body.id)
        .bind(libelle)
        .bind(nature)
        .bind(montant)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("ligne avoir"))?;
    }
    let numero = sqlx::query_as::<_, (i64,)>(
        r#"
        INSERT INTO sequences_factures (cabinet_id, prochain) VALUES ($1, 2)
        ON CONFLICT (cabinet_id) DO UPDATE
            SET prochain = sequences_factures.prochain + 1
        RETURNING prochain - 1
        "#,
    )
    .bind(claims.cabinet_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("numéro avoir"))?
    .0;
    sqlx::query(
        "UPDATE factures SET statut = 'validee', numero = $2 WHERE id = $1 AND statut = 'brouillon'",
    )
    .bind(body.id)
    .bind(numero)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("validation avoir"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("commit avoir"))?;
    assurer_artefacts(&state, claims.cabinet_id, claims.sub, body.id).await?;
    charger(&state, claims.cabinet_id, body.id).await.map(Json)
}

struct FactureLue {
    dossier_id: Uuid,
    type_document: String,
    type_client: String,
    numero: Option<i64>,
    montant_ht_centimes: i64,
    montant_tva_centimes: i64,
    montant_ttc_centimes: i64,
    taux_tva_bp: i32,
}

/// Facture validée du cabinet, dans un dossier que l'utilisateur voit. Absente, d'un autre cabinet ou d'un dossier
/// restreint hors `dossier_acces` : un seul 404 « Facture introuvable ». Visible mais pas encore validée : 409.
async fn facture_validee(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    id: Uuid,
) -> Result<FactureLue, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, Option<i64>, i64, i64, i64, i32)>(
        "SELECT dossier_id, type, type_client, statut, numero, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp FROM factures WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .ok_or_else(|| ApiError::not_found("Facture introuvable"))?;
    exiger_visible_pour(
        state,
        cabinet_id,
        utilisateur_id,
        row.0,
        "Facture introuvable",
    )
    .await?;
    if row.3 != "validee" {
        return Err(ApiError::conflict("Facture non validée"));
    }
    Ok(FactureLue {
        dossier_id: row.0,
        type_document: row.1,
        type_client: row.2,
        numero: row.4,
        montant_ht_centimes: row.5,
        montant_tva_centimes: row.6,
        montant_ttc_centimes: row.7,
        taux_tva_bp: row.8,
    })
}

#[utoipa::path(
    get,
    path = "/factures/{id}/cii",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture validée")),
    responses(
        (status = 200, description = "XML CII profil EN 16931 de la facture (le même que celui joint au PDF Factur-X)", body = String, content_type = "application/xml"),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture introuvable, d'un autre cabinet ou d'un dossier restreint hors accès (même réponse)", body = crate::error::ApiErrorBody),
        (status = 409, description = "Facture visible mais pas encore validée", body = crate::error::ApiErrorBody),
        (status = 500, description = "Artefact absent ou erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_cii(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<axum::response::Response, ApiError> {
    let _facture = facture_validee(&state, claims.cabinet_id, claims.sub, id).await?;
    assurer_artefacts(&state, claims.cabinet_id, claims.sub, id).await?;
    let xml = sqlx::query_as::<_, (String,)>(
        "SELECT cii_xml FROM facture_artefacts WHERE facture_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture CII"))?
    .map(|row| row.0)
    .ok_or_else(|| ApiError::internal("artefact CII absent"))?;
    Ok(([(CONTENT_TYPE, "application/xml; charset=utf-8")], xml).into_response())
}

#[utoipa::path(
    get,
    path = "/factures/{id}/pdf",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la facture validée")),
    responses(
        (status = 200, description = "PDF/A-3b Factur-X de la facture, servi en pièce jointe (facture.pdf)", body = PdfFacturX, content_type = "application/pdf"),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 404, description = "Facture introuvable, d'un autre cabinet ou d'un dossier restreint hors accès (même réponse)", body = crate::error::ApiErrorBody),
        (status = 409, description = "Facture visible mais pas encore validée", body = crate::error::ApiErrorBody),
        (status = 500, description = "Artefact absent ou erreur interne", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lire_pdf(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<axum::response::Response, ApiError> {
    let _facture = facture_validee(&state, claims.cabinet_id, claims.sub, id).await?;
    assurer_artefacts(&state, claims.cabinet_id, claims.sub, id).await?;
    let pdf = sqlx::query_as::<_, (Vec<u8>,)>(
        "SELECT pdf_octets FROM facture_artefacts WHERE facture_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture PDF"))?
    .map(|row| row.0)
    .ok_or_else(|| ApiError::internal("artefact PDF absent"))?;
    let mut reponse = pdf.into_response();
    reponse
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/pdf"));
    reponse.headers_mut().insert(
        HeaderName::from_static("content-disposition"),
        HeaderValue::from_static("attachment; filename=\"facture.pdf\""),
    );
    Ok(reponse)
}

#[utoipa::path(
    get,
    path = "/annuaire/{siren}",
    tag = "factures",
    security(("bearer_auth" = [])),
    params(("siren" = String, Path, description = "Numéro SIREN à interroger dans l'annuaire de la plateforme agréée")),
    responses(
        (status = 200, description = "Fiche d'annuaire renvoyée par la plateforme agréée (objet JSON)", body = Object),
        (status = 400, description = "La plateforme agréée a refusé la requête", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 500, description = "Plateforme agréée absente ou indisponible", body = crate::error::ApiErrorBody),
    )
)]
pub async fn annuaire(
    AuthAccess(_claims): AuthAccess,
    axum::extract::Path(siren): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let pa = HttpPlateformeAgreee::depuis_env().map_err(err_pa)?;
    let fiche = pa.interroger_annuaire(siren.trim()).await.map_err(err_pa)?;
    Ok(Json(fiche))
}

/// Construit le CII à partir des lignes et encaissements réels (pas de zéros forcés).
async fn construire_cii(
    state: &AppState,
    id: Uuid,
    facture: &FactureLue,
) -> Result<String, ApiError> {
    let libelle = sqlx::query_as::<_, (String,)>(
        "SELECT libelle FROM facture_lignes WHERE facture_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("ligne"))?
    .map(|row| row.0)
    .unwrap_or_else(|| "Honoraires".to_owned());
    let debours = sqlx::query_as::<_, (i64,)>(
        "SELECT COALESCE(SUM(montant_ht_centimes), 0)::bigint FROM facture_lignes WHERE facture_id = $1 AND nature = 'debours'",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("débours"))?
    .0;
    let deja_paye = sqlx::query_as::<_, (i64,)>(
        "SELECT COALESCE(SUM(montant_centimes), 0)::bigint FROM facture_encaissements WHERE facture_id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("déjà payé"))?
    .0;
    let ht_taxable = facture.montant_ht_centimes - debours;
    let acheteur_tva = match facture.type_client.as_str() {
        "professionnel" => Some("FR32876543210"),
        _ => None,
    };
    let aujourd_hui = time::OffsetDateTime::now_utc().date();
    let date = format!(
        "{:04}{:02}{:02}",
        aujourd_hui.year(),
        aujourd_hui.month() as u8,
        aujourd_hui.day()
    );
    Ok(cii_en16931(&FactureCii {
        numero: facture.numero.unwrap_or(0),
        avoir: facture.type_document == "avoir",
        acompte: false,
        date_aaaammjj: &date,
        libelle: &libelle,
        ht_centimes: ht_taxable,
        tva_centimes: facture.montant_tva_centimes,
        ttc_centimes: facture.montant_ttc_centimes,
        taux_bp: facture.taux_tva_bp,
        acheteur_tva,
        debours_centimes: debours,
        deja_paye_centimes: deja_paye,
    }))
}

async fn assurer_artefacts(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    id: Uuid,
) -> Result<(), ApiError> {
    let existe =
        sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM facture_artefacts WHERE facture_id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| ApiError::internal("lecture artefacts"))?
            .0;
    if existe > 0 {
        return Ok(());
    }
    let facture = facture_validee(state, cabinet_id, utilisateur_id, id).await?;
    let xml = construire_cii(state, id, &facture).await?;
    let numero = facture.numero.unwrap_or(0);
    let libelle = sqlx::query_as::<_, (String,)>(
        "SELECT libelle FROM facture_lignes WHERE facture_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("ligne"))?
    .map(|row| row.0)
    .unwrap_or_else(|| "Honoraires".to_owned());
    let ht = facture.montant_ht_centimes;
    let tva = facture.montant_tva_centimes;
    let ttc = facture.montant_ttc_centimes;
    let xml_clone = xml.clone();
    let pdf = tokio::task::spawn_blocking(move || {
        pdf_facturx::generer_pdf_a3b(&pdf_facturx::DonneesPdf {
            cii_xml: &xml_clone,
            numero,
            libelle: &libelle,
            ht_centimes: ht,
            tva_centimes: tva,
            ttc_centimes: ttc,
        })
    })
    .await
    .map_err(|_| ApiError::internal("tâche PDF"))?
    .map_err(|err| ApiError::internal(format!("PDF Factur-X : {err}")))?;
    sqlx::query(
        "INSERT INTO facture_artefacts (facture_id, cii_xml, pdf_octets) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(xml)
    .bind(pdf)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("stockage artefacts"))?;
    Ok(())
}

fn montants(lignes: &[LigneFacture], taux_bp: i32) -> Result<(i64, i64, i64), ApiError> {
    if lignes.is_empty() || !(0..=10_000).contains(&taux_bp) {
        return Err(ApiError::bad_request("Lignes ou taux invalides"));
    }
    let mut ht = 0_i64;
    let mut taxable = 0_i64;
    for ligne in lignes {
        if ligne.montant_ht_centimes <= 0 || ligne.libelle.trim().is_empty() {
            return Err(ApiError::bad_request("Ligne invalide"));
        }
        if !matches!(ligne.nature.as_str(), "honoraires" | "debours" | "frais") {
            return Err(ApiError::bad_request("Nature inconnue"));
        }
        ht += ligne.montant_ht_centimes;
        if ligne.nature != "debours" {
            taxable += ligne.montant_ht_centimes;
        }
    }
    let tva = tva_centimes(taxable, taux_bp);
    Ok((ht, tva, ht + tva))
}

async fn charger(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<FactureResponse, ApiError> {
    let row = sqlx::query_as::<_, (String, Option<i64>, i64, i64, i64)>(
        "SELECT statut, numero, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes FROM factures WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .ok_or_else(|| ApiError::not_found("Facture introuvable"))?;
    Ok(FactureResponse {
        id,
        statut: row.0,
        numero: row.1,
        montant_ht_centimes: row.2,
        montant_tva_centimes: row.3,
        montant_ttc_centimes: row.4,
    })
}
