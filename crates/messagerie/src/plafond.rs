//! Plafond de connexions IMAP simultanées par boîte (consigne de l'architecte du 26/10/2026).
//!
//! Les serveurs limitent le nombre de connexions d'un même utilisateur (Dovecot : dix par défaut, Gmail et Microsoft 365 :
//! quinze environ). Au-delà, ils répondent `NO [UNAVAILABLE]` ou coupent : la boîte paraissait en panne. Le moteur tient
//! donc au plus [`PLAFOND_PAR_DEFAUT`] connexions par boîte (réglable par compte), **quel que soit le nombre de postes,
//! d'utilisateurs ou de comptes qui désignent cette boîte** : la clé est l'identité vue du serveur (hôte, port,
//! utilisateur), pas la ligne de `comptes_mail`. Une boîte partagée et la boîte nominative d'un de ses membres, si elles
//! ont les mêmes identifiants, comptent ensemble.
//!
//! Chaque `Session` IMAP et chaque veille tiennent un [`Permis`] jusqu'à leur fermeture. Une demande au-delà du plafond
//! attend qu'une connexion se ferme, au plus [`ATTENTE_MAX`], puis échoue en `Connexion` (panne transitoire, retentée avec
//! un délai croissant) : elle ne devient jamais un refus d'identifiants.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::ErreurMail;

/// Connexions simultanées par boîte, sauf réglage du compte.
pub const PLAFOND_PAR_DEFAUT: u32 = 5;
/// Attente d'une place avant de renoncer (panne transitoire).
pub const ATTENTE_MAX: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy)]
struct Boite {
    plafond: u32,
    ouvertes: u32,
}

struct Registre {
    boites: Mutex<HashMap<String, Boite>>,
    libere: Condvar,
}

fn registre() -> &'static Registre {
    static REGISTRE: OnceLock<Registre> = OnceLock::new();
    REGISTRE.get_or_init(|| Registre {
        boites: Mutex::new(HashMap::new()),
        libere: Condvar::new(),
    })
}

/// Clé d'une boîte : ce que le serveur voit (hôte, port, utilisateur), en minuscules.
#[must_use]
pub fn cle_boite(hote: &str, port: u16, utilisateur: &str) -> String {
    format!(
        "{}:{port}:{}",
        hote.to_ascii_lowercase(),
        utilisateur.to_ascii_lowercase()
    )
}

/// Règle le plafond d'une boîte (au moins 1). N'ôte jamais une connexion déjà ouverte : un plafond abaissé joue aux
/// ouvertures suivantes.
pub fn regler_plafond(cle: &str, plafond: u32) {
    let registre = registre();
    let mut boites = registre
        .boites
        .lock()
        .unwrap_or_else(|erreur| erreur.into_inner());
    let boite = boites.entry(cle.to_owned()).or_insert(Boite {
        plafond: PLAFOND_PAR_DEFAUT,
        ouvertes: 0,
    });
    boite.plafond = plafond.max(1);
    registre.libere.notify_all();
}

/// Connexions actuellement tenues pour cette boîte (diagnostic et tests).
#[must_use]
pub fn connexions_ouvertes(cle: &str) -> u32 {
    registre()
        .boites
        .lock()
        .unwrap_or_else(|erreur| erreur.into_inner())
        .get(cle)
        .map_or(0, |boite| boite.ouvertes)
}

/// Droit d'ouvrir une connexion sur une boîte ; rendu à la fermeture (`Drop`).
#[derive(Debug)]
pub struct Permis {
    cle: String,
}

impl Drop for Permis {
    fn drop(&mut self) {
        let registre = registre();
        let mut boites = registre
            .boites
            .lock()
            .unwrap_or_else(|erreur| erreur.into_inner());
        if let Some(boite) = boites.get_mut(&self.cle) {
            boite.ouvertes = boite.ouvertes.saturating_sub(1);
        }
        registre.libere.notify_all();
    }
}

/// Prend une place, en attendant au plus `attente` qu'une connexion se ferme.
///
/// # Errors
/// `ErreurMail::Connexion` si le plafond est atteint pendant toute l'attente.
pub fn acquerir_avec_attente(cle: &str, attente: Duration) -> Result<Permis, ErreurMail> {
    let registre = registre();
    let fin = Instant::now() + attente;
    let mut boites = registre
        .boites
        .lock()
        .unwrap_or_else(|erreur| erreur.into_inner());
    loop {
        let boite = boites.entry(cle.to_owned()).or_insert(Boite {
            plafond: PLAFOND_PAR_DEFAUT,
            ouvertes: 0,
        });
        if boite.ouvertes < boite.plafond {
            boite.ouvertes += 1;
            return Ok(Permis {
                cle: cle.to_owned(),
            });
        }
        let maintenant = Instant::now();
        if maintenant >= fin {
            return Err(ErreurMail::Connexion);
        }
        let (suite, _) = registre
            .libere
            .wait_timeout(boites, fin - maintenant)
            .unwrap_or_else(|erreur| erreur.into_inner());
        boites = suite;
    }
}

