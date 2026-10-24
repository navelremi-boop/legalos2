//! Consigne de l'architecte du 24/10/2026 (D10) : aucun `Message-ID` dans les journaux. L'en-tête porte le domaine de
//! l'expéditeur ; un journal ne garde que des identifiants techniques internes (règle `00-mission` : « jamais de contenu
//! de mail, de document, de note, ni de donnée personnelle »). Ce test lit chaque invocation `tracing::…!(…)` des
//! sources de l'API et de la messagerie, et refuse toute mention d'un `Message-ID` : le champ `message_id`, la variable
//! qui le porte, ou l'en-tête lui-même. Le contrôle sur les journaux réels d'une instance est dans
//! `tests/recette/j11-invitation.mjs` (le refus d'une invitation est journalisé, et son `Message-ID` n'y figure pas).
//!
//! Règle vérifiable = règle outillée : ce test échoue sur toute nouvelle mention, et prouve qu'il sait la voir.
#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

fn fichiers_rust(dossier: &Path, sortie: &mut Vec<PathBuf>) {
    for entree in fs::read_dir(dossier).expect("dossier") {
        let chemin = entree.expect("entrée").path();
        if chemin.is_dir() {
            fichiers_rust(&chemin, sortie);
        } else if chemin.extension().is_some_and(|e| e == "rs") {
            sortie.push(chemin);
        }
    }
}

const MACROS: [&str; 5] = [
    "tracing::warn!(",
    "tracing::info!(",
    "tracing::error!(",
    "tracing::debug!(",
    "tracing::trace!(",
];

/// Texte de chaque invocation de macro de journalisation (jusqu'à la parenthèse fermante), avec son numéro de ligne.
fn invocations(source: &str) -> Vec<(usize, String)> {
    let mut trouvees = Vec::new();
    for macro_ in MACROS {
        let mut depart = 0;
        while let Some(i) = source[depart..].find(macro_) {
            let debut = depart + i;
            let corps_debut = debut + macro_.len();
            let mut profondeur = 1_i32;
            let mut fin = corps_debut;
            for (decalage, c) in source[corps_debut..].char_indices() {
                match c {
                    '(' => profondeur += 1,
                    ')' => profondeur -= 1,
                    _ => {}
                }
                if profondeur == 0 {
                    fin = corps_debut + decalage;
                    break;
                }
            }
            let ligne = source[..debut].matches('\n').count() + 1;
            trouvees.push((ligne, source[debut..fin].to_owned()));
            depart = corps_debut;
        }
    }
    trouvees
}

fn mentionne_message_id(invocation: &str) -> bool {
    let minuscule = invocation.to_lowercase();
    minuscule.contains("message_id")
        || minuscule.contains("message-id")
        || minuscule.contains("messageid")
}

fn fautes_dans(source: &str) -> Vec<usize> {
    invocations(source)
        .into_iter()
        .filter(|(_, texte)| mentionne_message_id(texte))
        .map(|(ligne, _)| ligne)
        .collect()
}

#[test]
fn journaux_sans_message_id_dans_les_sources() {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut fichiers = Vec::new();
    fichiers_rust(&racine.join("src"), &mut fichiers);
    fichiers_rust(&racine.join("../messagerie/src"), &mut fichiers);
    assert!(fichiers.len() > 20, "les sources n'ont pas été lues");
    let mut invocations_lues = 0;
    let mut fautes = Vec::new();
    for fichier in &fichiers {
        let source = fs::read_to_string(fichier).expect("lecture");
        invocations_lues += invocations(&source).len();
        for ligne in fautes_dans(&source) {
            fautes.push(format!("{}:{ligne}", fichier.display()));
        }
    }
    assert!(
        invocations_lues > 20,
        "le contrôle ne voit plus les journaux ({invocations_lues} invocations) : il ne prouve plus rien"
    );
    assert!(
        fautes.is_empty(),
        "Message-ID dans un journal (utiliser l'identifiant interne du message) :\n{}",
        fautes.join("\n")
    );
}

#[test]
fn journaux_sans_message_id_controle_voit_la_faute() {
    let fautif = "fn f() {\n    tracing::warn!(\n        compte = %c,\n        message = %message_id,\n        \"refusée\"\n    );\n}\n";
    assert_eq!(fautes_dans(fautif), vec![2]);
    let en_ligne = "tracing::info!(message_id = %m, \"x\");";
    assert_eq!(fautes_dans(en_ligne), vec![1]);
    let entete = "tracing::error!(\"échec du Message-ID {}\", x);";
    assert_eq!(fautes_dans(entete), vec![1]);
    let propre = "tracing::warn!(compte = %c, message = ?interne, motif = m, \"refusée\");";
    assert!(fautes_dans(propre).is_empty());
    let sans_journal = "let message_id = lue.message_id.clone();";
    assert!(fautes_dans(sans_journal).is_empty());
}
