use std::error::Error;
use std::fmt;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures_lite::StreamExt;
use powersync::error::PowerSyncError;
use powersync::{BackendConnector, PowerSyncCredentials, PowerSyncDatabase, SyncOptions};
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_powersync::PowerSyncExt;

#[derive(Clone)]
struct SessionSync {
    instance_url: String,
    access_token: String,
}

#[derive(Debug)]
struct UploadMessage(String);

impl fmt::Display for UploadMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for UploadMessage {}

fn upload_err(message: impl Into<String>) -> PowerSyncError {
    PowerSyncError::upload_error(UploadMessage(message.into()))
}

struct CabinetConnector {
    db: PowerSyncDatabase,
    session: Arc<Mutex<SessionSync>>,
}

#[derive(Serialize)]
struct PatchBody<'a> {
    base_revision: i64,
    idempotence_cle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    nom: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slug: Option<&'a str>,
}

#[tauri::command]
pub async fn connect_powersync<R: Runtime>(
    app: AppHandle<R>,
    handle: usize,
    instance_url: String,
    access_token: String,
) -> tauri_plugin_powersync::Result<()> {
    let ps = app.powersync();
    let database = ps.database_from_javascript_handle(handle)?;
    let session = Arc::new(Mutex::new(SessionSync {
        instance_url,
        access_token,
    }));
    let connector = CabinetConnector {
        db: database.clone(),
        session: Arc::clone(&session),
    };
    database
        .connect(SyncOptions::new(CabinetConnector {
            db: database.clone(),
            session,
        }))
        .await;
    if let Ok(reader) = database.reader().await {
        if let Ok(n) = reader.query_row("SELECT COUNT(*) FROM ps_crud", [], |row| {
            row.get::<_, i64>(0)
        }) {
            eprintln!("file crud: {n}");
        }
    }
    if let Err(err) = connector.upload_data().await {
        eprintln!("upload file: {err}");
    }
    Ok(())
}

#[async_trait]
impl BackendConnector for CabinetConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        let session = self
            .session
            .lock()
            .map_err(|_| upload_err("session sync verrouillée"))?;
        if session.access_token.is_empty() {
            return Err(upload_err("jeton d'accès absent"));
        }
        // `Url::join("sync/stream")` remplace le dernier segment s'il n'y a pas de barre finale.
        // Avec `/sync/`, la requête est `/sync/sync/stream` ; Caddy retire un préfixe et le service reçoit `/sync/stream`.
        let endpoint = format!("{}/sync/", session.instance_url.trim_end_matches('/'));
        Ok(PowerSyncCredentials {
            endpoint,
            token: session.access_token.clone(),
        })
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        let mut transactions = self.db.crud_transactions();
        while let Some(mut tx) = transactions.try_next().await? {
            let crud = std::mem::take(&mut tx.crud);
            let mut cabinets = Vec::new();
            let mut dossiers = Vec::new();
            let mut parties = Vec::new();
            let mut temps = Vec::new();
            let mut brouillons = Vec::new();
            for entry in crud {
                match entry.table.as_str() {
                    "cabinets" => cabinets.push(entry),
                    "dossiers" => dossiers.push(entry),
                    "parties" => parties.push(entry),
                    "temps_saisis" => temps.push(entry),
                    "brouillons_facture" => brouillons.push(entry),
                    _ => return Err(upload_err("table hors périmètre")),
                }
            }
            for entry in cabinets {
                upload_cabinet(&self.session, &self.db, &entry.id, entry.data.as_ref()).await?;
            }
            for entry in dossiers {
                upload_dossier(&self.session, &entry.id, entry.data.as_ref()).await?;
            }
            for entry in parties {
                upload_partie(&self.session, &entry.id, entry.data.as_ref()).await?;
            }
            for entry in temps {
                upload_temps(&self.session, &entry.id, entry.data.as_ref()).await?;
            }
            for entry in brouillons {
                upload_brouillon(&self.session, &entry.id, entry.data.as_ref()).await?;
            }
            tx.complete().await?;
        }
        Ok(())
    }
}

async fn upload_cabinet(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    id: &str,
    data: Option<&Map<String, Value>>,
) -> Result<(), PowerSyncError> {
    let Some(data) = data else {
        return Ok(());
    };
    let nom = json_text(data.get("nom"));
    let slug = json_text(data.get("slug"));
    if nom.is_none() && slug.is_none() {
        return Ok(());
    }
    let base_revision = lire_revision(db, id).await?;
    let (instance_url, token) = {
        let session = session
            .lock()
            .map_err(|_| upload_err("session sync verrouillée"))?;
        (session.instance_url.clone(), session.access_token.clone())
    };
    let idempotence_cle = format!(
        "{id}:{base_revision}:{}:{}",
        nom.unwrap_or(""),
        slug.unwrap_or("")
    );
    let body = PatchBody {
        base_revision,
        idempotence_cle,
        nom,
        slug,
    };
    let url = format!("{}/api/cabinets/{id}", instance_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .patch(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let corps = response.text().await.unwrap_or_default();
        return Err(upload_err(format!(
            "upload cabinet rejeté ({status}) {corps}"
        )));
    }
    Ok(())
}

#[derive(Serialize)]
struct CreerDossierBody<'a> {
    id: &'a str,
    idempotence_cle: String,
    nom: &'a str,
    chemise: &'a str,
    juridiction: &'a str,
    numero_rg: &'a str,
    restreint: bool,
}

#[derive(Serialize)]
struct CreerPartieBody<'a> {
    id: &'a str,
    idempotence_cle: String,
    role: &'a str,
    nom: &'a str,
}

