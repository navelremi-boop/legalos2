//! Construction des messages de rédaction (§ 3.8.6, étape 4).
//!
//! Réponse, réponse à tous, transfert et message neuf sont produits par `lettre`.
//! Le HTML passe par [`crate::nettoyer_html`] avant d'entrer dans le message.
//! Les octets RFC822 servent tels quels à l'APPEND IMAP du brouillon.

use std::collections::BTreeSet;

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, Message, MultiPart, SinglePart};

use crate::html::{nettoyer_html, texte_depuis_html};
use crate::ErreurMail;

/// Dossier IMAP des brouillons quand le serveur n'impose pas un autre nom.
pub const DOSSIER_BROUILLONS: &str = "Brouillons";

/// Pièce jointe déjà décodée. Le contenu n'est pas journalisé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PieceJointe {
    pub nom: String,
    pub type_mime: String,
    pub contenu: Vec<u8>,
}

/// Message d'origine, pour une réponse ou un transfert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageOrigine {
    pub identifiant: String,
    pub references: Vec<String>,
    pub objet: String,
    pub expediteur: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub texte: String,
    pub html: String,
    pub pieces: Vec<PieceJointe>,
}

/// Demande de rédaction. Une signature vide n'est pas insérée.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemandeRedaction {
    /// Identité, « Nom <adresse> » ou adresse seule.
    pub de: String,
    /// Adresse du compte. La réponse à tous l'exclut des destinataires.
    pub adresse_compte: String,
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
    /// Objet de départ. `Re:` ou `Fwd:` est ajouté selon le genre, sans doublon.
    pub objet: String,
    /// Texte saisi, sans la citation.
    pub corps: String,
    /// HTML saisi. Vide : le texte est repris en HTML échappé.
    pub html: String,
    pub signature: String,
    /// Identifiant figé par l'appelant. Jamais régénéré ici.
    pub identifiant: String,
    pub origine: Option<MessageOrigine>,
    /// Pièces ajoutées à la rédaction. Le transfert y joint aussi celles d'origine.
    pub pieces: Vec<PieceJointe>,
}

/// Destinataires résolus : à, cc, cci.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destinataires {
    pub a: Vec<String>,
    pub cc: Vec<String>,
    pub cci: Vec<String>,
}

/// Genre de message construit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenreRedaction {
    Nouveau,
    Reponse,
    ReponseATous,
    Transfert,
}

#[derive(Clone, Copy)]
enum Champ {
    A,
    Cc,
    Cci,
}

struct Accu {
    a: Vec<String>,
    cc: Vec<String>,
    cci: Vec<String>,
    vus: BTreeSet<String>,
}

impl Accu {
    fn new() -> Self {
        Self {
            a: Vec::new(),
            cc: Vec::new(),
            cci: Vec::new(),
            vus: BTreeSet::new(),
        }
    }

    fn liste(
        &mut self,
        champ: Champ,
        liste: &[String],
        exclus: &BTreeSet<String>,
    ) -> Result<(), ErreurMail> {
        for brut in liste {
            self.une(champ, brut, exclus)?;
        }
        Ok(())
    }

    fn une(
        &mut self,
        champ: Champ,
        brut: &str,
        exclus: &BTreeSet<String>,
    ) -> Result<(), ErreurMail> {
        if brut.trim().is_empty() {
            return Ok(());
        }
        let cle = courriel(brut)?;
        if exclus.contains(&cle) || !self.vus.insert(cle) {
            return Ok(());
        }
        self.pousser(champ, brut.trim());
        Ok(())
    }

    fn pousser(&mut self, champ: Champ, brut: &str) {
        let cible = match champ {
            Champ::A => &mut self.a,
            Champ::Cc => &mut self.cc,
            Champ::Cci => &mut self.cci,
        };
        cible.push(brut.to_owned());
    }

    fn figer(self) -> Result<Destinataires, ErreurMail> {
        if self.a.is_empty() && self.cc.is_empty() && self.cci.is_empty() {
            return Err(ErreurMail::Protocole);
        }
        Ok(Destinataires {
            a: self.a,
            cc: self.cc,
            cci: self.cci,
        })
    }
}

