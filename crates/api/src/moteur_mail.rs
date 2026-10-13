//! Une tâche par compte, hors des requêtes HTTP.
//! IMAP dans `spawn_blocking` (`ImapMailboxWatch` pour la veille). L'écriture en base est un lot.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use legalos_messagerie::{
    diff_repli, invitation_du_message, Changement, EnteteRecu, ErreurMail, EtatUid,
    FournisseurMail, InvitationLue, ParametresCompte, ReleveDossier, SessionActions,
    VeilleReception,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::totp::{chiffrer_secret_totp, dechiffrer_secret_totp};
use crate::depot_brouillons::DepotBrouillons;
use crate::invitations::{enregistrer_invitation, InvitationRecue, IssueInvitation};

const AUTRES_DOSSIERS: &[&str] = &["Sent", "Envoyés"];

struct CompteMoteur {
    id: Uuid,
    cabinet_id: Uuid,
    /// Titulaire d'une boîte **nominative** ; `None` pour une boîte partagée : ses messages ne
    /// créent l'invitation de personne.
    titulaire_id: Option<Uuid>,
    parametres: ParametresCompte,
    empreinte: String,
}

/// Renouvellement IDLE avant la coupure des 30 minutes (RFC 2177).
pub const RENOUVELLEMENT_IDLE_SECS: u64 = 28 * 60;
/// Relève sans réveil, et photographie complète, au plus une fois par cycle.
pub const RELEVE_SANS_REVEIL_SECS: u64 = 10 * 60;

pub fn delai_echec(echecs: u32) -> Duration {
    let pas = u64::from(echecs.min(9));
    Duration::from_secs((1_u64 << pas).min(RELEVE_SANS_REVEIL_SECS))
}

/// Période du balayage des copies de brouillons dans le dossier Brouillons.
pub const BALAYAGE_BROUILLONS_SECS: u64 = 15;
/// Un brouillon dont la copie est en retard n'est repris qu'après ce délai : sa propre tâche de
/// dépôt, lancée à l'écriture, a eu le temps de finir.
pub const REPRISE_BROUILLON_SECS: i64 = 30;

pub fn demarrer(pool: PgPool, cle: [u8; 32], classement: Option<ParametresCompte>) {
    std::thread::Builder::new()
        .name("moteur-mail".into())
        .spawn(move || {
            if let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                runtime.block_on(async move {
                    // Les copies de brouillons ont leur propre tâche : une connexion lente ne
                    // retarde jamais la relève des boîtes.
                    tokio::spawn(balayage_brouillons(DepotBrouillons::new(
                        pool.clone(),
                        cle,
                        classement,
                    )));
                    boucle(pool, cle).await;
                });
            }
        })
        .ok();
}

