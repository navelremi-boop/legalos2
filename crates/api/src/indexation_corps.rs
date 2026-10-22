//! Indexation de fond du corps de tous les messages (J11, consigne de l'architecte du 20/10/2026).
//!
//! Le serveur lit, boîte par boîte, le corps des messages que la recherche ne connaît encore que par leur début
//! (`extrait_texte`), **les plus récents d'abord**, et en tire un vecteur de recherche complet
//! (`messages_corps_index`, migration 047). Garanties :
//!
//! * **aucun effet sur la boîte** : lecture seule (EXAMINE) et `BODY.PEEK[]`, jamais de drapeau `\Seen` posé ;
//! * **aucune écriture dans `messages`** : la table est répliquée vers PowerSync, chaque écriture ajouterait une
//!   opération au seau des utilisateurs ; le corps indexé ne quitte jamais le serveur ;
//! * **débit borné** : 20 messages au plus par boîte et par tour, une connexion IMAP à la fois, pause entre les tours ;
//! * **reprise** : l'état est en base (un message indexé a sa ligne), un redémarrage de l'API reprend où il en était ;
//! * **échecs bornés** : un message illisible est retenté puis abandonné au troisième échec, compté à l'écran de
//!   santé ; une boîte dont les identifiants sont refusés est laissée de côté ;
//! * **rien dans les journaux** que des identifiants techniques : jamais de texte, d'objet ni d'adresse.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use legalos_messagerie::{ErreurMail, ParametresCompte, SessionActions};
use sqlx::PgPool;
use uuid::Uuid;

use crate::routes::redaction::parametres_imap_depuis;

/// Messages lus au plus par boîte et par tour.
pub const LOT: i64 = 20;
const PAUSE_ACTIVE: Duration = Duration::from_secs(2);
const PAUSE_REPOS: Duration = Duration::from_secs(60);
const PAUSE_BOITE_REFUSEE: Duration = Duration::from_secs(30 * 60);
const PAUSE_BOITE_INJOIGNABLE: Duration = Duration::from_secs(90);
/// Caractères du corps gardés pour l'index (un tsvector ne dépasse pas 1 Mo).
pub const CARACTERES_MAX: usize = 100_000;
/// Au troisième échec, le message est abandonné.
pub const TENTATIVES_MAX: i32 = 3;

/// Avancement de l'indexation d'une boîte, pour l'écran de santé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progression {
    pub indexes: i64,
    pub restants: i64,
    pub abandonnes: i64,
}

