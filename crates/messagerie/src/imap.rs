//! Session IMAP. Rien de ce module n'est public.

use io_imap::client::{ImapClient, ImapClientStd};
use io_imap::has_imap_capability;
use io_imap::rfc3501::fetch::ImapMessageFetchOptions;
use io_imap::rfc3501::search::ImapMessageSearchOptions;
use io_imap::rfc3501::store::ImapMessageStoreOptions;
use io_imap::rfc6851::r#move::ImapMessageMoveOptions;
use io_imap::session::ImapSessionOpenOptions;
use io_imap::types::core::{NString, Vec1};
use io_imap::types::fetch::{MacroOrMessageDataItemNames, MessageDataItem, MessageDataItemName};
use io_imap::types::flag::{Flag, StoreType};
use io_imap::types::mailbox::Mailbox;
use io_imap::types::search::SearchKey;
use io_imap::types::sequence::SequenceSet;
use io_sasl::mechanism::Sasl;
use mail_parser::MessageParser;
use pimalaya_stream::tls::Tls;
use url::Url;

use crate::chemin::Capacites;
use crate::ErreurMail;
use crate::ParametresCompte;

/// En-têtes d'un message relevé (aucun type io-imap).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnteteRecu {
    pub uid: u32,
    pub message_id: String,
    pub objet: String,
    pub expediteur: String,
    pub destinataires: Vec<String>,
}

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

    /// Relève les en-têtes (UID FETCH RFC822.HEADER + `mail-parser`) des messages
    /// d'UID strictement supérieur à `apres_uid`. `limite` coupe la relève pour
    /// simuler une interruption. ENVELOPE est évité : GreenMail y casse les sujets
    /// 8-bit, ce qui faisait sauter des UID sans les intégrer.
    pub fn relever_entetes(
        &mut self,
        dossier: &str,
        apres_uid: Option<u32>,
        limite: Option<usize>,
    ) -> Result<(u32, Vec<EnteteRecu>), ErreurMail> {
        let etat = self.examiner(dossier)?;
        self.selectionner(dossier)?;
        let critere = match apres_uid.filter(|uid| *uid > 0) {
            Some(uid) => {
                let jeu: SequenceSet = format!("{}:*", uid.saturating_add(1))
                    .parse()
                    .map_err(|_| ErreurMail::Protocole)?;
                SearchKey::Uid(jeu)
            }
            None => SearchKey::All,
        };
        let criteres = Vec1::try_from(vec![critere]).map_err(|_| ErreurMail::Protocole)?;
        let mut uids = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?;
        uids.sort_unstable();
        if let Some(max) = limite {
            uids.truncate(max);
        }
        let analyseur = MessageParser::default();
        let mut messages = Vec::new();
        for uid in uids {
            let jeu: SequenceSet = uid
                .get()
                .to_string()
                .parse()
                .map_err(|_| ErreurMail::Protocole)?;
            let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
                MessageDataItemName::Uid,
                MessageDataItemName::Rfc822Header,
            ]);
            let fetched = self
                .client
                .fetch(
                    jeu,
                    items,
                    ImapMessageFetchOptions {
                        uid: true,
                        modifiers: Vec::new(),
                    },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            for (_cle, items) in fetched {
                let mut uid_lu = None;
                let mut en_tetes = None;
                for item in items {
                    match item {
                        MessageDataItem::Uid(valeur) => uid_lu = Some(valeur.get()),
                        MessageDataItem::Rfc822Header(valeur) => {
                            en_tetes = Some(nstring_octets(&valeur));
                        }
                        _ => {}
                    }
                }
                let (Some(uid_lu), Some(octets)) = (uid_lu, en_tetes) else {
                    return Err(ErreurMail::Protocole);
                };
                messages.push(entete_depuis_rfc822(
                    etat.uid_validity,
                    uid_lu,
                    &octets,
                    &analyseur,
                ));
            }
        }
        messages.sort_by_key(|m| m.uid);
        Ok((etat.uid_validity, messages))
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

fn entete_depuis_rfc822(
    uid_validity: u32,
    uid: u32,
    octets: &[u8],
    analyseur: &MessageParser,
) -> EnteteRecu {
    let message = analyseur.parse(octets);
    let message_id = message
        .as_ref()
        .and_then(|m| m.message_id())
        .map(normaliser_message_id)
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("<uid-{uid_validity}-{uid}@legalos.local>"));
    let objet = message
        .as_ref()
        .and_then(|m| m.subject())
        .unwrap_or_default()
        .to_owned();
    let expediteur = message
        .as_ref()
        .and_then(|m| m.from())
        .and_then(|a| a.first())
        .and_then(|a| a.address.as_deref())
        .unwrap_or_default()
        .to_owned();
    let mut destinataires = Vec::new();
    if let Some(msg) = message.as_ref() {
        for champ in [msg.to(), msg.cc()].into_iter().flatten() {
            for adresse in champ.iter() {
                if let Some(email) = adresse.address.as_deref() {
                    destinataires.push(email.to_owned());
                }
            }
        }
    }
    EnteteRecu {
        uid,
        message_id,
        objet,
        expediteur,
        destinataires,
    }
}

fn normaliser_message_id(brut: &str) -> String {
    let trim = brut.trim();
    if trim.is_empty() {
        return String::new();
    }
    if trim.starts_with('<') && trim.ends_with('>') {
        trim.to_owned()
    } else {
        format!("<{trim}>")
    }
}

fn nstring_octets(valeur: &NString<'_>) -> Vec<u8> {
    let Some(inner) = valeur.0.clone() else {
        return Vec::new();
    };
    inner.into_inner().into_owned()
}

/// Dépendance directe exacte : Cargo ne peut pas monter imap-codec.
#[allow(dead_code)]
fn ancrage_imap_codec() -> usize {
    std::mem::size_of::<imap_codec::GreetingCodec>()
}
