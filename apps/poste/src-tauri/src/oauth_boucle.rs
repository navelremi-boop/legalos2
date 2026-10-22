//! Écoute de bouclage pour la connexion OAuth des boîtes (RFC 8252, § 7.3).
//!
//! Le poste ouvre l'adresse d'autorisation dans le navigateur du système ; le fournisseur redirige ce navigateur vers
//! `http://127.0.0.1:<port>/?code=…&state=…`. Ce module écoute ce port, retient la première requête valide et la rend à
//! l'interface, qui la transmet à l'instance. Rien d'autre : la logique OAuth (PKCE, échange du code, jetons) est dans
//! l'API, jamais ici.
//!
//! Garanties :
//! - l'écoute est liée à `127.0.0.1`, jamais à une autre interface ;
//! - une seule écoute à la fois par fenêtre ; une écoute ne sert qu'une seule requête valide ;
//! - le code et le `state` ne sont ni journalisés, ni écrits sur disque, ni émis en événement : ils ne sortent que
//!   comme valeur de retour de `oauth_attendre_retour` (ce module n'écrit aucun journal) ;
//! - lecture bornée (8 Ko, délai par connexion) ; toute requête qui n'est pas exactement `GET /?code=…&state=…` (ou
//!   `?error=…`) reçoit 404 et l'écoute continue ;
//! - la page rendue au navigateur est un HTML statique sans contenu actif, jamais mis en cache.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

/// Taille maximale de la tête d'une requête lue.
const TAILLE_MAX_REQUETE: usize = 8 * 1024;
/// Durée maximale pour recevoir la tête d'une requête, par connexion.
const DELAI_LECTURE: Duration = Duration::from_secs(3);
/// Durée maximale d'attente du retour du navigateur.
const DELAI_ATTENTE: Duration = Duration::from_secs(10 * 60);
/// Connexions traitées en même temps (les navigateurs en ouvrent d'avance sans rien y envoyer).
const CONNEXIONS_MAX: usize = 16;
/// Pas d'interrogation de l'écoute (acceptation, annulation, délai).
const PAS: Duration = Duration::from_millis(25);
const LONGUEUR_MAX_CODE: usize = 4096;
const LONGUEUR_MAX_STATE: usize = 1024;
const LONGUEUR_MAX_ERREUR: usize = 64;

/// Codes d'erreur rendus à l'interface (elle les traduit en français).
const ERREUR_DELAI: &str = "delai_depasse";
const ERREUR_ANNULE: &str = "annule";
const ERREUR_INCONNUE: &str = "erreur_inconnue";

const PAGE_RECUE: &str = "<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"referrer\" content=\"no-referrer\">\n<title>LEGAL OS</title>\n</head>\n<body>\n<p>Connexion reçue : vous pouvez fermer cette fenêtre et revenir à LEGAL OS.</p>\n</body>\n</html>\n";
const PAGE_ECHEC: &str = "<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"referrer\" content=\"no-referrer\">\n<title>LEGAL OS</title>\n</head>\n<body>\n<p>La connexion n'a pas abouti : vous pouvez fermer cette fenêtre et revenir à LEGAL OS.</p>\n</body>\n</html>\n";

/// Ce que le navigateur a demandé à l'écoute.
#[derive(Debug, PartialEq, Eq)]
pub enum Requete {
    /// `GET /?code=…&state=…`
    Retour { code: String, state: String },
    /// `GET /?error=…` : le fournisseur (ou l'utilisateur) a refusé.
    Erreur(String),
    /// Toute autre requête : 404, l'écoute continue.
    Ignoree,
}

/// Valeur d'un paramètre de requête (`application/x-www-form-urlencoded`) ; `None` si l'encodage est invalide.
fn decoder(texte: &str) -> Option<String> {
    let octets = texte.as_bytes();
    let mut sortie = Vec::with_capacity(octets.len());
    let mut i = 0;
    while let Some(&octet) = octets.get(i) {
        match octet {
            b'%' => {
                let haut = octets.get(i + 1).and_then(|c| (*c as char).to_digit(16))?;
                let bas = octets.get(i + 2).and_then(|c| (*c as char).to_digit(16))?;
                sortie.push(u8::try_from(haut * 16 + bas).ok()?);
                i += 3;
            }
            b'+' => {
                sortie.push(b' ');
                i += 1;
            }
            _ => {
                sortie.push(octet);
                i += 1;
            }
        }
    }
    let texte = String::from_utf8(sortie).ok()?;
    if texte.chars().any(char::is_control) {
        return None;
    }
    Some(texte)
}

