use std::sync::Arc;

use axum::http::header::CONTENT_TYPE;
use axum::response::IntoResponse;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::facturation::{cii_en16931, tva_centimes, FactureCii};
use crate::plateforme::{
    DepotFacture, EncaissementPa, ErreurPlateforme, HttpPlateformeAgreee, PlateformeAgreee,
};
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

#[utoipa::path(post, path = "/factures", tag = "factures", security(("bearer_auth" = [])), request_body = CreerFactureRequest, responses((status = 200, body = FactureResponse)))]
pub async fn creer_brouillon(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerFactureRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    // La validation ne crée jamais de dossier : refus si absent.
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
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
            montant_tva_centimes, montant_ttc_centimes, taux_tva_bp
        ) VALUES ($1, $2, $3, 'facture', 'brouillon', $4, $5, $6, $7)
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
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("brouillon"))?;
    let inseree = sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM factures WHERE id = $1")
        .bind(body.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture brouillon"))?;
    if inseree.0 > 0
        && sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM facture_lignes WHERE facture_id = $1")
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
        return charger(&state, body.id).await.map(Json);
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
    charger(&state, body.id).await.map(Json)
}

#[utoipa::path(post, path = "/factures/{id}/valider", tag = "factures", security(("bearer_auth" = [])), responses((status = 200, body = FactureResponse)))]
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
    let actuelle = sqlx::query_as::<_, (String, Option<i64>)>(
        "SELECT statut, numero FROM factures WHERE id = $1 AND cabinet_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .ok_or_else(|| ApiError::bad_request("Facture introuvable"))?;
    if actuelle.0 == "validee" {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit"))?;
        return charger(&state, id).await.map(Json);
    }
    let dossier_id = sqlx::query_as::<_, (Uuid,)>("SELECT dossier_id FROM factures WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("dossier facture"))?
        .0;
    let dossier_ok =
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM dossiers WHERE id = $1 AND cabinet_id = $2")
            .bind(dossier_id)
            .bind(claims.cabinet_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("lecture dossier"))?;
    if dossier_ok.is_none() {
        return Err(ApiError::bad_request("Dossier introuvable"));
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
    charger(&state, id).await.map(Json)
}

#[utoipa::path(post, path = "/factures/{id}/emettre", tag = "factures", security(("bearer_auth" = [])), request_body = EmettreRequest, responses((status = 200, body = FactureResponse)))]
pub async fn emettre(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<EmettreRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let facture = facture_validee(&state, claims.cabinet_id, id).await?;
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
        return charger(&state, id).await.map(Json);
    }
    let pa = HttpPlateformeAgreee::depuis_env().map_err(err_pa)?;
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
    sqlx::query(
        "INSERT INTO envois_plateforme (cle_idempotence, facture_id, identifiant_pa) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(cle)
    .bind(id)
    .bind(resultat.id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("journal d'envoi"))?;
    charger(&state, id).await.map(Json)
}

#[utoipa::path(post, path = "/factures/{id}/encaissements", tag = "factures", security(("bearer_auth" = [])), request_body = EncaisserRequest, responses((status = 200, body = FactureResponse)))]
pub async fn encaisser(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<EncaisserRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let facture = facture_validee(&state, claims.cabinet_id, id).await?;
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
    charger(&state, id).await.map(Json)
}

#[utoipa::path(post, path = "/factures/{id}/avoir", tag = "factures", security(("bearer_auth" = [])), request_body = AvoirRequest, responses((status = 200, body = FactureResponse)))]
pub async fn avoir(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(origine): axum::extract::Path<Uuid>,
    Json(body): Json<AvoirRequest>,
) -> Result<Json<FactureResponse>, ApiError> {
    let source = facture_validee(&state, claims.cabinet_id, origine).await?;
    if source.type_document != "facture" {
        return Err(ApiError::bad_request("Un avoir ne corrige qu'une facture"));
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    let deja = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM factures WHERE id = $1")
        .bind(body.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture avoir"))?;
    if deja.is_some() {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("commit"))?;
        return charger(&state, body.id).await.map(Json);
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
        r#"
        INSERT INTO factures (
            id, cabinet_id, dossier_id, type, statut, numero, facture_origine_id,
            montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp
        ) VALUES ($1, $2, $3, 'avoir', 'validee', $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(source.dossier_id)
    .bind(numero)
    .bind(origine)
    .bind(source.montant_ht_centimes)
    .bind(source.montant_tva_centimes)
    .bind(source.montant_ttc_centimes)
    .bind(source.taux_tva_bp)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("création avoir"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("commit avoir"))?;
    charger(&state, body.id).await.map(Json)
}

struct FactureLue {
    dossier_id: Uuid,
    type_document: String,
    numero: Option<i64>,
    montant_ht_centimes: i64,
    montant_tva_centimes: i64,
    montant_ttc_centimes: i64,
    taux_tva_bp: i32,
}

async fn facture_validee(
    state: &AppState,
    cabinet_id: Uuid,
    id: Uuid,
) -> Result<FactureLue, ApiError> {
    sqlx::query_as::<_, (Uuid, String, String, Option<i64>, i64, i64, i64, i32)>(
        "SELECT dossier_id, type, statut, numero, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp FROM factures WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .filter(|row| row.2 == "validee")
    .map(|row| FactureLue {
        dossier_id: row.0,
        type_document: row.1,
        numero: row.3,
        montant_ht_centimes: row.4,
        montant_tva_centimes: row.5,
        montant_ttc_centimes: row.6,
        taux_tva_bp: row.7,
    })
    .ok_or_else(|| ApiError::bad_request("Facture non validée"))
}

pub async fn lire_cii(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<axum::response::Response, ApiError> {
    let facture = facture_validee(&state, claims.cabinet_id, id).await?;
    let libelle = sqlx::query_as::<_, (String,)>(
        "SELECT libelle FROM facture_lignes WHERE facture_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("ligne"))?
    .map(|row| row.0)
    .unwrap_or_else(|| "Honoraires".to_owned());
    let aujourd_hui = time::OffsetDateTime::now_utc().date();
    let date = format!(
        "{:04}{:02}{:02}",
        aujourd_hui.year(),
        aujourd_hui.month() as u8,
        aujourd_hui.day()
    );
    let xml = cii_en16931(&FactureCii {
        numero: facture.numero.unwrap_or(0),
        avoir: facture.type_document == "avoir",
        acompte: false,
        date_aaaammjj: &date,
        libelle: &libelle,
        ht_centimes: facture.montant_ht_centimes,
        tva_centimes: facture.montant_tva_centimes,
        ttc_centimes: facture.montant_ttc_centimes,
        taux_bp: facture.taux_tva_bp,
        acheteur_tva: Some("FR32876543210"),
        debours_centimes: 0,
        deja_paye_centimes: 0,
    });
    Ok(([(CONTENT_TYPE, "application/xml; charset=utf-8")], xml).into_response())
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

async fn charger(state: &AppState, id: Uuid) -> Result<FactureResponse, ApiError> {
    let row = sqlx::query_as::<_, (String, Option<i64>, i64, i64, i64)>(
        "SELECT statut, numero, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes FROM factures WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture facture"))?
    .ok_or_else(|| ApiError::bad_request("Facture introuvable"))?;
    Ok(FactureResponse {
        id,
        statut: row.0,
        numero: row.1,
        montant_ht_centimes: row.2,
        montant_tva_centimes: row.3,
        montant_ttc_centimes: row.4,
    })
}
