//! Invitations de calendrier (RFC 5545 / iTIP RFC 5546) lues et répondues par `icalendar`.
//!
//! Fuseaux : l'heure civile et le fuseau annoncés par l'organisateur sont conservés tels quels ;
//! l'instant UTC en est déduit avec la base IANA de `chrono-tz`, seule dépendance de dates ajoutée
//! (voir `docs/versions.md`). Aucun contenu d'invitation (objet, adresse) n'est journalisé ici.

use std::str::FromStr;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Offset, TimeDelta, TimeZone, Utc};
use chrono_tz::Tz;
use icalendar::{
    Attendee, Calendar, CalendarComponent, CalendarDateTime, Component, DatePerhapsTime, Event,
    EventLike, EventStatus, PartStat, Property,
};

use mail_parser::{MessageParser, MimeHeaders};

use crate::ErreurMail;

/// Fuseau annoncé pour une heure flottante (sans `TZID` ni `Z`) ou une journée entière : l'heure
/// civile est la même où que l'on soit, aucun instant UTC n'en est déduit.
pub const FUSEAU_FLOTTANT: &str = "flottant";

const FORMAT_LOCAL: &str = "%Y-%m-%dT%H:%M:%S";
const FORMAT_JOUR: &str = "%Y-%m-%d";
const FORMAT_UTC: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

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
    /// `METHOD` iTIP en majuscules (`REQUEST`, `CANCEL`…), vide s'il est absent.
    pub methode: String,
    pub fuseau: String,
    pub debut: DatePerhapsTime,
    pub fin: Option<DatePerhapsTime>,
    pub objet: String,
    pub organisateur: String,
    pub participants: Vec<String>,
    /// Adresses des en-têtes `From` et `Sender` du message porteur, en minuscules. Vide quand
    /// l'invitation ne vient pas d'un message (calendrier seul, reconstitution depuis la base).
    pub expediteurs: Vec<String>,
}

/// Début et fin sous forme de texte : heure civile du fuseau annoncé, et instant UTC quand il se
/// déduit (jamais pour une heure flottante ni une journée entière, ni pour un fuseau inconnu).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstantsInvitation {
    /// `2026-10-06T09:00:00`, ou `2026-10-06` pour une journée entière.
    pub debut_local: String,
    pub fin_local: Option<String>,
    /// `2026-10-06T07:00:00.000Z`.
    pub debut_utc: Option<String>,
    pub fin_utc: Option<String>,
}

impl InvitationLue {
    pub fn instants(&self) -> InstantsInvitation {
        let (debut_local, debut_utc) = formater(&self.debut);
        let (fin_local, fin_utc) = match &self.fin {
            Some(fin) => {
                let (local, utc) = formater(fin);
                (Some(local), utc)
            }
            None => (None, None),
        };
        InstantsInvitation {
            debut_local,
            fin_local,
            debut_utc,
            fin_utc,
        }
    }
}

