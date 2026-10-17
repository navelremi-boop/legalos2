//! Règle outillée (J11, critère iii) : « supprimer » n'expurge jamais. Les seuls EXPUNGE du code
//! sont ceux de deux fonctions, et chacune n'en émet qu'après avoir mis le message à l'abri :
//!
//! * `deplacer_message` : `UID EXPUNGE` de l'original seul, une fois la copie confirmée à la
//!   destination (serveur sans MOVE) ;
//! * `supprimer_uids` : retrait des anciennes versions d'un brouillon de l'application, après le
//!   dépôt de la nouvelle.
//!
//! Un EXPUNGE ailleurs (autre fonction, autre fichier, crate de l'API) fait échouer ce test.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn fichiers_rust(dossier: &Path, sortie: &mut Vec<PathBuf>) {
    for entree in fs::read_dir(dossier).expect("lecture du dossier") {
        let chemin = entree.expect("entrée").path();
        if chemin.is_dir() {
            fichiers_rust(&chemin, sortie);
        } else if chemin.extension().is_some_and(|e| e == "rs") {
            sortie.push(chemin);
        }
    }
}

/// Nom de la fonction déclarée sur cette ligne, s'il y en a une.
fn fonction_declaree(ligne: &str) -> Option<String> {
    let texte = ligne.trim_start();
    let reste = texte
        .strip_prefix("pub(crate) fn ")
        .or_else(|| texte.strip_prefix("pub fn "))
        .or_else(|| texte.strip_prefix("async fn "))
        .or_else(|| texte.strip_prefix("pub async fn "))
        .or_else(|| texte.strip_prefix("fn "))?;
    let nom: String = reste
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    (!nom.is_empty()).then_some(nom)
}

/// Les (fichier, fonction) qui appellent `expunge(` ou `uid_expunge(`.
fn expunges(racine: &Path) -> BTreeSet<(String, String)> {
    let mut fichiers = Vec::new();
    fichiers_rust(&racine.join("crates/messagerie/src"), &mut fichiers);
    fichiers_rust(&racine.join("crates/api/src"), &mut fichiers);
    let mut trouves = BTreeSet::new();
    for fichier in fichiers {
        let texte = fs::read_to_string(&fichier).expect("lecture du fichier");
        let mut courante = String::from("(hors fonction)");
        for ligne in texte.lines() {
            if let Some(nom) = fonction_declaree(ligne) {
                courante = nom;
            }
            let code = ligne.trim_start();
            if code.starts_with("//") {
                continue;
            }
            if code.contains("expunge(") {
                let relatif = fichier
                    .strip_prefix(racine)
                    .expect("chemin relatif")
                    .to_string_lossy()
                    .replace('\\', "/");
                trouves.insert((relatif, courante.clone()));
            }
        }
    }
    trouves
}

#[test]
fn les_seuls_expunge_sont_apres_copie_confirmee_ou_sur_les_brouillons() {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("racine du dépôt");
    let attendus: BTreeSet<(String, String)> = [
        ("crates/messagerie/src/imap.rs", "deplacer_message"),
        ("crates/messagerie/src/imap.rs", "supprimer_uids"),
    ]
    .into_iter()
    .map(|(fichier, fonction)| (fichier.to_owned(), fonction.to_owned()))
    .collect();
    assert_eq!(
        expunges(racine),
        attendus,
        "EXPUNGE hors des fonctions prévues : supprimer = déplacer vers la Corbeille"
    );
}

#[test]
fn le_detecteur_voit_un_expunge_hors_des_fonctions_prevues() {
    // Essai négatif du test : sur un code qui expurge ailleurs, le détecteur le voit.
    let dossier = std::env::temp_dir().join(format!("legalos-expunge-{}", std::process::id()));
    let src = dossier.join("crates/messagerie/src");
    fs::create_dir_all(&src).expect("dossier");
    fs::create_dir_all(dossier.join("crates/api/src")).expect("dossier");
    fs::write(
        src.join("faux.rs"),
        "pub fn supprimer_tout(&mut self) {\n    // client.expunge()\n    self.client.expunge();\n}\n",
    )
    .expect("fichier");
    let trouves = expunges(&dossier);
    let _ = fs::remove_dir_all(&dossier);
    assert_eq!(
        trouves.into_iter().collect::<Vec<_>>(),
        vec![(
            "crates/messagerie/src/faux.rs".to_owned(),
            "supprimer_tout".to_owned()
        )]
    );
}
