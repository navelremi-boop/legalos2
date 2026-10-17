//! Actions sur les messages d'une boîte (J11, critère iii) : lu / non lu, archiver, supprimer,
//! déplacer. La table `actions_messages` est la file ; ce module est son exécuteur.
//!
//! **Règles**
//!
//! * Une action n'agit sur `messages` (lu, dossier) qu'une fois confirmée par le serveur IMAP, dans
//!   la transaction qui la passe à « appliquee » : le poste ne reçoit jamais un état que le serveur
//!   n'a pas pris.
//! * « Supprimer » déplace vers la Corbeille du compte. Aucun message n'est expurgé : un message
//!   déjà dans la Corbeille y reste. Un original n'est retiré d'un dossier que si sa copie est
//!   confirmée ailleurs (voir `SessionActions::deplacer_message`).
//! * **Reprise** : une action prise reçoit un bail (`BAIL_SECS`). Coupure du serveur IMAP : la
//!   tentative échoue, l'action est reportée (délai croissant) et le balayage la reprend. Coupure
//!   de l'API : le bail expire (et est levé au démarrage), le balayage reprend l'action.
//! * **Sans doublon au rejeu** : avant de déplacer, le message est retrouvé par son `Message-ID`.
//!   Déjà à destination, il n'est pas recopié ; poser `\Seen` deux fois est sans effet.
//! * **Ordre** : les actions d'un même message sont appliquées dans l'ordre de leur arrivée.
//!
//! Journaux : identifiants techniques seulement, jamais d'objet, d'adresse ni de nom de dossier.

use legalos_messagerie::{
    Emplacement, ErreurMail, IssueDeplacement, ParametresCompte, SessionActions,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::routes::redaction::parametres_imap_depuis;

/// Durée pendant laquelle une action prise n'est confiée à personne d'autre.
pub const BAIL_SECS: i64 = 120;
/// Période du balayage des actions dues.
pub const BALAYAGE_ACTIONS_SECS: u64 = 5;
/// Actions reprises par balayage.
const LOT_BALAYAGE: i64 = 20;
/// Tentatives avant d'abandonner quand le serveur est injoignable ou refuse les identifiants
/// (au pas maximal de 10 minutes : plusieurs heures).
const TENTATIVES_MAX_RESEAU: i32 = 40;
/// Tentatives avant d'abandonner quand le serveur refuse la commande elle-même.
const TENTATIVES_MAX_PROTOCOLE: i32 = 5;
const DELAI_REPRISE_MAX_SECS: i64 = 600;

/// Ce que l'utilisateur demande.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenreAction {
    Lu,
    NonLu,
    Archiver,
    Supprimer,
    Deplacer,
}

impl GenreAction {
    pub fn depuis_texte(texte: &str) -> Option<Self> {
        match texte {
            "lu" => Some(Self::Lu),
            "non_lu" => Some(Self::NonLu),
            "archiver" => Some(Self::Archiver),
            "supprimer" => Some(Self::Supprimer),
            "deplacer" => Some(Self::Deplacer),
            _ => None,
        }
    }

    pub fn texte(self) -> &'static str {
        match self {
            Self::Lu => "lu",
            Self::NonLu => "non_lu",
            Self::Archiver => "archiver",
            Self::Supprimer => "supprimer",
            Self::Deplacer => "deplacer",
        }
    }
}

/// Pourquoi une tentative n'a pas abouti.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Echec {
    Connexion,
    Authentification,
    Protocole,
    /// Compte illisible depuis le serveur (identifiants absents ou non déchiffrables).
    Compte,
    /// Lecture ou écriture en base impossible.
    Base,
    /// Le message n'est plus sur le serveur (retiré par un autre client).
    MessageAbsent,
}

