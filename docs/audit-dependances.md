# Audit des dépendances Rust

Dette de la phase 2 (`PLAN.md`) **décochée le 20/10/2026** par l'architecte : elle avait été cochée le 29/09/2026 alors que la CI n'exécutait que l'essai négatif `tests/recette/deny-exception-inutile.mjs` et jamais `cargo deny check` (le workspace racine échouait en local). Soldée le 20/10/2026 : `cargo deny check` s'exécute désormais dans le job `rust` sur les deux workspaces (voir « Constat du 20 octobre 2026 »). Installation de `cargo-deny` 0.20.2 contrôlée par SHA-256. Signalement PowerSync / `time` 0.2 : [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129).

## Outil et politique

- `cargo-deny` 0.20.2 (`docs/versions.md`), base d'avis RustSec récupérée à chaque exécution.
- Workspace racine (API, domaine, stockage, xtask) : `deny.toml`.
  `cargo deny --manifest-path Cargo.toml check`
- Poste Tauri, sur les plateformes livrées (Windows, macOS) : `apps/poste/src-tauri/deny.toml`.
  `cargo deny --manifest-path apps/poste/src-tauri/Cargo.toml --config apps/poste/src-tauri/deny.toml check`
- Avis bloquants : vulnérabilités, notices, crates non maintenus, versions retirées du registre. « Unsound » : réglage par défaut de l'outil (dépendances directes).
- Licences admises : permissives (Apache-2.0, MIT, BSD, ISC, Zlib, Unicode-3.0, etc.) et MPL-2.0 (crates Servo tirés par Tauri, copyleft limité aux fichiers). Crates du dépôt exclus du contrôle de licence (`publish = false`).
- Sources : crates.io seulement. Versions génériques interdites, sauf chemins locaux (correctifs `apps/poste/src-tauri/patches/`).
- Exceptions d'avis du poste : aucune depuis le 2026-10-04. `tauri-plugin-powersync` 0.1.0 retire la chaîne http-client. `unused-ignored-advisory = "deny"` : une exception devenue inutile fait échouer le contrôle. Essai négatif en CI : `node tests/recette/deny-exception-inutile.mjs` (identifiant fictif `RUSTSEC-2099-0001`). Les avis `unic-*` et `rsa` ne sont pas des exceptions.

## Constat du 20 octobre 2026 (consigne de l'architecte)

Commandes exécutées le 20/10/2026 avant correction : `cargo deny --manifest-path Cargo.toml check` (exit 1) et `cargo deny --manifest-path apps/poste/src-tauri/Cargo.toml --config apps/poste/src-tauri/deny.toml check` (exit 1). Après correction, les deux sortent à 0 (`advisories ok, bans ok, licenses ok, sources ok`).

