//! Génère les constantes SQL pour `004_demo_fictif.sql` :
//! `cargo test -p legalos-api --test demo_migration_assets -- --nocapture`

#[path = "support/mod.rs"]
mod support;

use legalos_api::auth::password;
use legalos_api::auth::totp;

use support::demo_seed::{DEMO_CIPHER_KEY, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

#[test]
fn print_demo_migration_assets() {
    let password_hash = password::hash_password(DEMO_PASSWORD).expect("hash");
    let totp_enc =
        totp::chiffrer_secret_totp_demo_fixe(DEMO_TOTP_SECRET_BASE32.as_bytes(), DEMO_CIPHER_KEY)
            .expect("totp chiffré");
    println!("password_hash={password_hash}");
    println!("totp_secret_chiffre={totp_enc}");
}