pub fn demarrer(pool: PgPool, cle: [u8; 32], classement: Option<ParametresCompte>) {
    tokio::spawn(async move {
        boucle(pool, cle, classement).await;
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pause {
    /// Identifiants refusés par le serveur : on laisse la boîte tranquille longtemps.
    Refusee,
    /// Serveur injoignable ou en erreur passagère.
    Injoignable,
}

async fn boucle(pool: PgPool, cle: [u8; 32], classement: Option<ParametresCompte>) {
    let mut en_pause: HashMap<Uuid, Instant> = HashMap::new();
    loop {
        // Les messages déjà ouverts ont leur texte dans leur vecteur : aucune lecture IMAP.
        let ouverts = marquer_messages_ouverts(&pool).await.unwrap_or(0);
        let mut travail = ouverts > 0;
        if let Ok(comptes) = comptes_a_indexer(&pool).await {
            for (compte_id, type_compte) in comptes {
                if en_pause
                    .get(&compte_id)
                    .is_some_and(|fin| *fin > Instant::now())
                {
                    continue;
                }
                match indexer_un_lot(&pool, &cle, classement.as_ref(), compte_id, &type_compte)
                    .await
                {
                    Ok(lus) => travail |= lus > 0,
                    Err(Pause::Refusee) => {
                        en_pause.insert(compte_id, Instant::now() + PAUSE_BOITE_REFUSEE);
                    }
                    Err(Pause::Injoignable) => {
                        en_pause.insert(compte_id, Instant::now() + PAUSE_BOITE_INJOIGNABLE);
                    }
                }
            }
        }
        tokio::time::sleep(if travail { PAUSE_ACTIVE } else { PAUSE_REPOS }).await;
    }
}

/// Un message dont le corps complet est déjà stocké (`texte_brut`, lu par l'utilisateur) est déjà cherché en
/// entier par `messages.recherche_tsv` : on l'inscrit à l'index sans rien lire.
async fn marquer_messages_ouverts(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let resultat = sqlx::query(
        r#"
        INSERT INTO messages_corps_index (message_ref, cabinet_id, compte_id, tsv)
        SELECT m.id, m.cabinet_id, m.compte_id, m.recherche_tsv
        FROM messages m
        WHERE m.texte_brut <> ''
          AND NOT EXISTS (SELECT 1 FROM messages_corps_index i WHERE i.message_ref = m.id)
        LIMIT 500
        ON CONFLICT (message_ref) DO NOTHING
        "#,
    )
    .execute(pool)
    .await?;
    Ok(resultat.rows_affected())
}

async fn comptes_a_indexer(pool: &PgPool) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT c.id, c.type_compte
        FROM comptes_mail c
        WHERE c.etat_connexion IS DISTINCT FROM 'identifiants_refuses'
          AND EXISTS (
              SELECT 1 FROM messages m
              WHERE m.compte_id = c.id
                AND NOT EXISTS (SELECT 1 FROM messages_corps_index i WHERE i.message_ref = m.id)
                AND NOT EXISTS (
                    SELECT 1 FROM messages_corps_echecs e
                    WHERE e.message_ref = m.id AND (e.tentatives >= $1 OR e.prochaine_le > NOW())
                )
          )
        ORDER BY c.cree_le
        LIMIT 50
        "#,
    )
    .bind(TENTATIVES_MAX)
    .fetch_all(pool)
    .await
}

type LigneAIndexer = (Uuid, String, i64, i64);

/// Lit et indexe un lot de messages d'une boîte. Rend le nombre de messages traités (indexés ou notés en échec).
async fn indexer_un_lot(
    pool: &PgPool,
    cle: &[u8; 32],
    classement: Option<&ParametresCompte>,
    compte_id: Uuid,
    type_compte: &str,
) -> Result<usize, Pause> {
    let lignes: Vec<LigneAIndexer> = sqlx::query_as(
        r#"
        SELECT m.id, m.dossier_imap, m.uid, m.uid_validity
        FROM messages m
        WHERE m.compte_id = $1
          AND NOT EXISTS (SELECT 1 FROM messages_corps_index i WHERE i.message_ref = m.id)
          AND NOT EXISTS (
              SELECT 1 FROM messages_corps_echecs e
              WHERE e.message_ref = m.id AND (e.tentatives >= $3 OR e.prochaine_le > NOW())
          )
        ORDER BY COALESCE(m.date_entete, m.cree_le) DESC, m.id
        LIMIT $2
        "#,
    )
    .bind(compte_id)
    .bind(LOT)
    .bind(TENTATIVES_MAX)
    .fetch_all(pool)
    .await
    .map_err(|_| Pause::Injoignable)?;
    if lignes.is_empty() {
        return Ok(0);
    }
    let parametres = parametres_imap_depuis(pool, cle, classement, compte_id, type_compte)
        .await
        .map_err(|erreur| {
            if erreur.status() == axum::http::StatusCode::CONFLICT {
                Pause::Refusee
            } else {
                Pause::Injoignable
            }
        })?;

    // Par dossier et par génération (UIDVALIDITY) : une connexion, une lecture par groupe.
    let mut groupes: BTreeMap<(String, i64), Vec<(u32, Uuid)>> = BTreeMap::new();
    for (id, dossier, uid, validity) in &lignes {
        let Ok(uid) = u32::try_from(*uid) else {
            continue;
        };
        groupes
            .entry((dossier.clone(), *validity))
            .or_default()
            .push((uid, *id));
    }
    let a_lire: Vec<(String, u32, Vec<u32>)> = groupes
        .iter()
        .filter_map(|((dossier, validity), messages)| {
            Some((
                dossier.clone(),
                u32::try_from(*validity).ok()?,
                messages.iter().map(|(uid, _)| *uid).collect(),
            ))
        })
        .collect();
    let lus = tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        let mut sortie = Vec::with_capacity(a_lire.len());
        for (dossier, validity, uids) in a_lire {
            let textes = session.textes_sans_effet(&dossier, validity, &uids)?;
            sortie.push((dossier, validity, textes));
        }
        Ok::<_, ErreurMail>(sortie)
    })
    .await
    .map_err(|_| Pause::Injoignable)?
    .map_err(|erreur| match erreur {
        ErreurMail::Authentification => Pause::Refusee,
        _ => Pause::Injoignable,
    })?;

    let mut traites = 0;
    for (dossier, validity, textes) in lus {
        let Some(messages) = groupes.get(&(dossier, i64::from(validity))) else {
            continue;
        };
        for (uid, message_ref) in messages {
            if !textes.valide {
                // Les UID ne désignent plus les mêmes messages : la relève va les remettre à jour.
                noter_echec(pool, *message_ref, compte_id, "uidvalidity", false).await;
            } else if let Some(texte) = textes.textes.get(uid) {
                if inscrire(pool, *message_ref, texte).await.is_err() {
                    noter_echec(pool, *message_ref, compte_id, "texte", true).await;
                }
            } else {
                noter_echec(pool, *message_ref, compte_id, "absent", true).await;
            }
            traites += 1;
        }
    }
    Ok(traites)
}

