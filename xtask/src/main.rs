//! LEGAL OS — commandes dépôt (recette, démo). Multiplateforme, sans bash.

use std::io::{BufRead, IsTerminal, Write};
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
        ecrire_env_production(root, &SecretsInstall::generer()?)?;
    }
    if std::io::stdin().is_terminal() {
        demander_oauth(
            &env_path,
            &mut std::io::stdin().lock(),
            &mut std::io::stdout(),
        )?;
    } else {
        println!(
            "Identifiants OAuth non demandés (entrée non interactive) : voir docs/oauth-messagerie.md."
        );
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

/// Variables d'application OAuth de l'instance (`docs/oauth-messagerie.md`) : nom, question posée à l'installation.
/// Toutes facultatives : une variable vide laisse le fournisseur non proposé.
const VARIABLES_OAUTH: [(&str, &str); 5] = [
    (
        "LEGALOS_OAUTH_MICROSOFT_CLIENT_ID",
        "Microsoft 365 : identifiant d'application (client ID)",
    ),
    (
        "LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET",
        "Microsoft 365 : secret client (facultatif, saisie visible)",
    ),
    (
        "LEGALOS_OAUTH_MICROSOFT_TENANT",
        "Microsoft 365 : locataire (tenant), « common » si vide",
    ),
    (
        "LEGALOS_OAUTH_GMAIL_CLIENT_ID",
        "Gmail : identifiant client OAuth (type application de bureau)",
    ),
    (
        "LEGALOS_OAUTH_GMAIL_CLIENT_SECRET",
        "Gmail : secret client (facultatif, saisie visible)",
    ),
];

/// Une valeur d'application OAuth s'écrit dans `.env` et passe par l'interpolation de docker compose : lettres, chiffres,
/// point, tiret, soulignement et tilde seulement (les identifiants Microsoft et Google n'en contiennent pas d'autres).
fn valeur_oauth_valide(valeur: &str) -> bool {
    !valeur.is_empty()
        && valeur.len() <= 300
        && valeur
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '-'))
}

/// Valeur non vide de `NOM=` dans le texte d'un `.env`.
fn valeur_env(texte: &str, nom: &str) -> Option<String> {
    texte
        .lines()
        .find_map(|ligne| ligne.strip_prefix(&format!("{nom}=")))
        .map(|valeur| valeur.trim().to_owned())
        .filter(|valeur| !valeur.is_empty())
}

/// Écrit `NOM=valeur` dans le texte d'un `.env` : remplace la ligne si elle existe (même vide), sinon l'ajoute.
fn poser_valeur_env(texte: &str, nom: &str, valeur: &str) -> String {
    let debut = format!("{nom}=");
    let mut present = false;
    let mut lignes: Vec<String> = texte
        .lines()
        .map(|ligne| {
            if ligne.starts_with(&debut) {
                present = true;
                format!("{nom}={valeur}")
            } else {
                ligne.to_owned()
            }
        })
        .collect();
    if !present {
        lignes.push(format!("{nom}={valeur}"));
    }
    lignes.join("\n") + "\n"
}

/// Demande à l'installation les identifiants d'application OAuth (Microsoft 365, Gmail) et les écrit dans `.env`.
/// Facultatif : une réponse vide ignore la question. Une variable déjà renseignée n'est pas redemandée. Une valeur
/// refusée n'est pas écrite. Aucune valeur n'est réaffichée. Rend le nombre de variables écrites.
fn demander_oauth(
    env_path: &Path,
    entree: &mut impl BufRead,
    sortie: &mut impl Write,
) -> Result<usize> {
    let mut texte = std::fs::read_to_string(env_path).context(".env")?;
    writeln!(
        sortie,
        "Applications OAuth des boîtes Microsoft 365 et Gmail (facultatif, voir docs/oauth-messagerie.md)."
    )?;
    writeln!(
        sortie,
        "Laissez vide pour ignorer : le fournisseur n'est alors pas proposé."
    )?;
    let mut ecrites = 0;
    for (nom, question) in VARIABLES_OAUTH {
        if valeur_env(&texte, nom).is_some() {
            writeln!(sortie, "{nom} est déjà renseigné, conservé.")?;
            continue;
        }
        write!(sortie, "{question} : ")?;
        sortie.flush()?;
        let mut ligne = String::new();
        if entree.read_line(&mut ligne)? == 0 {
            writeln!(sortie)?;
            break;
        }
        let valeur = ligne.trim();
        if valeur.is_empty() {
            continue;
        }
        if !valeur_oauth_valide(valeur) {
            writeln!(
                sortie,
                "Valeur refusée pour {nom} (lettres, chiffres, point, tiret, soulignement et tilde seulement) ; ligne ignorée."
            )?;
            continue;
        }
        texte = poser_valeur_env(&texte, nom, valeur);
        ecrites += 1;
    }
    if ecrites > 0 {
        std::fs::write(env_path, texte)?;
        writeln!(sortie, "{ecrites} variable(s) OAuth écrite(s) dans .env.")?;
    }
    Ok(ecrites)
}

