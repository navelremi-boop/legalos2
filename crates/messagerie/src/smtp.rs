//! Envoi SMTP via `lettre`. Aucun journal du contenu.

use lettre::address::Envelope;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::SmtpTransport;
use lettre::{Message, Transport};

use crate::ErreurMail;

/// Chiffrement du transport SMTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChiffrementSmtp {
    /// En clair : serveurs de test et relais de confiance du réseau du cabinet.
    #[default]
    Aucun,
    /// Connexion en clair puis `STARTTLS` obligatoire (soumission, port 587).
    StartTls,
    /// TLS dès la connexion (port 465).
    Implicite,
}

impl ChiffrementSmtp {
    /// Valeur par défaut d'après le port : 465 TLS implicite, 587 STARTTLS, tout autre port en clair.
    #[must_use]
    pub fn selon_le_port(port: u16) -> Self {
        match port {
            465 => Self::Implicite,
            587 => Self::StartTls,
            _ => Self::Aucun,
        }
    }

    /// Lecture de la valeur stockée en base (`aucun`, `starttls`, `implicite`).
    #[must_use]
    pub fn depuis_texte(texte: &str) -> Option<Self> {
        match texte {
            "aucun" => Some(Self::Aucun),
            "starttls" => Some(Self::StartTls),
            "implicite" => Some(Self::Implicite),
            _ => None,
        }
    }

    #[must_use]
    pub fn texte(self) -> &'static str {
        match self {
            Self::Aucun => "aucun",
            Self::StartTls => "starttls",
            Self::Implicite => "implicite",
        }
    }
}

#[derive(Clone)]
pub struct ParametresSmtp {
    pub hote: String,
    pub port: u16,
    /// Vide : le serveur ne demande pas d'authentification (relais de confiance du réseau du
    /// cabinet) ; aucun identifiant n'est alors présenté.
    pub utilisateur: String,
    pub mot_de_passe: String,
    /// Adresse d'enveloppe / From (ex. demo@cabinet.example).
    pub adresse_from: String,
    pub chiffrement: ChiffrementSmtp,
    /// Jeton d'accès OAuth 2.0 : présent, l'authentification est `XOAUTH2` (l'utilisateur est l'adresse de la
    /// boîte) et le mot de passe est ignoré. Jamais journalisé.
    pub jeton_acces: Option<String>,
}

/// Transport SMTP : chiffré selon `chiffrement` (certificats vérifiés sur les racines Mozilla), authentifié par
/// mot de passe ou par XOAUTH2.
fn transport(parametres: &ParametresSmtp) -> Result<SmtpTransport, ErreurMail> {
    let constructeur = match parametres.chiffrement {
        ChiffrementSmtp::Aucun => SmtpTransport::builder_dangerous(&parametres.hote),
        ChiffrementSmtp::StartTls => {
            SmtpTransport::starttls_relay(&parametres.hote).map_err(|_| ErreurMail::Connexion)?
        }
        ChiffrementSmtp::Implicite => {
            SmtpTransport::relay(&parametres.hote).map_err(|_| ErreurMail::Connexion)?
        }
    };
    let mut constructeur = constructeur.port(parametres.port);
    if let Some(jeton) = &parametres.jeton_acces {
        constructeur = constructeur
            .credentials(Credentials::new(
                parametres.utilisateur.clone(),
                jeton.clone(),
            ))
            .authentication(vec![Mechanism::Xoauth2]);
    } else if !parametres.utilisateur.is_empty() {
        constructeur = constructeur.credentials(Credentials::new(
            parametres.utilisateur.clone(),
            parametres.mot_de_passe.clone(),
        ));
    }
    Ok(constructeur.build())
}

/// Envoie un message dont le Message-ID est déjà fixé. Ne crée jamais d'autre
/// identifiant.
pub fn envoyer_message_fixe(
    parametres: &ParametresSmtp,
    message_id: &str,
    destinataire: &str,
    objet: &str,
    corps: &str,
) -> Result<(), ErreurMail> {
    let from: Mailbox = parametres
        .adresse_from
        .parse()
        .map_err(|_| ErreurMail::Protocole)?;
    let to: Mailbox = destinataire.parse().map_err(|_| ErreurMail::Protocole)?;
    let id = message_id
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>');
    let message = Message::builder()
        .from(from)
        .to(to)
        .subject(objet)
        .message_id(Some(format!("<{id}>")))
        .body(corps.to_owned())
        .map_err(|_| ErreurMail::Protocole)?;
    envoyer_brut(parametres, &message)
}

/// Envoie des octets RFC822 déjà construits (variante sans `Bcc`) avec l'enveloppe donnée.
/// Le `Message-ID` est celui des octets ; rien n'est régénéré.
pub fn envoyer_octets(
    parametres: &ParametresSmtp,
    expediteur: &str,
    destinataires: &[String],
    octets: &[u8],
) -> Result<(), ErreurMail> {
    let de = expediteur.parse().map_err(|_| ErreurMail::Protocole)?;
    let mut a = Vec::with_capacity(destinataires.len());
    for destinataire in destinataires {
        a.push(destinataire.parse().map_err(|_| ErreurMail::Protocole)?);
    }
    let enveloppe = Envelope::new(Some(de), a).map_err(|_| ErreurMail::Protocole)?;
    let mailer = transport(parametres)?;
    mailer
        .send_raw(&enveloppe, octets)
        .map_err(|err| classer_erreur_smtp(&err.to_string()))?;
    Ok(())
}

fn classer_erreur_smtp(texte: &str) -> ErreurMail {
    let texte = texte.to_ascii_lowercase();
    if texte.contains("authenticat") || texte.contains("535") {
        ErreurMail::Authentification
    } else if texte.contains("connect") || texte.contains("timed out") {
        ErreurMail::Connexion
    } else {
        ErreurMail::Protocole
    }
}

fn envoyer_brut(parametres: &ParametresSmtp, message: &Message) -> Result<(), ErreurMail> {
    let mailer = transport(parametres)?;
    mailer.send(message).map_err(|err| {
        let texte = err.to_string().to_ascii_lowercase();
        if texte.contains("authenticat") || texte.contains("535") {
            ErreurMail::Authentification
        } else if texte.contains("connect") || texte.contains("timed out") {
            ErreurMail::Connexion
        } else {
            ErreurMail::Protocole
        }
    })?;
    Ok(())
}

/// Octets RFC822 pour APPEND IMAP (même Message-ID).
pub fn octets_rfc822(de: &str, a: &str, objet: &str, message_id: &str, corps: &str) -> Vec<u8> {
    let id = if message_id.starts_with('<') {
        message_id.to_owned()
    } else {
        format!("<{message_id}>")
    };
    format!(
        "From: {de}\r\nTo: {a}\r\nSubject: {objet}\r\nMessage-ID: {id}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{corps}\r\n"
    )
    .into_bytes()
}