| Avis | Crate (workspace) | Traitement |
|---|---|---|
| RUSTSEC-2023-0071 (« Marvin Attack ») | `rsa` 0.9.10 (racine) | `jsonwebtoken` sur le moteur `aws_lc_rs` ; la crate `rsa` n'est plus une dépendance de l'API : clé RS256 générée, lue et publiée (JWKS) par `aws-lc-rs` 1.18.1 (`crates/api/src/auth/jwt.rs`). Le `kid` devient l'empreinte RFC 7638 de la clé |
| RUSTSEC-2026-0346 à 0349 (TLS) | `rustls` 0.23.45 (racine et poste) | `cargo update -p rustls` : 0.23.46 dans les deux `Cargo.lock` |
| RUSTSEC-2021-0157, -0158 et RUSTSEC-2026-0373 (XSS, CSS) | `ammonia` 4.2.0 (racine, nettoyage du HTML des mails) | épinglage exact passé à 4.2.4 ; tests du nettoyage de `legalos-messagerie` verts |
| RUSTSEC-2026-0367 à 0369 (`zip`) | `zip` 8.6.0 (API, lecture des docx) et 3.0.0 (build de `utoipa-swagger-ui` 9) | `zip` 9.0.2 (API : `ZipArchive::new` et `by_name` seulement, aucun changement de code) ; `utoipa` 6.0.0 et `utoipa-swagger-ui` 10.0.2, qui utilise `zip` 9, sans autre changement de code. Plus qu'une version de `zip` dans le lock |
| Version retirée du registre | `yoke-derive` 0.8.3 (racine) | `cargo update -p yoke-derive` : 0.8.4 |
| RUSTSEC-2026-0192, non maintenu | `ttf-parser` 0.25.1 (racine) | **exception nominative datée du 2026-10-20** dans `deny.toml` : aucune version corrigée, aucune faille connue ; vient de `lopdf` 0.42 que `pdf-extract` 0.12.1 (dernière version) impose ; `lopdf` 0.45 ne l'utilise plus. Ne sert qu'à l'extraction du texte d'un PDF pour l'indexation. À lever dès qu'un `pdf-extract` accepte `lopdf` 0.45 ou plus ; `unused-ignored-advisory = "deny"` fait alors échouer le contrôle. Alternative écartée : retirer `pdf-extract` pour l'extraction plus pauvre de `lopdf` seul, qui dégraderait l'indexation des PDF |

Poste : seuls les quatre avis `rustls` ressortaient ; aucune exception d'avis (`ignore = []`).

CI : le job `rust` exécute `cargo deny --manifest-path Cargo.toml check` et `cargo deny --manifest-path apps/poste/src-tauri/Cargo.toml --config apps/poste/src-tauri/deny.toml check`, puis l'essai négatif de l'exception inutile. La base d'avis RustSec est relue à chaque exécution : un nouvel avis fait échouer la CI, ce qui est voulu.

## Constat du 27 septembre 2026 (historique, traité le 20/10/2026 pour la racine)

### Workspace racine

Licences, interdits et sources : conformes. Un avis :

| Avis | Crate | Origine | Traitement |
|---|---|---|---|
| RUSTSEC-2023-0071, vulnérabilité (« Marvin Attack ») | `rsa` 0.9.10 | dépendance directe de l'API (`auth/jwt.rs`) et moteur `rust_crypto` de `jsonwebtoken` 11.1.0 | moteur `aws_lc_rs` de `jsonwebtoken` et retrait du crate `rsa` |

L'implémentation RSA de `rsa` n'est pas à temps constant : la clé privée peut se déduire du temps des opérations, mesuré à travers le réseau. L'API signe avec cette clé chaque jeton d'accès, de session et de renouvellement. Une clé retrouvée permettrait de forger des jetons acceptés par PowerSync, donc de lire les données synchronisées d'un cabinet (invariant n° 1).

Le correctif garde `jsonwebtoken` et RS256 (cahier § 2.2 : « argon2 + jsonwebtoken + totp-rs », JWKS exposé à PowerSync) et change seulement de moteur : aws-lc-rs 1.18.1 est déjà dans le graphe de l'API par rustls (reqwest, OpenDAL), sans nouvelle dépendance. Alternatives écartées :
- passer en EdDSA avec le moteur `rust_crypto` : `rsa` resterait dans le graphe, car ce moteur l'active toujours ;
- ignorer l'avis : la clé est exposée à travers le réseau.

### Poste Tauri (Windows, macOS)

Licences, interdits et sources : conformes. Neuf avis :

| Avis | Crate | Origine | Traitement |
|---|---|---|---|
| RUSTSEC-2025-0081, -0075, -0080, -0100, -0098, non maintenus | `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version` 0.9.0 | `tauri-utils` 2.9.3, puis `urlpattern` 0.3 | `tauri-utils` 2.10.0 (publié le 26/09/2026) passe à `urlpattern` 0.6 ; montée de Tauri dans un lot poste dédié, recettes Tauri rejouées |
| RUSTSEC-2025-0052, non maintenu | `async-std` 1.13.2 | chaîne vérifiée ci-dessous | exception, [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129) |
| RUSTSEC-2021-0060, non maintenu | `aes-soft` 0.6.4 | même chaîne, `aes-gcm` 0.8.0 | exception, même issue |
| RUSTSEC-2021-0064, non maintenu | `cpuid-bool` 0.2.0 | même chaîne, `aes-gcm` 0.8.0 | exception, même issue |
| RUSTSEC-2026-0174, notice | `http-types` 2.12.0 | même chaîne | exception, même issue |

