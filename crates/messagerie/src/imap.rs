//! Session IMAP. Rien de ce module n'est public.

use std::num::NonZeroU32;

use io_imap::client::{ImapClient, ImapClientStd};
use io_imap::has_imap_capability;
use io_imap::rfc3501::append::ImapMessageAppendOptions;
use io_imap::rfc3501::copy::ImapMessageCopyOptions;
use io_imap::rfc3501::fetch::ImapMessageFetchOptions;
use io_imap::rfc3501::search::ImapMessageSearchOptions;
use io_imap::rfc3501::store::ImapMessageStoreOptions;
use io_imap::rfc6851::r#move::ImapMessageMoveOptions;
use io_imap::session::ImapSessionOpenOptions;
use io_imap::types::core::{AString, NString, Vec1};
use io_imap::types::fetch::{
    MacroOrMessageDataItemNames, MessageDataItem, MessageDataItemName, Section,
};
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
    /// Noms de pièces jointes lus dans BODYSTRUCTURE. Vide si le serveur n'en donne pas.
    pub pieces: Vec<String>,
    /// Début du corps, pour la liste. Le corps complet reste à la demande.
    pub extrait: String,
    /// Le message porte une partie calendrier (`text/calendar` ou `application/ics`), vue dans
    /// BODYSTRUCTURE : seuls ces messages sont relus en entier pour en tirer l'invitation.
    pub calendrier: bool,
    /// Date d'en-tête (`Date:`) en secondes UTC depuis l'époque Unix, telle que lue, sans borne :
    /// `None` si l'en-tête est absent ou illisible. Les bornes (`borner_date_entete`) s'appliquent
    /// à l'enregistrement, avec l'horloge de l'appelant.
    pub date: Option<i64>,
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

/// Texte des messages lus pour l'indexation (voir [`Session::textes_sans_effet`]).
#[derive(Debug, Clone, Default)]
pub struct TextesLus {
    /// Faux : la UIDVALIDITY du dossier a changé, rien n'a été lu.
    pub valide: bool,
    /// Texte du corps par UID ; un UID absent n'existe plus sur le serveur.
    pub textes: std::collections::HashMap<u32, String>,
}

/// Octets lus au plus par message pour l'indexation de fond.
pub const OCTETS_MAX_INDEXATION: u32 = 1_048_576;

pub struct Session {
    client: ImapClientStd,
}

pub struct EtatExamen {
    pub uid_validity: u32,
}

