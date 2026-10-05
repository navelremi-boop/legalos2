//! Moteur mail. Les types `io_imap` et `imap_codec` ne sortent pas de ce crate :
//! l'appelant ne voit que [`FournisseurMail`].

mod chemin;
mod classement;
mod file_envoi;
mod html;
mod imap;
mod invitation;
mod moteur;
mod redaction;
mod smtp;

pub use chemin::{
    chemin_veille, suite_uid_validity, Capacites, CheminVeille, CurseurDossier, SuiteDossier,
};
pub use classement::{
    decider, integrer_releve, DecisionClassement, DossierPourClassement, EntreeClassement,
    MessageReleve, ReleveConnue,
};
pub use file_envoi::{appliquer, decider_action, ActionEnvoi, EntreeFileEnvoi, EtatFileEnvoi};
pub use html::{nettoyer_html, texte_depuis_html};
pub use imap::{CorpsLu, EnteteRecu, EtatUid, ReleveDossier};
pub use invitation::{
    lire_invitation, reponse_invitation, EffetInvitation, InvitationLue, ReponseInvitation,
};
pub use moteur::{diff_repli, Changement, RapportMoteur};
pub use redaction::{
    construire_message, destinataires_redaction, objet_redaction, DemandeRedaction, Destinataires,
    GenreRedaction, MessageOrigine, PieceJointe, DOSSIER_BROUILLONS,
};
pub use smtp::{envoyer_message_fixe, octets_rfc822, ParametresSmtp};

use thiserror::Error;

/// Erreur sans contenu de message, d'objet ni d'adresse.
#[derive(Debug, Error)]
pub enum ErreurMail {
    #[error("connexion au serveur de messagerie impossible")]
    Connexion,
    #[error("authentification refusée")]
    Authentification,
    #[error("commande refusée par le serveur")]
    Protocole,
}

/// Compte IMAP. Le mot de passe n'est pas journalisé.
#[derive(Clone)]
pub struct ParametresCompte {
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    /// `false` : IMAP en clair (serveurs de test). `true` : IMAPS.
    pub tls: bool,
}

/// Ce que le reste du serveur peut demander au protocole.
///
/// La boîte de réception est observée par [`FournisseurMail::ouvrir_veille`],
/// connexion dédiée, lecture seule. Les autres dossiers passent par
/// [`FournisseurMail::relever_dossier`] (relève incrémentale). Lu, drapeau,
/// déplacement et suppression passent par une connexion distincte.
pub trait FournisseurMail {
    fn capacites(&mut self) -> Result<Capacites, ErreurMail>;
    fn ouvrir_veille(&mut self) -> Result<CheminVeille, ErreurMail>;
    fn relever_dossier(
        &mut self,
        dossier: &str,
        curseur: Option<CurseurDossier>,
    ) -> Result<SuiteDossier, ErreurMail>;
    fn marquer_lu(&mut self, dossier: &str, uid: u32, lu: bool) -> Result<(), ErreurMail>;
    fn poser_drapeau(&mut self, dossier: &str, uid: u32, drapeau: &str) -> Result<(), ErreurMail>;
    fn deplacer(&mut self, dossier: &str, uid: u32, destination: &str) -> Result<(), ErreurMail>;
    fn supprimer(&mut self, dossier: &str, uid: u32) -> Result<(), ErreurMail>;
    /// Relève incrémentale des en-têtes (UID > `apres_uid`).
    fn relever_entetes(
        &mut self,
        dossier: &str,
        apres_uid: Option<u32>,
        limite: Option<usize>,
    ) -> Result<(u32, Vec<EnteteRecu>), ErreurMail>;
}

/// Session d'actions (connexion distincte de la veille).
pub struct SessionActions {
    interne: imap::Session,
}

impl SessionActions {
    pub fn connecter(parametres: &ParametresCompte) -> Result<Self, ErreurMail> {
        Ok(Self {
            interne: imap::Session::connecter(parametres)?,
        })
    }

    pub fn connecter_xoauth2(
        hote: &str,
        port: u16,
        tls: bool,
        utilisateur: &str,
        jeton_acces: &str,
    ) -> Result<Self, ErreurMail> {
        Ok(Self {
            interne: imap::Session::connecter_xoauth2(hote, port, tls, utilisateur, jeton_acces)?,
        })
    }