impl Echec {
    pub fn code(self) -> &'static str {
        match self {
            Self::Connexion => "connexion",
            Self::Authentification => "authentification",
            Self::Protocole => "protocole",
            Self::Compte => "compte",
            Self::Base => "base",
            Self::MessageAbsent => "message_absent",
        }
    }

    /// Faut-il cesser de réessayer, après ce nombre de tentatives ? Un message disparu ne
    /// reviendra pas ; une commande refusée cinq fois ne sera pas acceptée la sixième ; un serveur
    /// injoignable ou des identifiants à corriger se réessaient longtemps.
    pub fn definitif(self, tentatives: i32) -> bool {
        match self {
            Self::MessageAbsent => true,
            Self::Protocole => tentatives >= TENTATIVES_MAX_PROTOCOLE,
            _ => tentatives >= TENTATIVES_MAX_RESEAU,
        }
    }
}

impl From<ErreurMail> for Echec {
    fn from(erreur: ErreurMail) -> Self {
        match erreur {
            ErreurMail::Connexion => Self::Connexion,
            ErreurMail::Authentification => Self::Authentification,
            ErreurMail::Protocole => Self::Protocole,
        }
    }
}

/// Délai avant la tentative suivante : 5 s, 10 s, 20 s… plafonné à 10 minutes.
pub fn delai_reprise_secs(tentatives: i32) -> i64 {
    let pas = u32::try_from(tentatives.saturating_sub(1).clamp(0, 10)).unwrap_or(10);
    (5_i64 << pas).min(DELAI_REPRISE_MAX_SECS)
}

/// Action prise par une tâche.
struct Prise {
    id: Uuid,
    compte_id: Uuid,
    message_ref: Uuid,
    message_id: String,
    genre: GenreAction,
    destination: Option<String>,
    tentatives: i32,
}

/// Résultat d'une exécution côté serveur IMAP.
enum Sortie {
    Lu(bool),
    Place {
        dossier: String,
        emplacement: Emplacement,
    },
    Absent,
}

/// Accès IMAP des actions : base, clé de chiffrement des identifiants et boîte de classement.
#[derive(Clone)]
pub struct ActionsMessages {
    pool: PgPool,
    cle: [u8; 32],
    classement: Option<ParametresCompte>,
}

impl ActionsMessages {
    pub fn new(pool: PgPool, cle: [u8; 32], classement: Option<ParametresCompte>) -> Self {
        Self {
            pool,
            cle,
            classement,
        }
    }

    /// Au démarrage de l'API, aucune tâche n'est en cours : les baux d'une API coupée sont levés
    /// pour que le balayage reprenne ses actions sans attendre leur échéance.
    pub async fn lever_les_baux(&self) {
        let levee = sqlx::query(
            "UPDATE actions_messages SET reserve_jusqu_le = NULL \
             WHERE etat = 'en_attente' AND reserve_jusqu_le IS NOT NULL",
        )
        .execute(&self.pool)
        .await;
        if levee.is_err() {
            tracing::warn!("baux des actions sur les messages non levés au démarrage");
        }
    }

