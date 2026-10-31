//! Poste B sans accès : la fiche du cabinet est là ; dossier, facture et mail restreints absents.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
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
async fn le_poste_b_voit_la_fiche_et_pas_le_dossier_restreint() {
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
    let user_a = Uuid::now_v7();
    let user_b = Uuid::now_v7();
    let dossier = Uuid::now_v7();
    let contact = Uuid::now_v7();
    let facture = Uuid::now_v7();
    let encaissement = Uuid::now_v7();
    let message = Uuid::now_v7();
    let compte = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet droits', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("droits-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    for (id, mail) in [(user_a, "a"), (user_b, "b")] {
        sqlx::query(
            "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash) VALUES ($1, $2, $3, 'x')",
        )
        .bind(id)
        .bind(cabinet)
        .bind(format!("droits-{mail}-{id}@example.test"))
        .execute(&mut *tx)
        .await
        .expect("utilisateur");
    }
    sqlx::query(
        "INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, visibilite, restreint) VALUES ($1, $2, 'Dossier secret', 'kraft', 'TJ fictif', $3, 'restreint', TRUE)",
    )
    .bind(dossier)
    .bind(cabinet)
    .bind(format!("rg-{dossier}"))
    .execute(&mut *tx)
    .await
    .expect("dossier");
    sqlx::query(
        "INSERT INTO dossier_acces (dossier_id, utilisateur_id, utilisateur_texte, dossier_texte) VALUES ($1, $2, $3, $4)",
    )
    .bind(dossier)
    .bind(user_a)
    .bind(user_a.to_string())
    .bind(dossier.to_string())
    .execute(&mut *tx)
    .await
    .expect("accès");
    sqlx::query(
        "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client) VALUES ($1, $2, 'morale', 'Société visible', 'professionnel')",
    )
    .bind(contact)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contact");
    let qualite = sqlx::query_scalar::<_, Uuid>("SELECT id FROM qualites WHERE cabinet_id = $1 LIMIT 1")
        .bind(cabinet)
        .fetch_one(&mut *tx)
        .await
        .expect("qualité");
    let intervenant = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite) VALUES ($1, $2, $3, $4, $5, 'public')",
    )
    .bind(intervenant)
    .bind(cabinet)
    .bind(dossier)
    .bind(contact)
    .bind(qualite)
    .execute(&mut *tx)
    .await
    .expect("intervenant");
    sqlx::query(
        "INSERT INTO factures (id, cabinet_id, dossier_id, type, statut, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp, contact_id) VALUES ($1, $2, $3, 'facture', 'brouillon', 10000, 2000, 12000, 2000, $4)",
    )
    .bind(facture)
    .bind(cabinet)
    .bind(dossier)
    .bind(contact)
    .execute(&mut *tx)
    .await
    .expect("facture");
    sqlx::query(
        "INSERT INTO facture_encaissements (id, facture_id, montant_centimes, cle_idempotence) VALUES ($1, $2, 4000, $3)",
    )
    .bind(encaissement)
    .bind(facture)
    .bind(format!("droits-enc-{encaissement}"))
    .execute(&mut *tx)
    .await
    .expect("encaissement");
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref) VALUES ($1, $2, 'classement', $3, 'ref-droits')",
    )
    .bind(compte)
    .bind(cabinet)
    .bind(format!("classement-{cabinet}@example.test"))
    .execute(&mut *tx)
    .await
    .expect("compte mail");
    sqlx::query(
        "INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid, objet, expediteur, etat_classement) VALUES ($1, $2, $3, $4, $5, 1, 1, 'Courrier secret', 'client@example.test', 'classe')",
    )
    .bind(message)
    .bind(cabinet)
    .bind(compte)
    .bind(dossier)
    .bind(format!("<droits-{message}@example.test>"))
    .execute(&mut *tx)
    .await
    .expect("message");

    let fiche = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM contacts WHERE cabinet_id = $1 AND id = $2",
    )
    .bind(cabinet)
    .bind(contact)
    .fetch_one(&mut *tx)
    .await
    .expect("fiche cabinet");
    assert_eq!(fiche, 1, "l'annuaire du cabinet contient la fiche");

    let publics = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM dossier_intervenants WHERE visibilite = 'public' AND cabinet_id = $1 AND id = $2",
    )
    .bind(cabinet)
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("publics");
    assert_eq!(publics, 0, "le flux public n'emporte pas l'intervenant");

    let factures_publiques = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM factures WHERE visibilite = 'public' AND id = $1",
    )
    .bind(facture)
    .fetch_one(&mut *tx)
    .await
    .expect("factures publiques");
    assert_eq!(
        factures_publiques, 0,
        "le flux factures_publics n'emporte pas la facture du dossier restreint"
    );

    let encaissements_publics = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM facture_encaissements WHERE visibilite = 'public' AND id = $1",
    )
    .bind(encaissement)
    .fetch_one(&mut *tx)
    .await
    .expect("encaissements publics");
    assert_eq!(
        encaissements_publics, 0,
        "le flux encaissements_publics n'emporte pas l'encaissement du dossier restreint"
    );

    let messages_publics = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM messages WHERE visibilite = 'public' AND id = $1",
    )
    .bind(message)
    .fetch_one(&mut *tx)
    .await
    .expect("messages publics");
    assert_eq!(
        messages_publics, 0,
        "le flux messages_publics n'emporte pas le mail classé du dossier restreint"
    );

    let chez_b_intervenant = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM dossier_intervenants
        INNER JOIN groupe_acces_membres ON dossier_intervenants.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND dossier_intervenants.id = $2
        "#,
    )
    .bind(user_b.to_string())
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("poste B intervenant");
    assert_eq!(chez_b_intervenant, 0, "le poste B n'a pas l'intervenant du dossier restreint");

    let chez_a_intervenant = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM dossier_intervenants
        INNER JOIN groupe_acces_membres ON dossier_intervenants.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND dossier_intervenants.id = $2
        "#,
    )
    .bind(user_a.to_string())
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("poste A intervenant");
    assert_eq!(chez_a_intervenant, 1, "le poste A, membre du groupe, a l'intervenant");

    let chez_b_facture = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM factures
        INNER JOIN groupe_acces_membres ON factures.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND factures.id = $2
        "#,
    )
    .bind(user_b.to_string())
    .bind(facture)
    .fetch_one(&mut *tx)
    .await
    .expect("poste B facture");
    assert_eq!(chez_b_facture, 0, "le poste B n'a pas la facture du dossier restreint");

    let chez_a_facture = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM factures
        INNER JOIN groupe_acces_membres ON factures.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND factures.id = $2
        "#,
    )
    .bind(user_a.to_string())
    .bind(facture)
    .fetch_one(&mut *tx)
    .await
    .expect("poste A facture");
    assert_eq!(chez_a_facture, 1, "le poste A a la facture du dossier restreint");

    let chez_b_enc = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM facture_encaissements
        INNER JOIN groupe_acces_membres ON facture_encaissements.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND facture_encaissements.id = $2
        "#,
    )
    .bind(user_b.to_string())
    .bind(encaissement)
    .fetch_one(&mut *tx)
    .await
    .expect("poste B encaissement");
    assert_eq!(chez_b_enc, 0, "le poste B n'a pas l'encaissement du dossier restreint");

    let chez_a_enc = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM facture_encaissements
        INNER JOIN groupe_acces_membres ON facture_encaissements.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND facture_encaissements.id = $2
        "#,
    )
    .bind(user_a.to_string())
    .bind(encaissement)
    .fetch_one(&mut *tx)
    .await
    .expect("poste A encaissement");
    assert_eq!(chez_a_enc, 1, "le poste A a l'encaissement du dossier restreint");

    let chez_b_mail = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM messages
        INNER JOIN groupe_acces_membres ON messages.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND messages.id = $2
        "#,
    )
    .bind(user_b.to_string())
    .bind(message)
    .fetch_one(&mut *tx)
    .await
    .expect("poste B mail");
    assert_eq!(chez_b_mail, 0, "le poste B n'a pas le mail classé du dossier restreint");

    let chez_a_mail = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM messages
        INNER JOIN groupe_acces_membres ON messages.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND messages.id = $2
        "#,
    )
    .bind(user_a.to_string())
    .bind(message)
    .fetch_one(&mut *tx)
    .await
    .expect("poste A mail");
    assert_eq!(chez_a_mail, 1, "le poste A a le mail classé du dossier restreint");

    tx.rollback().await.expect("annulation");
}
