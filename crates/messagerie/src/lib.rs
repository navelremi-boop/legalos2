//! Moteur mail. Les types `io_imap` et `imap_codec` ne sortent pas de ce crate :
//! l'appelant ne voit que [`FournisseurMail`].

mod chemin;
mod classement;
mod composition;
mod date_entete;
mod file_envoi;
mod html;
mod imap;
mod invitation;
mod moteur;
mod redaction;
mod smtp;

pub use chemin::{
    chemin_veille, suite_uid_validity, uid_de_reprise, Capacites, CheminVeille, CurseurDossier,
    CurseurReleve, SuiteDossier,
};
pub use classement::{
    decider, integrer_releve, DecisionClassement, DossierPourClassement, EntreeClassement,
    MessageReleve, ReleveConnue,
};
pub use composition::{analyser_composition, origine_depuis_octets, MessageComposition};
pub use date_entete::{borner_date_entete, BORNE_BASSE_SECS, TOLERANCE_FUTUR_SECS};
pub use file_envoi::{appliquer, decider_action, ActionEnvoi, EntreeFileEnvoi, EtatFileEnvoi};
pub use html::{nettoyer_html, texte_depuis_html};
pub use imap::{
    CorpsLu, Emplacement, EnteteRecu, EtatUid, IssueDeplacement, ReleveDossier, DOSSIER_ARCHIVES,
    DOSSIER_CORBEILLE,
};
pub use invitation::{
    decider_invitation, invitation_depuis_stockage, invitation_du_message, juger_origine,
    lire_invitation, reponse_invitation, DecisionInvitation, EffetInvitation, InstantsInvitation,
    InvitationConnue, InvitationLue, InvitationStockee, ReponseInvitation, VerdictOrigine,
    FUSEAU_FLOTTANT,
};
pub use moteur::{diff_repli, ecarter_supprimes, Changement, RapportMoteur};
pub use redaction::{
    adresse_et_nom, champ_en_tete_valide, construire_message, construire_message_brouillon,
    construire_message_compose, construire_message_sortant, destinataires_redaction,
    objet_redaction, type_mime_piece, DemandeRedaction, Destinataires, FilMessage, GenreRedaction,
    MessageOrigine, MessageSortant, PieceJointe, DOSSIER_BROUILLONS, DOSSIER_ENVOYES,
};
pub use smtp::{
    envoyer_message_fixe, envoyer_octets, octets_rfc822, ChiffrementSmtp, ParametresSmtp,
};

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

