//! Journal d'erreurs du poste (J11, D4, consigne de l'architecte du 24/10/2026).
//!
//! Quand le poste s'arrête ou se fige pendant une recette, il ne laissait aucune trace : le processus avait disparu et la
//! recette attendait sans fin. Ce module écrit, dans le répertoire de données de l'app (`journal-erreurs/`), les trois
//! événements qui expliquent un arrêt :
//!
//! * `panique` : un panic Rust (lieu, fil, message assaini) ;
//! * `erreur_js` et `promesse_rejetee` : une erreur JavaScript non capturée, remontée par l'interface ;
//! * `fin_anormale` : une session dont le processus a disparu sans passer par la sortie normale. Chaque session pose un
//!   marqueur `session-<pid>` qu'un battement rafraîchit toutes les 30 s et que la sortie normale retire ; un marqueur
//!   dont le battement a plus de 90 s est celui d'un processus mort : il est retiré et consigné au démarrage suivant (ou
//!   au battement d'une autre session).
//!
//! Garanties :
//! * **rien de sensible** : tout texte passe par [`assainir`] (adresses, jetons, URL avec requête, valeurs de clés
//!   `password`, `secret`, `token`, `code`, `state`, `Authorization`… masqués, texte borné à 400 caractères) ;
//! * **taille bornée** : trois fichiers de 256 Ko au plus (`poste.log`, `.1`, `.2`), rotation à l'écriture ;
//! * **aucune dépendance de plus**, aucune écriture hors du répertoire de données, aucune erreur d'écriture qui fasse
//!   échouer l'app (un journal qui ne s'écrit pas est ignoré, il ne doit jamais être la cause d'un arrêt).

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::State;

/// Taille au-delà de laquelle le fichier courant passe en `.1`.
const PLAFOND_OCTETS: u64 = 256 * 1024;
/// Nombre de fichiers gardés (courant, `.1`, `.2`).
const FICHIERS: usize = 3;
/// Intervalle du battement d'une session.
pub const BATTEMENT: Duration = Duration::from_secs(30);
/// Âge du battement au-delà duquel une session est tenue pour morte.
const PEREMPTION_SECS: u64 = 90;
/// Longueur maximale d'un détail consigné.
const LONGUEUR_MAX: usize = 400;
const NOM_FICHIER: &str = "poste.log";

/// Mots qui rendent sensible la valeur d'une clé (`password=…`, `token: …`).
const CLES_SENSIBLES: [&str; 14] = [
    "password",
    "passwd",
    "mot_de_passe",
    "motdepasse",
    "secret",
    "token",
    "jeton",
    "code",
    "state",
    "authorization",
    "verifier",
    "refresh",
    "access",
    "cookie",
];

fn est_caractere_de_segment(c: char) -> bool {
    c.is_ascii_alphanumeric()
        || matches!(
            c,
            '@' | '.' | '_' | '~' | ':' | '/' | '?' | '&' | '=' | '%' | '+' | '#' | '-'
        )
}

fn ressemble_a_un_uuid(segment: &str) -> bool {
    let morceaux: Vec<&str> = segment.split('-').collect();
    morceaux.len() == 5
        && morceaux
            .iter()
            .zip([8_usize, 4, 4, 4, 12])
            .all(|(m, n)| m.len() == n && m.chars().all(|c| c.is_ascii_hexdigit()))
}

fn assainir_segment(segment: &str) -> String {
    if let Some(debut) = segment.find("://") {
        // URL : on garde l'adresse sans sa requête ni son fragment.
        if let Some(coupe) = segment[debut..].find(['?', '#']) {
            return format!("{}[requête]", &segment[..debut + coupe]);
        }
        return segment.to_owned();
    }
    if segment.starts_with("eyJ") {
        return "[jeton]".to_owned();
    }
    if let Some(arobase) = segment.find('@') {
        if arobase > 0 && segment[arobase..].contains('.') {
            return "[adresse]".to_owned();
        }
    }
    if let Some((cle, _)) = segment.split_once(['=', ':']) {
        let bas = cle.to_lowercase();
        if CLES_SENSIBLES.iter().any(|mot| bas.contains(mot)) {
            return format!("{cle}=[masqué]");
        }
    }
    let opaque = segment.len() >= 24
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+' | '/' | '='))
        && segment.chars().any(|c| c.is_ascii_digit())
        && segment.chars().any(|c| c.is_ascii_alphabetic())
        && !ressemble_a_un_uuid(segment);
    if opaque {
        return "[secret]".to_owned();
    }
    segment.to_owned()
}

