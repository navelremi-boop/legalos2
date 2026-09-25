// Feature `test-webdriver` : WebDriver embarqué réservé aux builds CI (§ 22-tauri).

mod powersync_connect;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_powersync::init())
        .invoke_handler(tauri::generate_handler![
            powersync_connect::connect_powersync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