/// Objet avec le préfixe du genre, sans le doubler s'il est déjà présent.
pub fn objet_redaction(genre: GenreRedaction, objet: &str) -> String {
    let objet = objet.trim();
    match genre {
        GenreRedaction::Nouveau => objet.to_owned(),
        GenreRedaction::Reponse | GenreRedaction::ReponseATous => prefixer(objet, "Re:", &["re"]),
        GenreRedaction::Transfert => prefixer(objet, "Fwd:", &["fwd", "fw"]),
    }
}

/// Destinataires selon le genre. La réponse à tous retire l'adresse du compte.
pub fn destinataires_redaction(
    genre: GenreRedaction,
    demande: &DemandeRedaction,
) -> Result<Destinataires, ErreurMail> {
    let mut accu = Accu::new();
    let vide = BTreeSet::new();
    match genre {
        GenreRedaction::Nouveau | GenreRedaction::Transfert => {
            accu.liste(Champ::A, &demande.a, &vide)?;
            accu.liste(Champ::Cc, &demande.cc, &vide)?;
            accu.liste(Champ::Cci, &demande.cci, &vide)?;
        }
        GenreRedaction::Reponse => {
            let origine = exiger_origine(demande)?;
            accu.une(Champ::A, &origine.expediteur, &vide)?;
            accu.liste(Champ::A, &demande.a, &vide)?;
            accu.liste(Champ::Cc, &demande.cc, &vide)?;
            accu.liste(Champ::Cci, &demande.cci, &vide)?;
        }
        GenreRedaction::ReponseATous => {
            let origine = exiger_origine(demande)?;
            let compte = courriel(&demande.adresse_compte)?;
            let mut exclus = BTreeSet::new();
            exclus.insert(compte.clone());
            if courriel(&origine.expediteur)? == compte {
                accu.liste(Champ::A, &origine.a, &exclus)?;
                accu.liste(Champ::Cc, &origine.cc, &exclus)?;
            } else {
                accu.une(Champ::A, &origine.expediteur, &exclus)?;
                accu.liste(Champ::Cc, &origine.a, &exclus)?;
                accu.liste(Champ::Cc, &origine.cc, &exclus)?;
            }
            accu.liste(Champ::A, &demande.a, &exclus)?;
            accu.liste(Champ::Cc, &demande.cc, &exclus)?;
            accu.liste(Champ::Cci, &demande.cci, &exclus)?;
        }
    }
    accu.figer()
}

/// Octets RFC822. Le brouillon dépose ces octets avec [`crate::SessionActions::appender`].
pub fn construire_message(
    genre: GenreRedaction,
    demande: &DemandeRedaction,
) -> Result<Vec<u8>, ErreurMail> {
    let identifiant = identifiant_chevron(&demande.identifiant)?;
    let dest = destinataires_redaction(genre, demande)?;
    let objet = objet_redaction(genre, &demande.objet);
    let origine = match genre {
        GenreRedaction::Nouveau => None,
        GenreRedaction::Reponse | GenreRedaction::ReponseATous | GenreRedaction::Transfert => {
            Some(exiger_origine(demande)?)
        }
    };
    let texte = corps_texte(genre, demande, origine);
    let html = corps_html(genre, demande, origine);
    let mut builder = Message::builder()
        .from(analyse_boite(&demande.de)?)
        .message_id(Some(identifiant))
        .subject(objet)
        .keep_bcc();
    for boite in &dest.a {
        builder = builder.to(analyse_boite(boite)?);
    }
    for boite in &dest.cc {
        builder = builder.cc(analyse_boite(boite)?);
    }
    for boite in &dest.cci {
        builder = builder.bcc(analyse_boite(boite)?);
    }
    if let Some(origine) = origine.filter(|_| repond(genre)) {
        builder = builder
            .in_reply_to(identifiant_chevron(&origine.identifiant)?)
            .references(references_de(origine)?);
    }
    let alternatif = MultiPart::alternative()
        .singlepart(SinglePart::plain(texte))
        .singlepart(SinglePart::html(html));
    let pieces = pieces_a_joindre(genre, demande);
    let message = if pieces.is_empty() {
        builder
            .multipart(alternatif)
            .map_err(|_| ErreurMail::Protocole)?
    } else {
        let mut mixte = MultiPart::mixed().multipart(alternatif);
        for piece in &pieces {
            let mime = type_mime(&piece.type_mime)?;
            mixte = mixte.singlepart(
                Attachment::new(nom_piece(&piece.nom)).body(piece.contenu.clone(), mime),
            );
        }
        builder
            .multipart(mixte)
            .map_err(|_| ErreurMail::Protocole)?
    };
    Ok(message.formatted())
}

