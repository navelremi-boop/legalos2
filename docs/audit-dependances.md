# Audit des dépendances Rust

Dette de la phase 2 (`PLAN.md`) cochée le 29/09/2026 : `cargo-deny` 0.20.2 est dans le job `rust` (installation contrôlée par SHA-256, essai négatif `tests/recette/deny-exception-inutile.mjs`). Preuve d'exécution : run [36572546272](https://github.com/navelremi-boop/legalos2/actions/runs/36572546272). Signalement PowerSync / `time` 0.2 : [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). Les avis `unic-*` et `rsa` restent hors exceptions.

## Outil et politique

- `cargo-deny` 0.20.2 (`docs/versions.md`), base d'avis RustSec récupérée à chaque exécution.
- Workspace racine (API, domaine, stockage, xtask) : `deny.toml`.
  `cargo deny --manifest-path Cargo.toml check`
- Poste Tauri, sur les plateformes livrées (Windows, macOS) : `apps/poste/src-tauri/deny.toml`.
  `cargo deny --manifest-path apps/poste/src-tauri/Cargo.toml --config apps/poste/src-tauri/deny.toml check`
- Avis bloquants : vulnérabilités, notices, crates non maintenus, versions retirées du registre. « Unsound » : réglage par défaut de l'outil (dépendances directes).
- Licences admises : permissives (Apache-2.0, MIT, BSD, ISC, Zlib, Unicode-3.0, etc.) et MPL-2.0 (crates Servo tirés par Tauri, copyleft limité aux fichiers). Crates du dépôt exclus du contrôle de licence (`publish = false`).
- Sources : crates.io seulement. Versions génériques interdites, sauf chemins locaux (correctifs `apps/poste/src-tauri/patches/`).
- Exceptions d'avis, seulement les quatre de la chaîne PowerSync du poste, chacune nominative et renvoyant à [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). `unused-ignored-advisory = "deny"` : une exception devenue inutile fait échouer le contrôle. Essai négatif en CI : `node tests/recette/deny-exception-inutile.mjs` (identifiant fictif `RUSTSEC-2099-0001`). Les avis `unic-*` et `rsa` ne sont pas des exceptions.

## Constat du 27 septembre 2026

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