pub fn lire_invitation(ical: &str) -> Result<InvitationLue, ErreurMail> {
    let calendrier = Calendar::from_str(ical).map_err(|_| ErreurMail::Protocole)?;
    let methode = calendrier
        .property_value("METHOD")
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();
    let evenement = calendrier
        .components
        .iter()
        .find_map(|composant| match composant {
            CalendarComponent::Event(evenement) => Some(evenement),
            _ => None,
        })
        .ok_or(ErreurMail::Protocole)?;
    let (fuseau, debut) = instant(evenement.get_start().ok_or(ErreurMail::Protocole)?);
    let fin = evenement.get_end().map(|valeur| instant(valeur).1);
    let sequence = evenement.get_sequence().unwrap_or(0);
    Ok(InvitationLue {
        uid: evenement.get_uid().ok_or(ErreurMail::Protocole)?.to_owned(),
        sequence,
        effet: effet(&methode, sequence, evenement.get_status()),
        methode,
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
        expediteurs: Vec::new(),
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

/// Première partie calendrier (`text/calendar`, ou `application/ics` d'Outlook) d'un message
/// MIME, lue par `mail-parser`.
pub fn invitation_du_message(octets: &[u8]) -> Result<Option<InvitationLue>, ErreurMail> {
    let message = MessageParser::default()
        .parse(octets)
        .ok_or(ErreurMail::Protocole)?;
    for partie in &message.parts {
        let calendrier = partie.content_type().is_some_and(|genre| {
            let sous = genre.c_subtype.as_deref().unwrap_or_default();
            (genre.c_type.eq_ignore_ascii_case("text") && sous.eq_ignore_ascii_case("calendar"))
                || (genre.c_type.eq_ignore_ascii_case("application")
                    && sous.eq_ignore_ascii_case("ics"))
        });
        if !calendrier {
            continue;
        }
        let texte = partie.text_contents().map_or_else(
            || String::from_utf8_lossy(partie.contents()).into_owned(),
            str::to_owned,
        );
        let mut lue = lire_invitation(&texte)?;
        lue.expediteurs = [message.from(), message.sender()]
            .into_iter()
            .flatten()
            .flat_map(mail_parser::Address::iter)
            .filter_map(|boite| boite.address())
            .map(|adresse| adresse.trim().to_ascii_lowercase())
            .filter(|adresse| !adresse.is_empty())
            .collect();
        return Ok(Some(lue));
    }
    Ok(None)
}

/// Ce que la base garde d'une invitation (heure civile en texte, fuseau annoncé).
#[derive(Debug, Clone, Copy)]
pub struct InvitationStockee<'a> {
    pub uid: &'a str,
    pub sequence: u32,
    pub fuseau: &'a str,
    pub debut: &'a str,
    pub fin: Option<&'a str>,
    pub objet: &'a str,
    pub organisateur: &'a str,
}

/// Reconstitue l'invitation depuis les colonnes stockées, pour écrire la réponse au même UID,
/// au même fuseau, sans garder le message d'origine.
pub fn invitation_depuis_stockage(
    stockee: &InvitationStockee<'_>,
) -> Result<InvitationLue, ErreurMail> {
    let debut = date_stockee(stockee.fuseau, stockee.debut)?;
    let fin = match stockee.fin {
        Some(fin) => Some(date_stockee(stockee.fuseau, fin)?),
        None => None,
    };
    Ok(InvitationLue {
        uid: stockee.uid.to_owned(),
        sequence: stockee.sequence,
        effet: EffetInvitation::Demande,
        methode: "REQUEST".to_owned(),
        fuseau: stockee.fuseau.to_owned(),
        debut,
        fin,
        objet: stockee.objet.to_owned(),
        organisateur: stockee.organisateur.to_owned(),
        participants: Vec::new(),
        expediteurs: Vec::new(),
    })
}

/// Invitation déjà connue de la base pour ce titulaire et cet UID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvitationConnue {
    pub sequence: u32,
    pub effet: EffetInvitation,
}

/// Ce que la relève fait d'une invitation reçue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionInvitation {
    /// Rejeu, SEQUENCE plus ancienne ou égale, ou méthode qui n'est pas une invitation.
    Ignorer,
    /// Première invitation connue pour cet UID.
    Creer,
    /// SEQUENCE strictement plus récente.
    MettreAJour,
    /// Annulation d'une invitation connue et pas encore annulée.
    Annuler,
}

/// Règle de rejeu des invitations (RFC 5546 § 2.1.4, SEQUENCE).
///
/// - seules les méthodes `REQUEST` et `CANCEL` comptent ;
/// - une demande dont la SEQUENCE n'est pas strictement plus récente que la connue est ignorée
///   (rejeu idempotent, message arrivé dans le désordre) ;
/// - une annulation vaut pour la SEQUENCE connue **ou une plus récente** (certains agendas
///   annulent avec la SEQUENCE de la demande) mais n'agit qu'une fois.
pub fn decider_invitation(
    connue: Option<InvitationConnue>,
    lue: &InvitationLue,
) -> DecisionInvitation {
    if lue.methode != "REQUEST" && lue.methode != "CANCEL" {
        return DecisionInvitation::Ignorer;
    }
    let annulation = lue.effet == EffetInvitation::Annulation;
    match connue {
        None => DecisionInvitation::Creer,
        Some(connue) if annulation => {
            if connue.effet != EffetInvitation::Annulation && lue.sequence >= connue.sequence {
                DecisionInvitation::Annuler
            } else {
                DecisionInvitation::Ignorer
            }
        }
        Some(connue) => {
            if lue.sequence > connue.sequence {
                DecisionInvitation::MettreAJour
            } else {
                DecisionInvitation::Ignorer
            }
        }
    }
}

