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
| B9 | Écrans non maquettés (cahier § 7.6) | Valider, au premier passage, les captures jour et nuit de La journée, Dossiers, Mails, Agenda, Facturation et Réglages. Le prototype ne montre que la vue dossier. | Le reste continue en attendant |
| B10 | Hypothèses juridiques à valider par le commandement | Valider : délais **H1–H8** (et points ouverts **H7** jours chômés locaux, **H10** appelant/intimé, **H12** renvoi art. 911-2 / 915-4) ; facturation **F0–F8** ; hypothèses d’**installation**. Voir `docs/hypotheses-delais.md` et `docs/hypotheses-facturation.md`. | Calculs délais et factures ; docs installation |
| B11 | Texte de l'arbitrage R0 (référence personnalisable) jamais reçu : ni dans le dépôt, ni dans l'historique git, ni dans les sessions ; seuls le complément du 27/09 et la consigne du 27/09 le citent | Transmettre le texte de l'arbitrage R0, en particulier les **politiques de remise à zéro** et le **numéro de départ** ; à défaut, valider l'interprétation R0-d à R0-f de `docs/hypotheses-dossiers.md` | Le jalon Référence avance sur cette interprétation ; écart à reprendre si l'arbitrage dit autre chose |
| J9-J10 | Critères proposés le 27/09 (`PLAN.md`), rédigés d'après les § 3.8.6 et 7.6 | Valider ou modifier les critères de **J9** et **J10** | Aucun avant l'ouverture de J9 |

**Levé ou contourné** : Git 2.55, rustup, pnpm, Windows SDK, polices Atkinson, MSVC (B2/B2b), scripts `bootstrap-path.ps1` / `clippy.ps1`.

**Scripts** : `. .\scripts\bootstrap-path.ps1`

**Rust local (agent Cursor)** : l’erreur WDAC **4551** sur build scripts a été contournée ; les builds natifs passent (`cargo clippy`, exe API présents). En secours : `node tests/recette/j0-rust-docker.mjs` ou `.\scripts\clippy-docker.ps1` ; hors agent : `.\scripts\clippy.cmd`.

---

## Décisions d'architecture en attente

*(Aucune en attente au 2026-09-26.)* **Sync Streams** (`edition: 3`) : **VALIDÉ** `9f80388`. Contrat `docs/sync-streams.md`, déploiement `instance/powersync/sync-config.yaml`. JOIN autorisés (contrat ≤ 2 tables). La copie `visibilite` sur les enfants reste additive ; l’auth des flux restreints passe par `dossier_acces` + `auth.user_id()`.

---

## Historique

- **2026-09-27 (état-major)** : B11 (texte de l'arbitrage R0) ; critères proposés de J9 et J10 à valider.
- **2026-09-26 (architecte)** : B2/B2b levés ; B10 hypothèses juridiques ; section décisions d’architecture.
- **2026-09-24 (soir, commandement)** : Docker message « virtualization support wasn’t detected » ; VS IDE inaccessible — B2b/B3 précisés.
- **2026-09-24 (soir, agent)** : Git, SDK, Docker client installés ; moteur/WSL KO.
- **2026-09-24 (matin)** : premier diagnostic.
