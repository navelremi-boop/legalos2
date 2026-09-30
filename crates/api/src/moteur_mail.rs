//! Une tâche par compte, hors des requêtes HTTP.
//! IMAP dans `spawn_blocking` (`ImapMailboxWatch` pour la veille). L'écriture en base est un lot.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use legalos_messagerie::{
    diff_repli, Changement, EnteteRecu, ErreurMail, EtatUid, FournisseurMail, ParametresCompte,
    ReleveDossier, SessionActions, VeilleReception,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::totp::{chiffrer_secret_totp, dechiffrer_secret_totp};

const AUTRES_DOSSIERS: &[&str] = &["Sent", "Envoyés"];

struct CompteMoteur {
    id: Uuid,
    cabinet_id: Uuid,
    parametres: ParametresCompte,
}

pub fn demarrer(pool: PgPool, cle: [u8; 32]) {
    std::thread::Builder::new()
        .name("moteur-mail".into())
        .spawn(move || {
            if let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                runtime.block_on(boucle(pool, cle));
            }
        })
        .ok();
}

async fn boucle(pool: PgPool, cle: [u8; 32]) {
    let en_cours: Arc<Mutex<HashSet<Uuid>>> = Arc::new(Mutex::new(HashSet::new()));
    loop {
        if let Ok(comptes) = charger(&pool, &cle).await {
            for compte in comptes {
                let mut garde = en_cours.lock().unwrap_or_else(|err| err.into_inner());
                if !garde.insert(compte.id) {
                    continue;
                }
                drop(garde);
                let suivi = Arc::clone(&en_cours);
                let pool = pool.clone();
                let id = compte.id;
                tokio::spawn(async move {
                    tache(pool, compte).await;
                    suivi
                        .lock()
                        .unwrap_or_else(|err| err.into_inner())
                        .remove(&id);
                });
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn charger(pool: &PgPool, cle: &[u8; 32]) -> Result<Vec<CompteMoteur>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (Uuid, Uuid, String, i32, String, bool, String)>(
        r#"
        SELECT id, cabinet_id, hote, port, utilisateur, tls, secret_chiffre
        FROM comptes_mail
        WHERE hote IS NOT NULL AND port IS NOT NULL AND utilisateur IS NOT NULL
          AND secret_chiffre IS NOT NULL
        "#,
    )
    .fetch_all(pool)
    .await?;
    let mut comptes = Vec::new();
    for row in rows {
        let Ok(secret) = dechiffrer_secret_totp(&row.6, cle) else {
            continue;
        };
        let Ok(mot_de_passe) = String::from_utf8(secret) else {
            continue;
        };
        comptes.push(CompteMoteur {
            id: row.0,
            cabinet_id: row.1,
            parametres: ParametresCompte {
                hote: row.2,
                port: u16::try_from(row.3).unwrap_or(143),
                utilisateur: row.4,
                mot_de_passe,
                tls: row.5,
            },
        });
    }
    Ok(comptes)
}

async fn lire_modseqs(pool: &PgPool, compte: Uuid) -> HashMap<String, u64> {
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT dossier_imap, modseq FROM releve_curseurs WHERE compte_id = $1",
    )
    .bind(compte)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(dossier, modseq)| (dossier, u64::try_from(modseq).unwrap_or(0)))
        .collect()
}

async fn tache(pool: PgPool, compte: CompteMoteur) {
    let mut modseqs = lire_modseqs(&pool, compte.id).await;
    loop {
        let parametres = compte.parametres.clone();
        let modseq_inbox = modseqs.get("INBOX").copied().unwrap_or(0);
        let resultat = tokio::task::spawn_blocking(move || {
            let mut session = SessionActions::connecter(&parametres)?;
            let inbox = session.synchroniser_dossier("INBOX", modseq_inbox)?;
            Ok::<_, ErreurMail>(inbox)
        })
        .await;
        if let Ok(Ok(inbox)) = resultat {
            if appliquer_dossier(&pool, &compte, "INBOX", &inbox, modseq_inbox)
                .await
                .is_ok()
            {
                modseqs.insert("INBOX".into(), inbox.modseq);
            }
            for nom in AUTRES_DOSSIERS {
                let parametres = compte.parametres.clone();
                let connu = modseqs.get(*nom).copied().unwrap_or(0);
                let nom_thread = (*nom).to_owned();
                let autre = tokio::task::spawn_blocking(move || {
                    let mut session = SessionActions::connecter(&parametres)?;
                    session.synchroniser_dossier(&nom_thread, connu)
                })
                .await;
                if let Ok(Ok(releve)) = autre {
                    if appliquer_dossier(&pool, &compte, nom, &releve, connu)
                        .await
                        .is_ok()
                    {
                        modseqs.insert((*nom).to_owned(), releve.modseq);
                    }
                }
            }
            let parametres = compte.parametres.clone();
            let _ = tokio::task::spawn_blocking(move || {
                attendre_idle(&parametres, Duration::from_secs(20))
            })
            .await;
        } else {
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

fn changements_qresync(connus: &[EtatUid], releve: &ReleveDossier) -> Vec<Changement> {
    let mut changements = Vec::new();
    for uid in &releve.retires {
        changements.push(Changement::Retire { uid: *uid });
    }
    for etat in &releve.etats {
        if connus.iter().any(|connu| connu.uid == etat.uid) {
            changements.push(Changement::Drapeaux(etat.clone()));
        } else {
            changements.push(Changement::Ajoute(etat.clone()));
        }
    }
    changements
}

async fn appliquer_dossier(
    pool: &PgPool,
    compte: &CompteMoteur,
    dossier: &str,
    releve: &ReleveDossier,
    modseq_connu: u64,
) -> Result<(), sqlx::Error> {
    let mut connus = charger_etats(pool, compte.id, dossier).await?;
    connus.sort_by_key(|etat| etat.uid);
    let validity = lire_validity(pool, compte.id, dossier).await?;
    if validity != 0 && validity != i64::from(releve.uid_validity) {
        sqlx::query("DELETE FROM messages WHERE compte_id = $1 AND dossier_imap = $2")
            .bind(compte.id)
            .bind(dossier)
            .execute(pool)
            .await?;
        connus.clear();
    }
    let mut vus = releve.etats.clone();
    vus.sort_by_key(|etat| etat.uid);
    let changements =
        if releve.qresync && modseq_connu > 0 && validity == i64::from(releve.uid_validity) {
            changements_qresync(&connus, releve)
        } else {
            diff_repli(&connus, &vus).changements
        };
    let ajouts: Vec<EtatUid> = changements
        .iter()
        .filter_map(|changement| match changement {
            Changement::Ajoute(etat) => Some(etat.clone()),
            _ => None,
        })
        .collect();
    let drapeaux: Vec<EtatUid> = changements
        .iter()
        .filter_map(|changement| match changement {
            Changement::Drapeaux(etat) => Some(etat.clone()),
            _ => None,
        })
        .collect();
    let retires: Vec<i64> = changements
        .iter()
        .filter_map(|changement| match changement {
            Changement::Retire { uid } => Some(i64::from(*uid)),
            _ => None,
        })
        .collect();
    let entetes = entetes_des_ajouts(&compte.parametres, dossier, &ajouts).await;
    if !retires.is_empty() {
        sqlx::query(
            "DELETE FROM messages WHERE compte_id = $1 AND dossier_imap = $2 AND uid = ANY($3)",
        )
        .bind(compte.id)
        .bind(dossier)
        .bind(retires)
        .execute(pool)
        .await?;
    }
    inserer_ajouts(
        pool,
        compte,
        dossier,
        releve.uid_validity,
        &ajouts,
        &entetes,
    )
    .await?;
    maj_drapeaux(pool, compte.id, dossier, &drapeaux).await?;
    let max_uid = releve
        .etats
        .iter()
        .map(|etat| i64::from(etat.uid))
        .max()
        .unwrap_or(0);
    let chemin = if releve.qresync { "qresync" } else { "repli" };
    sauver_curseur(
        pool,
        compte.id,
        dossier,
        &CurseurEcrit {
            uid_validity: releve.uid_validity,
            dernier_uid: max_uid,
            modseq: releve.modseq,
            chemin,
            commandes: &releve.commandes.join("\n"),
        },
    )
    .await?;
    Ok(())
}

async fn entetes_des_ajouts(
    parametres: &ParametresCompte,
    dossier: &str,
    ajouts: &[EtatUid],
) -> Vec<EnteteRecu> {
    if ajouts.is_empty() {
        return Vec::new();
    }
    let parametres = parametres.clone();
    let dossier = dossier.to_owned();
    let uids: Vec<u32> = ajouts.iter().map(|etat| etat.uid).collect();
    tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        session.entetes_uids(&dossier, &uids)
    })
    .await
    .ok()
    .and_then(|resultat| resultat.ok())
    .unwrap_or_default()
}

async fn charger_etats(
    pool: &PgPool,
    compte: Uuid,
    dossier: &str,
) -> Result<Vec<EtatUid>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (i64, bool, String)>(
        r#"
        SELECT uid, lu, COALESCE(array_to_string(drapeaux, ' '), '')
        FROM messages
        WHERE compte_id = $1 AND dossier_imap = $2
        ORDER BY uid
        "#,
    )
    .bind(compte)
    .bind(dossier)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(uid, lu, drapeaux)| {
            let uid = u32::try_from(uid).ok()?;
            Some(EtatUid { uid, lu, drapeaux })
        })
        .collect())
}

