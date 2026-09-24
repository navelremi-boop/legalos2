# LEGAL OS — Lancement de la mission (poste Windows)

## 1. Prérequis à installer toi-même (droits administrateur)

L'agent n'a pas les droits administrateur et ne doit pas les avoir. Installe d'abord :

1. **Git for Windows**, puis autorise les chemins longs (PowerShell administrateur) :
   ```
   git config --system core.longpaths true
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```
2. **Node LTS** : indispensable avant le lancement, les hooks de la mission sont écrits en Node.
3. **Docker Desktop**, avec le backend WSL2.
4. **Outils de compilation C++ de Visual Studio** (charge de travail « Développement Desktop en C++ ») : requis par Rust et Tauri sous Windows. WebView2 est déjà présent sur Windows 11.
5. **rustup** (toolchain stable MSVC).
6. **GitHub CLI** (`gh`), puis `gh auth login`, et un dépôt privé `legal-os` : nécessaire pour la CI macOS (scénario S14b).

## 2. Réglages du poste

- **Antivirus** : Microsoft Defender ralentit fortement les compilations Rust. Sous Windows 11, place le dépôt sur un **Dev Drive**. Sinon, ajoute des exclusions pour le dossier du dépôt, `%USERPROFILE%\.cargo`, `%USERPROFILE%\.rustup` et le magasin pnpm.
- **Mémoire de Docker** : plafonne la machine virtuelle WSL2 pour laisser de la place aux compilations. Crée `%USERPROFILE%\.wslconfig` :
  ```
  [wsl2]
  memory=12GB
  swap=8GB
  ```
  puis `wsl --shutdown` et redémarre Docker Desktop.
- **Disque** : prévois au moins 150 Go libres sur le SSD (chaque worktree a son propre répertoire de compilation).
- **Veille** : empêche la mise en veille pendant la mission (`powercfg /change standby-timeout-ac 0`, à rétablir ensuite) et évite un redémarrage automatique de Windows Update pendant cette période.

## 3. Installation du kit

1. Copie le contenu du kit dans le dossier du dépôt (y compris les dossiers cachés `.cursor` et `.mission`), puis :
   ```
   git init
   git add -A
   git commit -m "Kit de mission"
   git remote add origin <adresse du dépôt GitHub>
   git push -u origin main
   ```
2. Ouvre le dossier dans Cursor et accepte de lui **faire confiance** (sinon les hooks du projet ne s'exécutent pas).
3. Vérifie dans **Customize → Hooks** que les trois hooks apparaissent. En cas d'erreur, consulte le canal de sortie « Hooks ».
4. Vérifie dans **Customize → Rules** que les 13 règles apparaissent : `00-mission` en application permanente, `60-juridique` en application « intelligente » (sur description), toutes les autres en application sur fichiers.
5. Dans les réglages de l'agent, autorise l'exécution automatique des commandes : `garde-commandes.mjs` bloque les commandes destructrices.
6. Fixe un **plafond de dépenses** dans ton compte Cursor.

## 4. Lancement

Ouvre un agent (modèle le plus capable disponible) et colle le prompt de lancement.

## 5. Pendant la mission

- Suivi : `PLAN.md` (jalons), `JOURNAL.md` (décisions et preuves), `BLOCAGES.md` (ce qui t'est demandé).
- Arrêt propre : `New-Item .mission\STOP`. Reprise : supprime le fichier et colle le prompt de reprise.
- Le hook relance l'agent jusqu'à 50 fois par conversation. Au-delà, ou si tu fermes Cursor, colle le prompt de reprise dans un nouvel agent : tout l'état est sur disque.

## 6. Ce qui t'attend

- `docs/hypotheses-delais.md` et `docs/hypotheses-facturation.md` : règles juridiques à valider.
- `BLOCAGES.md` : comptes et accès à fournir (Apple Developer, SUPER PDP, boîtes mail réelles, éventuelles actions administrateur).
- `RAPPORT.md` à la fin, avec la liste des vérifications à faire à la main sur un Mac. Relance toi-même `cargo xtask recette` avant de le croire.
