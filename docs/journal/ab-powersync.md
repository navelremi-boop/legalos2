# Banc A/B de la Montée PowerSync

Recette mesurée : `tests/recette/conflits-poste-tauri.mjs` (version de HEAD dans les deux arbres), 8 passes par arbre, en série, base puis nouveau en alternance.

- **base** : `9374345` (worktree `.worktrees/ab-base`, juste avant « monter PowerSync en 0.1.0 »), `CARGO_TARGET_DIR` propre.
- **nouveau** : `13e46c4` (dépôt), `CARGO_TARGET_DIR` = `target`.
- Même Docker, même instance (API, PowerSync, Postgres), même port 1420 : seul le poste (dépendances Rust et JavaScript) diffère entre les arbres.
- Début : 2026-10-09T20:18:40.923Z ; terminé (2026-10-09T22:55:40.496Z).

**Bilan** : base 1 échec(s) sur 8 passe(s) valide(s) ; nouveau 0 échec(s) sur 8. Échecs seulement sur « base » : cas non prévu par la règle du commandement, à lui soumettre.

| Passe | Arbre | Exit | Durée (s) | Ligne d'échec |
| --- | --- | --- | --- | --- |
| 1 | base | 0 | 585 |  |
| 2 | nouveau | 0 | 1168 |  |
| 3 | base | 0 | 632 |  |
| 4 | nouveau | 0 | 539 |  |
| 5 | base | 0 | 563 |  |
| 6 | nouveau | 0 | 535 |  |
| 7 | base | 1 | 333 | Error: écran auth absent —  — page={"href":"http://localhost:1420/","etat":"complete","html":527,"racine":0} erreurs=[] cibles=[page:http://localhost:1420/] processus=[node.exe pid=22968 parent=10560 ; node.exe pid=2220 parent=26716 ; node.exe pid=30712 parent=23220 ; legal-os-poste.exe pid=35920 parent=35028 ; msedgewebview2.exe pid=31452 parent=35920 ; msedgewebview2.exe pid=33516 parent=31452 ; |
| 8 | nouveau | 0 | 565 |  |
| 9 | base | 0 | 567 |  |
| 10 | nouveau | 0 | 547 |  |
| 11 | base | 0 | 574 |  |
| 12 | nouveau | 0 | 559 |  |
| 13 | base | 0 | 570 |  |
| 14 | nouveau | 0 | 552 |  |
| 15 | base | 0 | 569 |  |
| 16 | nouveau | 0 | 550 |  |

## Diagnostics de login

- passe 7 (base) : `page={"href":"http://localhost:1420/","etat":"complete","html":527,"racine":0} erreurs=[] cibles=[page:http://localhost:1420/] processus=[node.exe pid=22968 parent=10560 ; node.exe pid=2220 parent=26716 ; node.exe pid=30712 parent=23220 ; legal-os-poste.exe pid=35920 parent=35028 ; msedgewebview2.exe pid=31452 parent=35920 ; msedgewebview2.exe pid=33516 parent=31452 ; msedgewebview2.exe pid=38600 parent=31452 ; msedgewebview2.exe pid=24600 parent=31452 ; msedgewebview2.exe pid=15368 parent=31452 ; msedgewebview2.exe pid=38040 parent=31452 ; �coute 1420 pid=30712 ; �coute 9253 pid=31452]`

Journaux complets des passes : `C:/Users/PC/AppData/Local/Temp/ab-conflits-eUiGbH` (hors dépôt).
