//! Un contact lié s'archive. Un contact jamais lié est supprimé, et le journal le note.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
use legalos_api::conflits::ContexteChamp;
use legalos_api::fusion_contacts::{retirer_contact, EffetRetrait};
use uuid::Uuid;

fn ensure_test_env() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = dotenvy::dotenv();
        if std::env::var("DATABASE_URL").is_err() {
            let _ = dotenvy::from_filename("../../.env");
        }
        std::env::set_var(
            "SECRETS_CHIFFREMENT_KEY",
            "legalos_demo_chiffrement_32oct!!",
        );
        std::env::set_var("LEGALOS_MODE", "development");
    });
}

#[tokio::test]
async fn un_contact_lie_s_archive_et_un_contact_seul_disparait() {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    config.database_url = config.database_url.replace("@localhost:", "@127.0.0.1:");
    let pool = legalos_api::db::connect_pool(&config.database_url)
        .await
        .expect("connexion Postgres");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");

    let mut tx = pool.begin().await.expect("transaction");
    let cabinet = Uuid::now_v7();
    let auteur = Uuid::now_v7();
    let poste = Uuid::now_v7();
    let lie = Uuid::now_v7();
    let seul = Uuid::now_v7();
    let dossier = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet retrait', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("retrait-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    sqlx::query(
        "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash) VALUES ($1, $2, $3, 'x')",
    )
    .bind(auteur)
    .bind(cabinet)
    .bind(format!("retrait-{auteur}@example.test"))
    .execute(&mut *tx)
    .await
    .expect("auteur");
    sqlx::query(
        "INSERT INTO postes (id, cabinet_id, utilisateur_id, nom_appareil) VALUES ($1, $2, $3, 'poste')",
    )
    .bind(poste)
    .bind(cabinet)
    .bind(auteur)
    .execute(&mut *tx)
    .await
    .expect("poste");
    sqlx::query(
        "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client) VALUES ($1, $3, 'physique', 'Lié', 'particulier'), ($2, $3, 'physique', 'Seul', 'particulier')",
    )
    .bind(lie)
    .bind(seul)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contacts");
    sqlx::query(
        "INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, visibilite) VALUES ($1, $2, 'Dossier', 'kraft', 'TJ fictif', $3, 'public')",
    )
    .bind(dossier)
    .bind(cabinet)
    .bind(format!("rg-{dossier}"))
    .execute(&mut *tx)
    .await
    .expect("dossier");
    let qualite =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM qualites WHERE cabinet_id = $1 LIMIT 1")
            .bind(cabinet)
            .fetch_one(&mut *tx)
            .await
            .expect("qualité");
    sqlx::query(
        "INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite) VALUES ($1, $2, $3, $4, $5, 'public')",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(dossier)
    .bind(lie)
    .bind(qualite)
    .execute(&mut *tx)
    .await
    .expect("intervenant");
    sqlx::query(
        "INSERT INTO contact_coordonnees (id, cabinet_id, contact_id, genre, usage, valeur, principale) VALUES ($1, $2, $3, 'email', 'correspondance', 'seul@example.test', TRUE)",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(seul)
    .execute(&mut *tx)
    .await
    .expect("coordonnée");

    let contexte_lie = ContexteChamp {
        cabinet_id: cabinet,
        poste_id: poste,
        auteur_id: auteur,
        base_revision: 1,
        enregistrement_id: lie,
        table_cible: "contacts",
        dossier_id: None,
    };
    let effet = retirer_contact(&mut tx, cabinet, lie, &contexte_lie)
        .await
        .expect("archive");
    assert!(matches!(effet, EffetRetrait::Archive));
    let encore =
        sqlx::query_as::<_, (String, bool)>("SELECT nom, archivee FROM contacts WHERE id = $1")
            .bind(lie)
            .fetch_one(&mut *tx)
            .await
            .expect("fiche liée");
    assert_eq!(encore.0, "Lié");
    assert!(encore.1);
    let intervenant = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM dossier_intervenants WHERE contact_id = $1",
    )
    .bind(lie)
    .fetch_one(&mut *tx)
    .await
    .expect("intervenant resté");
    assert_eq!(intervenant, 1);
    let effet_bis = retirer_contact(&mut tx, cabinet, lie, &contexte_lie)
        .await
        .expect("rejeu");
    assert!(matches!(effet_bis, EffetRetrait::Archive));
    let journaux_archive = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM journal_modifications WHERE enregistrement_id = $1 AND champ = 'archive'",
    )
    .bind(lie)
    .fetch_one(&mut *tx)
    .await
    .expect("journal archive");
    assert_eq!(journaux_archive, 1);

    let contexte_seul = ContexteChamp {
        enregistrement_id: seul,
        ..contexte_lie
    };
    let effet_seul = retirer_contact(&mut tx, cabinet, seul, &contexte_seul)
        .await
        .expect("suppression");
    assert!(matches!(effet_seul, EffetRetrait::Supprime));
    let disparu = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM contacts WHERE id = $1")
        .bind(seul)
        .fetch_one(&mut *tx)
        .await
        .expect("compte");
    assert_eq!(disparu, 0);
    let coord = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM contact_coordonnees WHERE contact_id = $1",
    )
    .bind(seul)
    .fetch_one(&mut *tx)
    .await
    .expect("coordonnée");
    assert_eq!(coord, 0);
    let journal_suppr = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM journal_modifications WHERE enregistrement_id = $1 AND champ = 'suppression'",
    )
    .bind(seul)
    .fetch_one(&mut *tx)
    .await
    .expect("journal suppression");
    assert_eq!(journal_suppr, 1);

    // Une fiche qui n'a que des notes s'archive : supprimer la fiche perdrait ses notes.
    let avec_notes = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client, revision) VALUES ($1, $2, 'physique', 'Notes seules', 'particulier', 1)",
    )
    .bind(avec_notes)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("fiche aux notes");
    sqlx::query(
        "INSERT INTO contact_notes (id, cabinet_id, contact_id, texte) VALUES ($1, $2, $3, 'note fictive')",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(avec_notes)
    .execute(&mut *tx)
    .await
    .expect("note");
    let contexte_notes = ContexteChamp {
        enregistrement_id: avec_notes,
        ..contexte_seul
    };
    let effet_notes = retirer_contact(&mut tx, cabinet, avec_notes, &contexte_notes)
        .await
        .expect("archive avec notes");
    assert!(matches!(effet_notes, EffetRetrait::Archive));
    let notes_restantes =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM contact_notes WHERE contact_id = $1")
            .bind(avec_notes)
            .fetch_one(&mut *tx)
            .await
            .expect("notes restantes");
    assert_eq!(notes_restantes, 1);

    tx.rollback().await.expect("annulation");
}