struct SecretsInstall {
    chiffrement: String,
    postgres: String,
    garage_rpc: String,
    garage_admin: String,
    greenmail: String,
    jwt_cle: String,
}

impl SecretsInstall {
    fn generer() -> Result<Self> {
        Ok(Self {
            chiffrement: cle_aleatoire(),
            postgres: mot_de_passe_aleatoire(),
            garage_rpc: hex_aleatoire(32),
            garage_admin: hex_aleatoire(32),
            greenmail: mot_de_passe_aleatoire(),
            jwt_cle: legalos_api::auth::jwt::JwtKeys::generer_pour_env()?,
        })
    }
}

fn ecrire_env_production(root: &Path, secrets: &SecretsInstall) -> Result<()> {
    let modele = std::fs::read_to_string(root.join(".env.example")).context(".env.example")?;
    let mut lignes = Vec::new();
    let mut cle_jwt_ecrite = false;
    for ligne in modele.lines() {
        if ligne.starts_with("LEGALOS_MODE=") {
            continue;
        }
        if let Some(valeur) = valeur_secrete_generee(ligne, secrets) {
            let nom = ligne.split_once('=').context("affectation")?.0;
            cle_jwt_ecrite |= nom == "JWT_RSA_PRIVATE_KEY_PEM";
            lignes.push(format!("{nom}={valeur}"));
            continue;
        }
        lignes.push(ligne.replace(
            "remplacer-mot-de-passe-fort-alphanumerique",
            &secrets.postgres,
        ));
    }
    if !cle_jwt_ecrite {
        lignes.push(format!("JWT_RSA_PRIVATE_KEY_PEM={}", secrets.jwt_cle));
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
    } else if ligne.starts_with("JWT_RSA_PRIVATE_KEY_PEM=") {
        Some(secrets.jwt_cle.as_str())
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
    use super::{demander_oauth, ecrire_env_production, valeur_oauth_valide, SecretsInstall};
    use std::io::Cursor;
    use std::path::PathBuf;

    /// `.env` jetable (valeurs fictives) et son chemin.
    fn env_jetable(nom: &str, contenu: &str) -> PathBuf {
        let dossier =
            std::env::temp_dir().join(format!("legalos-oauth-{nom}-{}", std::process::id()));
        std::fs::create_dir_all(&dossier).expect("tmp");
        let chemin = dossier.join(".env");
        std::fs::write(&chemin, contenu).expect("écriture");
        chemin
    }

    fn saisir(chemin: &std::path::Path, reponses: &str) -> (usize, String) {
        let mut entree = Cursor::new(reponses.as_bytes().to_vec());
        let mut sortie = Vec::new();
        let ecrites = demander_oauth(chemin, &mut entree, &mut sortie).expect("demande");
        (ecrites, String::from_utf8(sortie).expect("sortie"))
    }

    #[test]
    fn install_oauth_ecrit_les_identifiants_saisis() {
        let chemin = env_jetable(
            "saisie",
            "POSTGRES_PASSWORD=fictif\nLEGALOS_OAUTH_GMAIL_CLIENT_ID=\n",
        );
        // Ordre des questions : Microsoft (identifiant, secret, locataire) puis Gmail (identifiant, secret).
        let (ecrites, sortie) = saisir(
            &chemin,
            "app-ms-fictive\n\ntenant-fictif\ngmail-fictif.apps\nGOCSPX-secret_fictif\n",
        );
        assert_eq!(ecrites, 4, "quatre réponses non vides : {sortie}");
        let texte = std::fs::read_to_string(&chemin).expect("lecture");
        assert!(texte.contains("LEGALOS_OAUTH_MICROSOFT_CLIENT_ID=app-ms-fictive\n"));
        assert!(texte.contains("LEGALOS_OAUTH_MICROSOFT_TENANT=tenant-fictif\n"));
        // La ligne vide existante est remplacée, pas dupliquée.
        assert_eq!(texte.matches("LEGALOS_OAUTH_GMAIL_CLIENT_ID=").count(), 1);
        assert!(texte.contains("LEGALOS_OAUTH_GMAIL_CLIENT_ID=gmail-fictif.apps\n"));
        assert!(texte.contains("LEGALOS_OAUTH_GMAIL_CLIENT_SECRET=GOCSPX-secret_fictif\n"));
        // Essai négatif : la réponse vide du secret Microsoft n'a rien écrit ; le reste du fichier est intact.
        assert!(!texte.contains("LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET="));
        assert!(texte.starts_with("POSTGRES_PASSWORD=fictif\n"));
        // Aucune valeur saisie n'est réaffichée (ni dans les questions, ni dans le bilan).
        for valeur in [
            "app-ms-fictive",
            "tenant-fictif",
            "gmail-fictif.apps",
            "GOCSPX-secret_fictif",
        ] {
            assert!(!sortie.contains(valeur), "valeur réaffichée : {valeur}");
        }
    }

    #[test]
    fn install_oauth_entree_vide_n_ecrit_rien() {
        let origine = "POSTGRES_PASSWORD=fictif\n";
        let chemin = env_jetable("vide", origine);
        let (ecrites, _) = saisir(&chemin, "\n\n\n\n\n");
        assert_eq!(ecrites, 0);
        assert_eq!(
            std::fs::read_to_string(&chemin).expect("lecture"),
            origine,
            "fichier inchangé"
        );
        // Fin de l'entrée (installation sans saisie) : rien d'écrit non plus.
        let (ecrites, _) = saisir(&chemin, "");
        assert_eq!(ecrites, 0);
        assert_eq!(std::fs::read_to_string(&chemin).expect("lecture"), origine);
    }

    #[test]
    fn install_oauth_refuse_les_valeurs_dangereuses() {
        let origine = "POSTGRES_PASSWORD=fictif\n";
        let chemin = env_jetable("refus", origine);
        // Espace, guillemet, dollar (interpolation de docker compose), retour de ligne glissé, égal : refusés.
        let (ecrites, sortie) = saisir(&chemin, "a b\n\"x\"\n$HOME\nx=y\nz;rm\n");
        assert_eq!(ecrites, 0, "{sortie}");
        assert_eq!(std::fs::read_to_string(&chemin).expect("lecture"), origine);
        assert_eq!(sortie.matches("Valeur refusée").count(), 5);
        // Contrôle positif : des valeurs ordinaires passent.
        assert!(valeur_oauth_valide("0b3a1c7e-1111-2222-3333-444455556666"));
        assert!(valeur_oauth_valide("GOCSPX-abc_DEF.123~"));
        assert!(!valeur_oauth_valide(""));
        assert!(!valeur_oauth_valide(&"a".repeat(301)));
    }

    #[test]
    fn install_oauth_ne_redemande_pas_ce_qui_est_deja_renseigne() {
        let chemin = env_jetable(
            "deja",
            "LEGALOS_OAUTH_GMAIL_CLIENT_ID=deja-la\nLEGALOS_OAUTH_GMAIL_CLIENT_SECRET=\n",
        );
        // Quatre questions seulement (Gmail identifiant déjà là) : la première réponse va à l'identifiant Microsoft.
        let (ecrites, sortie) = saisir(&chemin, "ms-neuf\n\n\n\n");
        assert_eq!(ecrites, 1, "{sortie}");
        assert!(sortie.contains("LEGALOS_OAUTH_GMAIL_CLIENT_ID est déjà renseigné"));
        let texte = std::fs::read_to_string(&chemin).expect("lecture");
        assert!(
            texte.contains("LEGALOS_OAUTH_GMAIL_CLIENT_ID=deja-la\n"),
            "valeur existante conservée"
        );
        assert!(texte.contains("LEGALOS_OAUTH_MICROSOFT_CLIENT_ID=ms-neuf\n"));
    }

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
            jwt_cle: legalos_api::auth::jwt::JwtKeys::generer_pour_env().expect("clé"),
        };
        ecrire_env_production(&tmp, &secrets).expect("écriture");
        let texte = std::fs::read_to_string(tmp.join(".env")).expect("lecture");
        assert!(!texte.lines().any(|l| l.starts_with("LEGALOS_MODE=")));
        assert!(texte.contains(&format!("SECRETS_CHIFFREMENT_KEY={}", secrets.chiffrement)));
        assert!(texte.contains(&format!("POSTGRES_PASSWORD={}", secrets.postgres)));
        assert!(texte.contains(&format!("GARAGE_RPC_SECRET={}", secrets.garage_rpc)));
        assert!(texte.contains(&format!("GARAGE_ADMIN_TOKEN={}", secrets.garage_admin)));
        assert!(texte.contains(&format!("GREENMAIL_PASSWORD={}", secrets.greenmail)));
        assert!(texte.contains(&format!("JWT_RSA_PRIVATE_KEY_PEM={}", secrets.jwt_cle)));
        assert!(
            legalos_api::auth::jwt::JwtKeys::from_rsa_pem(&secrets.jwt_cle).is_ok(),
            "la clé écrite par l'installation doit être relisible"
        );
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
