use std::fs;
use std::path::Path;

fn main() {
    let capability = Path::new("capabilities").join("webdriver.json");
    let feature = std::env::var_os("CARGO_FEATURE_TEST_WEBDRIVER").is_some();
    if feature {
        fs::write(
            &capability,
            r#"{
  "identifier": "webdriver",
  "description": "WebDriver embarqué, feature test-webdriver seulement.",
  "windows": ["main"],
  "permissions": ["wdio-webdriver:default"]
}
"#,
        )
        .expect("capability webdriver");
        println!("cargo:warning=WebDriver embarqué (feature test-webdriver)");
    } else if capability.exists() {
        fs::remove_file(&capability).ok();
    }
    tauri_build::build();
}
