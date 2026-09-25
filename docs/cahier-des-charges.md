# App de gestion de cabinet — Stack technique et cahier des charges

*Version 4 du 24 septembre 2026. Document de référence, à fournir aussi comme contexte à Cursor.*

**Changements depuis la version 3 :** ajout de la direction d'interface (§ 7) : concept de la chemise et de ses intercalaires, jetons de design jour et nuit, règles d'écriture et de typographie française, garde-fous contre le rendu générique ; prototype de référence.

**Changements de la version 3 :** Roundcube abandonné au profit d'un **client mail complet intégré à l'app** (moteur de synchronisation en Rust dans l'API, interface React, mails synchronisés comme le reste des données) ; périmètre mail élargi (tout l'historique, comptes multiples, boîtes partagées) ; plan de construction par étapes et de mise en service en parallèle d'Outlook.

**Changements de la version 2 :** retrait du contrôle des conflits d'intérêts et du registre LCB-FT ; facturation électronique (PDF + Factur-X + envoi à une plateforme agréée) intégrée dès la V1.

---

## 0. Principes directeurs

- **Local-first.** L'app desktop travaille sur une base SQLite locale synchronisée. Tout fonctionne hors ligne, mails compris (lecture des mails synchronisés, rédaction, envoi mis en file). Seuls les échanges avec la plateforme agréée, la recherche dans l'historique ancien et la validation des factures exigent une connexion.
- **Une instance par cabinet.** Chaque cabinet déploie son propre backend, sur un compte hébergeur **à son nom**. L'app est un client générique : adresse de l'instance + identifiants, puis tout se synchronise.
- **Aucun hébergement centralisé** des données des confrères. Si tu installes une instance pour un confrère, tu le fais sur son compte et tu ne gardes pas d'accès permanent.
- **Chaque cabinet choisit ses prestataires** : stockage des fichiers, messagerie, plateforme agréée de facturation électronique. Les identifiants correspondants restent sur son instance.
- **Distribution gratuite** entre confrères, sans commercialisation. Code publié sous licence libre avec exclusion de garantie.
- **Code écrit par IA (Cursor)**, relu ligne par ligne sur les zones critiques (voir § 3.9).
- **Interface identifiable au premier coup d'œil** : concept de la chemise et de ses intercalaires, sans aucun des codes visuels génériques (voir § 7).
- **Hors périmètre définitif : RPVA.** Retirés du périmètre : contrôle des conflits d'intérêts, registre LCB-FT.

---

## 1. Architecture

```
┌──────────────── Poste (macOS / Windows) ────────────────┐
│  Tauri v2                                                │
│  ├─ Interface React/TS  ← mises à jour à chaud (hotswap) │
│  │   (dossiers, agenda, GED, facturation, client mail)   │
│  ├─ SQLite local (PowerSync Tauri SDK, géré en Rust)     │
│  ├─ Cache fichiers + surveillance (notify)               │
│  └─ Jeton dans le Trousseau / Gestionnaire d'identif.    │
└───────────────┬─────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼──── Instance du cabinet (docker compose) ┐
│  Caddy (TLS)                                             │
│  ├─ API Rust (Axum) : auth, écritures, fichiers,         │
│  │   factures (PDF, Factur-X), connecteur plateforme     │
│  │   agréée, moteur mail (synchronisation IMAP,          │
│  │   file d'envoi SMTP, classement)                      │
│  └─ PowerSync Open Edition : réplication vers les postes │
│  Postgres ≥ 14 : bases « données » + « powersync »       │
│  Sauvegarde nocturne chiffrée → bucket                   │
└──────┬──────────────────┬──────────────────┬─────────────┘
       │ OpenDAL          │ IMAP / SMTP      │ API HTTPS
 Stockage fichiers   Messageries du     Plateforme agréée
 au choix            cabinet            (ex. SUPER PDP)
```

---

## 2. Stack

### 2.1 Poste (client desktop)

| Brique | Choix | Rôle |
|---|---|---|
| Application | Tauri v2 | App macOS/Windows, binaire léger, webview native |
| Interface | React + TypeScript strict + Vite, Tailwind v4 + shadcn/ui **entièrement rethémé** | UI et logique métier côté client ; direction visuelle au § 7 |
| Jetons de design | `design/tokens.css` (variables CSS jour/nuit + couleurs de chemise) | Source unique des couleurs, typographie, rayons, espacements (§ 7.3) |
| Typographie | Atkinson Hyperlegible Next, fichiers woff2 **embarqués dans l'app** | Aucune requête vers un service de polices (hors ligne, confidentialité) |
| Icônes | Tabler Icons (contour) | Usage rare, toujours avec un nom accessible (§ 7.3) |
| Données locales et sync | SDK Tauri de PowerSync (`tauri-plugin-powersync` + `@powersync/tauri-plugin`) | SQLite natif géré en Rust, survit aux mises à jour |
| Types Rust ↔ TS | tauri-specta | Commandes Tauri typées des deux côtés |
| Secrets locaux | crate `keyring` | Jeton de rafraîchissement dans le Trousseau (macOS) / Gestionnaire d'identification (Windows) |
| Fichiers | Cache local + crate `notify` | Ouverture dans Word/Acrobat, renvoi automatique des modifications |
| Modèles Word | docxtemplater (côté TS) | Fusion documentaire ; modifiable par mise à jour à chaud |
| Client mail — mise en page | Exemple « Mail » de shadcn/ui comme point de départ | Structure à trois volets (dossiers, liste, lecture) |
| Client mail — liste | Liste virtualisée (TanStack Virtual) | Fluidité sur des boîtes de plusieurs dizaines de milliers de mails |
| Client mail — lecture | `iframe` isolée (`sandbox` sans scripts, `srcdoc`, CSP stricte) | Affichage du HTML déjà nettoyé côté serveur |
| Client mail — rédaction | TipTap | Éditeur de texte riche ; jamais d'éditeur fait maison |
| Notifications | Plugin de notification Tauri | Nouveaux mails, échéances |
| Recherche | SQLite FTS5 | Recherche instantanée hors ligne (support FTS5 dans le SDK Tauri à vérifier) |
| MAJ interface | `tauri-plugin-hotswap`, **copié dans le dépôt** | Archives signées minisign, retour arrière automatique |
| MAJ binaire | `tauri-plugin-updater` | Paire de clés Tauri, indépendante d'Apple |

### 2.2 Instance du cabinet (serveur)

