# LEGAL OS — Journal (décisions et preuves)

Synthèse (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`).

- **Phase 0–1** VALIDÉES ; **J5–J7** VALIDÉS ; **Migration Sync Streams** VALIDÉE `9f80388` ; **J8** VALIDÉ `e8eb6b2`.
- **Référence de dossier** : VALIDÉ `03ca364` (contrôleur, CI [36322383021](https://github.com/navelremi-boop/legalos2/actions/runs/36322383021)). Minutes des trois runs de clôture : **100** (durées de jobs arrondies à la minute supérieure ; le job macOS de [36319178833](https://github.com/navelremi-boop/legalos2/actions/runs/36319178833) compte dix fois).
- **Conflits généralisés** : VALIDÉ `61e77c8` (contrôleur, CI [36357904754](https://github.com/navelremi-boop/legalos2/actions/runs/36357904754)). Quatre runs : **78** minutes (jobs arrondis à la minute supérieure). Dettes de preuve `fixerRevisionEdition` et injection `ps_crud` **soldées** sur `lot/conflits-preuve` (29/09).
- **Coque de l'app** : VALIDÉ `831e398` (contrôleur, CI [36475104465](https://github.com/navelremi-boop/legalos2/actions/runs/36475104465)). Trois runs (CORS, poste, `main`) : **60** minutes.
- **Vue scindée** : VALIDÉ `f393190` (contrôleur, CI [36531714153](https://github.com/navelremi-boop/legalos2/actions/runs/36531714153)). Trois runs : **62** minutes. Consigne du 29/09 : un dossier réel n'affiche plus `CHRONO_DEMO` ; le branchement sur les éléments synchronisés reste dû avant la fin de J9 et de Documents, suite.
- **Intercalaires personnalisés** : VALIDÉ `9e0aa69` (contrôleur, CI [36561017502](https://github.com/navelremi-boop/legalos2/actions/runs/36561017502)). Trois runs de clôture : **63** minutes.
- **Dossiers et contacts complets** : VALIDÉ `3482a36` (contrôleur, CI [36572546272](https://github.com/navelremi-boop/legalos2/actions/runs/36572546272)). Trois runs : **54** minutes.
- **Agenda** : VALIDÉ `57fd4dc` (contrôleur sur `635714e`, CI [36586753618](https://github.com/navelremi-boop/legalos2/actions/runs/36586753618)). Trois runs : **65** minutes. Premier contrôle REFUSÉ sur `697bfbd`.
- **En cours** : **Documents, suite**.
- **Ordre** : ~~Streams~~ → ~~J8~~ → ~~Référence de dossier~~ → ~~Conflits généralisés~~ → ~~Coque~~ → ~~Vue scindée~~ → ~~Intercalaires~~ → ~~Dossiers et contacts~~ → ~~Agenda~~ → **Documents, suite** → J9 → J10. Phase 3, avant J14 : Modèles et fusion, Facturation suite, Conventions d'honoraires, Tableau de bord.
- **CI** : l'état d'un run se lit par `gh run view` à chaque fois. Attendre = `gh run watch <id> --exit-status`. Deux relances consécutives sans commande ni commit créent `.mission/STOP` (ordre § 4.7).
- **Gouvernance de `PLAN.md`** : règle de l'ordre § 4.4 (27/09) ; contrôle `tests/recette/plan-gouvernance.mjs` (CI, job gouvernance). Un chemin `docs/…` cité dans `PLAN.md`, `BLOCAGES.md` ou `JOURNAL.md` doit exister.
- **B12 levé** (28/09) : signalement transmis, [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129). Quatre exceptions dans `apps/poste/src-tauri/deny.toml`. Constat : `docs/audit-dependances.md`.
- **Sync** : Streams édition 3, service 1.26.1. Dette mensuelle avis PowerSync.
- **Coque** corrigée (`22d765e`), non cochée : points médians de La journée (consigne 3), onglets de démonstration (dette). La journée est validée par l'architecte sous réserve des captures régénérées (consigne du 27/09, point 2).
- **B11 levé**. Contrôleur d'abord REFUSÉ (affichage du numéro minimal). Recette `reference-modele-ecran.mjs` : exit 0, numéro `1000000000`. Second verdict **VALIDÉ** sur `03ca364`.
- **Minutes GitHub Actions** : un push uniquement Markdown ne lance que `gouvernance` et `frontend`. Le job `macos-placeholder` est retiré (il reviendra en J16, déclenchement manuel).

---

## 2026-09-29 — Documents, suite : contrat serveur livré, pas fusionné

[API arborescence](f70a4356-d103-4529-b136-1203c7cec6ff) : commit `3889e91` sur `lot/documents-api`, PR [n° 15](https://github.com/navelremi-boop/legalos2/pull/15). Pas de fusion dans `main` : le contrôleur du jalon attend le lot poste.

CI lue par `gh run view 36622021205` : completed, success. perimetre, frontend, gouvernance, facturx, rust, s1-instance en succès. Preuves locales rapportées : `migrations-additives.mjs`, `s5-sync-streams.mjs`, clippy, `documents_arborescence_integration` (3), `s6-documents.mjs`, `documents-arborescence.mjs`.

Écart assumé : table `document_versions_en_cours` (réservation de numéro), absente des flux. Dépendances `pdf-extract` 0.12.1, `zip` 8.6.0, `quick-xml` 0.42.0.

Le lot poste est dans `.worktrees/documents-poste` et doit intégrer `3889e91` avant la recette Tauri. Run [36618225538](https://github.com/navelremi-boop/legalos2/actions/runs/36618225538) annulé par concurrence ; [36619287466](https://github.com/navelremi-boop/legalos2/actions/runs/36619287466) vert, jobs de code sautés (journal seul).

## 2026-09-29 — Agenda VALIDÉ

Contrôleur **VALIDÉ** sur `635714e` (consigne de l'architecte du 29/09/2026, 21 h). Fusion dans `main` en `57fd4dc`. Jalon coché. Suivant : Documents, suite.

Premier contrôle **REFUSÉ** sur `697bfbd` : les critères renforcés par `ca8208b` (rappel app fermée ou hors ligne, lien de calcul, confirmation de suppression, conflits par champ, `agenda-fuseau.mjs`) n'étaient pas couverts. Correctif `635714e` : fuseau Europe/Paris, lien de calcul, trace de suppression, conflits par champ.

Preuve du contrôleur sur `635714e` (worktree agenda, retrouvée avant retrait du worktree) : `agenda-fuseau.mjs`, `s5-sync-streams.mjs`, `s5-sqlite-par-flux.mjs`, `upload-contrat-poste.mjs`, `lint:ci`, `cargo fmt`, clippy API et poste, `agenda-tauri.mjs` — tous exit 0. La recette Tauri couvre le rappel au lancement suivant, le recalcul ou le signal périmé, la confirmation avec trace, les conflits par champ et l'absence du dossier restreint dans le SQLite. Aucun écart bloquant.

**CI lue par commande** le 29/09/2026 à 21 h (heure de Paris), `gh run view <id> --json status,conclusion,jobs` :
- [36586753618](https://github.com/navelremi-boop/legalos2/actions/runs/36586753618) (`57fd4dc`, `main`) : completed, success. perimetre, gouvernance, frontend, facturx, rust, s1-instance en succès. `s1-instance` terminé à 15:13:54 UTC (17:13, heure de Paris).
- [36584915520](https://github.com/navelremi-boop/legalos2/actions/runs/36584915520) (`635714e`, lot) : completed, success. Mêmes six jobs.
- [36577300524](https://github.com/navelremi-boop/legalos2/actions/runs/36577300524) (`697bfbd`, lot refusé) : completed, success. Mêmes six jobs.

Minutes des trois runs (lot refusé, lot `635714e`, `main`), jobs arrondis à la minute supérieure : 22 + 22 + 21 = **65**.

## 2026-09-29 — Consigne de l'architecte : fin de la boucle d'attente

21 h, heure de Paris. L'information « S1 en cours depuis 17 h 06 » était périmée : le run `36586753618` était déjà vert.

Règle permanente (§ 4.7, `.cursor/rules/00-mission.mdc` et `50-infra-ci.mdc`) :
- l'état d'une CI se lit par `gh run view <id> --json status,conclusion,jobs` (ou l'API GitHub) à chaque fois ;
- attendre une CI = `gh run watch <id> --exit-status`, jamais un arrêt ;
- deux relances consécutives sans commande exécutée ni commit : incident dans `JOURNAL.md` et `.mission/STOP`.

Le hook `continuer.mjs` tient le compteur. `apres-commande.mjs` marque chaque commande. Preuve : `node tests/recette/garde-hooks.mjs`.

## 2026-09-29 — Agenda : contrôleur REFUSÉ

Contrôleur **REFUSÉ** sur `697bfbd` (branche `lot/agenda`, worktree `.worktrees/agenda`, PR [n° 14](https://github.com/navelremi-boop/legalos2/pull/14)). Jalon non coché. Aucune correction de production par le contrôleur.

**Critères PLAN** : au démarrage du contrôle, `git diff origin/main HEAD -- PLAN.md` était vide (critères 27/09). Pendant le contrôle, `ca8208b` (`plan:`, consigne architecte 29/09) a renforcé Agenda sur `origin/main`. Le lot `697bfbd` conserve encore le texte 27/09 (plus faible). Autorité : critères de `origin/main` après `ca8208b`.

**Commandes exécutées** (worktree au commit `697bfbd`, `CARGO_BUILD_JOBS=2`, instance `http://127.0.0.1:8088`) :
- `node tests/recette/agenda-tauri.mjs` → exit 0 (~94 s) : audiences / rendez-vous / tâches + rappels ; notification Tauri ; échéance `2026-01-21` inscrite ; invitation refusée (J11) ; restreint absent du SQLite poste B.
- `node tests/recette/s5-sync-streams.mjs` → exit 0
- `pnpm --filter @legal-os/poste lint:ci` → exit 0

**CI** : [36577300524](https://github.com/navelremi-boop/legalos2/actions/runs/36577300524) **success** (gouvernance, perimetre, frontend, rust 7m0, facturx 2m21, s1-instance 7m21).

**Écarts bloquants** (critères `origin/main` absents de `697bfbd` / non prouvés) :
1. rappel échu app fermée / hors ligne notifié au lancement suivant — non couvert par la recette commitée ;
2. échéance liée au calcul : recalcul ou signal si la date de départ change — absent du `agenda-tauri.mjs` commité ;
3. suppression d'échéance moteur : confirmation + trace (qui, quand) — absent ;
4. conflits par champ sur les tables d'agenda — absent ;
5. `node tests/recette/agenda-fuseau.mjs` → exit 0 — fichier absent de `HEAD` (`exists on disk, but not in 'HEAD'` ; WIP non évalué).

**Non vérifié** : WIP dirty du worktree (modifs locales post-`697bfbd` : `agenda-tauri.mjs`, `agenda-fuseau.mjs`, migration `023`, etc.) — hors périmètre du commit demandé.

## 2026-09-29 — Consigne de l'architecte : Agenda, Documents, SIREN, garde-fou

15:46, heure locale. Consigne de l'architecte du 29/09/2026. Commit `plan:` `ca8208b` (PLAN.md seul).

- Agenda et Documents, suite : critères validés. Ajouts inscrits sans retirer les commandes déjà exigées. Le jalon en cours est Agenda : il ne porte plus « à valider par l'architecte ».
- Dette nouvelle, ouverte : **Avant Facturation, suite**, contrôle du SIREN (Luhn) et du n° TVA FR, saisie et API, message en français — `node tests/recette/siren-tva.mjs`.
- Garde-fou : `plan-gouvernance.mjs` échoue si le jalon en cours porte « à valider par l'architecte ». Essai négatif dans le script (jalon en cours marqué ainsi : échec ; un jalon ultérieur seulement : pas d'échec). Dans ce cas l'état-major consigne l'attente dans `BLOCAGES.md` et traite les dettes ouvertes ; s'il n'en reste aucune, `.mission/STOP`.
- Dette `cargo-deny` cochée. Preuve : job `rust` de la CI, étapes « cargo-deny 0.20.2 » et « Exception d'avis devenue inutile ». Run [36572546272](https://github.com/navelremi-boop/legalos2/actions/runs/36572546272), 29/09/2026 13:11 UTC : `deny-exception-inutile: OK — une exception absente du graphe fait échouer cargo deny`. Signalement PowerSync / `time` 0.2 : [powersync-js#1129](https://github.com/powersync-ja/powersync-js/issues/1129), transmis le 28/09. Constat : `docs/audit-dependances.md`.

## 2026-09-29 — Agenda : recettes locales vertes, CI en cours

15:43, heure locale. Lot `lot/agenda`, tête `697bfbd`. PR [n° 14](https://github.com/navelremi-boop/legalos2/pull/14). Jalon non coché.

- `node tests/recette/agenda-tauri.mjs` exit 0 : audiences, rendez-vous et tâches avec rappel ; notification Tauri pour un rappel échu ; échéance `2026-01-21` inscrite à l'agenda ; invitation mail refusée (reste à J11) ; élément restreint absent du SQLite du poste non autorisé.
- `node tests/recette/s5-sync-streams.mjs` et `pnpm --filter @legal-os/poste lint:ci` exit 0.
- Tauri crate **2.12.0**, exigé par `tauri-plugin-notification` **2.5.0** (crates.io et npm, 2026-09-29). Pas la 3.0 alpha.

## 2026-09-29 — Dossiers et contacts complets : contrôleur VALIDÉ

Contrôleur **VALIDÉ** sur `09d7c8f` (branche `lot/dossiers-contacts-api`, PR [n° 13](https://github.com/navelremi-boop/legalos2/pull/13)). Critères PLAN non affaiblis. Jalon coché après la CI de `main`.

Premier passage REFUSÉ sur `be75154` : `cargo fmt --check` et CI [36569809421](https://github.com/navelremi-boop/legalos2/actions/runs/36569809421) (rustfmt `powersync_connect.rs`). Correctif `09d7c8f` : formatage seul de `champs_modifiables` (`git diff be75154 09d7c8f` : un fichier).

Preuves déjà vertes sur `be75154` (worktree, `CARGO_BUILD_JOBS=2`) :
- `node tests/recette/dossiers-contacts.mjs` → exit 0
- `node tests/recette/s5-sync-streams.mjs` → exit 0
- `node tests/recette/dossiers-contacts-conflits.mjs` → exit 0
- `cargo clippy --workspace --all-targets -- -D warnings` → exit 0
- `cargo clippy --manifest-path apps/poste/src-tauri/Cargo.toml --all-targets -- -D warnings` → exit 0

Reprise sur `09d7c8f` :
- `cargo fmt --manifest-path apps/poste/src-tauri/Cargo.toml -- --check` → exit 0
- CI du lot [36570550219](https://github.com/navelremi-boop/legalos2/actions/runs/36570550219) **success** (gouvernance, perimetre, frontend, rust 6m47, facturx 2m14, s1-instance 7m21)

Fusion dans `main` en `3482a36`. CI [36572546272](https://github.com/navelremi-boop/legalos2/actions/runs/36572546272) verte. Trois runs (fmt refusé, lot vert, `main`) : **54** minutes, jobs arrondis à la minute supérieure. Détail dans `docs/journal/phase-2.md`. Jalon suivant : Agenda.

## 2026-09-29 — Dossiers et contacts : recettes locales vertes

14:41, heure locale. Lot `lot/dossiers-contacts-api`, tête `be75154`. PR [n° 13](https://github.com/navelremi-boop/legalos2/pull/13). Jalon non coché : contrôleur et CI restent à consigner.

- `node tests/recette/dossiers-contacts.mjs` exit 0 : API Postgres (fiche, rôles, lien réciproque, historique, SIREN, TVA, `type_client` F8), puis Tauri (écran, lien dans les deux sens, historique), puis S5 (dossier restreint, partie et lien absents du poste non autorisé, dossier public présent).
- `node tests/recette/dossiers-contacts-conflits.mjs` exit 0 : file du poste, conflit journalisé avec révision de base, signaux `contact-conflit` et `dossier-conflit`.
- `node tests/recette/s5-sync-streams.mjs` exit 0. PowerSync 1.26.1 refuse `EXISTS` : les liens dont la cible est restreinte passent par deux jointures `dossier_acces` (`dossier_liens_restreints_croises`).

## 2026-09-29 — Dossiers et contacts : API et écran, recettes Tauri encore dues

14:12, heure locale. Branche `lot/dossiers-contacts-api`, tête `3664093`, worktree `.worktrees/dossiers-contacts-api`. Non poussée. Jalon non coché.

- Migration `021` : `type_dossier`, `etape`, `contacts` (SIREN, n° TVA, `type_client` aligné sur F8), `parties.contact_id`, `dossier_liens` dans les deux sens. L'annuaire est un seul flux cabinet (`contacts_cabinet`) pour ne pas multiplier les seaux. `node tests/recette/s5-sync-streams.mjs` exit 0.
- `cargo test -p legalos-api --test dossiers_contacts_integration` : 1 passé (Postgres local). Clippy `legalos-api` et `legal-os-poste` : exit 0. `pnpm --filter @legal-os/poste typecheck` et `lint:ci` : exit 0.
- L'écran du dossier affiche type, étape, confrère, liens, historique et les signaux `dossier-conflit` / `contact-conflit`. `tests/recette/dossiers-contacts.mjs` et `dossiers-contacts-conflits.mjs` ne sont pas encore écrits : la preuve Tauri du PLAN n'est pas faite.

## 2026-09-29 — Intercalaires personnalisés VALIDÉS

Contrôleur VALIDÉ sur `ee6ac1e`. Fusion dans `main` en `9e0aa69`. CI [36561017502](https://github.com/navelremi-boop/legalos2/actions/runs/36561017502) verte. Trois runs de clôture (API [36536216401](https://github.com/navelremi-boop/legalos2/actions/runs/36536216401), poste [36559426799](https://github.com/navelremi-boop/legalos2/actions/runs/36559426799), `main`) : **63** minutes, jobs arrondis à la minute supérieure. Détail dans `docs/journal/phase-2.md`. Jalon suivant : Dossiers et contacts complets.

## 2026-09-29 — Intercalaires personnalisés : contrôleur REFUSÉ

11:01, heure locale. Contrôleur **REFUSÉ** sur `4a63651`. CI du lot poste [36540474066](https://github.com/navelremi-boop/legalos2/actions/runs/36540474066) verte (PR [n° 12](https://github.com/navelremi-boop/legalos2/pull/12)). Critères PLAN non affaiblis.

- Bloquant : `node tests/recette/j5-poste-tauri.mjs` exit 1. Après création, le formulaire se démonte quand le dossier s'ouvre ; J5 ne lit plus `[data-testid=dossier-cree]`.
- Majeur : le conflit de la recette intercalaires était deux PATCH HTTP, pas la file du poste.

Correctif en cours dans `.worktrees/intercalaires-poste`, non commité : J5 lit aussi l'écran ouvert ; la recette écrit hors ligne (`patchChamp`, `ps_crud`) et le serveur journalise le conflit. Le signal d'interface ne s'affiche pas encore : la ligne de journal est dans `ps_oplog` mais pas dans la vue `journal_modifications` (`revision` locale reste 1, `ps_updated_rows` a été vidé). `intercalaires-tauri.mjs` ne sort pas 0. Jalon non coché. PR API [n° 11](https://github.com/navelremi-boop/legalos2/pull/11) non fusionnée.

## 2026-09-29 — Intercalaires personnalisés : lot API vert, lot poste en cours

PR [n° 11](https://github.com/navelremi-boop/legalos2/pull/11), tête `5f6b770` (rustfmt après `5624997`). CI [36536216401](https://github.com/navelremi-boop/legalos2/actions/runs/36536216401) verte au second essai : le job facturx avait échoué sur un téléchargement Saxon (`curl` 35, connexion coupée), sans lien avec le diff. Le lot poste est sur `lot/intercalaires-poste`, non fusionné. Le jalon n'est pas coché.

## 2026-09-29 — Consigne de l'architecte : pas de CHRONO_DEMO dans le dossier réel

Texte reçu : un dossier réel n'affiche plus le jeu fictif. Sans élément synchronisé, état vide sobre. `CHRONO_DEMO` reste à la galerie, aux captures et au développement. Le build distribué ne doit plus contenir un titre de ce jeu (exemple « Communication de pièces adverses n° 14 à 19 »), essai négatif inclus. Le branchement sur les mails, pièces et factures n'est pas avancé : il reste dû avant la fin de J9 et de Documents, suite. Sans retarder les intercalaires.

Traitement : `DossierOuvert` passe une liste vide. La galerie seule fournit `CHRONO_DEMO`. Contrôle `node tests/recette/chrono-demo-absent.mjs`.

## 2026-09-29 — Dettes de preuve Conflits (point a)

Consigne architecte du 29/09, point a : solder avant les intercalaires. Sur `lot/conflits-preuve` : retrait de l'INSERT de secours dans `ps_crud` (`patcherChamp`) et de `fixerRevisionEdition`. Une seule règle de révision : `max(ligne synchronisée, revision_edition)` partagée entre `memoriserRevision` et `lire_revision` / `appliquer_revision_locale`. La preuve « fausse alerte » attend la reprise réelle (base neuve + sync, puis deux écritures séquentielles ; base = révision téléchargée d'un autre poste). `injecterCrud` conservé pour les refus.

Preuve : `node tests/recette/conflits-poste-tauri.mjs` → exit 0 ; sortie contient `pas de fausse alerte` et `tous les critères`. Aucun appel restant à `fixerRevisionEdition`. `PLAN.md` non modifié (cases dette à cocher par l'état-major).

## 2026-09-29 — Consigne de l'architecte : hook de relance

Texte reçu (remplace la précédente du 29/09). Priorité : `continuer.mjs` lisait `status` sur le résultat `{ ok, valeur }` de `lireEntree()` (depuis `7945016`), donc ne relançait jamais. Preuve dans `garde-hooks.mjs`, cinq cas, essai négatif sur l'ancien code. Ensuite Vue scindée, et sans la retarder : dettes de preuve des conflits avant les intercalaires ; essai négatif d'une exception `deny.toml` inutile ; suppression des branches `lot/` déjà dans `main`. Tout arrêt est consigné ici avec l'heure et la raison.

Traitement (07:20, heure locale) : correctif commité (`2da7703`, `f2ff014`). `node tests/recette/garde-hooks.mjs` → OK. L'essai `deny-exception-inutile.mjs` est branché sur le job `rust` (cargo-deny 0.20.2, somme SHA-256 du binaire Linux). Vue scindée et dettes de preuve des conflits suivent dans leurs lots.

07:22 — suppression des branches `lot/` déjà intégrées refusée par `garde-commandes` (suppression de branche distante). Aucun contournement. Branches concernées, correctifs déjà dans `main` (`git cherry` tout en « - ») : `lot/conflits-api`, `lot/conflits-poste`, `lot/coque-cors`, `lot/coque-poste`, `lot/reference-modele-api`, `lot/reference-modele-poste`, `lot/reference-responsable-api`, `lot/reference-responsable-poste`.

## 2026-09-28 — Coque de l'app VALIDÉE

Contrôleur VALIDÉ sur `64cdb1b` (poste) et `958d09a` (CORS). Fusion dans `main` en `831e398`. CI [36475104465](https://github.com/navelremi-boop/legalos2/actions/runs/36475104465) verte. Dettes CORS et onglets de démonstration cochées. Détail dans `docs/journal/phase-2.md`. Jalon suivant : Vue scindée.

## 2026-09-28 — Consigne de l'architecte : B12 et document manquant

Texte reçu : le signalement PowerSync a été transmis (issue powersync-ja/powersync-js #1129). Consigner le lien ; chaque exception de `deny.toml` y renvoie. Créer `docs/audit-dependances.md`, cité par `BLOCAGES.md` mais absent du dépôt, avec la chaîne vérifiée. `plan-gouvernance.mjs` échoue si un chemin `docs/…` cité dans `PLAN.md`, `BLOCAGES.md` ou `JOURNAL.md` n'existe pas. Essai négatif inclus.

Traitement : B12 levé. Chaîne contrôlée sur le crate publié 0.0.6 et le `Cargo.lock` du poste : `http-client` 6.5.3 sans fonctionnalités par défaut, `http-types` 2.12 avec `fs` et `cookie-secure`, seul usage `commands.rs:5`. Quatre exceptions nominatives. `cargo deny … check advisories` sur le poste ne signale plus ces quatre avis ; les cinq avis `unic-*` de Tauri restent, hors de ces exceptions. `node tests/recette/plan-gouvernance.mjs` → OK.

## 2026-09-28 — Conflits généralisés : refus du contrôleur

Contrôleur : **REFUSÉ**. `cargo test -p legalos-api --test conflits_integration` panique (`journal dossier: RowNotFound`) sur le Postgres de l'instance. Les clés locales (`d-nom-a1`, etc.) sont fixes et le poste de test est réutilisé : le rejeu d'idempotence répond 200 sans écrire le journal du nouveau dossier. Les recettes `s5-sync-streams`, `upload-contrat-poste`, `conflits-poste-tauri`, `j3-poste-tauri` et clippy étaient vertes. Critères du PLAN inchangés depuis `c47dc6b`.

Correctif : une série d'identifiants par exécution ; le rejeu volontaire répète la même clé. La recette Tauri échoue si la migration 019 est absente, au lieu de sortir en SKIP. Recontrôle VALIDÉ sur `61e77c8`. CI de `main` [36357904754](https://github.com/navelremi-boop/legalos2/actions/runs/36357904754) verte. Jalon coché. Détail dans `docs/journal/phase-2.md`. Dettes majeures (alignement forcé de `revision_edition`, insertion de secours dans `ps_crud`) à solder avant la fin de la phase 2.

## 2026-09-27 — Conflits généralisés : lot poste réaligné sur main

La PR #5 (`6b1a120`) était ouverte. Son dernier run ([36326938887](https://github.com/navelremi-boop/legalos2/actions/runs/36326938887)) n'a échoué que sur `s1-instance`, en 2 s, parce que la liste GitHub refusait encore `actions/checkout` (B14, levé ensuite). `main` a été fusionné dans `lot/conflits-poste` sans réécriture (`9484ab1`). La recette Tauri corrige deux assertions fausses (rôle de partie limité à client, adversaire, confrère ; taux vérifié par la valeur exacte) et lance Compose depuis le dépôt qui détient `.env`. PowerSync a été redémarré pour charger les trois flux du journal. Le jalon n'est pas coché.

---

## 2026-09-27 — Consigne de l'architecte : bibliothèque IMAP et licences

Texte reçu, avant l'ouverture de J9. `io-imap` `=0.6.1` remplace `async-imap`, qui n'est pas ajouté. `imap-codec` transitive figée à `2.0.0-alpha.8` (crates.io, vérifié le 2026-09-27 ; la 2.0.0-alpha.9 existe et n'est pas prise). Aucune mise à jour sans instruction ; une mise à jour autorisée repasse les tests mail. Les types restent derrière `FournisseurMail`. Boîte de réception : `ImapMailboxWatch` sur une connexion dédiée, lecture seule (IDLE, QRESYNC, repli). Autres dossiers : relève incrémentale. Actions de l'utilisateur : autre connexion. Changement d'UIDVALIDITY : resynchronisation complète. GreenMail 2.1.0 n'annonce pas QRESYNC (source `CapabilityCommand` de l'étiquette 2.1.0). Second serveur : Dovecot, `instance/imap-test/`. Mesure des 50 000 messages : les deux chemins, critère de J9. Licences à la racine et règle `.cursor/rules/32-licences.mdc`.

---

## 2026-09-27 — Consigne de l'architecte : actions autorisées

Texte reçu : GitHub Actions n'exécute plus que les actions créées par GitHub et la liste blanche `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `pnpm/action-setup`. Toute nouvelle action tierce passe par `BLOCAGES.md` (nom, version, justification) : le commandement l'ajoute. Aucun contournement (script téléchargé, copie de l'action dans le dépôt). Avant J14, épingler chaque action tierce sur un hash de commit complet plutôt que sur une étiquette.

Traitement : le tableau est dans `BLOCAGES.md`. `workflows-valides.mjs` refuse une action hors `actions/` et `github/` qui n'y figure pas à la version indiquée, ainsi qu'une action locale ou une image Docker. Dette « Avant J14 » dans `PLAN.md` pour l'épinglage par hash. Les trois actions du workflow sont déjà celles de la liste. Le réglage GitHub, lui, refuse `actions/checkout`, `actions/setup-node` et `actions/setup-java` (B14) : la CI de `7799606` ne démarre pas.

---

## 2026-09-27 — Consigne de l'architecte : dépôt public

Texte reçu : B13 levé, le dépôt est public. Relancer les runs échoués du dernier commit de `main` et de la PR #5 (`gh run rerun <id> --failed`), puis reprendre Conflits généralisés. Tout l'historique est lisible et définitif. `user.email` local = l'adresse noreply du compte GitHub. Hors développement, l'instance refuse de démarrer si un secret de `.env`, Garage compris, vaut une valeur des fichiers d'exemple ; `cargo xtask install` génère tous les secrets ; test dans la recette. Aucune donnée personnelle ou réelle dans le dépôt.

Traitement : `permissions: contents: read` en tête de la CI. Refus au démarrage de l'API (`SECRETS_PUBLIES`), secrets Garage, Postgres et GreenMail transmis au conteneur API ; Garage et GreenMail attendent l'API. Recette `secrets-publies.mjs`. `cargo xtask install` écrit des secrets aléatoires et ne réécrit pas un `.env` déjà sain. Les auteurs de tous les commits sont l'adresse noreply. Douze commits de fusion par rebase ont un autre committer (adresse principale du compte) : l'historique est définitif, aucune réécriture. Les fichiers du dépôt ne contiennent que des adresses fictives (`example`, `cabinet-fictif`, `cabinet.test`). Runs relancés : [36327108849](https://github.com/navelremi-boop/legalos2/actions/runs/36327108849) et [36326938887](https://github.com/navelremi-boop/legalos2/actions/runs/36326938887).

---

## 2026-09-27 — Conflits généralisés : fusion API, CI arrêtée

Le sondage des CI d'avant fusion : lot API `f1aafc1` ([36324877071](https://github.com/navelremi-boop/legalos2/actions/runs/36324877071)) succès ; lot poste `7b79f1c` échec (`cargo fmt`). Le formatage `e3b1323` ([36325362851](https://github.com/navelremi-boop/legalos2/actions/runs/36325362851)) est vert, y compris `s1-instance`.

Fusion de la PR #6 en rebase : `8b5a744` et `5fbac31` sur `main`. La PR #5 a été fusionnée avec `main` sans réécriture (`6b1a120`) : `AppSchema.ts` garde le journal de `main` et la table locale `refus_sync`. La CI de cette fusion et celle de `main` après l'API ne démarrent pas (B13). La PR #5 reste ouverte. Le jalon n'est pas coché.

---

## 2026-09-27 — Consigne de l'architecte : couverture de la V1

Texte reçu : la mission est la V1 du § 4.2 (fonctionnalités n° 1 à 14). `PLAN.md` ne couvrait que les scénarios S1 à S14. Ajouter en tête une matrice de couverture, contrôlée par `plan-gouvernance.mjs`. Nouveaux jalons, critères en commandes, marqués « à valider par l'architecte » : en phase 2, après les intercalaires et avant J9, Dossiers et contacts complets (n° 1 et 2), Agenda (n° 4, invitations mail en J11), Documents, suite (n° 6) ; en phase 3, avant J14, Modèles et fusion (n° 7), Facturation, suite (n° 10), Conventions d'honoraires (n° 12), Tableau de bord (n° 13). Ce que J5, J7 et J8 n'ont pas livré va dans ces jalons, jamais dans un jalon déjà coché.

Traitement : matrice et jalons dans un commit `plan:` citant cette consigne. Le contrôle échoue sans la section, sans un n° 1 à 14, sans élément, ou si le jalon cité n'existe pas. Essai négatif dans `plan-gouvernance.mjs`.

---

## 2026-09-27 — Consigne de l'architecte : attente de la CI, minutes GitHub Actions

Texte reçu :

1. Attente de la CI. Ne plus terminer le tour pour attendre un run. Attendre dans le même tour avec `gh run watch <id> --exit-status --interval 60`, ou une boucle d'un sondage toutes les deux minutes, 30 minutes au plus. Pendant l'attente, avancer sur ce qui ne dépend pas du résultat : le contrôleur en local, ou les tests d'acceptation du jalon suivant dans son worktree, sans fusion avant la validation du jalon en cours.
2. Fusions : quand plusieurs lots d'un même jalon sont verts, les fusionner à la suite, puis attendre une seule CI de `main`.
3. Minutes GitHub Actions (dépôt privé, quota mensuel ; environ 1 700 minutes consommées depuis le 24/09) : supprimer `macos-placeholder` (dix fois le temps, 360 minutes ; il reviendra avec S14b, J16, en déclenchement manuel) ; un push qui ne touche que des fichiers Markdown ne lance que `gouvernance` et `frontend` ; regrouper les commits de documentation avec le code ; à chaque fin de jalon, consigner la somme des durées des jobs, chacune arrondie à la minute supérieure ; si un run ne démarre pas faute de minutes, l'inscrire dans `BLOCAGES.md` et continuer en local. La CI verte reste exigée avant de cocher un jalon.

Traitement : la CI de la fusion `dfed55c` (run 36319178833) n'est pas interrompue. Le workflow est modifié dans le même commit que cette note, poussé une fois le run terminé. Le contrôleur du jalon Référence tourne déjà en local.

---

## 2026-09-27 — Consigne de l'architecte : arbitrage R0, B9, B10, conflits, J9 et J10

Texte reçu :

1. B11 levé : texte de l'arbitrage R0 du 26/09, jamais transmis jusqu'ici. Il confirme R0-a, R0-c, R0-d et R0-e. Écarts à traiter dans le jalon Référence de dossier en cours : le jeton reste `{INI}` (le texte d'origine disait `{INIT}`) ; les initiales sont celles de l'avocat responsable (`dossiers.responsable_id`, migration additive, défaut le créateur, envoyé et synchronisé, figées à l'attribution) ; le 409 `reference_existante` indique le numéro de départ minimal quand il existe, affiché dans Réglages ; R0-g retenu pour la V1, chaque changement journalisé avec son auteur ; la forme de classement du déclencheur de la migration 017 est vérifiée contre `reference-vecteurs.json` dans `reference-modele.mjs` ; le § 3.4 du cahier et `docs/hypotheses-dossiers.md` sont mis à jour (R0-a à R0-g « arbitré », R0-b corrigé) ; ces critères sont ajoutés au jalon.
2. B9 : La journée est validée par l'architecte, sous réserve des captures régénérées sans points médians (validation de la Coque). Pour les autres écrans du § 7.6, la validation sur captures est déléguée à l'architecte ; le commandement garde son veto. Mise à jour du § 7, des critères de J10 et de `BLOCAGES.md`.
3. B10 : validation provisoire. Délais H1 à H13 retenus (H7 : pas de jours chômés locaux en V1, rappel à l'écran ; H10 : l'augmentation pour distance s'applique à la partie concernée ; H12 : l'art. 1037-1 se lit avec l'art. 915-4). Facturation F0 à F8 retenues, F3 dans sa version corrigée ; F7 est un choix technique ; F8 : les clients publics (Chorus Pro) ne sont pas couverts (point ouvert du § 6). Hypothèses d'installation retenues. B10 devient « Revue juridique par l'avocat avant toute mise en service réelle » et ne bloque plus le développement. Dette « Avant J17 » et section dans `RAPPORT.md`.
4. Conflits généralisés : refus 400, 403, 404, 409 consignés hors de la file synchronisée, message affiché, écritures suivantes envoyées ; aucune perte silencieuse (PUT, PATCH et DELETE explicites, un champ seul par table, table inconnue consignée sans bloquer) ; `CHECK (restreint = (visibilite = 'restreint'))` ; immutabilité d'un temps référencé par un brouillon numéroté, validée.
5. J9 et J10 : critères validés. J9 : reconnaissance dans l'objet pour tous les modèles utilisés par le cabinet (deux modèles successifs) ; relève de la boîte de classement interrompue puis reprise, sans perte ni doublon. J10 : captures validées par l'architecte, veto du commandement. Retrait de « à valider par l'architecte » et de la ligne J9-J10 de `BLOCAGES.md`.

Les modifications de `PLAN.md` font l'objet d'un commit dédié « plan: » citant cette consigne.

Traitement : critères ajoutés sans retirer ceux déjà écrits ; `docs/hypotheses-dossiers.md`, le cahier (§ 3.4, § 6, § 7.6), `docs/conflits.md`, les hypothèses de délais, de facturation et d'installation, `BLOCAGES.md` et `RAPPORT.md` mis à jour. L'implémentation des écarts R0 (responsable, 409, vecteurs du déclencheur) reste dans le jalon en cours.

---

## 2026-09-27 — Consigne du commandement (architecte) : gouvernance de `PLAN.md`, critères rétablis

Texte reçu :

1. Règle, à ajouter au § 4.4 de l'ordre d'opération et à la définition du sous-agent controleur : « PLAN.md : un jalon validé peut être résumé sur une ligne (verdict, commit, CI), son détail étant archivé dans docs/journal/. Les critères d'acceptation d'un jalon non validé, et les dettes ouvertes, ne peuvent être ni supprimés, ni affaiblis, ni remplacés par un simple renvoi au cahier des charges. Seul l'architecte peut les modifier. Chaque jalon non validé garde ses critères sous forme de commandes. Toute modification de PLAN.md fait l'objet d'un commit dédié préfixé « plan: ». Avant chaque verdict, le contrôleur vérifie par git diff que les critères du jalon n'ont pas été affaiblis depuis la dernière consigne. »
2. Rétablir dans `PLAN.md`, sous forme de commandes, les critères des jalons non validés, à partir des consignes archivées :
   - Référence de dossier, y compris la personnalisation (jetons, « / », constructeur visuel, politiques de remise à zéro, numéro de départ, refus des modèles invalides et des changements qui redonneraient une référence existante, formes normalisées pour l'adresse de classement et l'export) ; créations simultanées sur deux postes sans doublon ni trou ; « Référence en attente » hors ligne ; immutabilité.
   - Conflits généralisés : révision de base, dernière écriture gagnante par champ, journal avec `dossier_id` et trois flux, conflit signalé ; un test par table sur deux postes avec une modification hors ligne ; test S5 d'un conflit sur un dossier restreint. La dette « fausse alerte de conflit » (J3) devient un critère de ce jalon.
   - Coque : § 7.3 et § 7.4 ; fond neutre et La journée sans points médians ; fonctions à leur place définitive (nouveau dossier, temps rattaché à un dossier, calcul de délai depuis la barre d'actions avec bibliothèque et lieu de résidence) ; synchronisation invisible ; galerie absente du build distribué, vérifiée par un test ; `data-testid` ; captures jour et nuit (trois chemises et La journée) ; dette CORS.
   - Vue scindée, Intercalaires personnalisés : critères de la consigne du 26 septembre, avec le test « retirer un intercalaire ne supprime rien » et un test S5 pour la table des intercalaires.
   - J9 et J10 : rédiger les critères à partir des § 3.8.6 et 7.6 et les présenter dans le prochain compte rendu ; l'architecte les validera.

   Commit dédié « plan: rétablir les critères des jalons non validés ». Puis poursuivre la mission.

Traitement :

- **Constat** : les critères détaillés figuraient dans `PLAN.md` jusqu'à `9ef3be6^` (Coque, Vue scindée, Intercalaires, Référence au format fixe, dettes complètes). Le commit `9ef3be6` (« docs: jalon Sync Streams… ») les a résumés en une ligne ou en renvoi au cahier, et a abrégé les dettes. Rejoué sur ce commit, `plan-gouvernance.mjs` le refuse : commit non dédié, jalons sans critères, six dettes ouvertes reformulées.
- **Règle** : ajoutée mot pour mot au § 4.4 de `docs/ordre-operation.md` et à `.cursor/agents/controleur.md` (méthode : comparaison `git diff` des critères avant tout verdict ; compte rendu : résultat de cette comparaison).
- **Outillage** (règle vérifiable = règle outillée) : `tests/recette/plan-gouvernance.mjs`, job `gouvernance` de la CI (historique complet, plage poussée ou demande de fusion) :
  - tout jalon non coché a une ligne de critères avec au moins une commande (phases 3 et 4 exemptées par une mention explicite : leurs critères seront proposés à l'architecte avant l'ouverture de la phase) ;
  - tout commit qui touche `PLAN.md` ne touche que lui et commence par « plan: » ;
  - d'un commit à l'autre, un jalon non coché ne perd aucune commande et une dette ouverte ne disparaît pas sans être cochée, sauf commit citant « Consigne de l'architecte du … » (le contrôleur rapproche alors le commit de la consigne consignée ici).
- **Critères rétablis** (commit dédié `plan:`) :
  - Référence de dossier décochée ; « Référence personnalisable (R0) » fusionnée dedans ; critères de l'attribution au format fixe conservés ;
  - Conflits généralisés : la dette J3 y devient un critère ;
  - Coque, Vue scindée, Intercalaires : textes de `9ef3be6^` (issus de l'adoption du cahier version 5, `5ff58b9`), complétés des tests demandés ;
  - dettes transverses rétablies dans leur rédaction complète ;
  - J9 et J10 : critères proposés, marqués « à valider par l'architecte ».
- **Arbitrage R0** : son texte n'a jamais été reçu (recherche dans le dépôt, l'historique git et toutes les sessions : seuls le complément du 27/09 et la présente consigne le citent). Les politiques de remise à zéro et le numéro de départ figurent en critères tels que la consigne les nomme ; leur interprétation est consignée dans `docs/hypotheses-dossiers.md` (R0-d à R0-f) et le texte est demandé au commandement (`BLOCAGES.md`, B11).
- **Preuves** (2026-09-27) :
  - commits `7bd1886` (règle, outillage, journal) puis `57e7046` « plan: rétablir les critères des jalons non validés » (PLAN.md seul) ;
  - `node tests/recette/plan-gouvernance.mjs` → OK ; `PLAN_RANGE=f1c90a2..261e538` → 1 commit touchant PLAN.md, OK ;
  - essais négatifs : rejeu de `9ef3be6` → FAIL (commit non dédié, jalons sans critères, six dettes reformulées) ; commit d'essai hors branche retirant un critère et une dette → FAIL sur les deux ;
  - CI de `445c910` : workflow refusé par GitHub en 0 s (nom d'étape contenant « plan: » sans guillemets), aucun job lancé. Correctif `261e538` et contrôle `workflows-valides.mjs` (essai négatif : FAIL ligne 48). La plage de l'exécution suivante ne contient plus `57e7046` : son contrôle est la preuve locale ci-dessus.

## 2026-09-27 — Référence de dossier : personnalisation (en cours)

- **Contrat partagé** (état-major, `445c910`) : `crates/domaine/src/reference.rs` (analyse du modèle, refus des modèles invalides, politique de remise à zéro, production, références qui seraient redonnées sous leur forme d'origine ou de classement, formes normalisées, reconnaissance des deux formes, initiales) ; cas partagés avec le poste dans `crates/domaine/tests/reference-vecteurs.json`. `cargo test -p legalos-domaine reference` → 7 tests OK ; `cargo clippy -p legalos-domaine --all-targets -- -D warnings` → OK.
- Précision de R0-f : un changement est refusé aussi quand il pourrait produire une référence de même forme de classement qu'une référence existante (l'adresse de classement doit désigner un seul dossier).
- **Lots lancés** en parallèle, chacun dans son worktree : API (`.worktrees/reference-modele-api`, sous-agent instance-backend : migration 017, `GET` et `PUT /cabinets/{id}/reference`, attribution selon le modèle, recette `reference-modele.mjs`) ; poste (`.worktrees/reference-modele-poste`, sous-agent poste-interface : portage TypeScript vérifié sur les vecteurs, constructeur visuel dans Réglages, palette avec échappement de `LIKE`, recettes Tauri).
- **Reprise du 27/09 (midi)** : les deux worktrees existaient sur `lot/reference-modele-*` au même HEAD que `main` (`7a50f3a`), sans aucun commit ni fichier de lot. Relance des deux sous-agents. Contrat API corrigé : migration 017 uniquement additive (`tests/recette/migrations-additives.mjs`) — table nouvelle `sequences_dossiers_continues`, pas de `DROP CONSTRAINT` sur `sequences_dossiers`.
- **Fusion** (2026-09-27) : [PR #2](https://github.com/navelremi-boop/legalos2/pull/2) (API, CI [36313632037](https://github.com/navelremi-boop/legalos2/actions/runs/36313632037), 5 jobs verts dont `s1-instance` et `reference-modele.mjs`) puis [PR #1](https://github.com/navelremi-boop/legalos2/pull/1) (poste, CI [36313631528](https://github.com/navelremi-boop/legalos2/actions/runs/36313631528), frontend vert dont `reference-modele-poste.mjs`). `main` à `869baf4`. `reference_classement` tenue par un déclencheur (pas `GENERATED ALWAYS` : le `jsonb_populate_record` du contrôleur refuse 428C9). Worktrees retirés. Recettes Tauri encore à exécuter.
- **Recettes Tauri** (poste-interface, après fusion) :
  - Préalable : PowerSync `PSYNC_S2305` (limite 1000 paramètres) avec ~209 dossiers publics — purge des dossiers sans facture (reste 16) ; sync rétabli.
  - `node tests/recette/reference-modele-ecran.mjs` → exit 0 ; référence écran et palette `2026/001` ; captures `target/controle-reference-modele/`.
  - `node tests/recette/reference-deux-postes-tauri.mjs` → exit 0 ; références distinctes sans trou (ex. `2026/006`…`2026/009`) ; correctif : second poste = copie du binaire (verrou Windows sur l'exe) ; démarrage séquentiel.
  - Cabinet démo remis à `{AAAA}-{N:3}` / `annuelle`.

## 2026-09-27 — La journée sans points médians (consigne 3)

- `Journee.tsx` : séparateurs remplacés par une virgule (« TJ Nanterre, 9 h 30 », « échéance le 3 oct., dans 5 jours ») ; `BarreHaut.tsx` : bouton des onglets en trop avec l'icône Tabler `IconDots` au lieu de « ··· ».
- Contrôle CI `tests/recette/points-medians.mjs` (job frontend) : refuse « · » et les caractères semblables dans les sources de l'interface. Essai négatif sur la version précédente → 9 occurrences refusées ; version corrigée → OK (44 fichiers). `typecheck`, `lint:ci`, `coque-app.mjs` → OK.
- Captures B9 : à régénérer à la validation de la Coque (critère `coque-app.mjs --captures`).

## 2026-09-26 — Consignes du commandement (architecte) : journal, conflits, La journée, permissions

Texte reçu :

1. **Synchronisation, journal des modifications (BLOQUANT dès qu'une autre table que `cabinets` l'alimente).** Le flux `cabinet_global` envoie `journal_modifications`, valeurs remplacées et appliquées comprises, à tous les utilisateurs du cabinet. Ajouter `dossier_id` (nul pour les enregistrements du cabinet) et répartir en trois flux : cabinet (`dossier_id` nul), publics et restreints (mêmes jointures que les tables filles). Test S5 : provoquer un conflit sur un dossier restreint et vérifier l'absence de l'entrée dans le SQLite du poste non autorisé.
2. **Invariant n° 2, conflits généralisés (§ 3.4).** La détection de conflit ne couvre aujourd'hui que le nom du cabinet. L'étendre à toutes les tables modifiables depuis le poste : dossiers, parties, temps, brouillons, taux, puis intercalaires. Révision de base envoyée avec chaque modification, dernière écriture gagnante par champ, valeur remplacée dans le journal, conflit signalé dans l'app. Nouveau jalon « Conflits généralisés », juste après Référence de dossier et avant la validation de la Coque. Tests : un conflit par table, sur deux postes, avec une modification hors ligne.
3. **La journée (B9)** : supprimer les points médians utilisés comme séparateurs (§ 7.9). Exemples : « TJ Nanterre, 9 h 30 » ; « échéance le 3 oct., dans 5 jours ». Régénérer les captures. Ajouter un contrôle en CI qui échoue si « · » apparaît dans un texte d'interface.
4. **Permissions Cursor** : `.cursor/permissions.json` ajouté par le commandement. Vérifier depuis Cursor que `garde-commandes` bloque toujours une commande qui commence par un préfixe autorisé, avec `git status; git push --force --dry-run origin main`, et consigner le résultat. Si les worktrees des sous-agents sont hors du dossier du projet : les placer dans `.worktrees/` à la racine du dépôt (ajouté au `.gitignore`) et adapter le § 4.3 de l'ordre d'opération.

Traitement :

- **Ordre des jalons** : Référence de dossier (VALIDÉE) → **Conflits généralisés** (consignes 1 et 2 ; le journal est réparti en trois flux avant qu'une autre table ne l'alimente) → Référence personnalisable (arbitrage R0, ci-dessous) → validation de la Coque (consigne 3 comprise). La dette J3 « conflit journalisé sur une écriture séquentielle du même poste » est soldée dans Conflits généralisés.
- **Consigne 4, vérification depuis Cursor** (2026-09-26, outil Shell de l'agent) : `git status; git push --force --dry-run origin main`.
  - Premier essai : refusé par le classifieur Auto-review de Cursor (consignes `block_instructions` de `permissions.json`).
  - Second essai, après approbation manuelle de la carte par le commandement : **refusé par le hook** — « Command execution was blocked by a hook: Commande bloquée par garde-commandes : push forcé. » Rien n'a été exécuté, pas même `git status`.
  - Contrôle outillé : `tests/recette/garde-hooks.mjs` lit la `terminalAllowlist` de `permissions.json` et vérifie, pour chacun des 40 préfixes, que `<préfixe>; git push --force --dry-run origin main`, `<préfixe> && git push -f origin main`, `<préfixe> | git push origin main --force-with-lease` et un push de tag sont refusés → `garde-hooks: OK`.
- **Worktrees** : aucun n'existait (`git worktree list` → `main` seul), mais le § 4.3 prévoyait `../legal-os-<lot>`, hors du projet. Désormais `git worktree add .worktrees/<lot> -b lot/<nom>` ; `.worktrees/` dans `.gitignore` et `.dockerignore` ; § 4.3 adapté ; `garde-commandes` refuse tout `git worktree add` hors de `.worktrees/` (cas refusés et autorisés dans `garde-hooks.mjs`). Les worktrees gérés par Cursor lui-même (sous-agent best-of-n-runner) ne sont pas utilisés par la mission.
- `.cursor/permissions.json` est commité avec le dépôt : la recette `garde-hooks.mjs` le lit en CI.

## 2026-09-27 — Complément à l'arbitrage R0 (référence personnalisable)

Texte reçu :

- Le caractère « / » est accepté dans le modèle comme texte libre, sans limite de nombre ni de position. Tests : `{AAAA}/{N:3}`, `RN/{AA}/{N:4}`, `{N}/{AAAA}`, et un modèle sans aucun séparateur.
- La référence est affichée, stockée, imprimée et recherchée (objet des mails, recherche, palette) avec ses « / » intacts.
- Formes normalisées, uniquement pour deux usages techniques : l'adresse de classement (« / » et tout caractère mal accepté par les messageries remplacés par « - ») et les noms de fichiers et de dossiers à l'export (caractères interdits par Windows, `/ \ : * ? " < > |`, remplacés par « - »). La reconnaissance d'un mail accepte la forme d'origine comme la forme normalisée.
- Réglages : en plus du modèle texte, un constructeur visuel par blocs (Année, Numéro avec nombre de chiffres, Initiales, Texte), avec entre chaque bloc le choix du séparateur (« / », « - », « . », « _ », espace ou aucun) et un aperçu en direct. Les deux vues restent synchronisées.

Le texte de l'arbitrage R0 lui-même (« référence personnalisable ») ne figure ni dans le dépôt ni dans l'historique des sessions : seul ce complément a été reçu. Base retenue, déduite du complément et du cahier § 3.4, à corriger si l'arbitrage dit autre chose :

- un modèle par cabinet, modifiable dans Réglages ; par défaut `{AAAA}-{N:3}`, le format actuel (les références déjà attribuées ne changent pas) ;
- jetons : `{AAAA}` année sur quatre chiffres, `{AA}` sur deux, `{N}` numéro sans complément, `{N:k}` complété à k chiffres sans troncature au-delà, `{INI}` initiales ; tout le reste est du texte libre, « / » compris ;
- le numéro reste attribué par le serveur, continu par cabinet et remis à zéro chaque année (§ 3.4) : le modèle doit donc contenir un jeton d'année et un jeton de numéro, sinon deux années produiraient la même référence ;
- initiales : celles de l'utilisateur qui crée le dossier, faute d'avocat responsable dans le modèle de données (hypothèse à valider, consignée dans `docs/hypotheses-dossiers.md`) ;
- un changement de modèle vaut pour les dossiers créés ensuite ; une référence attribuée ne change jamais ;
- recherche : le motif `LIKE` échappe `%` et `_` (« _ » est un séparateur autorisé).

Jalon « Référence personnalisable (R0) », après Conflits généralisés. Les deux normalisations (adresse de classement, export) sont écrites et testées dans le domaine dès ce jalon, puis branchées en J9 (classement, reconnaissance des deux formes) et J13 (export). *Remplacé par la consigne du 27/09 ci-dessus : la personnalisation fait partie du jalon Référence de dossier, qui passe avant Conflits généralisés.*

## 2026-09-26 — Référence de dossier : verdict VALIDÉ sur `6a1a050` (format fixe ; jalon rouvert le 27/09)

- Contrôleur sur `6a1a050` (CI `36272379503`, 5 jobs verts) : **VALIDÉ**, aucun bloquant. Critères § 3.4 contrôlés contre une image reconstruite depuis HEAD : attribution serveur en transaction, numéros continus (≈ 130 créations dont 30 simultanées : 1 à 91 sans trou), unicité par cabinet, immutabilité par déclencheur, remise à zéro annuelle (transaction annulée), jamais sur le poste, « Référence en attente » hors ligne puis « Dossier 2026-091 ».
- **Majeur 1** (images construites depuis l'arbre de travail en CRLF, deuxième récidive après la migration 014) → dette « Immédiat », soldée ci-dessous.
- **Majeur 2** (onglets de démonstration aux références écrites en dur, `CoqueApp.tsx:56`) → dette rattachée à la Coque.
- **Mineurs traités** :
  - rejeux simultanés du même dossier (4 à 5 réponses 500 sur 10) : verrou `pg_advisory_xact_lock` sur l'identifiant en tête de transaction ; `reference-dossier-api.mjs` exige dix 200 et une seule référence ;
  - rejeu d'un dossier restreint par un collaborateur hors `dossier_acces` : 404 sans référence (`ApiError::not_found`, réponse documentée dans l'OpenAPI) ; testé avec un collaborateur fictif ;
  - recettes en CI : `reference-dossier.mjs` (frontend), `reference-dossier-api.mjs` et `reference-dossier-controleur.mjs` (s1-instance) ; les deux recettes du contrôleur sont commitées ;
  - `docs/hypotheses-dossiers.md` cite le § 6 (points ouverts) ; `tests/recette/README.md` à jour ; critères du jalon en commandes dans `PLAN.md`.
- **Mineurs non traités** (sans impact en production, reportés) : pas de contrainte liant `reference` à l'année et au numéro ; horloge de l'API non injectable (remise à zéro prouvée au niveau de la base) ; sondage de 2 s des onglets au lieu d'une requête réactive (Coque).
- **Observations hors périmètre pour la Coque** : à 800 px, aucun onglet ne tient et le bouton Compte est coupé ; « Synchronisé » affiché pendant une coupure ; contenu de démonstration dans la vue d'un vrai dossier.

### Dette « Immédiat » : images et compilations depuis un arbre de travail en CRLF

- Cause : 130 fichiers suivis en CRLF dans l'arbre de travail (extraction antérieure à `eol=lf`), dont 12 migrations ; `sqlx::migrate!` calcule ses sommes sur les octets. L'image API et les compilations locales embarquaient donc d'autres sommes que la CI.
- Correctifs :
  - `instance/Dockerfile.api` ramène en LF les sources copiées avant `cargo build` (le Dockerfile Postgres le faisait déjà pour ses scripts) ;
  - `encodage-texte.mjs` vérifie la présence de ces normalisations et refuse tout fichier déclaré `eol=lf` mais en CRLF dans l'arbre de travail (`--corriger` le ramène en LF, contenu identique au commit) ; essai négatif : `rustfmt.toml` passé en CRLF → FAIL, puis `--corriger` → OK ;
  - arbre de travail ramené en LF (125 fichiers ; les `.ps1`/`.cmd`, déclarés `eol=crlf`, restent en CRLF) ; `git status` inchangé ;
  - outil `instance/outils/realigner-migrations-lf.mjs` (constat, puis `--appliquer`) : ne remplace que les sommes égales à la variante CRLF du fichier commité, s'arrête sur toute autre différence ;
  - règle `05-encodage.mdc` précisée (Dockerfiles, outil de réalignement).
- Base de développement (données fictives) : 12 sommes réalignées CRLF → LF (1–3, 6–13, 15) ; environ 95 dossiers fictifs créés par le contrôleur.
- Preuves (2026-09-26) :
  - `node instance/outils/realigner-migrations-lf.mjs --appliquer` → 12 migrations réalignées ; `docker compose build api` puis `up -d api` → « migrations sqlx appliquées », `/health` 200 ;
  - `node tests/recette/encodage-texte.mjs` → OK (246 fichiers, arbre de travail en LF, images ramenées en LF) ;
  - `node tests/recette/reference-dossier-api.mjs` → OK (dix rejeux simultanés → 200, une seule référence ; rejeu restreint → 404) ;
  - `node tests/recette/reference-dossier-controleur.mjs` → OK (section 7 : dix statuts 200) ; `node tests/recette/reference-dossier.mjs` → OK ;
  - `cargo fmt --all -- --check` et `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ;
  - `cargo test --workspace` (Postgres de l'instance) → exit 0, `auth_integration` compris ;
  - `node tests/recette/garde-hooks.mjs` → OK.
