//! Invitations de calendrier (RFC 5545) lues et répondues par `icalendar`.

use std::str::FromStr;

use icalendar::{
    Attendee, Calendar, CalendarComponent, CalendarDateTime, Component, DatePerhapsTime, Event,
    EventLike, EventStatus, PartStat, Property,
};

use mail_parser::{MessageParser, MimeHeaders};

use crate::ErreurMail;

/// Effet d'une invitation reçue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffetInvitation {
    Demande,
    MiseAJour,
    Annulation,
}

/// Réponse envoyée à l'organisateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReponseInvitation {
    Accepter,
    Refuser,
    PeutEtre,
}

/// Invitation lue. Les instants restent l'heure civile du fuseau annoncé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvitationLue {
    pub uid: String,
    pub sequence: u32,
    pub effet: EffetInvitation,
    pub fuseau: String,
    pub debut: DatePerhapsTime,
    pub fin: Option<DatePerhapsTime>,
    pub objet: String,
    pub organisateur: String,
    pub participants: Vec<String>,
}

pub fn lire_invitation(ical: &str) -> Result<InvitationLue, ErreurMail> {
    let calendrier = Calendar::from_str(ical).map_err(|_| ErreurMail::Protocole)?;
    let methode = calendrier.property_value("METHOD").unwrap_or("REQUEST");
    let evenement = calendrier
        .components
        .iter()
        .find_map(|composant| match composant {
            CalendarComponent::Event(evenement) => Some(evenement),
            _ => None,
        })
        .ok_or(ErreurMail::Protocole)?;
    let (fuseau, debut) = instant(evenement.get_start().ok_or(ErreurMail::Protocole)?)?;
    let fin = match evenement.get_end() {
        Some(valeur) => Some(instant(valeur)?.1),
        None => None,
    };
    let sequence = evenement.get_sequence().unwrap_or(0);
    Ok(InvitationLue {
        uid: evenement.get_uid().ok_or(ErreurMail::Protocole)?.to_owned(),
        sequence,
        effet: effet(methode, sequence, evenement.get_status()),
        fuseau,
        debut,
        fin,
        objet: evenement.get_summary().unwrap_or("").to_owned(),
        organisateur: adresse_cal(
            evenement
                .property_value("ORGANIZER")
                .ok_or(ErreurMail::Protocole)?,
        ),
        participants: evenement
            .get_attendees()
            .into_iter()
            .map(|participant| adresse_cal(&participant.cal_address))
            .filter(|adresse| !adresse.is_empty())
            .collect(),
    })
}

/// Réponse `METHOD:REPLY` au même UID, au même fuseau, pour l'organisateur.
pub fn reponse_invitation(
    invitation: &InvitationLue,
    compte: &str,
    reponse: ReponseInvitation,
) -> Result<String, ErreurMail> {
    let mut evenement = Event::new();
    evenement
        .uid(&invitation.uid)
        .summary(&invitation.objet)
        .sequence(invitation.sequence)
        .starts(invitation.debut.clone())
        .add_property("ORGANIZER", format!("mailto:{}", invitation.organisateur))
        .attendee(Attendee::new(format!("mailto:{compte}")).partstat(partstat(reponse)));
    if let Some(fin) = &invitation.fin {
        evenement.ends(fin.clone());
    }
    let mut calendrier = Calendar::new();
    calendrier
        .append_property(Property::new("METHOD", "REPLY"))
        .push(evenement.done());
    Ok(calendrier.to_string())
}

/// Première partie `text/calendar` d'un message MIME, lue par `mail-parser`.
pub fn invitation_du_message(octets: &[u8]) -> Result<Option<InvitationLue>, ErreurMail> {
    let message = MessageParser::default()
        .parse(octets)
        .ok_or(ErreurMail::Protocole)?;
    for partie in &message.parts {
        let calendrier = partie.content_type().is_some_and(|genre| {
            genre.c_type.eq_ignore_ascii_case("text")
                && genre
                    .c_subtype
                    .as_deref()
                    .is_some_and(|sous| sous.eq_ignore_ascii_case("calendar"))
        });
        if !calendrier {
            continue;
        }
        let texte = partie.text_contents().ok_or(ErreurMail::Protocole)?;
        return lire_invitation(texte).map(Some);
    }
    Ok(None)
}

fn effet(methode: &str, sequence: u32, statut: Option<EventStatus>) -> EffetInvitation {
    if methode.eq_ignore_ascii_case("CANCEL") || statut == Some(EventStatus::Cancelled) {
        EffetInvitation::Annulation
    } else if sequence > 0 {
        EffetInvitation::MiseAJour
    } else {
        EffetInvitation::Demande
    }
}

fn partstat(reponse: ReponseInvitation) -> PartStat {
    match reponse {
        ReponseInvitation::Accepter => PartStat::Accepted,
        ReponseInvitation::Refuser => PartStat::Declined,
        ReponseInvitation::PeutEtre => PartStat::Tentative,
    }
}

fn instant(valeur: DatePerhapsTime) -> Result<(String, DatePerhapsTime), ErreurMail> {
    match &valeur {
        DatePerhapsTime::DateTime(CalendarDateTime::WithTimezone { tzid, .. }) => {
            Ok((tzid.clone(), valeur))
        }
        DatePerhapsTime::DateTime(CalendarDateTime::Utc(_)) => Ok(("UTC".to_owned(), valeur)),
        _ => Err(ErreurMail::Protocole),
    }
}

