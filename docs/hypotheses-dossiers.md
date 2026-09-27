# Hypothèses — dossiers

Le cahier § 3.4 impose la référence attribuée par le serveur (année + numéro continu, remise à zéro chaque année, unicité, immutabilité, « Référence en attente » hors ligne). Le format d'affichage n'était pas figé au-delà de l'exemple « 2026-042 » : il est tranché par l'arbitrage R0 du commandement (référence personnalisable), complété le 27/09/2026 (voir `JOURNAL.md`). Les points marqués **à valider** restent des choix de l'état-major.

## R0 — Modèle de référence personnalisable (arbitré)

- Chaque cabinet choisit un **modèle** dans Réglages, sous forme de texte ou avec un constructeur visuel par blocs (Année, Numéro avec nombre de chiffres, Initiales, Texte), avec entre chaque bloc un séparateur au choix (« / », « - », « . », « _ », espace ou aucun) et un aperçu en direct ; les deux vues restent synchronisées.
- Le caractère « / » est du texte libre, sans limite de nombre ni de position. Exemples testés : `{AAAA}/{N:3}`, `RN/{AA}/{N:4}`, `{N}/{AAAA}`, et un modèle sans séparateur.
- La référence est affichée, stockée, imprimée et recherchée (objet des mails, recherche, palette) **avec ses « / » intacts**.
- Formes normalisées, pour deux usages techniques seulement :
  - adresse de classement : « / » et tout caractère mal accepté par les messageries remplacés par « - » ;
  - noms de fichiers et de dossiers à l'export : caractères interdits par Windows (`/ \ : * ? " < > |`) remplacés par « - ».
  La reconnaissance d'un mail accepte la forme d'origine comme la forme normalisée.

### R0-a — Jetons du modèle (choix de l'état-major, à valider)

- `{AAAA}` : année civile sur quatre chiffres (fuseau Europe/Paris) ; `{AA}` : deux derniers chiffres.
- `{N}` : numéro sans complément ; `{N:k}` : numéro complété à gauche par des zéros sur k chiffres, sans troncature au-delà (`{N:3}` donne `042`, puis `1000`).
- `{INI}` : initiales (voir R0-b).
- Tout autre caractère est du texte libre.
- Le modèle contient toujours un jeton de numéro, une seule fois. Avec la remise à zéro annuelle (R0-d), il contient aussi un jeton d'année : sans lui, deux années produiraient la même référence.
- Le numéro reste unique et continu pour tout le cabinet, même quand le modèle contient les initiales.
- Modèle par défaut : `{AAAA}-{N:3}` (ex. `2026-042`), le format appliqué avant l'arbitrage. Préfixe d'interface « Dossier » hors chaîne stockée.

### R0-b — Initiales (à valider)

Les initiales sont celles de l'utilisateur qui crée le dossier : le modèle de données n'a pas encore d'avocat responsable du dossier. Si un avocat responsable est ajouté, ses initiales remplaceront celles du créateur pour les dossiers créés ensuite.

Source : les initiales enregistrées pour l'utilisateur (une à quatre majuscules) ; à défaut, celles tirées de son adresse : première lettre, sans accent, de chaque segment de la partie avant « @ » (segments séparés par « . », « - », « _ » ou « + »), quatre au plus, « X » si aucune lettre. La base ne connaît pas encore le nom des utilisateurs.

### R0-c — Changement de modèle (à valider)

Un nouveau modèle s'applique aux dossiers créés ensuite. Une référence attribuée ne change jamais, et la séquence de l'année continue sans remise à zéro. À faire valider avant le premier dossier réel (même principe que la numérotation des factures, cahier § 6 « Points ouverts » : une séquence ne se corrige pas après coup).

Le texte de l'arbitrage R0 n'a pas été reçu (`BLOCAGES.md`, B11). R0-d à R0-f interprètent les termes de la consigne du 27/09/2026 (« politiques de remise à zéro », « numéro de départ », « refus des modèles invalides et des changements qui redonneraient une référence existante ») et sont **à valider**.

### R0-d — Politiques de remise à zéro (à valider)

- `annuelle` (par défaut, cahier § 3.4) : le numéro repart à 1 au 1er janvier, heure de Paris. Le modèle doit contenir un jeton d'année.
- `jamais` : le numéro continue d'une année sur l'autre. Le jeton d'année est alors facultatif.
- La politique se choisit dans Réglages, à côté du modèle, et s'applique aux dossiers créés ensuite.

### R0-e — Numéro de départ (à valider)

- Numéro attribué au prochain dossier de la période en cours (l'année avec `annuelle`, toute la vie du cabinet avec `jamais`) : un cabinet qui arrive d'un autre logiciel continue sa numérotation.
- Entier supérieur ou égal à 1, et strictement supérieur au dernier numéro déjà attribué dans la période : sinon, le serveur pourrait redonner une référence existante.
- Avec `annuelle`, il ne vaut que pour l'année en cours ; l'année suivante repart à 1.
- Sans numéro de départ, un changement de modèle ou de politique ne fait jamais reculer la numérotation. Avec `annuelle`, le prochain numéro est le plus grand entre celui de la séquence de l'année et le dernier numéro attribué dans l'année plus un. Avec `jamais`, le compteur continu prend aussi part au maximum : au premier passage à `jamais`, le compte de l'année en cours se poursuit.

### R0-f — Refus (à valider)

- **Modèle invalide**, refusé par l'API (400, message en français) et signalé dans Réglages avant l'enregistrement : modèle vide ; jeton inconnu ou accolade non fermée ; aucun jeton de numéro, ou plusieurs ; `{N:k}` hors de 1 à 9 ; aucun jeton d'année avec `annuelle` ; caractère de contrôle ; plus de 40 caractères.
- **Changement qui redonnerait une référence existante**, refusé par l'API (409, message en français) : avant d'enregistrer un nouveau modèle, une nouvelle politique ou un nouveau numéro de départ, le serveur vérifie qu'aucune référence déjà attribuée dans le cabinet ne pourrait être produite de nouveau (même année, numéro encore atteignable), à l'identique ou sous la même forme de classement, sans tenir compte des majuscules : l'adresse de classement doit désigner un seul dossier. La vérification a lieu dans la transaction qui enregistre le changement ; deux index d'unicité, sur la référence et sur sa forme de classement en majuscules, restent le dernier rempart.

### R0-g — Qui peut modifier le modèle (à valider)

Tout utilisateur du cabinet peut lire et modifier le modèle, la politique et le numéro de départ : le cahier ne définit aucun rôle. Les initiales restent celles de l'utilisateur qui crée le dossier (R0-b).
