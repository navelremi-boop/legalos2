# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-10-20 (jalon en cours : **J11**, refusé par le contrôleur sur `617a45e` ; critères (i) à (v) ajoutés le 14/10 et critères de la consigne du 20/10 : OAuth, relèves, droits, audit des dépendances).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

Règle (ordre d'opération § 4.4) : les critères d'un jalon non validé et les dettes ouvertes ne se suppriment, ne s'affaiblissent ni ne se remplacent par un renvoi au cahier ; seul l'architecte les modifie ; toute modification de ce fichier fait l'objet d'un commit dédié préfixé « plan: ». Contrôle outillé : `node tests/recette/plan-gouvernance.mjs`.

---

## Couverture V1

Chaque fonctionnalité n° 1 à 14 du § 4.2, et chaque élément de sa colonne « Détail », est rattaché à un jalon. Un élément sans jalon, ou rattaché à un jalon absent de ce plan, fait échouer `node tests/recette/plan-gouvernance.mjs`.

- **1 Dossiers**
  - Référence attribuée par le serveur → Référence de dossier
  - client → Dossiers et contacts complets
  - adversaires → Dossiers et contacts complets
  - confrères adverses → Dossiers et contacts complets
  - juridiction → J5
  - n° RG → J5
  - type de dossier → Dossiers et contacts complets
  - étape → Dossiers et contacts complets
  - dossiers liés → Dossiers et contacts complets
  - intercalaires standards → Coque de l'app
  - intercalaires personnalisés → Intercalaires personnalisés
- **2 Contacts**
  - personnes physiques et morales → Dossiers et contacts complets
  - rôle dans chaque dossier → Dossiers et contacts complets
  - historique → Dossiers et contacts complets
  - SIREN → Dossiers et contacts complets
  - n° TVA → Dossiers et contacts complets
  - type de client → Dossiers et contacts complets
- **3 Droits par dossier**
  - accès restreint à certains collaborateurs → J5
- **4 Agenda et délais**
  - audiences → Agenda
  - rendez-vous → Agenda
  - tâches → Agenda
  - rappels → Agenda
  - invitations reçues par mail → J11
- **5 Calcul des délais de procédure**
  - computation selon le CPC art. 640 à 642 → J6
  - augmentation pour distance art. 643-644 → J6
  - bibliothèque de délais usuels → J6
- **6 Documents**
  - arborescence par dossier → Documents, suite
  - versions → J7
  - ouverture dans Word avec renvoi automatique → Documents, suite
  - recherche → Documents, suite
- **7 Modèles et fusion**
  - courriers, conventions et actes générés depuis les données du dossier → Modèles et fusion
- **8 Client mail intégré**
  - client complet remplaçant Outlook → J9 ; J10 ; J11
  - classement dans les dossiers → J9
  - construit en 5 étapes → J9 ; J11
- **9 Temps**
  - chronomètre → Coque de l'app
  - saisie manuelle → J8
  - rattachement au dossier et à l'intervenant → J8
- **10 Facturation**
  - au temps → J8
  - au forfait → Facturation, suite
  - au résultat → Facturation, suite
  - provisions → Facturation, suite
  - débours → J8
  - conditions tarifaires par client, dossier et intervenant → Facturation, suite
  - avoirs → J8
  - relances → Facturation, suite
  - encours et impayés → Facturation, suite
- **11 Facturation électronique**
  - PDF et Factur-X → J8
  - dépôt sur la plateforme agréée → J8
  - e-reporting → J8
  - suivi des statuts → J8
  - statut encaissée → J8
- **12 Conventions d'honoraires**
  - modèle → Conventions d'honoraires
  - rattachement au dossier → Conventions d'honoraires
  - alerte si dossier sans convention signée → Conventions d'honoraires
- **13 Tableau de bord**
  - chiffre d'affaires → Tableau de bord
  - encours → Tableau de bord
  - temps non facturé → Tableau de bord
  - rentabilité par dossier et par client → Tableau de bord
  - factures en erreur ou en attente sur la plateforme agréée → Tableau de bord
  - mails à classer → Tableau de bord
- **14 Révocation des postes**
  - révocation et effacement à distance → J12

---

## Phase 0 — Reconnaissance et planification

- [x] **J0** — Phase 0 complète — VALIDÉ (contrôleur, détail dans `docs/journal/phase-0.md`)

---

## Phase 1 — Fondations (gate : contrôleur avant phase 2)

- [x] **J1** — Instance S1 — VALIDÉ (détail dans `docs/journal/phase-1.md`)
- [x] **J2** — Auth API, 2FA, premier lancement — VALIDÉ `3f4647d` (CI [36134053175](https://github.com/navelremi-boop/legalos2/actions/runs/36134053175))
- [x] **J3** — Sync bout en bout Tauri — VALIDÉ `86e0856` (CI [36155397731](https://github.com/navelremi-boop/legalos2/actions/runs/36155397731))
- [x] **J4** — Build Tauri, polices, pas de WebDriver — VALIDÉ `7871c68` (CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952))
- [x] **Gate phase 1** — VALIDÉ (CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952) et [36166067737](https://github.com/navelremi-boop/legalos2/actions/runs/36166067737))

---

## Phase 2 — Lots parallèles

Ordre architecte (révisé 2026-10-04) : **Migration Sync Streams** → **J8** → **Référence de dossier** → **Conflits généralisés** → **Coque** → **Vue scindée** → **Intercalaires personnalisés** → **Dossiers et contacts complets** → **Agenda** → **Documents, suite** → **J9** → **J10** → **Montée PowerSync** → **J11** → **Modèles et fusion** → **Conventions d'honoraires** → **Facturation, suite** → **Tableau de bord** → **J12** → **J13** → **J14**. Conventions d'honoraires avant Facturation, suite : la facturation reprend les modes de la convention.

- [x] **J5** — Dossiers, contacts, droits — VALIDÉ `340ac42` (CI [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399))
- [x] **J6** — Agenda et délais — VALIDÉ `bf3bfe3` (CI [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)) ; reprise H1–H13 `0fc0c17` ; H7/H10/H12 → B10
- [x] **J7** — Documents et versions — VALIDÉ `5ff58b9` (CI [36232407821](https://github.com/navelremi-boop/legalos2/actions/runs/36232407821))
- [x] **Migration Sync Streams** — VALIDÉ `9f80388` (CI [36265441004](https://github.com/navelremi-boop/legalos2/actions/runs/36265441004))
- [x] **J8** — Temps et facturation électronique (S9) — VALIDÉ `e8eb6b2` (CI [36269667975](https://github.com/navelremi-boop/legalos2/actions/runs/36269667975))

- [x] **Référence de dossier** — VALIDÉ `03ca364` (contrôleur, CI [36322383021](https://github.com/navelremi-boop/legalos2/actions/runs/36322383021))

- [x] **Conflits généralisés** — VALIDÉ `61e77c8` (contrôleur, CI [36357904754](https://github.com/navelremi-boop/legalos2/actions/runs/36357904754))

- [x] **Coque de l'app** — VALIDÉ `831e398` (contrôleur, CI [36475104465](https://github.com/navelremi-boop/legalos2/actions/runs/36475104465))

- [x] **Vue scindée** — VALIDÉ `f393190` (contrôleur, CI [36531714153](https://github.com/navelremi-boop/legalos2/actions/runs/36531714153))

- [x] **Intercalaires personnalisés** — VALIDÉ `9e0aa69` (contrôleur, CI [36561017502](https://github.com/navelremi-boop/legalos2/actions/runs/36561017502))

- [x] **Dossiers et contacts complets** — VALIDÉ `3482a36` (contrôleur, CI [36572546272](https://github.com/navelremi-boop/legalos2/actions/runs/36572546272))

- [x] **Agenda** — VALIDÉ `57fd4dc` (contrôleur sur `635714e`, CI [36586753618](https://github.com/navelremi-boop/legalos2/actions/runs/36586753618))

- [x] **Documents, suite** — VALIDÉ `6f5f757` (contrôleur sur `8e962d7`, CI [36687786819](https://github.com/navelremi-boop/legalos2/actions/runs/36687786819))

- [x] **J9** — VALIDÉ `a036e24` (contrôleur [étape 3](f0db1509-4bcf-4701-a6dd-eb44db4835ca), CI [36751876546](https://github.com/navelremi-boop/legalos2/actions/runs/36751876546))

- [x] **J10** — VALIDÉ `dd5c92a` (contrôleur [dates](5a587655-3ac9-4930-88bc-0bfbf4583fac), CI [37229519725](https://github.com/navelremi-boop/legalos2/actions/runs/37229519725))

### Dettes transverses (§ 4.4)

- [x] **Immédiat** : `garde-commandes` et `garde-secrets` refusent, et le signalent, quand ils ne parviennent pas à lire leur entrée — `node tests/recette/garde-hooks.mjs`.
- [x] **Immédiat** : images et compilations depuis un arbre de travail en CRLF (majeur 1 du contrôle Référence) — `Dockerfile.api` ramené en LF ; `node tests/recette/encodage-texte.mjs` ; outil `instance/outils/realigner-migrations-lf.mjs`.
- [x] **Avant la fin de la Coque** : CORS — ajouter `tauri://localhost` ; `localhost:1420` accepté seulement en mode développement.
- [x] **Avant la fin de la Coque** : onglets de démonstration aux références écrites en dur (`CoqueApp.tsx:56`, majeur 2 du contrôle Référence) ; onglets à 800 px (réduction, puis menu des dossiers ouverts) ; indicateur « Synchronisé » affiché pendant une coupure ; contenu de démonstration dans la vue d'un vrai dossier.
- [x] **Avant J14** : feature `test-webdriver` réalisée (WebDriver embarqué, WebdriverIO) pour les scénarios de l'app, aussi en CI macOS.
- [ ] **Avant J17** : revue juridique par l'avocat avant toute mise en service réelle (délais H1–H13, facturation F0–F8, installation) — `RAPPORT.md`, section du même nom.
- [x] **Avant J14** : build distribué sans outils de développement ni débogage distant, vérifié par un test.
- [x] **Avant J14** : épingler chaque action tierce de la CI sur un hash de commit complet, pas sur une étiquette (la CI manipulera alors les clés de signature) — liste dans `BLOCAGES.md`, contrôle `node tests/recette/workflows-valides.mjs`.
- [ ] **Avant la coche de J11** (consigne de l'architecte du 20/10/2026, décochée : cochée sans qu'aucun `cargo deny check` ne tourne en CI) : `cargo-deny` en CI sur les deux workspaces ; signalement préparé pour PowerSync / dépendance `time` 0.2. Critères détaillés dans J11, « audit des dépendances ».
- [x] **Avant Facturation, suite** : contrôle du SIREN (clé de Luhn) et d'un n° TVA commençant par FR (clé = (12 + 3 × (SIREN mod 97)) mod 97), à la saisie sur le poste et dans l'API ; message d'erreur en français — `node tests/recette/siren-tva.mjs`.
- [x] **Avant la fin de la phase 2** : moteur de délais en TypeScript strict ; licence OFL livrée avec les polices.
- [x] **Avant la fin de la phase 2** : la preuve « fausse alerte » de `node tests/recette/conflits-poste-tauri.mjs` aligne `revision_edition` par `fixerRevisionEdition` au lieu d'attendre la reprise réelle du même poste.
- [x] **Avant la fin de la phase 2** : `recetteHooks.ts` insère une entrée dans `ps_crud` lorsque le SDK ne journalise pas le PATCH hors ligne ; le chemin d'écriture réel reste à prouver sans cette injection.
- [x] **Avant la fin de J9 et de Documents, suite** : brancher la vue scindée sur les éléments synchronisés (mails, pièces, factures), sans réintroduire de jeu fictif dans le dossier réel ni dans le build distribué.
- [x] **Avant J11** : authentification OAuth pour Microsoft 365 et Gmail (secret côté serveur, renouvellement du jeton) — `node tests/recette/oauth-messagerie.mjs`.
- [ ] **Avant J17, ou avant tout cabinet qui utilise Microsoft 365 ou Gmail** (décision de l'architecte du 22/10/2026, B18 confirmé : pas d'essai OAuth réel avant la coche de J11) : essai réel de la connexion OAuth (autorisation, relève IMAP et envoi SMTP en XOAUTH2, renouvellement et révocation du jeton) chez Microsoft 365 et chez Gmail, sur une boîte de test, résultat consigné dans `JOURNAL.md`. La boîte réelle du commandement n'est jamais utilisée en développement.
- [ ] **Ne bloque plus J11** (décision de l'architecte du 10/10/2026) : `conflits-poste-tauri` : instabilité au lancement, `#root` vide, environ une passe sur dix, présente avant la montée — signature : page chargée, `#root` sans enfant, aucune erreur JavaScript, Vite répond ; mesures et diagnostic dans `docs/journal/ab-powersync.md` et `docs/journal/prechauffe-vite.md`. **Soldée si** (a) la cause est identifiée à partir du diagnostic d'un échec naturel de la recette, ou (b) `node tests/recette/conflits-poste-tauri.mjs --build` passe 30 fois consécutives en mode build, sans serveur Vite (option `--build`, jamais le mode par défaut). **Contournement pour J11** : les recettes qui lancent l'application relancent le lancement une seule fois, uniquement quand l'échec porte la signature ci-dessus ; la relance est journalisée et comptée, la recette échoue à partir de deux relances par exécution ; aucun autre échec n'est relancé.
- [x] **Dans la Coque claire** (consigne de l'architecte du 10/10/2026 : le grain visible des maquettes est la cible, l'opacité de 0,04 du cahier § 7.3 est abandonnée) : grain du fond lin aligné sur les maquettes (`design/grain.svg` sans l'opacité, cahier corrigé) — critère : l'écart-type de luminosité du fond sur la capture du poste est compris entre 5 et 8 en jour (maquette : 6,84) et entre 1,0 et 2,5 en nuit (maquette : 1,45) ; mesuré : jour 6,62, nuit 2,08 ; `node tests/recette/grain-fond.mjs` (essai négatif : un grain nul échoue dans les deux modes) ; à solder par la revalidation du contrôleur sur ce seul point.
- [ ] **Avant la fin de la phase 3** (rattachée à Finition des écrans ; consigne de l'architecte du 10/10/2026 : les autres détails de la coque sont soldés dans la Coque claire) : pastille de fond de l'onglet actif ; pilule du chronomètre sur La journée (rattachée au jalon Temps).
- [ ] **Avant J12** (décision de l'architecte du 14/10/2026) : gestion des membres des boîtes partagées, rôle administrateur minimal, contrôle de rôle sur `/messagerie/modeles` (aujourd'hui aucun système de rôles dans l'API).
- [ ] **Avant J12** (consigne de l'architecte du 24/10/2026) : D9, types TypeScript générés depuis `/openapi.json` (outil figé dans `docs/versions.md`), utilisés par les fichiers `api*.ts`, contrôle en CI que les types générés sont à jour ; l'architecte adapte `.cursor/rules/11-api.mdc`.
- [ ] **Avant J12** (consigne de l'architecte du 24/10/2026) : D8, écran Réglages des identifiants d'application OAuth, réservé au rôle administrateur (dépend de la dette « rôle administrateur » ci-dessus).
- [ ] **Avant J12** (consigne de l'architecte du 24/10/2026) : D11, recette de la mesure des 50 000 messages réparée (`node tests/recette/s7-synchro.mjs`), exécutée par un workflow hebdomadaire avec déclenchement manuel ; durée consignée.
- [ ] **Avant la fin de la Finition des écrans** (décision de l'architecte du 14/10/2026) : la liste des dossiers du poste est limitée à 50 sur 3 522 (`Dossiers.tsx`, `ORDER BY nom LIMIT 50`) ; retirer le préfixe « 000 » des dossiers de `tests/recette/agenda-tauri.mjs` une fois la liste corrigée.
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA, édition 3) relus et consignés dans `docs/versions.md`.
- [x] **Avant le premier compte réel (B8)** : échecs de connexion IMAP — temporisation croissante ; après un refus d'authentification, arrêt des tentatives et état « identifiants refusés » visible par le titulaire ; aucune boucle sans délai. Essai négatif compris — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : veille IDLE renouvelée avant 29 minutes (RFC 2177) ; une session de relève réutilisée pour tous les dossiers ; relève au réveil et au plus toutes les 10 minutes sans réveil — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : serveur CONDSTORE sans QRESYNC — drapeaux par CHANGEDSINCE, suppressions par UID SEARCH ; relève complète seulement si le serveur n'offre ni l'un ni l'autre, et jamais plus d'une fois par cycle de 10 minutes — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : un compte modifié ou supprimé arrête ou redémarre sa tâche avec les nouveaux paramètres — `node tests/recette/s7-connexions.mjs`.

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

Critères validés par l'architecte le 04/10/2026, complétés par la consigne du 07/10/2026 (écrans V1 d'après les maquettes). Ordre (consigne du 07/10/2026) : **Bascule vers Claude Code** → **Montée PowerSync** → **Coque claire** → **J11** → **Finition des écrans** → **Écran de connexion** → **Modèles et fusion** → **Conventions d'honoraires** → **Facturation, suite** → **Tableau de bord** → **J12** → **J13** → **J14** → **J15 à J17**.

Décisions du commandement (06/10/2026) :
- En mode jour : barre haute claire, barre d'actions claire, fond neutre « lin » avec grain, feuille blanche. En mode nuit : sombres. Les couleurs de chemise de dossier ne changent pas.
- Menu du compte à droite de la barre : Temps, Réglages, Palette de commandes, Verrouiller, Se déconnecter. Temps et Réglages ne sont plus dans la navigation principale (La journée, Dossiers, Mails, Agenda, Facturation).
- Le Tableau de bord est le premier onglet de Facturation (Tableau de bord, Factures, À facturer).
- Les données des maquettes (`design/maquettes/`) sont fictives : jamais dans l'app, sauf dans le jeu de démonstration de développement.
- L'écran Temps n'a pas encore de maquette : ne pas le refaire avant que l'architecte en fournisse une. Le logo est en attente : ne pas toucher à l'icône.

Preuve visuelle commune à tout jalon d'écran : le contrôleur rend la maquette (Playwright, 1240 par 800, jour et nuit) et la capture de l'application au même état, les compare, liste les écarts. Un écart de structure (volets, ordre, élément absent) refuse le jalon ; un écart de détail (espacement, ombre) est consigné en dette. Le commandement garde son veto (B9).

- [x] **Bascule vers Claude Code** — VALIDÉ `6c7b0a6` (contrôleur 07/10/2026, CI [37680889863](https://github.com/navelremi-boop/legalos2/actions/runs/37680889863)) — critères validés par l'architecte le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - `CLAUDE.md` à la racine, au contenu exact transmis par le commandement le 07/10/2026 (autorité et état, début, pendant et fin de session, interdits).
    - `node tests/recette/regles-synchronisees.mjs` → exit 0 (CI) : chaque `.cursor/rules/<nom>.mdc` a son `.claude/rules/<nom>.md` au corps identique (`globs` devient `paths`, `alwaysApply: true` devient une règle sans `paths`) ; les lignes propres à Cursor (hook de relance, arrêt pour attendre, fichier STOP) vivent dans `.cursor/rules/01-cursor.mdc`, absente de `.claude/rules` ; essai négatif inclus.
    - Sous-agents dans `.claude/agents/` : `controleur` (model sonnet, effort high), `facturation`, `instance-backend`, `messagerie`, `poste-interface` (portage des `.cursor/agents`, même corps) ; `executant` (nouveau : model haiku, lecture, édition et exécution de tests, ni `git push` ni `git commit`, refuse synchronisation, droits, facturation, messagerie et sécurité) ; `Explore` (surcharge du sous-agent intégré : model haiku, lecture seule).
    - `.claude/settings.json` versionné : liste d'autorisation reprise de `.cursor/permissions.json` ; `blockReadsOutsideWorkingDirectories: true` ; `disableBypassPermissionsMode: "disable"` ; hooks PreToolUse (Bash|PowerShell) garde-commandes, PreToolUse (Read) garde-secrets, PostToolUse (Bash|PowerShell) apres-commande ; aucun hook Stop. Les scripts de `.cursor/hooks` restent la seule implémentation : `lib.mjs` reconnaît le format d'entrée (Cursor ou Claude Code) et répond dans le bon format (`hookSpecificOutput.permissionDecision` « deny » avec `permissionDecisionReason`).
    - `node tests/recette/garde-hooks.mjs` → exit 0 : chaque garde couvert dans les deux formats, avec essai négatif pour chacun ; la recette de `continuer.mjs` (Cursor) reste verte.
    - `docs/ordre-operation.md` : section « Outils et niveaux » (Claude Code outil principal, Cursor en réserve ; niveaux N executant Haiku, N+1 agent principal Sonnet 5.5 high, contrôleur, N+2 architecte ; routine de session du `CLAUDE.md`).
    - `.cursor/` reste fonctionnel. Contrôleur (sous-agent `controleur`) VALIDÉ ; CI verte.
    - Maquettes : `design/maquettes/` (les six `prototype-*.html`) et `design/maquettes/LISEZMOI.md` de trois lignes, commit unique « design: maquettes validées des écrans V1 », aucun autre fichier modifié ; rien n'est implémenté d'après elles avant l'inscription de la consigne du 07/10/2026.

- [x] **Montée PowerSync** — VALIDÉ `cbd4e4c` (contrôleur 10/10/2026 sur `cbd4e4c`, CI [37984697441](https://github.com/navelremi-boop/legalos2/actions/runs/37984697441) sur `f209eb1` ; les commits suivants n'ajoutent que de la documentation et `tests/recette/ab-conflits.mjs`) — décision de l'architecte du 10/10/2026 sur le banc A/B (`docs/journal/ab-powersync.md`) : l'instabilité de `conflits-poste-tauri.mjs` précède la montée ; dette ouverte ci-dessous — après la Bascule vers Claude Code, avant J11 — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/powersync-0-1.mjs` → exit 0 : `tauri-plugin-powersync` 0.1.x et crate `powersync` 0.1.x ; connecteur adapté ; les quatre exceptions RustSec absentes de `deny.toml` ; `patches/time-macros` et `patches/time-macros-impl` absents ; `rand` 0.7.3 absent du `Cargo.lock` ; `docs/versions.md` et `docs/audit-dependances.md` à jour ; B12 clos.
    - `node tests/recette/s5-sync-streams.mjs`, `node tests/recette/s6-documents.mjs`, `node tests/recette/conflits-poste-tauri.mjs` et `node tests/recette/s5-buckets-volume.mjs` → exit 0.
    - Playwright en dernière version stable (GHSA-7mvr-c777-76hp) ; `node tests/recette/coque-app.mjs --captures` → exit 0 (captures S13 relancées).
    - Contrôleur VALIDÉ ; CI verte.

- [x] **Coque claire** — avant J11 — critères validés par l'architecte le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - `design/tokens.css` reçoit les jetons de barre, de barre d'actions et de fond lin, aux valeurs des maquettes ; aucun hexadécimal dans les `.tsx`.
    - `node tests/recette/coque-jour-nuit.mjs` → exit 0 : en jour, luminance relative de la barre haute et de la barre d'actions supérieure à 0,6, fond de l'écran supérieur à 0,5 ; en nuit, inférieure à 0,25. Essai négatif : l'ancienne valeur échoue.
    - Menu du compte : s'ouvre au clic et à la touche Entrée, se ferme par Échap et clic extérieur ; cinq entrées (Temps, Réglages, Palette de commandes, Verrouiller, Se déconnecter) ; Temps et Réglages s'ouvrent depuis lui ; la navigation principale n'a que cinq entrées ; `data-testid` stables.
    - La journée et le dossier ouvert (trois chemises) alignés ; captures jour et nuit (`node tests/recette/coque-app.mjs --captures`) comparées aux maquettes et à `design/prototype-cabinet.html`.
    - Détails de la coque (consigne du 10/10/2026), vus sur les captures jour et nuit par le contrôleur : bouton primaire du dock utilisé, titre de page quasi noir, fond de nuit `#1E2629`, marges de la feuille de 30 px, avatar du compte à la place de la pilule « Compte » (`node tests/recette/menu-compte.mjs` et `node tests/recette/menu-compte-tauri.mjs` → exit 0 ; `node tests/recette/identite-compte.mjs` → exit 0).
    - Grain du fond (consigne du 10/10/2026) : `node tests/recette/grain-fond.mjs` → exit 0 (écart-type de luminosité du fond entre 5 et 8 en jour, entre 1,0 et 2,5 en nuit, mesuré sur la capture du poste ; essais négatifs : l'ancienne tuile à 0,04 et un grain nul).
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J11** — Mail étapes 4–5 — fait partie de la V1 ; critère final : pouvoir fermer Outlook — critères validés par l'architecte le 04/10/2026, complétés le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Écran Mails d'après `design/maquettes/prototype-mails.html` (les critères J11 du 04/10 restent) : trois volets (comptes et dossiers ; liste ; lecture), vue « À classer » en tête, classement depuis le message, carte d'invitation, rédaction à la place du volet de lecture avec le dossier de rangement, file d'envoi hors du volet de lecture, dossiers IMAP en français ; preuve visuelle commune.
    - `node tests/recette/j11-redaction.mjs` → exit 0 (app Tauri, GreenMail) :
      - réponse, réponse à tous et transfert avec l'historique cité, lisible dans Outlook et Gmail ; pièces jointes conservées au transfert ;
      - à, cc et cci avec complétion depuis les contacts et les mails déjà échangés ;
      - mise en forme simple (gras, italique, listes, liens) ; texte collé depuis Word nettoyé ;
      - pièces jointes par glisser-déposer, avec taille maximale annoncée ;
      - brouillon enregistré automatiquement, stocké dans le dossier Brouillons du serveur IMAP (visible depuis un client de test jouant le téléphone et le webmail), repris sur un autre poste, disponible hors ligne ;
      - signature : une par compte, insérée à la rédaction, modifiable dans Réglages ;
      - modèle de message réutilisé sans recompiler ;
      - l'envoi passe par la file jusqu'à « copie dans Envoyés confirmée ».
    - `node tests/recette/j11-invitation.mjs` → exit 0 : une invitation reçue (demande, mise à jour, annulation) est reflétée dans l'agenda du titulaire, et pas chez un autre collaborateur ; réponse accepter, refuser ou peut-être envoyée à l'organisateur ; fuseaux Europe/Paris et fuseau étranger respectés.
    - `node tests/recette/j11-boites.mjs` → exit 0 : deux comptes nominatifs ne sont visibles que par leur titulaire ; une boîte partagée est visible par ses membres et absente chez un non-membre ; le tableau de santé montre la dernière relève, un refus d'authentification et un envoi en échec ; notification de bureau à l'arrivée d'un mail.
    - `node tests/recette/j11-journee-sans-outlook.mjs` → exit 0 (app Tauri, GreenMail et Dovecot) : recevoir, lire, classer, répondre avec historique, transférer avec pièce jointe, rédiger un mail neuf avec pièce jointe et signature, reprendre un brouillon sur un second poste, accepter une invitation, retrouver un ancien mail par la recherche ; tout depuis l'app, sans autre client mail.
    - Suggestion de temps tirée d'un mail (consigne du 10/10/2026) : un mail lu ou traité propose des minutes à saisir sur le dossier où il est classé, proposition offerte à l'écran Temps et à La journée (écrans livrés par la Finition des écrans), jamais enregistrée sans validation de l'utilisateur ; couverte par `node tests/recette/j11-redaction.mjs` ou `node tests/recette/j11-journee-sans-outlook.mjs`.
    - Critères ajoutés (consigne de l'architecte du 10/10/2026), chacun couvert par une recette avec essai négatif :
      - (a) modèles de message réutilisables sans recompiler : table, routes, gestion dans Réglages — `node tests/recette/j11-redaction.mjs` ;
      - (b) invitations : demande, mise à jour (SEQUENCE) et annulation reflétées dans l'agenda du seul titulaire ; réponse à l'organisateur ; fuseaux Europe/Paris et étranger, passage à l'heure d'hiver — `node tests/recette/j11-invitation.mjs` ;
      - (c) HTML reçu et texte collé depuis Word nettoyés : aucun script, aucun contenu distant — `node tests/recette/j11-redaction.mjs` ;
      - (d) en-têtes non injectables : un retour à la ligne dans l'objet ou dans une adresse est refusé — `node tests/recette/j11-redaction-api.mjs` ;
      - (e) la copie cachée n'apparaît jamais dans les en-têtes reçus par les autres destinataires — `node tests/recette/j11-redaction-api.mjs` ;
      - (f) In-Reply-To et References posés ; « répondre à tous » exclut l'adresse de l'expéditeur — `node tests/recette/j11-redaction-api.mjs` ;
      - (g) brouillons repris sur un second poste et disponibles hors ligne — `node tests/recette/j11-redaction.mjs` ;
      - (h) droits : un collaborateur ne lit pas la boîte nominative d'un autre, ni par l'API ni par la synchronisation ; essai négatif sur les deux — `node tests/recette/j11-boites.mjs`.
    - Critères ajoutés (décision de l'architecte du 14/10/2026, après le refus du contrôleur sur `617a45e`), chacun couvert par une recette avec essai négatif :
      - (i) identité d'envoi : From = adresse du compte choisi à la rédaction (nominatif ou partagé) ; Reply-To seulement si le compte le définit ; la réponse iTIP part de l'adresse invitée (ATTENDEE) ; envoi depuis un autre compte refusé (essai négatif) — `node tests/recette/j11-redaction-api.mjs` et `node tests/recette/j11-invitation.mjs` ;
      - (ii) date d'en-tête conservée (migration additive), affichée et utilisée pour le tri du chrono ; la date d'arrivée reste distincte — `node tests/recette/j11-mails-ecran.mjs` ;
      - (iii) marquer lu/non lu, archiver, supprimer (vers la Corbeille, jamais d'EXPUNGE immédiat) et déplacer, pour une boîte nominative ou partagée, via une file idempotente reprise après coupure, répercutée sur IMAP ; essai négatif de droits — `node tests/recette/j11-boites-actions.mjs` ;
      - (iv) recherche serveur sur objet, expéditeur, destinataires et corps, dans les limites des droits ; essai négatif sur la boîte d'un autre et sur un dossier restreint — `node tests/recette/j11-boites-actions.mjs` ;
      - (v) écrans de connexion d'une boîte (IMAP/SMTP et OAuth) et de santé — `node tests/recette/j11-connexion-boites.mjs` ; la gestion des membres est la dette « Avant J12 » (§ Dettes transverses).
    - Avant toute coche : la cause des échecs intermittents de relève (`s7-classement`, `j11-redaction`, `j11-invitation`) est établie et consignée dans `JOURNAL.md` ; relancer jusqu'au vert n'est pas une preuve.
    - Critères ajoutés (consigne de l'architecte du 20/10/2026), chacun couvert par une recette ou un test avec essai négatif :
      - (v-OAuth) connexion OAuth de Microsoft 365 et de Gmail, IMAP et SMTP en XOAUTH2 : flux code d'autorisation avec PKCE, redirection de bouclage locale (RFC 8252) captée par le poste ; le poste demande l'URL d'autorisation à l'instance (`POST /messagerie/oauth/debut`), ouvre le navigateur du système, capte le code sur 127.0.0.1 et le transmet à l'instance (`POST /messagerie/oauth/echange`) ; l'instance vérifie le `state` (usage unique, 10 minutes, lié à l'utilisateur et au compte), échange le code avec le vérificateur PKCE qu'elle seule détient, chiffre et stocke le jeton de rafraîchissement ; aucun jeton sur le poste, dans une réponse HTTP ni dans un journal ; identifiants d'application configurés par instance (Réglages, installation), procédure d'enregistrement chez Microsoft et Google dans `docs/` ; écran de santé : jeton expiré ou révoqué → « Reconnecter » ; recette sur un simulateur local étendu (autorisation, PKCE, bouclage) ; essais négatifs : `state` inconnu, expiré et rejoué, vérificateur PKCE faux, autre utilisateur, fournisseur inconnu. Essai réel sur la boîte du commandement : B18, avant la coche si cette boîte est chez Microsoft 365 ou Google ;
      - relèves intermittentes, condition non remplie : dans `JOURNAL.md`, un tableau par recette (`s7-classement`, `j11-invitation`, `j11-redaction`) — symptôme, cause, correctif (produit ou recette), preuve avant et après ; correctifs dans le produit, pas dans les recettes : (a) clé JWT persistante, API qui refuse de démarrer sans elle hors développement, `kid` dérivé de la clé, la recette ne redémarre plus PowerSync après l'API ; (b) fenêtre entre relève initiale et veille IMAP : un test déterministe dépose un message dans cette fenêtre, relevé en moins de 30 s ; (c) mesure de performance de `j11-boites-actions` dans un compte dédié, double compaction à la fin, contrôle du seau de l'utilisateur de démo ; série à froid (Docker redémarré avant) : 10 passes vertes consécutives de `s7-classement` et de `j11-invitation`, 5 de `j11-redaction`, consignées ; un échec sans cause établie empêche la coche ;
      - droits sur toute l'API : 404 pour une ressource que l'utilisateur ne doit pas voir, 403 pour une ressource visible et une action interdite ; essais négatifs alignés ;
      - expéditeur par défaut : le compte sélectionné dans le rail de l'écran Mails ; depuis un dossier ou la barre d'actions, la boîte nominative ; réponse et transfert depuis le compte qui a reçu le message ;
      - indexation en tâche de fond, côté serveur, du corps de tous les messages (les plus récents d'abord), progression dans l'écran de santé ; la recherche (iv) couvre les messages jamais ouverts (test) ;
      - route de liste des dossiers IMAP d'un compte, avec les noms français des dossiers spéciaux, utilisée par « Déplacer » ;
      - routes `/messagerie/comptes…` ajoutées à OpenAPI, client du poste régénéré ; contrôle en CI : toute route de l'API figure dans le contrat ;
      - audit des dépendances (la dette « `cargo-deny` sur les deux workspaces » est décochée et se solde avant la coche de J11) : `cargo deny check` réellement exécuté en CI sur le workspace racine et sur celui du poste ; `jsonwebtoken` sur la variante `aws_lc_rs` pour retirer la crate `rsa` (RUSTSEC-2023-0071) ; avis `ttf-parser` traité (mise à jour, ou exception nominative justifiée et datée) ; `yoke-derive` retirée du lock ; résultat dans `docs/audit-dependances.md` ;
      - noms de recettes `j11-boites-actions.mjs` et `j11-connexion-boites.mjs` confirmés.
    - Critères ajoutés (consigne de l'architecte du 24/10/2026, verdict du contrôleur du 22/10/2026), chacun couvert par une recette ou un test avec essai négatif ; ordre : routes `nominatif`, `Message-ID`, indexation, recettes de facturation, installation OAuth, journal d'erreurs du poste, puis les 10 passes à froid en dernier sur le code final, puis le contrôleur sur l'ensemble de J11 :
      - D4, journal d'erreurs du poste : panics Rust, erreurs JavaScript non capturées et fin anormale du processus, écrits dans le répertoire de données de l'app avec rotation et sans contenu sensible (test) — `cargo test --manifest-path apps/poste/src-tauri/Cargo.toml journal_erreurs` ; en cas d'échec ou d'arrêt du poste, `j11-connexion-boites` joint les 200 dernières lignes de ce journal et l'état de santé lu par l'API ; puis 10 passes consécutives à froid de `node tests/recette/j11-connexion-boites.mjs`. Si elles passent : coche permise, avec la dette « D4 : cause de l'arrêt du poste à établir au premier échec, avant J12 ». Si l'une échoue : cause établie avant la coche ;
      - D6, indexation des corps : tentatives bornées (5, attente croissante), puis statut « abandonné » compté dans `corps_abandonnes` ; messages d'une UIDVALIDITY périmée exclus du compte jusqu'à leur resynchronisation ; la progression finit par « terminée » sur la boîte GreenMail — `cargo test -p legalos-api indexation_corps` et `node tests/recette/j11-boites-actions.mjs` ;
      - D10, aucun `Message-ID` dans les journaux, un identifiant interne à la place — `cargo test -p legalos-api journaux_sans_message_id` ;
      - routes `/messagerie/nominatif/*` et leur code supprimés, retirés du contrat ; `s7-synchro.mjs` adapté aux routes actuelles — `cargo test -p legalos-api --test contrat_routes` et `node tests/recette/s7-synchro.mjs` ;
      - D8, `cargo xtask install` demande et écrit les identifiants d'application OAuth (facultatif, ignorable) ; `docs/oauth-messagerie.md` mis à jour — `cargo test -p xtask install_oauth` ;
      - recettes `node tests/recette/s9-factures.mjs` (alignée sur le contrat de synchronisation actuel, à garantie S5 égale sur les factures) et `node tests/recette/reference-dossier-api.mjs` (pose et restaure son propre modèle) → exit 0 avant la coche ;
      - acceptés sans critère nouveau : D5 (cause de la relève de `j11-redaction` acceptée ; le journal cite la fonction corrigée par laquelle passe la relève et le test déterministe qui la couvre, section UIDVALIDITY de `s7-classement`) ; boîte nominative par défaut quand le rail désigne plusieurs boîtes partagées : voulu.
    - À la coche de J11, le journal de J11 est archivé dans `docs/journal/`.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Finition des écrans** — après J11 — critères validés par l'architecte le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Dossiers (`design/maquettes/prototype-dossiers.html`) : la liste est l'écran ; création dans un panneau à droite, la liste restant visible (test) ; tri par prochaine échéance avec groupes ; filtres Actifs, Échéance proche, Restreints, Clos avec compteurs ; recherche sur tous les dossiers, clos compris ; aperçu à droite ; un dossier restreint n'apparaît qu'aux personnes autorisées (`node tests/recette/s5-sync-streams.mjs` → exit 0).
    - Agenda (`design/maquettes/prototype-agenda.html`) : vues Jour et Semaine, mini-calendrier, filtres par type, prochaines échéances ; éléments simultanés lisibles ; échéance calculée avec « Voir le calcul » ; suppression d'une échéance calculée confirmée et tracée ; création à la demande dans un panneau. Les critères d'Agenda du 29/09 restent verts (`node tests/recette/agenda-tauri.mjs` → exit 0).
    - Réglages (`design/maquettes/prototype-reglages.html`) : une section dont la fonction n'existe pas encore n'est pas affichée.
    - Temps, écran du menu du compte (`design/maquettes/prototype-temps.html`, consigne du 10/10/2026) : chronomètre avec pause et arrêt confirmé en minutes ; saisie manuelle acceptant « 1 h 30 », « 45 min », « 0,75 » (tests unitaires du lecteur de durée, cas limites compris) ; montant et taux affichés avant enregistrement ; liste par jour ; filtres Toutes, Non facturées, Facturées et Le cabinet, Mes temps ; résumé (non facturé, sept derniers jours, par dossier) ; une saisie facturée est verrouillée (la modification est refusée par l'API, test) ; le taux est figé à l'enregistrement (changer un taux ne change pas une saisie, test) ; la saisie fonctionne hors ligne ; le chronomètre est visible dans la barre de tous les écrans, avec la pastille du dossier, raccourci T. La suggestion de temps tirée d'un mail est livrée avec J11.
    - La journée (`design/maquettes/prototype-journee.html`, consigne du 10/10/2026) : quatre sections ; classement en un clic par le même chemin que l'écran Mails ; temps à saisir tirés des mails et de l'agenda ; délais avec la mention « Calculé » pour ceux du moteur.
    - Captures jour et nuit des états principaux (`node tests/recette/coque-app.mjs --captures` → exit 0) comparées aux maquettes ; tests existants verts ; preuve visuelle commune.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Écran de connexion** — après la Finition des écrans — critères validés par l'architecte le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Parcours S2 d'après `design/maquettes/prototype-connexion.html` : adresse du serveur (premier lancement seulement), connexion, double authentification (six cases, collage accepté), préparation du poste avec progression réelle.
    - Situations : application verrouillée, hors ligne trop longtemps, poste révoqué, accès au Trousseau refusé ; chacune déclenchée par un test, sans perte de données locales.
    - Sécurité : le message d'erreur ne distingue pas l'adresse du mot de passe (test sur la réponse de l'API et sur l'interface) ; le mot de passe n'est jamais écrit sur le disque ni dans les journaux (`node tests/recette/s2.mjs` → exit 0, test S2 étendu) ; chiffrement du disque non détecté : avertissement non bloquant et poste inscrit « chiffrement non confirmé » au registre des postes.
    - Décisions en attente, inscrites dans BLOCAGES : codes de secours de la double authentification (B18) et chiffrement du disque bloquant ou non (B19). Tant que B18 n'est pas tranché, le lien « code de secours » n'est pas affiché. (La consigne les numérotait B16 et B17, déjà pris par l'honoraire de résultat et la durée hors ligne : renumérotées, à confirmer par l'architecte.)
    - Captures des onze états de la maquette comparées (`node tests/recette/coque-app.mjs --captures` → exit 0) ; preuve visuelle commune.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Modèles et fusion** — § 4.2 n° 7 — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/modeles-fusion.mjs` → exit 0 (app Tauri) :
      - un courrier, une convention et un acte sont générés depuis les données du dossier (docxtemplater, cœur gratuit uniquement, aucun module payant) ; format compatible avec l'insertion future de blocs par `{@rawXml}` ;
      - le modèle est modifiable sans recompiler le binaire ; modèles stockés par cabinet, remplacés depuis Réglages ; génération possible hors ligne ;
      - catalogue des champs dans le document `modeles-champs.md` (répertoire docs) ; un champ absent ou vide arrête la génération et liste les champs manquants ; aucune balise résiduelle dans le document produit ;
      - le document produit devient un document versionné du dossier ; styles, polices et retraits du modèle conservés à l'identique.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Conventions d'honoraires** — § 4.2 n° 12 — critères validés par l'architecte le 04/10/2026 — après Modèles et fusion, avant Facturation, suite
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/conventions-honoraires.mjs` → exit 0 (app Tauri) :
      - une convention est produite par Modèles et fusion, rattachée au dossier ;
      - statuts brouillon, envoyée, signée (dépôt de l'exemplaire signé) ;
      - modes temps passé, forfait, résultat complémentaire, repris par la facturation ;
      - alerte à l'ouverture du dossier et à la création d'une facture tant qu'aucune convention n'est signée ; levée possible avec un motif consigné. Liste des motifs proposée au commandement (B15), non inventée en silence.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Facturation, suite** — § 4.2 n° 10, ce que J8 n'a pas livré — critères validés par l'architecte le 04/10/2026, complétés le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Écran d'après `design/maquettes/prototype-facturation.html` (les critères du 04/10 restent) : onglets Tableau de bord, Factures, À facturer ; relance validée avant envoi ; encaissement saisi sur place ; alerte de convention manquante dans À facturer ; preuve visuelle commune.
    - `node tests/recette/facturation-suite.mjs` → exit 0 (API, Postgres réel, puis app) :
      - facture au forfait et au résultat ;
      - précédence des taux documentée et testée : intervenant sur le dossier, puis dossier, puis client, puis taux général de l'intervenant, puis cabinet (décision PROVISOIRE du commandement du 10/10/2026, testée dans cet ordre ; à signaler à l'architecte si une règle métier l'impose autrement) ; taux figé à la saisie : modifier un taux ne change ni les temps saisis ni les brouillons ;
      - honoraire de résultat seulement en complément d'un honoraire principal et si la convention du dossier le prévoit ; sinon, refus avec message (règle à confirmer par le commandement, B16) ;
      - provisions : appel, encaissement, imputation sur la facture finale ; TVA selon les hypothèses F (`docs/hypotheses-facturation.md`, revue B10) ;
      - conditions tarifaires par client, par dossier et par intervenant ;
      - relances : modèle par niveau, historique par facture, envoi uniquement après validation de l'utilisateur, par la file d'envoi ;
      - encours et impayés par client et par ancienneté (0–30, 31–60, 61–90, plus de 90 jours) ; total égal aux factures moins les encaissements, vérifié sur un jeu de test ;
      - consigne de l'architecte du 24/10/2026 (question e du contrôleur J11) : numéro de TVA de l'acheteur tiré de la fiche du client, refus de valider une facture à un professionnel français sans ce numéro (bloquant avant toute première facture réelle) ; vérifier que le règlement est transmis à la plateforme par une file idempotente reprise après échec ; `GET /annuaire/{siren}` : contrôle du format du SIREN (clé de Luhn) ; les erreurs de validation restent en 400, seules les ressources introuvables passent en 404.
    - `node tests/recette/s9-factures.mjs` → exit 0 (non-régression du temps, des débours, des avoirs et de la facturation électronique).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Tableau de bord** — § 4.2 n° 13 — critères validés par l'architecte le 04/10/2026, complétés le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Le Tableau de bord est le premier onglet de Facturation, d'après `design/maquettes/prototype-facturation.html` (les critères du 04/10 restent) ; chiffres calculés comme défini dans le document `tableau-de-bord.md` (répertoire docs) ; preuve visuelle commune.
    - `node tests/recette/tableau-de-bord.mjs` → exit 0 (app Tauri, requêtes locales) :
      - chiffre d'affaires, encours, temps non facturé, rentabilité par dossier et par client, factures en erreur ou en attente sur la plateforme agréée, mails à classer ;
      - définition écrite de chaque indicateur dans le document `tableau-de-bord.md` (répertoire docs) : période, HT ou TTC, facturé ou encaissé ;
      - jeu fixe dont les valeurs attendues sont calculées à la main dans le test, indépendamment du code ;
      - requêtes dans un module de données, jamais dans les composants ; mention visible : chiffres calculés sur les dossiers accessibles à l'utilisateur.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J12** — Révocation postes (S10) — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/s10-revocation.mjs` → exit 0 :
      - jeton du poste révoqué refusé par l'API dès la révocation ; aucune écriture de sa file appliquée ; refus consigné ;
      - à la connexion suivante : effacement de la base locale, du cache de fichiers, du jeton et des secrets du trousseau ; le poste révoqué n'écrit plus ;
      - verrouillage d'un poste resté hors ligne au-delà de 30 jours (proposition au commandement, B17) ;
      - révocation journalisée.
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J13** — Export complet (S12) — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/s12-export.mjs` → exit 0 :
      - export de toutes les données du cabinet, des documents (dernière version et historique), des mails classés (`.eml`), des factures (PDF et Factur-X) et des journaux ;
      - formats ouverts ; page d'index lisible sans l'application ; manifeste SHA-256 vérifié par le test ;
      - noms de fichiers et de dossiers en forme normalisée de la référence (R0) ;
      - réservé à un administrateur et journalisé ; testé sur le jeu de 3 000 dossiers.
    - Contrôleur VALIDÉ ; CI verte.

- [ ] **J14** — Mises à jour à chaud et distribution (S11, S14a) — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/s11-maj.mjs` → exit 0 : une archive d'interface signée est appliquée ; elle déclare la plage de versions du binaire compatible ; une archive incompatible, falsifiée ou tronquée est refusée et la version précédente est conservée ; un échec revient à la version précédente ; clé privée de signature hors du dépôt (secret de CI), rotation documentée ; aucune mise à jour appliquée pendant une saisie.
    - `node tests/recette/s14a-install.mjs` → exit 0 (Windows) : l'installateur s'installe, l'application construite démarre, le scénario de fumée passe.
    - Contrôleur VALIDÉ ; CI verte.

---

## Phase 4 — Durcissement et recette

Critères de chaque jalon à proposer à l'architecte avant l'ouverture de la phase 4.

- [ ] **J15** — `cargo xtask recette` S1–S14a (Windows)
- [ ] **J16** — S14b macOS CI + captures S13
- [ ] **J17** — Revue sécurité, `RAPPORT.md`, `.mission/TERMINEE`

---

## Rappel

Un jalon n'est coché que si § 4.4 de l'ordre d'opération est entièrement satisfait (preuves dans `JOURNAL.md`).