| Brique | Choix | Rôle |
|---|---|---|
| Exposition | Caddy | HTTPS automatique |
| API | Rust : Axum + Tokio + sqlx | Auth, chemin d'écriture, fichiers, facturation, mail |
| Authentification | argon2 + jsonwebtoken + totp-rs | Mots de passe hachés, JWT (JWKS exposé à PowerSync), double authentification |
| Base | Postgres ≥ 14, un serveur, deux bases | Données du cabinet (dont les mails) + stockage interne de PowerSync |
| Sync | PowerSync Open Edition (image Docker officielle) | Réplication vers les postes selon les règles de sync |
| Fichiers | OpenDAL (dans l'API) | S3 (OVH, Scaleway, AWS…), WebDAV, SFTP, Drive, OneDrive, Dropbox |
| PDF | Typst, utilisé comme bibliothèque | Factures en PDF/A-3b avec pièce jointe XML, bordereaux, courriers, export de mails en PDF |
| Factur-X | XML CII profil EN 16931 généré en Rust (`quick-xml`) + post-traitement `lopdf` si besoin (métadonnées XMP Factur-X) | Facture électronique hybride |
| Plateforme agréée | Connecteur HTTP (`reqwest`) derrière une interface Rust `PlateformeAgreee` ; première implémentation : SUPER PDP | Envoi, statuts, encaissements, e-reporting, annuaire |
| Mail — protocole | `async-imap` (maintenu par l'équipe Delta Chat) derrière une interface Rust `FournisseurMail` | Synchronisation IMAP ; adaptateur Microsoft Graph possible plus tard |
| Mail — lecture | `mail-parser` | Décodage MIME, encodages, pièces jointes |
| Mail — sécurité HTML | `ammonia` | Nettoyage du HTML avant stockage et affichage |
| Mail — envoi | `lettre` | SMTP de la messagerie du cabinet |
| Mail — OAuth | crate `oauth2` (XOAUTH2 pour IMAP et SMTP) | Microsoft 365, Gmail |
| Mail — invitations | crate `icalendar` | Lecture des invitations, réponses accepter/refuser |
| Mail — recherche historique | Recherche plein texte Postgres (dictionnaire français) | Tout l'historique, côté serveur |
| Sauvegardes | `pg_dump` + chiffrement `age` → bucket | Chaque nuit et avant chaque mise à jour |
| Mise à jour | Minuteur systemd : `docker compose pull && up -d` | Nocturne, canal bêta ou stable |
| Stockage S3 auto-hébergé (option) | Garage | Pour un cabinet qui ne veut pas de bucket externe |

### 2.3 Distribution et mises à jour

| Ce qui change | Canal | Déclencheur | Outil |
|---|---|---|---|
| Interface (React/TS) | Mise à jour à chaud | `pnpm release:ui` depuis ton poste | hotswap + bucket statique |
| Rust de l'app | Mise à jour du binaire | `git tag` + `git push` | `tauri-action` (GitHub Actions) |
| API / base de l'instance | Image Docker | Push → image publiée | GitHub Container Registry + minuteur |

**Signature :** ad hoc sur macOS (`"signingIdentity": "-"` dans `tauri.conf.json > bundle > macOS`), non signé sur Windows. Certificat Apple Developer ID en option si les demandes du Trousseau deviennent gênantes.

**Canaux :** « bêta » pour ton cabinet, « stable » pour les confrères, promotion après quelques jours d'usage réel.

### 2.4 Outillage de développement

pnpm, cargo, sqlx-cli (mode hors ligne pour la CI), clippy + rustfmt, ESLint + TypeScript strict, Vitest, tests Rust.

En CI :
- validation des Factur-X générés (veraPDF pour le PDF/A-3, schematron officiel EN 16931 pour le XML) ;
- serveur IMAP/SMTP de test **GreenMail** en Docker pour les tests du moteur mail ;
- captures d'écran de référence (Playwright) des écrans clés, en mode jour et en mode nuit, comparées à chaque modification.

La CI bloque tout merge qui ne passe pas clippy, les tests, le typage, la validation des factures de test et les tests du moteur mail.

---

## 3. Exigences techniques

### 3.1 Sécurité et secret professionnel

- **FileVault (Mac) / BitLocker (Windows) obligatoires** sur chaque poste tant que SQLCipher n'est pas disponible dans le SDK Tauri de PowerSync. Prérequis documenté, vérifié au premier lancement si possible.
- Les identifiants de stockage, de messagerie et de plateforme agréée restent **sur le serveur**, chiffrés, jamais sur les postes.
- Double authentification (TOTP) activable par cabinet, recommandée par défaut.
- **Cloisonnement par dossier au niveau de la synchronisation** : un dossier restreint n'est jamais téléchargé sur un poste non autorisé (règles de sync PowerSync). Les droits ne sont pas qu'un filtre d'affichage.
- **Cloisonnement des boîtes mail** : une boîte nominative n'est synchronisée que vers son titulaire ; une boîte partagée, vers ses membres ; un mail classé dans un dossier devient visible selon les droits de ce dossier.
- Journal des accès et des modifications par dossier (qui, quoi, quand), non modifiable depuis l'app.
- Révocation et effacement à distance d'un poste (voir § 5.1).
- Sauvegardes chiffrées quotidiennes, **test de restauration** documenté et à faire régulièrement.

### 3.2 Signature ad hoc et authentification (macOS)

- La signature ad hoc identifie l'app par l'empreinte du binaire, qui change à chaque build.
- Conséquence : après chaque **mise à jour du binaire**, macOS redemande en principe l'accès au jeton stocké dans le Trousseau.
- L'app doit gérer ce cas proprement : si l'accès au Trousseau échoue, retour à l'écran de connexion, sans plantage ni perte de données locales.
- Les mises à jour à chaud de l'interface ne modifient pas le binaire : elles ne déclenchent ni demande du Trousseau ni alerte Gatekeeper.
- Premier lancement : le confrère autorise l'app une fois dans les Réglages (Gatekeeper). Procédure à documenter avec captures.
- Windows : alerte SmartScreen à l'installation ; le Gestionnaire d'identification n'est pas lié à la signature.

### 3.3 Mises à jour

- **Rust de l'app minimal et stable.** La logique métier vit dans le TypeScript (mis à jour à chaud) ou dans l'API serveur. Le moteur mail est entièrement côté serveur.
- Chaque archive d'interface déclare la **version minimale du binaire** requise.
- L'API expose son numéro de version ; l'interface vérifie la compatibilité et affiche « mise à jour du serveur en attente » plutôt que de planter.
- Ordre de déploiement : serveur → interface → binaire.
- Le plugin hotswap (version 0.0.x) est **copié dans le dépôt et relu**.

### 3.4 Données et synchronisation

- Postgres ≥ 14, même serveur pour les données et le stockage PowerSync, **bases séparées**.
- Migrations serveur : numérotées (sqlx), exécutées par l'API au démarrage, **après** une sauvegarde, **uniquement additives** (on ajoute d'abord, on supprime plusieurs versions plus tard).
- Schéma client PowerSync : défini en TypeScript, appliqué sous forme de vues, sans migration locale → évolutif par mise à jour à chaud.
- Écritures : file d'attente locale → API Rust → Postgres. L'API valide tout (droits, cohérence) ; le poste n'est jamais cru sur parole.
- Conflits : dernière écriture gagnante par champ par défaut, sauf données sensibles (factures validées, pièces communiquées, mails envoyés) qui sont **immuables** une fois validées.
- Critères d'acceptation de la synchronisation (jalon J3, deux postes) :
  1. Modification faite hors ligne sur le poste A : conservée à la fermeture et au redémarrage de l'app, envoyée au retour du réseau, visible sur le poste B.
  2. Deux champs différents d'un même enregistrement modifiés hors ligne sur A et sur B : les deux modifications survivent. Seuls les champs modifiés sont envoyés ; un enregistrement n'est jamais remplacé en entier.
  3. Même champ modifié des deux côtés : la dernière écriture gagne, mais pas en silence. Chaque modification porte la version sur laquelle elle a été faite ; le serveur détecte le conflit, conserve la valeur remplacée dans le journal des modifications et le conflit est signalé dans l'app.
  4. Coupure réseau pendant l'envoi : ni perte, ni doublon.
  5. Coupure réelle du réseau entre le poste et l'instance (service arrêté ou flux bloqué), pas une simulation interne à l'app.
  Le scénario s'exécute sur l'application Tauri réelle (SDK Tauri de PowerSync, § 2.1), pas dans un navigateur, et sans option de recette qui modifie le comportement de la synchronisation.

### 3.5 Fichiers

- Métadonnées (nom, dossier, empreinte, taille, version, auteur) dans Postgres et synchronisées ; contenu dans le stockage choisi.
- S3 : l'API génère des liens temporaires, les fichiers passent directement entre le poste et le bucket. Drive, OneDrive, Dropbox : l'API sert d'intermédiaire.
- **Versions conservées** à chaque modification.
- Modification concurrente hors ligne : **jamais d'écrasement silencieux** ; les deux versions sont conservées et signalées.
- Cache local plafonné et purgeable ; les dossiers épinglés restent disponibles hors ligne.

### 3.6 Réversibilité

- Export complet du cabinet en un clic : arborescence de fichiers par dossier + données en JSON/CSV, lisible sans l'app. Les factures sont exportées dans leurs deux formats (PDF et Factur-X), les mails classés au format .eml.
- Export par dossier (restitution au client ou transmission au confrère successeur).

### 3.7 Facturation électronique (V1)

**Calendrier et obligations**
- Réception obligatoire depuis le 1er septembre 2026 ; émission et e-reporting obligatoires au 1er septembre 2027 pour les petites structures.
- Depuis juillet 2025, les « PDP » s'appellent officiellement **plateformes agréées (PA)**.
- Client professionnel assujetti en France : facture électronique déposée sur la PA.
- Client particulier, client étranger : pas de facture électronique mais **e-reporting des données de transaction** via la PA.
- **Prestations de services, TVA exigible à l'encaissement** (cas général de l'avocat, hors option pour les débits) : à chaque encaissement, le statut **« encaissée »** doit être transmis via la PA, avec date et montant ventilé par taux de TVA. Paiements partiels : un envoi par encaissement.

