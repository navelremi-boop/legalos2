# Règles de synchronisation PowerSync (LEGAL OS)

Document de contrat pour l’instance PowerSync et le schéma client TypeScript (`apps/poste/src/sync/AppSchema.ts`). Les règles sont une **frontière de sécurité** (cahier § 3.1, § 3.4) : ce qui ne doit pas être sur un poste **n’y descend jamais**.

Référence produit : dossiers restreints (S5), boîtes mail nominatives et partagées (§ 3.1), mails classés soumis aux droits du dossier.

---

## 1. Contexte JWT

Chaque poste se connecte avec un jeton PowerSync court, émis par l’API après authentification (et 2FA si activée). Le JWT contient au minimum :

| Claim | Rôle |
|-------|------|
| `sub` | Identifiant utilisateur (`users.id`) |
| `cabinet_id` | Cabinet courant |
| `poste_id` | Poste enregistré (révocation, audit) |

PowerSync évalue les règles avec ces claims. Toute requête de sync est filtrée **côté service**, pas dans l’UI.

---

## 2. Limite Sync Rules (1.26.1) et décision

**Constat (doc officielle, 2026-09-26)** : le service déployé `journeyapps/powersync-service:1.26.1` utilise les **Sync Rules** (legacy). Dans ce mode : **pas de JOIN**, pas de sous-requête dans une requête de données, pas de conversion dans une requête de paramètres ([Supported SQL — Sync Rules](https://docs.powersync.com/sync/rules/supported-sql)).

**Sync Streams** (`config.edition: 3`) lèvent cette limite (JOIN internes, CTE, sous-requêtes). Disponibles sur le service récent ; **migration non engagée**. Tant que nous restons en Sync Rules, toute relation dossier → enfants passe par **dénormalisation**.

**Règle d’architecture (architecte, 2026-09-26)** :

1. Toute table rattachée à un dossier (`documents`, `document_versions`, `temps_saisis`, `brouillons_facture`, factures / lignes, intercalaires, liaisons mail, etc.) porte **`dossier_id`** et une **copie de la visibilité** du dossier (`visibilite` / équivalent).
2. L’API met à jour cette copie **dans la même transaction** que tout changement de visibilité du dossier.
3. **Dossiers restreints** : requête de **paramètres** sur `dossier_acces` qui renvoie les `dossier_id` autorisés pour `request.user_id()`, puis requêtes de **données** filtrées par `dossier_id IN (…)`, sans JOIN.
4. Toute nouvelle table synchronisée : test **S5** (poste non autorisé → aucune ligne locale).

---

## 3. Principes communs

1. **Cabinet** : toute ligne synchronisée appartient au `cabinet_id` du JWT.
2. **Dossiers** : un dossier **restreint** n’est répliqué que vers les utilisateurs explicitement autorisés (`dossier_acces`). Les autres postes **n’ont pas la ligne en SQLite** (S5).
3. **Mail — comptes** : compte nominatif → uniquement le titulaire ; boîte partagée → via table de membership dénormalisée ou seau paramètres (pas de JOIN sur `mail_comptes` × `mail_compte_membres` dans une requête de données).
4. **Mail — messages classés** : filtrés comme le dossier via `dossier_id` + copie de visibilité (pas de JOIN sur `dossiers`).
5. **Écritures** : le poste enqueue via PowerSync ; l’API valide droits et cohérence avant Postgres (§ 3.4).

---

## 4. Tables miroir

| Table client | Rôle |
|--------------|------|
| `users` | Collaborateurs du cabinet visibles pour l’annuaire local |
| `postes` | Postes enregistrés (état, révocation) |
| `dossiers` | Métadonnées dossier (dont chemise, flag / visibilité) |
| `documents` / `document_versions` | Métadonnées ; `dossier_id` + copie visibilité |
| `temps_saisis` / `brouillons_facture` | (J8) sync ; `dossier_id` + copie visibilité ; numéro nul jusqu’à validation |

Tables mail **documentées** pour les règles, pas encore toutes dans `AppSchema` :

| Table (future) | Rôle |
|----------------|------|
| `mail_comptes` | Comptes IMAP / boîtes partagées |
| `mail_compte_membres` | Membres d’une boîte partagée (sert aux **paramètres**, pas en JOIN de données) |
| `mail_messages` | En-têtes ; si classé : `dossier_id` + copie visibilité |
| `mail_dossier_liaisons` | Classement message → dossier |

---

## 5. Règles par bucket (YAML indicatif, Sync Rules)

Syntaxe Sync Rules ; déployée dans `instance/powersync/sync-rules.yaml`.

### 5.1 `users` / `postes`

Filtrage par `cabinet_id` (voir fichier déployé).

### 5.2 `dossiers` (publics + restreints autorisés)

Deux seaux sans JOIN : dossiers `visibilite = 'public'` (ou `restricted = 0`) ; dossiers restreints dont l’id figure dans les paramètres issus de `dossier_acces` pour `request.user_id()`.

**Invariant S5 :** pour un collaborateur non listé dans `dossier_acces`, aucune ligne du dossier restreint ni de ses enfants.

### 5.3 Enfants de dossier (documents, temps, brouillons, …)

```yaml
  # Paramètres : ids de dossiers accessibles (publics + restreints autorisés)
  # (détail exact dans instance/powersync/sync-rules.yaml)
  documents_par_dossier:
    parameters:
      - SELECT dossier_id FROM dossier_acces WHERE user_id = request.user_id()
      # + seau / liste des dossiers publics du cabinet
    data:
      - SELECT id, cabinet_id, dossier_id, visibilite, ...
        FROM documents
        WHERE dossier_id = bucket.dossier_id
```

La colonne `visibilite` sur `documents` est une **copie** ; elle ne remplace pas le filtre par `dossier_id`, elle permet contrôles locaux et audits.

### 5.4 Mail — **sans JOIN** (exemples précédents avec JOIN non déployables)

**Comptes nominatifs** : filtre direct `titulaire_user_id = request.user_id()`.

**Boîtes partagées** : paramètres = `compte_id` depuis `mail_compte_membres` où `user_id = request.user_id()` ; données = `mail_comptes` où `id = bucket.compte_id`.

**Messages classés** : comme les documents — `dossier_id` + paramètres d’accès dossier ; **pas** de `INNER JOIN dossiers`.

---

## 6. Évolution et tests

- Toute modification de ce fichier ou des règles déployées exige un test d’intégration **S5** pour **chaque nouvelle table**.
- Le schéma client TypeScript reste la source des vues SQLite côté poste ; un test compare colonnes et tables avec les migrations Postgres.

---

## 7. Décisions

| Sujet | Décision |
|-------|----------|
| Nom table accès dossier | `dossier_acces` (clé composite `dossier_id` + `user_id`) |
| Visibilité enfants | Copie sur chaque ligne enfant, transaction API avec le dossier |
| JOIN Sync Rules | Interdits ; dénormalisation obligatoire |
| Sync Streams | Documentés ; migration hors périmètre tant que non décidé dans `BLOCAGES.md` |
| Mail | Règles sans JOIN ; tables absentes du `AppSchema` minimal jusqu’au lot messagerie |
