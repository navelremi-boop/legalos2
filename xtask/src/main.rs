//! LEGAL OS — commandes dépôt (recette, démo). Multiplateforme, sans bash.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "xtask", about = "LEGAL OS repository tasks")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Vérifie la présence des contrats phase 0 (sans services).
    CheckContracts,
    /// Recette multi-scénarios (S1–S14). Implémentation progressive.
    Recette {
        #[arg(long)]
        scenario: Option<String>,
    },
    /// Charge les données de démonstration fictives. Refuse hors développement.
    Demo,
    /// Écrit le `.env` de production et crée le premier administrateur.
    Install,
}

fn repo_root() -> Result<PathBuf> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .context("xtask must live at repo root/xtask/")
        .map(|p| p.to_path_buf())
}

fn must_exist(root: &Path, rel: &str) -> Result<()> {
    let p = root.join(rel);
    if p.exists() {
        Ok(())
    } else {
        anyhow::bail!("missing contract file: {rel}");
    }
}

fn check_contracts(root: &Path) -> Result<()> {
    let required = [
        "design/tokens.css",
        "docs/sync-streams.md",
        "docs/versions.md",
        "apps/poste/src/sync/AppSchema.ts",
        "crates/api/migrations/001_cabinets.sql",
        "instance/docker-compose.yml",
        "PLAN.md",
        "JOURNAL.md",
        "BLOCAGES.md",
    ];
    for rel in required {
        must_exist(root, rel)?;
    }
    Ok(())
}

fn run_docker_compose(instance_dir: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("docker")
        .arg("compose")
        .arg("-f")
        .arg("docker-compose.yml")
        .arg("--env-file")
        .arg("../.env")
        .args(args)
        .current_dir(instance_dir)
        .status()
        .context(
            "échec lancement docker compose — Docker Desktop installé ? (BLOCAGES.md B3) ; PATH contient docker ?",
        )?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("docker compose exited with {status}");
    }
}

fn ensure_env_file(root: &Path) -> Result<()> {
    let env = root.join(".env");
    if env.is_file() {
        Ok(())
    } else {
        anyhow::bail!(
            "fichier .env absent — pour la recette, copier .env.development.example vers .env ; pour une installation, cargo xtask install"
        );
    }
}

fn run_cargo(root: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("cargo")
        .args(args)
        .current_dir(root)
        .status()
        .context("failed to spawn cargo")?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("cargo exited with {status}");
    }
}

fn recette_s2(root: &Path) -> Result<()> {
    ensure_env_file(root)?;
    eprintln!("recette S2 : tests intégration auth (Postgres via DATABASE_URL)…");
    run_cargo(
        root,
        &[
            "test",
            "-p",
            "legalos-api",
            "--test",
            "auth_integration",
            "--",
            "--nocapture",
        ],
    )?;
    eprintln!("recette S2 : probes HTTP auth (API healthy — ex. après s1)…");
    let status = Command::new("node")
        .arg(root.join("tests/recette/s2.mjs"))
        .current_dir(root)
        .status()
        .context("échec node tests/recette/s2.mjs")?;
    if status.success() {
        eprintln!("recette: s2 OK");
        Ok(())
    } else {
        anyhow::bail!("s2.mjs exited with {status}");
    }
}

fn recette_s1(root: &Path) -> Result<()> {
    ensure_env_file(root)?;
    let instance = root.join("instance");
    must_exist(root, "instance/docker-compose.yml")?;
    eprintln!("recette S1 : build + démarrage + attente healthchecks (timeout compose 300s)…");
    run_docker_compose(
        &instance,
        &["up", "-d", "--build", "--wait", "--wait-timeout", "300"],
    )?;
    run_docker_compose(&instance, &["ps"])?;
    eprintln!("recette: s1 OK (tous les services healthy selon docker compose ps)");
    Ok(())
}

fn run_pnpm(root: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("pnpm")
        .args(args)
        .current_dir(root)
        .status()
        .context("failed to spawn pnpm (install Node LTS + pnpm)")?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("pnpm exited with {status}");
    }
}

fn recette(_root: &Path, scenario: Option<&str>) -> Result<()> {
    match scenario {
        None | Some("j0") | Some("contracts") => {
            // Phase 0 : contrats + front strict
            check_contracts(_root)?;
            run_pnpm(_root, &["--filter", "@legal-os/poste", "typecheck"])?;
            run_pnpm(_root, &["--filter", "@legal-os/poste", "build"])?;
            eprintln!("recette: j0/contracts OK");
            Ok(())
        }
        Some("s1") => recette_s1(_root),
        Some("s2") => recette_s2(_root),
        Some(other) => anyhow::bail!("unknown scenario: {other}"),
    }
}