async fn lire_validity(pool: &PgPool, compte: Uuid, dossier: &str) -> Result<i64, sqlx::Error> {
    let row = sqlx::query_as::<_, (i64,)>(
        "SELECT uid_validity FROM releve_curseurs WHERE compte_id = $1 AND dossier_imap = $2",
    )
    .bind(compte)
    .bind(dossier)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|valeur| valeur.0).unwrap_or(0))
}

struct Lignes {
    ids: Vec<Uuid>,
    messages: Vec<String>,
    objets: Vec<String>,
    expediteurs: Vec<String>,
    uids: Vec<i64>,
    lus: Vec<bool>,
    drapeaux: Vec<String>,
}

fn lignes_ajouts(ajouts: &[EtatUid], entetes: &[EnteteRecu], uid_validity: u32) -> Lignes {
    let par_uid: HashMap<u32, &EnteteRecu> =
        entetes.iter().map(|entete| (entete.uid, entete)).collect();
    let mut deja = HashSet::new();
    let mut lignes = Lignes {
        ids: Vec::with_capacity(ajouts.len()),
        messages: Vec::with_capacity(ajouts.len()),
        objets: Vec::with_capacity(ajouts.len()),
        expediteurs: Vec::with_capacity(ajouts.len()),
        uids: Vec::with_capacity(ajouts.len()),
        lus: Vec::with_capacity(ajouts.len()),
        drapeaux: Vec::with_capacity(ajouts.len()),
    };
    for etat in ajouts {
        let entete = par_uid.get(&etat.uid);
        let message_id = entete
            .map(|entete| entete.message_id.clone())
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| format!("<uid-{uid_validity}-{}@legalos.local>", etat.uid));
        if !deja.insert(message_id.clone()) {
            continue;
        }
        lignes.ids.push(Uuid::now_v7());
        lignes.messages.push(message_id);
        lignes.objets.push(
            entete
                .map(|entete| entete.objet.clone())
                .unwrap_or_default(),
        );
        lignes.expediteurs.push(
            entete
                .map(|entete| entete.expediteur.clone())
                .unwrap_or_default(),
        );
        lignes.uids.push(i64::from(etat.uid));
        lignes.lus.push(etat.lu);
        lignes.drapeaux.push(etat.drapeaux.clone());
    }
    lignes
}

