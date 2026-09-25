use tauri::Manager;

const SERVICE: &str = "fr.legalos.poste";

fn account() -> String {
    match std::env::var("LEGALOS_POSTE_ID") {
        Ok(id) if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!("refresh-{id}")
        }
        _ => "refresh".to_owned(),
    }
}

#[tauri::command]
pub fn assurer_repertoire_poste(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(dir).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn poste_isolation_id() -> String {
    match std::env::var("LEGALOS_POSTE_ID") {
        Ok(id) if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()) => id,
        _ => String::new(),
    }
}

fn entree() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn keyring_store_refresh(token: String) -> Result<(), String> {
    entree()?
        .set_password(&token)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn keyring_has_refresh() -> Result<bool, String> {
    match entree()?.get_password() {
        Ok(valeur) => Ok(!valeur.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn keyring_clear_refresh() -> Result<(), String> {
    match entree()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