fn repond(genre: GenreRedaction) -> bool {
    matches!(
        genre,
        GenreRedaction::Reponse | GenreRedaction::ReponseATous
    )
}

fn historique(genre: GenreRedaction) -> bool {
    matches!(
        genre,
        GenreRedaction::Reponse | GenreRedaction::ReponseATous | GenreRedaction::Transfert
    )
}

fn exiger_origine(demande: &DemandeRedaction) -> Result<&MessageOrigine, ErreurMail> {
    demande.origine.as_ref().ok_or(ErreurMail::Protocole)
}

fn pieces_a_joindre(genre: GenreRedaction, demande: &DemandeRedaction) -> Vec<PieceJointe> {
    let mut pieces = Vec::new();
    if genre == GenreRedaction::Transfert {
        if let Some(origine) = &demande.origine {
            pieces.extend(origine.pieces.iter().cloned());
        }
    }
    pieces.extend(demande.pieces.iter().cloned());
    pieces
}

fn corps_texte(
    genre: GenreRedaction,
    demande: &DemandeRedaction,
    origine: Option<&MessageOrigine>,
) -> String {
    let mut blocs = Vec::new();
    let corps = demande.corps.trim_end();
    if !corps.is_empty() {
        blocs.push(corps.to_owned());
    }
    if let Some(signature) = signature_texte(&demande.signature) {
        blocs.push(signature);
    }
    if let Some(origine) = origine.filter(|_| historique(genre)) {
        let qui = etiquette(&origine.expediteur);
        let citation = citer(&texte_origine(origine));
        blocs.push(format!("{qui} a écrit :\n{citation}"));
    }
    blocs.join("\n\n")
}

fn corps_html(
    genre: GenreRedaction,
    demande: &DemandeRedaction,
    origine: Option<&MessageOrigine>,
) -> String {
    let mut html = String::new();
    let neuf = if demande.html.trim().is_empty() {
        if demande.corps.trim().is_empty() {
            String::new()
        } else {
            format!("<p>{}</p>", echapper_html(&demande.corps))
        }
    } else {
        demande.html.clone()
    };
    html.push_str(&nettoyer_html(&neuf));
    if let Some(signature) = signature_html(&demande.signature) {
        html.push_str(&signature);
    }
    if let Some(origine) = origine.filter(|_| historique(genre)) {
        let qui = echapper_html(&etiquette(&origine.expediteur));
        let contenu = if origine.html.trim().is_empty() {
            format!("<p>{}</p>", echapper_html(&texte_origine(origine)))
        } else {
            nettoyer_html(&origine.html)
        };
        html.push_str(&format!(
            "<blockquote><p>{qui} a écrit :</p>{contenu}</blockquote>"
        ));
    }
    nettoyer_html(&html)
}

fn signature_texte(signature: &str) -> Option<String> {
    let signature = signature.trim();
    if signature.is_empty() {
        None
    } else {
        Some(format!("-- \n{signature}"))
    }
}

fn signature_html(signature: &str) -> Option<String> {
    let signature = signature.trim();
    if signature.is_empty() {
        None
    } else {
        Some(format!("<p>-- <br>{}</p>", echapper_html(signature)))
    }
}

fn texte_origine(origine: &MessageOrigine) -> String {
    if !origine.texte.trim().is_empty() {
        origine.texte.clone()
    } else {
        texte_depuis_html(&nettoyer_html(&origine.html))
    }
}

fn etiquette(expediteur: &str) -> String {
    let expediteur = expediteur.trim();
    if expediteur.is_empty() {
        "L'expéditeur".to_owned()
    } else {
        expediteur.to_owned()
    }
}

