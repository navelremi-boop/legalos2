# LEGAL OS — Versions des dépendances

Vérifiées le **2026-09-26** (mise à jour Node / Rust image) et le **2026-09-24** pour le reste, dans la documentation officielle ou les registres publics (crates.io, npm, Docker Hub, docs produit). Ne pas modifier sans re-vérification à la date du jour.

## Poste (application desktop)

| Composant | Version figée | Source |
|-----------|---------------|--------|
| Tauri (crate) | **2.11.6** (stable ; ne pas prendre 3.0 alpha) | https://crates.io/crates/tauri |
| @tauri-apps/api | **2.11.1** (lockfile) | https://www.npmjs.com/package/@tauri-apps/api |
| @tauri-apps/cli | **2.11.5** (lockfile) | https://www.npmjs.com/package/@tauri-apps/cli |
| React | **19.3.0** (lockfile) | https://www.npmjs.com/package/react |
| TypeScript | **5.8.3** | https://www.npmjs.com/package/typescript |
| Vite | **8.3.0** | https://www.npmjs.com/package/vite |
| Tailwind CSS | **4.3.3** | https://www.npmjs.com/package/tailwindcss |
| @powersync/tauri-plugin | **0.0.6** | https://www.npmjs.com/package/@powersync/tauri-plugin — vérifié npm le 2026-09-25 |
| @powersync/common | **2.0.0** | dépendance exacte de `@powersync/tauri-plugin` 0.0.6 (npm, 2026-09-25) |
| @tabler/icons-react | **3.48.0** | https://www.npmjs.com/package/@tabler/icons-react — vérifié npm le 2026-09-26 (icônes contour § 7.3) |
| tauri-plugin-powersync | **0.0.6** | https://crates.io/crates/tauri-plugin-powersync — vérifié le 2026-09-25 ; dépend de `powersync` ^0.0.7 |
| powersync (crate Rust) | **0.0.7** | https://crates.io/crates/powersync — vérifié le 2026-09-25 |
| SDK web `@powersync/web` | **écart** : utilisé à tort jusqu'au 2026-09-25 ; retiré (cahier § 2.1) | https://docs.powersync.com/client-sdks/reference/tauri |
| pnpm | **12.6.0** | `packageManager` racine |
| Node.js (poste dev) | **24 LTS** (24.21.0 observé sur le poste) | https://nodejs.org — CI `actions/setup-node` alignée sur **24** |
| ESLint (flat config) | **9.39.x** (lockfile) | https://www.npmjs.com/package/eslint |
| typescript-eslint | **8.46.x** (lockfile) | https://www.npmjs.com/package/typescript-eslint |

## Instance (serveur)

