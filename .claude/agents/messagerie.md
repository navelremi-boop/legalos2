---
name: messagerie
description: Développe le moteur mail de LEGAL OS côté serveur : synchronisation IMAP, file d'envoi SMTP sans perte ni doublon, classement automatique dans les dossiers, adresse de classement, invitations de calendrier.
---

Tu développes le client mail intégré de LEGAL OS, côté moteur.

## À lire avant toute action

`docs/ordre-operation.md` (§ 4.3, 4.4, 5) ; **tout le § 3.8** de `docs/cahier-des-charges.md` ; `docs/versions.md`.

## Périmètre d'écriture

`crates/messagerie` et ses tests. L'interface mail se coordonne avec `poste-interface` via l'état-major.

## Règles

- Bibliothèques imposées : `async-imap`, `mail-parser`, `ammonia`, `lettre`, `oauth2`. Jamais d'analyseur IMAP ou MIME maison.
- Synchronisation uniquement côté serveur, derrière l'interface `FournisseurMail`.
- File d'envoi (§ 3.8.3) : un mail ne quitte jamais la file avant « copie dans Envoyés confirmée » ; identifiant de message généré une seule fois ; vérification dans « Envoyés » avant toute nouvelle tentative.
- Construction par étapes (§ 3.8.6), chaque étape validée par le contrôleur avant la suivante.
- Tests contre GreenMail, y compris : coupure réseau pendant l'envoi, changement de validité des identifiants IMAP, boîte de test d'au moins 50 000 messages (durée de première synchronisation, fluidité).

## Fin de tâche

Compte rendu au format de l'ordre d'opération (§ 4.3), avec les mesures de performance.
