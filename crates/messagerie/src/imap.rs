//! Session IMAP. Rien de ce module n'est public.

use io_imap::client::{ImapClient, ImapClientStd};
use io_imap::has_imap_capability;
use io_imap::rfc3501::append::ImapMessageAppendOptions;
use io_imap::rfc3501::fetch::ImapMessageFetchOptions;
use io_imap::rfc3501::search::ImapMessageSearchOptions;
use io_imap::rfc3501::store::ImapMessageStoreOptions;
use io_imap::rfc6851::r#move::ImapMessageMoveOptions;
use io_imap::session::ImapSessionOpenOptions;
use io_imap::types::core::{AString, NString, Vec1};
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

/// Corps d'un message relevé. `html` est déjà passé par `ammonia`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorpsLu {
    pub uid: u32,
    pub message_id: String,
    pub objet: String,
    pub expediteur: String,
    pub html: String,
    pub texte: String,
    pub lu: bool,
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
        self.assurer_dossier(destination)?;
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

    /// Compte les en-têtes par paquets. `qresync` active QRESYNC et `CHANGEDSINCE 1`.
    /// Le repli n'utilise aucun modificateur : comparaison de tous les UID.
    pub fn compter_entetes(&mut self, qresync: bool) -> Result<usize, ErreurMail> {
        if qresync {
            let atome = io_imap::types::core::Atom::try_from("QRESYNC".to_owned())
                .map_err(|_| ErreurMail::Protocole)?;
            let capacites = Vec1::try_from(vec![
                io_imap::types::extensions::enable::CapabilityEnable::from(atome),
            ])
            .map_err(|_| ErreurMail::Protocole)?;
            self.client
                .enable(capacites)
                .map_err(|_| ErreurMail::Protocole)?;
        }
        self.selectionner("INBOX")?;
        let criteres = Vec1::try_from(vec![SearchKey::All]).map_err(|_| ErreurMail::Protocole)?;
        let mut uids = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?;
        uids.sort_unstable();
        let mut total = 0usize;
        let mut indice = 0usize;
        while indice < uids.len() {
            let fin = (indice + 999).min(uids.len() - 1);
            let jeu: SequenceSet = format!("{}:{}", uids[indice].get(), uids[fin].get())
                .parse()
                .map_err(|_| ErreurMail::Protocole)?;
            let modifiers = if qresync {
                vec![io_imap::types::command::FetchModifier::ChangedSince(
                    core::num::NonZeroU64::MIN,
                )]
            } else {
                Vec::new()
            };
            let fetched = self
                .client
                .fetch(
                    jeu,
                    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
                        MessageDataItemName::Uid,
                        MessageDataItemName::Rfc822Header,
                    ]),
                    ImapMessageFetchOptions {
                        uid: true,
                        modifiers,
                    },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            total += fetched.len();
            indice = fin + 1;
        }
        Ok(total)
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

    /// RFC822 d'un UID : HTML nettoyé, texte, lu. Le décodage MIME reste `mail-parser`.
    pub fn lire_corps(&mut self, dossier: &str, uid: u32) -> Result<CorpsLu, ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
        let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
            MessageDataItemName::Uid,
            MessageDataItemName::Flags,
            MessageDataItemName::Rfc822,
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
        let mut octets = None;
        let mut lu = false;
        for (_cle, morceaux) in fetched {
            for item in morceaux {
                match item {
                    MessageDataItem::Rfc822(valeur) => octets = Some(nstring_octets(&valeur)),
                    MessageDataItem::Flags(drapeaux) => {
                        lu = drapeaux.iter().any(|d| {
                            matches!(d, io_imap::types::flag::FlagFetch::Flag(Flag::Seen))
                        });
                    }
                    _ => {}
                }
            }
        }
        let Some(octets) = octets else {
            return Err(ErreurMail::Protocole);
        };
        let analyse = MessageParser::default().parse(&octets);
        let html_brut = analyse
            .as_ref()
            .and_then(|m| m.body_html(0))
            .map(|c| c.to_string())
            .unwrap_or_default();
        let html = crate::nettoyer_html(&html_brut);
        let texte = analyse
            .as_ref()
            .and_then(|m| m.body_text(0))
            .map(|c| c.to_string())
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| crate::texte_depuis_html(&html));
        let message_id = analyse
            .as_ref()
            .and_then(|m| m.message_id())
            .map(normaliser_message_id)
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| format!("<uid-corps-{uid}@legalos.local>"));
        let objet = analyse
            .as_ref()
            .and_then(|m| m.subject())
            .unwrap_or_default()
            .to_owned();
        let expediteur = analyse
            .as_ref()
            .and_then(|m| m.from())
            .and_then(|a| a.first())
            .and_then(|a| a.address.as_deref())
            .unwrap_or_default()
            .to_owned();
        Ok(CorpsLu {
            uid,
            message_id,
            objet,
            expediteur,
            html,
            texte,
            lu,
        })
    }

    pub fn lire_lu(&mut self, dossier: &str, uid: u32) -> Result<bool, ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
        let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
            MessageDataItemName::Uid,
            MessageDataItemName::Flags,
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
        if fetched.is_empty() {
            return Err(ErreurMail::Protocole);
        }
        let mut lu = false;
        for (_cle, morceaux) in fetched {
            for item in morceaux {
                if let MessageDataItem::Flags(drapeaux) = item {
                    lu = drapeaux
                        .iter()
                        .any(|d| matches!(d, io_imap::types::flag::FlagFetch::Flag(Flag::Seen)));
                }
            }
        }
        Ok(lu)
    }

    /// Crée le dossier s'il n'existe pas (NO ignoré).
    pub fn assurer_dossier(&mut self, dossier: &str) -> Result<(), ErreurMail> {
        let boite = boite(dossier)?;
        match self.client.create(boite) {
            Ok(()) => Ok(()),
            Err(_) => Ok(()),
        }
    }

    /// Vrai si un message portant cet identifiant est déjà dans le dossier.
    pub fn message_id_present(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<bool, ErreurMail> {
        self.assurer_dossier(dossier)?;
        self.selectionner(dossier)?;
        let id = message_id.trim();
        let variantes = [
            id.to_owned(),
            id.trim_start_matches('<').trim_end_matches('>').to_owned(),
            {
                let nu = id.trim_start_matches('<').trim_end_matches('>');
                format!("<{nu}>")
            },
        ];
        for variante in &variantes {
            let champ =
                AString::try_from("Message-ID".to_owned()).map_err(|_| ErreurMail::Protocole)?;
            let valeur = AString::try_from(variante.clone()).map_err(|_| ErreurMail::Protocole)?;
            let criteres = Vec1::try_from(vec![SearchKey::Header(champ, valeur)])
                .map_err(|_| ErreurMail::Protocole)?;
            let uids = self
                .client
                .search(criteres, ImapMessageSearchOptions { uid: true })
                .map_err(|_| ErreurMail::Protocole)?;
            if !uids.is_empty() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// APPEND dans le dossier (typiquement « Sent » / Envoyés).
    pub fn appender(&mut self, dossier: &str, octets: &[u8]) -> Result<(), ErreurMail> {
        self.assurer_dossier(dossier)?;
        let boite = boite(dossier)?;
        self.client
            .append(boite, octets, ImapMessageAppendOptions::default())
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

impl FluxVeille {
    /// Vrai si la boîte a bougé avant la fin du délai.
    pub fn attendre(&self, timeout: std::time::Duration) -> Result<bool, ErreurMail> {
        use std::sync::mpsc::RecvTimeoutError;
        match self._flux.recv_timeout(timeout) {
            Ok(Ok(_)) => Ok(true),
            Ok(Err(_)) => Err(ErreurMail::Protocole),
            Err(RecvTimeoutError::Timeout) => Ok(false),
            Err(RecvTimeoutError::Disconnected) => Err(ErreurMail::Connexion),
        }
    }
}

/// État d'un UID, sans type du codec.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EtatUid {
    pub uid: u32,
    pub lu: bool,
    pub drapeaux: String,
}

/// Résultat brut d'une relève de dossier. `qresync` dit quel chemin a été exécuté.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleveDossier {
    pub qresync: bool,
    pub uid_validity: u32,
    pub modseq: u64,
    pub etats: Vec<EtatUid>,
    pub retires: Vec<u32>,
    pub commandes: Vec<String>,
}

impl Session {
    /// QRESYNC si le serveur l'annonce et qu'un MODSEQ est déjà connu.
    /// Sinon comparaison UID + drapeaux. Les deux chemins n'émettent pas les mêmes commandes.
    pub fn synchroniser_dossier(
        &mut self,
        dossier: &str,
        modseq_connu: u64,
    ) -> Result<ReleveDossier, ErreurMail> {
        let caps = self.capacites()?;
        if caps.qresync && modseq_connu > 0 {
            self.delta_qresync(dossier, modseq_connu)
        } else if caps.qresync {
            self.premiere_qresync(dossier)
        } else {
            self.photographie_repli(dossier)
        }
    }

    fn activer_qresync(&mut self) -> Result<(), ErreurMail> {
        let atome = io_imap::types::core::Atom::try_from("QRESYNC".to_owned())
            .map_err(|_| ErreurMail::Protocole)?;
        let liste = Vec1::try_from(vec![
            io_imap::types::extensions::enable::CapabilityEnable::from(atome),
        ])
        .map_err(|_| ErreurMail::Protocole)?;
        self.client
            .enable(liste)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }

    fn premiere_qresync(&mut self, dossier: &str) -> Result<ReleveDossier, ErreurMail> {
        self.activer_qresync()?;
        let boite = boite(dossier)?;
        let selection = self
            .client
            .select(boite, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        let uid_validity = selection
            .uid_validity
            .map(|v| v.get())
            .ok_or(ErreurMail::Protocole)?;
        let modseq = selection.highest_mod_seq.unwrap_or(0);
        let etats = self.lire_etats(None)?;
        Ok(ReleveDossier {
            qresync: true,
            uid_validity,
            modseq,
            etats,
            retires: Vec::new(),
            commandes: vec![
                "ENABLE QRESYNC".into(),
                "SELECT".into(),
                "FETCH INITIAL".into(),
            ],
        })
    }

    fn delta_qresync(
        &mut self,
        dossier: &str,
        modseq_connu: u64,
    ) -> Result<ReleveDossier, ErreurMail> {
        self.activer_qresync()?;
        let annonce = self.examiner(dossier)?;
        let uid_validity =
            core::num::NonZeroU32::new(annonce.uid_validity).ok_or(ErreurMail::Protocole)?;
        let capacites = self
            .client
            .capability()
            .map_err(|_| ErreurMail::Protocole)?;
        let selection = self
            .client
            .select_qresync(boite(dossier)?, uid_validity, modseq_connu, &capacites)
            .map_err(|_| ErreurMail::Protocole)?;
        let mut retires = selection
            .vanished_earlier
            .iter()
            .map(|uid| uid.get())
            .collect::<Vec<_>>();
        let mut etats = Vec::new();
        for fetch in selection.changed {
            if let Some(etat) = etat_dun_fetch(fetch.items) {
                etats.push(etat);
            }
        }
        let suite = self.lire_etats(Some(modseq_connu))?;
        etats.extend(suite);
        etats.sort_by_key(|e| e.uid);
        etats.dedup_by_key(|e| e.uid);
        retires.sort_unstable();
        retires.dedup();
        let modseq = selection.highest_mod_seq.unwrap_or(modseq_connu);
        Ok(ReleveDossier {
            qresync: true,
            uid_validity: uid_validity.get(),
            modseq,
            etats,
            retires,
            commandes: vec![
                "ENABLE QRESYNC".into(),
                format!("SELECT QRESYNC {modseq_connu}"),
                format!("FETCH CHANGEDSINCE {modseq_connu}"),
            ],
        })
    }

    fn photographie_repli(&mut self, dossier: &str) -> Result<ReleveDossier, ErreurMail> {
        let etat = self.examiner(dossier)?;
        self.selectionner(dossier)?;
        let etats = self.lire_etats(None)?;
        Ok(ReleveDossier {
            qresync: false,
            uid_validity: etat.uid_validity,
            modseq: 0,
            etats,
            retires: Vec::new(),
            commandes: vec!["SEARCH".into(), "FETCH FLAGS".into()],
        })
    }

    fn lire_etats(&mut self, changed_since: Option<u64>) -> Result<Vec<EtatUid>, ErreurMail> {
        let criteres = Vec1::try_from(vec![SearchKey::All]).map_err(|_| ErreurMail::Protocole)?;
        let mut uids = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?;
        uids.sort_unstable();
        let mut etats = Vec::new();
        let mut indice = 0usize;
        while indice < uids.len() {
            let fin = (indice + 999).min(uids.len() - 1);
            let jeu: SequenceSet = format!("{}:{}", uids[indice].get(), uids[fin].get())
                .parse()
                .map_err(|_| ErreurMail::Protocole)?;
            let modifiers = match changed_since.and_then(core::num::NonZeroU64::new) {
                Some(modseq) => vec![io_imap::types::command::FetchModifier::ChangedSince(modseq)],
                None => Vec::new(),
            };
            let fetched = self
                .client
                .fetch(
                    jeu,
                    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
                        MessageDataItemName::Uid,
                        MessageDataItemName::Flags,
                    ]),
                    ImapMessageFetchOptions {
                        uid: true,
                        modifiers,
                    },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            for items in fetched.into_values() {
                if let Some(etat) = etat_dun_fetch(items) {
                    etats.push(etat);
                }
            }
            indice = fin + 1;
        }
        etats.sort_by_key(|e| e.uid);
        Ok(etats)
    }

    /// En-têtes par lots. Pas un aller-retour par message.
    pub fn entetes_uids(
        &mut self,
        dossier: &str,
        uids: &[u32],
    ) -> Result<Vec<EnteteRecu>, ErreurMail> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let etat = self.examiner(dossier)?;
        self.selectionner(dossier)?;
        let analyseur = MessageParser::default();
        let mut messages = Vec::new();
        for lot in uids.chunks(200) {
            let texte = lot
                .iter()
                .map(|uid| uid.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let jeu: SequenceSet = texte.parse().map_err(|_| ErreurMail::Protocole)?;
            let fetched = self
                .client
                .fetch(
                    jeu,
                    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
                        MessageDataItemName::Uid,
                        MessageDataItemName::Rfc822Header,
                    ]),
                    ImapMessageFetchOptions {
                        uid: true,
                        modifiers: Vec::new(),
                    },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            for (_cle, items) in fetched {
                let mut uid_lu = None;
                let mut octets = None;
                for item in items {
                    match item {
                        MessageDataItem::Uid(valeur) => uid_lu = Some(valeur.get()),
                        MessageDataItem::Rfc822Header(valeur) => {
                            octets = Some(nstring_octets(&valeur))
                        }
                        _ => {}
                    }
                }
                if let (Some(uid_lu), Some(octets)) = (uid_lu, octets) {
                    messages.push(entete_depuis_rfc822(
                        etat.uid_validity,
                        uid_lu,
                        &octets,
                        &analyseur,
                    ));
                }
            }
        }
        messages.sort_by_key(|m| m.uid);
        Ok(messages)
    }
}

/// UID et drapeaux d'une réponse FETCH, quel que soit l'ordre des champs.
fn etat_dun_fetch(items: impl IntoIterator<Item = MessageDataItem<'static>>) -> Option<EtatUid> {
    let mut uid = None;
    let mut lu = false;
    let mut noms = Vec::new();
    for item in items {
        match item {
            MessageDataItem::Uid(valeur) => uid = Some(valeur.get()),
            MessageDataItem::Flags(drapeaux) => {
                lu = false;
                noms.clear();
                for drapeau in &drapeaux {
                    if let io_imap::types::flag::FlagFetch::Flag(flag) = drapeau {
                        if matches!(flag, Flag::Seen) {
                            lu = true;
                        }
                        noms.push(format!("{flag:?}"));
                    }
                }
                noms.sort();
            }
            _ => {}
        }
    }
    Some(EtatUid {
        uid: uid?,
        lu,
        drapeaux: noms.join(" "),
    })
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
