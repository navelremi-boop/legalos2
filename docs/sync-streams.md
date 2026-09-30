# Sync Streams PowerSync (LEGAL OS)

Document de contrat pour l’instance PowerSync (`instance/powersync/sync-config.yaml`, `config.edition: 3`) et le schéma client TypeScript (`apps/poste/src/sync/AppSchema.ts`). Les flux sont une **frontière de sécurité** (cahier § 3.1, § 3.4) : ce qui ne doit pas être sur un poste **n’y descend jamais**.

Référence produit : dossiers restreints (S5), boîtes mail nominatives et partagées (§ 3.1), mails classés soumis aux droits du dossier.

Service : `journeyapps/powersync-service:1.26.1` (voir `docs/versions.md`).

---

## 1. Contexte JWT

Chaque poste se connecte avec un jeton PowerSync court, émis par l’API après authentification (et 2FA si activée). Le JWT contient au minimum :

| Claim | Rôle |
|-------|------|
| `sub` | Identifiant utilisateur (`users.id`) — lu via `auth.user_id()` |
| `cabinet_id` | Cabinet courant — lu via `auth.parameter('cabinet_id')` |
| `poste_id` | Poste enregistré (révocation, audit) |

PowerSync évalue les flux avec ces claims. Toute requête de sync est filtrée **côté service**, pas dans l’UI.

---

## 2. Sync Streams (édition 3)

**Décision (architecte, 2026-09-26)** : migration de Sync Rules (legacy) vers **Sync Streams** (`config.edition: 3`).

Conséquences :

