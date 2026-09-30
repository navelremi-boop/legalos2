//! Envoi SMTP via `lettre`. Aucun journal du contenu.

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::SmtpTransport;
use lettre::{Message, Transport};

use crate::ErreurMail;

#[derive(Clone)]
pub struct ParametresSmtp {
    pub hote: String,
    pub port: u16,
    pub utilisateur: String,
    pub mot_de_passe: String,
    /// Adresse d'enveloppe / From (ex. demo@cabinet.example).
    pub adresse_from: String,
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

fn envoyer_brut(parametres: &ParametresSmtp, message: &Message) -> Result<(), ErreurMail> {
    let creds = Credentials::new(
        parametres.utilisateur.clone(),
        parametres.mot_de_passe.clone(),
    );
    let mailer = SmtpTransport::builder_dangerous(&parametres.hote)
        .port(parametres.port)
        .credentials(creds)
        .build();
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