fn charger_env(root: &Path) {
    let chemin = root.join(".env");
    let Ok(texte) = std::fs::read_to_string(chemin) else {
        return;
    };
    for ligne in texte.lines() {
        let ligne = ligne.trim();
        if ligne.is_empty() || ligne.starts_with('#') {
            continue;
        }
        let Some((cle, valeur)) = ligne.split_once('=') else {
            continue;
        };
        if std::env::var(cle).is_err() {
            std::env::set_var(cle, valeur);
        }
    }
}

fn exiger_developpement() -> Result<()> {
    charger_env_si_besoin();
    if std::env::var("LEGALOS_MODE").ok().as_deref() == Some("development") {
        Ok(())
    } else {
        anyhow::bail!("refusé : LEGALOS_MODE=development est requis")
    }
}

fn charger_env_si_besoin() {
    if let Ok(root) = repo_root() {
        charger_env(&root);
    }
}

fn demo(root: &Path) -> Result<()> {
    exiger_developpement()?;
    let url = std::env::var("DATABASE_URL").context("DATABASE_URL requis")?;
    let sql = std::fs::read_to_string(root.join("instance/demo/seed.sql"))
        .context("instance/demo/seed.sql")?;
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let pool = sqlx::PgPool::connect(&url).await?;
        sqlx::raw_sql(&sql).execute(&pool).await?;
        Ok::<(), anyhow::Error>(())
    })?;
    eprintln!("demo : données fictives chargées");
    Ok(())
}

fn install(root: &Path) -> Result<()> {
    let env_path = root.join(".env");
    if env_path.is_file() {
        let texte = std::fs::read_to_string(&env_path).context(".env")?;
        if legalos_api::config::SECRETS_PUBLIES
            .iter()
            .any(|(_, valeur)| texte.contains(valeur))
        {
            anyhow::bail!(".env existe déjà et contient une valeur publiée ; installation refusée");
        }
    } else {
        ecrire_env_production(root, &SecretsInstall::generer())?;
    }
    std::env::remove_var("LEGALOS_MODE");
    let mut noms = std::collections::BTreeSet::new();
    for (nom, _) in legalos_api::config::SECRETS_PUBLIES {
        noms.insert(*nom);
    }
    for nom in noms {
        std::env::remove_var(nom);
    }
    charger_env(root);
    let cle_brute = std::env::var("SECRETS_CHIFFREMENT_KEY").context("SECRETS_CHIFFREMENT_KEY")?;
    if std::env::var("LEGALOS_MODE").ok().as_deref() == Some("development") {
        anyhow::bail!("installation : le .env généré ne doit pas être en développement");
    }
    let cle = decoder_cle(&cle_brute)?;
    let url = std::env::var("DATABASE_URL").context("DATABASE_URL requis")?;
    let mot_de_passe = mot_de_passe_aleatoire();
    let secret = secret_totp_aleatoire()?;
    let runtime = tokio::runtime::Runtime::new()?;
    let cree = runtime
        .block_on(async {
            let pool = sqlx::PgPool::connect(&url).await?;
            legalos_api::install::creer_premier_administrateur(&pool, &cle, &mot_de_passe, &secret)
                .await
        })
        .inspect_err(|_| {
            eprintln!(
                "les secrets sont dans .env ; démarrez l'instance avec ce fichier, puis relancez cargo xtask install"
            );
        })?;
    let uri = legalos_api::install::uri_otpauth(&cree.email, &cree.secret_totp_base32);
    println!("administrateur créé (production, LEGALOS_MODE absent)");
    println!("email: {}", cree.email);
    println!("mot de passe: {}", cree.mot_de_passe);
    println!("secret TOTP (base32): {}", cree.secret_totp_base32);
    println!("otpauth: {uri}");
    Ok(())
}

struct SecretsInstall {
    chiffrement: String,
    postgres: String,
    garage_rpc: String,
    garage_admin: String,
    greenmail: String,
}

impl SecretsInstall {
    fn generer() -> Self {
        Self {
            chiffrement: cle_aleatoire(),
            postgres: mot_de_passe_aleatoire(),
            garage_rpc: hex_aleatoire(32),
            garage_admin: hex_aleatoire(32),
            greenmail: mot_de_passe_aleatoire(),
        }
    }
}

