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
    let options = SyncOptions::new(CabinetConnector {
        db: database.clone(),
        session,
    });
    database.connect(options).await;
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
            for entry in crud {
                if entry.table != "cabinets" {
                    return Err(upload_err("table hors périmètre J3"));
                }
                upload_cabinet(&self.session, &self.db, &entry.id, entry.data.as_ref()).await?;
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
        return Err(upload_err(format!("upload cabinet rejeté ({status})")));
    }
    Ok(())
}

fn json_text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

async fn lire_revision(db: &PowerSyncDatabase, id: &str) -> Result<i64, PowerSyncError> {
    let conn = db.reader().await?;
    let revision = conn.query_row("SELECT revision FROM cabinets WHERE id = ?1", [id], |row| {
        row.get(0)
    })?;
    Ok(revision)
}