impl Session {
    pub fn connecter(parametres: &ParametresCompte) -> Result<Self, ErreurMail> {
        if let Some(jeton) = &parametres.jeton_acces {
            return Self::connecter_xoauth2(
                &parametres.hote,
                parametres.port,
                parametres.tls,
                &parametres.utilisateur,
                jeton,
            );
        }
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

    /// AUTHENTICATE XOAUTH2. Le jeton d'accès n'est pas journalisé.
    pub fn connecter_xoauth2(
        hote: &str,
        port: u16,
        tls: bool,
        utilisateur: &str,
        jeton_acces: &str,
    ) -> Result<Self, ErreurMail> {
        let scheme = if tls { "imaps" } else { "imap" };
        let url =
            Url::parse(&format!("{scheme}://{hote}:{port}")).map_err(|_| ErreurMail::Connexion)?;
        // Connexion puis authentification en deux temps : une coupure réseau n'est jamais prise pour un
        // jeton refusé (« Authentification » arrête les tentatives et affiche « Reconnecter »).
        let (mut client, _) = ImapClientStd::connect(
            &url,
            &Tls::default(),
            None::<Sasl>,
            ImapSessionOpenOptions::default(),
        )
        .map_err(|_| ErreurMail::Connexion)?;
        client
            .auth_xoauth2(utilisateur, jeton_acces, Default::default())
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
        let condstore = has_imap_capability!(brutes, CondStore) || qresync;
        let jetons = brutes.iter().map(|cap| format!("{cap:?}")).collect();
        Ok(Capacites {
            idle,
            qresync,
            condstore,
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

    /// Supprimer un message, c'est le déplacer vers la Corbeille du compte : aucun EXPUNGE. Un
    /// message déjà dans la Corbeille y reste.
    pub fn supprimer(&mut self, dossier: &str, uid: u32) -> Result<(), ErreurMail> {
        let corbeille = self.dossier_corbeille()?;
        if corbeille == dossier {
            return Ok(());
        }
        self.deplacer(dossier, uid, &corbeille)
    }

    /// Texte du corps de plusieurs messages, **sans aucun effet sur la boîte** : dossier ouvert en lecture seule
    /// (EXAMINE) et `BODY.PEEK[]`, donc aucun drapeau `\Seen` posé. Sert à l'indexation de fond. Si la
    /// UIDVALIDITY du dossier n'est plus celle que l'appelant a connue, rien n'est lu (`valide` faux) : les UID ne
    /// désignent plus les mêmes messages, la relève s'en charge. Seuls les `OCTETS_MAX_INDEXATION` premiers octets
    /// de chaque message sont lus : le texte précède presque toujours les pièces jointes.
    pub fn textes_sans_effet(
        &mut self,
        dossier: &str,
        uid_validity_attendue: u32,
        uids: &[u32],
    ) -> Result<TextesLus, ErreurMail> {
        let mut resultat = TextesLus {
            valide: true,
            textes: std::collections::HashMap::new(),
        };
        if uids.is_empty() {
            return Ok(resultat);
        }
        let etat = self.examiner(dossier)?;
        if etat.uid_validity != uid_validity_attendue {
            resultat.valide = false;
            return Ok(resultat);
        }
        let texte_uids = uids
            .iter()
            .map(|uid| uid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let jeu: SequenceSet = texte_uids.parse().map_err(|_| ErreurMail::Protocole)?;
        let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
            MessageDataItemName::Uid,
            MessageDataItemName::BodyExt {
                section: None,
                partial: Some((
                    0,
                    NonZeroU32::new(OCTETS_MAX_INDEXATION).unwrap_or(NonZeroU32::MIN),
                )),
                peek: true,
            },
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
        let analyseur = MessageParser::default();
        for (_cle, morceaux) in fetched {
            let mut uid = None;
            let mut octets = None;
            for item in morceaux {
                match item {
                    MessageDataItem::Uid(valeur) => uid = Some(valeur.get()),
                    MessageDataItem::BodyExt { data: valeur, .. } => {
                        octets = Some(nstring_octets(&valeur));
                    }
                    _ => {}
                }
            }
            let (Some(uid), Some(octets)) = (uid, octets) else {
                continue;
            };
            let analyse = analyseur.parse(&octets);
            let texte = analyse
                .as_ref()
                .and_then(|m| m.body_text(0))
                .map(|c| c.to_string())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| {
                    let html = analyse
                        .as_ref()
                        .and_then(|m| m.body_html(0))
                        .map(|c| c.to_string())
                        .unwrap_or_default();
                    crate::texte_depuis_html(&crate::nettoyer_html(&html))
                });
            resultat.textes.insert(uid, texte);
        }
        Ok(resultat)
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
    /// d'UID strictement supérieur à `apres.dernier_uid` quand la UIDVALIDITY du serveur est celle
    /// du curseur ; sinon depuis le début du dossier. `limite` coupe la relève pour
    /// simuler une interruption. ENVELOPE est évité : GreenMail y casse les sujets
    /// 8-bit, ce qui faisait sauter des UID sans les intégrer.
    pub fn relever_entetes(
        &mut self,
        dossier: &str,
        apres: Option<crate::chemin::CurseurReleve>,
        limite: Option<usize>,
    ) -> Result<(u32, Vec<EnteteRecu>), ErreurMail> {
        let etat = self.examiner(dossier)?;
        self.selectionner(dossier)?;
        let critere = match crate::chemin::uid_de_reprise(apres, etat.uid_validity) {
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
        // Par lots (un aller-retour par 200 messages, pas par message) : une relève qui repart du
        // début d'une grande boîte (UIDVALIDITY changée) reste praticable. Un message demandé et
        // absent de la réponse (expunge entre la recherche et la lecture) est une erreur : le
        // curseur ne doit jamais sauter un UID sans l'avoir intégré.
        let uids: Vec<u32> = uids.into_iter().map(NonZeroU32::get).collect();
        let messages = self.entetes_uids(dossier, &uids)?;
        if messages.len() != uids.len() {
            return Err(ErreurMail::Protocole);
        }
        Ok((etat.uid_validity, messages))
    }

    /// Octets RFC822 d'un UID.
    pub fn lire_rfc822(&mut self, dossier: &str, uid: u32) -> Result<Vec<u8>, ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
        let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
            MessageDataItemName::Uid,
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
        for (_cle, morceaux) in fetched {
            for item in morceaux {
                if let MessageDataItem::Rfc822(valeur) = item {
                    return Ok(nstring_octets(&valeur));
                }
            }
        }
        Err(ErreurMail::Protocole)
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

    /// Dossiers du compte avec leurs attributs (LIST "" "*"), noms décodés.
    pub fn lister_dossiers(&mut self) -> Result<Vec<DossierListe>, ErreurMail> {
        let reference = boite("")?;
        let motif: io_imap::types::mailbox::ListMailbox<'static> = "*"
            .to_owned()
            .try_into()
            .map_err(|_| ErreurMail::Protocole)?;
        let lignes = self
            .client
            .list(reference, motif)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(lignes
            .into_iter()
            .map(|(nom, delimiteur, attributs)| DossierListe {
                nom: nom_boite(&nom),
                delimiteur: delimiteur.map(|d| d.inner()),
                attributs: attributs.iter().map(ToString::to_string).collect(),
            })
            .collect())
    }

    /// Dossier des brouillons : attribut `\Drafts` annoncé par le serveur, à défaut « Drafts »
    /// ou « Brouillons » existants, à défaut [`crate::DOSSIER_BROUILLONS`].
    pub fn dossier_brouillons(&mut self) -> Result<String, ErreurMail> {
        let dossiers = self.lister_dossiers()?;
        Ok(choisir_dossier_brouillons(&dossiers))
    }

    /// Dossier des envoyés : attribut `\Sent` annoncé par le serveur, à défaut « Sent » ou
    /// « Envoyés » existants, à défaut [`crate::DOSSIER_ENVOYES`].
    pub fn dossier_envoyes(&mut self) -> Result<String, ErreurMail> {
        let dossiers = self.lister_dossiers()?;
        Ok(choisir_dossier_envoyes(&dossiers))
    }

    /// UID des messages dont le `Message-ID` est exactement celui-ci (forme avec chevrons : une
    /// recherche sans chevrons trouverait aussi les identifiants qui le contiennent).
    pub fn uids_message_id(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<Vec<u32>, ErreurMail> {
        let nu = message_id
            .trim()
            .trim_start_matches('<')
            .trim_end_matches('>');
        if nu.is_empty() || nu.contains(['\r', '\n', '<', '>']) {
            return Err(ErreurMail::Protocole);
        }
        if self.selectionner(dossier).is_err() {
            // Dossier absent : aucune copie à retrouver.
            return Ok(Vec::new());
        }
        let champ =
            AString::try_from("Message-ID".to_owned()).map_err(|_| ErreurMail::Protocole)?;
        let valeur = AString::try_from(format!("<{nu}>")).map_err(|_| ErreurMail::Protocole)?;
        let criteres = Vec1::try_from(vec![SearchKey::Header(champ, valeur)])
            .map_err(|_| ErreurMail::Protocole)?;
        let mut uids: Vec<u32> = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?
            .into_iter()
            .map(NonZeroU32::get)
            .collect();
        uids.sort_unstable();
        uids.dedup();
        Ok(uids)
    }

    /// APPEND d'une version de brouillon (`\Draft`, `\Seen`), puis retrait des versions
    /// précédentes de même `Message-ID`. L'APPEND passe en premier : s'il échoue, rien n'est
    /// retiré.
    pub fn deposer_brouillon(
        &mut self,
        dossier: &str,
        message_id: &str,
        octets: &[u8],
    ) -> Result<usize, ErreurMail> {
        self.assurer_dossier(dossier)?;
        let anciennes = self.uids_message_id(dossier, message_id)?;
        let options = ImapMessageAppendOptions {
            flags: vec![Flag::Draft, Flag::Seen],
            ..ImapMessageAppendOptions::default()
        };
        self.client
            .append(boite(dossier)?, octets, options)
            .map_err(|_| ErreurMail::Protocole)?;
        if anciennes.is_empty() {
            return Ok(0);
        }
        self.supprimer_uids(dossier, &anciennes)?;
        Ok(anciennes.len())
    }

    /// Retire du dossier tous les messages de ce `Message-ID`.
    pub fn retirer_message_id(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<usize, ErreurMail> {
        let uids = self.uids_message_id(dossier, message_id)?;
        if uids.is_empty() {
            return Ok(0);
        }
        self.supprimer_uids(dossier, &uids)?;
        Ok(uids.len())
    }

    fn supprimer_uids(&mut self, dossier: &str, uids: &[u32]) -> Result<(), ErreurMail> {
        if uids.is_empty() {
            return Ok(());
        }
        self.selectionner(dossier)?;
        let jeu: SequenceSet = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",")
            .parse()
            .map_err(|_| ErreurMail::Protocole)?;
        self.client
            .store(
                jeu.clone(),
                StoreType::Add,
                vec![Flag::Deleted],
                ImapMessageStoreOptions { uid: true },
            )
            .map_err(|_| ErreurMail::Protocole)?;
        self.client
            .uid_expunge(jeu)
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(())
    }

    /// Drapeaux d'un UID (« \Draft \Seen »), triés.
    pub fn drapeaux(&mut self, dossier: &str, uid: u32) -> Result<String, ErreurMail> {
        self.selectionner(dossier)?;
        let jeu = sequence_un(uid)?;
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
                    modifiers: Vec::new(),
                },
            )
            .map_err(|_| ErreurMail::Protocole)?;
        let mut noms = Vec::new();
        for (_cle, morceaux) in fetched {
            for item in morceaux {
                if let MessageDataItem::Flags(drapeaux) = item {
                    for drapeau in &drapeaux {
                        if let io_imap::types::flag::FlagFetch::Flag(flag) = drapeau {
                            noms.push(flag.to_string());
                        }
                    }
                }
            }
        }
        noms.sort();
        Ok(noms.join(" "))
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

/// Dossier tel que le serveur le liste (aucun type io-imap).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierListe {
    pub nom: String,
    pub delimiteur: Option<char>,
    /// Attributs avec leur antislash (`\Drafts`, `\HasNoChildren`…).
    pub attributs: Vec<String>,
}

fn nom_boite(boite: &Mailbox<'_>) -> String {
    match boite {
        Mailbox::Inbox => "INBOX".to_owned(),
        Mailbox::Other(autre) => String::from_utf8_lossy(autre.as_ref()).into_owned(),
    }
}

/// Dossier spécial d'un compte : attribut d'usage spécial (RFC 6154) annoncé par le serveur ;
/// à défaut, un dossier existant de l'un des `noms` ; à défaut, `defaut`. Le dernier composant
/// du nom compte (« INBOX.Drafts », « INBOX/Brouillons »).
fn choisir_dossier_special(
    dossiers: &[DossierListe],
    attribut: &str,
    noms: &[&str],
    defaut: &str,
) -> String {
    let selectionnable = |d: &&DossierListe| {
        !d.attributs
            .iter()
            .any(|a| a.eq_ignore_ascii_case("\\Noselect"))
    };
    if let Some(d) = dossiers
        .iter()
        .filter(selectionnable)
        .find(|d| d.attributs.iter().any(|a| a.eq_ignore_ascii_case(attribut)))
    {
        return d.nom.clone();
    }
    let dernier = |d: &DossierListe| -> String {
        d.nom
            .rsplit(|c| c == '/' || c == '.' || Some(c) == d.delimiteur)
            .next()
            .unwrap_or_default()
            .to_owned()
    };
    for nom in noms {
        if let Some(d) = dossiers
            .iter()
            .filter(selectionnable)
            .find(|d| dernier(d).eq_ignore_ascii_case(nom))
        {
            return d.nom.clone();
        }
    }
    defaut.to_owned()
}

/// Ordre : attribut `\Drafts` (sélectionnable) ; nom « Drafts » ; nom « Brouillons » ; défaut.
pub(crate) fn choisir_dossier_brouillons(dossiers: &[DossierListe]) -> String {
    choisir_dossier_special(
        dossiers,
        "\\Drafts",
        &["drafts", "brouillons"],
        crate::DOSSIER_BROUILLONS,
    )
}

/// Ordre : attribut `\Sent` (sélectionnable) ; nom « Sent » ; nom « Envoyés » ; défaut « Sent ».
pub(crate) fn choisir_dossier_envoyes(dossiers: &[DossierListe]) -> String {
    choisir_dossier_special(
        dossiers,
        "\\Sent",
        &["sent", "envoyés", "envoyes"],
        crate::DOSSIER_ENVOYES,
    )
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
    pub condstore: bool,
    pub uid_validity: u32,
    pub modseq: u64,
    pub etats: Vec<EtatUid>,
    /// UID encore présents. Vide hors chemin CONDSTORE : le moteur ne s'en sert pas.
    pub uids_presents: Vec<u32>,
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
        } else if caps.condstore && modseq_connu > 0 {
            self.delta_condstore(dossier, modseq_connu)
        } else if caps.condstore {
            self.premiere_condstore(dossier)
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
            condstore: false,
            uid_validity,
            modseq,
            etats,
            uids_presents: Vec::new(),
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
            condstore: false,
            uid_validity: uid_validity.get(),
            modseq,
            etats,
            uids_presents: Vec::new(),
            retires,
            commandes: vec![
                "ENABLE QRESYNC".into(),
                format!("SELECT QRESYNC {modseq_connu}"),
                format!("FETCH CHANGEDSINCE {modseq_connu}"),
            ],
        })
    }

    fn premiere_condstore(&mut self, dossier: &str) -> Result<ReleveDossier, ErreurMail> {
        let selection = self
            .client
            .select(boite(dossier)?, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        let uid_validity = selection
            .uid_validity
            .map(|v| v.get())
            .ok_or(ErreurMail::Protocole)?;
        let modseq = selection.highest_mod_seq.unwrap_or(1);
        let uids = self.lister_uids()?;
        let etats = self.lire_etats(None)?;
        Ok(ReleveDossier {
            qresync: false,
            condstore: true,
            uid_validity,
            modseq,
            etats,
            uids_presents: uids,
            retires: Vec::new(),
            commandes: vec!["UID SEARCH".into(), "FETCH FLAGS INITIAL".into()],
        })
    }

    /// Drapeaux par CHANGEDSINCE, présences par UID SEARCH. Pas de photographie complète.
    fn delta_condstore(
        &mut self,
        dossier: &str,
        modseq_connu: u64,
    ) -> Result<ReleveDossier, ErreurMail> {
        let selection = self
            .client
            .select(boite(dossier)?, Default::default())
            .map_err(|_| ErreurMail::Protocole)?;
        let uid_validity = selection
            .uid_validity
            .map(|v| v.get())
            .ok_or(ErreurMail::Protocole)?;
        let modseq = selection.highest_mod_seq.unwrap_or(modseq_connu);
        let uids = self.lister_uids()?;
        let etats = self.lire_etats(Some(modseq_connu))?;
        Ok(ReleveDossier {
            qresync: false,
            condstore: true,
            uid_validity,
            modseq,
            etats,
            uids_presents: uids,
            retires: Vec::new(),
            commandes: vec![
                "UID SEARCH".into(),
                format!("FETCH CHANGEDSINCE {modseq_connu}"),
            ],
        })
    }

    fn lister_uids(&mut self) -> Result<Vec<u32>, ErreurMail> {
        let criteres = Vec1::try_from(vec![SearchKey::All]).map_err(|_| ErreurMail::Protocole)?;
        let mut uids = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?;
        uids.sort_unstable();
        Ok(uids.into_iter().map(|uid| uid.get()).collect())
    }

    fn photographie_repli(&mut self, dossier: &str) -> Result<ReleveDossier, ErreurMail> {
        let etat = self.examiner(dossier)?;
        self.selectionner(dossier)?;
        let etats = self.lire_etats(None)?;
        Ok(ReleveDossier {
            qresync: false,
            condstore: false,
            uid_validity: etat.uid_validity,
            modseq: 0,
            etats,
            uids_presents: Vec::new(),
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

    fn apercus(&mut self, uids: &str) -> std::collections::HashMap<u32, Vec<u8>> {
        let Ok(jeu) = uids.parse::<SequenceSet>() else {
            return std::collections::HashMap::new();
        };
        let Ok(fetched) = self.client.fetch(
            jeu,
            items_apercu(),
            ImapMessageFetchOptions {
                uid: true,
                modifiers: Vec::new(),
            },
        ) else {
            return std::collections::HashMap::new();
        };
        let mut carte = std::collections::HashMap::new();
        for (_cle, morceaux) in fetched {
            let mut uid = None;
            let mut data = None;
            for item in morceaux {
                match item {
                    MessageDataItem::Uid(valeur) => uid = Some(valeur.get()),
                    MessageDataItem::BodyExt { data: valeur, .. } => {
                        data = Some(nstring_octets(&valeur));
                    }
                    _ => {}
                }
            }
            if let (Some(uid), Some(octets)) = (uid, data) {
                carte.insert(uid, octets);
            }
        }
        carte
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
            let carte = self.apercus(&texte);
            let fetched = self
                .client
                .fetch(
                    jeu,
                    items_entete(),
                    ImapMessageFetchOptions {
                        uid: true,
                        modifiers: Vec::new(),
                    },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            for (_cle, items) in fetched {
                let mut uid_lu = None;
                let mut octets = None;
                let mut structure_lue = StructureLue::default();
                for item in items {
                    match item {
                        MessageDataItem::Uid(valeur) => uid_lu = Some(valeur.get()),
                        MessageDataItem::Rfc822Header(valeur) => {
                            octets = Some(nstring_octets(&valeur))
                        }
                        MessageDataItem::BodyStructure(structure) => {
                            structure_lue = lire_structure(&structure);
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
                        structure_lue,
                        extrait_depuis(&octets, carte.get(&uid_lu).map(Vec::as_slice), &analyseur),
                    ));
                }
            }
        }
        messages.sort_by_key(|m| m.uid);
        Ok(messages)
    }
}

/// Dossier par défaut de la Corbeille, créé au premier besoin quand le serveur n'en annonce aucun
/// (nom français, comme [`crate::DOSSIER_BROUILLONS`]).
pub const DOSSIER_CORBEILLE: &str = "Corbeille";
/// Dossier par défaut des archives, créé au premier besoin.
pub const DOSSIER_ARCHIVES: &str = "Archives";

/// Où est un message sur le serveur : génération du dossier (UIDVALIDITY) et UID. `uid` est vide
/// quand le serveur n'a pas dit le nouvel UID après une copie (pas de COPYUID) et que le message
/// n'a pas d'identifiant exploitable pour le retrouver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Emplacement {
    pub uid_validity: u32,
    pub uid: Option<u32>,
}

/// Issue d'un déplacement. Un rejeu sur un message déjà déplacé n'est pas une erreur : le message
/// est retrouvé à sa destination (`deja_fait`) et rien n'est recopié.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueDeplacement {
    Place {
        emplacement: Emplacement,
        deja_fait: bool,
    },
    /// Ni dans le dossier d'origine ni à la destination : retiré du serveur par un autre client.
    Introuvable,
}

/// Capacités qui décident de la façon de déplacer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CapacitesDeplacement {
    /// RFC 6851 : MOVE atomique.
    deplacer: bool,
    /// RFC 4315 : UID EXPUNGE ne retire que l'UID demandé.
    uid_plus: bool,
}

/// L'identifiant a été fabriqué par la relève faute d'en-tête `Message-ID` : il ne se cherche pas
/// sur le serveur.
pub(crate) fn message_id_synthetique(message_id: &str) -> bool {
    message_id.starts_with("<uid-") && message_id.ends_with("@legalos.local>")
}

/// Ordre : attribut `\Trash` (sélectionnable) ; noms courants (Trash, Corbeille, Deleted Items…) ;
/// défaut [`DOSSIER_CORBEILLE`].
pub(crate) fn choisir_dossier_corbeille(dossiers: &[DossierListe]) -> String {
    choisir_dossier_special(
        dossiers,
        "\\Trash",
        &[
            "trash",
            "corbeille",
            "deleted items",
            "deleted messages",
            "éléments supprimés",
            "elements supprimes",
        ],
        DOSSIER_CORBEILLE,
    )
}

/// Ordre : attribut `\Archive` (sélectionnable) ; noms courants (Archive, Archives, Archivés) ;
/// défaut [`DOSSIER_ARCHIVES`].
pub(crate) fn choisir_dossier_archives(dossiers: &[DossierListe]) -> String {
    choisir_dossier_special(
        dossiers,
        "\\Archive",
        &["archive", "archives", "archivés", "archives"],
        DOSSIER_ARCHIVES,
    )
}

impl Session {
    /// Dossier de la Corbeille du compte (voir [`choisir_dossier_corbeille`]).
    pub fn dossier_corbeille(&mut self) -> Result<String, ErreurMail> {
        let dossiers = self.lister_dossiers()?;
        Ok(choisir_dossier_corbeille(&dossiers))
    }

    /// Dossier des archives du compte (voir [`choisir_dossier_archives`]).
    pub fn dossier_archives(&mut self) -> Result<String, ErreurMail> {
        let dossiers = self.lister_dossiers()?;
        Ok(choisir_dossier_archives(&dossiers))
    }

    fn capacites_deplacement(&mut self) -> Result<CapacitesDeplacement, ErreurMail> {
        let brutes = self
            .client
            .capability()
            .map_err(|_| ErreurMail::Protocole)?;
        Ok(CapacitesDeplacement {
            deplacer: has_imap_capability!(brutes, Move),
            uid_plus: has_imap_capability!(brutes, UidPlus),
        })
    }

    /// Sélectionne le dossier ; `None` s'il n'existe pas (absent de LIST). Toute autre cause de
    /// refus reste une erreur : un serveur qui bégaie n'est pas un dossier absent.
    fn selectionner_si_existe(&mut self, dossier: &str) -> Result<Option<u32>, ErreurMail> {
        let selection = match self.client.select(boite(dossier)?, Default::default()) {
            Ok(selection) => selection,
            Err(_) => {
                let existe = self
                    .lister_dossiers()?
                    .iter()
                    .any(|presente| presente.nom == dossier);
                return if existe {
                    Err(ErreurMail::Protocole)
                } else {
                    Ok(None)
                };
            }
        };
        selection
            .uid_validity
            .map(|valeur| Some(valeur.get()))
            .ok_or(ErreurMail::Protocole)
    }

    /// `Message-ID` d'un UID du dossier sélectionné, forme normalisée (vide si l'en-tête manque),
    /// `None` si l'UID n'existe pas.
    fn message_id_de_uid(&mut self, uid: u32) -> Result<Option<String>, ErreurMail> {
        let fetched = self
            .client
            .fetch(
                sequence_un(uid)?,
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
        for (_cle, morceaux) in fetched {
            for item in morceaux {
                if let MessageDataItem::Rfc822Header(valeur) = item {
                    let octets = nstring_octets(&valeur);
                    let identifiant = MessageParser::default()
                        .parse(&octets)
                        .as_ref()
                        .and_then(|message| message.message_id())
                        .map(normaliser_message_id)
                        .unwrap_or_default();
                    return Ok(Some(identifiant));
                }
            }
        }
        Ok(None)
    }

    /// UID du dossier sélectionné portant ce `Message-ID`, du plus ancien au plus récent.
    fn uids_du_message_id(&mut self, message_id: &str) -> Result<Vec<u32>, ErreurMail> {
        let nu = message_id
            .trim()
            .trim_start_matches('<')
            .trim_end_matches('>');
        if nu.is_empty() || nu.contains(['\r', '\n', '<', '>']) {
            return Err(ErreurMail::Protocole);
        }
        let champ =
            AString::try_from("Message-ID".to_owned()).map_err(|_| ErreurMail::Protocole)?;
        let valeur = AString::try_from(format!("<{nu}>")).map_err(|_| ErreurMail::Protocole)?;
        let criteres = Vec1::try_from(vec![SearchKey::Header(champ, valeur)])
            .map_err(|_| ErreurMail::Protocole)?;
        let mut uids: Vec<u32> = self
            .client
            .search(criteres, ImapMessageSearchOptions { uid: true })
            .map_err(|_| ErreurMail::Protocole)?
            .into_iter()
            .map(NonZeroU32::get)
            .collect();
        uids.sort_unstable();
        uids.dedup();
        Ok(uids)
    }

    /// Retrouve un message dans un dossier. L'UID connu ne vaut que si la UIDVALIDITY est restée
    /// la même **et** si le `Message-ID` de cet UID est bien celui du message (un UID peut être
    /// réattribué). Sinon, recherche par `Message-ID` ; un message sans identifiant exploitable
    /// n'a que son UID. Le dossier reste sélectionné. `None` : le message n'y est plus.
    pub fn localiser_message(
        &mut self,
        dossier: &str,
        uid_validity: u32,
        uid: u32,
        message_id: &str,
    ) -> Result<Option<Emplacement>, ErreurMail> {
        let Some(validite) = self.selectionner_si_existe(dossier)? else {
            return Ok(None);
        };
        let synthetique = message_id_synthetique(message_id);
        if validite == uid_validity && uid > 0 {
            match self.message_id_de_uid(uid)? {
                Some(trouve) if synthetique && trouve.is_empty() => {
                    return Ok(Some(Emplacement {
                        uid_validity: validite,
                        uid: Some(uid),
                    }));
                }
                Some(trouve) if !synthetique && trouve == normaliser_message_id(message_id) => {
                    return Ok(Some(Emplacement {
                        uid_validity: validite,
                        uid: Some(uid),
                    }));
                }
                _ => {}
            }
        }
        if synthetique {
            return Ok(None);
        }
        Ok(self
            .uids_du_message_id(message_id)?
            .last()
            .map(|trouve| Emplacement {
                uid_validity: validite,
                uid: Some(*trouve),
            }))
    }

    /// Emplacement du message dans un dossier, cherché par `Message-ID` seulement.
    fn emplacement_par_message_id(
        &mut self,
        dossier: &str,
        message_id: &str,
    ) -> Result<Option<Emplacement>, ErreurMail> {
        if message_id_synthetique(message_id) {
            return Ok(None);
        }
        let Some(validite) = self.selectionner_si_existe(dossier)? else {
            return Ok(None);
        };
        Ok(self
            .uids_du_message_id(message_id)?
            .last()
            .map(|uid| Emplacement {
                uid_validity: validite,
                uid: Some(*uid),
            }))
    }

    /// Emplacement à la destination après un MOVE ou un COPY : le COPYUID du serveur s'il l'a
    /// donné, sinon recherche par `Message-ID`, sinon la génération du dossier sans UID.
    fn emplacement_apres_copie(
        &mut self,
        copie: Option<(u32, Vec<u32>, Vec<u32>)>,
        destination: &str,
        message_id: &str,
    ) -> Result<Emplacement, ErreurMail> {
        if let Some((validite, _, destinations)) = copie {
            if let Some(uid) = destinations.first() {
                return Ok(Emplacement {
                    uid_validity: validite,
                    uid: Some(*uid),
                });
            }
        }
        if let Some(trouve) = self.emplacement_par_message_id(destination, message_id)? {
            return Ok(trouve);
        }
        let validite = self
            .selectionner_si_existe(destination)?
            .ok_or(ErreurMail::Protocole)?;
        Ok(Emplacement {
            uid_validity: validite,
            uid: None,
        })
    }

    /// Pose ou retire `\Seen` sur un message retrouvé, et relit l'état. Rejouable. `false` : le
    /// message n'est plus dans ce dossier.
    pub fn marquer_lu_message(
        &mut self,
        dossier: &str,
        uid_validity: u32,
        uid: u32,
        message_id: &str,
        lu: bool,
    ) -> Result<bool, ErreurMail> {
        let Some(place) = self.localiser_message(dossier, uid_validity, uid, message_id)? else {
            return Ok(false);
        };
        let uid = place.uid.ok_or(ErreurMail::Protocole)?;
        self.store_drapeau(dossier, uid, "\\Seen", lu)?;
        if self.lire_lu(dossier, uid)? != lu {
            return Err(ErreurMail::Protocole);
        }
        Ok(true)
    }

    /// Déplace un message vers un dossier (créé au besoin). Rejouable sans doublon :
    ///
    /// * le message est d'abord retrouvé (UID vérifié par son `Message-ID`, sinon recherche) ;
    /// * absent de l'origine mais présent à la destination : déjà déplacé, rien n'est refait ;
    /// * avec MOVE, une seule commande atomique ; sans MOVE, COPY (sauf si la destination porte
    ///   déjà ce message), puis seulement une fois la copie confirmée, `\Deleted` sur l'original
    ///   et, si le serveur sait retirer un seul UID (UIDPLUS), `UID EXPUNGE` de cet UID.
    ///
    /// Jamais d'EXPUNGE général, jamais dans le dossier de destination, et jamais d'EXPUNGE d'un
    /// message dont la copie n'est pas confirmée ailleurs.
    pub fn deplacer_message(
        &mut self,
        origine: &str,
        uid_validity: u32,
        uid: u32,
        message_id: &str,
        destination: &str,
    ) -> Result<IssueDeplacement, ErreurMail> {
        self.assurer_dossier(destination)?;
        let present = self.localiser_message(origine, uid_validity, uid, message_id)?;
        if origine == destination {
            return Ok(match present {
                Some(emplacement) => IssueDeplacement::Place {
                    emplacement,
                    deja_fait: true,
                },
                None => IssueDeplacement::Introuvable,
            });
        }
        let Some(present) = present else {
            return Ok(
                match self.emplacement_par_message_id(destination, message_id)? {
                    Some(emplacement) => IssueDeplacement::Place {
                        emplacement,
                        deja_fait: true,
                    },
                    None => IssueDeplacement::Introuvable,
                },
            );
        };
        let uid_origine = present.uid.ok_or(ErreurMail::Protocole)?;
        let capacites = self.capacites_deplacement()?;
        if capacites.deplacer {
            self.selectionner(origine)?;
            let copie = self
                .client
                .r#move(
                    sequence_un(uid_origine)?,
                    boite(destination)?,
                    ImapMessageMoveOptions { uid: true },
                )
                .map_err(|_| ErreurMail::Protocole)?;
            let emplacement = self.emplacement_apres_copie(copie, destination, message_id)?;
            return Ok(IssueDeplacement::Place {
                emplacement,
                deja_fait: false,
            });
        }
        // Sans MOVE : une copie déjà présente (tentative précédente interrompue) n'est pas refaite.
        let (emplacement, copie_confirmee) = match self
            .emplacement_par_message_id(destination, message_id)?
        {
            Some(emplacement) => (emplacement, true),
            None => {
                self.selectionner(origine)?;
                let copie = self
                    .client
                    .copy(
                        sequence_un(uid_origine)?,
                        boite(destination)?,
                        ImapMessageCopyOptions { uid: true },
                    )
                    .map_err(|_| ErreurMail::Protocole)?;
                let confirmee_par_le_serveur = copie.is_some();
                let emplacement = self.emplacement_apres_copie(copie, destination, message_id)?;
                // Une copie sans COPYUID se confirme par sa présence à la destination.
                (
                    emplacement,
                    confirmee_par_le_serveur || emplacement.uid.is_some(),
                )
            }
        };
        if copie_confirmee {
            self.store_drapeau(origine, uid_origine, "\\Deleted", true)?;
            if capacites.uid_plus {
                self.client
                    .uid_expunge(sequence_un(uid_origine)?)
                    .map_err(|_| ErreurMail::Protocole)?;
            }
        }
        Ok(IssueDeplacement::Place {
            emplacement,
            deja_fait: false,
        })
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

fn items_entete() -> MacroOrMessageDataItemNames<'static> {
    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
        MessageDataItemName::Uid,
        MessageDataItemName::Rfc822Header,
        MessageDataItemName::BodyStructure,
    ])
}

fn items_apercu() -> MacroOrMessageDataItemNames<'static> {
    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
        MessageDataItemName::Uid,
        MessageDataItemName::BodyExt {
            section: Some(Section::Text(None)),
            partial: Some((0, NonZeroU32::new(1024).unwrap_or(NonZeroU32::MIN))),
            peek: true,
        },
    ])
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
    structure: StructureLue,
    extrait: String,
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
        pieces: structure.pieces,
        extrait,
        calendrier: structure.calendrier,
        date: message
            .as_ref()
            .and_then(crate::date_entete::instant_entete),
    }
}