fn citer(texte: &str) -> String {
    let texte = texte.trim_end();
    if texte.is_empty() {
        ">".to_owned()
    } else {
        texte
            .lines()
            .map(|ligne| format!("> {ligne}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn echapper_html(texte: &str) -> String {
    let mut sortie = String::new();
    for car in texte.chars() {
        match car {
            '&' => sortie.push_str("&amp;"),
            '<' => sortie.push_str("&lt;"),
            '>' => sortie.push_str("&gt;"),
            '"' => sortie.push_str("&quot;"),
            '\n' => sortie.push_str("<br>\n"),
            _ => sortie.push(car),
        }
    }
    sortie
}

fn prefixer(objet: &str, prefixe: &str, mots: &[&str]) -> String {
    if mots.iter().any(|mot| commence_par_prefixe(objet, mot)) {
        objet.to_owned()
    } else if objet.is_empty() {
        prefixe.to_owned()
    } else {
        format!("{prefixe} {objet}")
    }
}

fn commence_par_prefixe(objet: &str, mot: &str) -> bool {
    let objet = objet.trim_start();
    let Some(reste) = objet.get(mot.len()..) else {
        return false;
    };
    objet[..mot.len()].eq_ignore_ascii_case(mot) && reste.trim_start().starts_with(':')
}

fn references_de(origine: &MessageOrigine) -> Result<String, ErreurMail> {
    let mut ids = Vec::new();
    let mut vus = BTreeSet::new();
    for brut in &origine.references {
        if brut.trim().is_empty() {
            continue;
        }
        let id = identifiant_chevron(brut)?;
        if vus.insert(id.to_ascii_lowercase()) {
            ids.push(id);
        }
    }
    let courant = identifiant_chevron(&origine.identifiant)?;
    if vus.insert(courant.to_ascii_lowercase()) {
        ids.push(courant);
    }
    Ok(ids.join(" "))
}

fn identifiant_chevron(brut: &str) -> Result<String, ErreurMail> {
    let nu = brut
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim();
    if nu.is_empty() || nu.contains([' ', '\r', '\n', '<', '>']) {
        return Err(ErreurMail::Protocole);
    }
    Ok(format!("<{nu}>"))
}

fn analyse_boite(brut: &str) -> Result<Mailbox, ErreurMail> {
    brut.trim().parse().map_err(|_| ErreurMail::Protocole)
}

fn courriel(brut: &str) -> Result<String, ErreurMail> {
    let boite = analyse_boite(brut)?;
    Ok(boite.email.to_string().to_ascii_lowercase())
}

fn type_mime(brut: &str) -> Result<ContentType, ErreurMail> {
    let candidat = if brut.trim().is_empty() {
        "application/octet-stream"
    } else {
        brut.trim()
    };
    if let Ok(trouve) = ContentType::parse(candidat) {
        return Ok(trouve);
    }
    ContentType::parse("application/octet-stream").map_err(|_| ErreurMail::Protocole)
}

fn nom_piece(nom: &str) -> String {
    let propre = nom.replace(['\r', '\n', '"'], " ").trim().to_owned();
    if propre.is_empty() {
        "piece-jointe".to_owned()
    } else {
        propre
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use mail_parser::{MessageParser, MimeHeaders};

    use super::{
        construire_message, destinataires_redaction, objet_redaction, DemandeRedaction,
        GenreRedaction, MessageOrigine, PieceJointe,
    };

    fn piece(nom: &str) -> PieceJointe {
        PieceJointe {
            nom: nom.to_owned(),
            type_mime: "text/plain".to_owned(),
            contenu: b"contenu fictif".to_vec(),
        }
    }

    fn origine() -> MessageOrigine {
        MessageOrigine {
            identifiant: "<origine-j11@cabinet.example>".to_owned(),
            references: vec!["<ancien-j11@cabinet.example>".to_owned()],
            objet: "Audience".to_owned(),
            expediteur: "Confrere Fictif <confrere@example.com>".to_owned(),
            a: vec![
                "Avocat Fictif <avocat@cabinet.example>".to_owned(),
                "Client Fictif <client@example.com>".to_owned(),
            ],
            cc: vec!["Secretariat <secretariat@cabinet.example>".to_owned()],
            texte: "Bonjour, merci de confirmer le creneau.".to_owned(),
            html: "<p>Bonjour, merci de confirmer le creneau.</p><script>alert(1)</script>"
                .to_owned(),
            pieces: vec![piece("note-fictive.txt")],
        }
    }

    fn demande() -> DemandeRedaction {
        DemandeRedaction {
            de: "Avocat Fictif <avocat@cabinet.example>".to_owned(),
            adresse_compte: "avocat@cabinet.example".to_owned(),
            a: Vec::new(),
            cc: Vec::new(),
            cci: vec!["archive@cabinet.example".to_owned()],
            objet: "Audience".to_owned(),
            corps: "Texte nouveau du cabinet.".to_owned(),
            html: String::new(),
            signature: "SignatureFictiveJ11".to_owned(),
            identifiant: "<reponse-j11@cabinet.example>".to_owned(),
            origine: Some(origine()),
            pieces: Vec::new(),
        }
    }

    fn analyser(octets: &[u8]) -> mail_parser::Message<'_> {
        MessageParser::default()
            .parse(octets)
            .expect("analyse mime")
    }

    fn emails(adresse: Option<&mail_parser::Address<'_>>) -> Vec<String> {
        let mut sortie = Vec::new();
        let Some(adresse) = adresse else {
            return sortie;
        };
        for boite in adresse.iter() {
            if let Some(courriel) = boite.address() {
                sortie.push(courriel.to_ascii_lowercase());
            }
        }
        sortie
    }

    fn idents(valeur: &mail_parser::HeaderValue<'_>) -> Vec<String> {
        if let Some(liste) = valeur.as_text_list() {
            return liste
                .iter()
                .map(|s| nu(s))
                .filter(|s| !s.is_empty())
                .collect();
        }
        if let Some(texte) = valeur.as_text() {
            return texte
                .split_whitespace()
                .map(nu)
                .filter(|s| !s.is_empty())
                .collect();
        }
        Vec::new()
    }

    fn nu(id: &str) -> String {
        id.trim()
            .trim_matches(|c| c == '<' || c == '>')
            .to_ascii_lowercase()
    }

    fn noms(message: &mail_parser::Message<'_>) -> Vec<String> {
        message
            .attachments()
            .filter_map(|partie| partie.attachment_name().map(str::to_owned))
            .collect()
    }

    #[test]
    fn prefixes_non_doubles() {
        assert_eq!(
            objet_redaction(GenreRedaction::Reponse, "Audience"),
            "Re: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Reponse, "Re: Audience"),
            "Re: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::ReponseATous, "RE: Audience"),
            "RE: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Reponse, "Re : Audience"),
            "Re : Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Transfert, "Audience"),
            "Fwd: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Transfert, "Fwd: Audience"),
            "Fwd: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Transfert, "FW: Audience"),
            "FW: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Transfert, "Re: Audience"),
            "Fwd: Re: Audience"
        );
        assert_eq!(
            objet_redaction(GenreRedaction::Reponse, "Fwd: Audience"),
            "Re: Fwd: Audience"
        );
    }

    #[test]
    fn reponse_a_tous_exclut_le_compte() {
        let dest = destinataires_redaction(GenreRedaction::ReponseATous, &demande()).expect("dest");
        assert_eq!(
            dest.a,
            vec!["Confrere Fictif <confrere@example.com>".to_owned()]
        );
        assert_eq!(
            dest.cc,
            vec![
                "Client Fictif <client@example.com>".to_owned(),
                "Secretariat <secretariat@cabinet.example>".to_owned(),
            ]
        );
        assert_eq!(dest.cci, vec!["archive@cabinet.example".to_owned()]);
        let tout = dest.a.iter().chain(dest.cc.iter()).chain(dest.cci.iter());
        assert!(tout
            .into_iter()
            .all(|b| !b.to_ascii_lowercase().contains("avocat@")));
    }

    #[test]
    fn reponse_a_tous_sur_son_propre_message() {
        let mut demande = demande();
        demande.origine.as_mut().expect("origine").expediteur =
            "Avocat Fictif <AVOCAT@cabinet.example>".to_owned();
        demande.cci = vec![
            "avocat@cabinet.example".to_owned(),
            "archive@cabinet.example".to_owned(),
        ];
        let dest = destinataires_redaction(GenreRedaction::ReponseATous, &demande).expect("dest");
        assert_eq!(
            dest.a,
            vec!["Client Fictif <client@example.com>".to_owned()]
        );
        assert_eq!(
            dest.cc,
            vec!["Secretariat <secretariat@cabinet.example>".to_owned()]
        );
        assert_eq!(dest.cci, vec!["archive@cabinet.example".to_owned()]);
    }

    #[test]
    fn reponse_cite_sans_pieces_ni_doublon_de_prefixe() {
        let mut demande = demande();
        demande.objet = "Re: Audience".to_owned();
        demande.pieces = vec![piece("ajout-reponse.txt")];
        let octets = construire_message(GenreRedaction::Reponse, &demande).expect("octets");
        let message = analyser(&octets);
        assert_eq!(message.subject(), Some("Re: Audience"));
        assert_eq!(
            emails(message.to()),
            vec!["confrere@example.com".to_owned()]
        );
        assert!(emails(message.cc()).is_empty());
        assert_eq!(
            emails(message.bcc()),
            vec!["archive@cabinet.example".to_owned()]
        );
        assert_eq!(
            idents(message.in_reply_to()),
            vec!["origine-j11@cabinet.example".to_owned()]
        );
        assert_eq!(
            idents(message.references()),
            vec![
                "ancien-j11@cabinet.example".to_owned(),
                "origine-j11@cabinet.example".to_owned(),
            ]
        );
        let texte = message.body_text(0).expect("texte");
        let html = message.body_html(0).expect("html");
        assert!(texte.contains("Texte nouveau du cabinet."));
        assert!(texte.contains("SignatureFictiveJ11"));
        assert!(texte.contains("a écrit :"));
        assert!(texte.contains("> Bonjour, merci de confirmer le creneau."));
        assert!(html.contains("Texte nouveau du cabinet."));
        assert!(html.contains("confirmer le creneau"));
        assert!(html.to_ascii_lowercase().contains("blockquote"));
        assert!(!html.to_ascii_lowercase().contains("script"));
        assert!(!html.contains("alert"));
        assert_eq!(noms(&message), vec!["ajout-reponse.txt".to_owned()]);
        assert_eq!(
            nu(message.message_id().unwrap_or("")),
            "reponse-j11@cabinet.example"
        );
    }

    #[test]
    fn signature_vide_absente_et_transfert_garde_les_pieces() {
        let mut demande = demande();
        demande.signature = "  ".to_owned();
        demande.a = vec!["destinataire@example.com".to_owned()];
        demande.cc = vec!["copie@example.com".to_owned()];
        demande.cci.clear();
        demande.identifiant = "transfert-j11@cabinet.example".to_owned();
        let octets = construire_message(GenreRedaction::Transfert, &demande).expect("octets");
        let message = analyser(&octets);
        assert_eq!(message.subject(), Some("Fwd: Audience"));
        assert!(idents(message.in_reply_to()).is_empty());
        assert!(idents(message.references()).is_empty());
        assert_eq!(
            emails(message.to()),
            vec!["destinataire@example.com".to_owned()]
        );
        assert_eq!(emails(message.cc()), vec!["copie@example.com".to_owned()]);
        assert!(emails(message.bcc()).is_empty());
        let texte = message.body_text(0).expect("texte");
        let html = message.body_html(0).expect("html");
        assert!(texte.contains("Texte nouveau du cabinet."));
        assert!(texte.contains("> Bonjour, merci de confirmer le creneau."));
        assert!(!texte.contains("SignatureFictiveJ11"));
        assert!(!texte.contains("\n-- \n"));
        assert!(html.contains("confirmer le creneau"));
        assert!(!html.contains("SignatureFictiveJ11"));
        assert!(!html.to_ascii_lowercase().contains("script"));
        assert_eq!(noms(&message), vec!["note-fictive.txt".to_owned()]);
    }

    #[test]
    fn message_neuf_avec_a_cc_cci() {
        let mut demande = demande();
        demande.origine = None;
        demande.signature.clear();
        demande.a = vec!["destinataire@example.com".to_owned()];
        demande.cc = vec!["copie@example.com".to_owned()];
        demande.objet = "Note interne".to_owned();
        demande.identifiant = "<neuf-j11@cabinet.example>".to_owned();
        let octets = construire_message(GenreRedaction::Nouveau, &demande).expect("octets");
        let message = analyser(&octets);
        assert_eq!(message.subject(), Some("Note interne"));
        assert_eq!(
            emails(message.to()),
            vec!["destinataire@example.com".to_owned()]
        );
        assert_eq!(emails(message.cc()), vec!["copie@example.com".to_owned()]);
        assert_eq!(
            emails(message.bcc()),
            vec!["archive@cabinet.example".to_owned()]
        );
        let texte = message.body_text(0).expect("texte");
        assert_eq!(texte.trim(), "Texte nouveau du cabinet.");
        assert!(idents(message.in_reply_to()).is_empty());
    }

    #[test]
    fn identifiant_ou_origine_absents() {
        let mut sans_id = demande();
        sans_id.identifiant.clear();
        assert!(construire_message(GenreRedaction::Reponse, &sans_id).is_err());
        let mut sans_origine = demande();
        sans_origine.origine = None;
        assert!(construire_message(GenreRedaction::ReponseATous, &sans_origine).is_err());
        assert!(construire_message(GenreRedaction::Transfert, &sans_origine).is_err());
    }
}