fn ecrire_env_production(root: &Path, secrets: &SecretsInstall) -> Result<()> {
    let modele = std::fs::read_to_string(root.join(".env.example")).context(".env.example")?;
    let mut lignes = Vec::new();
    for ligne in modele.lines() {
        if ligne.starts_with("LEGALOS_MODE=") {
            continue;
        }
        if let Some(valeur) = valeur_secrete_generee(ligne, secrets) {
            let nom = ligne.split_once('=').context("affectation")?.0;
            lignes.push(format!("{nom}={valeur}"));
            continue;
        }
        lignes.push(ligne.replace(
            "remplacer-mot-de-passe-fort-alphanumerique",
            &secrets.postgres,
        ));
    }
    std::fs::write(root.join(".env"), lignes.join("\n") + "\n")?;
    Ok(())
}

fn valeur_secrete_generee<'a>(ligne: &str, secrets: &'a SecretsInstall) -> Option<&'a str> {
    if ligne.starts_with("SECRETS_CHIFFREMENT_KEY=") {
        Some(secrets.chiffrement.as_str())
    } else if ligne.starts_with("POSTGRES_PASSWORD=") {
        Some(secrets.postgres.as_str())
    } else if ligne.starts_with("GARAGE_RPC_SECRET=") {
        Some(secrets.garage_rpc.as_str())
    } else if ligne.starts_with("GARAGE_ADMIN_TOKEN=") {
        Some(secrets.garage_admin.as_str())
    } else if ligne.starts_with("GREENMAIL_PASSWORD=") {
        Some(secrets.greenmail.as_str())
    } else {
        None
    }
}

fn hex_aleatoire(octets: usize) -> String {
    let mut buf = vec![0u8; octets];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn cle_aleatoire() -> String {
    const ALPHA: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut octets = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut octets);
    octets
        .into_iter()
        .map(|b| ALPHA[(b as usize) % ALPHA.len()] as char)
        .collect()
}

fn decoder_cle(raw: &str) -> Result<[u8; 32]> {
    if raw.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(raw.as_bytes());
        return Ok(key);
    }
    anyhow::bail!("SECRETS_CHIFFREMENT_KEY : 32 octets UTF-8 requis pour xtask install")
}

fn mot_de_passe_aleatoire() -> String {
    const ALPHA: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut octets = [0u8; 24];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut octets);
    octets
        .into_iter()
        .map(|b| ALPHA[(b as usize) % ALPHA.len()] as char)
        .collect()
}

fn secret_totp_aleatoire() -> Result<String> {
    let mut octets = [0u8; 20];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut octets);
    Ok(totp_rs::Secret::new(Box::new(octets)).to_base32())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let root = repo_root()?;
    match Cli::parse().command {
        Commands::CheckContracts => check_contracts(&root),
        Commands::Recette { scenario } => recette(&root, scenario.as_deref()),
        Commands::Demo => demo(&root),
        Commands::Install => install(&root),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::{ecrire_env_production, SecretsInstall};

    #[test]
    fn env_installe_sans_mode_developpement() {
        let tmp = std::env::temp_dir().join(format!("legalos-env-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).expect("tmp");
        std::fs::copy(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env.example"),
            tmp.join(".env.example"),
        )
        .expect("exemple");
        let secrets = SecretsInstall {
            chiffrement: "abcdefghijklmnopqrstuvwxyz012345".into(),
            postgres: "MotPostgresInstalle1234567890ab".into(),
            garage_rpc: "ab".repeat(32),
            garage_admin: "cd".repeat(32),
            greenmail: "MotMailInstalle1234567890abcd".into(),
        };
        ecrire_env_production(&tmp, &secrets).expect("écriture");
        let texte = std::fs::read_to_string(tmp.join(".env")).expect("lecture");
        assert!(!texte.lines().any(|l| l.starts_with("LEGALOS_MODE=")));
        assert!(texte.contains(&format!("SECRETS_CHIFFREMENT_KEY={}", secrets.chiffrement)));
        assert!(texte.contains(&format!("POSTGRES_PASSWORD={}", secrets.postgres)));
        assert!(texte.contains(&format!("GARAGE_RPC_SECRET={}", secrets.garage_rpc)));
        assert!(texte.contains(&format!("GARAGE_ADMIN_TOKEN={}", secrets.garage_admin)));
        assert!(texte.contains(&format!("GREENMAIL_PASSWORD={}", secrets.greenmail)));
        assert!(texte.contains(&format!(
            "postgresql://legalos:{}@localhost:5432/legalos",
            secrets.postgres
        )));
        for publie in [
            "legalos_example_key_32_bytes!!!!",
            "remplacer-mot-de-passe-fort-alphanumerique",
            "remplacer-mot-de-passe-mail-test",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        ] {
            assert!(
                !texte.contains(publie),
                "valeur publiée encore présente : {publie}"
            );
        }
        let _ = std::fs::remove_dir_all(tmp);
    }
}
