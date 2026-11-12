//! Fusion : aucune référence perdue, second appel sans effet.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
use legalos_api::conflits::ContexteChamp;
use legalos_api::fusion_contacts::{chercher_doublons, fusionner};
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
async fn la_fusion_deplace_les_references_et_se_rejoue_sans_effet() {
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
    let conservee = Uuid::now_v7();
    let absorbee = Uuid::now_v7();
    let tiers = Uuid::now_v7();
    let dossier = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet fusion', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("fusion-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    sqlx::query(
        "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash) VALUES ($1, $2, $3, 'x')",
    )
    .bind(auteur)
    .bind(cabinet)
    .bind(format!("fusion-{auteur}@example.test"))
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
        r#"
        INSERT INTO contacts (id, cabinet_id, nature, nom, prenoms, type_client, siren)
        VALUES
            ($1, $4, 'physique', 'Garde', 'Anne', 'particulier', '100000009'),
            ($2, $4, 'physique', 'Autre', 'Camille', 'particulier', '100 000 009'),
            ($3, $4, 'morale', 'Tiers', NULL, 'professionnel', NULL)
        "#,
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(tiers)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contacts");

    let doublons = chercher_doublons(&mut tx, cabinet, conservee)
        .await
        .expect("doublons");
    assert!(doublons
        .iter()
        .any(|d| d.id == absorbee && d.motif == "siren"));

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
    .bind(absorbee)
    .bind(qualite)
    .execute(&mut *tx)
    .await
    .expect("intervenant");
    sqlx::query(
        "INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, contact_id, visibilite) VALUES ($1, $2, $3, 'client', 'Autre', $4, 'public')",
    )
    .bind(Uuid::now_v7())
    .bind(dossier)
    .bind(cabinet)
    .bind(absorbee)
    .execute(&mut *tx)
    .await
    .expect("partie");
    sqlx::query(
        "INSERT INTO contact_coordonnees (id, cabinet_id, contact_id, genre, usage, valeur, principale) VALUES ($1, $2, $3, 'email', 'correspondance', 'camille@example.test', TRUE)",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(absorbee)
    .execute(&mut *tx)
    .await
    .expect("coordonnée");
    sqlx::query(
        "INSERT INTO factures (id, cabinet_id, dossier_id, type, statut, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp, contact_id) VALUES ($1, $2, $3, 'facture', 'brouillon', 100, 20, 120, 2000, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(dossier)
    .bind(absorbee)
    .execute(&mut *tx)
    .await
    .expect("facture");
    let compte = Uuid::now_v7();
    let message = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref) VALUES ($1, $2, 'classement', 'boite@example.test', 'ref-test')",
    )
    .bind(compte)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("compte");
    sqlx::query(
        "INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, etat_classement, visibilite) VALUES ($1, $2, $3, 'm1', 1, 1, 'a_classer', 'public')",
    )
    .bind(message)
    .bind(cabinet)
    .bind(compte)
    .execute(&mut *tx)
    .await
    .expect("message");
    sqlx::query(
        "INSERT INTO message_contacts (id, cabinet_id, message_id, contact_id, role) VALUES ($1, $2, $3, $4, 'expediteur')",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(message)
    .bind(absorbee)
    .execute(&mut *tx)
    .await
    .expect("rattachement");
    for (fiche, texte) in [
        (absorbee, "note 1 de l'absorbée"),
        (absorbee, "note 2 de l'absorbée"),
        (conservee, "note de la conservée"),
    ] {
        sqlx::query(
            "INSERT INTO contact_notes (id, cabinet_id, contact_id, texte) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::now_v7())
        .bind(cabinet)
        .bind(fiche)
        .bind(texte)
        .execute(&mut *tx)
        .await
        .expect("note");
    }
    for (source, cible, libelle) in [
        (absorbee, tiers, "suivi"),
        (conservee, tiers, "suivi"),
        (tiers, absorbee, "retour"),
        (absorbee, conservee, "entre eux"),
    ] {
        sqlx::query(
            "INSERT INTO contact_liens (id, cabinet_id, contact_source_id, contact_cible_id, type_lien, libelle) VALUES ($1, $2, $3, $4, 'autre', $5)",
        )
        .bind(Uuid::now_v7())
        .bind(cabinet)
        .bind(source)
        .bind(cible)
        .bind(libelle)
        .execute(&mut *tx)
        .await
        .expect("lien");
    }

    let contexte = ContexteChamp {
        cabinet_id: cabinet,
        poste_id: poste,
        auteur_id: auteur,
        base_revision: 1,
        enregistrement_id: conservee,
        table_cible: "contacts",
        dossier_id: None,
    };
    fusionner(
        &mut tx,
        cabinet,
        conservee,
        absorbee,
        &["prenoms".into()],
        Some(&contexte),
    )
    .await
    .expect("fusion");

    let fiche = sqlx::query_as::<_, (String, String, bool, Option<Uuid>)>(
        "SELECT nom, prenoms, archivee, fusionnee_dans FROM contacts WHERE id = $1",
    )
    .bind(conservee)
    .fetch_one(&mut *tx)
    .await
    .expect("conservée");
    assert_eq!(fiche.0, "Garde");
    assert_eq!(fiche.1, "Camille");
    let archive = sqlx::query_as::<_, (bool, Option<Uuid>, Option<String>)>(
        "SELECT archivee, fusionnee_dans, email FROM contacts WHERE id = $1",
    )
    .bind(absorbee)
    .fetch_one(&mut *tx)
    .await
    .expect("absorbée");
    assert!(archive.0);
    assert_eq!(archive.1, Some(conservee));
    assert!(archive.2.is_none());

    let reste_absorbee = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT
            (SELECT count(*) FROM dossier_intervenants WHERE contact_id = $1)
          + (SELECT count(*) FROM parties WHERE contact_id = $1)
          + (SELECT count(*) FROM contact_coordonnees WHERE contact_id = $1)
          + (SELECT count(*) FROM factures WHERE contact_id = $1)
          + (SELECT count(*) FROM message_contacts WHERE contact_id = $1)
          + (SELECT count(*) FROM contact_notes WHERE contact_id = $1)
          + (SELECT count(*) FROM contact_liens WHERE contact_source_id = $1 OR contact_cible_id = $1 OR pour_le_compte_de = $1)
        "#,
    )
    .bind(absorbee)
    .fetch_one(&mut *tx)
    .await
    .expect("restes");
    assert_eq!(reste_absorbee, 0);
    let chez_conservee = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT
            (SELECT count(*) FROM dossier_intervenants WHERE contact_id = $1)
          + (SELECT count(*) FROM parties WHERE contact_id = $1)
          + (SELECT count(*) FROM contact_coordonnees WHERE contact_id = $1)
          + (SELECT count(*) FROM factures WHERE contact_id = $1)
          + (SELECT count(*) FROM message_contacts WHERE contact_id = $1)
          + (SELECT count(*) FROM contact_notes WHERE contact_id = $1)
        "#,
    )
    .bind(conservee)
    .fetch_one(&mut *tx)
    .await
    .expect("report");
    assert_eq!(
        chez_conservee,
        5 + 3,
        "les trois notes sont sur la fiche conservée"
    );
    let liens =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM contact_liens WHERE cabinet_id = $1")
            .bind(cabinet)
            .fetch_one(&mut *tx)
            .await
            .expect("liens");
    assert_eq!(liens, 2);
    let journal = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM journal_modifications WHERE enregistrement_id = $1 AND champ = 'fusion'",
    )
    .bind(conservee)
    .fetch_one(&mut *tx)
    .await
    .expect("journal");
    assert_eq!(journal, 1);

    fusionner(
        &mut tx,
        cabinet,
        conservee,
        absorbee,
        &["nom".into()],
        Some(&contexte),
    )
    .await
    .expect("second appel");
    let notes_apres = sqlx::query_as::<_, (i64, i64)>(
        "SELECT count(*) FILTER (WHERE contact_id = $1), count(*) FILTER (WHERE contact_id = $2) FROM contact_notes WHERE cabinet_id = $3",
    )
    .bind(conservee)
    .bind(absorbee)
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("notes après");
    assert_eq!(
        notes_apres,
        (3, 0),
        "deuxième appel sans effet sur les notes"
    );
    let fiche_apres =
        sqlx::query_as::<_, (String, String)>("SELECT nom, prenoms FROM contacts WHERE id = $1")
            .bind(conservee)
            .fetch_one(&mut *tx)
            .await
            .expect("après");
    assert_eq!(fiche_apres.0, "Garde");
    assert_eq!(fiche_apres.1, "Camille");
    let journal_apres = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM journal_modifications WHERE enregistrement_id = $1 AND champ = 'fusion'",
    )
    .bind(conservee)
    .fetch_one(&mut *tx)
    .await
    .expect("journal après");
    assert_eq!(journal_apres, 1);

    tx.rollback().await.expect("annulation");
}
