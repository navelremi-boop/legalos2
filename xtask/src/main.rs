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
    /// Charge les données de démonstration fictives.
    Demo,
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
        "docs/sync-rules.md",
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
            "fichier .env absent à la racine — copier .env.example vers .env et harmoniser POSTGRES_PASSWORD / DATABASE_URL / PS_*"
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
        Commands::Demo => anyhow::bail!("demo not implemented yet"),
    }
}
