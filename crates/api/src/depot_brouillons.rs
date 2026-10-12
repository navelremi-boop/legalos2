//! Copie des brouillons dans le dossier Brouillons du serveur IMAP (J11, étape 1b).
//!
//! La ligne `brouillons_message` est la source de vérité ; la copie IMAP en est le reflet pour les
//! autres clients mail. Chaque version est déposée par APPEND (`\Draft`, `\Seen`), puis les
//! versions précédentes de même `Message-ID` sont retirées : jamais zéro copie si l'APPEND échoue.
//!
//! Le dépôt a lieu hors de la requête HTTP (tâche de fond après l'écriture), avec reprise :
//! `imap_etat = 'erreur'` après un échec, nouvelle tentative à la sauvegarde suivante et par le
//! balayage du moteur de messagerie. Un brouillon supprimé ou envoyé passe à `a_retirer` (masqué du
//! poste) jusqu'au retrait de sa copie, puis la ligne disparaît.
//!
//! Journaux : identifiants techniques seulement, jamais d'objet, d'adresse ni de contenu.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use legalos_messagerie::{ParametresCompte, PieceJointe, SessionActions};
use sqlx::PgPool;
use uuid::Uuid;

use crate::routes::redaction::{
    liste_depuis_texte, octets_brouillon, parametres_imap_depuis, ContenuEnvoi,
};

/// Brouillons repris à chaque balayage.
const LOT_BALAYAGE: i64 = 20;

/// Verrous par brouillon : un seul dépôt ou retrait à la fois pour une même ligne, de sorte qu'une
/// copie ne ressuscite pas après un retrait et que deux versions ne se croisent pas.
static VERROUS: LazyLock<Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn verrou_pour(id: Uuid) -> Arc<tokio::sync::Mutex<()>> {
    let mut table = VERROUS.lock().unwrap_or_else(|err| err.into_inner());
    if table.len() > 256 {
        // Les verrous que plus personne ne tient ni n'attend sont oubliés.
        table.retain(|_, verrou| Arc::strong_count(verrou) > 1);
    }
    Arc::clone(
        table
            .entry(id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    )
}

/// Ce que le dépôt a fait d'un brouillon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueDepot {
    /// La copie IMAP reflète la dernière version.
    Depose,
    /// Rien à faire : la copie était déjà à jour, ou la ligne n'existe plus.
    RienAFaire,
    /// Dépôt impossible (serveur, identifiants, message non constructible) : repris plus tard.
    Echec,
}

/// Accès IMAP des brouillons : base, clé de chiffrement des identifiants et boîte de classement.
#[derive(Clone)]
pub struct DepotBrouillons {
    pool: PgPool,
    cle: [u8; 32],
    classement: Option<ParametresCompte>,
}

struct LigneDepot {
    compte_id: Uuid,
    type_compte: String,
    message_id: String,
    expediteur: String,
    imap_etat: String,
    revision: i64,
    contenu: ContenuEnvoi,
}

impl DepotBrouillons {
    pub fn new(pool: PgPool, cle: [u8; 32], classement: Option<ParametresCompte>) -> Self {
        Self {
            pool,
            cle,
            classement,
        }
    }

    /// Dépose la dernière version du brouillon si sa copie n'est pas à jour.
    pub async fn deposer(&self, id: Uuid) -> IssueDepot {
        let verrou = verrou_pour(id);
        let _garde = verrou.lock().await;
        let ligne = match self.charger(id).await {
            Ok(Some(ligne)) => ligne,
            Ok(None) => return IssueDepot::RienAFaire,
            Err(_) => {
                tracing::warn!(brouillon = %id, "lecture du brouillon impossible pour le dépôt");
                return IssueDepot::Echec;
            }
        };
        if ligne.imap_etat != "a_deposer" && ligne.imap_etat != "erreur" {
            return IssueDepot::RienAFaire;
        }
        let issue = self.deposer_ligne(id, &ligne).await;
        let etat = if issue { "depose" } else { "erreur" };
        // Compare-and-set sur la révision : si le brouillon a changé pendant le dépôt, son état
        // reste « a_deposer » et la version suivante est déposée par la tâche qui la suit.
        let maj = sqlx::query(
            r#"
            UPDATE brouillons_message
            SET imap_etat = $3, imap_maj_le = NOW()
            WHERE id = $1 AND revision = $2 AND imap_etat IN ('a_deposer', 'erreur')
            "#,
        )
        .bind(id)
        .bind(ligne.revision)
        .bind(etat)
        .execute(&self.pool)
        .await;
        if maj.is_err() {
            tracing::warn!(brouillon = %id, "état de la copie IMAP non enregistré");
            return IssueDepot::Echec;
        }
        if issue {
            IssueDepot::Depose
        } else {
            IssueDepot::Echec
        }
    }

    async fn deposer_ligne(&self, id: Uuid, ligne: &LigneDepot) -> bool {
        let octets = match octets_brouillon(&ligne.expediteur, &ligne.contenu) {
            Ok(octets) => octets,
            Err(_) => {
                tracing::warn!(brouillon = %id, "construction de la copie IMAP impossible");
                return false;
            }
        };
        let parametres = match parametres_imap_depuis(
            &self.pool,
            &self.cle,
            self.classement.as_ref(),
            ligne.compte_id,
            &ligne.type_compte,
        )
        .await
        {
            Ok(parametres) => parametres,
            Err(_) => {
                tracing::warn!(brouillon = %id, "compte non utilisable pour la copie IMAP");
                return false;
            }
        };
        let message_id = ligne.message_id.clone();
        let resultat = tokio::task::spawn_blocking(move || {
            let mut session = SessionActions::connecter(&parametres)?;
            let dossier = session.dossier_brouillons()?;
            session.deposer_brouillon(&dossier, &message_id, &octets)
        })
        .await;
        match resultat {
            Ok(Ok(_)) => true,
            Ok(Err(erreur)) => {
                tracing::warn!(brouillon = %id, %erreur, "dépôt IMAP du brouillon refusé");
                false
            }
            Err(_) => {
                tracing::warn!(brouillon = %id, "dépôt IMAP du brouillon interrompu");
                false
            }
        }
    }

