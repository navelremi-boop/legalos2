//! Référence de dossier personnalisable (arbitrage R0, `docs/hypotheses-dossiers.md`).
//!
//! Jetons : `{AAAA}`, `{AA}`, `{N}`, `{N:k}`, `{INI}`. Tout autre caractère est du texte libre,
//! « / » compris. La référence est stockée, affichée et recherchée telle que produite ; les formes
//! normalisées ne servent qu'à l'adresse de classement et aux noms de fichiers de l'export.
//!
//! Les cas de `tests/reference-vecteurs.json` sont partagés avec le poste.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

/// Modèle appliqué avant l'arbitrage R0 (`2026-042`).
pub const MODELE_PAR_DEFAUT: &str = "{AAAA}-{N:3}";

const LONGUEUR_MAX: usize = 40;
const INITIALES_MAX: usize = 4;
const CHIFFRES_NUMERO_MAX: usize = 18;
const NOMS_RESERVES_WINDOWS: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Politique de remise à zéro du numéro (R0-d).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemiseAZero {
    /// Numéro remis à 1 au 1er janvier, heure de Paris (cahier § 3.4).
    Annuelle,
    /// Numéro continu d'une année sur l'autre.
    Jamais,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Bloc {
    Texte(String),
    /// `{AAAA}` (4 chiffres) ou `{AA}` (2 chiffres).
    Annee {
        chiffres: u8,
    },
    /// `{N}` sans complément, ou `{N:k}` complété à k chiffres sans troncature.
    Numero {
        chiffres: Option<u8>,
    },
    Initiales,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ErreurModele {
    #[error("Le modèle est vide.")]
    Vide,
    #[error("Le modèle dépasse 40 caractères.")]
    TropLong,
    #[error("Le modèle contient un caractère de contrôle.")]
    CaractereControle,
    #[error("Accolade non fermée dans le modèle.")]
    AccoladeNonFermee,
    #[error("Accolade fermante sans accolade ouvrante.")]
    AccoladeIsolee,
    #[error("Jeton inconnu : {{{0}}}.")]
    JetonInconnu(String),
    #[error("Le numéro compte de 1 à 9 chiffres.")]
    ChiffresHorsBornes,
    #[error("Le modèle doit contenir le numéro : {{N}} ou {{N:k}}.")]
    SansNumero,
    #[error("Le modèle ne peut contenir qu'un seul numéro.")]
    PlusieursNumeros,
    #[error(
        "Avec la remise à zéro annuelle, le modèle doit contenir l'année : {{AAAA}} ou {{AA}}."
    )]
    SansAnnee,
}

impl ErreurModele {
    /// Code stable, partagé avec le poste.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Vide => "vide",
            Self::TropLong => "trop_long",
            Self::CaractereControle => "caractere_controle",
            Self::AccoladeNonFermee => "accolade_non_fermee",
            Self::AccoladeIsolee => "accolade_isolee",
            Self::JetonInconnu(_) => "jeton_inconnu",
            Self::ChiffresHorsBornes => "chiffres_hors_bornes",
            Self::SansNumero => "sans_numero",
            Self::PlusieursNumeros => "plusieurs_numeros",
            Self::SansAnnee => "sans_annee",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeleReference {
    blocs: Vec<Bloc>,
}

impl ModeleReference {
    /// Analyse un modèle texte ; les espaces de tête et de fin sont retirés.
    pub fn analyser(texte: &str) -> Result<Self, ErreurModele> {
        let texte = texte.trim();
        if texte.is_empty() {
            return Err(ErreurModele::Vide);
        }
        if texte.chars().count() > LONGUEUR_MAX {
            return Err(ErreurModele::TropLong);
        }
        if texte.chars().any(char::is_control) {
            return Err(ErreurModele::CaractereControle);
        }
        let mut blocs = Vec::new();
        let mut libre = String::new();
        let mut reste = texte;
        while let Some(c) = reste.chars().next() {
            match c {
                '{' => {
                    let fin = reste.find('}').ok_or(ErreurModele::AccoladeNonFermee)?;
                    let jeton = &reste[1..fin];
                    if jeton.contains('{') {
                        return Err(ErreurModele::AccoladeNonFermee);
                    }
                    let bloc = bloc_du_jeton(jeton)?;
                    if !libre.is_empty() {
                        blocs.push(Bloc::Texte(std::mem::take(&mut libre)));
                    }
                    blocs.push(bloc);
                    reste = &reste[fin + 1..];
                }
                '}' => return Err(ErreurModele::AccoladeIsolee),
                _ => {
                    libre.push(c);
                    reste = &reste[c.len_utf8()..];
                }
            }
        }
        if !libre.is_empty() {
            blocs.push(Bloc::Texte(libre));
        }
        match blocs
            .iter()
            .filter(|b| matches!(b, Bloc::Numero { .. }))
            .count()
        {
            0 => Err(ErreurModele::SansNumero),
            1 => Ok(Self { blocs }),
            _ => Err(ErreurModele::PlusieursNumeros),
        }
    }