    /// Lance les actions dues : une tâche par action, le bail empêche tout doublon. Une boîte
    /// injoignable ne retarde donc pas les autres. Retourne le nombre d'actions lancées.
    pub async fn balayer(&self) -> usize {
        let ids = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id FROM actions_messages
            WHERE etat = 'en_attente'
              AND prochaine_tentative_le <= NOW()
              AND (reserve_jusqu_le IS NULL OR reserve_jusqu_le < NOW())
            ORDER BY rang
            LIMIT $1
            "#,
        )
        .bind(LOT_BALAYAGE)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        let nombre = ids.len();
        for id in ids {
            let executeur = self.clone();
            tokio::spawn(async move { executeur.appliquer(id).await });
        }
        nombre
    }

    /// Prend l'action si elle est due, libre et la plus ancienne en attente de son message, la
    /// joue sur le serveur IMAP, puis la conclut ou la reporte. Sans effet si l'action n'est pas
    /// prenable (déjà appliquée, bail en cours, action plus ancienne sur le même message, délai
    /// de reprise non écoulé).
    pub async fn appliquer(&self, id: Uuid) {
        let prise = match self.prendre(id).await {
            Ok(Some(prise)) => prise,
            Ok(None) => return,
            Err(_) => {
                tracing::warn!(action = %id, "prise de l'action impossible");
                return;
            }
        };
        let suite = match self.executer(&prise).await {
            Ok(sortie) => self.conclure(&prise, sortie).await,
            Err(echec) => self.reporter(&prise, echec).await,
        };
        if suite.is_err() {
            // Le bail expirera : l'action sera reprise, et le rejeu est sans doublon.
            tracing::warn!(action = %id, "état de l'action non enregistré");
        }
    }

    async fn prendre(&self, id: Uuid) -> Result<Option<Prise>, sqlx::Error> {
        let ligne = sqlx::query_as::<_, (Uuid, Uuid, String, String, Option<String>, i32)>(
            r#"
            UPDATE actions_messages a
            SET reserve_jusqu_le = NOW() + make_interval(secs => $2::double precision),
                tentatives = a.tentatives + 1,
                revision = a.revision + 1
            WHERE a.id = $1
              AND a.etat = 'en_attente'
              AND a.prochaine_tentative_le <= NOW()
              AND (a.reserve_jusqu_le IS NULL OR a.reserve_jusqu_le < NOW())
              AND NOT EXISTS (
                SELECT 1 FROM actions_messages avant
                WHERE avant.message_ref = a.message_ref
                  AND avant.etat = 'en_attente'
                  AND avant.rang < a.rang
              )
            RETURNING a.compte_id, a.message_ref, a.message_id, a.genre, a.destination,
                      a.tentatives
            "#,
        )
        .bind(id)
        .bind(BAIL_SECS as f64)
        .fetch_optional(&self.pool)
        .await?;
        let Some((compte_id, message_ref, message_id, genre, destination, tentatives)) = ligne
        else {
            return Ok(None);
        };
        let Some(genre) = GenreAction::depuis_texte(&genre) else {
            return Ok(None);
        };
        Ok(Some(Prise {
            id,
            compte_id,
            message_ref,
            message_id,
            genre,
            destination,
            tentatives,
        }))
    }

    async fn executer(&self, prise: &Prise) -> Result<Sortie, Echec> {
        // Position actuelle du message : celle que les actions précédentes ont laissée.
        let position = sqlx::query_as::<_, (String, i64, i64, String)>(
            r#"
            SELECT m.dossier_imap, m.uid, m.uid_validity, c.type_compte
            FROM messages m
            INNER JOIN comptes_mail c ON c.id = m.compte_id
            WHERE m.id = $1
            "#,
        )
        .bind(prise.message_ref)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| Echec::Base)?;
        let Some((dossier, uid, uid_validity, type_compte)) = position else {
            return Err(Echec::MessageAbsent);
        };
        let dossier = if dossier.is_empty() {
            "INBOX".to_owned()
        } else {
            dossier
        };
        sqlx::query(
            "UPDATE actions_messages \
             SET dossier_source = $2, uid_source = $3, uid_validity_source = $4 WHERE id = $1",
        )
        .bind(prise.id)
        .bind(&dossier)
        .bind(uid)
        .bind(uid_validity)
        .execute(&self.pool)
        .await
        .map_err(|_| Echec::Base)?;
        let parametres = parametres_imap_depuis(
            &self.pool,
            &self.cle,
            self.classement.as_ref(),
            prise.compte_id,
            &type_compte,
        )
        .await
        .map_err(|_| Echec::Compte)?;

        // Un UID ou une UIDVALIDITY illisibles ne sont qu'un indice perdu : le message est alors
        // retrouvé par son Message-ID.
        let uid = u32::try_from(uid).unwrap_or(0);
        let uid_validity = u32::try_from(uid_validity).unwrap_or(0);
        let message_id = prise.message_id.clone();
        let genre = prise.genre;
        let destination = prise.destination.clone();
        tokio::task::spawn_blocking(move || {
            jouer(
                &parametres,
                genre,
                destination.as_deref(),
                &dossier,
                uid_validity,
                uid,
                &message_id,
            )
        })
        .await
        .map_err(|_| Echec::Connexion)?
        .map_err(Echec::from)
    }

    /// Reflète l'action dans `messages` et la passe à « appliquee », dans une transaction. Une
    /// tâche perdue qui conclurait après une autre ne trouve plus l'action en attente et ne
    /// touche pas à `messages` (une action suivante a pu déplacer le message depuis).
    async fn conclure(&self, prise: &Prise, sortie: Sortie) -> Result<(), sqlx::Error> {
        let (dossier_final, lu, place) = match &sortie {
            Sortie::Absent => return self.reporter(prise, Echec::MessageAbsent).await,
            Sortie::Lu(lu) => (None, Some(*lu), None),
            Sortie::Place {
                dossier,
                emplacement,
            } => (Some(dossier.as_str()), None, Some(*emplacement)),
        };
        let mut tx = self.pool.begin().await?;
        let conclue = sqlx::query(
            r#"
            UPDATE actions_messages
            SET etat = 'appliquee', applique_le = NOW(), reserve_jusqu_le = NULL, erreur = NULL,
                dossier_final = $2, revision = revision + 1
            WHERE id = $1 AND etat = 'en_attente'
            "#,
        )
        .bind(prise.id)
        .bind(dossier_final)
        .execute(&mut *tx)
        .await?;
        if conclue.rows_affected() == 0 {
            return Ok(());
        }
        if let Some(lu) = lu {
            sqlx::query(
                r#"
                UPDATE messages
                SET lu = $2,
                    drapeaux = ARRAY(
                        SELECT DISTINCT d
                        FROM unnest(
                            CASE WHEN $2 THEN array_append(drapeaux, 'Seen')
                                 ELSE array_remove(drapeaux, 'Seen') END
                        ) AS d
                        ORDER BY d
                    ),
                    revision = revision + 1
                WHERE id = $1
                  AND (lu IS DISTINCT FROM $2 OR ('Seen' = ANY(drapeaux)) IS DISTINCT FROM $2)
                "#,
            )
            .bind(prise.message_ref)
            .bind(lu)
            .execute(&mut *tx)
            .await?;
        }
        if let (Some(dossier), Some(emplacement)) = (dossier_final, place) {
            // L'UID et la UIDVALIDITY du dossier de destination ne remplacent ceux de la ligne
            // que s'ils ne heurtent pas la ligne d'un autre message (contrainte d'unicité
            // `compte, UIDVALIDITY, UID` qui ne tient pas compte du dossier) ; sinon ils restent
            // l'indice d'origine, et le message est retrouvé par son Message-ID.
            sqlx::query(
                r#"
                UPDATE messages m
                SET dossier_imap = $2,
                    uid = CASE WHEN $3::bigint IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM messages o
                            WHERE o.compte_id = m.compte_id AND o.id <> m.id
                              AND o.uid_validity = $4 AND o.uid = $3)
                        THEN $3 ELSE m.uid END,
                    uid_validity = CASE WHEN $3::bigint IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM messages o
                            WHERE o.compte_id = m.compte_id AND o.id <> m.id
                              AND o.uid_validity = $4 AND o.uid = $3)
                        THEN $4 ELSE m.uid_validity END,
                    revision = m.revision + 1
                WHERE m.id = $1
                "#,
            )
            .bind(prise.message_ref)
            .bind(dossier)
            .bind(emplacement.uid.map(i64::from))
            .bind(i64::from(emplacement.uid_validity))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await
    }

    /// Reporte l'action (délai croissant), ou l'abandonne si l'échec est définitif.
    async fn reporter(&self, prise: &Prise, echec: Echec) -> Result<(), sqlx::Error> {
        let definitif = echec.definitif(prise.tentatives);
        sqlx::query(
            r#"
            UPDATE actions_messages
            SET reserve_jusqu_le = NULL,
                prochaine_tentative_le = NOW() + make_interval(secs => $2::double precision),
                erreur = $3,
                etat = CASE WHEN $4 THEN 'echec' ELSE etat END,
                revision = revision + 1
            WHERE id = $1 AND etat = 'en_attente'
            "#,
        )
        .bind(prise.id)
        .bind(delai_reprise_secs(prise.tentatives) as f64)
        .bind(echec.code())
        .bind(definitif)
        .execute(&self.pool)
        .await?;
        tracing::warn!(
            action = %prise.id,
            erreur = echec.code(),
            tentatives = prise.tentatives,
            definitif,
            "action sur un message reportée"
        );
        Ok(())
    }
}

