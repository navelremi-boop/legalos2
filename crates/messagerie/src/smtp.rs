//! Envoi SMTP via `lettre`. Aucun journal du contenu.

use lettre::address::Envelope;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::SmtpTransport;
use lettre::{Message, Transport};

use crate::ErreurMail;

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
}

/// Transport SMTP en clair (le chiffrement du transport SMTP n'est pas encore pris en charge :
/// voir `docs/versions.md`, entrée `lettre`).
fn transport(parametres: &ParametresSmtp) -> SmtpTransport {
    let mut constructeur = SmtpTransport::builder_dangerous(&parametres.hote).port(parametres.port);
    if !parametres.utilisateur.is_empty() {
        constructeur = constructeur.credentials(Credentials::new(
            parametres.utilisateur.clone(),
            parametres.mot_de_passe.clone(),
        ));
    }
    constructeur.build()
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
    let mailer = transport(parametres);
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
    let mailer = transport(parametres);
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