/// Texte sans rien de sensible : adresses, jetons, valeurs de clés sensibles et requêtes d'URL masqués, espaces
/// réduits, longueur bornée. Les lieux de code (`fichier.rs:12:5`) et les identifiants techniques sont gardés.
#[must_use]
pub fn assainir(texte: &str) -> String {
    let mut sortie = String::new();
    let mut segment = String::new();
    let mut masquer_le_mot_suivant = false;
    let mut vider = |segment: &mut String, sortie: &mut String| {
        if segment.is_empty() {
            return;
        }
        let bas = segment.to_lowercase();
        if masquer_le_mot_suivant {
            sortie.push_str("[masqué]");
            masquer_le_mot_suivant = false;
        } else if matches!(
            bas.trim_end_matches(':'),
            "bearer" | "basic" | "authorization"
        ) {
            sortie.push_str(segment);
            masquer_le_mot_suivant = true;
        } else {
            sortie.push_str(&assainir_segment(segment));
        }
        segment.clear();
    };
    for c in texte.chars() {
        if est_caractere_de_segment(c) {
            segment.push(c);
        } else {
            vider(&mut segment, &mut sortie);
            // Espaces, retours de ligne et tabulations : une seule espace.
            if c.is_whitespace() {
                if !sortie.ends_with(' ') && !sortie.is_empty() {
                    sortie.push(' ');
                }
            } else if !c.is_control() {
                sortie.push(c);
            }
        }
    }
    vider(&mut segment, &mut sortie);
    let sortie = sortie.trim().to_owned();
    if sortie.chars().count() > LONGUEUR_MAX {
        let mut coupe: String = sortie.chars().take(LONGUEUR_MAX).collect();
        coupe.push('…');
        coupe
    } else {
        sortie
    }
}

/// Date et heure UTC au format RFC 3339 (`2026-10-24T09:32:31Z`) d'après des secondes depuis l'époque Unix.
#[must_use]
pub fn horodatage(secondes: u64) -> String {
    let jours = i64::try_from(secondes / 86_400).unwrap_or(0);
    let reste = secondes % 86_400;
    // Jour civil à partir du nombre de jours depuis 1970 (algorithme de H. Hinnant).
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let jour_de_l_ere = z.rem_euclid(146_097);
    let annee_de_l_ere = (jour_de_l_ere - jour_de_l_ere / 1_460 + jour_de_l_ere / 36_524
        - jour_de_l_ere / 146_096)
        / 365;
    let jour_de_l_annee =
        jour_de_l_ere - (365 * annee_de_l_ere + annee_de_l_ere / 4 - annee_de_l_ere / 100);
    let mp = (5 * jour_de_l_annee + 2) / 153;
    let jour = jour_de_l_annee - (153 * mp + 2) / 5 + 1;
    let mois = if mp < 10 { mp + 3 } else { mp - 9 };
    let annee = annee_de_l_ere + ere * 400 + i64::from(mois <= 2);
    format!(
        "{annee:04}-{mois:02}-{jour:02}T{:02}:{:02}:{:02}Z",
        reste / 3_600,
        (reste % 3_600) / 60,
        reste % 60
    )
}

