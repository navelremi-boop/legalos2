# Connexion OAuth des boîtes (Microsoft 365, Gmail)

Critère « v-OAuth » de J11 (consigne de l'architecte du 20/10/2026). Ce document dit comment l'instance parle aux fournisseurs, comment l'enregistrer chez eux, et ce qui n'est pas encore éprouvé. Les faits sur les fournisseurs ont été relus dans leur documentation le 2026-10-20 ; les adresses sont en bas de page.

## Principe

1. Le poste demande à l'instance l'adresse d'autorisation : `POST /messagerie/oauth/debut` (il joint l'adresse de bouclage qu'il écoute, `http://127.0.0.1:<port>/`).
2. Le poste ouvre cette adresse dans le **navigateur du système** (jamais dans la fenêtre de l'application), l'utilisateur s'authentifie chez le fournisseur et consent.
3. Le fournisseur redirige le navigateur vers `http://127.0.0.1:<port>/?code=…&state=…` : le poste, qui écoute ce port, capte le code (RFC 8252, § 7.3).
4. Le poste transmet le code à l'instance : `POST /messagerie/oauth/echange`. L'instance vérifie le `state`, échange le code avec le **vérificateur PKCE qu'elle seule détient** (RFC 7636, S256), puis **chiffre** et stocke les jetons.

Garanties, toutes prouvées par `node tests/recette/oauth-messagerie.mjs` :

- aucun jeton, code ni vérificateur dans une réponse HTTP, dans les règles de synchronisation, sur le poste ou dans les journaux de l'API ;
- le `state` est à usage unique (consommé même si l'échange échoue), vit 10 minutes, est lié à l'utilisateur et au compte ; l'état d'un autre utilisateur est introuvable (404) ; chaque utilisateur garde au plus 5 demandes en attente ;
- la redirection doit être exactement `http://127.0.0.1:<port ≥ 1024>/` (ni `localhost`, ni `https`, ni autre chemin, ni autre hôte) ;
- le jeton d'accès est renouvelé par l'instance avant chaque connexion s'il expire dans moins de deux minutes, **sous un verrou par boîte** : le fournisseur peut tourner le jeton de rafraîchissement à chaque renouvellement (Microsoft le dit : « l'ancien est à jeter »), deux renouvellements concurrents s'invalideraient ;
- le fournisseur refuse le jeton de rafraîchissement (`invalid_grant` : révoqué, expiré, mot de passe changé) : la boîte passe à « identifiants refusés », les tentatives s'arrêtent, l'écran de santé propose **Reconnecter** ; l'envoi depuis cette boîte est refusé (409) jusqu'à la reconnexion. Une panne passagère du fournisseur, elle, ne marque rien et se retente.

Le fournisseur « simulateur », qui sert aux recettes, **n'existe qu'en développement** (`LEGALOS_MODE=development`) : une instance de production le refuse comme tout fournisseur inconnu, et ses adresses sont limitées à `127.0.0.1` et `host.docker.internal`.

## Ce que l'instance utilise

| | Microsoft 365 | Gmail |
|---|---|---|
| Autorisation | `https://login.microsoftonline.com/{locataire}/oauth2/v2.0/authorize` | `https://accounts.google.com/o/oauth2/v2/auth` |
| Jeton | `https://login.microsoftonline.com/{locataire}/oauth2/v2.0/token` | `https://oauth2.googleapis.com/token` |
| Portées | `https://outlook.office.com/IMAP.AccessAsUser.All`, `https://outlook.office.com/SMTP.Send`, `offline_access` | `https://mail.google.com/` |
| IMAP | `outlook.office365.com:993`, TLS | `imap.gmail.com:993`, TLS |
| SMTP | `smtp.office365.com:587`, STARTTLS | `smtp.gmail.com:587`, STARTTLS |
| Authentification | SASL `XOAUTH2` (IMAP et SMTP) | SASL `XOAUTH2` (IMAP et SMTP) |
| Secret d'application | **aucun** (client public : Microsoft interdit le secret pour une application native) | facultatif (la documentation Google le marque facultatif pour une application de bureau) |

`{locataire}` vaut `common` (comptes professionnels et personnels) sauf si `LEGALOS_OAUTH_MICROSOFT_TENANT` en dispose autrement (identifiant de locataire, `organizations` ou `consumers`).

Le SMTP est chiffré : STARTTLS (port 587) ou TLS implicite (port 465), certificat vérifié sur les racines Mozilla. Un relais SMTP de cabinet configuré à la main prend le même chemin : 465 en TLS implicite, 587 en STARTTLS, tout autre port en clair (serveurs de test), sauf indication contraire du champ `smtp_chiffrement`.

## Renseigner l'instance

Après l'enregistrement chez le fournisseur (sections suivantes), les identifiants vont dans le `.env` de l'instance :

| Variable | Rôle |
|---|---|
| `LEGALOS_OAUTH_MICROSOFT_CLIENT_ID` | identifiant d'application Microsoft 365 ; vide : le fournisseur n'est pas proposé |
| `LEGALOS_OAUTH_MICROSOFT_CLIENT_SECRET` | secret client, facultatif (client public) |
| `LEGALOS_OAUTH_MICROSOFT_TENANT` | locataire (`common` si vide) |
| `LEGALOS_OAUTH_GMAIL_CLIENT_ID` | identifiant client Google (application de bureau) ; vide : le fournisseur n'est pas proposé |
| `LEGALOS_OAUTH_GMAIL_CLIENT_SECRET` | secret client, facultatif |

`cargo xtask install` pose ces cinq questions à l'installation (réponse vide pour ignorer). Seules les lettres, chiffres, le point, le tiret, le soulignement et le tilde sont acceptés : ces valeurs traversent l'interpolation de docker compose. Redémarrer l'API après toute modification de `.env`.

## Enregistrer l'application chez Microsoft (Microsoft Entra)

À faire par l'administrateur du locataire, une fois par instance.

1. Centre d'administration Microsoft Entra, **Inscriptions d'applications**, **Nouvelle inscription**. Types de comptes pris en charge : selon le cabinet ; « comptes de toutes les organisations et comptes Microsoft personnels » si des boîtes Outlook.com doivent être connectées.
2. **Authentification**, **Ajouter une plateforme**, **Applications mobiles et de bureau**. Adresse de redirection : `http://127.0.0.1` (sans port : Microsoft ignore le port d'une redirection de bouclage). Le portail refuse de saisir une adresse `http` de bouclage dans la zone de texte : l'ajouter dans le **manifeste** (attribut `replyUrlsWithType`, d'après la page Microsoft citée plus bas ; le type exact à y inscrire est à relever dans l'interface au moment de l'enregistrement). Préférer `127.0.0.1` à `localhost` ; `[::1]` n'est pas pris en charge. Activer **Autoriser les flux de clients publics**.
3. **Autorisations de l'API** : autorisations **déléguées** d'Exchange Online `IMAP.AccessAsUser.All` et `SMTP.Send`, plus `offline_access` (le libellé exact des écrans du portail change : seules les portées ci-dessus sont documentées). Consentement de l'administrateur si l'organisation l'exige.
4. Ne créer **aucun secret** ; relever l'**identifiant d'application (client)**.
5. Variables de l'instance (fichier `.env` de l'instance, puis redémarrage de l'API) :
   - `LEGALOS_OAUTH_MICROSOFT_CLIENT_ID` = l'identifiant d'application ;
   - `LEGALOS_OAUTH_MICROSOFT_TENANT` = facultatif.

À contrôler côté Microsoft 365 par l'administrateur, et à confirmer à l'essai réel (B18) : IMAP et SMTP authentifié activés pour la boîte (Microsoft rappelle que les « paramètres de sécurité par défaut » désactivent IMAP et POP).

## Enregistrer l'application chez Google

1. Console Google Cloud, un projet, **API et services**, **Écran de consentement OAuth** (type interne ou externe selon le cabinet).
2. **Identifiants**, **Créer des identifiants**, **ID client OAuth**, type **Application de bureau**. Les clients de bureau sont des clients publics ; Google fournit tout de même un secret, facultatif à l'échange du code.
3. Portée à déclarer : `https://mail.google.com/` (IMAP, POP et SMTP). C'est une portée sensible de Gmail : la vérification de l'application par Google pour une diffusion hors du domaine n'a **pas** été relue aujourd'hui, à confirmer à l'essai réel (B18).
4. Variables de l'instance : `LEGALOS_OAUTH_GMAIL_CLIENT_ID` et, si Google en a fourni un, `LEGALOS_OAUTH_GMAIL_CLIENT_SECRET`.

La demande d'autorisation Gmail ajoute `access_type=offline` et `prompt=consent` pour obtenir un jeton de rafraîchissement à chaque connexion ; la documentation Google consultée dit que les applications de bureau en reçoivent toujours un, ces deux paramètres sont une précaution à vérifier à l'essai réel.

## Limites connues, à lire avant la mise en service

- **Essai réel non fait** : la preuve (`oauth-messagerie.mjs`) tourne sur un fournisseur simulé, un Dovecot qui valide `XOAUTH2` par introspection et un relais SMTP simulé. Aucun appel à Microsoft ou à Google n'a eu lieu. L'essai réel sur la boîte du commandement est le blocage **B18** (à lever avant la coche de J11 si cette boîte est chez Microsoft 365 ou Google).
- **TLS du SMTP** : le chemin STARTTLS / TLS implicite est celui de `lettre` avec les racines Mozilla ; il n'est éprouvé contre aucun serveur réel avant B18 (les recettes parlent à des serveurs en clair).
- **Identifiants d'application** : `cargo xtask install` les demande à l'installation (facultatif, réponse vide pour ignorer, valeurs contrôlées, jamais réaffichées) et les écrit dans le `.env` de l'instance ; une variable déjà renseignée n'est pas redemandée. Sans terminal interactif, rien n'est demandé : renseigner `.env` à la main. L'écran Réglages (administrateur) lit `GET /messagerie/oauth/application` : présence de chaque fournisseur, aucune valeur. Un collaborateur reçoit 403. L'écriture depuis l'écran n'est pas encore livrée (reste de D8).
- **Boîtes partagées** : seule une boîte nominative se connecte par OAuth.

## Sources consultées (2026-10-20)

- Microsoft, authentification IMAP, POP et SMTP par OAuth (portées, format XOAUTH2) : <https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth>
- Microsoft, adresses de redirection (bouclage, port ignoré, `127.0.0.1`) : <https://learn.microsoft.com/en-us/entra/identity-platform/reply-url>
- Microsoft, flux code d'autorisation (PKCE, client public sans secret, rotation du jeton de rafraîchissement, `invalid_grant`) : <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>
- Microsoft, serveurs Exchange Online : <https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/pop3-and-imap4>
- Google, applications de bureau (bouclage `127.0.0.1`, PKCE S256) : <https://developers.google.com/identity/protocols/oauth2/native-app>
- Google, protocole XOAUTH2 (portée `https://mail.google.com/`) : <https://developers.google.com/gmail/imap/xoauth2-protocol>
- Google, serveurs IMAP et SMTP : <https://developers.google.com/workspace/gmail/imap/imap-smtp>
- RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 8252 (OAuth pour applications natives).