/// L'origine d'une invitation est-elle celle de son organisateur ?
///
/// Une mise à jour ou une annulation n'est crédible que si le mail vient de l'organisateur
/// enregistré pour ce UID (`From` ou `Sender`) et si l'`ORGANIZER` annoncé est le même : sans cela
/// n'importe quel expéditeur qui connaît le UID déplacerait ou supprimerait l'audience d'autrui.
/// À la création, un expéditeur qui n'est pas l'organisateur annoncé ne bloque rien (un
/// secrétariat peut envoyer pour un confrère) mais la ligne est marquée « non vérifiée ».
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictOrigine {
    /// Expéditeur et organisateur concordent (ou rien à appliquer).
    Verifiee,
    /// Création dont l'expéditeur n'est pas l'`ORGANIZER` annoncé.
    NonVerifiee,
    /// Mise à jour ou annulation envoyée par quelqu'un d'autre que l'organisateur enregistré.
    ExpediteurTiers,
    /// Mise à jour ou annulation dont l'`ORGANIZER` diffère de celui enregistré.
    OrganisateurModifie,
}

impl VerdictOrigine {
    /// Le verdict interdit-il d'appliquer la décision ?
    #[must_use]
    pub fn refuse(self) -> bool {
        matches!(self, Self::ExpediteurTiers | Self::OrganisateurModifie)
    }

    /// Motif sans donnée personnelle, pour le journal de relève.
    #[must_use]
    pub fn motif(self) -> &'static str {
        match self {
            Self::Verifiee => "verifiee",
            Self::NonVerifiee => "non_verifiee",
            Self::ExpediteurTiers => "expediteur_tiers",
            Self::OrganisateurModifie => "organisateur_modifie",
        }
    }
}

fn meme_adresse(a: &str, b: &str) -> bool {
    !a.trim().is_empty() && a.trim().eq_ignore_ascii_case(b.trim())
}

/// Juge l'origine d'une invitation à appliquer. `organisateur_connu` est l'`ORGANIZER`
/// enregistré pour ce UID (absent à la création).
#[must_use]
pub fn juger_origine(
    decision: DecisionInvitation,
    organisateur_connu: Option<&str>,
    lue: &InvitationLue,
) -> VerdictOrigine {
    let envoye_par = |organisateur: &str| {
        lue.expediteurs
            .iter()
            .any(|expediteur| meme_adresse(expediteur, organisateur))
    };
    match decision {
        DecisionInvitation::Ignorer => VerdictOrigine::Verifiee,
        DecisionInvitation::Creer => {
            if envoye_par(&lue.organisateur) {
                VerdictOrigine::Verifiee
            } else {
                VerdictOrigine::NonVerifiee
            }
        }
        DecisionInvitation::MettreAJour | DecisionInvitation::Annuler => {
            let connu = organisateur_connu.unwrap_or("");
            if !envoye_par(connu) {
                VerdictOrigine::ExpediteurTiers
            } else if !meme_adresse(connu, &lue.organisateur) {
                VerdictOrigine::OrganisateurModifie
            } else {
                VerdictOrigine::Verifiee
            }
        }
    }
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

fn instant(valeur: DatePerhapsTime) -> (String, DatePerhapsTime) {
    let fuseau = match &valeur {
        DatePerhapsTime::DateTime(CalendarDateTime::WithTimezone { tzid, .. }) => tzid.clone(),
        DatePerhapsTime::DateTime(CalendarDateTime::Utc(_)) => "UTC".to_owned(),
        DatePerhapsTime::DateTime(CalendarDateTime::Floating(_)) | DatePerhapsTime::Date(_) => {
            FUSEAU_FLOTTANT.to_owned()
        }
    };
    (fuseau, valeur)
}

fn date_stockee(fuseau: &str, texte: &str) -> Result<DatePerhapsTime, ErreurMail> {
    if texte.len() == 10 {
        let jour =
            NaiveDate::parse_from_str(texte, FORMAT_JOUR).map_err(|_| ErreurMail::Protocole)?;
        return Ok(DatePerhapsTime::Date(jour));
    }
    let local =
        NaiveDateTime::parse_from_str(texte, FORMAT_LOCAL).map_err(|_| ErreurMail::Protocole)?;
    Ok(DatePerhapsTime::DateTime(if fuseau == "UTC" {
        CalendarDateTime::Utc(Utc.from_utc_datetime(&local))
    } else if fuseau == FUSEAU_FLOTTANT {
        CalendarDateTime::Floating(local)
    } else {
        CalendarDateTime::WithTimezone {
            date_time: local,
            tzid: fuseau.to_owned(),
        }
    }))
}

fn formater(valeur: &DatePerhapsTime) -> (String, Option<String>) {
    match valeur {
        DatePerhapsTime::Date(jour) => (jour.format(FORMAT_JOUR).to_string(), None),
        DatePerhapsTime::DateTime(CalendarDateTime::Floating(local)) => {
            (local.format(FORMAT_LOCAL).to_string(), None)
        }
        DatePerhapsTime::DateTime(CalendarDateTime::Utc(instant)) => (
            instant.naive_utc().format(FORMAT_LOCAL).to_string(),
            Some(instant.format(FORMAT_UTC).to_string()),
        ),
        DatePerhapsTime::DateTime(CalendarDateTime::WithTimezone { date_time, tzid }) => (
            date_time.format(FORMAT_LOCAL).to_string(),
            local_vers_utc(tzid, *date_time).map(|instant| instant.format(FORMAT_UTC).to_string()),
        ),
    }
}

/// Fuseau IANA d'un `TZID` : nom IANA tel quel, nom Windows d'Outlook, ou préfixe d'un ancien
/// agenda (`/mozilla.org/20050126_1/Europe/Paris`).
fn fuseau_iana(tzid: &str) -> Option<Tz> {
    let tzid = tzid.trim();
    if let Ok(fuseau) = tzid.parse::<Tz>() {
        return Some(fuseau);
    }
    if let Some(nom) = nom_windows(tzid) {
        return nom.parse::<Tz>().ok();
    }
    if tzid.starts_with('/') {
        let morceaux: Vec<&str> = tzid.split('/').filter(|m| !m.is_empty()).collect();
        for debut in 0..morceaux.len() {
            if let Ok(fuseau) = morceaux[debut..].join("/").parse::<Tz>() {
                return Some(fuseau);
            }
        }
    }
    None
}

/// Noms de fuseaux Windows courants, vers leur fuseau IANA principal (CLDR
/// `windowsZones.xml`, territoire 001). Liste volontairement courte : un nom absent donne un
/// fuseau inconnu, donc pas d'instant UTC, jamais un instant faux.
fn nom_windows(nom: &str) -> Option<&'static str> {
    Some(match nom {
        "Romance Standard Time" => "Europe/Paris",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "GMT Standard Time" => "Europe/London",
        "Eastern Standard Time" => "America/New_York",
        "Pacific Standard Time" => "America/Los_Angeles",
        "UTC" => "Etc/UTC",
        _ => return None,
    })
}

