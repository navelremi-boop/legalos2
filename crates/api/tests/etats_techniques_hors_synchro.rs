//! Les états qui changent sans cesse ne descendent pas par PowerSync. Le poste les lit
//! par `GET /messagerie/sante`.
#![allow(clippy::expect_used)]

const COLONNES_TECHNIQUES: [&str; 7] = [
    "etat_connexion",
    "derniere_releve",
    "serveur_indisponible",
    "empreinte_refus",
    "corps_indexes",
    "corps_restants",
    "corps_abandonnes",
];

#[test]
fn etats_techniques_hors_synchro() {
    let flux = include_str!("../../../instance/powersync/sync-config.yaml");
    for colonne in COLONNES_TECHNIQUES {
        assert!(
            !flux.contains(colonne),
            "{colonne} est un état technique : il ne passe pas par la synchronisation"
        );
    }
    let schema = include_str!("../../../apps/poste/src/sync/AppSchema.ts");
    assert!(
        !schema.contains("etat_connexion"),
        "le schéma local ne reprend pas l'état de connexion"
    );
    let route = include_str!("../src/routes/boites.rs");
    assert!(
        route.contains("path = \"/messagerie/sante\""),
        "la route dédiée /messagerie/sante manque"
    );
    assert!(
        route.contains("etat_connexion"),
        "la route de santé doit porter l'état de connexion"
    );
    assert!(
        route.contains("derniere_releve_le"),
        "la route de santé doit porter l'horodatage de relève"
    );
    assert!(
        route.contains("corps_indexes"),
        "la route de santé doit porter la progression d'indexation"
    );
}