fn adresse_cal(valeur: &str) -> String {
    let net = valeur.trim();
    let sans = net
        .get(7..)
        .filter(|_| net.len() >= 7 && net[..7].eq_ignore_ascii_case("mailto:"))
        .unwrap_or(net);
    sans.trim().to_owned()
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic)]
mod tests {
    use super::{
        invitation_du_message, lire_invitation, reponse_invitation, EffetInvitation,
        ReponseInvitation,
    };
    use icalendar::{Calendar, CalendarComponent, Component, PartStat};
    use std::str::FromStr;

    fn ics(methode: &str, sequence: u32, fuseau: &str, heure: &str) -> String {
        format!(
            "BEGIN:VCALENDAR\r\nMETHOD:{methode}\r\nBEGIN:VEVENT\r\nUID:fictif-j11@example.com\r\nSEQUENCE:{sequence}\r\nDTSTART;TZID={fuseau}:20261006T{heure}0000\r\nDTEND;TZID={fuseau}:20261006T{heure}0000\r\nSUMMARY:Audience fictive\r\nORGANIZER:mailto:organisateur@example.com\r\nATTENDEE:mailto:avocat@cabinet.example\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        )
    }

    fn heure(invitation: &super::InvitationLue) -> String {
        match &invitation.debut {
            icalendar::DatePerhapsTime::DateTime(icalendar::CalendarDateTime::WithTimezone {
                date_time,
                ..
            }) => date_time.format("%H%M").to_string(),
            _ => String::new(),
        }
    }

    #[test]
    fn demande_paris_mise_a_jour_et_annulation() {
        let demande = lire_invitation(&ics("REQUEST", 0, "Europe/Paris", "09")).expect("demande");
        assert_eq!(demande.effet, EffetInvitation::Demande);
        assert_eq!(demande.fuseau, "Europe/Paris");
        assert_eq!(heure(&demande), "0900");
        assert_eq!(demande.organisateur, "organisateur@example.com");

        let maj = lire_invitation(&ics("REQUEST", 2, "Europe/Paris", "11")).expect("maj");
        assert_eq!(maj.effet, EffetInvitation::MiseAJour);
        assert_eq!(heure(&maj), "1100");

        let annulation =
            lire_invitation(&ics("CANCEL", 3, "Europe/Paris", "11")).expect("annulation");
        assert_eq!(annulation.effet, EffetInvitation::Annulation);
    }

    #[test]
    fn fuseau_etranger_conserve() {
        let invitation =
            lire_invitation(&ics("REQUEST", 0, "America/New_York", "14")).expect("new york");
        assert_eq!(invitation.fuseau, "America/New_York");
        assert_eq!(heure(&invitation), "1400");
    }

    #[test]
    fn reponse_accepter_garde_le_fuseau_et_le_uid() {
        let invitation = lire_invitation(&ics("REQUEST", 0, "Europe/Paris", "09")).expect("lue");
        let brut = reponse_invitation(
            &invitation,
            "avocat@cabinet.example",
            ReponseInvitation::Accepter,
        )
        .expect("reponse");
        let calendrier = Calendar::from_str(&brut).expect("parse");
        assert_eq!(calendrier.property_value("METHOD"), Some("REPLY"));
        let evenement = calendrier
            .components
            .iter()
            .find_map(|composant| match composant {
                CalendarComponent::Event(evenement) => Some(evenement),
                _ => None,
            })
            .expect("evenement");
        assert_eq!(evenement.get_uid(), Some("fictif-j11@example.com"));
        assert_eq!(
            evenement.property_value("ORGANIZER"),
            Some("mailto:organisateur@example.com")
        );
        let participants = evenement.get_attendees();
        assert_eq!(participants.len(), 1);
        assert_eq!(participants[0].part_stat, Some(PartStat::Accepted));
        assert!(participants[0]
            .cal_address
            .contains("avocat@cabinet.example"));
        match evenement.get_start() {
            Some(icalendar::DatePerhapsTime::DateTime(
                icalendar::CalendarDateTime::WithTimezone { tzid, .. },
            )) => assert_eq!(tzid, "Europe/Paris"),
            autre => panic!("fuseau perdu : {autre:?}"),
        }
    }

    #[test]
    fn message_mime_porte_le_calendrier() {
        let mime = "\
From: organisateur@example.com\r\n\
To: avocat@cabinet.example\r\n\
Subject: Audience fictive\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\
\r\n\
BEGIN:VCALENDAR\r\n\
METHOD:REQUEST\r\n\
BEGIN:VEVENT\r\n\
UID:fictif-mime@example.com\r\n\
SEQUENCE:0\r\n\
DTSTART;TZID=Europe/Paris:20261006T090000\r\n\
DTEND;TZID=Europe/Paris:20261006T100000\r\n\
SUMMARY:Audience fictive\r\n\
ORGANIZER:mailto:organisateur@example.com\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";
        let invitation = invitation_du_message(mime.as_bytes())
            .expect("mime")
            .expect("calendrier");
        assert_eq!(invitation.effet, EffetInvitation::Demande);
        assert_eq!(invitation.fuseau, "Europe/Paris");
        assert_eq!(invitation.uid, "fictif-mime@example.com");
    }

    #[test]
    fn message_sans_calendrier() {
        let mime = "\
From: confrere@example.com\r\n\
To: avocat@cabinet.example\r\n\
Subject: Note\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Pas d'invitation.\r\n";
        assert!(invitation_du_message(mime.as_bytes())
            .expect("mime")
            .is_none());
    }

    #[test]
    fn texte_invalide_refuse() {
        assert!(lire_invitation("pas un calendrier").is_err());
    }
}