fn extrait_depuis(en_tetes: &[u8], corps: Option<&[u8]>, analyseur: &MessageParser) -> String {
    let mut brut = en_tetes.to_vec();
    if let Some(corps) = corps {
        if !brut.ends_with(b"\n") {
            brut.extend_from_slice(b"\r\n");
        }
        brut.extend_from_slice(corps);
    }
    let message = analyseur.parse(&brut);
    let texte = message
        .as_ref()
        .and_then(|m| m.body_text(0))
        .map(|c| c.to_string())
        .filter(|t| !t.trim().is_empty())
        .or_else(|| {
            message
                .as_ref()
                .and_then(|m| m.body_html(0))
                .map(|c| crate::texte_depuis_html(&crate::nettoyer_html(c.as_ref())))
        })
        .unwrap_or_default();
    texte
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect()
}

/// Ce que BODYSTRUCTURE apprend sur un message sans le télécharger.
#[derive(Default)]
struct StructureLue {
    pieces: Vec<String>,
    calendrier: bool,
}

fn lire_structure(structure: &io_imap::types::body::BodyStructure<'_>) -> StructureLue {
    StructureLue {
        pieces: noms_pieces(structure),
        calendrier: a_partie_calendrier(structure),
    }
}

/// Une partie `text/calendar` ou `application/ics`, à n'importe quelle profondeur.
fn a_partie_calendrier(structure: &io_imap::types::body::BodyStructure<'_>) -> bool {
    use io_imap::types::body::{BodyStructure, SpecificFields};
    match structure {
        BodyStructure::Single { body, .. } => match &body.specific {
            SpecificFields::Text { subtype, .. } => {
                chaine_imap(subtype).eq_ignore_ascii_case("calendar")
            }
            SpecificFields::Basic { r#type, subtype } => {
                chaine_imap(r#type).eq_ignore_ascii_case("application")
                    && chaine_imap(subtype).eq_ignore_ascii_case("ics")
            }
            SpecificFields::Message { .. } => false,
        },
        BodyStructure::Multi { bodies, .. } => bodies.as_ref().iter().any(a_partie_calendrier),
    }
}

fn noms_pieces(structure: &io_imap::types::body::BodyStructure<'_>) -> Vec<String> {
    let mut noms = Vec::new();
    collecter_pieces(structure, &mut noms);
    noms
}

fn collecter_pieces(structure: &io_imap::types::body::BodyStructure<'_>, noms: &mut Vec<String>) {
    use io_imap::types::body::BodyStructure;
    match structure {
        BodyStructure::Single {
            body,
            extension_data,
        } => {
            if let Some(nom) = nom_piece(body, extension_data.as_ref()) {
                noms.push(nom);
            }
        }
        BodyStructure::Multi { bodies, .. } => {
            for partie in bodies.as_ref() {
                collecter_pieces(partie, noms);
            }
        }
    }
}

fn nom_piece(
    body: &io_imap::types::body::Body<'_>,
    extension: Option<&io_imap::types::body::SinglePartExtensionData<'_>>,
) -> Option<String> {
    let depuis_disposition = extension
        .and_then(|ext| ext.tail.as_ref())
        .and_then(|disposition| disposition.disposition.as_ref())
        .and_then(|(_genre, params)| {
            params.iter().find_map(|(cle, valeur)| {
                let nom = chaine_imap(valeur);
                chaine_imap(cle)
                    .eq_ignore_ascii_case("filename")
                    .then_some(nom)
                    .filter(|nom| !nom.is_empty())
            })
        });
    if depuis_disposition.is_some() {
        return depuis_disposition;
    }
    body.basic.parameter_list.iter().find_map(|(cle, valeur)| {
        chaine_imap(cle)
            .eq_ignore_ascii_case("name")
            .then(|| chaine_imap(valeur))
            .filter(|nom| !nom.is_empty())
    })
}

fn chaine_imap(valeur: &io_imap::types::core::IString<'_>) -> String {
    String::from_utf8_lossy(&valeur.clone().into_inner())
        .replace(['\r', '\n'], " ")
        .trim()
        .to_owned()
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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::{a_partie_calendrier, noms_pieces};
    use io_imap::types::body::{
        BasicFields, Body, BodyStructure, Disposition, SinglePartExtensionData, SpecificFields,
    };
    use io_imap::types::core::{IString, NString, Vec1};

    fn chaine(valeur: &str) -> IString<'static> {
        IString::try_from(valeur.to_owned()).expect("chaine")
    }

    fn vide() -> NString<'static> {
        NString(None)
    }

    fn texte() -> BodyStructure<'static> {
        BodyStructure::Single {
            body: Body {
                basic: BasicFields {
                    parameter_list: vec![(chaine("charset"), chaine("utf-8"))],
                    id: vide(),
                    description: vide(),
                    content_transfer_encoding: chaine("7bit"),
                    size: 5,
                },
                specific: SpecificFields::Text {
                    subtype: chaine("plain"),
                    number_of_lines: 1,
                },
            },
            extension_data: None,
        }
    }

    fn pdf() -> BodyStructure<'static> {
        BodyStructure::Single {
            body: Body {
                basic: BasicFields {
                    parameter_list: vec![(chaine("name"), chaine("Convocation.pdf"))],
                    id: vide(),
                    description: vide(),
                    content_transfer_encoding: chaine("base64"),
                    size: 12,
                },
                specific: SpecificFields::Basic {
                    r#type: chaine("application"),
                    subtype: chaine("pdf"),
                },
            },
            extension_data: Some(SinglePartExtensionData {
                md5: vide(),
                tail: Some(Disposition {
                    disposition: Some((
                        chaine("attachment"),
                        vec![(chaine("filename"), chaine("Convocation.pdf"))],
                    )),
                    tail: None,
                }),
            }),
        }
    }

    #[test]
    fn piece_jointe_nommee_sans_corps_texte() {
        let multi = BodyStructure::Multi {
            bodies: Vec1::try_from(vec![texte(), pdf()]).expect("parties"),
            subtype: chaine("mixed"),
            extension_data: None,
        };
        assert_eq!(noms_pieces(&multi), vec!["Convocation.pdf".to_owned()]);
        assert!(noms_pieces(&texte()).is_empty());
    }

    fn calendrier(type_texte: bool) -> BodyStructure<'static> {
        BodyStructure::Single {
            body: Body {
                basic: BasicFields {
                    parameter_list: vec![(chaine("method"), chaine("REQUEST"))],
                    id: vide(),
                    description: vide(),
                    content_transfer_encoding: chaine("7bit"),
                    size: 300,
                },
                specific: if type_texte {
                    SpecificFields::Text {
                        subtype: chaine("CALENDAR"),
                        number_of_lines: 10,
                    }
                } else {
                    SpecificFields::Basic {
                        r#type: chaine("application"),
                        subtype: chaine("ics"),
                    }
                },
            },
            extension_data: None,
        }
    }

    #[test]
    fn partie_calendrier_vue_dans_la_structure_a_toute_profondeur() {
        assert!(a_partie_calendrier(&calendrier(true)));
        assert!(a_partie_calendrier(&calendrier(false)));
        let alternative = BodyStructure::Multi {
            bodies: Vec1::try_from(vec![texte(), calendrier(true)]).expect("parties"),
            subtype: chaine("alternative"),
            extension_data: None,
        };
        let englobant = BodyStructure::Multi {
            bodies: Vec1::try_from(vec![alternative, pdf()]).expect("parties"),
            subtype: chaine("mixed"),
            extension_data: None,
        };
        assert!(a_partie_calendrier(&englobant));
        // Essais négatifs : ni un texte simple, ni une pièce PDF, ni leur assemblage.
        assert!(!a_partie_calendrier(&texte()));
        assert!(!a_partie_calendrier(&pdf()));
        let sans = BodyStructure::Multi {
            bodies: Vec1::try_from(vec![texte(), pdf()]).expect("parties"),
            subtype: chaine("mixed"),
            extension_data: None,
        };
        assert!(!a_partie_calendrier(&sans));
    }

    fn dossier(nom: &str, attributs: &[&str]) -> super::DossierListe {
        super::DossierListe {
            nom: nom.to_owned(),
            delimiteur: Some('/'),
            attributs: attributs.iter().map(|a| (*a).to_owned()).collect(),
        }
    }

    #[test]
    fn dossier_des_brouillons_attribut_special_puis_noms_connus_puis_defaut() {
        use super::choisir_dossier_brouillons as choisir;
        // L'attribut annoncé par le serveur l'emporte, même sur un dossier nommé « Drafts ».
        let avec_attribut = vec![
            dossier("INBOX", &["\\HasNoChildren"]),
            dossier("Drafts", &[]),
            dossier("Ebauches", &["\\Drafts", "\\HasNoChildren"]),
        ];
        assert_eq!(choisir(&avec_attribut), "Ebauches");
        // Essai négatif : sans l'attribut, le nom connu est retenu.
        let sans_attribut = vec![dossier("INBOX", &[]), dossier("Drafts", &[])];
        assert_eq!(choisir(&sans_attribut), "Drafts");
        assert_eq!(
            choisir(&[dossier("INBOX", &[]), dossier("INBOX/Brouillons", &[])]),
            "INBOX/Brouillons"
        );
        // Un dossier non sélectionnable n'est pas retenu.
        assert_eq!(
            choisir(&[dossier("Ebauches", &["\\Drafts", "\\Noselect"])]),
            crate::DOSSIER_BROUILLONS
        );
        // Aucun dossier connu : le défaut, créé au premier dépôt.
        assert_eq!(choisir(&[dossier("INBOX", &[])]), "Brouillons");
        assert_eq!(choisir(&[]), "Brouillons");
    }

    #[test]
    fn dossier_des_envoyes_attribut_special_puis_noms_connus_puis_defaut() {
        use super::choisir_dossier_envoyes as choisir;
        // Fournisseur qui nomme le dossier à sa façon : l'attribut annoncé l'emporte.
        let avec_attribut = vec![
            dossier("INBOX", &["\\HasNoChildren"]),
            dossier("Sent", &[]),
            dossier("Éléments envoyés", &["\\Sent"]),
        ];
        assert_eq!(choisir(&avec_attribut), "Éléments envoyés");
        // Essai négatif : sans l'attribut, c'est le nom connu qui est retenu.
        assert_eq!(
            choisir(&[dossier("INBOX", &[]), dossier("INBOX.Envoyés", &[])]),
            "INBOX.Envoyés"
        );
        // Un dossier non sélectionnable n'est pas retenu ; aucun dossier connu : le défaut.
        assert_eq!(
            choisir(&[dossier("Sent", &["\\Sent", "\\Noselect"])]),
            crate::DOSSIER_ENVOYES
        );
        assert_eq!(choisir(&[]), "Sent");
    }

    #[test]
    fn dossier_de_la_corbeille_attribut_special_puis_noms_connus_puis_defaut() {
        use super::choisir_dossier_corbeille as choisir;
        // L'attribut annoncé l'emporte sur un dossier qui porte seulement le nom.
        let avec_attribut = vec![
            dossier("INBOX", &[]),
            dossier("Trash", &[]),
            dossier("[Gmail]/Bin", &["\\Trash"]),
        ];
        assert_eq!(choisir(&avec_attribut), "[Gmail]/Bin");
        // Essai négatif : sans attribut, le nom connu (dernier composant) est retenu.
        assert_eq!(
            choisir(&[dossier("INBOX", &[]), dossier("Deleted Items", &[])]),
            "Deleted Items"
        );
        assert_eq!(
            choisir(&[dossier("INBOX.Corbeille", &[])]),
            "INBOX.Corbeille"
        );
        // Un dossier non sélectionnable n'est pas retenu ; aucun dossier connu : le défaut,
        // créé au premier déplacement. La Corbeille n'est jamais confondue avec les archives.
        assert_eq!(
            choisir(&[dossier("Trash", &["\\Trash", "\\Noselect"])]),
            crate::DOSSIER_CORBEILLE
        );
        assert_eq!(choisir(&[dossier("Archive", &["\\Archive"])]), "Corbeille");
        assert_eq!(choisir(&[]), "Corbeille");
    }

    #[test]
    fn dossier_des_archives_attribut_special_puis_noms_connus_puis_defaut() {
        use super::choisir_dossier_archives as choisir;
        let avec_attribut = vec![
            dossier("Archives", &[]),
            dossier("Conservation", &["\\Archive"]),
        ];
        assert_eq!(choisir(&avec_attribut), "Conservation");
        assert_eq!(
            choisir(&[dossier("INBOX", &[]), dossier("Archives", &[])]),
            "Archives"
        );
        assert_eq!(choisir(&[dossier("Trash", &["\\Trash"])]), "Archives");
        assert_eq!(choisir(&[]), crate::DOSSIER_ARCHIVES);
    }

    #[test]
    fn identifiant_fabrique_par_la_releve_ne_se_cherche_pas_sur_le_serveur() {
        use super::message_id_synthetique as synthetique;
        assert!(synthetique("<uid-77-12@legalos.local>"));
        // Essais négatifs : un vrai identifiant, même d'un domaine voisin.
        assert!(!synthetique("<abc@example.com>"));
        assert!(!synthetique("<uid-77-12@legalos.example>"));
        assert!(!synthetique("<x-uid-77-12@legalos.local>"));
    }

    #[test]
    fn extrait_du_debut_du_corps() {
        let analyseur = mail_parser::MessageParser::default();
        let entete =
            b"From: a@example.com\r\nSubject: s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n";
        let corps = b"Texte de la convocation fictive.\r\n";
        let extrait = super::extrait_depuis(entete, Some(corps), &analyseur);
        assert!(extrait.contains("convocation fictive"));
        assert!(super::extrait_depuis(entete, None, &analyseur).is_empty());
    }
}