/// Reprend les brouillons dont la copie IMAP est en retard (dépôt échoué, tâche perdue au
/// redémarrage) et finit les retraits. Le dossier Brouillons n'est jamais relevé par le moteur.
async fn balayage_brouillons(depot: DepotBrouillons) {
    loop {
        tokio::time::sleep(Duration::from_secs(BALAYAGE_BROUILLONS_SECS)).await;
        depot.balayer(REPRISE_BROUILLON_SECS).await;
    }
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
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            Uuid,
            String,
            i32,
            String,
            bool,
            String,
            String,
            Option<Uuid>,
        ),
    >(
        r#"
        SELECT id, cabinet_id, hote, port, utilisateur, tls, secret_chiffre, etat_connexion,
               CASE WHEN type_compte = 'nominatif' THEN titulaire_id END
        FROM comptes_mail
        WHERE hote IS NOT NULL AND port IS NOT NULL AND utilisateur IS NOT NULL
          AND secret_chiffre IS NOT NULL
          AND (
            etat_connexion IS DISTINCT FROM 'identifiants_refuses'
            OR empreinte_refus IS DISTINCT FROM (hote || '|' || port::text || '|' || utilisateur || '|' || secret_chiffre)
          )
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
        let empreinte = format!("{}|{}|{}|{}", row.2, row.3, row.4, row.6);
        comptes.push(CompteMoteur {
            id: row.0,
            cabinet_id: row.1,
            titulaire_id: row.8,
            parametres: ParametresCompte {
                hote: row.2,
                port: u16::try_from(row.3).unwrap_or(143),
                utilisateur: row.4,
                mot_de_passe,
                tls: row.5,
            },
            empreinte,
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
    let handle = tokio::runtime::Handle::current();
    let _ = tokio::task::spawn_blocking(move || tourner(handle, pool, compte)).await;
}

fn tourner(handle: tokio::runtime::Handle, pool: PgPool, compte: CompteMoteur) {
    use std::time::Instant;
    let mut veille: Option<VeilleReception> = None;
    let mut veille_depuis = Instant::now();
    let mut derniere_releve: Option<Instant> = None;
    let mut derniere_complete: Option<Instant> = None;
    let mut serveur_qresync = false;
    let mut serveur_condstore = false;
    let mut echecs: u32 = 0;
    let mut reveil = true;
    loop {
        let empreinte = handle.block_on(empreinte_compte(&pool, compte.id));
        let Some(empreinte) = empreinte else {
            break;
        };
        if empreinte != compte.empreinte {
            break;
        }
        let modseqs = handle.block_on(lire_modseqs(&pool, compte.id));
        let fenetre_repli = derniere_complete.is_some_and(|instant| {
            instant.elapsed() < Duration::from_secs(RELEVE_SANS_REVEIL_SECS)
        });
        if reveil && fenetre_repli && !serveur_qresync && !serveur_condstore {
            reveil = false;
        }
        let doit_relever = reveil
            || derniere_releve.map_or(true, |instant| {
                instant.elapsed() >= Duration::from_secs(RELEVE_SANS_REVEIL_SECS)
            });
        if doit_relever {
            let parametres = compte.parametres.clone();
            let resultat = relever_session(&parametres, &modseqs, derniere_complete);
            match resultat {
                Ok(lot) => {
                    echecs = 0;
                    reveil = false;
                    derniere_releve = Some(Instant::now());
                    serveur_qresync = lot.qresync;
                    serveur_condstore = lot.condstore;
                    if lot.complet {
                        derniere_complete = Some(Instant::now());
                    }
                    let _ = handle.block_on(noter(&pool, compte.id, "ok"));
                    let _ = handle.block_on(marquer_etat(&pool, compte.id, "connecte", None));
                    for (dossier, releve) in lot.releves {
                        let connu = modseqs.get(&dossier).copied().unwrap_or(0);
                        let _ = handle
                            .block_on(appliquer_dossier(&pool, &compte, &dossier, &releve, connu));
                    }
                }
                Err(ErreurMail::Authentification) => {
                    let _ = handle.block_on(noter(&pool, compte.id, "authentification"));
                    let _ = handle.block_on(marquer_etat(
                        &pool,
                        compte.id,
                        "identifiants_refuses",
                        Some(&compte.empreinte),
                    ));
                    break;
                }
                Err(_) => {
                    let _ = handle.block_on(noter(&pool, compte.id, "connexion"));
                    echecs = echecs.saturating_add(1);
                    std::thread::sleep(delai_echec(echecs));
                    continue;
                }
            }
        }
        if veille.is_none()
            || veille_depuis.elapsed() >= Duration::from_secs(RENOUVELLEMENT_IDLE_SECS)
        {
            match VeilleReception::ouvrir(&compte.parametres) {
                Ok(ouverte) => {
                    veille = Some(ouverte);
                    veille_depuis = Instant::now();
                    let _ = handle.block_on(noter_idle(&pool, compte.id));
                }
                Err(ErreurMail::Authentification) => {
                    let _ = handle.block_on(noter(&pool, compte.id, "authentification"));
                    let _ = handle.block_on(marquer_etat(
                        &pool,
                        compte.id,
                        "identifiants_refuses",
                        Some(&compte.empreinte),
                    ));
                    break;
                }
                Err(_) => {
                    veille = None;
                    let _ = handle.block_on(noter(&pool, compte.id, "connexion"));
                    echecs = echecs.saturating_add(1);
                    std::thread::sleep(delai_echec(echecs));
                    continue;
                }
            }
        }
        let reste_idle = Duration::from_secs(RENOUVELLEMENT_IDLE_SECS)
            .saturating_sub(veille_depuis.elapsed())
            .max(Duration::from_secs(1));
        let reste_releve = derniere_releve.map_or(Duration::from_secs(0), |instant| {
            Duration::from_secs(RELEVE_SANS_REVEIL_SECS).saturating_sub(instant.elapsed())
        });
        let attente = reste_idle.min(reste_releve).min(Duration::from_secs(20));
        match veille
            .as_ref()
            .and_then(|courante| courante.attendre(attente).ok())
        {
            Some(true) => reveil = true,
            Some(false) => {}
            None => veille = None,
        }
    }
}

struct LotReleve {
    releves: Vec<(String, ReleveDossier)>,
    complet: bool,
    qresync: bool,
    condstore: bool,
}

fn relever_session(
    parametres: &ParametresCompte,
    modseqs: &HashMap<String, u64>,
    derniere_complete: Option<std::time::Instant>,
) -> Result<LotReleve, ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    let caps = session.capacites()?;
    let complet_du = derniere_complete.map_or(true, |instant| {
        instant.elapsed() >= Duration::from_secs(RELEVE_SANS_REVEIL_SECS)
    });
    let mut dossiers = vec!["INBOX".to_owned()];
    dossiers.extend(AUTRES_DOSSIERS.iter().map(|nom| (*nom).to_owned()));
    let mut releves = Vec::new();
    let mut complet = false;
    let session_id = Uuid::new_v4();
    for dossier in dossiers {
        let connu = modseqs.get(&dossier).copied().unwrap_or(0);
        let repli = !caps.qresync && !caps.condstore;
        if repli && !complet_du {
            continue;
        }
        let mut releve = match session.synchroniser_dossier(&dossier, connu) {
            Ok(releve) => releve,
            Err(_) => continue,
        };
        if repli {
            complet = true;
        }
        releve.commandes.push(format!("session {session_id}"));
        releve
            .commandes
            .push(format!("IDLE {RENOUVELLEMENT_IDLE_SECS}"));
        releves.push((dossier, releve));
    }
    if releves.is_empty() && !caps.qresync && !caps.condstore && !complet_du {
        return Ok(LotReleve {
            releves,
            complet: false,
            qresync: caps.qresync,
            condstore: caps.condstore,
        });
    }
    Ok(LotReleve {
        releves,
        complet,
        qresync: caps.qresync,
        condstore: caps.condstore,
    })
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

fn changements_condstore(connus: &[EtatUid], releve: &ReleveDossier) -> Vec<Changement> {
    let mut changements = Vec::new();
    let presents: HashSet<u32> = releve.uids_presents.iter().copied().collect();
    for connu in connus {
        if !presents.contains(&connu.uid) {
            changements.push(Changement::Retire { uid: connu.uid });
        }
    }
    for etat in &releve.etats {
        if connus.iter().any(|connu| connu.uid == etat.uid) {
            changements.push(Changement::Drapeaux(etat.clone()));
        } else {
            changements.push(Changement::Ajoute(etat.clone()));
        }
    }
    for uid in &releve.uids_presents {
        let deja = connus.iter().any(|connu| connu.uid == *uid)
            || releve.etats.iter().any(|etat| etat.uid == *uid);
        if !deja {
            changements.push(Changement::Ajoute(EtatUid {
                uid: *uid,
                lu: false,
                drapeaux: String::new(),
            }));
        }
    }
    changements
}

async fn empreinte_compte(pool: &PgPool, compte: Uuid) -> Option<String> {
    let row = sqlx::query_as::<_, (String, i32, String, String)>(
        r#"
        SELECT hote, port, utilisateur, secret_chiffre
        FROM comptes_mail
        WHERE id = $1 AND hote IS NOT NULL AND secret_chiffre IS NOT NULL
        "#,
    )
    .bind(compte)
    .fetch_optional(pool)
    .await
    .ok()??;
    Some(format!("{}|{}|{}|{}", row.0, row.1, row.2, row.3))
}

async fn noter(pool: &PgPool, compte: Uuid, issue: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO moteur_connexions (compte_id, issue) VALUES ($1, $2)")
        .bind(compte)
        .bind(issue)
        .execute(pool)
        .await?;
    Ok(())
}

/// Note une relève hors du moteur (boîte de classement, relevée à la demande) pour le tableau de
/// santé : même table et mêmes issues que le moteur. Une erreur d'écriture n'interrompt jamais la
/// relève (la note est une information, pas une condition).
pub async fn noter_releve(pool: &PgPool, compte: Uuid, issue: Result<(), &ErreurMail>) {
    let (issue, etat) = match issue {
        Ok(()) => ("ok", "connecte"),
        Err(ErreurMail::Authentification) => ("authentification", "identifiants_refuses"),
        Err(_) => ("connexion", "inconnu"),
    };
    if noter(pool, compte, issue).await.is_err() {
        tracing::warn!(compte = %compte, "note de relève non enregistrée");
    }
    // Un échec de connexion ne dit rien des identifiants : l'état précédent est conservé.
    if etat != "inconnu" && marquer_etat(pool, compte, etat, None).await.is_err() {
        tracing::warn!(compte = %compte, "état de connexion non enregistré");
    }
}

async fn marquer_etat(
    pool: &PgPool,
    compte: Uuid,
    etat: &str,
    empreinte: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE comptes_mail SET etat_connexion = $2, empreinte_refus = $3 WHERE id = $1")
        .bind(compte)
        .bind(etat)
        .bind(empreinte)
        .execute(pool)
        .await?;
    Ok(())
}

async fn noter_idle(pool: &PgPool, compte: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO releve_curseurs (compte_id, dossier_imap, uid_validity, dernier_uid, modseq, chemin, commandes)
        VALUES ($1, 'INBOX', 0, 0, 0, 'idle', $2)
        ON CONFLICT (compte_id, dossier_imap) DO UPDATE
            SET commandes = releve_curseurs.commandes || ' ' || EXCLUDED.commandes
        "#,
    )
    .bind(compte)
    .bind(format!("IDLE {RENOUVELLEMENT_IDLE_SECS}"))
    .execute(pool)
    .await?;
    Ok(())
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
    let notifiable = arrivee_notifiable(dossier, validity, releve.uid_validity);
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
        } else if releve.condstore && modseq_connu > 0 && validity == i64::from(releve.uid_validity)
        {
            changements_condstore(&connus, releve)
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
    // Les invitations d'abord : si la lecture du message échoue, rien n'est inscrit ni curseur
    // avancé, et la relève suivante revoit les mêmes messages (l'enregistrement est rejouable).
    traiter_invitations(pool, compte, dossier, &ajouts, &entetes).await?;
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
        notifiable,
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

/// Invitations de calendrier des messages reçus dans la boîte de réception d'une boîte
/// nominative. Seuls les messages dont BODYSTRUCTURE annonce une partie calendrier sont relus en
/// entier. Une boîte sans titulaire, ou un autre dossier que la réception (Envoyés : ce sont les
/// invitations du titulaire lui-même), n'enregistre rien.
async fn traiter_invitations(
    pool: &PgPool,
    compte: &CompteMoteur,
    dossier: &str,
    ajouts: &[EtatUid],
    entetes: &[EnteteRecu],
) -> Result<(), sqlx::Error> {
    let Some(titulaire_id) = compte.titulaire_id else {
        return Ok(());
    };
    if dossier != "INBOX" {
        return Ok(());
    }
    let candidats: Vec<(u32, String)> = ajouts
        .iter()
        .filter_map(|etat| {
            let entete = entetes.iter().find(|entete| entete.uid == etat.uid)?;
            entete
                .calendrier
                .then(|| (entete.uid, entete.message_id.clone()))
        })
        .collect();
    if candidats.is_empty() {
        return Ok(());
    }
    let lues = lire_invitations(&compte.parametres, dossier, &candidats)
        .await
        .map_err(|_| sqlx::Error::Protocol("lecture des invitations impossible".into()))?;
    for (message_id, lue) in &lues {
        let issue = enregistrer_invitation(
            pool,
            &InvitationRecue {
                cabinet_id: compte.cabinet_id,
                titulaire_id,
                compte_id: compte.id,
                message_id,
                lue,
            },
        )
        .await?;
        match issue {
            // Journal de relève : l'identifiant du message et le motif, jamais d'adresse ni d'objet.
            IssueInvitation::Refusee(motif) => tracing::warn!(
                compte = %compte.id,
                message = %message_id,
                motif = motif.motif(),
                "invitation de calendrier refusée : origine non confirmée"
            ),
            _ => {
                tracing::info!(compte = %compte.id, issue = ?issue, "invitation de calendrier relevée")
            }
        }
    }
    Ok(())
}

/// Relit les messages en entier (une connexion) et en tire l'invitation. Un calendrier illisible
/// est écarté sans bloquer la relève ; une connexion qui échoue fait échouer l'appel.
async fn lire_invitations(
    parametres: &ParametresCompte,
    dossier: &str,
    candidats: &[(u32, String)],
) -> Result<Vec<(String, InvitationLue)>, ErreurMail> {
    let parametres = parametres.clone();
    let dossier = dossier.to_owned();
    let candidats = candidats.to_vec();
    tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        let mut lues = Vec::new();
        for (uid, message_id) in candidats {
            let octets = session.lire_rfc822(&dossier, uid)?;
            match invitation_du_message(&octets) {
                Ok(Some(lue)) => lues.push((message_id, lue)),
                Ok(None) => {}
                Err(_) => tracing::warn!(uid, "calendrier illisible, message écarté"),
            }
        }
        Ok(lues)
    })
    .await
    .map_err(|_| ErreurMail::Connexion)?
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

/// Un message ajouté est-il une arrivée à signaler (notification de bureau) ? Seulement dans la
/// réception, et seulement si la boîte était déjà relevée avec le même UIDVALIDITY : la première
/// relève et la reprise après changement d'UIDVALIDITY ramènent de l'historique, pas des arrivées.
/// Un message déjà lu à l'arrivée (lu depuis un autre client avant la relève) ne notifie pas.
#[must_use]
pub fn arrivee_notifiable(dossier: &str, validity_connue: i64, validity_releve: u32) -> bool {
    dossier == "INBOX" && validity_connue != 0 && validity_connue == i64::from(validity_releve)
}

struct Lignes {
    ids: Vec<Uuid>,
    messages: Vec<String>,
    objets: Vec<String>,
    expediteurs: Vec<String>,
    uids: Vec<i64>,
    lus: Vec<bool>,
    drapeaux: Vec<String>,
    destinataires: Vec<String>,
    pieces: Vec<String>,
    extraits: Vec<String>,
}

fn texte_destinataires(entete: Option<&EnteteRecu>) -> String {
    entete
        .map(|entete| entete.destinataires.join(", "))
        .unwrap_or_default()
}

fn texte_extrait(entete: Option<&EnteteRecu>) -> String {
    entete
        .map(|entete| entete.extrait.clone())
        .unwrap_or_default()
}

fn texte_pieces(entete: Option<&EnteteRecu>) -> String {
    entete
        .map(|entete| entete.pieces.join("\n"))
        .unwrap_or_default()
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
        destinataires: Vec::with_capacity(ajouts.len()),
        pieces: Vec::with_capacity(ajouts.len()),
        extraits: Vec::with_capacity(ajouts.len()),
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
        lignes
            .destinataires
            .push(texte_destinataires(entete.copied()));
        lignes.pieces.push(texte_pieces(entete.copied()));
        lignes.extraits.push(texte_extrait(entete.copied()));
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
    notifiable: bool,
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
                objet, expediteur, destinataires_texte, pieces_texte, extrait_texte, etat_classement, dossier_imap, lu, drapeaux,
                arrivee_notifiable
            )
            SELECT t.id, t.cabinet_id, t.compte_id, t.message_id, t.uid_validity, t.uid,
                   t.objet, t.expediteur, t.destinataires_texte, t.pieces_texte, t.extrait_texte, t.etat_classement, t.dossier_imap, t.lu,
                   CASE WHEN t.drapeaux = '' THEN '{}'::text[] ELSE string_to_array(t.drapeaux, ' ') END,
                   $16::boolean AND NOT t.lu
            FROM unnest(
                $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::bigint[], $6::bigint[],
                $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::boolean[], $15::text[]
            ) AS t(id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, destinataires_texte, pieces_texte, extrait_texte, etat_classement, dossier_imap, lu, drapeaux)
            ON CONFLICT (compte_id, message_id) DO UPDATE
                SET lu = EXCLUDED.lu,
                    drapeaux = EXCLUDED.drapeaux,
                    dossier_imap = EXCLUDED.dossier_imap,
                    destinataires_texte = CASE
                        WHEN EXCLUDED.destinataires_texte <> '' THEN EXCLUDED.destinataires_texte
                        ELSE messages.destinataires_texte
                    END,
                    pieces_texte = CASE
                        WHEN EXCLUDED.pieces_texte <> '' THEN EXCLUDED.pieces_texte
                        ELSE messages.pieces_texte
                    END,
                    extrait_texte = CASE
                        WHEN EXCLUDED.extrait_texte <> '' THEN EXCLUDED.extrait_texte
                        ELSE messages.extrait_texte
                    END,
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
        .bind(lignes.destinataires[debut..fin].to_vec())
        .bind(lignes.pieces[debut..fin].to_vec())
        .bind(lignes.extraits[debut..fin].to_vec())
        .bind(vec!["a_classer".to_owned(); taille])
        .bind(vec![dossier.to_owned(); taille])
        .bind(lignes.lus[debut..fin].to_vec())
        .bind(lignes.drapeaux[debut..fin].to_vec())
        .bind(notifiable)
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

#[cfg(test)]
mod tests {
    use super::{
        arrivee_notifiable, delai_echec, texte_destinataires, RELEVE_SANS_REVEIL_SECS,
        RENOUVELLEMENT_IDLE_SECS,
    };
    use legalos_messagerie::EnteteRecu;

    #[test]
    fn destinataires_rejoints() {
        let entete = EnteteRecu {
            uid: 1,
            message_id: "<a@legalos.test>".into(),
            objet: "objet".into(),
            expediteur: "de@example.com".into(),
            destinataires: vec!["un@example.com".into(), "deux@example.com".into()],
            pieces: Vec::new(),
            extrait: String::new(),
            calendrier: false,
        };
        assert_eq!(
            texte_destinataires(Some(&entete)),
            "un@example.com, deux@example.com"
        );
        assert_eq!(texte_destinataires(None), "");
    }

    #[test]
    fn arrivee_notifiable_seulement_apres_une_premiere_releve() {
        // Première relève (rien de connu) : historique.
        assert!(!arrivee_notifiable("INBOX", 0, 77));
        // Boîte déjà relevée, même UIDVALIDITY : arrivée.
        assert!(arrivee_notifiable("INBOX", 77, 77));
        // UIDVALIDITY changé : tout est rechargé, aucune arrivée.
        assert!(!arrivee_notifiable("INBOX", 77, 78));
        // Envoyés : ce sont les envois de l'utilisateur.
        assert!(!arrivee_notifiable("Sent", 77, 77));
    }

    #[test]
    fn delais_de_reprise() {
        let renouvellement = std::hint::black_box(RENOUVELLEMENT_IDLE_SECS);
        let releve = std::hint::black_box(RELEVE_SANS_REVEIL_SECS);
        let court = std::hint::black_box(delai_echec(1));
        let long = std::hint::black_box(delai_echec(3));
        assert!(std::hint::black_box(delai_echec(0)) >= std::time::Duration::from_secs(1));
        assert!(long > court);
        assert!(renouvellement < 29 * 60);
        assert_eq!(releve, 10 * 60);
    }
}