fn secondes(instant: SystemTime) -> u64 {
    instant
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Ligne de journal d'un panic : lieu (fichier, ligne, colonne), nom du fil, message assaini.
#[must_use]
pub fn formater_panique(lieu: Option<(&str, u32, u32)>, fil: &str, charge: &str) -> String {
    let ou = lieu.map_or_else(
        || "lieu inconnu".to_owned(),
        |(f, l, c)| format!("{f}:{l}:{c}"),
    );
    format!("à {ou} (fil {}) : {}", assainir(fil), assainir(charge))
}

/// Journal d'erreurs : un répertoire, des fichiers bornés.
#[derive(Debug, Clone)]
pub struct Journal {
    dossier: PathBuf,
    plafond: u64,
}

impl Journal {
    #[must_use]
    pub fn nouveau(dossier: PathBuf) -> Self {
        Self {
            dossier,
            plafond: PLAFOND_OCTETS,
        }
    }

    #[cfg(test)]
    fn avec_plafond(dossier: PathBuf, plafond: u64) -> Self {
        Self { dossier, plafond }
    }

    fn fichier(&self, rang: usize) -> PathBuf {
        if rang == 0 {
            self.dossier.join(NOM_FICHIER)
        } else {
            self.dossier.join(format!("{NOM_FICHIER}.{rang}"))
        }
    }

    /// Fait tourner les fichiers si le courant a atteint le plafond.
    fn tourner_si_besoin(&self) {
        let taille = fs::metadata(self.fichier(0)).map_or(0, |m| m.len());
        if taille < self.plafond {
            return;
        }
        let _ = fs::remove_file(self.fichier(FICHIERS - 1));
        for rang in (0..FICHIERS - 1).rev() {
            let _ = fs::rename(self.fichier(rang), self.fichier(rang + 1));
        }
    }

    /// Consigne un événement. Le détail est assaini ; une erreur d'écriture est ignorée (le journal ne fait jamais
    /// échouer l'app).
    pub fn ecrire(&self, genre: &str, detail: &str) {
        self.ecrire_a(SystemTime::now(), genre, detail);
    }

    fn ecrire_a(&self, maintenant: SystemTime, genre: &str, detail: &str) {
        if fs::create_dir_all(&self.dossier).is_err() {
            return;
        }
        self.tourner_si_besoin();
        let ligne = format!(
            "{} pid={} {} {}\n",
            horodatage(secondes(maintenant)),
            std::process::id(),
            assainir(genre),
            assainir(detail)
        );
        if let Ok(mut fichier) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.fichier(0))
        {
            let _ = fichier.write_all(ligne.as_bytes());
        }
    }

    /// Les `n` dernières lignes consignées, des plus anciennes aux plus récentes. Lue par les tests ; la recette lit les
    /// fichiers du répertoire (`poste.log`, `.1`, `.2`) sans passer par l'app, qui peut avoir disparu.
    #[allow(dead_code)]
    #[must_use]
    pub fn dernieres_lignes(&self, n: usize) -> Vec<String> {
        let mut lignes: Vec<String> = Vec::new();
        for rang in (0..FICHIERS).rev() {
            if let Ok(fichier) = File::open(self.fichier(rang)) {
                lignes.extend(BufReader::new(fichier).lines().map_while(Result::ok));
            }
        }
        let debut = lignes.len().saturating_sub(n);
        lignes.split_off(debut)
    }

    fn marqueur(&self, pid: u32) -> PathBuf {
        self.dossier.join(format!("session-{pid}"))
    }

    /// Marqueurs de session : (pid, début, dernier battement), les illisibles ignorés.
    fn marqueurs(&self) -> Vec<(u32, u64, u64)> {
        let mut trouves = Vec::new();
        let Ok(entrees) = fs::read_dir(&self.dossier) else {
            return trouves;
        };
        for entree in entrees.flatten() {
            let nom = entree.file_name().to_string_lossy().into_owned();
            let Some(pid) = nom
                .strip_prefix("session-")
                .and_then(|p| p.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(contenu) = fs::read_to_string(entree.path()) else {
                continue;
            };
            let mut champs = contenu
                .split_whitespace()
                .filter_map(|c| c.parse::<u64>().ok());
            if let (Some(debut), Some(battement)) = (champs.next(), champs.next()) {
                trouves.push((pid, debut, battement));
            }
        }
        trouves
    }

    fn ecrire_marqueur(&self, pid: u32, debut: u64, battement: u64) {
        if fs::create_dir_all(&self.dossier).is_ok() {
            let _ = fs::write(self.marqueur(pid), format!("{debut} {battement}\n"));
        }
    }

    /// Retire et consigne les sessions mortes (battement plus vieux que 90 s), la nôtre exceptée. Rend leur nombre.
    pub fn consigner_sessions_mortes(&self, maintenant: SystemTime, pid_courant: u32) -> usize {
        let present = secondes(maintenant);
        let mut morts = 0;
        for (pid, debut, battement) in self.marqueurs() {
            if pid == pid_courant || present.saturating_sub(battement) <= PEREMPTION_SECS {
                continue;
            }
            let _ = fs::remove_file(self.marqueur(pid));
            self.ecrire_a(
                maintenant,
                "fin_anormale",
                &format!(
                    "session du pid {pid} démarrée {} sans sortie normale, dernier battement {}",
                    horodatage(debut),
                    horodatage(battement)
                ),
            );
            morts += 1;
        }
        morts
    }

    /// Début de session : consigne les sessions mortes, puis pose le marqueur de celle-ci.
    pub fn demarrer_session(&self) -> usize {
        self.demarrer_session_a(SystemTime::now(), std::process::id())
    }

    fn demarrer_session_a(&self, maintenant: SystemTime, pid: u32) -> usize {
        let morts = self.consigner_sessions_mortes(maintenant, pid);
        let present = secondes(maintenant);
        self.ecrire_marqueur(pid, present, present);
        morts
    }

    /// Battement : rafraîchit notre marqueur et consigne les sessions mortes des autres.
    pub fn battre(&self) {
        self.battre_a(SystemTime::now(), std::process::id());
    }

    fn battre_a(&self, maintenant: SystemTime, pid: u32) {
        self.consigner_sessions_mortes(maintenant, pid);
        let debut = self
            .marqueurs()
            .into_iter()
            .find(|(p, _, _)| *p == pid)
            .map_or_else(|| secondes(maintenant), |(_, d, _)| d);
        self.ecrire_marqueur(pid, debut, secondes(maintenant));
    }

    /// Sortie normale : le marqueur de cette session disparaît (elle ne sera pas tenue pour morte).
    pub fn terminer_session(&self) {
        let _ = fs::remove_file(self.marqueur(std::process::id()));
    }

    /// Journalise les panics de ce processus (le hook précédent est conservé et appelé ensuite).
    pub fn installer_hook_panique(self: &Arc<Self>) {
        let journal = Arc::clone(self);
        let precedent = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let charge = info
                .payload()
                .downcast_ref::<&str>()
                .map(|s| (*s).to_owned())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_default();
            let lieu = info.location().map(|l| (l.file(), l.line(), l.column()));
            let fil = std::thread::current()
                .name()
                .unwrap_or("sans nom")
                .to_owned();
            journal.ecrire("panique", &formater_panique(lieu, &fil, &charge));
            precedent(info);
        }));
    }

    /// Répertoire du journal (tests).
    #[cfg(test)]
    #[must_use]
    fn dossier(&self) -> &std::path::Path {
        &self.dossier
    }
}

