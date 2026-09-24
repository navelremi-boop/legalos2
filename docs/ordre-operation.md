# LEGAL OS — Ordre d'opération n° 1

**Destinataires :** l'agent principal (état-major) et tous les sous-agents.
**Émetteur :** le commandement (l'utilisateur, avocat, ancien ingénieur logiciel). Il fixe les objectifs et les règles ; il ne code pas au quotidien.
**Autorité des documents :** `docs/cahier-des-charges.md` est la source de vérité fonctionnelle et technique. Le présent ordre régit l'organisation du travail. En cas de contradiction sur le contenu du produit, le cahier des charges prime.

À relire intégralement au début de chaque session, après chaque compactage du contexte, et avant chaque nouveau jalon.

---

## 1. Situation

- **Produit :** LEGAL OS, application de gestion de cabinet d'avocats, local-first, macOS et Windows, une instance serveur par cabinet. Voir le cahier des charges, en entier.
- **Référence visuelle :** `design/prototype-cabinet.html`.
- **Sensibilité :** les données manipulées par l'application seront couvertes par le secret professionnel. Pendant le développement, **uniquement des données fictives**.
- **Poste de développement :** PC sous **Windows** (Ryzen 7, 32 Go de RAM). Pas de Mac.
  - L'application se construit et se teste **nativement sous Windows** (Rust MSVC, WebView2).
  - Les services de l'instance tournent dans **Docker Desktop** (backend WSL2).
  - Ton shell est **PowerShell**. Tout ce qui concerne macOS passe par la **CI** (runner macOS).
  - Prérequis installés par moi avant le lancement : Git, Node LTS, Docker Desktop, outils de compilation C++ de Visual Studio, rustup. Installe toi-même le reste, sans droits administrateur (pnpm, cibles Rust, outils de test). S'il faut des droits administrateur, passe par `BLOCAGES.md`.
  - Accès réseau disponible.
- **Ressources :** 32 Go partagés entre Docker, les compilations Rust, Cursor et les tests.
  - Au plus **deux compilations Rust simultanées** (réduis `CARGO_BUILD_JOBS` quand deux tournent en même temps).
  - Cache de compilation partagé entre worktrees (sccache).
  - Chaque worktree a son propre répertoire `target/` : surveille l'espace disque et supprime les worktrees fusionnés.
- **Non disponible pour l'instant :** compte Apple Developer, compte réel sur une plateforme agréée (SUPER PDP), boîtes mail réelles, hébergeur. Dépôt GitHub distant : s'il n'est pas configuré (remote + `gh auth status`), demande-le via `BLOCAGES.md` ; il est nécessaire pour la CI macOS. Tu travailles avec des simulateurs (§ 6) et tu consignes ce qui me sera demandé (§ 4.5).

## 2. Mission

Construire **LEGAL OS V1** telle que définie au § 4.2 du cahier des charges (fonctionnalités V1 n° 1 à 14), avec l'instance serveur, la distribution et les mises à jour, jusqu'à un état **livrable, testé, exécuté et documenté**.

**Hors mission :** fonctionnalités V2 et « plus tard » du § 4.2, RPVA, adaptateur Microsoft Graph, application mobile.

## 3. Intention du commandement

**But :** un avocat installe l'app sur son Mac, se connecte à l'instance de son cabinet et travaille une journée entière dans LEGAL OS — dossiers, agenda et délais, documents, mails, temps, factures électroniques — y compris hors ligne.

**État final recherché :** les scénarios suivants passent **automatiquement**, en une seule commande de recette multiplateforme (`cargo xtask recette` ou équivalent, jamais un Makefile ni un script bash seul), sur le poste Windows de développement. Les parties propres à macOS s'exécutent en CI.

| # | Scénario |
|---|---|
| S1 | `docker compose up` démarre une instance complète (Caddy, API, PowerSync, Postgres, S3 local, serveur mail de test, simulateur de plateforme agréée) qui passe son contrôle de santé |
| S2 | Premier lancement de l'app : saisie de l'adresse de l'instance, connexion avec double authentification, synchronisation initiale |
| S3 | Création d'un dossier (couleur de chemise, parties, juridiction, n° RG), retrouvé ensuite par la palette de commandes |
| S4 | Deux postes simulés : une modification sur l'un apparaît sur l'autre ; une modification faite hors ligne se synchronise au retour du réseau ; aucun écrasement silencieux de fichier |
| S5 | Un dossier restreint n'est **pas présent dans la base locale** du poste d'un collaborateur non autorisé (vérifié dans SQLite, pas seulement à l'écran) |
| S6 | Un document déposé, ouvert, modifié : la nouvelle version est renvoyée et versionnée |
| S7 | Mail : un message reçu est synchronisé, classé automatiquement, visible dans le chrono du dossier ; un mail envoyé depuis le dossier franchit toutes les étapes de la file d'envoi jusqu'à « copie dans Envoyés confirmée » ; coupure réseau simulée pendant l'envoi : ni perte, ni doublon |
| S8 | Calcul des délais : jeu de cas de référence passé avec succès ; chaque règle retenue est documentée dans `docs/hypotheses-delais.md`, marquée « à valider par l'avocat » |
| S9 | Facturation : temps saisis → brouillon hors ligne → validation en ligne (numéro continu attribué par le serveur) → PDF et Factur-X validés (veraPDF + schematron EN 16931) → dépôt sur le simulateur de plateforme agréée → statuts → règlement partiel → statut « encaissée » avec le bon montant ; avoir ; aucun doublon en cas de nouvelle tentative |
| S10 | Révocation d'un poste : base locale, cache de fichiers et jeton effacés à la connexion suivante |
| S11 | Mise à jour à chaud : archive d'interface signée appliquée ; archive falsifiée refusée ; retour arrière automatique en cas d'échec |
| S12 | Export complet du cabinet, lisible sans l'app |
| S13 | Captures de référence des écrans clés (La journée, Dossier, Client mail, Facturation, Palette de commandes), en jour et en nuit, conformes au § 7 du cahier des charges |
| S14a | Build Windows (installateur), installation, lancement de l'app construite et scénario de fumée automatisé, sur le poste de développement |
| S14b | Build macOS signé ad hoc, lancement de l'app construite et même scénario de fumée, sur un runner macOS de la CI |

**Priorités en cas d'arbitrage, dans cet ordre strict :**
1. aucune perte de données, secret professionnel ;
2. exactitude des fonctions à portée juridique (numérotation et immutabilité des factures, facturation électronique, délais) ;
3. fonctionnement hors ligne ;
4. conformité au design ;
5. étendue fonctionnelle ;
6. vitesse d'exécution de la mission.

## 4. Exécution

### 4.1 Liberté d'action

Tu choisis librement tes méthodes, l'ordre des tâches à l'intérieur des phases, les bibliothèques secondaires et l'architecture interne. Tu peux t'écarter du cahier des charges si c'est justifié, **à condition** de :
- ne toucher à aucun invariant du § 5 ;
- consigner la décision dans `JOURNAL.md` : ce qui est décidé, pourquoi, l'alternative écartée.

Structure de dépôt suggérée (adaptable) :

```
apps/poste/          application Tauri + React
crates/api/          binaire de l'API (Axum)
crates/domaine/      types métier partagés
crates/stockage/     accès aux fichiers (OpenDAL)
crates/messagerie/   moteur mail
crates/facturation/  factures, Factur-X, connecteur plateforme agréée
instance/            docker compose, Caddy, PowerSync, scripts, simulateurs
design/              tokens.css, prototype, polices
docs/                cahier des charges, ordre d'opération, versions, hypothèses
tests/recette/       scénarios S1 à S14
xtask/               commandes du dépôt (recette, demo…), multiplateformes
```

**Contraintes multiplateformes** (le poste est sous Windows, le produit vise aussi macOS) :
- scripts du dépôt en Rust (`cargo xtask`) ou en Node, jamais en bash seul ;
- chemins construits avec `PathBuf` / `path.join`, jamais de séparateur écrit en dur ;
- fins de ligne LF imposées par `.gitattributes` (indispensable pour les fichiers utilisés dans les conteneurs Linux) ;
- conteneurs : préférer les volumes nommés aux montages de répertoires Windows, lents sous Docker Desktop.

### 4.2 Phases

**Phase 0 — Reconnaissance et planification** (état-major seul) :
1. Lire intégralement le cahier des charges et le prototype.
2. Créer `PLAN.md` : jalons numérotés, chacun avec objectif, livrables, **critères d'acceptation sous forme de commandes à exécuter**, dépendances, sous-agent responsable, case `- [ ]`.
3. Créer `JOURNAL.md` (décisions et preuves) et `BLOCAGES.md` (ce qui dépend de moi).
4. Créer `docs/versions.md` : version de chaque dépendance, **vérifiée dans la documentation officielle à la date du jour**. Ne jamais se fier à sa mémoire pour une version ou une API.
5. Mettre en place le dépôt et la CI. Les règles Cursor sont fournies dans `.cursor/rules/`, chacune ciblée sur les fichiers de son domaine : si tu t'écartes de la structure de dépôt suggérée, **mets à jour leurs `globs`** pour qu'elles continuent de s'appliquer. Adapter si besoin les sous-agents de `.cursor/agents/`.
6. **Contrats d'abord**, avant tout travail en parallèle : schéma de base (migrations), types partagés, contrat d'API (généré depuis le Rust), schéma client PowerSync, règles de synchronisation, jetons de design.

**Phase 1 — Fondations** : S1, S2, synchronisation de bout en bout d'une première table sur deux postes, application Tauri avec jetons de design et police embarquée, CI verte. **Aucun lot parallèle ne démarre avant que la phase 1 soit validée par le contrôleur.**

**Phase 2 — Lots parallèles** : dossiers, contacts, agenda et délais ; documents ; temps et facturation électronique ; moteur mail étapes 1 à 3 ; écrans.

**Phase 3** : mail étapes 4 et 5, révocation des postes, export, mises à jour et distribution.

**Phase 4 — Durcissement et recette** : S1 à S14a en une commande sur le poste, S14b en CI, revue de sécurité par le contrôleur, captures, documentation d'installation et d'utilisation, rapport final.

### 4.3 Organisation multi-agents

- **L'agent principal est l'état-major.** Il planifie, découpe, lance les sous-agents, intègre, arbitre. Il code peu et vérifie beaucoup. Il délègue les tâches lourdes pour garder son contexte disponible.
- **Sous-agents** (`.cursor/agents/`) : `instance-backend`, `poste-interface`, `messagerie`, `facturation`, `controleur`.
- **Parallélisme** : lance en arrière-plan les sous-agents dont les lots sont indépendants.
- **Propriété** : chaque sous-agent n'écrit que dans ses répertoires. Toute modification d'un contrat partagé passe par l'état-major.
- **Isolation** : quand plusieurs sous-agents écrivent en même temps, chacun travaille sur sa branche dans son propre worktree git (`git worktree add ../legal-os-<lot> -b lot/<nom>`). L'état-major fusionne dans `main` uniquement ce qui passe la CI complète après rebase.
- **Consignes aux sous-agents** : ils n'ont pas l'historique de la conversation. Chaque consigne contient : jalon, fichiers à lire, contrats applicables, critères d'acceptation, répertoires autorisés, format du compte rendu.
- **Contrôleur indépendant** : il écrit les tests d'acceptation à partir du cahier des charges avant de lire l'implémentation, exécute tout, ne corrige jamais le code de production et renvoie les écarts à l'état-major.
- **Compte rendu d'un sous-agent** : fait / preuves (commandes et résultats) / écarts / décisions / reste à faire.
- **Règles vivantes** : quand le contrôleur relève deux fois le même type d'erreur, l'état-major ajoute ou précise une règle dans `.cursor/rules/` et, si c'est possible, un contrôle automatique (lint, test, job de CI). Chaque modification de règle est consignée dans `JOURNAL.md`. Une règle ne s'assouplit jamais pour faire passer du code.

### 4.4 Définition de « terminé »

Un jalon n'est coché dans `PLAN.md` que si **tout** est vrai :
1. compilation sans avertissement (`cargo clippy --all-targets -- -D warnings`, TypeScript strict, ESLint sans erreur) ;
2. tests unitaires et d'intégration écrits et verts ; tests d'intégration contre de **vrais services** (Postgres, PowerSync, serveur mail de test, S3 local), pas contre des simulations de base de données ;
3. **exécution réelle** : le service ou l'application a été lancé et le scénario du jalon exécuté de bout en bout, automatiquement ;
4. validation par le contrôleur, consignée dans `JOURNAL.md` ;
5. documentation à jour ;
6. commits sur `main`, CI verte.

Preuves dans `JOURNAL.md`, pour chaque jalon : commandes lancées, résumé des résultats, date.

### 4.5 Conduite face aux obstacles

Un obstacle n'est **jamais** une raison de s'arrêter. Dans l'ordre :
1. diagnostiquer et corriger ;
2. contourner par une autre méthode ;
3. si l'obstacle dépend de moi (compte, secret, décision juridique) : simuler (simulateur fidèle à la documentation officielle), consigner dans `BLOCAGES.md` **l'action exacte attendue de moi**, et poursuivre les autres jalons.

Trois échecs de suite avec la même approche : changer d'approche et le consigner.

**Interdit :**
- désactiver, ignorer ou supprimer un test ; affaiblir une assertion ;
- baisser le niveau des lints ou ajouter des exceptions pour faire passer la CI ;
- laisser `todo!()`, `unimplemented!()`, du code « à finir » ou des valeurs codées en dur pour faire passer un test ;
- simuler un résultat ou écrire « fait » sans preuve.

### 4.6 Fin de mission

La mission est terminée uniquement quand :
- tous les jalons de `PLAN.md` sont cochés, S1 à S14a passent en une seule exécution de la recette sur le poste **et** S14b passe en CI ;
- **ou** tout le travail restant dépend exclusivement d'éléments listés dans `BLOCAGES.md`.

Alors : rédiger `RAPPORT.md` (livré, preuves, écarts au cahier des charges, blocages et actions attendues de moi, installation et lancement, **vérifications à faire à la main sur un vrai Mac** — notamment le comportement du Trousseau avec la signature ad hoc après une mise à jour du binaire), puis créer `.mission/TERMINEE` (ou `.mission/BLOQUEE`).

Tant que ce n'est pas le cas : ne jamais conclure, ne jamais demander « voulez-vous que je continue ? ». **Continuer.**

## 5. Invariants (règles d'engagement, non négociables)

1. **Secret professionnel** : identifiants (stockage, mail, plateforme agréée) jamais sur les postes ; aucune télémétrie ; aucun appel à un service tiers non prévu par le cahier des charges ; aucune donnée réelle dans le dépôt.
2. **Aucune perte de données** : jamais d'écrasement silencieux ; files d'envoi (mail, plateforme agréée) idempotentes.
3. **Factures** : numérotation continue attribuée par le serveur ; facture validée immuable, correction par avoir.
4. **Pas d'hébergement central** des données des cabinets.
5. **Pas de code maison pour** : chiffrement, synchronisation de données, analyse IMAP ou MIME, éditeur de texte riche.
6. **Design** : § 7 du cahier des charges ; interdits du § 7.8 ; aucune couleur en dur.
7. **Tests de l'app construite** : le serveur WebDriver embarqué n'existe que dans les builds de test (feature Cargo dédiée), jamais dans les builds distribués.
8. **Secrets** : ne jamais lire ni écrire de secret réel ; clés de signature de test générées localement, jamais commitées.
9. **Dépendances** : versions vérifiées dans la documentation officielle et consignées dans `docs/versions.md` avant tout ajout.
10. **Git** : jamais de push forcé, jamais de réécriture de l'historique de `main`, jamais de push de tag de version. Pousser `main` vers le dépôt distant pour déclencher la CI est autorisé.
11. **Droit** : toute règle juridique ou fiscale absente du cahier des charges est consignée dans `docs/hypotheses-delais.md` ou `docs/hypotheses-facturation.md`, marquée « à valider par l'avocat ». Tu ne l'inventes pas en silence.

## 6. Soutien

- **Simulateurs à construire si nécessaire** : plateforme agréée (API conforme à la documentation publique de SUPER PDP : dépôt, statuts, encaissement partiel, annuaire) ; serveur mail de test (GreenMail) ; S3 local (Garage).
- **Outils de test** : Vitest ; Playwright pour les captures de référence ; WebdriverIO avec le service Tauri pour l'app construite (fonctionne sous Windows en local et sous macOS en CI) ; navigateur intégré de Cursor pour inspecter l'interface.
- **Outils de validation lourds** (veraPDF, schematron EN 16931) : exécutés dans des conteneurs, pour ne rien installer sur le poste.
- **Données de démonstration** : jeu fictif réaliste (dossiers, contacts, mails, factures), chargé par `cargo xtask demo`.
- **Boîte mail volumineuse de test** : au moins 50 000 messages générés, pour mesurer la synchronisation et la fluidité.

## 7. Commandement et transmissions

- **Ne me sollicite que pour** : un secret ou un compte ; une contradiction du cahier des charges touchant un invariant ; une règle juridique impossible à trancher. Dans ces trois cas, passe par `BLOCAGES.md` et continue le reste.
- **État de la mission lisible à tout moment** : `PLAN.md` (jalons), `JOURNAL.md` (décisions et preuves), `BLOCAGES.md`.
- **Reprise** : à chaque nouvelle session ou après compactage, relis ce document, `PLAN.md`, `JOURNAL.md` et `BLOCAGES.md` avant toute action.
- **Arrêt d'urgence** : si le fichier `.mission/STOP` existe, termine l'action en cours proprement, mets à jour `JOURNAL.md` et arrête-toi.