**Modèle de données**
- Client : type (professionnel FR / particulier / étranger), SIREN, n° TVA, adresse de facturation, adresse de livraison si différente, adresse de facturation électronique (annuaire).
- Facture : catégorie d'opération (prestation de services), option TVA sur les débits (oui/non, au niveau du cabinet), lignes (honoraires, débours, frais), ventilation TVA, conditions de paiement, référence du dossier.
- Types de document : facture, **avoir** (une facture validée ne se modifie jamais, elle se corrige par avoir), facture d'acompte / de provision.

**Cycle de vie dans l'app**
1. **Brouillon** : création et modification sur le poste, **hors ligne possible**.
2. **Validation** : **en ligne uniquement**. L'API attribue le numéro définitif (séquence continue gérée côté serveur, jamais sur les postes, pour éviter doublons et trous), fige la facture, génère le PDF et le Factur-X.
3. **Émission** : selon le type de client, dépôt de la facture sur la PA ou e-reporting de la transaction. Envoi du PDF au client par mail en parallèle si souhaité (depuis le client mail intégré, copie classée dans le dossier).
4. **Suivi** : l'API récupère les statuts de la PA (événements de cycle de vie) et les synchronise vers les postes.
5. **Encaissement** : la saisie d'un règlement (total ou partiel) déclenche l'envoi du statut « encaissée » avec le montant.

**Génération**
- XML CII profil EN 16931 généré en Rust à partir du modèle de facture.
- PDF lisible généré par Typst en **PDF/A-3b**, avec le XML joint (`factur-x.xml`).
- Si Typst ne permet pas d'écrire les métadonnées XMP propres à Factur-X, post-traitement en Rust (`lopdf`).
- **Solution de repli** : SUPER PDP sait créer un Factur-X à partir du PDF lisible et d'un XML ou d'un JSON.
- Validation systématique en CI (veraPDF + schematron EN 16931) sur un jeu de factures de test couvrant : professionnel, particulier, avoir, acompte, débours, paiement partiel.

**Connecteur plateforme agréée**
- Interface Rust `PlateformeAgreee` : déposer, e-reporter, lire les statuts, envoyer un encaissement, interroger l'annuaire.
- Première implémentation : **SUPER PDP** (API native : création de Factur-X, statuts de cycle de vie, montant partiel encaissé, annuaire). SUPER PDP expose aussi l'API standard AFNOR, avec des limitations.
- Le modèle interne reste aligné sur la norme AFNOR (XP Z12-013) pour pouvoir ajouter une autre PA sans toucher au reste de l'app.
- Identifiants PA : un compte par cabinet, stocké chiffré sur son instance.
- **Idempotence** : chaque envoi porte un identifiant unique ; un envoi répété (réseau coupé, relance) ne crée jamais de doublon.
- File d'envoi côté API avec reprise automatique ; toute erreur de la PA est remontée dans l'app, sur la facture concernée.

### 3.8 Client mail intégré

**Objectif :** un client mail complet, capable de remplacer Outlook sur le poste de travail. Critère d'acceptation : tu fermes Outlook et tu ne le rouvres plus.

**Principe d'architecture :** un vrai client mail, dont le moteur de synchronisation tourne sur le serveur. Les mails deviennent des données comme les autres : stockés dans Postgres, synchronisés vers les postes par PowerSync, soumis aux mêmes droits. On ne développe ni protocole IMAP, ni décodeur MIME, ni éditeur de texte riche : ces briques viennent de bibliothèques éprouvées.