async fn inserer_ajouts(
    pool: &PgPool,
    compte: &CompteMoteur,
    dossier: &str,
    uid_validity: u32,
    ajouts: &[EtatUid],
    entetes: &[EnteteRecu],
) -> Result<(), sqlx::Error> {
    if ajouts.is_empty() {
        return Ok(());
    }
    let lignes = lignes_ajouts(ajouts, entetes, uid_validity);
    let pas = 1000usize;
    let mut debut = 0usize;
    while debut < lignes.ids.len() {
        let fin = (debut + pas).min(lignes.ids.len());
        let taille = fin - debut;
        sqlx::query(
            r#"
            INSERT INTO messages (
                id, cabinet_id, compte_id, message_id, uid_validity, uid,
                objet, expediteur, etat_classement, dossier_imap, lu, drapeaux
            )
            SELECT t.id, t.cabinet_id, t.compte_id, t.message_id, t.uid_validity, t.uid,
                   t.objet, t.expediteur, t.etat_classement, t.dossier_imap, t.lu,
                   CASE WHEN t.drapeaux = '' THEN '{}'::text[] ELSE string_to_array(t.drapeaux, ' ') END
            FROM unnest(
                $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::bigint[], $6::bigint[],
                $7::text[], $8::text[], $9::text[], $10::text[], $11::boolean[], $12::text[]
            ) AS t(id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement, dossier_imap, lu, drapeaux)
            ON CONFLICT (compte_id, message_id) DO UPDATE
                SET lu = EXCLUDED.lu,
                    drapeaux = EXCLUDED.drapeaux,
                    dossier_imap = EXCLUDED.dossier_imap,
                    uid = EXCLUDED.uid,
                    uid_validity = EXCLUDED.uid_validity,
                    revision = messages.revision + 1
            "#,
        )
        .bind(lignes.ids[debut..fin].to_vec())
        .bind(vec![compte.cabinet_id; taille])
        .bind(vec![compte.id; taille])
        .bind(lignes.messages[debut..fin].to_vec())
        .bind(vec![i64::from(uid_validity); taille])
        .bind(lignes.uids[debut..fin].to_vec())
        .bind(lignes.objets[debut..fin].to_vec())
        .bind(lignes.expediteurs[debut..fin].to_vec())
        .bind(vec!["a_classer".to_owned(); taille])
        .bind(vec![dossier.to_owned(); taille])
        .bind(lignes.lus[debut..fin].to_vec())
        .bind(lignes.drapeaux[debut..fin].to_vec())
        .execute(pool)
        .await?;
        debut = fin;
    }
    Ok(())
}

