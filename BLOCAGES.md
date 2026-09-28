# LEGAL OS — Blocages (actions attendues du commandement)

| ID | Obstacle | Action exacte attendue | Impact |
|----|----------|------------------------|--------|
| B2 | ~~MSVC `link.exe` / outils C++~~ | **Levé 2026-09-26** : Visual Studio Community 18 installé (`C:\Program Files\Microsoft Visual Studio\18\Community`) ; toolchain `stable-x86_64-pc-windows-msvc` ; `cargo clippy` et binaires natifs OK. Si `link.exe` manque du PATH de l’agent : `.\scripts\clippy.ps1` ou Developer Command Prompt. | — |
| B2b | ~~Visual Studio (IDE) ne s’ouvre pas~~ | **Levé 2026-09-26** : installateur et charge C++ présents ; les builds natifs passent sans ouvrir l’IDE. | — |
| B3 | ~~Docker Desktop — moteur KO~~ | **Levé 2026-09-24 (soir)** : moteur actif ; `docker compose up --wait` S1 → 7 services **healthy**. | — |
| B4 | ~~GitHub remote / CI~~ | **Levé 2026-09-24** : `origin` → `https://github.com/navelremi-boop/legalos2.git`, commit `3f8696b`, CI **verte** (run push `main`). | — |
| B6 | Compte Apple Developer | Non disponible | S14b ad hoc |
| B7 | SUPER PDP réel | Simulateur dans `instance/` | Prod |
| B8 | Boîtes mail réelles | GreenMail | Tests mail |
| B9 | Écrans non maquettés (cahier § 7.6) | **La journée** : validée par l'architecte le 27/09/2026, sous réserve des captures régénérées sans points médians (validation de la Coque). **Autres écrans** : la validation sur captures est déléguée à l'architecte ; le commandement garde son veto. | Le développement continue ; les captures de la Coque et de J10 restent à produire |
| B10 | Revue juridique par l'avocat avant toute mise en service réelle | Relire, avant une mise en service réelle, les délais **H1–H13**, la facturation **F0–F8** et les hypothèses d'**installation**, déjà retenus à titre provisoire par l'architecte le 27/09/2026. Voir `docs/hypotheses-delais.md`, `docs/hypotheses-facturation.md`, `docs/hypotheses-installation.md` et `RAPPORT.md`. | Ne bloque plus le développement |
| B11 | ~~Texte de l'arbitrage R0~~ | **Levé 2026-09-27** : texte du 26/09 reçu. Il confirme R0-a, R0-c, R0-d et R0-e. Écarts (responsable, 409, R0-g) traités dans le jalon Référence en cours. | — |
| B12 | ~~Signalement à PowerSync~~ | **Levé 2026-09-28** : transmis par le commandement, [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). Chaîne et texte : `docs/audit-dependances.md`. Chaque exception de `apps/poste/src-tauri/deny.toml` renvoie à cette issue. | — |
| B13 | ~~GitHub Actions ne démarre plus~~ | **Levé 2026-09-27** : le dépôt est public. Le run du dernier commit d'alors, [36327108849](https://github.com/navelremi-boop/legalos2/actions/runs/36327108849), est vert. | — |
| B14 | ~~La liste d'autorisation GitHub bloque les actions créées par GitHub~~ | **Levé 2026-09-27** : case « Allow actions created by GitHub » cochée. Liste des actions tierces inchangée. Premier lancement qui démarre : [36340930653](https://github.com/navelremi-boop/legalos2/actions/runs/36340930653) (`e7314f8`). | — |

## Actions tierces autorisées

GitHub Actions n'exécute que les actions créées par GitHub (`actions/`, `github/`) et ce tableau. Une action absente, ou une version différente de celle du tableau, fait échouer `node tests/recette/workflows-valides.mjs`. Le commandement ajoute la ligne. Aucun contournement : script téléchargé ou copie de l'action dans le dépôt. Avant J14, chaque ligne sera un hash de commit complet.