/// Compte IMAP. Le mot de passe et le jeton d'accès ne sont pas journalisés.
#[derive(Clone)]
pub struct ParametresCompte {
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    /// `false` : IMAP en clair (serveurs de test). `true` : IMAPS.
    pub tls: bool,
    /// Jeton d'accès OAuth 2.0 : présent, la connexion se fait par `AUTHENTICATE XOAUTH2` (l'utilisateur est
    /// l'adresse de la boîte) et le mot de passe est ignoré. Le serveur le renouvelle avant chaque connexion.
    pub jeton_acces: Option<String>,
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
    /// Déplace vers la Corbeille du compte. Jamais d'EXPUNGE : un message supprimé reste
    /// récupérable.
    fn supprimer(&mut self, dossier: &str, uid: u32) -> Result<(), ErreurMail>;
    /// Relève incrémentale des en-têtes (UID > `apres.dernier_uid`, si la UIDVALIDITY du serveur
    /// est celle du curseur ; sinon depuis le début du dossier).
    fn relever_entetes(
        &mut self,
        dossier: &str,
        apres: Option<CurseurReleve>,
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

    /// Dossier des brouillons du compte : celui que le serveur annonce avec l'attribut spécial
    /// `\Drafts` (LIST), sinon « Drafts » ou « Brouillons » s'ils existent, sinon
    /// [`DOSSIER_BROUILLONS`] (créé au premier dépôt).
    pub fn dossier_brouillons(&mut self) -> Result<String, ErreurMail> {
        self.interne.dossier_brouillons()
    }

    /// Dossier des messages envoyés du compte : celui que le serveur annonce avec l'attribut
    /// spécial `\Sent` (LIST), sinon « Sent » ou « Envoyés » s'ils existent, sinon
    /// [`DOSSIER_ENVOYES`].
    pub fn dossier_envoyes(&mut self) -> Result<String, ErreurMail> {
        self.interne.dossier_envoyes()
    }

    /// Dépose une version d'un brouillon (APPEND avec `\Draft` et `\Seen`), puis retire les
    /// versions précédentes de même `Message-ID`. Si l'APPEND échoue, les anciennes versions
    /// restent : jamais zéro copie. Retourne le nombre d'anciennes versions retirées.
    pub fn deposer_brouillon(
        &mut self,
        dossier: &str,
        message_id: &str,
        octets: &[u8],
    ) -> Result<usize, ErreurMail> {
        self.interne.deposer_brouillon(dossier, message_id, octets)
    }

    /// Retire du dossier tous les messages portant ce `Message-ID`. Retourne leur nombre.
    pub fn retirer_message_id(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<usize, ErreurMail> {
        self.interne.retirer_message_id(dossier, message_id)
    }

    /// UID des messages portant ce `Message-ID` dans le dossier (vide si le dossier n'existe pas).
    pub fn uids_message_id(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<Vec<u32>, ErreurMail> {
        self.interne.uids_message_id(dossier, message_id)
    }

    /// Drapeaux d'un UID, sous la forme « \Draft \Seen » (triés).
    pub fn drapeaux(&mut self, dossier: &str, uid: u32) -> Result<String, ErreurMail> {
        self.interne.drapeaux(dossier, uid)
    }

    /// Octets RFC822 d'un message (origine d'une réponse ou d'un transfert).
    pub fn lire_rfc822(&mut self, dossier: &str, uid: u32) -> Result<Vec<u8>, ErreurMail> {
        self.interne.lire_rfc822(dossier, uid)
    }

    /// Dossier de la Corbeille du compte : celui que le serveur annonce avec l'attribut spécial
    /// `\Trash` (LIST), sinon un nom courant (Trash, Corbeille, Deleted Items…), sinon
    /// [`DOSSIER_CORBEILLE`] (créé au premier déplacement).
    pub fn dossier_corbeille(&mut self) -> Result<String, ErreurMail> {
        self.interne.dossier_corbeille()
    }

    /// Dossier des archives du compte : attribut `\Archive`, sinon un nom courant (Archive,
    /// Archives…), sinon [`DOSSIER_ARCHIVES`] (créé au premier déplacement).
    pub fn dossier_archives(&mut self) -> Result<String, ErreurMail> {
        self.interne.dossier_archives()
    }

    /// Pose (`lu`) ou retire `\Seen` sur un message retrouvé dans le dossier, et relit l'état.
    /// Rejouable. `false` : le message n'est plus dans ce dossier. L'UID et la UIDVALIDITY connus
    /// ne sont qu'un indice : le message est reconnu à son `Message-ID`.
    pub fn marquer_lu_message(
        &mut self,
        dossier: &str,
        uid_validity: u32,
        uid: u32,
        message_id: &str,
        lu: bool,
    ) -> Result<bool, ErreurMail> {
        self.interne
            .marquer_lu_message(dossier, uid_validity, uid, message_id, lu)
    }

    /// Déplace un message vers un dossier (créé au besoin), sans doublon au rejeu : MOVE si le
    /// serveur l'annonce, sinon COPY puis `\Deleted` sur l'original une fois la copie confirmée.
    /// Jamais d'EXPUNGE général ni dans la destination ; voir `imap::Session::deplacer_message`.
    pub fn deplacer_message(
        &mut self,
        origine: &str,
        uid_validity: u32,
        uid: u32,
        message_id: &str,
        destination: &str,
    ) -> Result<IssueDeplacement, ErreurMail> {
        self.interne
            .deplacer_message(origine, uid_validity, uid, message_id, destination)
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
        apres: Option<CurseurReleve>,
        limite: Option<usize>,
    ) -> Result<(u32, Vec<EnteteRecu>), ErreurMail> {
        self.interne.relever_entetes(dossier, apres, limite)
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
            jeton_acces: None,
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
