# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-10-30 (jalon en cours : **Annuaire** ; **Tenue visuelle** validée, veto B9 levé à titre provisoire le 30/10/2026 ; **Conventions d'honoraires** suspendu, reprend après Diligences ; le crash `0xC0000374` bloque J14).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

Règle (ordre d'opération § 4.4) : les critères d'un jalon non validé et les dettes ouvertes ne se suppriment, ne s'affaiblissent ni ne se remplacent par un renvoi au cahier ; seul l'architecte les modifie ; toute modification de ce fichier fait l'objet d'un commit dédié préfixé « plan: ». Contrôle outillé : `node tests/recette/plan-gouvernance.mjs`.

---

## Couverture V1

Chaque fonctionnalité n° 1 à 14 du § 4.2, et chaque élément de sa colonne « Détail », est rattaché à un jalon. Un élément sans jalon, ou rattaché à un jalon absent de ce plan, fait échouer `node tests/recette/plan-gouvernance.mjs`.

- **1 Dossiers**
  - Référence attribuée par le serveur → Référence de dossier
  - client → Dossiers et contacts complets ; Annuaire
  - adversaires → Dossiers et contacts complets ; Annuaire
  - confrères adverses → Dossiers et contacts complets ; Annuaire
  - juridiction → Dossiers et contacts complets ; Juridictions et administrations
  - n° RG → Dossiers et contacts complets ; Juridictions et administrations
  - type de dossier → Dossiers et contacts complets
  - étape → Dossiers et contacts complets
  - dossiers liés → Dossiers et contacts complets
  - intercalaires standards → Coque de l'app
  - intercalaires personnalisés → Intercalaires personnalisés
- **2 Contacts**
  - personnes physiques et morales → Annuaire
  - coordonnées multiples → Annuaire
  - désignation dans les actes → Annuaire
  - professions réglementées → Annuaire
  - qualité dans chaque dossier → Annuaire
  - liens datés entre contacts → Annuaire
  - import par SIREN et dirigeants du registre → Annuaire
  - doublons et fusion → Annuaire
  - historique → Annuaire
  - répartition du capital à date → Structures et capital
  - juridictions et administrations → Juridictions et administrations
  - instances successives d'un dossier → Juridictions et administrations
  - SIREN, n° TVA, type de client → Dossiers et contacts complets
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
  - registre des diligences → Diligences
  - frais et débours en quantité × prix unitaire → Diligences
  - chronomètre → Coque de l'app
  - saisie datée → Diligences
  - propositions issues des mails → Diligences
- **10 Facturation**
  - au temps → J8 ; Diligences
  - au forfait → Facturation, suite
  - au résultat → Facturation, suite
  - provisions → Facturation, suite
  - débours → J8
  - conditions tarifaires par client, dossier et intervenant → Facturation, suite
  - avoirs → J8
  - relances → Facturation, suite
  - encours et impayés → Facturation, suite
  - facture préparée à partir des diligences → Diligences
  - lignes regroupées par type → Diligences
  - relevé détaillé en annexe → Diligences
  - créance irrécouvrable → Facturation, suite
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

## Backlog V2

Hors V1 (consigne de l'architecte du 29/10/2026). Ce ne sont pas des jalons de la mission.

- Organigramme du groupe et détention indirecte.
- Import des statuts déposés à l'INPI.
- Suggestion de la juridiction compétente à partir d'une adresse : le référentiel publie le ressort des cours d'appel, des conseils de prud'hommes et des TAE, pas celui des tribunaux judiciaires.
- Commissaires de justice proches d'une adresse.
- Annonces BODACC sur la fiche.

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

Ordre architecte (révisé 2026-10-04) : **Migration Sync Streams** → **J8** → **Référence de dossier** → **Conflits généralisés** → **Coque** → **Vue scindée** → **Intercalaires personnalisés** → **Dossiers et contacts complets** → **Agenda** → **Documents, suite** → **J9** → **J10** → **Montée PowerSync** → **J11** → **Modèles et fusion** → **Conventions d'honoraires** → **Facturation, suite** → **Tableau de bord** → **J12** → **J13** → **J14**. La séquence après Modèles et fusion est révisée le 30/10/2026 : voir la phase 3.

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
- [ ] **Avant J17** : revue juridique par l'avocat avant toute mise en service réelle (délais H1–H13, facturation F0–F13, installation) — `RAPPORT.md`, section du même nom.
- [ ] **Avant J14** (consigne de l'architecte du 27/10/2026) : le poste distribué produit, en cas de crash natif, un cliché local que l'avocat peut joindre à un signalement. Sans cela, un crash chez un confrère sera impossible à diagnostiquer.
- [ ] **Avant J14** (consigne de l'architecte du 27/10/2026, soir) : aucune distribution tant que le crash `0xC0000374` du client PowerSync se reproduit. Composant : `powersync_core` 0.5.4, `StreamingSyncIteration::apply_transition`, depuis `sqlite3_step`. Signalement prêt : `docs/signalements/powersync-native-c0000374.md`. Le commandement le poste.
- [x] **Avant J14** (consigne de l'architecte du 27/10/2026, CI de `e95c644`) : plus de copie modifiée de PowerSync dans le dépôt. Le poste dépend de la publication `powersync` 0.1.1, qui épingle `powersync_core` 0.5.3.
- [x] **Avant J14** : build distribué sans outils de développement ni débogage distant, vérifié par un test.
- [x] **Avant J14** : épingler chaque action tierce de la CI sur un hash de commit complet, pas sur une étiquette (la CI manipulera alors les clés de signature) — liste dans `BLOCAGES.md`, contrôle `node tests/recette/workflows-valides.mjs`.
- [x] **Avant la coche de J11** (consigne de l'architecte du 20/10/2026, décochée : cochée sans qu'aucun `cargo deny check` ne tourne en CI) : `cargo-deny` en CI sur les deux workspaces ; signalement préparé pour PowerSync / dépendance `time` 0.2. Critères détaillés dans J11, « audit des dépendances ».
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
- [x] **Avant J12** (décision de l'architecte du 14/10/2026) : gestion des membres des boîtes partagées, rôle administrateur minimal, contrôle de rôle sur `/messagerie/modeles` (aujourd'hui aucun système de rôles dans l'API).
- [x] **Avant J12** (consigne de l'architecte du 24/10/2026) : D9, types TypeScript générés depuis `/openapi.json` (outil figé dans `docs/versions.md`), utilisés par les fichiers `api*.ts`, contrôle en CI que les types générés sont à jour ; l'architecte adapte `.cursor/rules/11-api.mdc`.
- [x] **Avant J12** (consigne de l'architecte du 24/10/2026) : D8, écran Réglages des identifiants d'application OAuth, réservé au rôle administrateur (dépend de la dette « rôle administrateur » ci-dessus).
- [x] **Avant J12** (consigne de l'architecte du 24/10/2026) : D11, recette de la mesure des 50 000 messages réparée (`node tests/recette/s7-synchro.mjs`), exécutée par un workflow hebdomadaire avec déclenchement manuel ; durée consignée.
- [x] **Avant la fin de la Finition des écrans** (décision de l'architecte du 14/10/2026) : la liste des dossiers du poste est limitée à 50 sur 3 522 (`Dossiers.tsx`, `ORDER BY nom LIMIT 50`) ; retirer le préfixe « 000 » des dossiers de `tests/recette/agenda-tauri.mjs` une fois la liste corrigée.
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA, édition 3) relus et consignés dans `docs/versions.md`. Relire aussi l'exception RUSTSEC-2026-0459 (`apps/poste/src-tauri/deny.toml`, B25) : la lever dès qu'une version de `powersync` et de `tauri-plugin-powersync` accepte `rusqlite` 0.41 ou plus et date d'au moins quatorze jours (consigne de l'architecte du 12/11/2026).
- [x] **Avant le premier compte réel (B8)** : échecs de connexion IMAP — temporisation croissante ; après un refus d'authentification, arrêt des tentatives et état « identifiants refusés » visible par le titulaire ; aucune boucle sans délai. Essai négatif compris — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : veille IDLE renouvelée avant 29 minutes (RFC 2177) ; une session de relève réutilisée pour tous les dossiers ; relève au réveil et au plus toutes les 10 minutes sans réveil — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : serveur CONDSTORE sans QRESYNC — drapeaux par CHANGEDSINCE, suppressions par UID SEARCH ; relève complète seulement si le serveur n'offre ni l'un ni l'autre, et jamais plus d'une fois par cycle de 10 minutes — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : un compte modifié ou supprimé arrête ou redémarre sa tâche avec les nouveaux paramètres — `node tests/recette/s7-connexions.mjs`.

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

Critères validés par l'architecte le 04/10/2026, complétés par la consigne du 07/10/2026 (écrans V1 d'après les maquettes). Ordre (consigne du 07/10/2026, Tenue visuelle insérée le 28/10/2026, révisé le 30/10/2026) : **Bascule vers Claude Code** → **Montée PowerSync** → **Coque claire** → **J11** → **Finition des écrans** → **Écran de connexion** → **Modèles et fusion** → **Tenue visuelle** → **Annuaire** → **J8, lot correctif Factur-X** → **Juridictions et administrations** → **Structures et capital** → **Diligences** → **Conventions d'honoraires** → **Facturation, suite** → **Tableau de bord** → **J12** → **J13** → **J14** → **J15 à J17**. Conventions d'honoraires est suspendu (décision du commandement du 30/10/2026) : le code déjà écrit reste, aucun autre jalon ne s'appuie sur la table locale `conventions_honoraires`, le jalon reprend après Diligences. Les ajustements de Facturation, suite du 30/10/2026 sont inscrits dans ce plan (jalon Facturation, suite). Aucun paragraphe d'ajout de synchronisation pour Conventions d'honoraires n'apparaît dans `docs/consignes/criteres-diligences.md` tel que versé ; à fournir par le commandement.

Décisions du commandement (06/10/2026) :
- En mode jour : barre haute claire, barre d'actions claire, fond neutre « lin » avec grain, feuille blanche. En mode nuit : sombres. Les couleurs de chemise de dossier ne changent pas.
- Menu du compte à droite de la barre : Temps, Réglages, Palette de commandes, Verrouiller, Se déconnecter. Temps et Réglages ne sont plus dans la navigation principale (La journée, Dossiers, Mails, Agenda, Facturation).
- Le Tableau de bord est le premier onglet de Facturation (Tableau de bord, Factures, À facturer).
- Les données des maquettes (`design/maquettes/`) sont fictives : jamais dans l'app, sauf dans le jeu de démonstration de développement.
- L'écran Temps a pour référence `design/maquettes/prototype-temps.html` (validée le 10/10/2026), modifiée seulement par l'extrait de `design/maquettes/prototype-diligences.html`. Le logo est en attente : ne pas toucher à l'icône.

Preuve visuelle commune à tout jalon d'écran : le contrôleur rend la maquette (Playwright, 1240 par 800, jour et nuit) et la capture de l'application au même état, les compare, liste les écarts. Un écart de structure (volets, ordre, élément absent) refuse le jalon ; un écart de détail (espacement, ombre) est consigné en dette. Consigne de l'architecte du 28/10/2026 : tout jalon qui livre un écran fournit en plus les captures jour et nuit à 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440, sur le jeu de démonstration (jalon Tenue visuelle). Le veto B9 est levé à titre provisoire le 30/10/2026 ; il peut revenir avec des remarques.

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

- [x] **J11** — VALIDÉ `1ebfac5` (contrôleur [série 0.5.3](f7264e1e-6b4b-4eb7-8c5f-813f260ff3f0), CI [40590037375](https://github.com/navelremi-boop/legalos2/actions/runs/40590037375))

- [x] **Finition des écrans** — VALIDÉ `1fa6e2a` (contrôleur [finition](b956d982-b60e-4da1-9fa6-bb344c7fc8ca), CI [40713792209](https://github.com/navelremi-boop/legalos2/actions/runs/40713792209))

- [x] **Écran de connexion** — VALIDÉ `5b7f36f` (contrôleur [jalon](cc215437-1656-48a9-87be-6f9a5b5689d3), CI [40737316177](https://github.com/navelremi-boop/legalos2/actions/runs/40737316177))

- [x] **Modèles et fusion** — VALIDÉ `6887969` (contrôleur [jalon](d080c260-de76-403c-91e3-48d4cbb3415a), CI [40748763193](https://github.com/navelremi-boop/legalos2/actions/runs/40748763193)) — § 4.2 n° 7 — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/modeles-fusion.mjs` → exit 0 (app Tauri) :
      - un courrier, une convention et un acte sont générés depuis les données du dossier (docxtemplater, cœur gratuit uniquement, aucun module payant) ; format compatible avec l'insertion future de blocs par `{@rawXml}` ;
      - le modèle est modifiable sans recompiler le binaire ; modèles stockés par cabinet, remplacés depuis Réglages ; génération possible hors ligne ;
      - catalogue des champs dans le document `modeles-champs.md` (répertoire docs) ; un champ absent ou vide arrête la génération et liste les champs manquants ; aucune balise résiduelle dans le document produit ;
      - le document produit devient un document versionné du dossier ; styles, polices et retraits du modèle conservés à l'identique.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [x] **Tenue visuelle** — VALIDÉ `affd717` (CI [40770940066](https://github.com/navelremi-boop/legalos2/actions/runs/40770940066) ; contrôleur [reprise](9089e6d9-4b32-4709-9422-3c10ef183407) ; veto B9 levé à titre provisoire le 30/10/2026) — après Modèles et fusion, avant Annuaire — consigne de l'architecte du 28/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/tenue-visuelle.mjs` → exit 0 :
      - la feuille a une largeur maximale et reste centrée ; listes, aperçu, fiche et intercalaires ont des largeurs fixes ou bornées ; les intercalaires restent collés à la feuille ; dans une ligne de liste, le nom et l'échéance restent proches ; aucun texte tronqué quand la place existe ;
      - jeu réaliste d'une trentaine de dossiers aux noms plausibles, avec parties, échéances sur trois semaines, mails, temps et factures, chargé dans une instance de démonstration distincte de celle des recettes ;
      - vue d'un dossier : le formulaire des parties et des dossiers liés s'ouvre dans un panneau, avec des champs étiquetés et des valeurs à majuscule initiale ; un dossier lié se choisit par recherche (nom, référence), jamais par un identifiant ;
      - agenda : lignes entre les heures ; jour courant marqué dans le mini-calendrier ; jours des mois voisins atténués ; « Sans heure » sur une seule ligne ; message de conflit dans un bandeau ; la fiche ne montre qu'un élément de la période affichée ; dates en toutes lettres dans les titres, jamais au format 2026-01-21 ; compteurs des filtres calculés sur la période affichée ;
      - le zéro barré est réservé aux références ; le texte, les compteurs et les montants n'ont pas de zéro barré.
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 : captures jour et nuit à 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440, sur le jeu de démonstration, pour Dossiers, la vue d'un dossier, Mails, Agenda, La journée, Temps et Réglages.
    - Le contrôleur compare ces captures, puis le commandement valide sur son écran (B9). `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Annuaire** — § 4.2 n° 2 — critères validés par l'architecte le 29/10/2026 — après Tenue visuelle, avant Juridictions et administrations
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/annuaire.mjs` → exit 0 (app Tauri) :
      - **Écran.** Entrée « Contacts » de la navigation principale, entre Dossiers et Mails, d'après `design/maquettes/prototype-contacts.html` : liste à gauche (recherche, filtres Tous, Personnes, Sociétés, Professions, regroupement alphabétique), fiche à droite (onglets Général, Liens, Dossiers, Factures, Mails, Notes ; Structure ou Participations au jalon suivant). Contacts accessibles aussi depuis la palette. `data-testid` stables.
      - **Fiche d'une personne physique.** Civilité (liste du cabinet : Madame, Monsieur, Maître au départ ; ni « Mademoiselle » ni champ « sexe »), accord grammatical (déduit de Madame et Monsieur, demandé pour toute autre civilité), prénoms, nom, nom de naissance, date et lieu de naissance, nationalité, profession, situation familiale. Pas de numéro de sécurité sociale.
      - **Fiche d'une personne morale.** Dénomination, forme (table des catégories juridiques de l'INSEE embarquée), capital et monnaie, SIREN, greffe du RCS, n° TVA intracommunautaire, activité. Contrôles SIREN et TVA existants (`tests/recette/siren-tva.mjs`) repris sans changement.
      - **Professions réglementées**, sur la fiche et non dans le dossier : avocat (barreau, toque), commissaire de justice, notaire, expert judiciaire (spécialité, cour d'appel), administrateur judiciaire, mandataire judiciaire, expert-comptable, commissaire aux comptes. Filtre « Professions » de la liste.
      - **Coordonnées multiples et typées** : adresses (domicile, siège, correspondance, facturation, cabinet, étude), téléphones, e-mails, sites ; une valeur principale par type ; aucun champ fax.
      - **Codes postaux.** Base officielle des codes postaux (La Poste, Licence Ouverte) embarquée dans le poste, source et date dans `docs/versions.md` ; le code postal propose la ou les communes, hors ligne ; adresse à l'étranger en saisie libre avec le pays.
      - **Désignation dans les actes**, calculée et affichée sur la fiche, avec un bouton Copier :
        - personne physique : civilité, prénoms, nom, « né(e) [nom de naissance si différent] le … à … », nationalité, profession, adresse du domicile principal ;
        - personne morale : dénomination, forme, capital, greffe et numéro du RCS, adresse du siège, organe représentant (« prise en la personne de son [fonction] en exercice, [civilité prénom nom], domicilié(e) en cette qualité audit siège ») tiré du lien de mandat social en cours marqué « représente la société » ;
        - professionnel : « Me [prénom nom], avocat(e) au barreau de … » et équivalents.
        Une mention manquante est signalée sur la fiche et nommée ; la fusion d'un modèle qui l'utilise s'arrête et nomme le champ (règle de `docs/modeles-champs.md`). Jeu de cas écrit à la main dans le test, accords féminins compris.
      - **Qualités.** Table `qualites` par cabinet, modifiable dans Réglages (rôle administrateur). Liste livrée : client, adversaire, demandeur, défendeur, intervenant volontaire, intervenant forcé, appelant, intimé, appelé en déclaration de jugement commun, caution, assureur, avocat, avocat plaidant, avocat postulant, commissaire de justice, notaire, expert amiable, expert judiciaire, administrateur judiciaire, mandataire judiciaire, liquidateur judiciaire, commissaire à l'exécution du plan, curateur, tuteur, représentant légal, associé, apporteur d'affaires, autre. Chaque qualité indique si elle admet un rattachement. Une qualité utilisée ne se supprime pas, elle s'archive.
      - **Intervenants d'un dossier.** Table `dossier_intervenants` (dossier, contact, qualité, rattaché à un autre intervenant du même dossier, note). Dans la vue du dossier : groupement par qualité, rattachés en retrait sous leur partie (« Me Anne Perrin, avocate de SARL Duclos Industrie »). Un même contact peut avoir des qualités différentes dans deux dossiers. Contrôle : un rattachement vise un intervenant du même dossier, jamais lui-même.
      - **Reprise des parties.** Chaque ligne de `parties` devient un intervenant lié à une fiche : `contact_id` repris quand il existe ; sinon une fiche est créée, marquée « à compléter », nature déduite de la forme en tête du nom (SAS, SARL, SA, SCI, EURL, SNC, SELARL, association…) et sinon personne physique ; noms identiques après normalisation dans un même cabinet regroupés sur une seule fiche ; rôles client, adversaire et confrère repris en qualités client, adversaire et avocat. Reprise idempotente, testée sur le jeu de 3 000 dossiers : aucun dossier sans son client, aucune partie perdue, deux exécutions donnent le même résultat. `parties` reste en base, en lecture seule, jusqu'à J13 ; migrations par ajouts seulement.
      - **Liens entre contacts.** Table `contact_liens` (contact source, contact cible, type, fonction, « représente la société », pour le compte de, début, fin, source, note). Types : mandat social (gérant, président, directeur général, directeur général délégué, administrateur, membre du directoire, membre du conseil de surveillance, liquidateur amiable), représentant permanent, associé (renvoie aux participations au jalon suivant), salarié, conjoint ou partenaire de PACS, parent, expert-comptable, commissaire aux comptes, autre avec libellé. Affichage dans les deux sens (« Président de SAS Ferrand Métal » ; « Président : M. Antoine Ferrand »). Lien terminé conservé et affiché « du … au … ». Contrôles : fin postérieure au début ; un mandat social vise une personne morale ; au plus un mandat en cours marqué « représente la société » par fonction.
      - **Import par SIREN.** Par l'instance (route dédiée, jamais depuis le poste directement), qui interroge l'API Recherche d'entreprises (service public, sans clé ; URL, limite de débit et date de vérification dans `docs/versions.md`) ; délai d'attente de 10 s ; cache de 24 h. Déclenché seulement par un bouton. Résultat présenté comme une proposition : chaque champ (dénomination, forme, adresse du siège, activité) est validé par l'utilisateur, à la création comme à la mise à jour d'une fiche existante (ancienne valeur et valeur du registre côte à côte). Le capital et le greffe, absents de ce registre, restent à saisir. Source et date d'import enregistrées. Hors ligne ou service indisponible : bouton désactivé ou message en français, saisie manuelle toujours possible. Essais négatifs : SIREN invalide, SIREN inconnu, service coupé.
      - **Dirigeants du registre.** Proposés, jamais créés d'office ; rapprochés des fiches existantes (personne physique : nom, prénoms, mois et année de naissance ; personne morale : SIREN) ; l'utilisateur choisit, pour chacun, relier à la fiche trouvée, créer une fiche, ou ignorer.
      - **Doublons.** Détection à la création et à la demande : même SIREN, même adresse e-mail, ou mêmes nom, prénoms et date de naissance. Fusion par l'instance, en une transaction : choix de la valeur champ par champ ; intervenants, liens (dans les deux sens, doublons exacts retirés), factures, coordonnées et rattachements de mails reportés sur la fiche conservée ; fiche absorbée archivée avec la mention « fusionnée dans » ; fusion journalisée et idempotente. Disponible en ligne seulement, bouton désactivé hors ligne avec explication. Test : aucune référence perdue après fusion, deuxième appel sans effet.
      - **Pas de suppression physique** d'un contact lié à un dossier, une facture, un lien ou un mail : il s'archive, reste lisible partout où il apparaît, n'est plus proposé à la saisie. Seul un contact jamais lié peut être supprimé, et la suppression est journalisée.
      - **Historique de la fiche.** Onglet Dossiers : chaque dossier où le contact intervient, avec sa qualité. Onglet Factures (client) : factures, encaissements, encours. Onglet Mails : mails classés dont l'expéditeur ou un destinataire est une adresse de la fiche. Onglet Notes.
      - **Droits.** Annuaire commun à tout le cabinet (décision du 30/09/2026), y compris les contacts créés depuis un dossier restreint. Les intervenants suivent les droits de leur dossier : un utilisateur sans accès à un dossier restreint ne voit, sur la fiche, ni ce dossier, ni compteur, ni mention ; même règle pour les factures et les mails de ce dossier. Essai : poste B, utilisateur sans accès ; la fiche est visible, le dossier restreint absent de l'onglet Dossiers et du SQLite de B.
      - **Synchronisation.** Tables synchronisées par les flux existants ; création et modification hors ligne ; conflits par champ selon Conflits généralisés (`node tests/recette/conflits-poste-tauri.mjs` reste vert).
      - **Recherche.** Index FTS5 local : nom, prénoms, dénomination, SIREN, e-mails, téléphones normalisés sans espaces, ville. Sur un jeu de 10 000 contacts : résultat affiché en moins de 300 ms sur le poste de recette, mesure consignée dans `JOURNAL.md`.
      - **Champs de fusion.** `docs/modeles-champs.md` complété : `client_designation`, `client_adresse`, `client_representant_designation` ; boucles par qualité `{#intervenants_<code>}{nom}{designation}{adresse}{rattache_a}{/intervenants_<code>}` ; `client_nom` inchangé. `node tests/recette/modeles-fusion.mjs` → exit 0 (non-régression), plus un acte d'essai qui reprend la désignation du client et de l'adversaire.
    - `node tests/recette/annuaire-reprise.mjs` → exit 0 (Postgres réel, jeu de 3 000 dossiers, deux exécutions).
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0, écran Contacts ajouté : captures jour et nuit à 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440 sur le jeu de démonstration (liste, fiche d'une société, fiche d'une personne, création par SIREN). Preuve visuelle commune contre la maquette ; le commandement valide sur son écran (B9).
    - **Ajouts de la consigne de l'architecte du 12/11/2026, soir (points bloquants avant la coche)** :
      - **Écart 12, liens.** « Ajouter un lien » d'après la maquette (type, fonction, contact, début, fin, source, « représente la société »), dans le panneau latéral ; modifier un lien pour y poser une date de fin ; écriture locale synchronisée, hors ligne comprise, comme les autres écritures de la fiche (plus d'appel direct à l'instance pour créer un lien). Contrôles des critères appliqués au poste et refaits par l'API. Couvert par `node tests/recette/annuaire.mjs`.
      - **Écart 15, dirigeants du registre.** « Créer une fiche » pour un dirigeant du registre crée la fiche et le lien vers la société dans la même opération. Couvert par `node tests/recette/annuaire.mjs`.
      - **Recherche.** Mesure dans `annuaire.mjs`, sur l'app Tauri, de la frappe à l'affichage de la liste, sur 10 000 contacts ; moins de 300 ms ; mesure consignée dans `JOURNAL.md`.
      - **Factures sur la fiche.** Les brouillons ne comptent ni dans « Facturé » ni dans l'encours (l'assertion d'`annuaire.mjs` qui exige le contraire est corrigée) ; statut Payée, Partiellement payée ou En attente déduit des encaissements ; date et objet après le lot correctif de J8 (point B de la même consigne).
      - **Élision et casse.** Élision dans `sousTitreFiche` (« d'Aix ») ; communes et adresses en casse normale (« Saint-Priest ») ; la dénomination reste telle que le registre la donne.
      - **Décisions du commandement sur les écarts** : 10 (désignation), 11 (montants ronds sans centimes hors factures), 20 (loupe, pas de surlignage pendant la création), auteur des notes, lieu de naissance sans date (« Né à Lyon (Rhône) »), sens des mails (« De : » ou « À : », heure de Paris). Écarts 13, 14, 16 à 19, 23 à 25, 29, 30 (TVA), 32, 33, N1, N2, tête de fiche, fonds de bandeau, ombre, point de chemise en jour, onglet Mails vide : acceptés en l'état. Formulation exacte de l'écart 10 :
        - société : « La société [dénomination], [forme en toutes lettres] au capital de [capital] €, immatriculée au registre du commerce et des sociétés de [greffe] sous le numéro [SIREN par groupes de trois], dont le siège social est situé [adresse], prise en la personne de son [fonction] en exercice, [M. ou Mme] [prénom usuel] [nom], domicilié(e) en cette qualité audit siège. » ;
        - personne : « [M. ou Mme] [prénoms] [nom], né(e) [le …] [à …], de nationalité [nationalité], [profession], demeurant [adresse]. » ;
        - une société exerçant une profession réglementée suit la formule des sociétés ; une mention manquante reste signalée et arrête la fusion.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J8, lot correctif Factur-X** — jalon J8 rouvert par la consigne de l'architecte du 12/11/2026, soir — après la coche de l'Annuaire, avant Juridictions et administrations. Le modèle Factur-X (`crates/api/src/facturation.rs`, `routes/factures.rs`) contient des identités en dur (« Cabinet fictif LEGAL OS », FR32123456789, « Client fictif », FR32876543210 pour tout professionnel, IBAN FR7630006000011234567890189, « Débours fictifs ») et une date d'émission recalculée à chaque génération, en UTC.
  - **Critères d'acceptation** :
    - **Vendeur** tiré de l'identité du cabinet dans Réglages (dénomination, forme, SIREN, n° TVA, adresse, IBAN et BIC, conditions de paiement) ; validation d'une facture refusée, avec message, si l'un manque.
    - **Acheteur** tiré de la fiche du client (Annuaire) : nom ou dénomination, adresse de facturation (à défaut siège ou domicile), SIREN et n° TVA pour un professionnel ; validation refusée si une mention obligatoire manque.
    - **Lignes** avec leurs vrais libellés, débours compris.
    - **Date d'émission** : colonne `date_emission` (DATE, heure de Paris) posée à la validation, migration additive ; PDF et CII l'utilisent ; une régénération produit un fichier identique à l'octet. Échéance selon les conditions de paiement du cabinet. Date et objet synchronisés vers le poste.
    - **Recette** : les valeurs du CII sont comparées aux données en base (vendeur, acheteur, date, lignes, totaux) sur deux cabinets et deux clients différents ; `s9-factures.mjs` et la validation EN 16931 restent vertes.
    - **Garde-fou élargi** : `tests/recette/sans-bouchon.mjs`, branché dans la CI, échoue si le code de production (hors tests, hors dossiers de données de démonstration déclarés) contient `todo!()`, `unimplemented!()`, les mots « stub », « TODO », « FIXME », « bouchon », « fictif », « fictive », ou un littéral qui a la forme d'un n° TVA français, d'un SIREN, d'un SIRET ou d'un IBAN. Essai négatif dans la recette elle-même.
    - **Revue des jalons déjà cochés** à la recherche du même défaut (valeur fictive ou calculée au lieu d'être lue) : liste consignée dans `JOURNAL.md`, chaque cas soumis à l'architecte.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Juridictions et administrations** — § 4.2 n° 2 et n° 1 (juridiction) — critères validés par l'architecte le 29/10/2026 — après Annuaire, avant Structures et capital
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/juridictions-administrations.mjs` → exit 0 (API, Postgres réel, puis app Tauri) :
      - **Troisième nature de contact**, « juridiction ou administration », avec un genre (juridiction, administration) et un type. Filtre « Juridictions et administrations » dans la liste ; sous-titre de l'écran distinct (contacts d'un côté, juridictions et administrations utilisées de l'autre). Fiche d'après la maquette : désignation ou mention pour les actes, bloc « Données publiques », onglets Chambres et services (juridictions), Dossiers, Notes.
      - **Référentiel.** Source : API de l'Annuaire de l'administration publiée par la DILA (Service-Public.fr), interrogée par l'instance seulement ; URL, licence, types retenus et date de vérification dans `docs/versions.md`. Chargés et synchronisés sur les postes (hors ligne) : toutes les juridictions de l'ordre judiciaire et administratif (types du référentiel listés dans `docs/versions.md`, au minimum cour d'appel, tribunal judiciaire, tribunal des activités économiques et tribunal de commerce, conseil de prud'hommes, tribunal de proximité, tribunal administratif, cour administrative d'appel, Cour de cassation et Conseil d'État s'ils y figurent) ; les administrations des types et départements choisis par le cabinet dans Réglages (au départ : SIE, service de gestion comptable, URSSAF, CPAM, préfecture, du département du cabinet). Tout autre organisme se cherche à la demande, en ligne, et n'entre dans l'annuaire du cabinet qu'une fois choisi. Identifiant du référentiel conservé sur la fiche.
      - **Normalisation à l'import**, valeur brute conservée : casse des adresses (« 44 RUE DE BONNEL » devient « 44 rue de Bonnel »), horaires mis en phrase française, lignes d'horaires vides ou à 00:00 écartées, ressort enregistré comme liste de codes INSEE et affiché en nombre de communes avec la liste à la demande. Champ absent du référentiel affiché « Non publié », jamais inventé.
      - **Mise à jour mensuelle** par l'instance, et à la demande d'un administrateur : champs publics remplacés, ancien nom conservé dans l'historique de la fiche (« Ancien nom : … jusqu'au … »), dossiers inchangés puisqu'ils pointent la fiche. Organisme supprimé du référentiel : fiche conservée et marquée « retiré du référentiel », jamais effacée. Essai : jeu de deux versions du référentiel (renommage, suppression, nouveau service), aucune instance ni aucun intervenant perdu.
      - **Champs publics en lecture seule** sur le poste et refusés par l'API ; seule la couche du cabinet se modifie : chambres et services (nom, e-mail, téléphone, note), notes. Une mise à jour du référentiel n'écrase jamais cette couche.
      - **Cour d'appel du ressort** d'une juridiction, déduite du ressort publié de la cour d'appel qui contient la commune du siège ; affichée seulement si la déduction est univoque.
      - **Désignation d'une administration partie**, pré-remplie selon son type à partir de formules listées dans `docs/modeles-champs.md`, puis validée par un utilisateur (état « proposée » ou « validée », auteur et date) ; la fusion d'un acte qui utilise la désignation d'une administration non validée s'arrête et le dit. Une administration peut recevoir toute qualité dans un dossier, comme un autre contact.
      - **Instances d'un dossier.** Table `dossier_instances` : dossier, ordre, degré (première instance, appel, cassation, renvoi après cassation, référé, autre), juridiction (fiche de genre juridiction), chambre (choisie parmi les chambres de la fiche, ou saisie), numéro RG, date et acte de saisine, date, nature et sens de la décision. La dernière instance s'affiche dans la vue du dossier et dans la liste des dossiers comme la juridiction et le RG d'aujourd'hui ; la recherche par RG porte sur toutes les instances. Bloc Instances de la vue du dossier d'après l'extrait de la maquette ; sélecteur de juridiction qui cherche dans l'annuaire du cabinet puis, en ligne, dans le référentiel.
      - **Reprise.** Chaque dossier dont la juridiction ou le RG est renseigné reçoit une instance ; nom rapproché du référentiel par correspondance exacte après normalisation (casse, accents, abréviations « TJ », « TAE », « TC », « CA », « CPH » développées) ; sans correspondance exacte, instance marquée « à rapprocher », texte d'origine conservé et affiché, liste des instances à rapprocher dans Réglages. Reprise idempotente, testée sur le jeu de 3 000 dossiers : aucun RG perdu, deux exécutions donnent le même résultat. Colonnes d'origine conservées, migrations par ajouts seulement.
      - **Champs de fusion** documentés dans `docs/modeles-champs.md` : `juridiction_nom`, `juridiction_adresse`, `chambre`, `rg`, `instance_precedente_nom`, `instance_precedente_rg`, `instance_precedente_decision`, et la désignation des administrations parties dans les boucles d'intervenants. `node tests/recette/modeles-fusion.mjs` → exit 0 (non-régression), plus une déclaration d'appel d'essai qui cite la juridiction d'appel et la décision de première instance.
      - **Droits et synchronisation.** Fiches publiques visibles de tout le cabinet ; couche du cabinet et instances suivant les règles de l'annuaire et des dossiers (une instance d'un dossier restreint n'apparaît pas dans l'onglet Dossiers de la fiche d'une juridiction pour qui n'y a pas accès). Échec du référentiel (service coupé, réponse invalide) : message en français, données déjà chargées intactes ; essais négatifs dans le test.
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 : fiche d'une juridiction (Général, Chambres et services), fiche d'une administration, bloc Instances avec le sélecteur ouvert, jour et nuit, trois résolutions. Preuve visuelle commune ; B9.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Structures et capital** — § 4.2 n° 2, répartition du capital à date — critères validés par l'architecte le 29/10/2026 — après Juridictions et administrations, avant Diligences
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/structures-capital.mjs` → exit 0 (API, Postgres réel, puis app Tauri) :
      - **États du capital, datés.** Table `capital_etats` : société, date d'effet, montant, monnaie, capital variable (oui ou non), nature des titres (parts sociales ou actions), source. Table `categories_titres` par état : libellé, nombre de titres, voix par titre (0 pour une action sans droit de vote, 2 pour un droit de vote double). Valeur nominale calculée (montant divisé par le nombre total de titres), affichée, jamais saisie.
      - **Participations.** Table `participations` : société, détenteur (personne physique ou morale), catégorie, nombre de titres, mode (pleine propriété, nue-propriété, usufruit, indivision), groupe de démembrement ou d'indivision, date d'entrée, date de sortie, origine (souscription, cession, donation, succession, apport, autre), source, note. Un groupe de démembrement porte un nombre de titres, réparti entre un ou plusieurs usufruitiers et un ou plusieurs nus-propriétaires ; chaque côté totalise ce nombre.
      - **Contrôles, poste et API.** À toute date, les titres détenus d'une catégorie (démembrés et indivis comptés une fois par groupe) ne dépassent pas les titres de cette catégorie : refus avec un message en français qui nomme la date, la catégorie et l'excédent. Moins de titres que le total : reste affiché « non renseigné ». Un détenteur ne détient pas de titres de lui-même. Date de sortie postérieure à la date d'entrée.
      - **Calculs.** Pourcentage du capital et pourcentage des droits de vote calculés, jamais saisis, dans un module de données hors des composants (`apps/poste/src/contacts/capital.ts`). Titres démembrés : vote attribué selon le régime choisi pour la société, « légal » (article 1844 du Code civil : nu-propriétaire, sauf affectation des bénéfices à l'usufruitier) ou « statutaire » (texte saisi) ; le graphique les montre en une part hachurée, sans les répartir. Jeu de test dont les valeurs attendues sont calculées à la main dans le test : démembrement, indivision, actions sans droit de vote, droit de vote double, capital modifié dans le temps, reste non renseigné, refus d'excédent.
      - **Graphique.** Onglet Structure d'une personne morale, d'après la maquette : répartition à une date choisie (aujourd'hui et chaque date d'effet enregistrée) ; bascule capital ou droits de vote, affichée seulement si les voix diffèrent des titres ; légende en tableau (détenteur, titres, nominal ou voix, pourcentage, total) qui reste lisible sans les couleurs ; part hachurée pour les titres démembrés, part grise pour le non renseigné ; un clic sur une part ou une ligne ouvre la fiche du détenteur ; mouvements datés avec leur source, ceux postérieurs à la date affichée atténués. Mention visible : données indicatives à la date affichée, d'après les sources citées, qui ne remplacent pas le registre des mouvements de titres de la société.
      - **Participations détenues.** Sur la fiche du détenteur (onglet Participations d'une personne physique, section de l'onglet Structure d'une personne morale) : société, titres, pourcentage du capital, mode de détention, date d'entrée.
      - **Lien « associé ».** Une participation en cours affiche le détenteur comme associé dans l'onglet Liens, sans double saisie ; la participation reste la seule source.
      - **Fusion des doublons.** La fusion du jalon Annuaire reporte participations et états du capital ; test : répartition identique avant et après fusion.
      - **Champs de fusion.** `societe_capital`, `societe_titres`, boucle `{#associes}{nom}{titres}{pourcentage}{mode}{/associes}` à la date de génération ou à une date choisie ; documentés dans `docs/modeles-champs.md`.
      - **Droits et synchronisation.** Ceux de l'annuaire ; saisie hors ligne ; conflits par champ ; le contrôle d'excédent est refait par l'API à l'envoi et un refus revient sur le poste en message lisible.
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 : onglet Structure (trois dates, vues capital et droits de vote) et onglet Participations, jour et nuit, trois résolutions. Preuve visuelle commune ; B9.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Diligences** — § 4.2 n° 9 et n° 10 — critères validés par l'architecte le 30/10/2026 — après Structures et capital, avant Conventions d'honoraires
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/diligences.mjs` → exit 0 (API, Postgres réel, puis app Tauri) :
      - **Registre.** Table `diligences` : cabinet, dossier, date de la diligence (jour, distincte de la date d'enregistrement), intervenant, description, type, quantité (minutes pour le temps passé, nombre à trois décimales au plus sinon), prix unitaire en centimes (taux horaire pour le temps passé), montant HT en centimes, facturable (oui ou non), état (libre, réservée par un brouillon, facturée), brouillon et facture de rattachement, origine (saisie, chronomètre, mail, reprise), visibilité propagée depuis le dossier comme pour les temps, auteur, dates de création et de modification. Montant calculé par l'API, jamais accepté tel quel du poste ; temps passé selon F0, autres selon F11 ; type « remise » toujours négatif.
      - **Types.** Table `types_diligence` par cabinet : catégorie (honoraires, frais, débours), libellé, unité (heure, forfait, page, envoi, km, unité, acte), prix par défaut, actif. Un seul type « temps passé », non supprimable. Liste livrée : honoraires (temps passé, forfait, résultat, remise), frais (copies, frais postaux, indemnités kilométriques, traduction, frais divers), débours (droit de plaidoirie, droit d'appel, frais de greffe, commissaire de justice, publicité légale, débours divers). Modifiable dans Réglages par un administrateur ; un type utilisé ne se supprime pas, il s'archive.
      - **Intercalaire « Diligences »** : intercalaire standard (identifiant `diligences`) entre Mails et Factures, d'après la maquette : filtres À facturer, Facturées, Toutes ; récapitulatif en tête (honoraires, frais, total HT, TVA, débours, total TTC) portant sur la sélection, ou sur les diligences libres et facturables sans sélection ; diligences facturées groupées sous leur facture ; diligences réservées groupées sous « Dans un brouillon de facture » ; compteur de l'intercalaire égal au nombre de diligences libres et facturables. Barre du bas : « Saisir du temps » et « Préparer une facture » sans sélection ; « Facturer la sélection », « Déplacer », « Non facturable » ou « Rendre facturable », « Supprimer » avec sélection.
      - **Saisie en tête du tableau.** Date acceptant « aujourd'hui », « hier », « j/m », « j/m/aaaa », refusée si postérieure à aujourd'hui ; durée selon les formats de la maquette Temps (« 1 h 30 », « 45 min », « 0,75 ») ; prix proposé selon le type, taux du temps passé selon la précédence des taux et figé à l'enregistrement ; Entrée ajoute, Tab passe au champ suivant ; reprise du chronomètre en cours sur le dossier ; message en français pour toute saisie refusée. Les propositions issues des mails (F10) s'affichent dans le tableau et ne deviennent des diligences qu'après validation.
      - **Modification en place** d'une diligence libre (description, type, quantité, prix hors temps passé), enregistrée à la sortie du champ, hors ligne compris. Diligence réservée ou facturée : champs désactivés sur le poste et modification refusée par l'API.
      - **Actions sur la sélection.** Déplacer vers un dossier accessible à l'utilisateur, F13 appliquée, inscription au journal des deux dossiers ; marquer non facturable ou facturable ; supprimer une diligence libre, inscription au journal du dossier. Diligences réservées ou facturées : non sélectionnables ; toute action refusée par l'API.
      - **Écran Temps** d'après `prototype-temps.html` et l'extrait de `prototype-diligences.html` : saisie avec date et type ; quantité et prix unitaire pour les types hors temps ; journal listant toutes les diligences de l'utilisateur, tous dossiers confondus.
      - **Préparer une facture.** À partir de la sélection, ou de toutes les diligences libres et facturables du dossier ; diligences non facturables écartées et comptées dans le panneau ; client tiré de sa fiche (Annuaire), n° TVA compris ; lignes regroupées par type, le temps passé par intervenant et par taux, au format « Temps passé, Me [nom], 4 h 15 au taux de 250,00 € » et « Copies, 240 pages à 0,15 € » ; débours sur des lignes hors TVA (régime de J8) ; totaux identiques à ceux du récapitulatif pour la même sélection, testés ; option « relevé détaillé » qui joint au PDF la liste des diligences (date, intervenant, description, quantité) sans changer les lignes du Factur-X. Le brouillon n'a ni numéro ni objet imposé ; l'alerte de convention manquante (jalon Conventions d'honoraires) s'applique.
      - **Cycle des états.** Création du brouillon : diligences réservées. Retrait d'une diligence du brouillon ou suppression du brouillon : diligences libres à nouveau. Validation (chemin de J8, numéro attribué par le serveur) : diligences facturées, immuables, protégées par un déclencheur en base comme les factures validées. Avoir total : diligences libres à nouveau, avec mention de l'avoir dans leur historique. Avoir partiel : diligences inchangées.
      - **Reprise des temps.** Chaque ligne de `temps_saisis` devient une diligence « temps passé » : minutes, taux et montant inchangés ; date de la diligence = date d'enregistrement en heure de Paris ; état déduit de `brouillons_facture` et des factures. Reprise idempotente, testée sur le jeu de 3 000 dossiers : somme des montants identique avant et après, deux exécutions donnent le même résultat. `temps_saisis` reste en base, en lecture seule, jusqu'à J13 ; migrations par ajouts seulement.
      - **Droits et synchronisation.** Diligences visibles selon les droits du dossier ; saisie hors ligne ; conflits par champ selon Conflits généralisés ; une modification hors ligne d'une diligence devenue réservée ou facturée entre-temps est refusée à la synchronisation et signalée en français sur la ligne.
      - **Calculs** dans un module de données hors des composants (`apps/poste/src/diligences/calculs.ts`) et dans l'API, avec un jeu de test dont les valeurs attendues sont écrites à la main dans le test : arrondis F0, F2 et F11, remise, non facturable, regroupement des lignes, débours hors TVA, totaux de la sélection.
    - `node tests/recette/s9-factures.mjs` → exit 0 (non-régression du temps, des débours, des avoirs et de la facturation électronique).
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 : intercalaire Diligences (à facturer, sélection, panneau du brouillon avec relevé, facturées) et écran Temps, jour et nuit, trois résolutions. Preuve visuelle commune ; B9.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Conventions d'honoraires** — § 4.2 n° 12 — critères validés par l'architecte le 04/10/2026 — suspendu par le commandement le 30/10/2026, reprend après Diligences, avant Facturation, suite. Le code déjà écrit reste en l'état. Aucun autre jalon ne s'appuie sur la table locale `conventions_honoraires`. Aucun paragraphe d'ajout de synchronisation n'apparaît dans `docs/consignes/criteres-diligences.md` tel que versé ; à fournir par le commandement avant la reprise du jalon.
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/conventions-honoraires.mjs` → exit 0 (app Tauri) :
      - une convention est produite par Modèles et fusion, rattachée au dossier ;
      - statuts brouillon, envoyée, signée (dépôt de l'exemplaire signé) ;
      - modes temps passé, forfait, résultat complémentaire, repris par la facturation ;
      - alerte à l'ouverture du dossier et à la création d'une facture tant qu'aucune convention n'est signée ; levée possible avec un motif consigné. Motifs décidés le 28/10/2026 (B15) : (1) urgence et force majeure, levée temporaire, l'alerte revient après 30 jours si la convention n'est toujours pas signée ; (2) convention signée hors de l'application, avec la date consignée ; (3) aide juridictionnelle totale, ou intervention au titre de la troisième partie de la loi du 10 juillet 1991 ; (4) premier rendez-vous ou consultation sans honoraires ; (5) dossier interne du cabinet.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Facturation, suite** — § 4.2 n° 10, ce que J8 n'a pas livré — critères validés par l'architecte le 04/10/2026, complétés le 07/10/2026, ajustements du 30/10/2026
  - **Ajustements du 30/10/2026** (les critères du 04/10 et du 07/10 restent, sauf ce qui suit) :
    - **Forfait et résultat** : types de diligence (catégorie honoraires), facturés par le chemin du jalon Diligences ; plus de chemin de saisie propre.
    - **Honoraire de résultat** : le contrôle B16 (art. 10 de la loi du 31 décembre 1971 : seulement en complément d'un honoraire principal et si la convention du dossier le prévoit) s'applique à la création du brouillon qui contient une diligence « résultat » ; refus avec message sinon.
    - **Provisions** : restent des factures d'acompte émises depuis Facturation pour un montant libre, sans diligence ; imputation sur la facture finale préparée à partir des diligences ; TVA selon les hypothèses F.
    - **Créance irrécouvrable** : statut d'une facture validée, posé avec un motif et une date, qui la sort de l'encours et des relances sans avoir ; journalisé ; levée possible.
    - **À facturer** (onglet de Facturation) : liste des dossiers ayant des diligences libres et facturables, avec leur montant, chaque ligne ouvrant l'intercalaire Diligences du dossier.
    - **Tableau de bord** (jalon suivant) : l'indicateur « temps non facturé » devient « diligences non facturées », avec la part du temps passé ; définition mise à jour dans `docs/tableau-de-bord.md`.
  - **Critères d'acceptation (commandes)** :
    - Écran d'après `design/maquettes/prototype-facturation.html` (les critères du 04/10 restent) : onglets Tableau de bord, Factures, À facturer ; relance validée avant envoi ; encaissement saisi sur place ; alerte de convention manquante dans À facturer ; preuve visuelle commune.
    - `node tests/recette/facturation-suite.mjs` → exit 0 (API, Postgres réel, puis app) :
      - facture au forfait et au résultat ;
      - précédence des taux documentée et testée : intervenant sur le dossier, puis dossier, puis client, puis taux général de l'intervenant, puis cabinet (décision PROVISOIRE du commandement du 10/10/2026, testée dans cet ordre ; à signaler à l'architecte si une règle métier l'impose autrement) ; taux figé à la saisie : modifier un taux ne change ni les temps saisis ni les brouillons ;
      - honoraire de résultat seulement en complément d'un honoraire principal et si la convention du dossier le prévoit (art. 10 de la loi du 31 décembre 1971) ; sinon, refus avec message (confirmé par le commandement le 28/10/2026, B16) ;
      - provisions : appel, encaissement, imputation sur la facture finale ; TVA selon les hypothèses F (`docs/hypotheses-facturation.md`, revue B10) ;
      - conditions tarifaires par client, par dossier et par intervenant ;
      - relances : modèle par niveau, historique par facture, envoi uniquement après validation de l'utilisateur, par la file d'envoi ;
      - encours et impayés par client et par ancienneté (0–30, 31–60, 61–90, plus de 90 jours) ; total égal aux factures moins les encaissements, vérifié sur un jeu de test ;
      - consigne de l'architecte du 24/10/2026 (question e du contrôleur J11) : numéro de TVA de l'acheteur tiré de la fiche du client, refus de valider une facture à un professionnel français sans ce numéro (bloquant avant toute première facture réelle) ; vérifier que le règlement est transmis à la plateforme par une file idempotente reprise après échec ; `GET /annuaire/{siren}` : contrôle du format du SIREN (clé de Luhn) ; les erreurs de validation restent en 400, seules les ressources introuvables passent en 404.
    - `node tests/recette/s9-factures.mjs` → exit 0 (non-régression du temps, des débours, des avoirs et de la facturation électronique).
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 (consigne du 28/10/2026 : captures jour et nuit à 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440, sur le jeu de démonstration).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Tableau de bord** — § 4.2 n° 13 — critères validés par l'architecte le 04/10/2026, complétés le 07/10/2026
  - **Critères d'acceptation (commandes)** :
    - Le Tableau de bord est le premier onglet de Facturation, d'après `design/maquettes/prototype-facturation.html` (les critères du 04/10 restent) ; chiffres calculés comme défini dans le document `tableau-de-bord.md` (répertoire docs) ; preuve visuelle commune.
    - `node tests/recette/tableau-de-bord.mjs` → exit 0 (app Tauri, requêtes locales) :
      - chiffre d'affaires, encours, temps non facturé, rentabilité par dossier et par client, factures en erreur ou en attente sur la plateforme agréée, mails à classer ;
      - définition écrite de chaque indicateur dans le document `tableau-de-bord.md` (répertoire docs) : période, HT ou TTC, facturé ou encaissé ;
      - jeu fixe dont les valeurs attendues sont calculées à la main dans le test, indépendamment du code ;
      - requêtes dans un module de données, jamais dans les composants ; mention visible : chiffres calculés sur les dossiers accessibles à l'utilisateur.
    - `node tests/recette/tenue-visuelle-captures.mjs` → exit 0 (consigne du 28/10/2026 : captures jour et nuit à 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440, sur le jeu de démonstration).
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J12** — Révocation postes (S10) — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/s10-revocation.mjs` → exit 0 :
      - jeton du poste révoqué refusé par l'API dès la révocation ; aucune écriture de sa file appliquée ; refus consigné ;
      - à la connexion suivante : effacement de la base locale, du cache de fichiers, du jeton et des secrets du trousseau ; le poste révoqué n'écrit plus ;
      - verrouillage d'un poste resté hors ligne au-delà de 30 jours (confirmé par le commandement le 28/10/2026, B17) ;
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
