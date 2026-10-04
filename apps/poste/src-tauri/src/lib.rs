// Feature `test-webdriver` : WebDriver embarqué réservé aux builds CI (§ 22-tauri).

mod document_cache;
mod powersync_connect;
mod trousseau;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_powersync::init())
        .manage(document_cache::SurveillanceDocuments::default())
        .invoke_handler(tauri::generate_handler![
            powersync_connect::connect_powersync,
            trousseau::assurer_repertoire_poste,
            trousseau::poste_isolation_id,
            trousseau::keyring_store_refresh,
            trousseau::keyring_has_refresh,
            trousseau::keyring_clear_refresh,
            document_cache::ecrire_cache_document,
            document_cache::telecharger_vers_cache,
            document_cache::chemin_cache_document,
            document_cache::lire_octets_cache,
            document_cache::ecrire_octets_cache,
            document_cache::deposer_octets_url,
            document_cache::surveiller_cache_document,
            document_cache::arreter_surveillance_document
        ]);

    #[cfg(feature = "test-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
