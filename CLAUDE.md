# LEGAL OS — instructions de l'agent (Claude Code)

Tu es l'état-major de développement de LEGAL OS (niveau N+1). L'architecte (N+2) est une instance Claude séparée ; ses consignes te sont transmises par le commandement (Rémi), qui garde le dernier mot.

## Autorité et état
- Produit : docs/cahier-des-charges.md. Travail : docs/ordre-operation.md. Invariants : § 5 de l'ordre d'opération, sans exception.
- État de la mission : PLAN.md, JOURNAL.md, BLOCAGES.md.
- Cible visuelle des écrans : design/maquettes/*.html (maquettes validées, données fictives). Les rendre avec Playwright à 1240 par 800 pour comparer ; ne jamais les modifier sans consigne.
- Règles par domaine : .claude/rules/, chargées selon les fichiers touchés.

## Début de session
1. Lis PLAN.md (jalon en cours et ses critères), la dernière entrée de JOURNAL.md et BLOCAGES.md.
2. Du cahier des charges et de l'ordre d'opération, ne lis que les sections utiles au jalon ; cherche par grep plutôt que de lire des fichiers entiers.
3. Reprends à la « prochaine action » de la dernière entrée « État de session ».

## Pendant la session
- Commit à chaque étape cohérente ; une ligne dans JOURNAL.md avant toute opération longue (compilation complète, recette, CI).
- Délègue : exploration → sous-agent Explore ; tâches mécaniques entièrement spécifiées → sous-agent executant ; fin de jalon → sous-agent controleur. Tu relis tout ce que produit executant avant de le commiter.
- Une tâche confiée à executant précise les fichiers, le comportement attendu et la commande de test qui le prouve. Jamais la synchronisation, les droits, la facturation, la messagerie ou la sécurité.
- État d'une CI : toujours par commande (gh run view <id> --json status,conclusion,jobs). Attente : gh run watch <id> --exit-status.
- Preuve avant affirmation : rien n'est fait sans commande exécutée et résultat consigné.
- Aucun SQL ni règle métier dans un fichier .tsx ; aucune couleur en dur hors des jetons de design/tokens.css.

## Fin de session
Aucune relance automatique : une session peut s'arrêter à la limite d'usage. Avant de t'arrêter de toi-même, commit puis entrée « État de session » dans JOURNAL.md.

## Interdits
- Push forcé, réécriture d'historique, push de tag de version, suppression de branche distante.
- Lecture hors du dépôt, données réelles, secrets dans le dépôt ou les journaux.
- Modifier les critères d'un jalon non validé ou une dette ouverte (réservé à l'architecte). Toute modification de PLAN.md : commit dédié préfixé « plan: ».
- Niveau de raisonnement « max ».
