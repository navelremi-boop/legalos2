//! Lecture d'un message RFC822 pour la rédaction (étape 4) : message d'origine d'une réponse
//! ou d'un transfert, et relecture d'un message construit. Le décodage MIME reste `mail-parser`.

use mail_parser::{Addr, Message, MessageParser, MimeHeaders};

use crate::html::{nettoyer_html, texte_depuis_html};
use crate::redaction::{MessageOrigine, PieceJointe};
use crate::ErreurMail;

/// Message construit, relu champ par champ. Le `Bcc` n'y figure que si l'en-tête est présent
/// (copie, brouillon), jamais dans la variante de transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageComposition {
    pub message_id: String,
    pub en_reponse_a: Option<String>,
    pub references: Vec<String>,
    pub objet: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    pub texte: String,
    /// HTML déjà nettoyé.
    pub html: String,
    pub pieces: Vec<PieceJointe>,
}

fn analyser(octets: &[u8]) -> Result<Message<'_>, ErreurMail> {
    MessageParser::default()
        .parse(octets)
        .ok_or(ErreurMail::Protocole)
}

/// « "Nom" <adresse> » ou adresse seule. Le nom est toujours entre guillemets : une virgule
/// ou un point-virgule dans le nom ne coupe pas l'adresse.
fn adresse_texte(adr: &Addr<'_>) -> Option<String> {
    let courriel = adr.address.as_deref()?.trim();
    if courriel.is_empty() {
        return None;
    }
    let nom = adr
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| {
            n.chars()
                .filter(|c| !c.is_control())
                .collect::<String>()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        });
    Some(match nom {
        Some(nom) => format!("\"{nom}\" <{courriel}>"),
        None => courriel.to_owned(),
    })
}

fn liste(adresse: Option<&mail_parser::Address<'_>>) -> Vec<String> {
    adresse
        .map(|a| a.iter().filter_map(adresse_texte).collect())
        .unwrap_or_default()
}

fn identifiants(valeur: &mail_parser::HeaderValue<'_>) -> Vec<String> {
    let brut: Vec<String> = if let Some(liste) = valeur.as_text_list() {
        liste.iter().map(|s| s.to_string()).collect()
    } else if let Some(texte) = valeur.as_text() {
        texte.split_whitespace().map(str::to_owned).collect()
    } else {
        Vec::new()
    };
    brut.iter()
        .map(|s| s.trim().trim_matches(['<', '>']).to_owned())
        .filter(|s| !s.is_empty())
        .map(|s| format!("<{s}>"))
        .collect()
}

fn pieces(message: &Message<'_>) -> Vec<PieceJointe> {
    message
        .attachments()
        .map(|partie| {
            let type_mime = partie
                .content_type()
                .map(|t| match t.subtype() {
                    Some(sous) => format!("{}/{}", t.ctype(), sous),
                    None => t.ctype().to_owned(),
                })
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            PieceJointe {
                nom: partie
                    .attachment_name()
                    .unwrap_or("piece-jointe")
                    .to_owned(),
                type_mime,
                contenu: partie.contents().to_vec(),
            }
        })
        .collect()
}

fn corps(message: &Message<'_>) -> (String, String) {
    let html_brut = message
        .body_html(0)
        .map(|c| c.to_string())
        .unwrap_or_default();
    let html = nettoyer_html(&html_brut);
    let texte = message
        .body_text(0)
        .map(|c| c.to_string())
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| texte_depuis_html(&html));
    (texte, html)
}

fn message_id(message: &Message<'_>) -> String {
    message
        .message_id()
        .map(|id| id.trim().trim_matches(['<', '>']).to_owned())
        .filter(|id| !id.is_empty())
        .map(|id| format!("<{id}>"))
        .unwrap_or_default()
}

/// Relit un message construit par [`crate::construire_message`] et ses variantes.
pub fn analyser_composition(octets: &[u8]) -> Result<MessageComposition, ErreurMail> {
    let message = analyser(octets)?;
    let (texte, html) = corps(&message);
    let en_reponse_a = identifiants(message.in_reply_to()).into_iter().next();
    Ok(MessageComposition {
        message_id: message_id(&message),
        en_reponse_a,
        references: identifiants(message.references()),
        objet: message.subject().unwrap_or_default().to_owned(),
        a: liste(message.to()),
        cc: liste(message.cc()),
        cci: liste(message.bcc()),
        texte,
        html,
        pieces: pieces(&message),
    })
}

/// Message reçu, lu pour y répondre ou le transférer. Les pièces ne sont reprises que si
/// `avec_pieces` (transfert) : leur contenu n'est pas gardé en mémoire pour une réponse.
pub fn origine_depuis_octets(
    octets: &[u8],
    avec_pieces: bool,
) -> Result<MessageOrigine, ErreurMail> {
    let message = analyser(octets)?;
    let (texte, html) = corps(&message);
    let expediteur = liste(message.from()).into_iter().next().unwrap_or_default();
    Ok(MessageOrigine {
        identifiant: message_id(&message),
        references: identifiants(message.references()),
        objet: message.subject().unwrap_or_default().to_owned(),
        expediteur,
        a: liste(message.to()),
        cc: liste(message.cc()),
        texte,
        html,
        pieces: if avec_pieces {
            pieces(&message)
        } else {
            Vec::new()
        },
    })
}
