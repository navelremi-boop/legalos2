# LEGAL OS — Journal (décisions et preuves)

Synthèse (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`).

- **Phase 0–1** VALIDÉES ; **J5–J7** VALIDÉS ; **Migration Sync Streams** VALIDÉE `9f80388` ; **J8** VALIDÉ `e8eb6b2`.
- **Référence de dossier** : **non validée** (consigne du 27/09) ; verdict partiel VALIDÉ sur `6a1a050` pour l'attribution au format fixe ; la personnalisation (arbitrage R0 et complément) fait partie du jalon.
- **En cours** : **Référence de dossier**, personnalisation.
- **Ordre** : ~~Streams~~ → ~~J8~~ → **Référence de dossier** (personnalisation comprise) → Conflits généralisés → Coque (validation, points médians compris) → Vue scindée → Intercalaires → J9 → J10.
- **Gouvernance de `PLAN.md`** : règle de l'ordre § 4.4 (27/09) ; contrôle `tests/recette/plan-gouvernance.mjs` (CI, job gouvernance).
- **Sync** : Streams édition 3, service 1.26.1. Dette mensuelle avis PowerSync.
- **Coque** corrigée (`22d765e`), non cochée : points médians de La journée (consigne 3), onglets de démonstration (dette), captures B9.

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