/// Erreur JavaScript non capturée, remontée par l'interface (`window.onerror`, `unhandledrejection`). Le genre est
/// borné à deux valeurs ; le message, la source et la ligne sont assainis et bornés comme tout détail.
#[tauri::command]
pub fn journaliser_erreur_js(
    journal: State<'_, Arc<Journal>>,
    genre: String,
    message: String,
    source: Option<String>,
    ligne: Option<u32>,
) {
    let genre = match genre.as_str() {
        "promesse_rejetee" => "promesse_rejetee",
        _ => "erreur_js",
    };
    let lieu = source.map_or_else(String::new, |s| {
        format!(
            " ({}{})",
            assainir(&s),
            ligne.map_or_else(String::new, |l| format!(":{l}"))
        )
    });
    journal.ecrire(genre, &format!("{message}{lieu}"));
}

/// Démarre la session du journal et son battement ; à appeler une fois au lancement de l'app.
pub fn demarrer(journal: &Arc<Journal>) {
    journal.demarrer_session();
    journal.ecrire(
        "demarrage",
        &format!("poste lancé, version {}", env!("CARGO_PKG_VERSION")),
    );
    journal.installer_hook_panique();
    let battement = Arc::clone(journal);
    std::thread::spawn(move || loop {
        std::thread::sleep(BATTEMENT);
        battement.battre();
    });
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn dossier_jetable(nom: &str) -> PathBuf {
        let dossier =
            std::env::temp_dir().join(format!("legalos-journal-{nom}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dossier);
        dossier
    }

    fn instant(secondes: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secondes)
    }

    #[test]
    fn journal_erreurs_assainit_ce_qui_est_sensible() {
        let brut = "échec pour jean.dupont@cabinet-fictif.example avec Authorization: Bearer abcdef0123456789abcdef0123456789 \
                    puis password=Mot2Passe!Fictif et token: eyJhbGciOiJSUzI1NiJ9.charge.signature sur \
                    https://instance.example/api/oauth/echange?code=SECRET123&state=ETAT456#fragment, \
                    clé opaque ABCDEFGHIJKLMNOPQRSTUVWX0123456789 et uuid 01a16cf2-5328-73df-8411-b1da99e29932";
        let propre = assainir(brut);
        for interdit in [
            "jean.dupont",
            "cabinet-fictif.example",
            "abcdef0123456789abcdef0123456789",
            "Mot2Passe",
            "eyJhbGci",
            "SECRET123",
            "ETAT456",
            "fragment",
            "ABCDEFGHIJKLMNOPQRSTUVWX0123456789",
        ] {
            assert!(
                !propre.contains(interdit),
                "« {interdit} » encore présent : {propre}"
            );
        }
        // Ce qui aide à comprendre reste : lieu de l'adresse (sans sa requête), identifiant technique, texte courant.
        assert!(
            propre.contains("https://instance.example/api/oauth/echange[requête]"),
            "{propre}"
        );
        assert!(
            propre.contains("01a16cf2-5328-73df-8411-b1da99e29932"),
            "{propre}"
        );
        assert!(propre.contains("échec pour"), "{propre}");
        assert!(
            propre.contains("[adresse]")
                && propre.contains("[masqué]")
                && propre.contains("[jeton]")
        );
    }

    #[test]
    fn journal_erreurs_garde_les_lieux_de_code_et_borne_la_longueur() {
        let propre = assainir(
            "TypeError: x is undefined\n   at apps/poste/src/messagerie/EcranMails.tsx:512:17",
        );
        assert_eq!(
            propre,
            "TypeError: x is undefined at apps/poste/src/messagerie/EcranMails.tsx:512:17"
        );
        let long = "mot ".repeat(500);
        let borne = assainir(&long);
        assert!(
            borne.chars().count() <= LONGUEUR_MAX + 1,
            "{}",
            borne.chars().count()
        );
        assert!(borne.ends_with('…'));
        // Essai négatif : un texte court n'est ni coupé ni marqué.
        assert!(!assainir("court").ends_with('…'));
    }

    #[test]
    fn journal_erreurs_formate_une_panique_sans_contenu_sensible() {
        let ligne = formater_panique(
            Some(("src/lib.rs", 12, 5)),
            "main",
            "échec de lecture pour a.b@exemple.test token=XYZ987",
        );
        assert!(
            ligne.starts_with("à src/lib.rs:12:5 (fil main) : "),
            "{ligne}"
        );
        assert!(
            !ligne.contains("a.b@exemple") && !ligne.contains("XYZ987"),
            "{ligne}"
        );
        assert!(formater_panique(None, "t", "m").contains("lieu inconnu"));
    }

    #[test]
    fn journal_erreurs_horodatage_rfc3339() {
        assert_eq!(horodatage(0), "1970-01-01T00:00:00Z");
        assert_eq!(horodatage(1_761_298_351), "2025-10-24T09:32:31Z");
        // 29 février d'une année bissextile, et premier jour d'une année.
        assert_eq!(horodatage(1_709_210_096), "2024-02-29T12:34:56Z");
        assert_eq!(horodatage(1_798_761_600), "2027-01-01T00:00:00Z");
    }

    #[test]
    fn journal_erreurs_ecrit_et_relit_les_dernieres_lignes() {
        let journal = Journal::nouveau(dossier_jetable("lignes"));
        for i in 0..10 {
            journal.ecrire_a(
                instant(1_761_298_351 + i),
                "erreur_js",
                &format!("ligne numéro {i}"),
            );
        }
        let trois = journal.dernieres_lignes(3);
        assert_eq!(trois.len(), 3);
        assert!(
            trois[0].contains("ligne numéro 7") && trois[2].contains("ligne numéro 9"),
            "{trois:?}"
        );
        assert!(
            trois[2].contains("erreur_js")
                && trois[2].contains(&format!("pid={}", std::process::id()))
        );
        assert_eq!(
            journal.dernieres_lignes(100).len(),
            10,
            "pas plus que ce qui est écrit"
        );
        // Essai négatif : un journal absent rend une liste vide, sans erreur.
        assert!(Journal::nouveau(dossier_jetable("absent"))
            .dernieres_lignes(5)
            .is_empty());
        let _ = fs::remove_dir_all(journal.dossier());
    }

    #[test]
    fn journal_erreurs_rotation_borne_la_taille_et_garde_le_plus_recent() {
        let journal = Journal::avec_plafond(dossier_jetable("rotation"), 600);
        for i in 0..200 {
            journal.ecrire_a(
                instant(1_761_298_351 + i),
                "erreur_js",
                &format!("événement {i:03}"),
            );
        }
        let fichiers: Vec<String> = fs::read_dir(journal.dossier())
            .expect("dossier")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(NOM_FICHIER))
            .collect();
        assert!(
            fichiers.len() <= FICHIERS,
            "trop de fichiers : {fichiers:?}"
        );
        let total: u64 = fichiers
            .iter()
            .map(|n| fs::metadata(journal.dossier().join(n)).map_or(0, |m| m.len()))
            .sum();
        assert!(
            total <= 600 * FICHIERS as u64 + 200,
            "taille non bornée : {total} octets"
        );
        let dernieres = journal.dernieres_lignes(1);
        assert!(
            dernieres[0].contains("événement 199"),
            "le plus récent est conservé : {dernieres:?}"
        );
        // Essai négatif : les premiers événements ont été évincés par la rotation.
        let tout = journal.dernieres_lignes(10_000).join("\n");
        assert!(!tout.contains("événement 000"), "rien ne borne le journal");
        let _ = fs::remove_dir_all(journal.dossier());
    }

    #[test]
    fn journal_erreurs_une_sortie_normale_n_est_pas_une_fin_anormale() {
        let journal = Journal::nouveau(dossier_jetable("normale"));
        assert_eq!(journal.demarrer_session_a(instant(1_000), 111), 0);
        // La session 111 sort normalement (marqueur retiré à la main : `terminer_session` vise le pid courant).
        fs::remove_file(journal.marqueur(111)).expect("marqueur");
        assert_eq!(
            journal.demarrer_session_a(instant(5_000), 222),
            0,
            "aucune session morte à consigner"
        );
        assert!(journal
            .dernieres_lignes(10)
            .iter()
            .all(|l| !l.contains("fin_anormale")));
        let _ = fs::remove_dir_all(journal.dossier());
    }

    #[test]
    fn journal_erreurs_une_session_disparue_est_consignee_une_seule_fois() {
        let journal = Journal::nouveau(dossier_jetable("disparue"));
        journal.demarrer_session_a(instant(1_000), 111);
        // Le processus 111 disparaît (plus de battement) ; 500 s plus tard le suivant démarre.
        assert_eq!(journal.demarrer_session_a(instant(1_500), 222), 1);
        let lignes = journal.dernieres_lignes(10);
        assert!(
            lignes
                .iter()
                .any(|l| l.contains("fin_anormale") && l.contains("pid 111")),
            "{lignes:?}"
        );
        assert!(
            !journal.marqueur(111).exists(),
            "le marqueur d'une session morte est retiré"
        );
        // Une seule fois : le démarrage suivant ne la redécouvre pas (222 a battu entre-temps, elle est vivante).
        journal.battre_a(instant(1_560), 222);
        assert_eq!(journal.demarrer_session_a(instant(1_600), 333), 0);
        assert_eq!(
            journal
                .dernieres_lignes(50)
                .iter()
                .filter(|l| l.contains("fin_anormale"))
                .count(),
            1
        );
        let _ = fs::remove_dir_all(journal.dossier());
    }

    #[test]
    fn journal_erreurs_une_session_vivante_n_est_pas_tenue_pour_morte() {
        let journal = Journal::nouveau(dossier_jetable("vivante"));
        journal.demarrer_session_a(instant(1_000), 111);
        // 111 bat toutes les 30 s ; 222 démarre à 1 040 s : 111 est vivante (battement de 20 s).
        journal.battre_a(instant(1_020), 111);
        assert_eq!(journal.demarrer_session_a(instant(1_040), 222), 0);
        assert!(journal.marqueur(111).exists());
        // Essai négatif : sans battement, 100 s plus tard elle est tenue pour morte.
        assert_eq!(journal.demarrer_session_a(instant(1_130), 333), 1);
        // Le battement garde le début de session.
        journal.battre_a(instant(1_150), 333);
        let marqueurs = journal.marqueurs();
        let (_, debut, battement) = marqueurs
            .iter()
            .find(|(p, _, _)| *p == 333)
            .copied()
            .expect("marqueur 333");
        assert_eq!((debut, battement), (1_130, 1_150));
        let _ = fs::remove_dir_all(journal.dossier());
    }
}