fn erreur_propre(valeur: &str) -> String {
    let conforme = !valeur.is_empty()
        && valeur.len() <= LONGUEUR_MAX_ERREUR
        && valeur
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if conforme {
        valeur.to_owned()
    } else {
        ERREUR_INCONNUE.to_owned()
    }
}

/// Analyse la ligne de requête (`GET /?code=…&state=… HTTP/1.1`, sans fin de ligne). Pure.
///
/// Ne retient que `GET /` avec exactement un `code` et un `state` non vides, ou exactement un `error` sans `code`.
/// Un paramètre répété, un encodage invalide, un autre chemin ou une autre méthode donnent `Ignoree`.
pub fn analyser_ligne_requete(ligne: &str) -> Requete {
    if ligne.len() > TAILLE_MAX_REQUETE {
        return Requete::Ignoree;
    }
    let mut parties = ligne.split(' ');
    let (Some(methode), Some(cible), Some(version), None) = (
        parties.next(),
        parties.next(),
        parties.next(),
        parties.next(),
    ) else {
        return Requete::Ignoree;
    };
    if methode != "GET" || !matches!(version, "HTTP/1.1" | "HTTP/1.0") {
        return Requete::Ignoree;
    }
    let Some((chemin, requete)) = cible.split_once('?') else {
        return Requete::Ignoree;
    };
    if chemin != "/" || requete.contains('#') {
        return Requete::Ignoree;
    }
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut erreur: Option<String> = None;
    for paire in requete.split('&').filter(|p| !p.is_empty()) {
        let (nom, valeur) = paire.split_once('=').unwrap_or((paire, ""));
        let cible = match nom {
            "code" => &mut code,
            "state" => &mut state,
            "error" => &mut erreur,
            _ => continue,
        };
        if cible.is_some() {
            return Requete::Ignoree;
        }
        let Some(valeur) = decoder(valeur) else {
            return Requete::Ignoree;
        };
        *cible = Some(valeur);
    }
    match (code, state, erreur) {
        (Some(_), _, Some(_)) => Requete::Ignoree,
        (None, _, Some(erreur)) => Requete::Erreur(erreur_propre(&erreur)),
        (Some(code), Some(state), None)
            if !code.is_empty()
                && code.len() <= LONGUEUR_MAX_CODE
                && !state.is_empty()
                && state.len() <= LONGUEUR_MAX_STATE =>
        {
            Requete::Retour { code, state }
        }
        _ => Requete::Ignoree,
    }
}

/// Analyse la tête d'une requête (ligne de requête et en-têtes). Pure.
///
/// En plus de la ligne : si un en-tête `Host` est présent, c'est exactement `127.0.0.1:<port>` et il est unique
/// (un navigateur qui suit la redirection l'écrit ainsi ; une page qui détourne un nom de domaine vers la boucle
/// locale ne le peut pas).
pub fn analyser_tete(tete: &str, port: u16) -> Requete {
    let mut lignes = tete.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l));
    let Some(premiere) = lignes.next() else {
        return Requete::Ignoree;
    };
    let attendu = format!("127.0.0.1:{port}");
    let mut hotes = 0;
    for ligne in lignes {
        if let Some((nom, valeur)) = ligne.split_once(':') {
            if nom.eq_ignore_ascii_case("host") {
                hotes += 1;
                if valeur.trim() != attendu {
                    return Requete::Ignoree;
                }
            }
        }
    }
    if hotes > 1 {
        return Requete::Ignoree;
    }
    analyser_ligne_requete(premiere)
}

fn position(tampon: &[u8], motif: &[u8]) -> Option<usize> {
    tampon.windows(motif.len()).position(|f| f == motif)
}

