# Conflits généralisés — contrat

Sources : cahier § 3.4 (« dernière écriture gagnante par champ par défaut, sauf données sensibles […] immuables une fois validées »), invariant n° 2 de l'ordre d'opération, consignes 1 et 2 de l'architecte du 26/09/2026 (`JOURNAL.md`). Critères du jalon : `PLAN.md`, « Conflits généralisés ». Les points marqués **à valider** sont des choix de l'état-major.

## 1. Champs modifiables depuis le poste

| Table | Champs modifiables | Révision | Immuable |
|---|---|---|---|
| `cabinets` | `nom`, `slug` | `revision` (existe) | — |
| `dossiers` | `nom`, `chemise`, `juridiction`, `numero_rg`, `type_dossier`, `etape` | `revision` (existe) | la référence, déjà figée par déclencheur |
| `parties` | `role`, `nom` | `revision` (existe) | — |
| `contacts` | `nom`, `siren`, `numero_tva`, `type_client` | `revision` | — |
| `agenda_elements` | `titre`, `debut`, `rappel_le` | `revision` | — |
| `temps_saisis` | `minutes`, `libelle`, `taux_centimes_heure` (`ht_centimes` recalculé par le serveur) | `revision` (à ajouter) | dès qu'un brouillon numéroté le référence (validé par l'architecte le 27/09/2026) |
| `brouillons_facture` | `libelle`, `taux_centimes_heure` (`ht_centimes` recalculé par le serveur) | `revision` (à ajouter) | dès que `numero` n'est plus nul |
| `taux_horaires` | `centimes_par_heure` | `revision` (à ajouter) | — |
| `intercalaires_personnalises` | `nom` | `revision` | — |

Restent hors de ce jalon : la visibilité d'un dossier (changement de droits, action serveur dédiée), les suppressions hors intercalaires personnalisés (toujours refusées ou explicites, voir § 5). Les intercalaires **standards** ne sont pas des lignes synchronisées et n'ont pas d'API de retrait.

## 2. Protocole

- Le poste qui modifie une ligne écrit, dans la même mise à jour locale, les champs changés et `revision_edition` = la révision de la ligne telle qu'il la voit. L'entrée de la file d'envoi porte donc la révision de base.
- Le connecteur envoie `PATCH /<ressource>/{id}` avec `{ base_revision, idempotence_cle, <champs modifiés> }`. Clé d'idempotence construite par le poste à partir de l'entrée de la file ; le serveur la préfixe par l'identifiant du poste (deux postes peuvent produire la même clé locale).
- Le serveur, dans une transaction, verrouille la ligne (`FOR UPDATE`), vérifie droits et immuabilité, puis pour chaque champ :
  - valeur identique à la valeur actuelle : rien à faire, rien au journal ;
  - sinon la valeur reçue est appliquée (dernière écriture gagnante), la révision de la ligne augmente, une entrée est écrite au journal avec la valeur remplacée ;
  - **conflit** : une entrée du journal existe pour ce champ avec `revision_appliquee > base_revision` et un poste différent (`poste_id IS DISTINCT FROM` le poste appelant). Une écriture séquentielle du même poste après reprise n'est donc pas un conflit (dette J3).
- `base_revision` postérieure à la révision serveur : 400.

## 3. Journal des modifications

- `journal_modifications.dossier_id` : nul pour les enregistrements du cabinet (`cabinets`, `contacts`, taux du cabinet) ; sinon le dossier de l'enregistrement (`dossiers.id`, `parties.dossier_id`, etc.).
- Trois flux PowerSync, à la place de la requête du journal dans `cabinet_global` :
  - `journal_cabinet` : `dossier_id IS NULL` et cabinet du jeton ;
  - `journal_publics` : jointure `dossiers` sur `dossier_id`, dossier public du cabinet du jeton ;
  - `journal_restreints` : jointure `dossier_acces` sur `dossier_id`, utilisateur du jeton.
- Bloquant : ces flux sont en place avant qu'une autre table que `cabinets` n'alimente le journal.
- Le journal ne contient que des valeurs de champs métier déjà visibles des mêmes utilisateurs ; les journaux techniques de l'API n'en reprennent jamais le contenu (identifiants seulement).

## 4. Signalement dans l'app

- Une entrée `conflit = true` qui concerne une ligne visible du poste est signalée à l'endroit où la ligne s'affiche, avec la valeur remplacée et la valeur retenue (même principe que le bandeau `conflit-sync` des Réglages).
- Les deux postes voient le signalement : celui dont la valeur a été remplacée et celui dont la valeur a gagné.

## 5. Refus du serveur

- Une modification refusée (donnée immuable, droits, validation, ressource absente) répond 400, 403, 404 ou 409 avec un message en français. Le connecteur consigne le refus dans une table locale non synchronisée, retire l'entrée de la file, et l'app affiche le message. Les écritures suivantes partent. L'état réel revient par la synchronisation suivante.
- Aucune perte silencieuse. Le connecteur traite explicitement `PUT`, `PATCH` et `DELETE`. Une modification d'un seul champ est envoyée. Une table inconnue est consignée comme un refus, sans bloquer la file. Retirer une entrée sans l'envoyer, ou bloquer la file parce qu'un champ accompagnateur manque, n'est pas admis.
- `dossiers.restreint` et `dossiers.visibilite` ont une seule source de vérité : `CHECK (restreint = (visibilite = 'restreint'))`. Une écriture incohérente est refusée.
- Les suppressions ne sont pas proposées dans l'interface. Si une entrée `DELETE` arrive dans la file, elle est traitée explicitement (refus consigné), pas écartée en silence.

## 6. Preuves attendues

Les commandes du jalon dans `PLAN.md` : `cargo test -p legalos-api --test conflits_integration`, `node tests/recette/s5-sync-streams.mjs`, `node tests/recette/conflits-poste-tauri.mjs` (un conflit par table sur deux postes Tauri avec une modification hors ligne, signalement, S5 sur un dossier restreint, fausse alerte J3), `node tests/recette/j3-poste-tauri.mjs`.