async fn maj_drapeaux(
    pool: &PgPool,
    compte: Uuid,
    dossier: &str,
    etats: &[EtatUid],
) -> Result<(), sqlx::Error> {
    if etats.is_empty() {
        return Ok(());
    }
    let uids: Vec<i64> = etats.iter().map(|etat| i64::from(etat.uid)).collect();
    let lus: Vec<bool> = etats.iter().map(|etat| etat.lu).collect();
    let drapeaux: Vec<String> = etats.iter().map(|etat| etat.drapeaux.clone()).collect();
    sqlx::query(
        r#"
        UPDATE messages AS m
        SET lu = t.lu,
            drapeaux = CASE WHEN t.flags = '' THEN '{}'::text[] ELSE string_to_array(t.flags, ' ') END,
            revision = m.revision + 1
        FROM unnest($1::bigint[], $2::boolean[], $3::text[]) AS t(uid, lu, flags)
        WHERE m.compte_id = $4 AND m.dossier_imap = $5 AND m.uid = t.uid
          AND (m.lu IS DISTINCT FROM t.lu OR array_to_string(m.drapeaux, ' ') IS DISTINCT FROM t.flags)
        "#,
    )
    .bind(uids)
    .bind(lus)
    .bind(drapeaux)
    .bind(compte)
    .bind(dossier)
    .execute(pool)
    .await?;
    Ok(())
}

struct CurseurEcrit<'a> {
    uid_validity: u32,
    dernier_uid: i64,
    modseq: u64,
    chemin: &'a str,
    commandes: &'a str,
}

async fn sauver_curseur(
    pool: &PgPool,
    compte_id: Uuid,
    dossier: &str,
    curseur: &CurseurEcrit<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO releve_curseurs (
            compte_id, dossier_imap, uid_validity, dernier_uid, modseq, chemin, commandes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (compte_id, dossier_imap) DO UPDATE
            SET uid_validity = EXCLUDED.uid_validity,
                dernier_uid = GREATEST(releve_curseurs.dernier_uid, EXCLUDED.dernier_uid),
                modseq = EXCLUDED.modseq,
                chemin = EXCLUDED.chemin,
                commandes = EXCLUDED.commandes
        "#,
    )
    .bind(compte_id)
    .bind(dossier)
    .bind(i64::from(curseur.uid_validity))
    .bind(curseur.dernier_uid)
    .bind(i64::try_from(curseur.modseq).unwrap_or(0))
    .bind(curseur.chemin)
    .bind(curseur.commandes)
    .execute(pool)
    .await?;
    Ok(())
}

pub fn chiffrer_mot_de_passe(mot_de_passe: &str, cle: &[u8; 32]) -> Result<String, anyhow::Error> {
    chiffrer_secret_totp(mot_de_passe.as_bytes(), cle)
}

pub fn attendre_idle(
    parametres: &ParametresCompte,
    delai: Duration,
) -> Result<(bool, String), ErreurMail> {
    let veille = VeilleReception::ouvrir(parametres)?;
    let chemin = match veille.chemin() {
        legalos_messagerie::CheminVeille::Qresync => "qresync",
        legalos_messagerie::CheminVeille::Repli => "repli",
    };
    let recu = veille.attendre(delai)?;
    Ok((recu, chemin.to_owned()))
}

pub fn marquer_lu_imap(
    parametres: &ParametresCompte,
    uid: u32,
    lu: bool,
) -> Result<bool, ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    session.marquer_lu("INBOX", uid, lu)?;
    Ok(session.lire_lu("INBOX", uid).unwrap_or(lu))
}

pub fn deplacer_imap(
    parametres: &ParametresCompte,
    uid: u32,
    destination: &str,
) -> Result<(), ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    session.deplacer("INBOX", uid, destination)
}

pub fn supprimer_imap(parametres: &ParametresCompte, uid: u32) -> Result<(), ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    session.supprimer("INBOX", uid)
}

pub fn poser_drapeau_imap(
    parametres: &ParametresCompte,
    uid: u32,
    drapeau: &str,
) -> Result<bool, ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    session.poser_drapeau("INBOX", uid, drapeau)?;
    Ok(session.lire_lu("INBOX", uid).unwrap_or(false))
}