    /// Analyse le modèle et le vérifie au regard de la politique de remise à zéro.
    pub fn analyser_pour(texte: &str, remise: RemiseAZero) -> Result<Self, ErreurModele> {
        let modele = Self::analyser(texte)?;
        modele.verifier_politique(remise)?;
        Ok(modele)
    }

    /// Avec la remise à zéro annuelle, l'année est obligatoire : sinon deux années produiraient
    /// la même référence.
    pub fn verifier_politique(&self, remise: RemiseAZero) -> Result<(), ErreurModele> {
        let a_annee = self.blocs.iter().any(|b| matches!(b, Bloc::Annee { .. }));
        if remise == RemiseAZero::Annuelle && !a_annee {
            return Err(ErreurModele::SansAnnee);
        }
        Ok(())
    }

    pub fn blocs(&self) -> &[Bloc] {
        &self.blocs
    }

    /// Texte canonique du modèle.
    pub fn texte(&self) -> String {
        let mut sortie = String::new();
        for bloc in &self.blocs {
            match bloc {
                Bloc::Texte(t) => sortie.push_str(t),
                Bloc::Annee { chiffres: 4 } => sortie.push_str("{AAAA}"),
                Bloc::Annee { .. } => sortie.push_str("{AA}"),
                Bloc::Numero { chiffres: None } => sortie.push_str("{N}"),
                Bloc::Numero { chiffres: Some(k) } => {
                    let _ = write!(sortie, "{{N:{k}}}");
                }
                Bloc::Initiales => sortie.push_str("{INI}"),
            }
        }
        sortie
    }

    /// Référence produite pour une année civile, un numéro (≥ 1) et des initiales normalisées.
    pub fn produire(&self, annee: i32, numero: u64, initiales: &str) -> String {
        let mut sortie = String::new();
        for bloc in &self.blocs {
            match bloc {
                Bloc::Texte(t) => sortie.push_str(t),
                Bloc::Annee { chiffres: 4 } => {
                    let _ = write!(sortie, "{annee:04}");
                }
                Bloc::Annee { .. } => {
                    let _ = write!(sortie, "{:02}", annee.rem_euclid(100));
                }
                Bloc::Numero { chiffres: None } => {
                    let _ = write!(sortie, "{numero}");
                }
                Bloc::Numero { chiffres: Some(k) } => {
                    let _ = write!(sortie, "{numero:0largeur$}", largeur = usize::from(*k));
                }
                Bloc::Initiales => sortie.push_str(initiales),
            }
        }
        sortie
    }

    /// Vrai si ce modèle, avec cette politique, pourrait attribuer à un dossier créé à partir de
    /// maintenant `reference` ou une référence de même forme de classement (sans casse) : l'adresse
    /// de classement doit désigner un seul dossier.
    ///
    /// `prochain` est le numéro que recevra le prochain dossier de la période en cours (l'année
    /// civile `annee_courante` avec `Annuelle`, toute la vie du cabinet avec `Jamais`).
    pub fn pourrait_redonner(
        &self,
        remise: RemiseAZero,
        annee_courante: i32,
        prochain: u64,
        reference: &str,
    ) -> bool {
        self.lectures(reference)
            .into_iter()
            .any(|lecture| match (remise, lecture.annee) {
                (_, None) => lecture.numero >= prochain,
                (RemiseAZero::Annuelle, Some(annee)) => {
                    annee > annee_courante
                        || (annee == annee_courante && lecture.numero >= prochain)
                }
                (RemiseAZero::Jamais, Some(annee)) => {
                    annee >= annee_courante && lecture.numero >= prochain
                }
            })
    }