/// Instant UTC d'une heure civile dans un fuseau IANA.
///
/// - heure ambiguë (retour à l'heure d'hiver) : **première occurrence**, comme le veut la
///   RFC 5545 § 3.3.5 (le 25 octobre 2026 à 02:30 à Paris vaut 00:30 UTC, heure d'été) ;
/// - heure inexistante (passage à l'heure d'été) : décalage d'**avant** la lacune, même article
///   (le 29 mars 2026 à 02:30 à Paris vaut 01:30 UTC, soit 03:30 à l'heure d'été) ;
/// - fuseau inconnu : `None`.
fn local_vers_utc(tzid: &str, local: NaiveDateTime) -> Option<DateTime<Utc>> {
    let fuseau = fuseau_iana(tzid)?;
    if let Some(instant) = fuseau.from_local_datetime(&local).earliest() {
        return Some(instant.with_timezone(&Utc));
    }
    let veille = local.checked_sub_signed(TimeDelta::try_days(1)?)?;
    let decalage = fuseau.offset_from_local_datetime(&veille).earliest()?;
    let secondes = TimeDelta::try_seconds(i64::from(decalage.fix().local_minus_utc()))?;
    Some(Utc.from_utc_datetime(&local.checked_sub_signed(secondes)?))
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
        decider_invitation, invitation_depuis_stockage, invitation_du_message, juger_origine,
        lire_invitation, reponse_invitation, DecisionInvitation, EffetInvitation, InvitationConnue,
        InvitationStockee, ReponseInvitation, VerdictOrigine,
    };
    use icalendar::{Calendar, CalendarComponent, Component, PartStat};
    use std::str::FromStr;

    fn ics(methode: &str, sequence: u32, fuseau: &str, heure: &str) -> String {
        format!(
            "BEGIN:VCALENDAR\r\nMETHOD:{methode}\r\nBEGIN:VEVENT\r\nUID:fictif-j11@example.com\r\nSEQUENCE:{sequence}\r\nDTSTART;TZID={fuseau}:20261006T{heure}0000\r\nDTEND;TZID={fuseau}:20261006T{heure}0000\r\nSUMMARY:Audience fictive\r\nORGANIZER:mailto:organisateur@example.com\r\nATTENDEE:mailto:avocat@cabinet.example\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        )
    }

    /// Invitation dont les lignes `DTSTART` et `DTEND` sont données telles quelles.
    fn ics_brut(methode: &str, sequence: u32, debut: &str, fin: Option<&str>) -> String {
        let fin = fin.map(|f| format!("{f}\r\n")).unwrap_or_default();
        format!(
            "BEGIN:VCALENDAR\r\nMETHOD:{methode}\r\nBEGIN:VEVENT\r\nUID:fictif-j11@example.com\r\nSEQUENCE:{sequence}\r\n{debut}\r\n{fin}SUMMARY:Audience fictive\r\nORGANIZER:mailto:organisateur@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
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

    fn utc_de(debut: &str) -> Option<String> {
        lire_invitation(&ics_brut("REQUEST", 0, debut, None))
            .expect("lue")
            .instants()
            .debut_utc
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
    fn instant_utc_paris_ete_decalage_deux_heures() {
        let instants = lire_invitation(&ics("REQUEST", 0, "Europe/Paris", "09"))
            .expect("paris")
            .instants();
        assert_eq!(instants.debut_local, "2026-10-06T09:00:00");
        assert_eq!(
            instants.debut_utc.as_deref(),
            Some("2026-10-06T07:00:00.000Z")
        );
        assert_eq!(
            instants.fin_utc.as_deref(),
            Some("2026-10-06T07:00:00.000Z")
        );
    }

    #[test]
    fn instant_utc_paris_hiver_decalage_une_heure() {
        let utc = utc_de("DTSTART;TZID=Europe/Paris:20261208T090000");
        assert_eq!(utc.as_deref(), Some("2026-12-08T08:00:00.000Z"));
        // Le même quart d'heure civil, à six mois d'écart, n'a pas le même instant UTC.
        let ete = utc_de("DTSTART;TZID=Europe/Paris:20260708T090000");
        assert_eq!(ete.as_deref(), Some("2026-07-08T07:00:00.000Z"));
    }

    #[test]
    fn passage_a_l_heure_d_hiver_le_25_octobre_2026() {
        // Avant le passage (heure d'été, UTC+2) : 01:30 -> 23:30 UTC la veille.
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20261025T013000").as_deref(),
            Some("2026-10-24T23:30:00.000Z")
        );
        // 02:30 existe deux fois ; la première occurrence (heure d'été) est retenue.
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20261025T023000").as_deref(),
            Some("2026-10-25T00:30:00.000Z")
        );
        // Après le passage (heure d'hiver, UTC+1) : 03:30 -> 02:30 UTC.
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20261025T033000").as_deref(),
            Some("2026-10-25T02:30:00.000Z")
        );
        // Le lendemain, plus aucune ambiguïté.
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20261026T023000").as_deref(),
            Some("2026-10-26T01:30:00.000Z")
        );
    }

    #[test]
    fn passage_a_l_heure_d_ete_le_29_mars_2026() {
        // 02:30 n'existe pas : décalage d'avant la lacune (UTC+1), soit 03:30 à l'heure d'été.
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20260329T023000").as_deref(),
            Some("2026-03-29T01:30:00.000Z")
        );
        assert_eq!(
            utc_de("DTSTART;TZID=Europe/Paris:20260329T033000").as_deref(),
            Some("2026-03-29T01:30:00.000Z")
        );
    }

    #[test]
    fn fuseau_etranger_donne_son_propre_instant_utc() {
        assert_eq!(
            utc_de("DTSTART;TZID=America/New_York:20261006T140000").as_deref(),
            Some("2026-10-06T18:00:00.000Z")
        );
        assert_eq!(
            utc_de("DTSTART;TZID=America/New_York:20261208T140000").as_deref(),
            Some("2026-12-08T19:00:00.000Z")
        );
        assert_eq!(
            utc_de("DTSTART;TZID=Asia/Tokyo:20261006T090000").as_deref(),
            Some("2026-10-06T00:00:00.000Z")
        );
    }

    #[test]
    fn heure_utc_flottante_journee_et_fuseau_inconnu() {
        let utc = lire_invitation(&ics_brut(
            "REQUEST",
            0,
            "DTSTART:20261006T070000Z",
            Some("DTEND:20261006T080000Z"),
        ))
        .expect("utc");
        assert_eq!(utc.fuseau, "UTC");
        let instants = utc.instants();
        assert_eq!(instants.debut_local, "2026-10-06T07:00:00");
        assert_eq!(
            instants.debut_utc.as_deref(),
            Some("2026-10-06T07:00:00.000Z")
        );
        assert_eq!(
            instants.fin_utc.as_deref(),
            Some("2026-10-06T08:00:00.000Z")
        );

        let flottant =
            lire_invitation(&ics_brut("REQUEST", 0, "DTSTART:20261006T090000", None)).expect("f");
        assert_eq!(flottant.fuseau, "flottant");
        assert_eq!(flottant.instants().debut_local, "2026-10-06T09:00:00");
        assert_eq!(flottant.instants().debut_utc, None);

        let jour = lire_invitation(&ics_brut(
            "REQUEST",
            0,
            "DTSTART;VALUE=DATE:20261006",
            Some("DTEND;VALUE=DATE:20261007"),
        ))
        .expect("jour");
        assert_eq!(jour.fuseau, "flottant");
        let instants = jour.instants();
        assert_eq!(instants.debut_local, "2026-10-06");
        assert_eq!(instants.fin_local.as_deref(), Some("2026-10-07"));
        assert_eq!(instants.debut_utc, None);

        // Fuseau inconnu : l'heure civile est gardée, aucun instant n'est inventé.
        let inconnu = lire_invitation(&ics("REQUEST", 0, "Planete/Mars", "09")).expect("mars");
        assert_eq!(inconnu.fuseau, "Planete/Mars");
        assert_eq!(inconnu.instants().debut_local, "2026-10-06T09:00:00");
        assert_eq!(inconnu.instants().debut_utc, None);
    }

    #[test]
    fn noms_windows_et_prefixes_d_anciens_agendas() {
        assert_eq!(
            utc_de("DTSTART;TZID=Romance Standard Time:20261006T090000").as_deref(),
            Some("2026-10-06T07:00:00.000Z")
        );
        assert_eq!(
            utc_de("DTSTART;TZID=/mozilla.org/20050126_1/Europe/Paris:20261006T090000").as_deref(),
            Some("2026-10-06T07:00:00.000Z")
        );
        assert_eq!(
            utc_de("DTSTART;TZID=Fuseau Windows Inconnu:20261006T090000"),
            None
        );
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
    fn reponse_depuis_les_colonnes_stockees_garde_l_heure_et_le_fuseau() {
        for (fuseau, debut, fin, attendu) in [
            (
                "America/New_York",
                "2026-10-06T14:00:00",
                Some("2026-10-06T15:00:00"),
                "TZID=America/New_York:20261006T140000",
            ),
            (
                "UTC",
                "2026-10-06T07:00:00",
                None,
                "DTSTART:20261006T070000Z",
            ),
            ("flottant", "2026-10-06T09:00:00", None, ":20261006T090000"),
            ("flottant", "2026-10-06", None, "20261006"),
        ] {
            let invitation = invitation_depuis_stockage(&InvitationStockee {
                uid: "fictif-stocke@example.com",
                sequence: 2,
                fuseau,
                debut,
                fin,
                objet: "Audience fictive",
                organisateur: "organisateur@example.com",
            })
            .expect("stockée");
            let brut = reponse_invitation(
                &invitation,
                "avocat@cabinet.example",
                ReponseInvitation::PeutEtre,
            )
            .expect("réponse");
            assert!(brut.contains("METHOD:REPLY"), "{brut}");
            assert!(brut.contains("PARTSTAT=TENTATIVE"), "{brut}");
            assert!(brut.contains("UID:fictif-stocke@example.com"), "{brut}");
            assert!(brut.contains("SEQUENCE:2"), "{brut}");
            assert!(brut.contains(attendu), "{fuseau} : {brut}");
        }
        // Une valeur stockée illisible est refusée, jamais devinée.
        assert!(invitation_depuis_stockage(&InvitationStockee {
            uid: "x",
            sequence: 0,
            fuseau: "UTC",
            debut: "demain",
            fin: None,
            objet: "",
            organisateur: "o@example.com",
        })
        .is_err());
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
        assert_eq!(invitation.methode, "REQUEST");
        assert_eq!(invitation.fuseau, "Europe/Paris");
        assert_eq!(invitation.uid, "fictif-mime@example.com");
    }

    #[test]
    fn calendrier_en_piece_jointe_application_ics_ou_alternative() {
        let cal = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:fictif-alt@example.com\r\nSEQUENCE:0\r\nDTSTART;TZID=Europe/Paris:20261006T090000\r\nSUMMARY:Audience fictive\r\nORGANIZER:mailto:organisateur@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        for (type_partie, disposition) in [
            ("text/calendar; method=REQUEST; charset=utf-8", ""),
            (
                "text/calendar; method=REQUEST; name=\"invite.ics\"",
                "Content-Disposition: attachment; filename=\"invite.ics\"\r\n",
            ),
            (
                "application/ics; name=\"invite.ics\"",
                "Content-Disposition: attachment; filename=\"invite.ics\"\r\n",
            ),
        ] {
            let mime = format!(
                "From: organisateur@example.com\r\nTo: avocat@cabinet.example\r\nSubject: Audience fictive\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nInvitation.\r\n--b\r\nContent-Type: {type_partie}\r\n{disposition}\r\n{cal}--b--\r\n"
            );
            let invitation = invitation_du_message(mime.as_bytes()).expect("mime");
            assert!(invitation.is_some(), "calendrier absent : {type_partie}");
            assert_eq!(
                invitation.expect("calendrier").uid,
                "fictif-alt@example.com",
                "{type_partie}"
            );
        }
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

    fn connue(sequence: u32, effet: EffetInvitation) -> Option<InvitationConnue> {
        Some(InvitationConnue { sequence, effet })
    }

    fn lue(methode: &str, sequence: u32) -> super::InvitationLue {
        lire_invitation(&ics(methode, sequence, "Europe/Paris", "09")).expect("lue")
    }

    #[test]
    fn rejeu_et_sequence_ancienne_ignores_sequence_recente_applique() {
        let demande = EffetInvitation::Demande;
        // Rien de connu : création.
        assert_eq!(
            decider_invitation(None, &lue("REQUEST", 0)),
            DecisionInvitation::Creer
        );
        // Même SEQUENCE (rejeu) et SEQUENCE plus ancienne : ignorées.
        assert_eq!(
            decider_invitation(connue(1, demande), &lue("REQUEST", 1)),
            DecisionInvitation::Ignorer
        );
        assert_eq!(
            decider_invitation(connue(2, EffetInvitation::MiseAJour), &lue("REQUEST", 1)),
            DecisionInvitation::Ignorer
        );
        // Plus récente : mise à jour.
        assert_eq!(
            decider_invitation(connue(0, demande), &lue("REQUEST", 1)),
            DecisionInvitation::MettreAJour
        );
    }

    #[test]
    fn annulation_une_seule_fois_et_jamais_pour_une_sequence_plus_ancienne() {
        let demande = EffetInvitation::Demande;
        assert_eq!(
            decider_invitation(connue(2, EffetInvitation::MiseAJour), &lue("CANCEL", 3)),
            DecisionInvitation::Annuler
        );
        // Même SEQUENCE que la demande : certains agendas annulent ainsi.
        assert_eq!(
            decider_invitation(connue(0, demande), &lue("CANCEL", 0)),
            DecisionInvitation::Annuler
        );
        // Annulation plus ancienne que la demande connue : ignorée.
        assert_eq!(
            decider_invitation(connue(3, EffetInvitation::MiseAJour), &lue("CANCEL", 1)),
            DecisionInvitation::Ignorer
        );
        // Rejeu de l'annulation : ignoré.
        assert_eq!(
            decider_invitation(connue(3, EffetInvitation::Annulation), &lue("CANCEL", 3)),
            DecisionInvitation::Ignorer
        );
        // Une demande plus ancienne arrivée après l'annulation ne la défait pas.
        assert_eq!(
            decider_invitation(connue(3, EffetInvitation::Annulation), &lue("REQUEST", 2)),
            DecisionInvitation::Ignorer
        );
        // Annulation d'une invitation jamais reçue : la ligne naît annulée.
        assert_eq!(
            decider_invitation(None, &lue("CANCEL", 1)),
            DecisionInvitation::Creer
        );
    }

    #[test]
    fn seules_les_methodes_request_et_cancel_sont_des_invitations() {
        for methode in ["REPLY", "PUBLISH", "COUNTER", "REFRESH"] {
            assert_eq!(
                decider_invitation(None, &lue(methode, 0)),
                DecisionInvitation::Ignorer,
                "méthode {methode:?}"
            );
        }
        // Sans METHOD, un fichier .ics n'est pas une invitation.
        let sans_methode =
            ics("REQUEST", 0, "Europe/Paris", "09").replace("METHOD:REQUEST\r\n", "");
        let lue_sans = lire_invitation(&sans_methode).expect("sans méthode");
        assert_eq!(lue_sans.methode, "");
        assert_eq!(
            decider_invitation(None, &lue_sans),
            DecisionInvitation::Ignorer
        );
        // Contrôle positif : le même fichier avec METHOD:REQUEST est une invitation.
        assert_eq!(
            decider_invitation(None, &lue("REQUEST", 0)),
            DecisionInvitation::Creer
        );
    }
    fn lue_de(expediteurs: &[&str], organisateur: &str) -> super::InvitationLue {
        let mut lue = lue("REQUEST", 3);
        lue.organisateur = organisateur.to_owned();
        lue.expediteurs = expediteurs.iter().map(|e| (*e).to_owned()).collect();
        lue
    }

    #[test]
    fn expediteurs_lus_dans_from_et_sender() {
        let brut = "From: Organisateur <Organisateur@Example.com>
Sender: secretariat@example.com
To: avocat@cabinet.example
Subject: Audience fictive
MIME-Version: 1.0
Content-Type: text/calendar; method=REQUEST

BEGIN:VCALENDAR
METHOD:REQUEST
BEGIN:VEVENT
UID:fictif-exp@example.com
SEQUENCE:0
DTSTART;TZID=Europe/Paris:20261006T090000
SUMMARY:Audience fictive
ORGANIZER:mailto:organisateur@example.com
END:VEVENT
END:VCALENDAR
";
        let lue = invitation_du_message(brut.as_bytes())
            .expect("lecture")
            .expect("invitation");
        assert_eq!(
            lue.expediteurs,
            ["organisateur@example.com", "secretariat@example.com"]
        );
    }

    #[test]
    fn mise_a_jour_ou_annulation_par_un_tiers_est_refusee() {
        let tiers = lue_de(&["intrus@example.com"], "organisateur@example.com");
        for decision in [DecisionInvitation::MettreAJour, DecisionInvitation::Annuler] {
            let verdict = juger_origine(decision, Some("organisateur@example.com"), &tiers);
            assert_eq!(verdict, VerdictOrigine::ExpediteurTiers);
            assert!(verdict.refuse());
        }
        // Essai négatif : le même mail envoyé par l'organisateur est appliqué.
        let organisateur = lue_de(&["Organisateur@example.com"], "organisateur@example.com");
        for decision in [DecisionInvitation::MettreAJour, DecisionInvitation::Annuler] {
            let verdict = juger_origine(decision, Some("organisateur@example.com"), &organisateur);
            assert_eq!(verdict, VerdictOrigine::Verifiee);
            assert!(!verdict.refuse());
        }
    }

    #[test]
    fn l_organisateur_ne_change_jamais_par_une_mise_a_jour() {
        let change = lue_de(&["organisateur@example.com"], "autre@example.com");
        let verdict = juger_origine(
            DecisionInvitation::MettreAJour,
            Some("organisateur@example.com"),
            &change,
        );
        assert_eq!(verdict, VerdictOrigine::OrganisateurModifie);
        assert!(verdict.refuse());
        // Un mail sans expéditeur lisible ne peut pas prouver l'origine.
        let anonyme = lue_de(&[], "organisateur@example.com");
        assert_eq!(
            juger_origine(
                DecisionInvitation::Annuler,
                Some("organisateur@example.com"),
                &anonyme
            ),
            VerdictOrigine::ExpediteurTiers
        );
    }

    #[test]
    fn creation_par_un_autre_que_l_organisateur_est_non_verifiee() {
        let secretariat = lue_de(&["secretariat@example.com"], "organisateur@example.com");
        let verdict = juger_origine(DecisionInvitation::Creer, None, &secretariat);
        assert_eq!(verdict, VerdictOrigine::NonVerifiee);
        assert!(!verdict.refuse(), "la création n'est pas bloquée");
        let direct = lue_de(&["organisateur@example.com"], "organisateur@example.com");
        assert_eq!(
            juger_origine(DecisionInvitation::Creer, None, &direct),
            VerdictOrigine::Verifiee
        );
        // Un rejeu ou une SEQUENCE ancienne n'a rien à appliquer, donc rien à refuser.
        assert_eq!(
            juger_origine(DecisionInvitation::Ignorer, None, &secretariat),
            VerdictOrigine::Verifiee
        );
    }
}