| Composant | Version figée | Source |
|-----------|---------------|--------|
| PowerSync Service (Open Edition) | **journeyapps/powersync-service:1.26.1** | https://hub.docker.com/r/journeyapps/powersync-service/tags — vérifié 2026-09-26 (≥ 1.26.1 requis). **Sync Streams** `config.edition: 3` (`instance/powersync/sync-config.yaml`). Avis **GHSA-q6wc-xx4m-92fj** / CVE-2026-30870 : en **1.20.0** avec édition 3, certains filtres d’autorisation par sous-requête (sans partitionnement des lignes) étaient ignorés ; corrigé en **1.20.1**. Correctif **1.23.3** : conditions OR des sous-requêtes Sync Streams. Dette : vérification **mensuelle** des avis PowerSync (ligne PLAN). |
| PostgreSQL | **16.8-bookworm** | https://hub.docker.com/_/postgres |
| Caddy | **2.10.0-alpine** | https://hub.docker.com/_/caddy |
| Garage (S3) | **dxflrs/garage:v1.0.1** | https://hub.docker.com/r/dxflrs/garage |
| OpenDAL | **0.59.3** (`services-s3`) | https://crates.io/crates/opendal — vérifié le 2026-09-25 |
| GreenMail (IMAP/SMTP test) | **greenmail/standalone:2.1.0** | https://hub.docker.com/r/greenmail/standalone — capacités de la 2.1.0 (source `CapabilityCommand`) : LITERAL+, UIDPLUS, SORT, IDLE, MOVE. Pas de QRESYNC. |
| io-imap | **0.6.1** (version exacte, ne pas monter sans instruction de l'architecte) | https://crates.io/crates/io-imap/0.6.1 — vérifié le 2026-09-27 ; publié le 2026-09-26 ; licence MIT OR Apache-2.0 ; rust 1.88 ; Pimalaya |
| imap-codec | **2.0.0-alpha.8** (transitive d'io-imap, épinglée en dépendance directe ; ne pas monter sans instruction de l'architecte) | https://crates.io/crates/imap-codec/2.0.0-alpha.8 — vérifié le 2026-09-27 ; publié le 2026-06-03 ; licence MIT OR Apache-2.0. L'exigence d'io-imap est `^2.0.0-alpha.8`, qui accepterait la 2.0.0-alpha.9 du 2026-07-19 : le dépôt la refuse. |
| Dovecot (second serveur IMAP de test, chemin QRESYNC) | **dovecot/dovecot:2.3.21.1** | https://hub.docker.com/r/dovecot/dovecot — `instance/imap-test/` |
| Axum | **0.8.9** | https://crates.io/crates/axum |
| sqlx | **0.8.5** | https://crates.io/crates/sqlx |
| Tokio | **1.44.2** | https://crates.io/crates/tokio |
| utoipa | **5.3.1** | https://crates.io/crates/utoipa |
| argon2 | **0.6.0** | https://crates.io/crates/argon2 |
| jsonwebtoken | **11.1.0** | https://crates.io/crates/jsonwebtoken — vérifié le 2026-09-25 ; `default-features = false` ; fournisseur cryptographique **`rust_crypto`** ; PEM via feature explicite `use_pem` |
| totp-rs | **6.0.0** | https://crates.io/crates/totp-rs |
| rsa (JWT RS256) | **0.9.8** | https://crates.io/crates/rsa |
| keyring (trousseau poste) | **3.6.3** | https://crates.io/crates/keyring — vérifié le 2026-09-25. Pas de feature `default` : sans feature, le crate utilise le magasin factice `mock`. Features explicites **`windows-native`** (Credential Manager) et **`apple-native`** (Keychain). |
| Typst (PDF) | **0.14.0** | https://github.com/typst/typst/releases/tag/v0.14.0 — PDF/A-3b et `pdf.attach` |
| Saxon-HE | **12.5** | https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/12.5/ |
| veraPDF greenfield | **1.28.2** | https://software.verapdf.org/releases/1.28/ |
| Schematron EN 16931 CII | **1.3.16** | https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/tag/validation-1.3.16 — XSLT EUPL 1.2 |
| LLVM / libclang (bindgen `powersync_sqlite_nostd`) | **23.1.2** | https://github.com/llvm/llvm-project — installé le 2026-09-25 via winget `LLVM.LLVM`. `LIBCLANG_PATH` = répertoire de `libclang.dll` (`C:\Program Files\LLVM\bin` sur ce poste). |
| Rust toolchain | **stable** (`rust-toolchain.toml`) — **1.98.1** observé sur le poste 2026-09-26 | https://rust-lang.org |
| Rust (image build API) | **rust:1.98.1-bookworm** (alignée sur la toolchain du dépôt) | https://hub.docker.com/_/rust |
| Images compose LEGAL OS | **legalos/api:0.1.0**, **legalos/caddy:2.10.0-alpine**, **legalos/simulateur-pa:s1-stub** (build local, pas de `latest`) | `instance/docker-compose.yml` |

## Outils CI (cibles)

| Outil | Usage |
|-------|--------|
| veraPDF | PDF/A-3b factures |
| Schematron EN 16931 | XML Factur-X |
| Playwright | Captures S13 |
| WebdriverIO + Tauri | Fumée app construite (feature test uniquement) |

## Actions GitHub (à épingler dans `.github/workflows/`)

| Action | Version |
|--------|---------|
| actions/checkout | v4.2.2 |
| actions/setup-node | v4.4.0 |
| dtolnay/rust-toolchain | stable (via fichier repo) |
| pnpm/action-setup | v4.1.0 |
