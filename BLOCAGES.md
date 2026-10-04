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
| B9 | Écrans non maquettés (cahier § 7.6) | **La journée** : validée par l'architecte le 27/09/2026, sous réserve des captures régénérées sans points médians (validation de la Coque). **J10** : captures du 30/09 validées le 04/10/2026 sous trois conditions, vérifiées par le contrôleur sans nouveau retour à l'architecte. Conditions : aucune date AAAA-MM-JJ dans le texte rendu (dates à la française) ; heure affichée pour chaque élément d'agenda, captures Jour et Semaine ; captures Mails régénérées après les ajouts du 04/10. Le commandement garde son veto. | J10 n'est pas coché tant que le contrôleur n'a pas constaté les trois conditions |
| B15 | Liste des motifs de levée de l'alerte « convention non signée » | Valider la liste proposée : (1) diligences urgentes avant signature, pour sauvegarder un délai ; (2) convention antérieure déjà signée hors de l'application ; (3) aide juridictionnelle ; (4) premier rendez-vous ou consultation sans honoraires ; (5) dossier interne du cabinet. Chaque levée consigne le motif. | Ne bloque pas J10. Le jalon Conventions d'honoraires n'invente pas d'autre motif |
| B16 | Honoraire de résultat | Confirmer la règle inscrite au plan le 04/10 : seulement en complément d'un honoraire principal, et seulement si la convention du dossier le prévoit ; sinon refus avec message. | Ne bloque pas J10. La facturation appliquera cette règle telle quelle tant qu'elle n'est pas contredite |
| B17 | Durée maximale hors ligne avant verrouillage d'un poste (J12) | Confirmer ou corriger la proposition : **30 jours** sans contact avec l'instance, puis verrouillage local jusqu'à une connexion qui confirme le jeton. La révocation reste immédiate dès que le poste se reconnecte. | Ne bloque pas J10. J12 attend cette confirmation avant de figer la valeur |
| B10 | Revue juridique par l'avocat avant toute mise en service réelle | Relire, avant une mise en service réelle, les délais **H1–H13**, la facturation **F0–F8** et les hypothèses d'**installation**, déjà retenus à titre provisoire par l'architecte le 27/09/2026. Voir `docs/hypotheses-delais.md`, `docs/hypotheses-facturation.md`, `docs/hypotheses-installation.md` et `RAPPORT.md`. | Ne bloque plus le développement |
| B11 | ~~Texte de l'arbitrage R0~~ | **Levé 2026-09-27** : texte du 26/09 reçu. Il confirme R0-a, R0-c, R0-d et R0-e. Écarts (responsable, 409, R0-g) traités dans le jalon Référence en cours. | — |
| B12 | ~~Signalement à PowerSync~~ | **Levé 2026-09-28** : transmis par le commandement, [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). Chaîne et texte : `docs/audit-dependances.md`. Chaque exception de `apps/poste/src-tauri/deny.toml` renvoie à cette issue. | — |
| B13 | ~~GitHub Actions ne démarre plus~~ | **Levé 2026-09-27** : le dépôt est public. Le run du dernier commit d'alors, [36327108849](https://github.com/navelremi-boop/legalos2/actions/runs/36327108849), est vert. | — |
| B14 | ~~La liste d'autorisation GitHub bloque les actions créées par GitHub~~ | **Levé 2026-09-27** : case « Allow actions created by GitHub » cochée. Liste des actions tierces inchangée. Premier lancement qui démarre : [36340930653](https://github.com/navelremi-boop/legalos2/actions/runs/36340930653) (`e7314f8`). | — |

## Actions tierces autorisées

GitHub Actions n'exécute que les actions créées par GitHub (`actions/`, `github/`) et ce tableau. Une action absente, ou une version différente de celle du tableau, fait échouer `node tests/recette/workflows-valides.mjs`. Le commandement ajoute la ligne. Aucun contournement : script téléchargé ou copie de l'action dans le dépôt. Chaque ligne tierce est un hash de commit complet (2026-09-30).

| Action | Version en CI | Justification |
| --- | --- | --- |
| dtolnay/rust-toolchain | 6bed0761d98439e5a578e2877258200ad565ba87 | Commit de l'étiquette `stable` au 2026-09-30. Chaîne Rust du dépôt (`rust-toolchain.toml`), sans l'installer à la main sur le runner |
| Swatinem/rust-cache | 82a92a6e8fbeee089604da2575dc567ae9ddeaab | Commit de l'étiquette `v2.7.5`. Cache des compilations Rust |
| pnpm/action-setup | a7487c7e89a18df4991f7f222e4898a00d66ddda | Commit de l'étiquette `v4.1.0`. Installation de pnpm avant `pnpm install` |

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

- **2026-10-04 (architecte)** : captures J10 du 30/09 validées sous trois conditions (B9). Critères de la Montée PowerSync, de J11 à J14 et des jalons de phase 3 validés. B15, B16 et B17 ouverts (motifs de levée, honoraire de résultat, durée hors ligne). B12 reste levé ; le retrait des quatre exceptions est le critère de la Montée PowerSync.
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
