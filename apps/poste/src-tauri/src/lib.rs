// Feature `test-webdriver` : WebDriver embarqué réservé aux builds CI (§ 22-tauri).

mod document_cache;
mod journal_erreurs;
mod oauth_boucle;
mod powersync_connect;
mod trousseau;

/// Commande de recette (feature `test-webdriver` seulement) : lève `STATUS_HEAP_CORRUPTION`
/// après un délai, pour éprouver le filet de cliché. Absente du build distribué.
#[cfg(feature = "test-webdriver")]
fn armer_corruption_de_recette() {
    const ARGUMENT: &str = "--lever-corruption-tas";
    if std::env::args().any(|arg| arg == ARGUMENT) {
        std::thread::spawn(|| {
            // Le filet attache cdb après le démarrage : laisser ce délai avant l'exception.
            std::thread::sleep(std::time::Duration::from_secs(15));
            lever_status_heap_corruption();
        });
    }
}

#[cfg(feature = "test-webdriver")]
fn lever_status_heap_corruption() -> ! {
    #[link(name = "kernel32")]
    extern "system" {
        fn RaiseException(code: u32, flags: u32, nombre: u32, arguments: *const usize);
    }
    // Exception non continuable. Le débogueur attaché la voit ; sans lui, le processus se termine.
    unsafe {
        RaiseException(0xC000_0374, 1, 0, std::ptr::null());
    }
    std::process::abort();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    #[cfg(feature = "test-webdriver")]
    armer_corruption_de_recette();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_powersync::init())
        .manage(document_cache::SurveillanceDocuments::default())
        .manage(oauth_boucle::EtatBouclage::default())
        .invoke_handler(tauri::generate_handler![
            powersync_connect::connect_powersync,
            trousseau::assurer_repertoire_poste,
            trousseau::poste_isolation_id,
            trousseau::keyring_store_refresh,
            trousseau::keyring_read_refresh,
            trousseau::keyring_has_refresh,
            trousseau::keyring_clear_refresh,
            document_cache::ecrire_cache_document,
            document_cache::telecharger_vers_cache,
            document_cache::chemin_cache_document,
            document_cache::lire_octets_cache,
            document_cache::ecrire_octets_cache,
            document_cache::deposer_octets_url,
            document_cache::surveiller_cache_document,
            document_cache::arreter_surveillance_document,
            oauth_boucle::oauth_ecouter_bouclage,
            oauth_boucle::oauth_attendre_retour,
            oauth_boucle::oauth_annuler_bouclage,
            journal_erreurs::journaliser_erreur_js
        ])
        // Journal d'erreurs du poste (D4) : répertoire de données de l'app, démarré avant toute fenêtre pour que
        // l'arrêt d'une session soit consigné même si l'interface ne charge jamais.
        .setup(|app| {
            use tauri::Manager;
            let dossier = app.path().app_data_dir()?.join("journal-erreurs");
            let journal = std::sync::Arc::new(journal_erreurs::Journal::nouveau(dossier));
            journal_erreurs::demarrer(&journal);
            app.manage(journal);
            Ok(())
        });

    #[cfg(feature = "test-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    // La sortie normale retire le marqueur de session : sans elle, la session est tenue pour morte (`fin_anormale`).
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, evenement| {
            if let tauri::RunEvent::Exit = evenement {
                use tauri::Manager;
                if let Some(journal) = app.try_state::<std::sync::Arc<journal_erreurs::Journal>>() {
                    journal.terminer_session();
                }
            }
        });
}
