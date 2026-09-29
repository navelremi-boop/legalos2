// Feature `test-webdriver` : WebDriver embarqué réservé aux builds CI (§ 22-tauri).

mod powersync_connect;
mod trousseau;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_powersync::init())
        .invoke_handler(tauri::generate_handler![
            powersync_connect::connect_powersync,
            trousseau::assurer_repertoire_poste,
            trousseau::poste_isolation_id,
            trousseau::keyring_store_refresh,
            trousseau::keyring_has_refresh,
            trousseau::keyring_clear_refresh
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