1. **JOIN** (max 2 tables par requête dans notre contrat), **sous-requêtes** et CTE sont supportés ([Writing Queries](https://docs.powersync.com/sync/streams/queries)).
2. Tous les flux déployés ont `auto_subscribe: true` : le poste reçoit immédiatement le sous-ensemble autorisé.
3. Les flux publics d'une table fille filtrent `visibilite = 'public'` et `cabinet_id` **sans jointure** : un seul bucket par cabinet. `journal_modifications` et `intercalaire_elements` portent ces colonnes, tenues par déclencheur.
4. Les flux restreints joignent `groupe_acces_membres` (`utilisateur_texte = auth.user_id()`). Un groupe est l'ensemble exact des utilisateurs autorisés d'un dossier ; deux dossiers au même ensemble partagent le groupe. Cela fait **un bucket par groupe**, pas par dossier. La colonne `groupe_acces` des filles est tenue par la base, jamais fournie par l'API.
5. Toute nouvelle table synchronisée : test **S5** (poste non autorisé → aucune ligne locale). Aucun flux ne crée un bucket par dossier (`JOIN dossiers` ou `JOIN dossier_acces` interdit).

Fichier déployé : `instance/powersync/sync-config.yaml`, monté via `sync_config.path` dans `instance/powersync/service.yaml`.

---

## 3. Principes communs

1. **Cabinet** : toute ligne synchronisée appartient au `cabinet_id` du JWT (`auth.parameter('cabinet_id')`).
2. **Dossiers** : un dossier **restreint** n’est répliqué que vers les utilisateurs explicitement autorisés (`dossier_acces.utilisateur_texte = auth.user_id()`). Les autres postes **n’ont pas la ligne en SQLite** (S5).
3. **Mail — comptes** (futur) : compte nominatif → uniquement le titulaire ; boîte partagée → membership ; JOIN ou sous-requête autorisés.
4. **Mail — messages classés** (futur) : filtrés comme le dossier (JOIN `dossiers` / `dossier_acces`).
5. **Écritures** : le poste enqueue via PowerSync ; l’API valide droits et cohérence avant Postgres (§ 3.4).

---

## 4. Tables miroir

| Table client | Rôle |
|--------------|------|
| `cabinets` | Flux `cabinet_global` — porte aussi `reference_modele` et `reference_remise_a_zero` (R0) ; pas les séquences ni les initiales |
| `journal_modifications` | Trois flux : `journal_cabinet` (`dossier_id` nul), `journal_publics`, `journal_restreints` |
| `dossiers` | Métadonnées dossier (chemise, `reference` nullable § 3.4, flag restreint) |
| `parties` | Parties du dossier |
| `documents` / `document_versions` / `repertoires` | Métadonnées et arborescence ; `visibilite` en SELECT, auth via dossier ; documents portent `repertoire_id` et `revision` ; versions portent `texte` (extrait) et `parent_numero` |
| `temps_saisis` / `brouillons_facture` / `taux_horaires` | J8 — flux publics / restreints (+ `taux_cabinet` sans dossier) |
| `intercalaires_personnalises` / `intercalaire_elements` | Intercalaires personnalisés (§ 7.4) — flux publics / restreints |
| `contacts` | Annuaire du cabinet (SIREN, n° TVA, type de client F8) — un flux, pas un seau par dossier |
| `agenda_elements` | Audiences, rendez-vous, tâches (§ 4.2 n° 4) — flux publics / restreints ; invitations mail au jalon J11 |
| `dossier_liens` | Dossiers liés, une ligne par sens — flux public (les deux dossiers publics) ou restreint |
| `users` / `postes` | (schéma client ; flux à ajouter si réplication) |

---

## 5. Flux déployés

Tous : `auto_subscribe: true`. Colonnes explicites (pas de `SELECT *` sur les tables métier), `cree_le::text` pour les timestamps.

| Flux | Filtre |
|------|--------|
| `cabinet_global` | `cabinets` seulement (dont `reference_modele`, `reference_remise_a_zero`) — plus de journal |
| `journal_cabinet` | `journal_modifications` où `dossier_id IS NULL` et cabinet du jeton |
| `journal_publics` | `journal_modifications` où `visibilite = 'public'`, `dossier_id` non nul, cabinet du jeton — sans jointure |
| `journal_restreints` | `journal_modifications` JOIN `groupe_acces_membres` (`auth.user_id()`) |
| `dossiers_publics` | `dossiers` où `visibilite = 'public'` et `cabinet_id` du JWT — SELECT inclut `reference`, `responsable_id`, `type_dossier`, `etape` |
| `dossiers_restreints` | `dossiers` JOIN `groupe_acces_membres` où `utilisateur_texte = auth.user_id()` — un bucket par groupe |
| `parties_publics` | `parties` où `visibilite = 'public'` et cabinet du jeton — pas de JOIN `dossiers` (un bucket par dossier, PSYNC_S2305) |
| `parties_restreints` | `parties` JOIN `groupe_acces_membres` (`auth.user_id()`) — historique des dossiers d'un contact, filtré par le groupe |
| `documents_publics` | `documents` où `visibilite = 'public'` et cabinet du jeton — SELECT inclut `repertoire_id`, `revision` |
| `documents_restreints` | `documents` JOIN `groupe_acces_membres` — **sans** filtre sur `documents.visibilite` |
| `document_versions_publics` | `document_versions` où `visibilite = 'public'` et cabinet du jeton — SELECT inclut `texte`, `parent_numero` |
| `document_versions_restreints` | idem JOIN `groupe_acces_membres` — **sans** filtre sur `document_versions.visibilite` |
| `repertoires_publics` | `repertoires` où `visibilite = 'public'` et cabinet du jeton |
| `repertoires_restreints` | `repertoires` JOIN `groupe_acces_membres` — **sans** filtre sur `repertoires.visibilite` |
| `temps_publics` / `brouillons_publics` / `taux_publics` | visibilité publique copiée et cabinet du jeton (`taux_publics` : `dossier_id` non nul) |
| `temps_restreints` / `brouillons_restreints` / `taux_restreints` | JOIN `groupe_acces_membres` (`auth.user_id()`) — **sans** filtre sur la `visibilite` fille |
| `taux_cabinet` | `taux_horaires` où `dossier_id IS NULL` et `cabinet_id` du JWT |
| `intercalaires_publics` | visibilité publique copiée et cabinet du jeton |
| `intercalaire_elements_publics` | `intercalaire_elements` où `visibilite = 'public'` et `cabinet_id` de la fille — sans jointure |
| `intercalaires_restreints` / `intercalaire_elements_restreints` | JOIN `groupe_acces_membres` (`auth.user_id()`) — **sans** filtre sur la `visibilite` fille |
| `contacts_cabinet` | annuaire du cabinet, y compris un contact né d'un dossier restreint (nom et SIREN visibles de tous, sans lien vers le dossier). L'historique (parties → dossiers) passe par `parties_restreints` |
| `dossier_liens_publics` | `dossier_liens` où `visibilite = 'public'` (les deux dossiers) et cabinet du jeton |
| `dossier_liens_restreints` | `dossier_liens` JOIN `groupe_acces_membres`, cible publique (`lie_restreint = false`) |
| `dossier_liens_restreints_croises` | les deux dossiers restreints : `groupe_acces` est l'intersection des deux ensembles, une jointure `groupe_acces_membres` |
| `agenda_publics` | `agenda_elements` où `visibilite = 'public'` et cabinet du jeton |
| `agenda_restreints` | `agenda_elements` JOIN `groupe_acces_membres` — **sans** filtre sur `agenda_elements.visibilite` |
| `messages_publics` | `messages` classés (`dossier_id` non nul) où `visibilite = 'public'` et cabinet du jeton — sans jointure ; `texte_brut` copié |
| `messages_restreints` | `messages` JOIN `groupe_acces_membres` (`auth.user_id()`) — un bucket par groupe, pas par dossier ; `texte_brut` copié |
| `messages_a_classer` | boîte de classement (`dossier_id` nul, `titulaire_id` nul), un bucket par cabinet |
| `messages_nominatifs` | messages du titulaire (`titulaire_id = auth.user_id()`), sans secret — un bucket par titulaire, pas par dossier |
| `comptes_nominatifs` | `comptes_mail` nominatif du titulaire (`titulaire_id = auth.user_id()`), sans `secret_ref` — un bucket par titulaire, pas par dossier |

**Invariant S5 :** pour un collaborateur non listé dans `dossier_acces`, aucune ligne du dossier restreint ni de ses enfants (`parties`, `repertoires`, `documents`, `document_versions`, `temps_saisis`, `brouillons_facture`, `taux_horaires`, `intercalaires_personnalises`, `intercalaire_elements`, `dossier_liens` ancrés sur ce dossier) dans la SQLite locale. L'annuaire `contacts` est celui du cabinet : il n'est pas un enfant de dossier. Preuve SQLite (fichier `legalos-powersync-*.db` du poste Tauri) : `tests/recette/j5-poste-tauri.mjs` ; couverture par flux : `tests/recette/s5-sqlite-par-flux.mjs` ; contrôle statique des flux : `tests/recette/s5-sync-streams.mjs`. Filtre JOIN Postgres (sans SQLite) : `tests/recette/s9-s5-temps.mjs`.

---

## 6. Évolution et tests

- Toute modification de ce fichier ou de `sync-config.yaml` exige un test d’intégration **S5** pour **chaque nouvelle table / flux**.
- Contrôle statique des flux : `node tests/recette/s5-sync-streams.mjs`.
- Couverture des preuves SQLite par famille de flux : `node tests/recette/s5-sqlite-par-flux.mjs`.
- Preuve SQLite bout-en-bout (poste Tauri collaborateur hors `dossier_acces`) : `node tests/recette/j5-poste-tauri.mjs`.
- Le schéma client TypeScript reste la source des vues SQLite côté poste ; un test compare colonnes et tables avec les migrations Postgres.

---

## 7. Décisions

| Sujet | Décision |
|-------|----------|
| Modèle sync | Sync Streams édition 3 (`sync-config.yaml`) |
| Sync Rules | Abandonnées ; fichier `sync-rules.yaml` retiré |
| JOIN | Autorisés (contrat : ≤ 2 tables par requête de flux) |
| Auth restreinte | `dossier_acces.utilisateur_texte = auth.user_id()` |
| Copie `visibilite` enfants | Conservée en base / SELECT ; non utilisée pour filtrer les flux restreints |
| Mail | Publics sans jointure, restreints par groupe, nominatif par titulaire ; pas de seau par dossier |
