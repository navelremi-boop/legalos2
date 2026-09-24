# LEGAL OS — Blocages (actions attendues du commandement)

| ID | Obstacle | Action exacte attendue | Impact |
|----|----------|------------------------|--------|
| B2 | **MSVC `link.exe` absent** | **Ne pas ouvrir l’IDE Visual Studio** si ça plante. Lancer **Visual Studio Installer** : `C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe` → Modifier **Community 2026** → cocher **« Développement Desktop en C++ »** → Installer. Puis : `.\scripts\clippy.ps1` | `cargo clippy`, Tauri, tests Rust locaux |
| B2b | **Visual Studio (IDE) ne s’ouvre pas** | Utiliser uniquement **Visual Studio Installer** (ci-dessus). Si l’installateur échoue : Installer → **Réparer** sur Community 2026. En dernier recours : support Microsoft / réinstallation Build Tools seule (`winget install Microsoft.VisualStudio.2022.BuildTools` + charge C++). | Ajout VCTools sans passer par `devenv.exe` |
| B3 | ~~Docker Desktop — moteur KO~~ | **Levé 2026-09-24 (soir)** : moteur actif ; `docker compose up --wait` S1 → 7 services **healthy**. | — |
| B4 | ~~GitHub remote / CI~~ | **Levé 2026-09-24** : `origin` → `https://github.com/navelremi-boop/legalos2.git`, commit `3f8696b`, CI **verte** (run push `main`). | — |
| B6 | Compte Apple Developer | Non disponible | S14b ad hoc |
| B7 | SUPER PDP réel | Simulateur dans `instance/` | Prod |
| B8 | Boîtes mail réelles | GreenMail | Tests mail |

**Levé ou contourné** : Git 2.55, rustup, pnpm, Windows SDK 22621, polices Atkinson, scripts `bootstrap-path.ps1` / `clippy.ps1`.

**Scripts** : `. .\scripts\bootstrap-path.ps1`

**Rust local (agent Cursor)** : WDAC **4551** sur build scripts — utiliser `node tests/recette/j0-rust-docker.mjs` ou `.\scripts\clippy-docker.ps1` ; en terminal utilisateur hors agent : `.\scripts\clippy.cmd`.

---

## Historique

- **2026-09-24 (soir, commandement)** : Docker message « virtualization support wasn’t detected » ; VS IDE inaccessible — B2b/B3 précisés.
- **2026-09-24 (soir, agent)** : Git, SDK, Docker client installés ; moteur/WSL KO.
- **2026-09-24 (matin)** : premier diagnostic.