| Action | Version en CI | Justification |
| --- | --- | --- |
| dtolnay/rust-toolchain | stable | Chaîne Rust du dépôt (`rust-toolchain.toml`), sans l'installer à la main sur le runner |
| Swatinem/rust-cache | v2.7.5 | Cache des compilations Rust |
| pnpm/action-setup | v4.1.0 | Installation de pnpm avant `pnpm install` |

**Levé ou contourné** : Git 2.55, rustup, pnpm, Windows SDK, polices Atkinson, MSVC (B2/B2b), scripts `bootstrap-path.ps1` / `clippy.ps1`, quota Actions (B13, dépôt public), actions créées par GitHub (B14).

**Scripts** : `. .\scripts\bootstrap-path.ps1`

**Rust local (agent Cursor)** : l’erreur WDAC **4551** sur build scripts a été contournée ; les builds natifs passent (`cargo clippy`, exe API présents). En secours : `node tests/recette/j0-rust-docker.mjs` ou `.\scripts\clippy-docker.ps1` ; hors agent : `.\scripts\clippy.cmd`.

---

## Décisions d'architecture en attente

Aucune.

### Décisions tranchées

**Avis RustSec de la chaîne PowerSync** (consigne de l'architecte du 28/09/2026) : quatre exceptions nominatives dans `apps/poste/src-tauri/deny.toml` (`RUSTSEC-2025-0052`, `RUSTSEC-2021-0060`, `RUSTSEC-2021-0064`, `RUSTSEC-2026-0174`), chacune renvoyant à [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). `unused-ignored-advisory = "deny"` : une exception devenue inutile fait échouer le contrôle. Les avis `unic-*` (montée de Tauri) et `rsa` (workspace racine) restent hors de ces exceptions. Bifurquer le plugin ou rendre le contrôle non bloquant restent écartés.

**Sync Streams** (`edition: 3`) : **VALIDÉ** `9f80388`. Contrat `docs/sync-streams.md`, déploiement `instance/powersync/sync-config.yaml`. JOIN autorisés (contrat ≤ 2 tables). La copie `visibilite` sur les enfants reste additive ; l’auth des flux restreints passe par `dossier_acces` + `auth.user_id()`.

---

## Historique

- **2026-09-28 (commandement)** : B12 levé. Signalement transmis, [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129).
- **2026-09-27 (commandement)** : B14 levé. Case « Allow actions created by GitHub » cochée. Premier lancement qui démarre : run 36340930653.
- **2026-09-27 (état-major)** : B14 ouvert. Le réglage GitHub n'autorise pas `actions/*`, contrairement à la consigne.
- **2026-09-27 (architecte)** : B13 levé (dépôt public) ; actions tierces limitées à la liste de ce fichier ; épinglage par hash de commit avant J14.
- **2026-09-27 (état-major)** : B13 ouvert (GitHub Actions, plafond ou paiement).
- **2026-09-27 (architecte)** : B11 levé (arbitrage R0 du 26/09) ; B9 (La journée validée sous réserve des captures, veto du commandement sur les autres écrans) ; B10 devient une revue avant mise en service et ne bloque plus le développement ; critères de J9 et J10 validés.
- **2026-09-27 (état-major)** : B11 ouvert ; critères de J9 et J10 proposés ; B12 (signalement PowerSync) et décision en attente sur les avis de la chaîne PowerSync.
- **2026-09-26 (architecte)** : B2/B2b levés ; B10 hypothèses juridiques ; section décisions d’architecture.
- **2026-09-24 (soir, commandement)** : Docker message « virtualization support wasn’t detected » ; VS IDE inaccessible — B2b/B3 précisés.
- **2026-09-24 (soir, agent)** : Git, SDK, Docker client installés ; moteur/WSL KO.
- **2026-09-24 (matin)** : premier diagnostic.
