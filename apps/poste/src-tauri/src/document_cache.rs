//! Cache local des documents + surveillance filesystem (`notify`).
//! Aucun éditeur codé en dur : l'ouverture passe par `tauri-plugin-opener`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct SurveillanceDocuments {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    chemins: Mutex<HashMap<String, PathBuf>>,
}

impl Default for SurveillanceDocuments {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
            chemins: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct CacheModifie {
    document_id: String,
    chemin: String,
}

fn repertoire_cache(app: &AppHandle, document_id: &str) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let dir = base.join("cache").join("documents").join(document_id);
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn ecrire_cache_document(
    app: AppHandle,
    state: State<'_, SurveillanceDocuments>,
    document_id: String,
    nom_fichier: String,
    octets: Vec<u8>,
) -> Result<String, String> {
    let nom = Path::new(&nom_fichier)
        .file_name()
        .ok_or_else(|| "nom de fichier invalide".to_owned())?
        .to_string_lossy()
        .into_owned();
    let dir = repertoire_cache(&app, &document_id)?;
    let chemin = dir.join(&nom);
    std::fs::write(&chemin, &octets).map_err(|err| err.to_string())?;
    if let Ok(mut chemins) = state.chemins.lock() {
        chemins.insert(document_id, chemin.clone());
    }
    Ok(chemin.to_string_lossy().into_owned())
}

/// Télécharge l'URL (lien présigné Garage) hors webview pour éviter le CORS.
#[tauri::command]
pub async fn telecharger_vers_cache(
    app: AppHandle,
    state: State<'_, SurveillanceDocuments>,
    document_id: String,
    nom_fichier: String,
    url: String,
) -> Result<String, String> {
    let reponse = reqwest::get(&url)
        .await
        .map_err(|err| format!("téléchargement : {err}"))?;
    if !reponse.status().is_success() {
        return Err(format!("téléchargement HTTP {}", reponse.status()));
    }
    let octets = reponse
        .bytes()
        .await
        .map_err(|err| format!("lecture corps : {err}"))?
        .to_vec();
    ecrire_cache_document(app, state, document_id, nom_fichier, octets)
}

#[tauri::command]
pub fn chemin_cache_document(
    state: State<'_, SurveillanceDocuments>,
    document_id: String,
) -> Result<Option<String>, String> {
    let chemins = state.chemins.lock().map_err(|err| err.to_string())?;
    Ok(chemins
        .get(&document_id)
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn lire_octets_cache(chemin: String) -> Result<Vec<u8>, String> {
    std::fs::read(&chemin).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn ecrire_octets_cache(chemin: String, octets: Vec<u8>) -> Result<(), String> {
    std::fs::write(&chemin, octets).map_err(|err| err.to_string())
}

/// Dépôt S3 / Garage hors webview (évite le CORS sur l'endpoint public).
#[tauri::command]
pub async fn deposer_octets_url(
    url: String,
    octets: Vec<u8>,
    entetes: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client.put(&url).body(octets);
    for (cle, valeur) in entetes {
        req = req.header(cle, valeur);
    }
    let reponse = req.send().await.map_err(|err| format!("dépôt : {err}"))?;
    if !reponse.status().is_success() {
        return Err(format!("dépôt HTTP {}", reponse.status()));
    }
    Ok(())
}

#[tauri::command]
pub fn surveiller_cache_document(
    app: AppHandle,
    state: State<'_, SurveillanceDocuments>,
    document_id: String,
    chemin: String,
) -> Result<(), String> {
    let path = PathBuf::from(&chemin);
    let parent = path
        .parent()
        .ok_or_else(|| "répertoire parent absent".to_owned())?
        .to_path_buf();
    let cible = path.clone();
    let doc_id = document_id.clone();
    let app_emit = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else {
                return;
            };
            let pertinent = matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            );
            if !pertinent {
                return;
            }
            let touche = event.paths.iter().any(|p| {
                p == &cible
                    || p.file_name()
                        .is_some_and(|n| cible.file_name().is_some_and(|c| n == c))
            });
            if !touche && !event.paths.is_empty() {
                return;
            }
            let _ = app_emit.emit(
                "document-cache-modifie",
                CacheModifie {
                    document_id: doc_id.clone(),
                    chemin: cible.to_string_lossy().into_owned(),
                },
            );
        },
        notify::Config::default(),
    )
    .map_err(|err| err.to_string())?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;

    if let Ok(mut chemins) = state.chemins.lock() {
        chemins.insert(document_id.clone(), path);
    }
    let mut watchers = state.watchers.lock().map_err(|err| err.to_string())?;
    watchers.insert(document_id, watcher);
    Ok(())
}

#[tauri::command]
pub fn arreter_surveillance_document(
    state: State<'_, SurveillanceDocuments>,
    document_id: String,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().map_err(|err| err.to_string())?;
    watchers.remove(&document_id);
    Ok(())
}
