# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-10-04 (jalon en cours : **Montée PowerSync**).

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
- [x] **Avant la fin de la phase 2** : `cargo-deny` (ou `cargo-audit`) en CI sur les deux workspaces ; signalement préparé pour PowerSync / dépendance `time` 0.2.
- [x] **Avant Facturation, suite** : contrôle du SIREN (clé de Luhn) et d'un n° TVA commençant par FR (clé = (12 + 3 × (SIREN mod 97)) mod 97), à la saisie sur le poste et dans l'API ; message d'erreur en français — `node tests/recette/siren-tva.mjs`.
- [x] **Avant la fin de la phase 2** : moteur de délais en TypeScript strict ; licence OFL livrée avec les polices.
- [x] **Avant la fin de la phase 2** : la preuve « fausse alerte » de `node tests/recette/conflits-poste-tauri.mjs` aligne `revision_edition` par `fixerRevisionEdition` au lieu d'attendre la reprise réelle du même poste.
- [x] **Avant la fin de la phase 2** : `recetteHooks.ts` insère une entrée dans `ps_crud` lorsque le SDK ne journalise pas le PATCH hors ligne ; le chemin d'écriture réel reste à prouver sans cette injection.
- [x] **Avant la fin de J9 et de Documents, suite** : brancher la vue scindée sur les éléments synchronisés (mails, pièces, factures), sans réintroduire de jeu fictif dans le dossier réel ni dans le build distribué.
- [x] **Avant J11** : authentification OAuth pour Microsoft 365 et Gmail (secret côté serveur, renouvellement du jeton) — `node tests/recette/oauth-messagerie.mjs`.
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA, édition 3) relus et consignés dans `docs/versions.md`.
- [x] **Avant le premier compte réel (B8)** : échecs de connexion IMAP — temporisation croissante ; après un refus d'authentification, arrêt des tentatives et état « identifiants refusés » visible par le titulaire ; aucune boucle sans délai. Essai négatif compris — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : veille IDLE renouvelée avant 29 minutes (RFC 2177) ; une session de relève réutilisée pour tous les dossiers ; relève au réveil et au plus toutes les 10 minutes sans réveil — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : serveur CONDSTORE sans QRESYNC — drapeaux par CHANGEDSINCE, suppressions par UID SEARCH ; relève complète seulement si le serveur n'offre ni l'un ni l'autre, et jamais plus d'une fois par cycle de 10 minutes — `node tests/recette/s7-connexions.mjs`.
- [x] **Avant le premier compte réel (B8)** : un compte modifié ou supprimé arrête ou redémarre sa tâche avec les nouveaux paramètres — `node tests/recette/s7-connexions.mjs`.

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

Critères validés par l'architecte le 04/10/2026. Ordre : **Montée PowerSync** → **J11** → **Modèles et fusion** → **Conventions d'honoraires** → **Facturation, suite** → **Tableau de bord** → **J12** → **J13** → **J14**.

- [ ] **Montée PowerSync** — avant J11 — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/powersync-0-1.mjs` → exit 0 : `tauri-plugin-powersync` 0.1.x et crate `powersync` 0.1.x ; connecteur adapté ; les quatre exceptions RustSec absentes de `deny.toml` ; `patches/time-macros` et `patches/time-macros-impl` absents ; `rand` 0.7.3 absent du `Cargo.lock` ; `docs/versions.md` et `docs/audit-dependances.md` à jour ; B12 clos.
    - `node tests/recette/s5-sync-streams.mjs`, `node tests/recette/s6-documents.mjs`, `node tests/recette/conflits-poste-tauri.mjs` et `node tests/recette/s5-buckets-volume.mjs` → exit 0.
    - Playwright en dernière version stable (GHSA-7mvr-c777-76hp) ; `node tests/recette/coque-app.mjs --captures` → exit 0 (captures S13 relancées).
    - Contrôleur VALIDÉ ; CI verte.

- [ ] **J11** — Mail étapes 4–5 — fait partie de la V1 ; critère final : pouvoir fermer Outlook — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
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

- [ ] **Facturation, suite** — § 4.2 n° 10, ce que J8 n'a pas livré — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/facturation-suite.mjs` → exit 0 (API, Postgres réel, puis app) :
      - facture au forfait et au résultat ;
      - précédence des taux documentée et testée : intervenant sur le dossier, puis dossier, puis client, puis défaut du cabinet ; taux figé à la saisie : modifier un taux ne change ni les temps saisis ni les brouillons ;
      - honoraire de résultat seulement en complément d'un honoraire principal et si la convention du dossier le prévoit ; sinon, refus avec message (règle à confirmer par le commandement, B16) ;
      - provisions : appel, encaissement, imputation sur la facture finale ; TVA selon les hypothèses F (`docs/hypotheses-facturation.md`, revue B10) ;
      - conditions tarifaires par client, par dossier et par intervenant ;
      - relances : modèle par niveau, historique par facture, envoi uniquement après validation de l'utilisateur, par la file d'envoi ;
      - encours et impayés par client et par ancienneté (0–30, 31–60, 61–90, plus de 90 jours) ; total égal aux factures moins les encaissements, vérifié sur un jeu de test.
    - `node tests/recette/s9-factures.mjs` → exit 0 (non-régression du temps, des débours, des avoirs et de la facturation électronique).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Tableau de bord** — § 4.2 n° 13 — critères validés par l'architecte le 04/10/2026
  - **Critères d'acceptation (commandes)** :
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