/// Lit la tête de la requête (jusqu'à la ligne vide), bornée en taille et en durée ; `None` si elle n'arrive pas.
fn lire_tete(flux: &mut TcpStream) -> Option<String> {
    let fin_lecture = Instant::now() + DELAI_LECTURE;
    let mut tampon: Vec<u8> = Vec::with_capacity(1024);
    let mut morceau = [0_u8; 1024];
    loop {
        let reste = fin_lecture.checked_duration_since(Instant::now())?;
        flux.set_read_timeout(Some(reste.max(Duration::from_millis(1))))
            .ok()?;
        let lu = flux.read(&mut morceau).ok()?;
        if lu == 0 {
            return None;
        }
        tampon.extend_from_slice(morceau.get(..lu)?);
        let borne = tampon.len().min(TAILLE_MAX_REQUETE);
        if let Some(fin) = position(tampon.get(..borne)?, b"\r\n\r\n") {
            return String::from_utf8(tampon.get(..fin)?.to_vec()).ok();
        }
        if tampon.len() >= TAILLE_MAX_REQUETE {
            return None;
        }
    }
}

fn repondre(flux: &mut TcpStream, statut: &str, page: &str) {
    let reponse = if page.is_empty() {
        format!(
            "HTTP/1.1 {statut}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        )
    } else {
        format!(
            "HTTP/1.1 {statut}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{page}",
            page.len()
        )
    };
    let _ = flux.write_all(reponse.as_bytes());
    let _ = flux.flush();
    let _ = flux.shutdown(Shutdown::Write);
}

/// Ce que l'attente rend à l'interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RetourBouclage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Code d'erreur : celui du fournisseur (`access_denied`…), `delai_depasse` ou `annule`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erreur: Option<String>,
}

impl RetourBouclage {
    fn echec(erreur: &str) -> Self {
        Self {
            code: None,
            state: None,
            erreur: Some(erreur.to_owned()),
        }
    }
}

/// Traite une connexion : 404 pour tout sauf la première requête valide, qui reçoit la page de confirmation.
fn traiter_connexion(
    mut flux: TcpStream,
    port: u16,
    deja_recue: &AtomicBool,
    envoi: &mpsc::Sender<RetourBouclage>,
) {
    let _ = flux.set_nonblocking(false);
    let Some(tete) = lire_tete(&mut flux) else {
        return;
    };
    let requete = analyser_tete(&tete, port);
    let valide = !matches!(requete, Requete::Ignoree);
    // Une seule requête valide est retenue, même si deux arrivent ensemble.
    if !valide
        || deja_recue
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        repondre(&mut flux, "404 Not Found", "");
        return;
    }
    let retour = match requete {
        Requete::Retour { code, state } => {
            repondre(&mut flux, "200 OK", PAGE_RECUE);
            RetourBouclage {
                code: Some(code),
                state: Some(state),
                erreur: None,
            }
        }
        Requete::Erreur(erreur) => {
            repondre(&mut flux, "200 OK", PAGE_ECHEC);
            RetourBouclage::echec(&erreur)
        }
        Requete::Ignoree => return,
    };
    let _ = envoi.send(retour);
}

/// Attend la première requête valide sur l'écoute, jusqu'au délai ou à l'annulation. Bloquante ; l'écoute est fermée
/// (le port ne répond plus) quand la fonction rend la main.
fn attendre_bloquant(
    ecouteur: TcpListener,
    annule: &AtomicBool,
    delai: Duration,
) -> RetourBouclage {
    let Ok(adresse) = ecouteur.local_addr() else {
        return RetourBouclage::echec(ERREUR_INCONNUE);
    };
    let port = adresse.port();
    if ecouteur.set_nonblocking(true).is_err() {
        return RetourBouclage::echec(ERREUR_INCONNUE);
    }
    let fin = Instant::now() + delai;
    let deja_recue = Arc::new(AtomicBool::new(false));
    let actives = Arc::new(AtomicUsize::new(0));
    let (envoi, reception) = mpsc::channel::<RetourBouclage>();
    loop {
        if annule.load(Ordering::SeqCst) {
            return RetourBouclage::echec(ERREUR_ANNULE);
        }
        match reception.try_recv() {
            Ok(retour) => return retour,
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => return RetourBouclage::echec(ERREUR_INCONNUE),
        }
        if Instant::now() >= fin {
            return RetourBouclage::echec(ERREUR_DELAI);
        }
        match ecouteur.accept() {
            Ok((flux, _)) => {
                if actives.fetch_add(1, Ordering::SeqCst) >= CONNEXIONS_MAX {
                    actives.fetch_sub(1, Ordering::SeqCst);
                    drop(flux);
                    continue;
                }
                let deja_recue = Arc::clone(&deja_recue);
                let actives = Arc::clone(&actives);
                let envoi = envoi.clone();
                thread::spawn(move || {
                    traiter_connexion(flux, port, &deja_recue, &envoi);
                    actives.fetch_sub(1, Ordering::SeqCst);
                });
                continue;
            }
            // Rien à accepter pour l'instant (ou erreur passagère) : on réessaie au pas suivant.
            Err(_) => {}
        }
        thread::sleep(PAS);
    }
}

