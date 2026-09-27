# Hypothèses — dossiers

Le cahier § 3.4 impose la référence attribuée par le serveur (unicité, immutabilité, « Référence en attente » hors ligne). Le format est tranché par l'arbitrage R0 du 26/09/2026, reçu le 27/09/2026 (voir `JOURNAL.md`), complété le même jour pour le « / » et le constructeur visuel. R0-a à R0-g sont **arbitré**.

## R0 — Modèle de référence personnalisable (arbitré)

- Chaque cabinet choisit un **modèle** dans Réglages, sous forme de texte ou avec un constructeur visuel par blocs (Année, Numéro avec nombre de chiffres, Initiales, Texte), avec entre chaque bloc un séparateur au choix (« / », « - », « . », « _ », espace ou aucun) et un aperçu en direct ; les deux vues restent synchronisées.
- Le caractère « / » est du texte libre, sans limite de nombre ni de position. Exemples testés : `{AAAA}/{N:3}`, `RN/{AA}/{N:4}`, `{N}/{AAAA}`, et un modèle sans séparateur.
- La référence est affichée, stockée, imprimée et recherchée (objet des mails, recherche, palette) **avec ses « / » intacts**.
- Formes normalisées, pour deux usages techniques seulement :
  - adresse de classement : « / » et tout caractère mal accepté par les messageries remplacés par « - » ;
  - noms de fichiers et de dossiers à l'export : caractères interdits par Windows (`/ \ : * ? " < > |`) remplacés par « - ».
  La reconnaissance d'un mail accepte la forme d'origine comme la forme normalisée.

### R0-a — Jetons du modèle (arbitré)

- `{AAAA}` : année civile sur quatre chiffres (fuseau Europe/Paris) ; `{AA}` : deux derniers chiffres.
- `{N}` : numéro sans complément ; `{N:k}` : numéro complété à gauche par des zéros sur k chiffres, sans troncature au-delà (`{N:3}` donne `042`, puis `1000`).
- `{INI}` : initiales de l'avocat responsable (voir R0-b). Le texte d'origine de l'arbitrage écrivait `{INIT}` ; le jeton retenu est `{INI}`.
- Tout autre caractère est du texte libre.
- Le modèle contient toujours un jeton de numéro, une seule fois. Avec la remise à zéro annuelle (R0-d), il contient aussi un jeton d'année : sans lui, deux années produiraient la même référence.
- Le numéro reste unique et continu pour tout le cabinet, même quand le modèle contient les initiales.
- Modèle par défaut : `{AAAA}-{N:3}` (ex. `2026-042`), le format appliqué avant l'arbitrage. Préfixe d'interface « Dossier » hors chaîne stockée.

### R0-b — Initiales (arbitré)

Les initiales sont celles de l'avocat responsable du dossier, pas celles du créateur. `dossiers.responsable_id` désigne un utilisateur du cabinet. Il est choisi à la création et vaut le créateur si aucun responsable n'est indiqué. Il est envoyé avec la création et synchronisé. Les initiales sont figées au moment où le serveur attribue la référence : un changement ultérieur de responsable ne réécrit pas la référence.

Source des initiales du responsable : celles enregistrées pour l'utilisateur (une à quatre majuscules) ; à défaut, celles tirées de son adresse : première lettre, sans accent, de chaque segment de la partie avant « @ » (segments séparés par « . », « - », « _ » ou « + »), quatre au plus, « X » si aucune lettre.

### R0-c — Changement de modèle (arbitré)

Un nouveau modèle s'applique aux dossiers créés ensuite. Une référence attribuée ne change jamais, et la séquence de l'année continue sans remise à zéro. Une séquence ne se corrige pas après coup.

### R0-d — Politiques de remise à zéro (arbitré)

- `annuelle` (par défaut, cahier § 3.4) : le numéro repart à 1 au 1er janvier, heure de Paris. Le modèle doit contenir un jeton d'année.
- `jamais` : le numéro continue d'une année sur l'autre. Le jeton d'année est alors facultatif.
- La politique se choisit dans Réglages, à côté du modèle, et s'applique aux dossiers créés ensuite.

### R0-e — Numéro de départ (arbitré)

- Numéro attribué au prochain dossier de la période en cours (l'année avec `annuelle`, toute la vie du cabinet avec `jamais`) : un cabinet qui arrive d'un autre logiciel continue sa numérotation.
- Entier supérieur ou égal à 1, et strictement supérieur au dernier numéro déjà attribué dans la période : sinon, le serveur pourrait redonner une référence existante.
- Avec `annuelle`, il ne vaut que pour l'année en cours ; l'année suivante repart à 1.
- Sans numéro de départ, un changement de modèle ou de politique ne fait jamais reculer la numérotation. Avec `annuelle`, le prochain numéro est le plus grand entre celui de la séquence de l'année et le dernier numéro attribué dans l'année plus un. Avec `jamais`, le compteur continu prend aussi part au maximum : au premier passage à `jamais`, le compte de l'année en cours se poursuit.

### R0-f — Refus (arbitré)

- **Modèle invalide**, refusé par l'API (400, message en français) et signalé dans Réglages avant l'enregistrement : modèle vide ; jeton inconnu ou accolade non fermée ; aucun jeton de numéro, ou plusieurs ; `{N:k}` hors de 1 à 9 ; aucun jeton d'année avec `annuelle` ; caractère de contrôle ; plus de 40 caractères.
- **Changement qui redonnerait une référence existante**, refusé par l'API (409, message en français) : avant d'enregistrer un nouveau modèle, une nouvelle politique ou un nouveau numéro de départ, le serveur vérifie qu'aucune référence déjà attribuée dans le cabinet ne pourrait être produite de nouveau (même année, numéro encore atteignable), à l'identique ou sous la même forme de classement, sans tenir compte des majuscules : l'adresse de classement doit désigner un seul dossier. Quand un numéro de départ plus élevé rendrait le changement acceptable, la réponse indique ce numéro minimal. Réglages l'affiche. La vérification a lieu dans la transaction qui enregistre le changement ; deux index d'unicité, sur la référence et sur sa forme de classement en majuscules, restent le dernier rempart. La forme calculée par le déclencheur de la migration 017 est la même que `forme_classement` du domaine, cas par cas sur `crates/domaine/tests/reference-vecteurs.json`.

### R0-g — Qui peut modifier le modèle (arbitré)

Tout utilisateur du cabinet peut lire et modifier le modèle, la politique et le numéro de départ : la V1 ne définit aucun rôle. Chaque changement de modèle, de politique ou de numéro de départ est journalisé avec son auteur. Les initiales d'une référence sont celles de l'avocat responsable (R0-b).
