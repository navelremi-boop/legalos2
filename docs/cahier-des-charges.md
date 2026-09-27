# App de gestion de cabinet — Stack technique et cahier des charges

*Version 5 du 26 septembre 2026. Document de référence, à fournir aussi comme contexte à Cursor.*

**Changements depuis la version 4 :** nouvelle direction d'interface (§ 7 entièrement réécrit) : la « chemise ouverte », traitée comme une interface système actuelle (grain fin, lumière douce, transparence, élévation), étiquette de dossier avec référence chiffrée, jauge d'échéance, intercalaires personnalisables, vue scindée chrono et aperçu, barre d'actions flottante, badges « définitif », mode nuit ; nouveau prototype de référence. Ajout de la référence de dossier attribuée par le serveur (§ 3.4) et des règles sur les intercalaires (§ 7.4).

**Changements de la version 4 :** ajout de la direction d'interface (§ 7) : concept de la chemise et de ses intercalaires, jetons de design jour et nuit, règles d'écriture et de typographie française, garde-fous contre le rendu générique ; prototype de référence.

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
- **Interface identifiable au premier coup d'œil** : on travaille dans la chemise du dossier, avec le traitement visuel des interfaces système actuelles et sans les codes génériques (voir § 7).
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
| Jetons de design | `design/tokens.css` (variables CSS jour/nuit, huit chemises à quatre valeurs, fond neutre) + tuile de grain embarquée | Source unique des couleurs, matières, typographie, rayons, espacements (§ 7.3) |
| Typographie | Atkinson Hyperlegible Next, fichiers woff2 **embarqués dans l'app** | Aucune requête vers un service de polices (hors ligne, confidentialité) |
| Icônes | Tabler Icons (contour, trait fin) | Tuiles du chrono, barre d'actions, encarts, badges ; toujours avec un libellé ou un nom accessible (§ 7.3) |
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
| Mail — protocole | io-imap (Pimalaya, sur imap-codec), version figée, derrière FournisseurMail | Synchronisation IMAP ; adaptateur Microsoft Graph possible plus tard |
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
- **Référence de dossier** (« Dossier 2026-042 » avec le modèle par défaut) : **attribuée par le serveur** dans une transaction avec contrainte d'unicité, jamais sur le poste. Chaque cabinet choisit un modèle (jetons `{AAAA}`, `{AA}`, `{N}`, `{N:k}`, `{INI}` ; « / » admis comme texte libre ; défaut `{AAAA}-{N:3}`). Remise à zéro annuelle (1er janvier, heure de Paris) ou jamais. Un numéro de départ permet de poursuivre une numérotation déjà commencée ; un changement qui redonnerait une référence existante est refusé. L'avocat responsable est choisi à la création (par défaut celui qui crée le dossier) ; ses initiales sont figées à l'attribution. Un dossier créé hors ligne affiche « référence en attente » jusqu'à la synchronisation. Une référence attribuée ne change jamais.
- Conflits : dernière écriture gagnante par champ par défaut, sauf données sensibles (factures validées, pièces communiquées, mails envoyés) qui sont **immuables** une fois validées.

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
- **Classement automatique** quand il est sûr : référence du dossier (« 2026-042 ») dans l'objet, ou correspondant lié à un seul dossier actif. Sinon, **suggestion** à valider d'un clic. Corbeille « À classer » pour le reste.
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

- Fichier de règles Cursor avec **versions figées** et liens vers les docs (Tauri v2, Axum, sqlx, PowerSync, dont son index de documentation pour IA `llms.txt`, Typst, API SUPER PDP, `io-imap`, `mail-parser`, `lettre`, TipTap).
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
- **Design** : les jetons et la liste d'interdits du § 7.9 figurent dans les règles Cursor ; aucune couleur écrite en dur dans un composant ; toute modification d'écran est comparée aux captures de référence.
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
| 1 | Dossiers | Référence attribuée par le serveur (§ 3.4), client, adversaires, confrères adverses, juridiction, n° RG, type de dossier, étape, dossiers liés ; intercalaires standards et personnalisés (§ 7.4) | Postgres + PowerSync, UI React |
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
| Raccourcis clavier | Valider la liste proposée (§ 7.8) avant de la coder, pour éviter les conflits avec le système |
| Référence de dossier | Format arbitré le 27/09/2026 (R0, § 3.4). Une référence attribuée ne se réécrit pas ; un nouveau modèle ne vaut que pour les dossiers créés ensuite |
| Clients publics | Chorus Pro et les clients publics ne sont pas couverts en V1 (facturation F8) |
| Écrans non maquettés | La journée est validée par l'architecte, sous réserve des captures régénérées sans points médians (validation de la Coque). Dossiers, Mails, Agenda, Facturation et Réglages : captures validées par l'architecte, veto du commandement (§ 7.6) |

