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

## 2. Principes communs

1. **Cabinet** : toute ligne synchronisée appartient au `cabinet_id` du JWT.
2. **Dossiers** : un dossier **restreint** n’est répliqué que vers les utilisateurs explicitement autorisés (table d’association `dossier_acces`, à créer côté serveur). Les autres postes **n’ont pas la ligne en SQLite** (S5).
3. **Mail — comptes** : compte nominatif → uniquement le titulaire ; boîte partagée → membres de la boîte (tables `mail_comptes`, `mail_compte_membres` — structure ci-dessous, implémentation serveur ultérieure).
4. **Mail — messages** : un message non classé suit les règles du compte ; une fois classé dans un dossier, il suit les **mêmes filtres que ce dossier** (y compris restriction).
5. **Écritures** : le poste enqueue via PowerSync ; l’API valide droits et cohérence avant Postgres (§ 3.4).

---

## 3. Tables miroir (phase contrats — stub)

Alignées sur le schéma client minimal. Les migrations Postgres et les vues PowerSync seront tenues en sync par un test de parité (jalon instance).

| Table client | Rôle |
|--------------|------|
| `users` | Collaborateurs du cabinet visibles pour l’annuaire local |
| `postes` | Postes enregistrés (état, révocation) |
| `dossiers` | Métadonnées dossier (dont chemise, flag restreint) |

Tables mail **documentées** pour les règles, pas encore dans `AppSchema` :

| Table (future) | Rôle |
|----------------|------|
| `mail_comptes` | Comptes IMAP / boîtes partagées |
| `mail_compte_membres` | Membres d’une boîte partagée |
| `mail_messages` | En-têtes synchronisés (corps selon politique de rétention) |
| `mail_dossier_liaisons` | Classement message → dossier |

---

## 4. Règles par bucket (YAML indicatif)

Syntaxe PowerSync Sync Rules ; à déployer dans `instance/powersync/` une fois l’instance en place. Les noms de paramètres (`request.user_id()`, etc.) suivent la doc PowerSync Open Edition.

### 4.1 `users`

```yaml
bucket_definitions:
  cabinet_users:
    parameters:
      - SELECT request.cabinet_id() AS cabinet_id
    data:
      - SELECT id, cabinet_id, display_name, email, role, created_at, updated_at
        FROM users
        WHERE cabinet_id = bucket.cabinet_id
```

### 4.2 `postes`

```yaml
  cabinet_postes:
    parameters:
      - SELECT request.cabinet_id() AS cabinet_id
    data:
      - SELECT id, cabinet_id, user_id, device_label, registered_at, revoked_at
        FROM postes
        WHERE cabinet_id = bucket.cabinet_id
```

### 4.3 `dossiers` (publics + restreints autorisés)

PowerSync 1.26.1 n'accepte ni jointure ni sous-requête dans une requête de données, ni conversion dans une requête de paramètres. Le fichier déployé `instance/powersync/sync-rules.yaml` sépare donc deux seaux : les dossiers `visibilite = 'public'`, et les dossiers restreints dont l'identifiant figure dans `dossier_acces` pour `request.user_id()`.

**Invariant S5 :** pour un collaborateur non listé dans `dossier_acces`, la requête ne retourne aucune ligne ; la table locale `dossiers` ne contient pas l’id.

### 4.4 Mail (structure — activation ultérieure)

**Comptes nominatifs :**

```yaml
  mail_comptes_nominatifs:
    parameters:
      - SELECT request.user_id() AS user_id
    data:
      - SELECT c.id, c.cabinet_id, c.adresse, c.type, c.titulaire_user_id
        FROM mail_comptes c
        WHERE c.type = 'nominatif' AND c.titulaire_user_id = bucket.user_id
```

**Boîtes partagées :**

```yaml
  mail_comptes_partages:
    parameters:
      - SELECT request.user_id() AS user_id
    data:
      - SELECT c.id, c.cabinet_id, c.adresse, c.type, c.titulaire_user_id
        FROM mail_comptes c
        INNER JOIN mail_compte_membres m ON m.compte_id = c.id
        WHERE c.type = 'partage' AND m.user_id = bucket.user_id
```

**Messages (non classés — compte accessible) :**

```yaml
  mail_messages_par_compte:
    parameters:
      - SELECT request.user_id() AS user_id
    data:
      - SELECT msg.id, msg.compte_id, msg.folder, msg.date_envoi, msg.sujet,
               msg.dossier_id, msg.snippet
        FROM mail_messages msg
        INNER JOIN mail_comptes c ON c.id = msg.compte_id
        WHERE msg.dossier_id IS NULL
          AND (
            (c.type = 'nominatif' AND c.titulaire_user_id = bucket.user_id)
            OR EXISTS (
              SELECT 1 FROM mail_compte_membres m
              WHERE m.compte_id = c.id AND m.user_id = bucket.user_id
            )
          )
```

**Messages classés — droits dossier :**

```yaml
  mail_messages_classes:
    parameters:
      - SELECT request.cabinet_id() AS cabinet_id
      - SELECT request.user_id() AS user_id
    data:
      - SELECT msg.id, msg.compte_id, msg.folder, msg.date_envoi, msg.sujet,
               msg.dossier_id, msg.snippet
        FROM mail_messages msg
        INNER JOIN dossiers d ON d.id = msg.dossier_id
        WHERE d.cabinet_id = bucket.cabinet_id
          AND msg.dossier_id IS NOT NULL
          AND (
            d.restricted = 0
            OR EXISTS (
              SELECT 1 FROM dossier_acces a
              WHERE a.dossier_id = d.id AND a.user_id = bucket.user_id
            )
          )
```

---

## 5. Évolution et tests

- Toute modification de ce fichier ou des règles déployées exige un test d’intégration S5 (SQLite locale sur poste non autorisé).
- Le schéma client TypeScript reste la source des vues SQLite côté poste ; un test comparera colonnes et tables avec les migrations Postgres (instance-backend).

---

## 6. Décisions provisoires (phase 0)

| Sujet | Décision |
|-------|----------|
| Nom table accès dossier | `dossier_acces` (singulier métier, clé composite `dossier_id` + `user_id`) |
| Flag restreint | Colonne entière `restricted` (0 / 1) dans `dossiers` |
| Mail | Règles rédigées ici ; tables absentes du `AppSchema` minimal jusqu’au lot messagerie |