    /// Couples (année, numéro) sous lesquels ce modèle produirait une référence de même forme de
    /// classement que `reference`.
    fn lectures(&self, reference: &str) -> Vec<Lecture> {
        let cible: Vec<char> = forme_classement(reference)
            .to_ascii_uppercase()
            .chars()
            .collect();
        let mut lectures = Vec::new();
        lire(&self.blocs, &cible, 0, Etat::default(), &mut lectures);
        lectures
    }
}

fn bloc_du_jeton(jeton: &str) -> Result<Bloc, ErreurModele> {
    match jeton {
        "AAAA" => Ok(Bloc::Annee { chiffres: 4 }),
        "AA" => Ok(Bloc::Annee { chiffres: 2 }),
        "N" => Ok(Bloc::Numero { chiffres: None }),
        "INI" => Ok(Bloc::Initiales),
        _ => {
            let chiffres = jeton
                .strip_prefix("N:")
                .filter(|k| !k.is_empty() && k.chars().all(|c| c.is_ascii_digit()))
                .ok_or_else(|| ErreurModele::JetonInconnu(jeton.to_owned()))?;
            match chiffres.parse::<u8>() {
                Ok(k @ 1..=9) => Ok(Bloc::Numero { chiffres: Some(k) }),
                _ => Err(ErreurModele::ChiffresHorsBornes),
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Lecture {
    annee: Option<i32>,
    numero: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct Etat {
    annee: Option<i32>,
    numero: Option<u64>,
    /// Position et longueur des initiales déjà lues : plusieurs `{INI}` portent les mêmes.
    initiales: Option<(usize, usize)>,
}

fn lire(blocs: &[Bloc], cible: &[char], pos: usize, etat: Etat, lectures: &mut Vec<Lecture>) {
    let Some((bloc, suite)) = blocs.split_first() else {
        if let (true, Some(numero)) = (pos == cible.len(), etat.numero) {
            lectures.push(Lecture {
                annee: etat.annee,
                numero,
            });
        }
        return;
    };
    let reste = cible.get(pos..).unwrap_or_default();
    match bloc {
        Bloc::Texte(texte) => {
            let attendu: Vec<char> = forme_classement(texte)
                .to_ascii_uppercase()
                .chars()
                .collect();
            if reste.starts_with(&attendu) {
                lire(suite, cible, pos + attendu.len(), etat, lectures);
            }
        }
        Bloc::Annee { chiffres } => {
            let largeur = usize::from(*chiffres);
            let Some(valeur) = reste.get(..largeur).and_then(valeur_decimale) else {
                return;
            };
            let Ok(valeur) = i32::try_from(valeur) else {
                return;
            };
            let annee = if largeur == 4 { valeur } else { 2000 + valeur };
            if etat.annee.is_some_and(|a| a != annee) {
                return;
            }
            let etat = Etat {
                annee: Some(annee),
                ..etat
            };
            lire(suite, cible, pos + largeur, etat, lectures);
        }
        Bloc::Numero { chiffres } => {
            let disponibles = reste
                .iter()
                .take_while(|c| c.is_ascii_digit())
                .count()
                .min(CHIFFRES_NUMERO_MAX);
            for longueur in 1..=disponibles {
                let chiffres_lus = &reste[..longueur];
                let commence_par_zero = chiffres_lus.first() == Some(&'0');
                let produit = match chiffres {
                    None => !commence_par_zero,
                    Some(k) => {
                        let k = usize::from(*k);
                        longueur == k || (longueur > k && !commence_par_zero)
                    }
                };
                let Some(numero) = valeur_decimale(chiffres_lus).filter(|n| *n >= 1) else {
                    continue;
                };
                if produit {
                    let etat = Etat {
                        numero: Some(numero),
                        ..etat
                    };
                    lire(suite, cible, pos + longueur, etat, lectures);
                }
            }
        }
        Bloc::Initiales => {
            if let Some((debut, longueur)) = etat.initiales {
                let deja = &cible[debut..debut + longueur];
                if reste.starts_with(deja) {
                    lire(suite, cible, pos + longueur, etat, lectures);
                }
                return;
            }
            let lettres = reste
                .iter()
                .take_while(|c| c.is_ascii_uppercase())
                .count()
                .min(INITIALES_MAX);
            for longueur in 1..=lettres {
                let etat = Etat {
                    initiales: Some((pos, longueur)),
                    ..etat
                };
                lire(suite, cible, pos + longueur, etat, lectures);
            }
        }
    }
}

fn valeur_decimale(chiffres: &[char]) -> Option<u64> {
    chiffres.iter().try_fold(0_u64, |acc, c| {
        let chiffre = c.to_digit(10)?;
        acc.checked_mul(10)?.checked_add(u64::from(chiffre))
    })
}

/// Forme de la référence dans l'adresse de classement : tout caractère autre qu'une lettre ou un
/// chiffre ASCII, « - » ou « _ » devient « - » (« / » compris).
pub fn forme_classement(reference: &str) -> String {
    reference
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Forme de la référence dans les noms de fichiers et de dossiers de l'export : caractères interdits
/// par Windows (`/ \ : * ? " < > |`) et caractères de contrôle remplacés par « - » ; un point ou une
/// espace final devient « - » ; un nom réservé de Windows (CON, NUL, COM1…) est suivi de « - ».
pub fn forme_export(reference: &str) -> String {
    let mut sortie: String = reference
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    if sortie.ends_with('.') || sortie.ends_with(' ') {
        sortie.pop();
        sortie.push('-');
    }
    let fin_base = sortie.find('.').unwrap_or(sortie.len());
    let base = sortie[..fin_base].to_ascii_uppercase();
    if NOMS_RESERVES_WINDOWS.contains(&base.as_str()) {
        sortie.insert(fin_base, '-');
    }
    sortie
}

/// Vrai si `texte` (objet d'un mail, adresse de classement…) cite la référence sous sa forme
/// d'origine ou sous sa forme de classement, sans casse, entre deux caractères qui ne sont ni des
/// lettres ni des chiffres.
pub fn reference_citee(reference: &str, texte: &str) -> bool {
    let texte: Vec<char> = texte.chars().collect();
    [reference.to_owned(), forme_classement(reference)]
        .iter()
        .any(|forme| {
            let forme: Vec<char> = forme.chars().collect();
            !forme.is_empty() && contient_borne(&texte, &forme)
        })
}

fn contient_borne(texte: &[char], forme: &[char]) -> bool {
    if forme.len() > texte.len() {
        return false;
    }
    (0..=texte.len() - forme.len()).any(|debut| {
        let fin = debut + forme.len();
        let egal = texte[debut..fin]
            .iter()
            .zip(forme)
            .all(|(a, b)| a.eq_ignore_ascii_case(b));
        let borne_avant = debut == 0 || !texte[debut - 1].is_alphanumeric();
        let borne_apres = fin == texte.len() || !texte[fin].is_alphanumeric();
        egal && borne_avant && borne_apres
    })
}

/// Initiales (1 à 4 lettres majuscules sans accent) tirées d'un nom ou d'une adresse : première
/// lettre de chaque segment de la partie locale, séparés par « . », « - », « _ », « + » ou une
/// espace. `X` si aucune lettre.
pub fn initiales_depuis(texte: &str) -> String {
    let locale = texte.split('@').next().unwrap_or_default();
    let initiales: String = locale
        .split(|c: char| matches!(c, '.' | '-' | '_' | '+') || c.is_whitespace())
        .filter_map(|segment| segment.chars().find_map(lettre_sans_accent))
        .take(INITIALES_MAX)
        .collect();
    if initiales.is_empty() {
        "X".to_owned()
    } else {
        initiales
    }
}

/// Initiales acceptées par le modèle : 1 à 4 lettres majuscules ASCII.
pub fn initiales_valides(initiales: &str) -> bool {
    (1..=INITIALES_MAX).contains(&initiales.chars().count())
        && initiales.chars().all(|c| c.is_ascii_uppercase())
}

fn lettre_sans_accent(c: char) -> Option<char> {
    let lettre = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'æ' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'Æ' => {
            'A'
        }
        'ç' | 'Ç' => 'C',
        'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'E',
        'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
        'ñ' | 'Ñ' => 'N',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'œ' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Œ' => 'O',
        'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
        'ý' | 'ÿ' | 'Ý' | 'Ÿ' => 'Y',
        c if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
        _ => return None,
    };
    Some(lettre)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct Vecteurs {
        modeles: Vec<CasModele>,
        invalides: Vec<CasInvalide>,
        normalisations: Vec<CasNormalisation>,
        citations: Vec<CasCitation>,
        collisions: Vec<CasCollision>,
        initiales: Vec<CasInitiales>,
    }

    #[derive(Deserialize)]
    struct CasModele {
        modele: String,
        remise: RemiseAZero,
        texte: String,
        exemples: Vec<Exemple>,
    }

    #[derive(Deserialize)]
    struct Exemple {
        annee: i32,
        numero: u64,
        initiales: String,
        reference: String,
    }

    #[derive(Deserialize)]
    struct CasInvalide {
        modele: String,
        remise: RemiseAZero,
        erreur: String,
    }

    #[derive(Deserialize)]
    struct CasNormalisation {
        reference: String,
        classement: String,
        export: String,
    }

    #[derive(Deserialize)]
    struct CasCitation {
        reference: String,
        texte: String,
        citee: bool,
    }

    #[derive(Deserialize)]
    struct CasCollision {
        modele: String,
        remise: RemiseAZero,
        annee: i32,
        prochain: u64,
        reference: String,
        redonnee: bool,
    }

    #[derive(Deserialize)]
    struct CasInitiales {
        source: String,
        initiales: String,
    }

    fn vecteurs() -> Result<Vecteurs, String> {
        serde_json::from_str(include_str!("../tests/reference-vecteurs.json"))
            .map_err(|e| format!("vecteurs illisibles : {e}"))
    }

    #[test]
    fn reference_modeles_valides_et_production() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        assert!(vecteurs.modeles.len() >= 4);
        for cas in vecteurs.modeles {
            let modele = ModeleReference::analyser_pour(&cas.modele, cas.remise)
                .map_err(|e| format!("{} : {e}", cas.modele))?;
            assert_eq!(
                modele.texte(),
                cas.texte,
                "texte canonique de {}",
                cas.modele
            );
            assert!(!cas.exemples.is_empty(), "{} sans exemple", cas.modele);
            for exemple in cas.exemples {
                assert_eq!(
                    modele.produire(exemple.annee, exemple.numero, &exemple.initiales),
                    exemple.reference,
                    "{} pour {} n° {}",
                    cas.modele,
                    exemple.annee,
                    exemple.numero
                );
            }
        }
        Ok(())
    }

    #[test]
    fn reference_modeles_invalides_refuses() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        assert!(!vecteurs.invalides.is_empty());
        for cas in vecteurs.invalides {
            match ModeleReference::analyser_pour(&cas.modele, cas.remise) {
                Ok(_) => return Err(format!("modèle accepté à tort : {:?}", cas.modele)),
                Err(e) => assert_eq!(e.code(), cas.erreur, "modèle {:?}", cas.modele),
            }
        }
        Ok(())
    }

    #[test]
    fn reference_formes_normalisees() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        assert!(!vecteurs.normalisations.is_empty());
        for cas in vecteurs.normalisations {
            assert_eq!(
                forme_classement(&cas.reference),
                cas.classement,
                "classement de {}",
                cas.reference
            );
            assert_eq!(
                forme_export(&cas.reference),
                cas.export,
                "export de {}",
                cas.reference
            );
        }
        Ok(())
    }

    #[test]
    fn reference_reconnue_sous_ses_deux_formes() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        assert!(vecteurs.citations.iter().any(|c| c.citee));
        assert!(vecteurs.citations.iter().any(|c| !c.citee));
        for cas in vecteurs.citations {
            assert_eq!(
                reference_citee(&cas.reference, &cas.texte),
                cas.citee,
                "{} dans {:?}",
                cas.reference,
                cas.texte
            );
        }
        Ok(())
    }

    #[test]
    fn reference_existante_jamais_redonnee() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        assert!(vecteurs.collisions.iter().any(|c| c.redonnee));
        assert!(vecteurs.collisions.iter().any(|c| !c.redonnee));
        for cas in vecteurs.collisions {
            let modele = ModeleReference::analyser_pour(&cas.modele, cas.remise)
                .map_err(|e| format!("{} : {e}", cas.modele))?;
            assert_eq!(
                modele.pourrait_redonner(cas.remise, cas.annee, cas.prochain, &cas.reference),
                cas.redonnee,
                "{} ({:?}, {} n° {}) face à {}",
                cas.modele,
                cas.remise,
                cas.annee,
                cas.prochain,
                cas.reference
            );
        }
        Ok(())
    }

    #[test]
    fn reference_initiales_du_createur() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        for cas in vecteurs.initiales {
            let initiales = initiales_depuis(&cas.source);
            assert_eq!(initiales, cas.initiales, "initiales de {}", cas.source);
            assert!(initiales_valides(&initiales));
        }
        assert!(!initiales_valides(""));
        assert!(!initiales_valides("ABCDE"));
        assert!(!initiales_valides("md"));
        Ok(())
    }

    #[test]
    fn reference_production_relue_par_son_modele() -> Result<(), String> {
        let vecteurs = vecteurs()?;
        for cas in vecteurs.modeles {
            let modele = ModeleReference::analyser_pour(&cas.modele, cas.remise)
                .map_err(|e| format!("{} : {e}", cas.modele))?;
            for exemple in cas.exemples {
                let reference = modele.produire(exemple.annee, exemple.numero, &exemple.initiales);
                assert!(
                    modele.pourrait_redonner(cas.remise, exemple.annee, exemple.numero, &reference),
                    "{reference} doit être reconnue par {}",
                    cas.modele
                );
                assert!(
                    !modele.pourrait_redonner(
                        cas.remise,
                        exemple.annee,
                        exemple.numero + 1,
                        &reference
                    ),
                    "{reference} ne peut plus être produite après le n° {}",
                    exemple.numero
                );
            }
        }
        Ok(())
    }
}