struct Ecoute {
    id: String,
    annule: Arc<AtomicBool>,
    /// Présent tant que personne n'attend ; l'attente le prend.
    ecouteur: Option<TcpListener>,
}

/// Les écoutes en cours, par fenêtre (au plus une par fenêtre).
#[derive(Default)]
pub struct EtatBouclage {
    ecoutes: Mutex<HashMap<String, Ecoute>>,
    compteur: AtomicU64,
}

impl EtatBouclage {
    fn ecoutes(&self) -> MutexGuard<'_, HashMap<String, Ecoute>> {
        self.ecoutes.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Ouvre l'écoute de la fenêtre ; l'écoute précédente de cette fenêtre, s'il y en a une, est fermée.
    fn ouvrir(&self, fenetre: &str) -> Result<EcouteOuverte, String> {
        let ecouteur = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Impossible d'ouvrir le port local de connexion.".to_owned())?;
        let port = ecouteur
            .local_addr()
            .map_err(|_| "Impossible de lire le port local de connexion.".to_owned())?
            .port();
        let id = format!(
            "bouclage-{}",
            self.compteur.fetch_add(1, Ordering::SeqCst) + 1
        );
        let annule = Arc::new(AtomicBool::new(false));
        let precedente = self.ecoutes().insert(
            fenetre.to_owned(),
            Ecoute {
                id: id.clone(),
                annule: Arc::clone(&annule),
                ecouteur: Some(ecouteur),
            },
        );
        if let Some(precedente) = precedente {
            precedente.annule.store(true, Ordering::SeqCst);
        }
        Ok(EcouteOuverte { id, port })
    }

    /// Prend l'écoute pour l'attendre ; erreur si elle n'existe plus ou est déjà attendue.
    fn prendre(&self, fenetre: &str, id: &str) -> Result<(TcpListener, Arc<AtomicBool>), String> {
        let mut ecoutes = self.ecoutes();
        let ecoute = ecoutes
            .get_mut(fenetre)
            .filter(|e| e.id == id)
            .ok_or_else(|| "Écoute inconnue ou déjà fermée.".to_owned())?;
        let ecouteur = ecoute
            .ecouteur
            .take()
            .ok_or_else(|| "Cette écoute est déjà attendue.".to_owned())?;
        Ok((ecouteur, Arc::clone(&ecoute.annule)))
    }