---

## 7. Interface et design

**Référence visuelle :** maquette publiée (https://claude.ai/artifact/7Vq3FG7N7dEcmbmdMiGnEV), à copier dans le dépôt sous `design/prototype-cabinet.html`, où elle remplace la version précédente. Données fictives. Elle montre la vue dossier en jour et en nuit, avec trois couleurs de chemise. Les autres écrans ne sont pas maquettés : ils se construisent avec les mêmes composants et les mêmes règles (§ 7.6).

### 7.1 Concept : la chemise ouverte

- **On travaille dans la chemise** : tout l'espace de travail prend la couleur du dossier ouvert.
- **Le nom et la référence sont sur une étiquette**, posée sur la chemise.
- **Le contenu est une feuille** (carte blanche en jour, anthracite en nuit), avec une seconde carte qui dépasse derrière.
- **Les sections sont des intercalaires** qui sortent de sous la feuille, sur la droite.
- **Le traitement est celui des interfaces système actuelles** (macOS, Windows 11) : grain fin, lumière douce, transparence floutée, élévation.
- **Retenue** : un seul élément fort, la couleur de la chemise. Tout le reste est calme et lisible.

### 7.2 Ce qui est écarté, et pourquoi

| Écarté | Pourquoi |
|---|---|
| Papier crème, titres en serif très contrasté, accent rouge brique, filets façon journal | Signature visuelle actuelle des interfaces générées par IA |
| Bleu marine, doré, balance de la justice | Cliché « cabinet d'avocats » |
| Éléments artisanaux : traits tracés à la main, tampons encrés, textures de papier | Contraire au rendu technologique voulu |
| Frise ou étapes de procédure en tête de dossier | Surcharge l'écran |
| Cadre ou pastille autour de chaque information | Surcharge ; les informations du dossier restent en texte simple |
| Libellés en capitales, points médians comme séparateurs, flèches dans les boutons | Tics de mise en page générée |

### 7.3 Jetons

**Couleurs de base**

| Jeton | Rôle | Jour | Nuit |
|---|---|---|---|
| `encre` | Texte principal | #141A1C | #E8EEEC |
| `graphite` | Texte secondaire | #5A6569 | #9CA8AC |
| `feuille` | Carte de travail, étiquette | #FFFFFF | #1A2023 |
| `feuille-2` | Fonds secondaires (tuiles, filtres, chiffres, fichiers) | #F6F8F7 | #20272A |
| `filet` | Séparateurs | #E8ECEB | #2B3438 |
| `survol` | Survol des lignes | #F3F6F5 | #222A2D |
| `barre` | Barre du haut, barre d'actions | rgba(16,21,23,.86) + flou | idem |
| `neutre` | Espace de travail hors dossier (§ 7.6) | #2A3337 | #11171A |
| `definitif` | Badges « définitif » (fond : même couleur à 9–10 %) | #43388A | #BDB4F5 |
| `echeance` | Délais à 2 jours ouvrés ou moins, erreurs — **nulle part ailleurs** | #B42318 | #F07A6A |
| `synchro` | Point « Synchronisé » | #7BD89A | #7BD89A |

Texte posé directement sur une chemise ou sur le fond neutre : #141A1C en jour sur les chemises, #F2F5F4 en nuit et sur le fond neutre.

Contrastes mesurés : encre sur feuille 17,6:1 (jour) et 14,0:1 (nuit) ; graphite sur feuille 6,0:1 et 6,8:1 ; badge définitif 8,5:1 et 7,7:1 ; échéance 6,6:1 et 6,0:1.

**Couleurs de chemise** : quatre valeurs par chemise.
- **fond** : espace de travail, onglet actif, bouton principal de la barre d'actions ;
- **teinte** : sélection dans le chrono, encarts ;
- **texte** : texte posé sur la teinte, référence du dossier sur l'étiquette ;
- **accent** : icônes, pastilles, indicateurs.

*Jour*

| Chemise | Fond | Teinte | Texte | Accent |
|---|---|---|---|---|
| Kraft | #CE9A55 | #F6E7CE | #5A3F14 | #A9783A |
| Bleu classeur | #6FA2E0 | #E1ECFA | #1C4273 | #3F72B8 |
| Vert amande | #6CBF84 | #E1F3E7 | #1F5431 | #3E9158 |
| Jaune paille | #D9B84A | #F7EFCB | #5A4A0C | #9C8420 |
| Rose buvard | #D98BB0 | #F8E4EE | #7A2F55 | #B0557F |
| Lilas | #A493D6 | #ECE7F8 | #45377A | #7462B5 |
| Vert d'eau | #5FB8B0 | #DDF2F0 | #1D5550 | #2F8A82 |
| Gris perle | #A3AEB6 | #E9EDF0 | #36424A | #6B7882 |

*Nuit*

| Chemise | Fond | Teinte | Texte | Accent |
|---|---|---|---|---|
| Kraft | #6E5128 | #3A2E1C | #F2D6AB | #D9A860 |
| Bleu classeur | #2F4F7A | #1E2F48 | #D2E3F8 | #86B6F0 |
| Vert amande | #2E5A3D | #1C3827 | #CFEDD8 | #86CF9C |
| Jaune paille | #6B5A1C | #36301A | #F2E3A8 | #D9C25A |
| Rose buvard | #6E3350 | #3A2130 | #F4CFE0 | #E39CBF |
| Lilas | #4A3F78 | #2A2542 | #DDD5F5 | #B1A3E8 |
| Vert d'eau | #245A56 | #183634 | #C6ECE8 | #7FCFC7 |
| Gris perle | #45515A | #283034 | #D8DFE3 | #A9B5BD |

Contrastes mesurés, minimum sur les huit chemises : texte sur le fond 6,5:1 (jour) et 6,2:1 (nuit) ; texte sur la teinte 7,3:1 ; référence sur l'étiquette 8,5:1 ; accent sur les fonds secondaires 3,4:1 (éléments non textuels).

**Matière et lumière**
- **Grain** : bruit fin et uniforme sur la chemise et l'onglet actif, opacité moyenne d'environ 4 %. Tuile fixe embarquée dans `design/`, jamais calculée en continu.
- **Lumière** : deux halos radiaux très doux sur la chemise, clair en haut à gauche, sombre en bas à droite, plus discrets en nuit ; léger reflet en haut de l'onglet actif.
- **Jamais** de dégradé multicolore ni de halo coloré.

**Transparence floutée** : barre du haut, barre d'actions, jauge, intercalaires inactifs. Petites surfaces uniquement ; jamais sur la feuille, ni derrière un texte long.

**Élévation** : étiquette, jauge, feuille, intercalaire actif, barre d'actions, menus et palette de commandes. Ombres douces et diffuses ; aucune ombre sur les lignes de liste.

**Typographie**
- Famille unique : **Atkinson Hyperlegible Next** (licence OFL), fichiers woff2 embarqués.
- Chiffres tabulaires partout (`font-variant-numeric: tabular-nums`).
- Graisses : 400 (texte), 700 (libellés, éléments actifs), 800 (titres, nom du dossier).
- Échelle : 11–12 px (compteurs, libellés des informations du dossier), 12,5–13 px (métadonnées, boutons), 14 px (texte courant), 17–18 px (titres de section, titre de l'aperçu), 26 px (nom du dossier).
- Interligne 1,45 ; corps d'un mail : 1,6 et 62 caractères au plus par ligne.
- Casse de phrase partout ; jamais de libellés en capitales.

**Formes** : onglets 12 px, avec raccords courbes vers la chemise ; feuille et carte arrière 18 px (coins hauts) ; étiquette, encarts et lignes de liste 12 px ; tuiles d'icône 9 px ; boutons 8 à 11 px ; pastilles et badges en arrondi complet.

**Espacements** : grille de 4 px ; chemise 28 px en haut et 42 px à gauche ; feuille 18 à 26 px.

**Mouvement**
- Survol et sélection : 150 ms.
- Changement de dossier : transition de couleur de 300 ms.
- Un seul mouvement orchestré : le classement d'un mail, qui file vers l'onglet de son dossier.
- Le réglage système « réduire les animations » est respecté.

**Icônes** : un seul jeu à trait fin (Tabler Icons, contour), dans les tuiles du chrono, la barre d'actions, les encarts et les badges (cadenas). Toujours avec un libellé ou un nom accessible.

### 7.4 Composants

**Barre du haut**
- Navigation : La journée, Dossiers, Mails (avec compteur), Agenda, Facturation. Temps et Réglages dans le menu du compte, à droite, et dans la palette de commandes.
- Onglets des dossiers ouverts. L'onglet actif prend la couleur de la chemise, avec raccords courbes et croix de fermeture ; les inactifs sont discrets, avec la pastille de leur couleur. Quand la largeur manque, les onglets se réduisent, puis un menu liste les dossiers ouverts.
- Indicateur de synchronisation : un point et « Synchronisé », ou « Hors ligne, 3 modifications en attente ».
- Chronomètre, avec la pastille du dossier chronométré ; recherche et palette de commandes (Ctrl K).

**Étiquette** : « Dossier 2026-042 » (12 px, gras, couleur *texte* de la chemise), puis le nom du dossier (26 px). Fond `feuille`, élévation légère, sans liseré.

**Informations du dossier** : juridiction, n° RG, client, adversaire (ou nature et notaire pour un dossier de conseil). Texte simple, sans cadre, aligné sur le texte de l'étiquette.

**Jauge d'échéance** : anneau indiquant les jours restants et la part du temps écoulé depuis l'étape précédente, avec l'intitulé et la date de l'échéance, sur verre dépoli. Délai de 2 jours ouvrés ou moins : anneau et nombre en `echeance`.

**Feuille** : carte de travail avec une carte derrière ; elle affiche la vue de l'intercalaire actif.

**Intercalaires**
- Standards : Chrono, Procédure (Étapes pour un dossier de conseil), Pièces, Mails, Factures, avec leurs compteurs.
- Personnalisés : bouton « + Intercalaire », saisie du nom ; croix pour retirer un intercalaire personnalisé.
- Rendu : l'actif est blanc et attaché à la feuille ; les inactifs sont en verre dépoli, sans bord du côté de la feuille, comme s'ils sortaient de dessous.
- **Règles** :
  - les intercalaires standards ne peuvent pas être retirés ;
  - un élément rangé dans un intercalaire reste visible dans le chrono : c'est un classement supplémentaire, pas un déplacement ;
  - retirer un intercalaire ne supprime jamais son contenu ;
  - les intercalaires personnalisés sont synchronisés et soumis aux droits du dossier.

**Vue scindée (intercalaire Chrono)**
- À gauche, la liste : groupée par période (Aujourd'hui, Cette semaine, Plus tôt), avec des filtres (Tout, Mails, Pièces, Factures). Chaque ligne : tuile d'icône, titre, métadonnées, puis l'heure ou un badge à droite. La sélection prend la *teinte* de la chemise.
- À droite, l'aperçu, adapté au type d'élément :
  - **mail** : expéditeur, texte, pièces jointes, encart expliquant le classement, avec un bouton « Changer » ;
  - **pièces** : bordereau, liste des pièces, mention « définitif » ;
  - **facture** : montant, encaissé, reste dû, barre de progression, statut sur la plateforme agréée ;
  - **audience** : ajout à l'agenda ;
  - **note** : texte et visibilité.

**Badges « définitif »** : cadenas et libellé (Communiquées, Validée, Encaissée, Envoyé), en `definitif`. Réservés à ce qui ne peut plus être modifié.

**Barre d'actions flottante** : Nouveau mail (bouton principal, à la couleur du dossier), Saisir du temps, Facturer, Calculer un délai, avec les raccourcis affichés. Hors dossier, elle propose les actions globales.

### 7.5 Règles de la chemise

- **Choix de la couleur** à la création du dossier, avec une suggestion qui évite les couleurs des onglets ouverts. Option du cabinet : couleur attribuée par type de matière.
- **Où elle apparaît** : fond de l'espace de travail, onglet actif, pastille du dossier partout où il est cité, bouton principal de la barre d'actions ; sa *teinte* pour la sélection et les encarts ; son *accent* pour les icônes.
- **Où elle n'apparaît jamais** : statuts, alertes, badges « définitif ».
- **Jamais seule** : toujours accompagnée du nom du dossier et de sa référence.
- **Huit couleurs seulement** : au-delà, les couleurs se répètent entre dossiers ; le nom lève l'ambiguïté.

### 7.6 Écrans non maquettés

La journée, Dossiers, Mails, Agenda, Facturation et Réglages suivent la même structure : barre du haut, espace de travail, feuille, barre d'actions.

- **Hors dossier**, l'espace de travail prend la couleur `neutre`, sans étiquette de dossier.
- **La journée** : une feuille en quatre sections (audiences et rendez-vous du jour, délais, mails à classer avec leur suggestion de dossier, temps à saisir). Chaque dossier cité porte sa pastille. Barre d'actions : Nouveau dossier, Nouveau mail, Saisir du temps.
- **Mails** : une feuille en trois volets (comptes et dossiers IMAP, liste, lecture). Chaque mail classé porte la pastille de son dossier, et un bandeau « Classer dans … » s'affiche en tête d'un mail non classé.
- **Agenda, Facturation, Réglages** : une feuille unique, construite avec les mêmes composants.
- **Validation** : au premier passage, chaque nouvel écran fait l'objet de captures en jour et en nuit, revues par le contrôleur au regard du présent § 7. La journée est validée par l'architecte, sous réserve des captures régénérées sans points médians (validation de la Coque). Pour les autres écrans, la validation sur captures est déléguée à l'architecte ; le commandement garde son veto.

### 7.7 Écriture et typographie française

- **Une fonction de mise en forme unique** (`fr()`) appliquée à tout texte affiché, y compris les objets et le texte des mails : espaces fines insécables avant « : ; ? ! » et à l'intérieur des guillemets « », espace insécable avant « € », après « Me » et « n° ».
- **Nombres et montants** : `Intl.NumberFormat('fr-FR')`, soit « 2 400,00 € ».
- **Dates et heures** : « 24 sept. », « jeudi 24 septembre » ; heures au format « 9 h 12 » (formateur maison : `Intl` produit « 09:12 ») ; durées « 1 h 30 ».
- **Apostrophe typographique** (’) partout.
- **Rédaction** : verbes d'action (« Classer dans Ferrand Métal », « Saisir »), casse de phrase, pas de points médians comme séparateurs, pas de flèches dans les boutons. Un message d'erreur dit ce qui s'est passé, puis quoi faire. Un état vide dit ce qu'on peut faire.

### 7.8 Accessibilité et clavier

- Contraste AA au minimum pour tout texte (voir les mesures du § 7.3).
- Focus visible partout : onglets, intercalaires, lignes du chrono, boutons de la barre d'actions. Toute action est réalisable au clavier.
- Raccourcis proposés (à valider) : Ctrl K palette de commandes ; Ctrl 1 à Ctrl 9 onglets de dossiers ; J / K élément suivant / précédent ; E archiver ; C classer ; R répondre ; T saisir du temps. Sur macOS, ⌘ remplace Ctrl.
- Zoom de l'interface réglable.

### 7.9 Mise en œuvre et garde-fous

- `design/tokens.css` : source unique des jetons, jour et nuit, y compris les huit chemises à quatre valeurs, le fond neutre et la tuile de grain.
- Tailwind v4 lit ces jetons ; le thème shadcn/ui est entièrement réécrit à partir d'eux ; les composants shadcn copiés dans le dépôt sont adaptés (rayons, densité, graisses).
- Police et tuile de grain embarquées dans les ressources de l'app.
- Galerie de composants (page réservée au développement), en jour et en nuit.
- Prototype de référence dans `design/prototype-cabinet.html` : tout nouvel écran lui est comparé.
- **Performance** : flou limité aux petites surfaces ; aucun filtre SVG calculé en continu ; ombres portées uniquement sur des éléments fixes.
- **Interdits** (repris dans les règles Cursor) :
  - toute autre police (Inter, Geist, etc.) ;
  - dégradés multicolores, halos colorés ;
  - flou sur de grandes surfaces ou derrière un texte long ;
  - ombres sur les lignes de liste ; cadre ou pastille autour de chaque information ;
  - toute couleur hors jetons, et tout code couleur écrit en dur dans un composant ;
  - rouge `echeance` en dehors des délais et des erreurs ; violet `definitif` en dehors de ce qui est définitif ; couleurs de chemise pour des statuts ;
  - libellés en capitales, points médians comme séparateurs, flèches dans les boutons ;
  - icône seule sans libellé ni nom accessible ;
  - éléments artisanaux : traits à la main, tampons, textures de papier ;
  - illustrations, émojis, animations d'entrée sur les listes et les pages.

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
- Prototype de référence : https://claude.ai/artifact/7Vq3FG7N7dEcmbmdMiGnEV

**Mail**
- io-imap 0.6.1 (Pimalaya) : https://crates.io/crates/io-imap/0.6.1
- imap-codec 2.0.0-alpha.8 : https://crates.io/crates/imap-codec/2.0.0-alpha.8
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
