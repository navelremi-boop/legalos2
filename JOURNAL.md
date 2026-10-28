# LEGAL OS — Journal (décisions et preuves)

Synthèse au 28/10/2026 (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`, `phase-3-avant-j11.md`, `docs/journal/j11.md`). Les hashs et les CI de chaque jalon sont dans `PLAN.md`.

- **Validés** : phases 0 et 1, J2 à J11, Migration Sync Streams, Référence de dossier, Conflits généralisés, Coque de l'app, Vue scindée, Intercalaires, Dossiers et contacts, Agenda, Documents suite, Bascule vers Claude Code, Montée PowerSync (`cbd4e4c`), Coque claire (`b53fd0f`).
- **J11** : VALIDÉ `1ebfac5` (contrôleur [série 0.5.3](f7264e1e-6b4b-4eb7-8c5f-813f260ff3f0), CI [40590037375](https://github.com/navelremi-boop/legalos2/actions/runs/40590037375)). Série du 28/10, une commande, poste construit liant `powersync` 0.1.1 et `powersync_core` 0.5.3 : dix passes vertes, deux `0xC0000374` non comptés (clichés `legal-os-poste-28476` et `legal-os-poste-10432`). Le détail est dans `docs/journal/j11.md`.
- **En cours : Finition des écrans** (après J11, critères validés par l'architecte le 07/10/2026).
- **Consigne du 28/10/2026 (crash natif, version allégée).** `tauri-plugin-wdio-webdriver` 1.5.1 (crates.io, MIT, `webview2-com` 0.39) remplace la copie de `patches/` : `cargo check --manifest-path apps/poste/src-tauri/Cargo.toml --features test-webdriver --target-dir target` exit 0 en 51 s. Les recettes Tauri lancent le poste avec `RUST_BACKTRACE=1`. Le filet cdb écrit un cliché sur `c0000374` et sur `c0000409` (arrêt sur panique). Pas de série ni de banc dédiés. Une recette Tauri qui meurt est consignée ici en une ligne (recette, code de sortie, pile). Un échec qui n'est pas un défaut déjà identifié arrête la série en cours et passe par `BLOCAGES.md` ; une série ne se rejoue pas pour le chiffre.
- **Suite** : Écran de connexion, Modèles et fusion, Conventions d'honoraires, Facturation suite, Tableau de bord, J12 à J17.
- **Dette ouverte** : le crash `0xC0000374` de `powersync_core` bloque J14 (aucune distribution). Signalement prêt : `docs/signalements/powersync-native-c0000374.md`. Le commandement le poste (B22).
- **Blocages** : B6, B7, B8, B15 à B17, B19, B22 ; voir `BLOCAGES.md`.
- **CI** : l'état d'un run se lit par `gh run view` à chaque fois ; attendre = `gh run watch <id> --exit-status`.
- **Gouvernance de `PLAN.md`** : règle de l'ordre § 4.4 ; contrôle `tests/recette/plan-gouvernance.mjs`.

**Prochaine action.** Finition des écrans : liste des dossiers d'après `design/maquettes/prototype-dossiers.html` (la liste reste visible, création dans le panneau de droite, tri par prochaine échéance, filtres avec compteurs, recherche y compris les clos).
