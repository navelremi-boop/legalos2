const SERVICE: &str = "fr.legalos.poste";
const ACCOUNT: &str = "refresh";

fn entree() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|err| err.to_string())
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