async fn upload_dossier(
    session: &Arc<Mutex<SessionSync>>,
    id: &str,
    data: Option<&Map<String, Value>>,
) -> Result<(), PowerSyncError> {
    let Some(data) = data else {
        return Ok(());
    };
    let Some(nom) = json_text(data.get("nom")) else {
        return Ok(());
    };
    let Some(chemise) = json_text(data.get("chemise")) else {
        return Err(upload_err("chemise absente"));
    };
    let Some(juridiction) = json_text(data.get("juridiction")) else {
        return Err(upload_err("juridiction absente"));
    };
    let Some(numero_rg) = json_text(data.get("numero_rg")) else {
        return Err(upload_err("numéro RG absent"));
    };
    let body = CreerDossierBody {
        id,
        idempotence_cle: format!("{id}:dossier"),
        nom,
        chemise,
        juridiction,
        numero_rg,
        restreint: json_flag(data.get("restreint")),
    };
    envoyer(session, "/api/dossiers", &body).await
}

async fn upload_partie(
    session: &Arc<Mutex<SessionSync>>,
    id: &str,
    data: Option<&Map<String, Value>>,
) -> Result<(), PowerSyncError> {
    let Some(data) = data else {
        return Ok(());
    };
    let Some(dossier_id) = json_text(data.get("dossier_id")) else {
        return Err(upload_err("dossier de la partie absent"));
    };
    let Some(role) = json_text(data.get("role")) else {
        return Err(upload_err("rôle de partie absent"));
    };
    let Some(nom) = json_text(data.get("nom")) else {
        return Err(upload_err("nom de partie absent"));
    };
    let body = CreerPartieBody {
        id,
        idempotence_cle: format!("{id}:partie"),
        role,
        nom,
    };
    envoyer(
        session,
        &format!("/api/dossiers/{dossier_id}/parties"),
        &body,
    )
    .await
}

#[derive(Serialize)]
struct CreerTempsBody<'a> {
    id: &'a str,
    dossier_id: &'a str,
    minutes: i64,
    libelle: &'a str,
    taux_centimes_heure: i64,
    idempotence_cle: String,
}

#[derive(Serialize)]
struct CreerBrouillonBody<'a> {
    id: &'a str,
    dossier_id: &'a str,
    temps_id: &'a str,
    libelle: &'a str,
    ht_centimes: i64,
    taux_centimes_heure: i64,
    idempotence_cle: String,
}

async fn upload_temps(
    session: &Arc<Mutex<SessionSync>>,
    id: &str,
    data: Option<&Map<String, Value>>,
) -> Result<(), PowerSyncError> {
    let Some(data) = data else {
        return Ok(());
    };
    let Some(dossier_id) = json_text(data.get("dossier_id")) else {
        return Err(upload_err("dossier du temps absent"));
    };
    let Some(libelle) = json_text(data.get("libelle")) else {
        return Err(upload_err("libellé du temps absent"));
    };
    let Some(minutes) = json_i64(data.get("minutes")) else {
        return Err(upload_err("minutes absentes"));
    };
    let Some(taux) = json_i64(data.get("taux_centimes_heure")) else {
        return Err(upload_err("taux horaire absent"));
    };
    let body = CreerTempsBody {
        id,
        dossier_id,
        minutes,
        libelle,
        taux_centimes_heure: taux,
        idempotence_cle: format!("{id}:temps"),
    };
    envoyer(session, "/api/temps", &body).await
}

async fn upload_brouillon(
    session: &Arc<Mutex<SessionSync>>,
    id: &str,
    data: Option<&Map<String, Value>>,
) -> Result<(), PowerSyncError> {
    let Some(data) = data else {
        return Ok(());
    };
    let Some(dossier_id) = json_text(data.get("dossier_id")) else {
        return Err(upload_err("dossier du brouillon absent"));
    };
    let Some(temps_id) = json_text(data.get("temps_id")) else {
        return Err(upload_err("temps du brouillon absent"));
    };
    let Some(libelle) = json_text(data.get("libelle")) else {
        return Err(upload_err("libellé du brouillon absent"));
    };
    let Some(ht) = json_i64(data.get("ht_centimes")) else {
        return Err(upload_err("montant HT absent"));
    };
    let Some(taux) = json_i64(data.get("taux_centimes_heure")) else {
        return Err(upload_err("taux du brouillon absent"));
    };
    let body = CreerBrouillonBody {
        id,
        dossier_id,
        temps_id,
        libelle,
        ht_centimes: ht,
        taux_centimes_heure: taux,
        idempotence_cle: format!("{id}:brouillon"),
    };
    envoyer(session, "/api/brouillons-facture", &body).await
}

async fn envoyer(
    session: &Arc<Mutex<SessionSync>>,
    chemin: &str,
    body: &impl Serialize,
) -> Result<(), PowerSyncError> {
    let (instance_url, token) = {
        let session = session
            .lock()
            .map_err(|_| upload_err("session sync verrouillée"))?;
        (session.instance_url.clone(), session.access_token.clone())
    };
    let url = format!("{}{chemin}", instance_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(token)
        .json(body)
        .send()
        .await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let corps = response.text().await.unwrap_or_default();
        return Err(upload_err(format!("upload rejeté ({status}) {corps}")));
    }
    Ok(())
}

fn json_flag(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(v)) => *v,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    }
}

fn json_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

fn json_text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

async fn lire_revision(db: &PowerSyncDatabase, id: &str) -> Result<i64, PowerSyncError> {
    let conn = db.reader().await?;
    if let Ok(revision) = conn.query_row(
        "SELECT revision FROM revision_edition WHERE id = ?1",
        [id],
        |row| row.get(0),
    ) {
        return Ok(revision);
    }
    let revision = conn.query_row("SELECT revision FROM cabinets WHERE id = ?1", [id], |row| {
        row.get(0)
    })?;
    Ok(revision)
}