Rappel : SMTP ne sert qu'à **envoyer**. La lecture passe par **IMAP**.

#### 3.8.1 Périmètre fonctionnel

**Lecture et organisation**
- Tous les dossiers IMAP et **tout l'historique** : en-têtes de toute la boîte indexés sur le serveur et synchronisés sur le poste ; contenus des N derniers mois stockés localement (paramétrable) ; au-delà, récupération à la demande.
- Fils de discussion, lus/non lus, drapeaux, déplacement, archivage, suppression, glisser-déposer entre dossiers.
- Aperçu intégré des pièces jointes PDF et images ; documents Word ouverts dans Word (aperçu intégré à étudier : Quick Look sur Mac, gestionnaire d'aperçu sur Windows).
- Images distantes **bloquées par défaut** (suivi, confidentialité), autorisables par expéditeur. Liens ouverts dans le navigateur.
- Invitations de calendrier : affichage, accepter ou refuser, ajout automatique à l'agenda de l'app.
- Notifications système et pastille de non-lus.

**Rédaction et envoi**
- Répondre, répondre à tous, transférer, avec une citation qui s'affiche proprement chez un destinataire sous Outlook.
- Signatures par identité, modèles de mails remplis avec les données du dossier (n° RG, juridiction, références).
- Pièces jointes depuis le disque ou depuis la GED ; alerte si le texte annonce une pièce jointe absente.
- Brouillons enregistrés en continu, localement puis dans le dossier « Brouillons » de la boîte (visibles sur le téléphone).
- Annulation d'envoi pendant quelques secondes et envoi programmé (file d'envoi côté serveur).
- Rédaction hors ligne : le mail part dès le retour du réseau.

**Recherche**
- Instantanée et hors ligne sur les mails stockés localement (FTS5).
- Plein texte sur tout l'historique, côté serveur (index Postgres en français).
- Filtres : expéditeur, dossier, présence d'une pièce jointe, période, compte.

**Comptes**
- Plusieurs comptes et identités par utilisateur : boîte nominative, contact@, secrétariat.
- **Boîtes partagées** avec droits : qui les voit, qui y répond ; indication « traité par » / « assigné à » pour éviter les doubles réponses.