    /// Recherche Message-ID dans un dossier IMAP (Envoyés).
    pub fn message_id_present(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<bool, ErreurMail> {
        self.interne.message_id_present(dossier, message_id)
    }

    /// APPEND RFC822 dans un dossier IMAP.
    pub fn appender(&mut self, dossier: &str, octets: &[u8]) -> Result<(), ErreurMail> {
        self.interne.appender(dossier, octets)
    }

    pub fn lire_corps(&mut self, dossier: &str, uid: u32) -> Result<imap::CorpsLu, ErreurMail> {
        self.interne.lire_corps(dossier, uid)
    }

    pub fn lire_lu(&mut self, dossier: &str, uid: u32) -> Result<bool, ErreurMail> {
        self.interne.lire_lu(dossier, uid)
    }

    pub fn compter_entetes(&mut self, qresync: bool) -> Result<usize, ErreurMail> {
        self.interne.compter_entetes(qresync)
    }

    /// Relève un dossier. Le chemin QRESYNC et le repli n'émettent pas les mêmes commandes.
    pub fn synchroniser_dossier(
        &mut self,
        dossier: &str,
        modseq_connu: u64,
    ) -> Result<ReleveDossier, ErreurMail> {
        self.interne.synchroniser_dossier(dossier, modseq_connu)
    }

    pub fn entetes_uids(
        &mut self,
        dossier: &str,
        uids: &[u32],
    ) -> Result<Vec<EnteteRecu>, ErreurMail> {
        self.interne.entetes_uids(dossier, uids)
    }
}

impl FournisseurMail for SessionActions {
    fn capacites(&mut self) -> Result<Capacites, ErreurMail> {
        self.interne.capacites()
    }

    fn ouvrir_veille(&mut self) -> Result<CheminVeille, ErreurMail> {
        let caps = self.interne.capacites()?;
        Ok(chemin_veille(&caps))
    }

    fn relever_dossier(
        &mut self,
        dossier: &str,
        curseur: Option<CurseurDossier>,
    ) -> Result<SuiteDossier, ErreurMail> {
        let etat = self.interne.examiner(dossier)?;
        Ok(suite_uid_validity(curseur, etat.uid_validity))
    }

    fn marquer_lu(&mut self, dossier: &str, uid: u32, lu: bool) -> Result<(), ErreurMail> {
        self.interne.marquer_lu(dossier, uid, lu)
    }

    fn poser_drapeau(&mut self, dossier: &str, uid: u32, drapeau: &str) -> Result<(), ErreurMail> {
        self.interne.poser_drapeau(dossier, uid, drapeau)
    }

    fn deplacer(&mut self, dossier: &str, uid: u32, destination: &str) -> Result<(), ErreurMail> {
        self.interne.deplacer(dossier, uid, destination)
    }

    fn supprimer(&mut self, dossier: &str, uid: u32) -> Result<(), ErreurMail> {
        self.interne.supprimer(dossier, uid)
    }

    fn relever_entetes(
        &mut self,
        dossier: &str,
        apres_uid: Option<u32>,
        limite: Option<usize>,
    ) -> Result<(u32, Vec<EnteteRecu>), ErreurMail> {
        self.interne.relever_entetes(dossier, apres_uid, limite)
    }
}

/// Veille de la boîte de réception. Aucune méthode d'écriture : la connexion
/// reste en lecture seule (`ImapMailboxWatch`).
pub struct VeilleReception {
    chemin: CheminVeille,
    _flux: imap::FluxVeille,
}

impl VeilleReception {
    /// Ouvre une seconde connexion, réservée à la veille.
    pub fn ouvrir(parametres: &ParametresCompte) -> Result<Self, ErreurMail> {
        let mut session = imap::Session::connecter(parametres)?;
        let caps = session.capacites()?;
        let chemin = chemin_veille(&caps);
        let flux = session.armer_veille()?;
        Ok(Self {
            chemin,
            _flux: flux,
        })
    }

    pub fn chemin(&self) -> CheminVeille {
        self.chemin
    }

    /// Attend une notification IDLE (nouveau message, drapeau, retrait).
    pub fn attendre(&self, timeout: std::time::Duration) -> Result<bool, ErreurMail> {
        self._flux.attendre(timeout)
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests_serveurs {
    use super::{FournisseurMail, ParametresCompte, SessionActions};

    fn parametres(variable: &str) -> Option<ParametresCompte> {
        let adresse = std::env::var(variable).ok()?;
        let (hote, port) = adresse.rsplit_once(':')?;
        let port = port.parse().ok()?;
        Some(ParametresCompte {
            hote: hote.to_owned(),
            port,
            utilisateur: "capa".to_owned(),
            mot_de_passe: "MotDePasseCapa123!".to_owned(),
            tls: false,
        })
    }

    #[test]
    fn greenmail_sans_qresync() {
        let Some(parametres) = parametres("LEGALOS_IMAP_GREENMAIL") else {
            return;
        };
        let mut session = SessionActions::connecter(&parametres).expect("greenmail");
        let caps = session.capacites().expect("capacités");
        assert!(caps.idle, "GreenMail 2.1 annonce IDLE");
        assert!(
            !caps.qresync,
            "GreenMail 2.1 n'annonce pas QRESYNC : {:?}",
            caps.jetons
        );
    }

    #[test]
    fn serveur_qresync() {
        let Some(parametres) = parametres("LEGALOS_IMAP_QRESYNC") else {
            return;
        };
        let mut session = SessionActions::connecter(&parametres).expect("qresync");
        let caps = session.capacites().expect("capacités");
        assert!(
            caps.qresync,
            "le second serveur doit annoncer QRESYNC : {:?}",
            caps.jetons
        );
    }
}