/// Joue l'action sur le serveur IMAP (appel bloquant).
fn jouer(
    parametres: &ParametresCompte,
    genre: GenreAction,
    destination: Option<&str>,
    dossier: &str,
    uid_validity: u32,
    uid: u32,
    message_id: &str,
) -> Result<Sortie, ErreurMail> {
    let mut session = SessionActions::connecter(parametres)?;
    let cible = match genre {
        GenreAction::Lu | GenreAction::NonLu => {
            let lu = genre == GenreAction::Lu;
            return Ok(
                if session.marquer_lu_message(dossier, uid_validity, uid, message_id, lu)? {
                    Sortie::Lu(lu)
                } else {
                    Sortie::Absent
                },
            );
        }
        GenreAction::Archiver => session.dossier_archives()?,
        GenreAction::Supprimer => session.dossier_corbeille()?,
        GenreAction::Deplacer => destination.ok_or(ErreurMail::Protocole)?.to_owned(),
    };
    Ok(
        match session.deplacer_message(dossier, uid_validity, uid, message_id, &cible)? {
            IssueDeplacement::Place { emplacement, .. } => Sortie::Place {
                dossier: cible,
                emplacement,
            },
            IssueDeplacement::Introuvable => Sortie::Absent,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{delai_reprise_secs, Echec, GenreAction};

    #[test]
    fn delai_croissant_puis_plafonne_a_dix_minutes() {
        assert_eq!(delai_reprise_secs(1), 5);
        assert_eq!(delai_reprise_secs(2), 10);
        assert_eq!(delai_reprise_secs(3), 20);
        assert_eq!(delai_reprise_secs(8), 600);
        assert_eq!(delai_reprise_secs(40), 600);
        // Entrées hors plage : jamais de débordement ni de délai nul.
        assert_eq!(delai_reprise_secs(0), 5);
        assert_eq!(delai_reprise_secs(-3), 5);
        assert_eq!(delai_reprise_secs(i32::MAX), 600);
    }

    #[test]
    fn un_message_disparu_est_definitif_un_serveur_coupe_se_reessaie() {
        assert!(Echec::MessageAbsent.definitif(1));
        assert!(!Echec::Connexion.definitif(1));
        assert!(!Echec::Connexion.definitif(39));
        assert!(Echec::Connexion.definitif(40));
        assert!(!Echec::Authentification.definitif(5));
        assert!(!Echec::Protocole.definitif(4));
        assert!(Echec::Protocole.definitif(5));
    }

    #[test]
    fn genres_connus_et_inconnus() {
        for genre in ["lu", "non_lu", "archiver", "supprimer", "deplacer"] {
            let lu = GenreAction::depuis_texte(genre);
            assert_eq!(lu.map(GenreAction::texte), Some(genre));
        }
        for faux in ["", "Lu", "expunge", "supprimer ", "purger", "lu;"] {
            assert_eq!(GenreAction::depuis_texte(faux), None, "{faux:?}");
        }
    }
}
