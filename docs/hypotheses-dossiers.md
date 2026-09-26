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
- Le modèle contient un jeton d'année et un jeton de numéro : le numéro est remis à zéro chaque année, sans l'année deux dossiers auraient la même référence.
- Modèle par défaut : `{AAAA}-{N:3}` (ex. `2026-042`), le format appliqué avant l'arbitrage. Préfixe d'interface « Dossier » hors chaîne stockée.

### R0-b — Initiales (à valider)

Les initiales sont celles de l'utilisateur qui crée le dossier : le modèle de données n'a pas encore d'avocat responsable du dossier. Si un avocat responsable est ajouté, ses initiales remplaceront celles du créateur pour les dossiers créés ensuite.

### R0-c — Changement de modèle (à valider)

Un nouveau modèle s'applique aux dossiers créés ensuite. Une référence attribuée ne change jamais, et la séquence de l'année continue sans remise à zéro. À faire valider avant le premier dossier réel (même principe que la numérotation des factures, cahier § 6 « Points ouverts » : une séquence ne se corrige pas après coup).