Même chaîne, hors avis bloquants : `rand` 0.7.3 (RUSTSEC-2026-0097, « unsound » avec un journaliseur personnalisé qui appelle `rand::rng()`, cas absent du poste) et `time` 0.2.27, dont les macros ne compilent plus avec Rust 1.98 (correctifs locaux depuis la phase 1, `docs/journal/phase-1.md`).

Hors plateformes livrées (Linux, wasm), donc non retenus : `proc-macro-error` (GTK), `stdweb`, `instant`, `aesni`.

Dernières versions sur crates.io au 27/09/2026 : `tauri-plugin-powersync` 0.0.6 (3 août 2026), `powersync` 0.0.7, `http-client` 6.5.3 (20 juin 2022). Aucune ne corrige la chaîne.

### Chaîne vérifiée (2026-09-28)

Sources : `Cargo.toml` publié de `tauri-plugin-powersync` 0.0.6, `http-types` 2.12.0 et `cookie` 0.14.4 ; `apps/poste/src-tauri/Cargo.lock` ; seul appel dans les sources du plugin.

`tauri-plugin-powersync` 0.0.6 → `http-client` 6.5.3 (`default-features = false`) → `http-types` 2.12 (fonctionnalités par défaut `fs` et `cookie-secure`) → `async-std`, `cookie` 0.14 → `aes-gcm` 0.8 (`aes-soft`, `cpuid-bool`) et `time` 0.2.

L'unique usage est `commands.rs:5` : `use http_client::http_types::convert::Serialize`.

`fs` active `async-std`. `cookie-secure` active `cookie/secure`, donc `aes-gcm` 0.8.0, dont `aes` 0.6 tire `aes-soft` et dont `ghash` / `polyval` tire `cpuid-bool`. `cookie` 0.14 dépend de `time` 0.2 même sans la fonctionnalité `secure`.

Avis de cette chaîne : RUSTSEC-2025-0052, RUSTSEC-2021-0060, RUSTSEC-2021-0064, RUSTSEC-2026-0174.

## Signalement transmis

Déposé par le commandement le 28/09/2026 : [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). Texte déposé, en anglais :

> **tauri-plugin-powersync 0.0.6 pulls an unmaintained HTTP stack (http-client 6 / http-types 2 / time 0.2)**
>
> `tauri-plugin-powersync` 0.0.6, the latest release on crates.io, depends on `http-client` 6.5.3, last released on 2022-06-20. Through `http-types` 2.12.0 it brings crates flagged by the RustSec advisory database (cargo-deny 0.20.2, database as of 2026-09-27, targets `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`):
>
> - RUSTSEC-2025-0052: `async-std` 1.13.2 is discontinued;
> - RUSTSEC-2026-0174: `http-types` 2.12.0, `Authorization::value` and `WwwAuthenticate::value` can violate ASCII invariants;
> - RUSTSEC-2021-0060: `aes-soft` 0.6.4 is unmaintained (via `cookie` 0.14.4 and `aes-gcm` 0.8.0);
> - RUSTSEC-2021-0064: `cpuid-bool` 0.2.0 is unmaintained (same path);
> - RUSTSEC-2026-0097: `rand` 0.7.3 is unsound under specific logger conditions.
>
> In addition, `cookie` 0.14.4 depends on `time` 0.2.27, whose `time-macros` and `time-macros-impl` crates (built on `proc-macro-hack`) no longer compile with stable Rust 1.98. Building the plugin currently requires patching them.
>
> Dependency path: `tauri-plugin-powersync` 0.0.6 → `http-client` 6.5.3 → `http-types` 2.12.0 → `async-std`, `rand` 0.7.3, `cookie` 0.14.4 → `time` 0.2.27, `aes-gcm` 0.8.0.
>
> Would you consider moving the plugin's HTTP layer to a maintained client, or making the HTTP client pluggable without depending on `http-types`?