    /// Retire la copie IMAP d'un brouillon marqué `a_retirer`, puis supprime la ligne. Si le
    /// serveur est injoignable, la ligne reste `a_retirer` (reprise au balayage). Un compte dont
    /// la copie n'a jamais pu exister (identifiants non lisibles) est quitte sans appel IMAP.
    pub async fn retirer(&self, id: Uuid) -> IssueDepot {
        let verrou = verrou_pour(id);
        let _garde = verrou.lock().await;
        let ligne = match sqlx::query_as::<_, (Uuid, String, String)>(
            r#"
            SELECT b.compte_id, c.type_compte, b.message_id
            FROM brouillons_message b
            INNER JOIN comptes_mail c ON c.id = b.compte_id
            WHERE b.id = $1 AND b.imap_etat = 'a_retirer'
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        {
            Ok(Some(ligne)) => ligne,
            Ok(None) => return IssueDepot::RienAFaire,
            Err(_) => {
                tracing::warn!(brouillon = %id, "lecture du brouillon impossible pour le retrait");
                return IssueDepot::Echec;
            }
        };
        let parametres = parametres_imap_depuis(
            &self.pool,
            &self.cle,
            self.classement.as_ref(),
            ligne.0,
            &ligne.1,
        )
        .await
        .ok();
        if let Some(parametres) = parametres {
            let message_id = ligne.2.clone();
            let resultat = tokio::task::spawn_blocking(move || {
                let mut session = SessionActions::connecter(&parametres)?;
                let dossier = session.dossier_brouillons()?;
                session.retirer_message_id(&dossier, &message_id)
            })
            .await;
            match resultat {
                Ok(Ok(_)) => {}
                Ok(Err(erreur)) => {
                    tracing::warn!(brouillon = %id, %erreur, "retrait de la copie IMAP refusé");
                    return IssueDepot::Echec;
                }
                Err(_) => {
                    tracing::warn!(brouillon = %id, "retrait de la copie IMAP interrompu");
                    return IssueDepot::Echec;
                }
            }
        }
        let suppression =
            sqlx::query("DELETE FROM brouillons_message WHERE id = $1 AND imap_etat = 'a_retirer'")
                .bind(id)
                .execute(&self.pool)
                .await;
        if suppression.is_err() {
            tracing::warn!(brouillon = %id, "suppression de la ligne du brouillon impossible");
            return IssueDepot::Echec;
        }
        IssueDepot::Depose
    }

    /// Reprend les copies en retard : dépôts à refaire, retraits à finir. Appelé par le moteur de
    /// messagerie. `delai_secs` évite de reprendre un brouillon que sa propre tâche traite encore.
    /// Retourne (dépôts réussis, retraits réussis).
    pub async fn balayer(&self, delai_secs: i64) -> (usize, usize) {
        let lignes = sqlx::query_as::<_, (Uuid, String)>(
            r#"
            SELECT id, imap_etat FROM brouillons_message
            WHERE imap_etat <> 'depose'
              AND imap_maj_le < NOW() - make_interval(secs => $1::double precision)
            ORDER BY imap_maj_le
            LIMIT $2
            "#,
        )
        .bind(delai_secs as f64)
        .bind(LOT_BALAYAGE)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        let (mut depots, mut retraits) = (0, 0);
        for (id, etat) in lignes {
            if etat == "a_retirer" {
                if self.retirer(id).await == IssueDepot::Depose {
                    retraits += 1;
                }
            } else if self.deposer(id).await == IssueDepot::Depose {
                depots += 1;
            }
        }
        (depots, retraits)
    }

    async fn charger(&self, id: Uuid) -> Result<Option<LigneDepot>, sqlx::Error> {
        let Some(ligne) = sqlx::query_as::<
            _,
            (
                Uuid,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                Option<String>,
                String,
                String,
                i64,
            ),
        >(
            r#"
            SELECT b.compte_id, c.type_compte, b.message_id, b.expediteur, b.imap_etat,
                   b.a, b.cc, b.cci, b.objet, b.corps, b.en_reponse_a, b.references_texte,
                   b.corps_html, b.revision
            FROM brouillons_message b
            INNER JOIN comptes_mail c ON c.id = b.compte_id
            WHERE b.id = $1 AND b.imap_etat <> 'a_retirer'
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let pieces = sqlx::query_as::<_, (String, String, Vec<u8>)>(
            "SELECT nom, type_mime, contenu FROM brouillons_message_pieces WHERE brouillon_id = $1 ORDER BY ordre",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(nom, type_mime, contenu)| PieceJointe {
            nom,
            type_mime,
            contenu,
        })
        .collect();
        Ok(Some(LigneDepot {
            compte_id: ligne.0,
            type_compte: ligne.1,
            message_id: ligne.2.clone(),
            expediteur: ligne.3,
            imap_etat: ligne.4,
            revision: ligne.13,
            contenu: ContenuEnvoi {
                message_id: ligne.2,
                a: liste_depuis_texte(&ligne.5),
                cc: liste_depuis_texte(&ligne.6),
                cci: liste_depuis_texte(&ligne.7),
                objet: ligne.8,
                corps: ligne.9,
                corps_html: ligne.12,
                en_reponse_a: ligne.10,
                references: liste_depuis_texte(&ligne.11),
                pieces,
            },
        }))
    }
}