    fn retirer(&self, fenetre: &str, id: &str) {
        let mut ecoutes = self.ecoutes();
        if ecoutes.get(fenetre).is_some_and(|e| e.id == id) {
            if let Some(ecoute) = ecoutes.remove(fenetre) {
                ecoute.annule.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[derive(Debug, Serialize)]
pub struct EcouteOuverte {
    pub id: String,
    pub port: u16,
}

/// Ouvre une écoute sur `127.0.0.1`, port libre au choix du système.
#[tauri::command]
pub fn oauth_ecouter_bouclage(
    window: tauri::Window,
    etat: State<'_, EtatBouclage>,
) -> Result<EcouteOuverte, String> {
    etat.ouvrir(window.label())
}

/// Attend le retour du navigateur : `{ code, state }`, ou `{ erreur }` (refus du fournisseur, `delai_depasse`,
/// `annule`). Les erreurs de commande (écoute inconnue) sont des `Err`.
#[tauri::command]
pub async fn oauth_attendre_retour(
    window: tauri::Window,
    etat: State<'_, EtatBouclage>,
    id: String,
) -> Result<RetourBouclage, String> {
    let fenetre = window.label().to_owned();
    let (ecouteur, annule) = etat.prendre(&fenetre, &id)?;
    let retour = tauri::async_runtime::spawn_blocking(move || {
        attendre_bloquant(ecouteur, &annule, DELAI_ATTENTE)
    })
    .await
    .map_err(|_| "L'attente de la connexion a été interrompue.".to_owned())?;
    // Terminée (retour, refus, délai ou annulation) : l'écoute est libérée.
    etat.retirer(&fenetre, &id);
    Ok(retour)
}

/// Ferme l'écoute et libère l'attente ; sans effet si l'écoute n'existe plus.
#[tauri::command]
pub fn oauth_annuler_bouclage(window: tauri::Window, etat: State<'_, EtatBouclage>, id: String) {
    etat.retirer(window.label(), &id);
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn retour(code: &str, state: &str) -> Requete {
        Requete::Retour {
            code: code.to_owned(),
            state: state.to_owned(),
        }
    }

    #[test]
    fn retient_le_retour_du_fournisseur() {
        assert_eq!(
            analyser_ligne_requete("GET /?code=abc123&state=etat-1 HTTP/1.1"),
            retour("abc123", "etat-1")
        );
        // L'ordre des paramètres et les paramètres en plus (scope, session_state…) n'y changent rien.
        assert_eq!(
            analyser_ligne_requete("GET /?state=s&scope=mail&code=c&session_state=x HTTP/1.1"),
            retour("c", "s")
        );
        assert_eq!(
            analyser_ligne_requete("GET /?code=c&state=s HTTP/1.0"),
            retour("c", "s")
        );
    }

    #[test]
    fn decode_l_encodage_pourcent() {
        assert_eq!(
            analyser_ligne_requete("GET /?code=4%2F0AX%2Bz_-.~&state=a%20b HTTP/1.1"),
            retour("4/0AX+z_-.~", "a b")
        );
        assert_eq!(
            analyser_ligne_requete("GET /?code=%C3%A9t%C3%A9&state=s HTTP/1.1"),
            retour("été", "s")
        );
        assert_eq!(
            analyser_ligne_requete("GET /?code=a+b&state=s HTTP/1.1"),
            retour("a b", "s")
        );
    }

    #[test]
    fn un_encodage_invalide_est_ignore() {
        for ligne in [
            "GET /?code=%zz&state=s HTTP/1.1",
            "GET /?code=abc%&state=s HTTP/1.1",
            "GET /?code=abc%4&state=s HTTP/1.1",
            "GET /?code=%FF%FE&state=s HTTP/1.1",
            "GET /?code=a%00b&state=s HTTP/1.1",
            "GET /?code=a%0Ab&state=s HTTP/1.1",
            "GET /?code=c&state=%G1 HTTP/1.1",
        ] {
            assert_eq!(analyser_ligne_requete(ligne), Requete::Ignoree, "{ligne}");
        }
    }

    #[test]
    fn les_autres_chemins_et_methodes_sont_ignores() {
        for ligne in [
            "GET /favicon.ico HTTP/1.1",
            "GET /callback?code=c&state=s HTTP/1.1",
            "GET //?code=c&state=s HTTP/1.1",
            "GET /x/?code=c&state=s HTTP/1.1",
            "GET /%3Fcode=c&state=s HTTP/1.1",
            "GET / HTTP/1.1",
            "POST /?code=c&state=s HTTP/1.1",
            "HEAD /?code=c&state=s HTTP/1.1",
            "get /?code=c&state=s HTTP/1.1",
            "GET /?code=c&state=s HTTP/2",
            "GET /?code=c&state=s",
            "GET  /?code=c&state=s HTTP/1.1",
            "GET /?code=c&state=s HTTP/1.1 extra",
            "GET http://127.0.0.1/?code=c&state=s HTTP/1.1",
            "GET *?code=c&state=s HTTP/1.1",
            "",
            "GARBAGE",
        ] {
            assert_eq!(analyser_ligne_requete(ligne), Requete::Ignoree, "{ligne}");
        }
    }

    #[test]
    fn des_parametres_manquants_ou_vides_sont_ignores() {
        for ligne in [
            "GET /?code=c HTTP/1.1",
            "GET /?state=s HTTP/1.1",
            "GET /?code=&state=s HTTP/1.1",
            "GET /?code=c&state= HTTP/1.1",
            "GET /?code&state=s HTTP/1.1",
            "GET /? HTTP/1.1",
            "GET /?foo=bar HTTP/1.1",
            "GET /?scope=mail&session_state=x HTTP/1.1",
        ] {
            assert_eq!(analyser_ligne_requete(ligne), Requete::Ignoree, "{ligne}");
        }
    }

    #[test]
    fn un_parametre_repete_est_ignore() {
        for ligne in [
            "GET /?code=a&code=b&state=s HTTP/1.1",
            "GET /?code=a&state=s&state=t HTTP/1.1",
            "GET /?code=a&state=s&code=a HTTP/1.1",
            "GET /?error=access_denied&error=x HTTP/1.1",
        ] {
            assert_eq!(analyser_ligne_requete(ligne), Requete::Ignoree, "{ligne}");
        }
    }

    #[test]
    fn le_refus_du_fournisseur_est_rendu_sans_son_texte() {
        assert_eq!(
            analyser_ligne_requete("GET /?error=access_denied&state=s HTTP/1.1"),
            Requete::Erreur("access_denied".to_owned())
        );
        assert_eq!(
            analyser_ligne_requete("GET /?error=access_denied HTTP/1.1"),
            Requete::Erreur("access_denied".to_owned())
        );
        // Le texte libre du fournisseur n'est pas repris.
        assert_eq!(
            analyser_ligne_requete(
                "GET /?error=access_denied&error_description=refus+de+l%27utilisateur&state=s HTTP/1.1"
            ),
            Requete::Erreur("access_denied".to_owned())
        );
        // Une valeur qui n'est pas un code d'erreur OAuth devient une erreur générique.
        assert_eq!(
            analyser_ligne_requete("GET /?error=%3Cscript%3E HTTP/1.1"),
            Requete::Erreur(ERREUR_INCONNUE.to_owned())
        );
        assert_eq!(
            analyser_ligne_requete("GET /?error= HTTP/1.1"),
            Requete::Erreur(ERREUR_INCONNUE.to_owned())
        );
        // Un code et une erreur ensemble sont ambigus.
        assert_eq!(
            analyser_ligne_requete("GET /?code=c&state=s&error=access_denied HTTP/1.1"),
            Requete::Ignoree
        );
    }

    #[test]
    fn une_requete_surdimensionnee_est_ignoree() {
        let long = "a".repeat(TAILLE_MAX_REQUETE);
        assert_eq!(
            analyser_ligne_requete(&format!("GET /?code={long}&state=s HTTP/1.1")),
            Requete::Ignoree
        );
        // Un code plus long que la borne du code, dans une ligne qui tient en 8 Ko.
        let trop_long = "a".repeat(LONGUEUR_MAX_CODE + 1);
        assert_eq!(
            analyser_ligne_requete(&format!("GET /?code={trop_long}&state=s HTTP/1.1")),
            Requete::Ignoree
        );
        let borne = "a".repeat(LONGUEUR_MAX_CODE);
        assert_eq!(
            analyser_ligne_requete(&format!("GET /?code={borne}&state=s HTTP/1.1")),
            retour(&borne, "s")
        );
        let state_long = "s".repeat(LONGUEUR_MAX_STATE + 1);
        assert_eq!(
            analyser_ligne_requete(&format!("GET /?code=c&state={state_long} HTTP/1.1")),
            Requete::Ignoree
        );
    }

    #[test]
    fn la_tete_exige_l_hote_de_bouclage_quand_il_est_present() {
        let ligne = "GET /?code=c&state=s HTTP/1.1";
        assert_eq!(
            analyser_tete(
                &format!("{ligne}\r\nHost: 127.0.0.1:5000\r\nAccept: */*"),
                5000
            ),
            retour("c", "s")
        );
        assert_eq!(
            analyser_tete(&format!("{ligne}\r\nhost:127.0.0.1:5000"), 5000),
            retour("c", "s")
        );
        // Sans en-tête Host (HTTP/1.0).
        assert_eq!(analyser_tete(ligne, 5000), retour("c", "s"));
        for hote in [
            "Host: evil.example:5000",
            "Host: localhost:5000",
            "Host: 127.0.0.1:5001",
            "Host: 127.0.0.1",
        ] {
            assert_eq!(
                analyser_tete(&format!("{ligne}\r\n{hote}"), 5000),
                Requete::Ignoree,
                "{hote}"
            );
        }
        assert_eq!(
            analyser_tete(
                &format!("{ligne}\r\nHost: 127.0.0.1:5000\r\nHost: 127.0.0.1:5000"),
                5000
            ),
            Requete::Ignoree
        );
    }

    // --- Essais sur de vrais sockets (127.0.0.1) -------------------------------------------------

    /// Envoie une requête brute et rend la réponse complète.
    fn requete_brute(port: u16, octets: &[u8]) -> String {
        let mut flux = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        flux.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        // Le serveur peut refuser et fermer avant la fin de l'envoi (requête surdimensionnée).
        let _ = flux.write_all(octets);
        let mut reponse = Vec::new();
        let _ = flux.read_to_end(&mut reponse);
        String::from_utf8_lossy(&reponse).into_owned()
    }

    fn get(port: u16, cible: &str) -> String {
        requete_brute(
            port,
            format!("GET {cible} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
    }

    fn lancer(delai: Duration) -> (u16, Arc<AtomicBool>, thread::JoinHandle<RetourBouclage>) {
        let ecouteur = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = ecouteur.local_addr().unwrap().port();
        let annule = Arc::new(AtomicBool::new(false));
        let annule_attente = Arc::clone(&annule);
        let attente = thread::spawn(move || attendre_bloquant(ecouteur, &annule_attente, delai));
        (port, annule, attente)
    }

    fn port_ferme(port: u16) -> bool {
        // Laisse à l'attente le temps de rendre la main et de fermer l'écoute.
        for _ in 0..100 {
            if TcpStream::connect_timeout(
                &(Ipv4Addr::LOCALHOST, port).into(),
                Duration::from_millis(200),
            )
            .is_err()
            {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn l_ecoute_ignore_les_parasites_puis_rend_le_premier_retour_valide() {
        let (port, _annule, attente) = lancer(Duration::from_secs(20));
        for cible in ["/favicon.ico", "/callback?code=x&state=y", "/?code=seul"] {
            let reponse = get(port, cible);
            assert!(reponse.starts_with("HTTP/1.1 404"), "{cible} : {reponse}");
        }
        let reponse = requete_brute(
            port,
            format!("POST /?code=c&state=s HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\n\r\n")
                .as_bytes(),
        );
        assert!(reponse.starts_with("HTTP/1.1 404"), "{reponse}");
        // Une connexion qui n'envoie rien ne bloque pas les suivantes.
        let _muet = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        // Une tête surdimensionnée est refusée, l'écoute continue.
        let enorme = format!("GET /?{} HTTP/1.1\r\n\r\n", "a=b&".repeat(5000));
        let reponse = requete_brute(port, enorme.as_bytes());
        assert!(!reponse.contains("200 OK"), "{reponse}");
        assert!(
            !attente.is_finished(),
            "l'attente doit continuer après les parasites"
        );
        // Un en-tête Host étranger (rebond DNS) est refusé.
        let reponse = requete_brute(
            port,
            b"GET /?code=c&state=s HTTP/1.1\r\nHost: evil.example\r\n\r\n",
        );
        assert!(reponse.starts_with("HTTP/1.1 404"), "{reponse}");
        assert!(!attente.is_finished());

        let reponse = get(port, "/?code=le-code&state=le-state");
        assert!(reponse.starts_with("HTTP/1.1 200 OK"), "{reponse}");
        let reponse_min = reponse.to_ascii_lowercase();
        assert!(reponse_min.contains("content-type: text/html; charset=utf-8"));
        assert!(reponse_min.contains("cache-control: no-store"));
        assert!(reponse
            .contains("Connexion reçue : vous pouvez fermer cette fenêtre et revenir à LEGAL OS."));
        assert!(!reponse_min.contains("<script"));
        assert!(!reponse.contains("le-code") && !reponse.contains("le-state"));
        let retour = attente.join().unwrap();
        assert_eq!(retour.code.as_deref(), Some("le-code"));
        assert_eq!(retour.state.as_deref(), Some("le-state"));
        assert_eq!(retour.erreur, None);
        assert!(
            port_ferme(port),
            "l'écoute doit être fermée après le retour"
        );
    }

    #[test]
    fn une_seule_requete_valide_est_retenue() {
        let (port, _annule, attente) = lancer(Duration::from_secs(20));
        let reponse = get(port, "/?code=premier&state=s1");
        assert!(reponse.starts_with("HTTP/1.1 200 OK"), "{reponse}");
        let retour = attente.join().unwrap();
        assert_eq!(retour.code.as_deref(), Some("premier"));
        assert!(port_ferme(port));
    }

    #[test]
    fn le_refus_du_fournisseur_termine_l_attente_avec_une_erreur() {
        let (port, _annule, attente) = lancer(Duration::from_secs(20));
        let reponse = get(port, "/?error=access_denied&state=s");
        assert!(reponse.starts_with("HTTP/1.1 200 OK"), "{reponse}");
        assert!(reponse.contains("La connexion n'a pas abouti"));
        let retour = attente.join().unwrap();
        assert_eq!(retour.code, None);
        assert_eq!(retour.state, None);
        assert_eq!(retour.erreur.as_deref(), Some("access_denied"));
        assert!(port_ferme(port));
    }

    #[test]
    fn l_annulation_libere_l_attente_et_ferme_le_port() {
        let (port, annule, attente) = lancer(Duration::from_secs(60));
        assert!(get(port, "/favicon.ico").starts_with("HTTP/1.1 404"));
        let debut = Instant::now();
        annule.store(true, Ordering::SeqCst);
        let retour = attente.join().unwrap();
        assert!(debut.elapsed() < Duration::from_secs(5));
        assert_eq!(retour.erreur.as_deref(), Some(ERREUR_ANNULE));
        assert!(port_ferme(port), "le port ne doit plus répondre");
    }

    #[test]
    fn le_delai_depasse_rend_une_erreur_et_ferme_le_port() {
        let (port, _annule, attente) = lancer(Duration::from_millis(300));
        let retour = attente.join().unwrap();
        assert_eq!(retour.erreur.as_deref(), Some(ERREUR_DELAI));
        assert!(port_ferme(port));
    }

    #[test]
    fn le_retour_se_serialise_sans_champ_vide() {
        let ok = serde_json::to_string(&RetourBouclage {
            code: Some("c".into()),
            state: Some("s".into()),
            erreur: None,
        })
        .unwrap();
        assert_eq!(ok, r#"{"code":"c","state":"s"}"#);
        let ko = serde_json::to_string(&RetourBouclage::echec(ERREUR_DELAI)).unwrap();
        assert_eq!(ko, r#"{"erreur":"delai_depasse"}"#);
    }

    #[test]
    fn l_ecoute_est_liee_a_la_boucle_locale_et_unique_par_fenetre() {
        let etat = EtatBouclage::default();
        let premiere = etat.ouvrir("main").unwrap();
        let ecoutes = etat.ecoutes();
        let adresse = ecoutes["main"]
            .ecouteur
            .as_ref()
            .unwrap()
            .local_addr()
            .unwrap();
        assert!(adresse.ip().is_loopback() && adresse.ip() == Ipv4Addr::LOCALHOST);
        assert_ne!(adresse.port(), 0);
        assert_eq!(adresse.port(), premiere.port);
        drop(ecoutes);
        // Une deuxième écoute pour la même fenêtre remplace la première, dont l'identifiant ne vaut plus rien.
        let seconde = etat.ouvrir("main").unwrap();
        assert_ne!(premiere.id, seconde.id);
        assert!(etat.prendre("main", &premiere.id).is_err());
        assert!(etat.prendre("main", &seconde.id).is_ok());
        // Déjà attendue : refus ; autre fenêtre : inconnue.
        assert!(etat.prendre("main", &seconde.id).is_err());
        assert!(etat.prendre("autre", &seconde.id).is_err());
        etat.retirer("main", &seconde.id);
        assert!(etat.prendre("main", &seconde.id).is_err());
    }
}