/// Retire ce que PostgreSQL refuse dans un texte (octet nul) et borne la longueur.
#[must_use]
pub fn texte_pour_index(texte: &str) -> String {
    texte
        .chars()
        .filter(|c| *c != '\0')
        .take(CARACTERES_MAX)
        .collect()
}

async fn inscrire(pool: &PgPool, message_ref: Uuid, texte: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO messages_corps_index (message_ref, cabinet_id, compte_id, tsv)
        SELECT m.id, m.cabinet_id, m.compte_id,
               m.recherche_tsv
               || setweight(to_tsvector('french', recherche_normaliser($2)), 'C')
        FROM messages m
        WHERE m.id = $1
        ON CONFLICT (message_ref) DO NOTHING
        "#,
    )
    .bind(message_ref)
    .bind(texte_pour_index(texte))
    .execute(pool)
    .await?;
    sqlx::query("DELETE FROM messages_corps_echecs WHERE message_ref = $1")
        .bind(message_ref)
        .execute(pool)
        .await?;
    Ok(())
}

/// Note un échec de lecture. `compte` : le tour compte pour un essai (sinon le message est seulement repoussé).
async fn noter_echec(pool: &PgPool, message_ref: Uuid, compte_id: Uuid, code: &str, compte: bool) {
    let delai_minutes: i64 = if compte { 60 } else { 10 };
    let _ = sqlx::query(
        r#"
        INSERT INTO messages_corps_echecs (message_ref, compte_id, tentatives, erreur, prochaine_le)
        VALUES ($1, $2, $3, $4, NOW() + ($5::bigint * INTERVAL '1 minute'))
        ON CONFLICT (message_ref) DO UPDATE
            SET tentatives = messages_corps_echecs.tentatives + $3,
                erreur = EXCLUDED.erreur,
                prochaine_le = EXCLUDED.prochaine_le
        "#,
    )
    .bind(message_ref)
    .bind(compte_id)
    .bind(i32::from(compte))
    .bind(code)
    .bind(delai_minutes)
    .execute(pool)
    .await;
}

/// Avancement de l'indexation d'une boîte (écran de santé).
pub async fn progression(pool: &PgPool, compte_id: Uuid) -> Result<Progression, sqlx::Error> {
    let (indexes, restants, abandonnes) = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        SELECT
            (SELECT COUNT(*)::bigint FROM messages_corps_index i WHERE i.compte_id = $1),
            (SELECT COUNT(*)::bigint FROM messages m WHERE m.compte_id = $1
                AND NOT EXISTS (SELECT 1 FROM messages_corps_index i WHERE i.message_ref = m.id)),
            (SELECT COUNT(*)::bigint FROM messages_corps_echecs e
                WHERE e.compte_id = $1 AND e.tentatives >= $2)
        "#,
    )
    .bind(compte_id)
    .bind(TENTATIVES_MAX)
    .fetch_one(pool)
    .await?;
    Ok(Progression {
        indexes,
        restants: (restants - abandonnes).max(0),
        abandonnes,
    })
}

#[cfg(test)]
mod tests {
    use super::{texte_pour_index, CARACTERES_MAX};

    #[test]
    fn le_texte_indexe_est_borne_et_sans_octet_nul() {
        assert_eq!(texte_pour_index("a\0b"), "ab");
        let long = "é".repeat(CARACTERES_MAX + 50);
        assert_eq!(texte_pour_index(&long).chars().count(), CARACTERES_MAX);
        assert_eq!(texte_pour_index(""), "");
    }
}