**Spécifique avocat**
- **Classement automatique** quand il est sûr : référence du dossier dans l'objet, ou correspondant lié à un seul dossier actif. Sinon, **suggestion** à valider d'un clic. Corbeille « À classer » pour le reste.
- **Adresse de classement par dossier** (`classement+2026-042@cabinet.fr` si la messagerie gère les adresses « + », sinon référence dans l'objet), relevée par l'API : fonctionne depuis le téléphone ou n'importe quel client.
- Onglet « Mails » dans chaque dossier, tous comptes confondus.
- Nouveau mail depuis un dossier : destinataires suggérés (client, confrère adverse), références pré-remplies, copie classée automatiquement.
- Envoi de pièces de la GED en un geste.
- Export d'un mail en PDF avec en-têtes complets (Typst).
- Temps passé sur un mail proposé à la saisie des temps.

**Cohabitation**
- IMAP garde l'état sur le serveur : téléphone, webmail de l'hébergeur et app voient les mêmes lus/non lus, dossiers et envoyés.
- Les règles de tri définies **côté serveur** chez l'hébergeur continuent de fonctionner.

**Hors périmètre**
- Chiffrement S/MIME ou PGP.
- Règles de tri gérées par l'app (celles du serveur suffisent).
- Calendrier au-delà des invitations.
- Client mobile : le téléphone garde son application mail native, synchronisée par IMAP.

#### 3.8.2 Moteur (API Rust)

- **Un processus de synchronisation par boîte**, uniquement côté serveur, derrière l'interface `FournisseurMail`.
- Notification immédiate des nouveaux messages sur la boîte de réception (IDLE) ; relève incrémentale des autres dossiers.
- Synchronisation incrémentale par identifiants de messages ; extensions de synchronisation rapide utilisées quand le serveur les propose ; **resynchronisation complète** d'un dossier si le serveur l'impose (changement de validité des identifiants).
- Actions de l'utilisateur (lu, déplacement, suppression, drapeau) : écrites localement, envoyées à l'API, appliquées au serveur IMAP ; en cas de refus du serveur, retour à l'état réel et message à l'utilisateur.
- HTML nettoyé (`ammonia`) **avant** stockage ; texte brut conservé pour la recherche.
- Pièces jointes : métadonnées stockées, contenu récupéré à la demande ; copie dans la GED (OpenDAL) quand le mail est classé.
- **Microsoft 365** : OAuth obligatoire (l'IMAP par mot de passe n'y est plus disponible, le SMTP par mot de passe sera désactivé par défaut fin décembre 2026). Gmail : OAuth ou mot de passe d'application. OVH et hébergeurs classiques : mot de passe.
- Adaptateur Microsoft Graph envisageable plus tard si des cabinets sous Microsoft 365 ont besoin des catégories ou des boîtes partagées gérées par Exchange.

#### 3.8.3 File d'envoi et garanties

Chaque mail sortant suit un cycle de vie **visible dans l'app** :

1. **Brouillon** (local, puis serveur).
2. **En attente** : annulable pendant quelques secondes ; envoi programmé possible.
3. **Envoyé** : accepté par le serveur SMTP.
4. **Copie dans « Envoyés » confirmée** : ajoutée par l'API, ou constatée si le fournisseur le fait lui-même.
5. **Échec** : alerte visible sur le mail, nouvelle tentative automatique puis manuelle.

- **Aucune perte** : un mail n'est jamais retiré de la file tant que l'étape 4 n'est pas atteinte.
- **Aucun doublon** : identifiant de message généré une seule fois ; avant toute nouvelle tentative, l'API vérifie s'il figure déjà dans « Envoyés ».

#### 3.8.4 Modèle de données (principales tables)

`comptes_mail` (titulaire, type nominatif/partagé, fournisseur, référence des identifiants chiffrés), `membres_boite_partagee`, `identites` (adresse, nom affiché, signature), `dossiers_imap`, `messages` (identifiants, en-têtes, aperçu, drapeaux, fil, pièces jointes présentes, dossier de rattachement, état de classement), `contenus_messages` (HTML nettoyé, texte), `pieces_jointes` (métadonnées, lien GED si classé), `file_envoi` (état, tentatives, date programmée), `regles_classement`.

Règles de sync PowerSync : comptes nominatifs → titulaire ; boîtes partagées → membres ; mails classés → droits du dossier.

#### 3.8.5 Tableau de santé

Pour chaque compte : dernière relève réussie, retard éventuel, erreurs d'authentification, mails en échec d'envoi. Alerte dans l'app dès qu'un compte ne se synchronise plus.

#### 3.8.6 Construction par étapes

Chaque étape est utilisable seule et réutilise le code de la précédente.

| Étape | Contenu | Valeur immédiate |
|---|---|---|
| 1 | Boîte de classement relevée par l'API, adresses par dossier | Les mails arrivent dans les dossiers, depuis n'importe quel client |
| 2 | Envoi depuis un dossier (file d'envoi complète, § 3.8.3) | Envoi de pièces et factures avec copie classée |
| 3 | Synchronisation des boîtes nominatives, lecture, recherche, classement | Lecture et classement dans l'app |
| 4 | Rédaction complète, brouillons, signatures, modèles, invitations | Client utilisable au quotidien |
| 5 | Comptes multiples, boîtes partagées, tableau de santé | Couverture du cabinet entier |

#### 3.8.7 Mise en service

- **En parallèle d'Outlook** pendant plusieurs semaines : IMAP permet aux deux de travailler sur les mêmes boîtes.
- Bascule seulement quand les critères sont atteints : aucun mail perdu ni dupliqué sur la période, tous les envois confirmés, recherche satisfaisante, performance correcte sur la plus grosse boîte.
- Tests de non-régression sur trois fournisseurs réels : **OVH, Microsoft 365, Gmail**.

### 3.9 Garde-fous pour le code écrit par IA (Cursor)

- Fichier de règles Cursor avec **versions figées** et liens vers les docs (Tauri v2, Axum, sqlx, PowerSync, dont son index de documentation pour IA `llms.txt`, Typst, API SUPER PDP, `async-imap`, `mail-parser`, `lettre`, TipTap).
- **Zones relues ligne par ligne**, tests écrits avant le code :
  1. authentification, jetons, double authentification ;
  2. règles de synchronisation (qui voit quel dossier, quelle boîte mail) ;
  3. migrations de schéma ;
  4. révocation et effacement des postes ;
  5. plugin de mise à jour à chaud ;
  6. numérotation, validation et immutabilité des factures ;
  7. connecteur plateforme agréée (idempotence, statut « encaissée ») ;
  8. **moteur de synchronisation mail et file d'envoi** — la zone la plus sensible de l'app ;
  9. **nettoyage du HTML des mails et isolation de leur affichage**.
- Interdit à l'agent : écrire du chiffrement, un mécanisme de synchronisation de données, un analyseur IMAP ou MIME, ou un éditeur de texte riche à la main.
- **Design** : les jetons et la liste d'interdits du § 7.8 figurent dans les règles Cursor ; aucune couleur écrite en dur dans un composant ; toute modification d'écran est comparée aux captures de référence.
- **Clés hors dépôt** : clé de mise à jour Tauri, clé minisign, jeton du registre, clés d'API de test de la PA, identifiants des boîtes mail de test → secrets GitHub et trousseau. Fichiers sensibles dans `.cursorignore`.

---

## 4. Fonctionnalités

### 4.1 Benchmark (sources en § 8)

| Outil | Positionnement | Ce qu'on en retient |
|---|---|---|
| **Septeo Solutions Avocats (SECIB)** | Référence du marché français | Facturation au temps et au forfait, débours, suivi des impayés, CARPA ; extranet client avec publication de documents selon les droits et paiement en ligne |
| **Kleos** (Wolters Kluwer) | Cloud, tarifs publics | Production documentaire automatisée, gestion des délais de procédure, extranet, droits d'accès, suivi des encours, de la rentabilité et des impayés, intégration Word/Outlook, IA documentaire |
| **Jarvis Legal** (LexisNexis) | Petits et moyens cabinets | Chronomètre intégré, relances automatiques, paiement en ligne, conditions tarifaires par client, dossier et intervenant, fusion documentaire |
| **Clio** (US/Canada) | Leader international | Calendrier calculé à partir des règles de procédure, portail client, étapes de dossier en kanban, rôles et permissions fins, IA qui transforme un document en événements ; adresse mail de classement par dossier (« Maildrop »), compléments Outlook et Gmail |
| **Smokeball** (US/UK/Australie) | Petits cabinets | Capture automatique du temps (y compris dans Word et Outlook), entrées de temps générées chaque nuit et validées avant facturation, rentabilité par dossier |

**Constats :**
- Le socle commun est stable : dossiers, contacts, agenda/délais, documents, temps, facturation, reporting.
- Les différenciateurs actuels : extranet client avec paiement, automatisation documentaire, capture automatique du temps, calcul des délais à partir des règles de procédure.
- Tous sont des SaaS web qui s'appuient sur Outlook ou Gmail pour le mail. Aucun n'offre un vrai fonctionnement hors ligne, ni l'hébergement par le cabinet lui-même, ni un client mail intégré au dossier : c'est l'avantage structurel de l'app.

### 4.2 Périmètre retenu

#### V1 (indispensable)

| # | Fonctionnalité | Détail | Dans la stack |
|---|---|---|---|
| 1 | Dossiers | Client, adversaires, confrères adverses, juridiction, n° RG, type de dossier, étapes en kanban, dossiers liés | Postgres + PowerSync, UI React |
| 2 | Contacts | Personnes physiques et morales, rôle dans chaque dossier, historique ; données de facturation (SIREN, n° TVA, type de client) | Idem |
| 3 | Droits par dossier | Accès restreint à certains collaborateurs | Règles de sync PowerSync (§ 3.1) |
| 4 | Agenda et délais | Audiences, rendez-vous, tâches, rappels ; invitations reçues par mail ajoutées à l'agenda | SQLite local, notifications Tauri |
| 5 | Calcul des délais de procédure | Computation selon le CPC (art. 640 à 642 : point de départ, délais en jours/mois, report au premier jour ouvrable ; art. 643-644 : augmentation pour distance) + bibliothèque de délais usuels **validée par toi** | Règles en TypeScript → mises à jour à chaud lors des réformes |
| 6 | Documents | Arborescence par dossier, versions, ouverture dans Word avec renvoi automatique, recherche | OpenDAL, `notify`, FTS5 |
| 7 | Modèles et fusion | Courriers, conventions, actes générés depuis les données du dossier | docxtemplater |
| 8 | **Client mail intégré** | Client complet remplaçant Outlook, classement dans les dossiers, construit en 5 étapes (§ 3.8) | Moteur Rust dans l'API + interface React |
| 9 | Temps | Chronomètre, saisie manuelle, rattachement au dossier et à l'intervenant | SQLite local |
| 10 | Facturation | Au temps, au forfait, au résultat ; provisions ; débours ; conditions tarifaires par client/dossier/intervenant ; avoirs ; relances ; encours et impayés | API Rust + Typst |
| 11 | Facturation électronique | PDF + Factur-X, dépôt sur la PA, e-reporting, suivi des statuts, statut « encaissée » à chaque règlement (§ 3.7) | Rust (CII, Typst PDF/A-3b) + connecteur PA |
| 12 | Conventions d'honoraires | Modèle, rattachement au dossier, alerte si dossier sans convention signée | Modèles + contrôle à l'ouverture |
| 13 | Tableau de bord | Chiffre d'affaires, encours, temps non facturé, rentabilité par dossier et par client, factures en erreur ou en attente sur la PA, mails à classer | Requêtes locales |
| 14 | Révocation des postes | Voir § 5.1 | API + app |

#### V2

| # | Fonctionnalité | Détail | Dans la stack |
|---|---|---|---|
| 15 | Portail client | Documents publiés selon les droits, dépôt de pièces par le client, suivi du dossier | Pages web légères servies par l'API, liens à durée limitée |
| 16 | Paiement en ligne | Lien de paiement sur la facture, rapprochement automatique → statut « encaissée » envoyé automatiquement | Prestataire de paiement via l'API |
| 17 | Capture automatique du temps | Temps d'activité par dossier dans l'app (mails compris) + sessions d'édition des documents ouverts depuis l'app ; propositions à valider, jamais facturées automatiquement | Événements Tauri + `notify` |
| 18 | Signature électronique | Conventions d'honoraires, lettres de mission | API d'un prestataire qualifié eIDAS |
| 19 | Pièces et bordereaux | Voir § 5.2 | Rust + Typst |
| 20 | Factures fournisseurs reçues | Import des factures reçues sur la PA pour les rattacher aux débours d'un dossier | Connecteur PA |

#### Plus tard, seulement si le besoin est réel

| Fonctionnalité | Position |
|---|---|
| CARPA | Suivi des maniements de fonds ; module à part entière, à ne faire que si un cabinet utilisateur en a besoin |
| Comptabilité | **Pas de logiciel comptable complet.** Journal des encaissements + export pour l'expert-comptable |
| IA documentaire | Optionnelle, désactivée par défaut, fournisseur choisi par le cabinet (secret professionnel) |
| Mobile | Tauri v2 cible iOS et Android ; dépend du support mobile du SDK PowerSync |
| Adaptateur Microsoft Graph | Pour les cabinets sous Microsoft 365 qui ont besoin des catégories ou des boîtes partagées Exchange |
| Complément Outlook | Bouton « Classer dans un dossier » dans Outlook, pour les confrères qui préfèrent garder Outlook |

---

## 5. Deux suggestions hors benchmark

Aucune de ces deux fonctionnalités n'apparaît dans les fiches produits consultées.

### 5.1 Révocation et effacement à distance d'un poste — priorité 1

**Pourquoi.** Le local-first met une copie des dossiers du cabinet, et désormais des mails, sur chaque ordinateur portable. Un vol ou une perte, c'est une atteinte potentielle au secret professionnel. Les concurrents, tout en ligne, n'ont pas ce problème ; toi, si.

**Comment.**
- Registre des postes dans l'API (poste, utilisateur, dernière connexion, révoqué ou non).
- Jetons PowerSync courts, renouvelés par l'API : un poste révoqué ne peut plus les renouveler.
- À la réception d'un refus « poste révoqué », l'app efface la base locale, le cache de fichiers et les entrées du Trousseau.
- Délai hors ligne maximal paramétrable par cabinet : au-delà, l'app se verrouille et exige une reconnexion en ligne.
- Limite assumée : un voleur qui garde la machine hors ligne ne reçoit pas l'ordre d'effacement. C'est pourquoi FileVault/BitLocker et le verrouillage hors ligne restent indispensables.

### 5.2 Gestion des pièces et bordereaux de communication — priorité 2

**Pourquoi.** C'est une tâche quotidienne en contentieux, source d'erreurs (numérotation, pièce oubliée, pièce communiquée deux fois), et les outils analysés ne la mettent pas en avant.

**Comment.**
- Numérotation automatique et continue des pièces par dossier.
- Tampon « Pièce n° X » apposé sur le PDF (Rust, par exemple `lopdf`).
- Bordereau généré automatiquement (Typst).
- Historique : quelle pièce a été communiquée à quel confrère, à quelle date. Une pièce communiquée devient immuable.
- Envoi du bordereau et des pièces depuis le client mail intégré, copie classée.

---

## 6. Points ouverts et à surveiller

| Sujet | Action |
|---|---|
| SDK Tauri de PowerSync en alpha | Figer les versions, suivre le changelog |
| SQLCipher dans le SDK Tauri | Proposition de code ouverte ; activer dès qu'elle est publiée |
| `tauri-plugin-hotswap` en 0.0.x | Copié dans le dépôt, relu, mis à jour manuellement |
| Statut de SUPER PDP | « Immatriculée sous réserve » (rapport d'audit attendu) selon la liste DGFiP relevée en juillet 2026 ; vérifier avant la mise en production. L'interface `PlateformeAgreee` permet d'en changer |
| Factur-X et Typst | Vérifier l'écriture des métadonnées XMP Factur-X ; sinon post-traitement `lopdf` ou création du Factur-X par la PA |
| Numérotation des factures | Définir le format et les séries (factures, avoirs, acomptes) avant la première facture réelle : une séquence ne se corrige pas après coup |
| Microsoft 365 et OAuth | Enregistrement d'une application OAuth pour les cabinets sous Microsoft 365 (IMAP déjà, SMTP fin 2026) |
| Adresses « + » | Vérifier la prise en charge chez l'hébergeur mail de chaque cabinet ; sinon référence du dossier dans l'objet |
| Volume des boîtes mail | Mesurer sur la plus grosse boîte du cabinet : taille locale, durée de la première synchronisation, fluidité de la liste |
| Aperçu des documents Word | Étudier Quick Look (Mac) et le gestionnaire d'aperçu Windows ; à défaut, ouverture dans Word |
| Stockage PowerSync dans Postgres | En bêta chez PowerSync ; tester sauvegarde et restauration |
| Developer ID Apple | À prendre si les demandes du Trousseau gênent les confrères |
| FTS5 dans le SDK Tauri | Vérifier la disponibilité avant de construire la recherche dessus |
| Couleur des dossiers | Trancher : choix manuel à la création, ou couleur par type de matière paramétrée par le cabinet |
| Raccourcis clavier | Valider la liste proposée (§ 7.7) avant de la coder, pour éviter les conflits avec le système |

---

## 7. Interface et design

**Référence visuelle :** prototype publié (https://claude.ai/artifact/22TmtchR14w6DYQrvxp23L), à copier dans le dépôt sous `design/prototype-cabinet.html`. Données fictives.

### 7.1 Concept : la chemise et ses intercalaires

L'interface part d'un objet que l'avocat manipule chaque jour : la chemise cartonnée de couleur.

- **Chaque dossier a sa couleur de chemise.** Elle marque son onglet ; à l'ouverture, toute la bande d'en-tête du dossier prend sa teinte. On sait dans quel dossier on se trouve sans lire, même avec plusieurs dossiers ouverts.
- **Les sections du dossier sont des intercalaires** qui dépassent sur le bord droit : Chrono, Procédure, Pièces, Mails, Temps et factures, Notes.
- **Le cœur du dossier est le chrono** : mails, pièces communiquées, audiences, temps passé, factures et notes dans un seul fil daté, filtrable.

**Principe de retenue :** la chemise est le seul élément audacieux de l'interface. Tout le reste est calme : fond gris-vert neutre, pas d'ombres, pas de cartes, pas de dégradés.

### 7.2 Ce qui est écarté, et pourquoi

| Écarté | Pourquoi |
|---|---|
| Papier crème, titres en serif très contrasté, accent rouge brique, filets fins façon journal | Signature visuelle actuelle des interfaces générées par IA |
| Bleu marine, doré, balance de la justice | Cliché « cabinet d'avocats » |
| Cartes arrondies identiques, ombres grises, dégradés, tableau de bord à quatre chiffres | Kit SaaS par défaut, notamment shadcn/ui non modifié |
| Libellés en capitales, points médians comme séparateurs, flèches dans les boutons, police à chasse fixe pour les petites étiquettes | Tics de mise en page générée |

### 7.3 Jetons

**Couleurs de base**

| Jeton | Rôle | Jour | Nuit |
|---|---|---|---|
| `classeur` | Fond de l'app, barre d'onglets, rail de navigation | #E6EAE8 | #161B1D |
| `feuille` | Surface de lecture | #F9FAF9 | #1E2427 |
| `encre` | Texte principal | #1F2629 | #E4EAE8 |
| `graphite` | Texte secondaire | #5A6569 | #9CA8AC |
| `filet` | Séparateurs | #CDD4D1 | #323B3E |
| `echeance` | Délais à 2 jours ouvrés ou moins, erreurs — **nulle part ailleurs** | #B42318 | #F07A6A |
| `echeance-fond` | Fond d'une alerte | #FBE9E7 | #3A1F1C |

Contrastes mesurés : encre sur feuille 14,7:1 (jour) et 12,9:1 (nuit) ; graphite sur feuille 5,7:1 et 6,4:1 ; échéance sur feuille 6,3:1 et 5,8:1.

**Couleurs de chemise** (bande = repère visuel ; teinte = fond ; texte = texte posé sur la teinte)

| Chemise | Bande (jour) | Teinte (jour) | Texte (jour) | Bande (nuit) | Teinte (nuit) | Texte (nuit) |
|---|---|---|---|---|---|---|
| Kraft | #B98E57 | #F0E5D2 | #664A26 | #C9A06A | #3A3124 | #EBD3AE |
| Bleu classeur | #6F95C4 | #DCE5F1 | #284C76 | #86A9D6 | #23324A | #C9DAF0 |
| Vert amande | #7DAE8A | #DDEBE0 | #335C40 | #8DBE9A | #243A2C | #C6E3CE |
| Jaune paille | #CDAE3C | #F3EBC7 | #5E4E0E | #D6BC57 | #3A3419 | #EEE0A8 |
| Rose buvard | #D08AAB | #F4E0EA | #7E3A5C | #D99BB8 | #3D2632 | #F0CCDC |
| Lilas | #9A8BC7 | #E7E2F2 | #4E4178 | #AA9CD6 | #2E2942 | #DCD4F2 |
| Vert d'eau | #66AEA8 | #D9ECEA | #245C58 | #7CC0BA | #1F3836 | #C2E6E2 |
| Gris perle | #98A3AB | #E4E8EB | #3F4A51 | #7D8990 | #262E32 | #D3DBDF |

Texte sur teinte : au moins 6,2:1 dans tous les cas (mesuré). La bande n'atteint pas 3:1 sur la feuille en mode jour : elle ne sert jamais seule à identifier un dossier (voir § 7.4).

**Typographie**
- Famille unique : **Atkinson Hyperlegible Next** (licence OFL), fichiers woff2 embarqués dans l'app.
- Chiffres tabulaires partout (`font-variant-numeric: tabular-nums`).
- Deux graisses : 400 pour le texte, 700 pour les noms de dossiers, les titres et les éléments actifs.
- Échelle : 12 px (métadonnées), 13 px (texte secondaire, listes denses), 14 px (base), 17 px (titres de section), 26 px (nom du dossier), 28 px (titre de « La journée »). Interligne 1,45.
- Lecture d'un mail : 15 px, interligne 1,6, 72 caractères au plus par ligne.
- Casse de phrase partout ; jamais de libellés en capitales.

**Formes**
- Rayons selon le rôle : onglets de dossier 8 px (coins hauts) ; intercalaires 7 px (côté extérieur) ; boutons et champs 5 px ; pastilles de chemise 2 px ; menus et palette de commandes 8 px ; zones de l'application sans arrondi.
- Ombres : aucune, sauf pour les couches flottantes (menus, palette de commandes, dialogues), avec une seule ombre définie.
- Séparation par la couleur des surfaces (classeur / feuille) et par des filets dans les listes ; jamais de cartes pour présenter une liste.

**Espacements** : grille de 4 px ; marges de page 32 px ; lignes de liste d'environ 44 px (densité compacte par défaut, densité confortable en option).

**Mouvement**
- Instantané par défaut : changement d'onglet, filtres, navigation.
- Un seul mouvement orchestré : le classement d'un mail. Le mail file vers l'onglet de son dossier (460 ms), puis l'onglet s'allume brièvement (700 ms).
- Retours d'action discrets autorisés (150 ms au plus) à l'ouverture et à la fermeture des menus.
- Le réglage système « réduire les animations » est respecté.

**Icônes** : Tabler Icons en contour, trait fin ; usage rare ; jamais seules, sauf pour fermer, rechercher ou pièce jointe, et toujours avec un nom accessible.

### 7.4 Règles de la chemise

- **Choix de la couleur** à la création du dossier, avec une suggestion qui évite les couleurs des dossiers déjà ouverts. Option du cabinet : couleur attribuée par type de matière.
- **Où elle apparaît** : onglet du dossier, bande d'en-tête, intercalaires, chronomètre, et pastille du dossier partout où il est cité (agenda, mails, factures, suggestions de classement).
- **Où elle n'apparaît jamais** : statuts, alertes, boutons d'action génériques.
- **Jamais seule** pour identifier un dossier : toujours accompagnée de son nom.
- **Huit couleurs seulement.** Au-delà, les couleurs se répètent entre dossiers ; le nom lève l'ambiguïté.

### 7.5 Écrans clés

- **La journée (accueil)** : audiences et rendez-vous du jour, délais, mails à classer avec leur suggestion de dossier, temps non saisi. Pas de statistiques.
- **Dossier** : bande d'en-tête (nom, étape, juridiction, n° RG, client, adversaire, prochaine échéance), chrono filtrable, intercalaires.
- **Client mail** : trois volets (comptes et dossiers IMAP, liste, lecture). Chaque mail classé porte la pastille de son dossier ; un bandeau « Classer dans … » propose le dossier en tête du mail ; glisser un mail sur l'onglet d'un dossier le classe.
- **Facturation** : liste des factures avec leur statut sur la plateforme agréée ; création depuis le dossier, avec les temps non facturés déjà repris.
- **Palette de commandes** (⌘K sur Mac, Ctrl+K sur Windows) : aller à un dossier (par nom, client ou n° RG), créer (facture, mail, rendez-vous, temps), agir sur l'élément affiché.
- **Barre de titre** : onglets des dossiers ouverts intégrés à la barre de titre de la fenêtre, chronomètre (avec la pastille du dossier en cours), recherche, bascule jour/nuit.

### 7.6 Écriture et typographie française

- **Une fonction de mise en forme unique** (`fr()`) appliquée à tout texte d'interface : espaces fines insécables avant « : ; ? ! » et à l'intérieur des guillemets « », espace insécable avant « € », après « Me » et « n° ».
- **Nombres et montants** : `Intl.NumberFormat('fr-FR')`, soit « 2 400,00 € ».
- **Dates et heures** : « 24 sept. », « jeudi 24 septembre » ; heures au format « 9 h 12 » (formateur maison : `Intl` produit « 09:12 ») ; durées « 1 h 30 ».
- **Apostrophe typographique** (’) partout.
- **Rédaction** : verbes d'action (« Classer dans Ferrand Métal », « Saisir »), casse de phrase, pas de points médians comme séparateurs, pas de flèches dans les boutons. Un message d'erreur dit ce qui s'est passé, puis quoi faire. Un état vide dit ce qu'on peut faire.

### 7.7 Accessibilité et clavier

- Contraste AA au minimum pour tout texte (voir mesures au § 7.3).
- Focus visible partout ; toute action réalisable au clavier.
- Raccourcis proposés (à valider) : ⌘K palette de commandes ; ⌘1 à ⌘9 onglets de dossiers ; J / K mail suivant / précédent ; E archiver ; C classer ; R répondre ; T saisir du temps.
- Zoom de l'interface réglable.

### 7.8 Mise en œuvre et garde-fous

- `design/tokens.css` : source unique des jetons, jour et nuit, y compris les huit chemises.
- Tailwind v4 lit ces jetons ; le thème shadcn/ui est entièrement réécrit à partir d'eux ; les composants shadcn copiés dans le dépôt sont adaptés (rayons, densité, graisses).
- Police embarquée dans les ressources de l'app.
- Galerie de composants (page réservée au développement) pour relire chaque composant en jour et en nuit.
- Prototype de référence dans `design/prototype-cabinet.html` : tout nouvel écran lui est comparé.
- **Interdits** (repris dans les règles Cursor) :
  - toute autre police (Inter, Geist, etc.) ;
  - dégradés, ombres sur les blocs, cartes pour les listes ;
  - toute couleur hors jetons, et tout code couleur écrit en dur dans un composant ;
  - rouge en dehors des délais et des erreurs ; couleurs de chemise pour des statuts ;
  - libellés en capitales, points médians comme séparateurs, flèches dans les boutons ;
  - icônes seules sans nom accessible ;
  - animations d'entrée sur les listes et les pages ;
  - illustrations et émojis.

---

## 8. Sources

**Stack**
- PowerSync Tauri SDK : https://docs.powersync.com/client-sdks/reference/tauri
- Annonce du SDK Tauri (persistance, performances) : https://releases.powersync.com/announcements/ann_mPwGQpcccCyvL
- SQLCipher dans le SDK Tauri (suivi) : https://github.com/powersync-ja/powersync-docs/issues/539
- Stockage PowerSync dans Postgres : https://releases.powersync.com/announcements/ann_AUNZWHlVzOeU2
- Licence PowerSync Open Edition : https://powersync.com/blog/powersync-update-may-2024
- Signature macOS avec Tauri : https://v2.tauri.app/distribute/sign/macos/
- tauri-plugin-hotswap : https://docs.rs/tauri-plugin-hotswap
- Apache OpenDAL : https://github.com/apache/opendal
- Typst 0.14 (standards PDF/A) : https://typst.app/blog/2025/typst-0.14

**Interface**
- Atkinson Hyperlegible Next (Braille Institute, licence OFL) : https://www.brailleinstitute.org/freefont/
- Prototype de référence : https://claude.ai/artifact/22TmtchR14w6DYQrvxp23L

**Mail**
- async-imap : https://github.com/async-email/async-imap
- Utilisation d'async-imap par Delta Chat : https://github.com/deltachat/deltachat-core-rust
- Microsoft 365, fin de l'authentification par mot de passe en SMTP : https://www.itelio.com/en/microsoft-message-center/MC786329
- Clio Maildrop (adresse de classement par dossier) : https://help.clio.com/hc/en-us/articles/9289644630811-Mobile-App-Communications

**Facturation électronique**
- SUPER PDP, documentation de l'API : https://www.superpdp.tech/documentation/8
- SUPER PDP, statut sur la liste DGFiP : https://facturoscope.fr/plateformes-agreees/super-pdp/
- PDP devenues plateformes agréées : https://wiki.dolibarr.org/index.php/Module_PA_Transmission
- E-reporting des données de paiement, statut « encaissée » : https://www.fiducial.fr/facturation-electronique/faq/e-reporting-facturation-electronique-champ-application
- Facturation électronique et avocats : https://www.lafabriquedunet.fr/logiciels/gestion/facturation/facturation-avocat

**Benchmark**
- Clio, calendrier : https://www.clio.com/ca/practice-types/civil-litigation-software/
- Clio, offres : https://clio.com/pricing
- Kleos : https://www.wolterskluwer.com/fr-fr/solutions/kleos/discover-the-next-kleos-generation-solution
- Jarvis Legal, facturation : https://www.lexisnexis.com/fr-fr/produits/logiciels/facturation-avocat
- Jarvis Legal, conditions tarifaires : https://www.lexisnexis.com/fr-fr/produits/jarvis-legal/facturation
- SECIB Online (extranet) : https://www.septeo.com/en/products-and-services/lawyer-firm-extranet-client-area-secib-online
- SECIB néo : https://www.legaltechnologyhub.com/vendors/secib/
- Smokeball AutoTime : https://smokeball.com/features/legal-time-tracking-software