/// Prend une place avec l'attente par défaut.
///
/// # Errors
/// Voir [`acquerir_avec_attente`].
pub fn acquerir(cle: &str) -> Result<Permis, ErreurMail> {
    acquerir_avec_attente(cle, ATTENTE_MAX)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    /// Une clé par test : le registre est partagé par tout le processus de test.
    fn cle(nom: &str) -> String {
        cle_boite("127.0.0.1", 143, &format!("plafond-{nom}"))
    }

    #[test]
    fn la_cle_est_l_identite_vue_du_serveur() {
        assert_eq!(
            cle_boite("Imap.Example.COM", 993, "Capa"),
            cle_boite("imap.example.com", 993, "capa")
        );
        assert_ne!(cle_boite("h", 993, "a"), cle_boite("h", 143, "a"));
        assert_ne!(cle_boite("h", 993, "a"), cle_boite("h", 993, "b"));
    }

    #[test]
    fn jamais_plus_que_le_plafond_puis_une_place_rendue_sert() {
        let cle = cle("limite");
        regler_plafond(&cle, 3);
        let p1 = acquerir_avec_attente(&cle, Duration::from_millis(50)).expect("1");
        let _p2 = acquerir_avec_attente(&cle, Duration::from_millis(50)).expect("2");
        let _p3 = acquerir_avec_attente(&cle, Duration::from_millis(50)).expect("3");
        assert_eq!(connexions_ouvertes(&cle), 3);
        // Essai négatif : la quatrième n'est pas accordée, et son échec est une panne transitoire.
        assert!(matches!(
            acquerir_avec_attente(&cle, Duration::from_millis(50)),
            Err(ErreurMail::Connexion)
        ));
        assert_eq!(connexions_ouvertes(&cle), 3);
        drop(p1);
        assert_eq!(connexions_ouvertes(&cle), 2);
        assert!(acquerir_avec_attente(&cle, Duration::from_millis(50)).is_ok());
    }

    #[test]
    fn le_defaut_est_cinq() {
        let cle = cle("defaut");
        let permis: Vec<_> = (0..PLAFOND_PAR_DEFAUT)
            .map(|_| acquerir_avec_attente(&cle, Duration::from_millis(20)).expect("place"))
            .collect();
        assert_eq!(permis.len(), 5);
        assert!(acquerir_avec_attente(&cle, Duration::from_millis(20)).is_err());
    }

    #[test]
    fn une_demande_attend_qu_une_connexion_se_ferme() {
        let cle = Arc::new(cle("attente"));
        regler_plafond(&cle, 1);
        let premiere = acquerir_avec_attente(&cle, Duration::from_millis(50)).expect("1");
        let cle2 = Arc::clone(&cle);
        let attente = thread::spawn(move || acquerir_avec_attente(&cle2, Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(100));
        drop(premiere);
        assert!(attente.join().expect("fil").is_ok());
    }

    /// Dix fils concurrents sur une boîte à plafond 5 : jamais plus de cinq places tenues en même temps.
    #[test]
    fn la_concurrence_ne_depasse_jamais_le_plafond() {
        let cle = Arc::new(cle("concurrence"));
        regler_plafond(&cle, 5);
        let maximum = Arc::new(Mutex::new(0_u32));
        let fils: Vec<_> = (0..10)
            .map(|_| {
                let cle = Arc::clone(&cle);
                let maximum = Arc::clone(&maximum);
                thread::spawn(move || {
                    let permis =
                        acquerir_avec_attente(&cle, Duration::from_secs(10)).expect("place");
                    let vues = connexions_ouvertes(&cle);
                    {
                        let mut max = maximum.lock().expect("verrou");
                        *max = (*max).max(vues);
                    }
                    thread::sleep(Duration::from_millis(30));
                    drop(permis);
                })
            })
            .collect();
        for fil in fils {
            fil.join().expect("fil");
        }
        assert!(*maximum.lock().expect("verrou") <= 5);
        assert_eq!(connexions_ouvertes(&cle), 0);
    }

    #[test]
    fn le_plafond_est_reglable_par_boite_et_independant_des_autres() {
        let (a, b) = (cle("reglable-a"), cle("reglable-b"));
        regler_plafond(&a, 1);
        regler_plafond(&b, 2);
        let _a1 = acquerir_avec_attente(&a, Duration::from_millis(20)).expect("a1");
        assert!(acquerir_avec_attente(&a, Duration::from_millis(20)).is_err());
        let _b1 = acquerir_avec_attente(&b, Duration::from_millis(20)).expect("b1");
        let _b2 = acquerir_avec_attente(&b, Duration::from_millis(20)).expect("b2");
        assert!(acquerir_avec_attente(&b, Duration::from_millis(20)).is_err());
        // Un plafond nul est ramené à un.
        let zero = cle("zero");
        regler_plafond(&zero, 0);
        let _z = acquerir_avec_attente(&zero, Duration::from_millis(20)).expect("une place");
        assert!(acquerir_avec_attente(&zero, Duration::from_millis(20)).is_err());
    }
}