## Constat du 4 octobre 2026

`tauri-plugin-powersync` 0.1.0 (crates.io, publié le 2026-10-01) et `powersync` 0.1.0 (publié le 2026-09-28) remplacent la 0.0.6. Le plugin dépend de `reqwest` 0.13. Le `Cargo.lock` du poste ne contient plus `http-client`, `http-types`, `async-std`, `aes-soft`, `cpuid-bool`, `time` 0.2 ni `rand` 0.7.3. Les quatre exceptions sont retirées de `deny.toml`. Les rustines `patches/time-macros` et `patches/time-macros-impl` sont retirées. Le paquet npm `@powersync/tauri-plugin` reste en 0.0.6 : aucune 0.1 n'est publiée. Le connecteur Rust compile tel quel avec le trait `BackendConnector` 0.1.0.

## Constat du 22 octobre 2026 : avis RUSTSEC-2026-0382 et RUSTSEC-2026-0383

La CI (run 39840437726 sur `049ac20`) a échoué à `cargo deny check` sur le workspace racine : deux avis publiés après le passage local du 20/10 (base d'avis relue à chaque exécution). Les deux concernent des racines emSign dont les clés privées d'intermédiaires sont connues.

| Avis | Crate | Version avant | Version après | Chemin |
|---|---|---|---|---|
| RUSTSEC-2026-0382 | `rustls-webpki` | 0.103.15 | 0.103.16 | `rustls` 0.23.46 → `reqwest` (opendal), `lettre`, `pimalaya-stream` (io-imap) |
| RUSTSEC-2026-0383 | `webpki-root-certs` | 1.0.9 | 1.0.10 | `rustls-platform-verifier` 0.7.1 → `pimalaya-stream` |

Correctif : `cargo update -p rustls-webpki` et `cargo update -p webpki-root-certs`, sur le workspace racine et sur celui du poste (mêmes versions dans les deux verrous). Aucune exception ajoutée. Après : `cargo deny check` exit 0 (advisories, bans, licenses, sources ok) sur les deux workspaces.

## Constat du 24 octobre 2026 : avis RUSTSEC-2026-0385 et RUSTSEC-2026-0386

La CI (run 40082268071 sur `39bab73`) a échoué de nouveau à `cargo deny check` sur le workspace racine : deux avis publiés depuis le passage du 22/10.

| Avis | Crate | Version avant | Version après | Chemin |
|---|---|---|---|---|
| RUSTSEC-2026-0385 (comparaisons `u128` et masques non constants dans le temps) | `ctutils` | 0.4.2 | 0.4.5 | dépendance de la chaîne de chiffrement du workspace racine (absente du workspace du poste) |
| RUSTSEC-2026-0386 (`AsyncFd::new` viole la sûreté des E/S) | `tokio` | 1.53.1 | 1.54.1 | `axum`, `legalos-api`, `legalos-messagerie` ; workspace racine et workspace du poste |

Correctif : `cargo update -p ctutils` et `cargo update -p tokio` (racine), `cargo update -p tokio` (poste). Aucune exception ajoutée. Après : `cargo deny check` exit 0 (advisories, bans, licenses, sources ok) sur les deux workspaces. `tokio` passe d'une version mineure (1.53 → 1.54) : `cargo test --workspace` repassé en entier.

Constat sur le processus : la base d'avis évolue entre deux passages ; un `cargo deny check` local vert ne vaut que pour l'heure de sa lecture. La CI le relit à chaque poussée, ce qui est le contrôle voulu.
