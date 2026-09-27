//! Session IMAP. Rien de ce module n'est public.

use io_imap::client::{ImapClient, ImapClientStd};
use io_imap::has_imap_capability;
use io_imap::rfc3501::store::ImapMessageStoreOptions;
use io_imap::rfc6851::r#move::ImapMessageMoveOptions;
use io_imap::session::ImapSessionOpenOptions;
use io_imap::types::flag::{Flag, StoreType};
use io_imap::types::mailbox::Mailbox;
use io_imap::types::sequence::SequenceSet;
use io_sasl::mechanism::Sasl;
use pimalaya_stream::tls::Tls;
use url::Url;

use crate::chemin::Capacites;
use crate::ErreurMail;
use crate::ParametresCompte;

pub struct Session {
    client: ImapClientStd,
}

pub struct EtatExamen {
    pub uid_validity: u32,
}

impl Session {
    pub fn connecter(parametres: &ParametresCompte) -> Result<Self, ErreurMail> {
        let scheme = if parametres.tls { "imaps" } else { "imap" };
        let url = Url::parse(&format!(
            "{scheme}://{}:{}",
            parametres.hote, parametres.port
        ))
        .map_err(|_| ErreurMail::Connexion)?;
        let (mut client, _) = ImapClientStd::connect(
            &url,
            &Tls::default(),
            None::<Sasl>,
            ImapSessionOpenOptions::default(),
        )
        .map_err(|_| ErreurMail::Connexion)?;
        client
            .login(
                &parametres.utilisateur,
                &parametres.mot_de_passe,
                Default::default(),
            )
            .map_err(|_| ErreurMail::Authentification)?;
        Ok(Self { client })
    }

    pub fn capacites(&mut self) -> Result<Capacites, ErreurMail> {
        let brutes = self
            .client
            .capability()
            .map_err(|_| ErreurMail::Protocole)?;
        let idle = has_imap_capability!(brutes, Idle);
        let qresync = has_imap_capability!(brutes, QResync);
        let jetons = brutes.iter().map(|cap| format!("{cap:?}")).collect();
        Ok(Capacites {
            idle,
            qresync,
            jetons,
        })
    }

    pub fn examiner(&mut self, dossier: &str) -> Result<EtatExamen, ErreurMail> {
        let boite = boite(dossier)?;
        let etat = self
            .client
            .examine(boite, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        let uid_validity = etat
            .uid_validity
            .map(|valeur| valeur.get())
            .ok_or(ErreurMail::Protocole)?;
        Ok(EtatExamen { uid_validity })
    }

    /// Arme `ImapMailboxWatch` (EXAMINE, lecture seule) et consomme la session.
    pub fn armer_veille(mut self) -> Result<FluxVeille, ErreurMail> {
        let caps = self
            .client
            .capability()
            .map_err(|_| ErreurMail::Protocole)?;
        let boite = boite("INBOX")?;
        let flux = self
            .client
            .watch_mailbox(boite, &caps, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(FluxVeille { _flux: flux })
    }

    pub fn marquer_lu(&mut self, dossier: &str, uid: u32, lu: bool) -> Result<(), ErreurMail> {
        self.store_drapeau(dossier, uid, "\\Seen", lu)
    }

    pub fn poser_drapeau(
        &mut self,
        dossier: &str,
        uid: u32,
        drapeau: &str,
    ) -> Result<(), ErreurMail> {
        self.store_drapeau(dossier, uid, drapeau, true)
    }

    pub fn deplacer(
        &mut self,
        dossier: &str,
        uid: u32,
        destination: &str,
    ) -> Result<(), ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
        let vers = boite(destination)?;
        let opts = ImapMessageMoveOptions { uid: true };
        self.client
            .r#move(jeu, vers, opts)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }

    pub fn supprimer(&mut self, dossier: &str, uid: u32) -> Result<(), ErreurMail> {
        self.store_drapeau(dossier, uid, "\\Deleted", true)?;
        let jeu = sequence_un(uid)?;
        self.client
            .uid_expunge(jeu)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }

    fn selectionner(&mut self, dossier: &str) -> Result<(), ErreurMail> {
        let boite = boite(dossier)?;
        self.client
            .select(boite, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }

    fn store_drapeau(
        &mut self,
        dossier: &str,
        uid: u32,
        drapeau: &str,
        poser: bool,
    ) -> Result<(), ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
        let flag = drapeau_statique(drapeau)?;
        let genre = if poser {
            StoreType::Add
        } else {
            StoreType::Remove
        };
        let opts = ImapMessageStoreOptions { uid: true };
        self.client
            .store(jeu, genre, vec![flag], opts)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }
}

/// Flux de veille. Le type io-imap reste dans ce module.
pub struct FluxVeille {
    _flux: io_imap::client::ImapMailboxWatchStream,
}

fn boite(nom: &str) -> Result<Mailbox<'static>, ErreurMail> {
    Mailbox::try_from(nom.to_owned()).map_err(|_| ErreurMail::Protocole)
}

fn sequence_un(uid: u32) -> Result<SequenceSet, ErreurMail> {
    uid.to_string().parse().map_err(|_| ErreurMail::Protocole)
}

fn drapeau_statique(nom: &str) -> Result<Flag<'static>, ErreurMail> {
    Ok(match nom {
        "\\Seen" => Flag::Seen,
        "\\Deleted" => Flag::Deleted,
        "\\Answered" => Flag::Answered,
        "\\Flagged" => Flag::Flagged,
        "\\Draft" => Flag::Draft,
        autre => {
            let atome = io_imap::types::core::Atom::try_from(autre.to_owned())
                .map_err(|_| ErreurMail::Protocole)?;
            Flag::keyword(atome)
        }
    })
}

/// Dépendance directe exacte : Cargo ne peut pas monter imap-codec.
#[allow(dead_code)]
fn ancrage_imap_codec() -> usize {
    std::mem::size_of::<imap_codec::GreetingCodec>()
}
