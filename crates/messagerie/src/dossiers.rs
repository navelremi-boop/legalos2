//! Dossiers IMAP d'un compte tels que l'écran les propose (« Déplacer vers… ») : noms français pour les dossiers
//! spéciaux, quel que soit le nom que le serveur leur donne (`[Gmail]/Corbeille`, `Deleted Items`, `INBOX.Sent`…).
//! Fonctions pures : la lecture IMAP est dans `imap.rs`. Aucun contenu de mail ici.

use crate::imap::{
    choisir_dossier_archives, choisir_dossier_brouillons, choisir_dossier_corbeille,
    choisir_dossier_envoyes, DossierListe,
};

/// Rôle d'un dossier spécial.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleDossier {
    Reception,
    Brouillons,
    Envoyes,
    Archives,
    Corbeille,
    Indesirables,
}

impl RoleDossier {
    /// Valeur échangée avec le poste.
    #[must_use]
    pub fn texte(self) -> &'static str {
        match self {
            Self::Reception => "reception",
            Self::Brouillons => "brouillons",
            Self::Envoyes => "envoyes",
            Self::Archives => "archives",
            Self::Corbeille => "corbeille",
            Self::Indesirables => "indesirables",
        }
    }

    /// Nom français affiché.
    #[must_use]
    pub fn libelle(self) -> &'static str {
        match self {
            Self::Reception => "Réception",
            Self::Brouillons => "Brouillons",
            Self::Envoyes => "Envoyés",
            Self::Archives => "Archives",
            Self::Corbeille => "Corbeille",
            Self::Indesirables => "Courrier indésirable",
        }
    }

    fn rang(self) -> u8 {
        match self {
            Self::Reception => 0,
            Self::Brouillons => 1,
            Self::Envoyes => 2,
            Self::Archives => 3,
            Self::Corbeille => 4,
            Self::Indesirables => 5,
        }
    }
}

/// Un dossier à proposer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierPresente {
    /// Nom IMAP exact, à renvoyer tel quel pour déplacer.
    pub nom: String,
    /// Nom affiché : français pour un dossier spécial, sinon le chemin avec « / ».
    pub libelle: String,
    pub role: Option<RoleDossier>,
    /// Faux pour un dossier qu'il faut créer au premier déplacement (Archives, Corbeille absents du serveur).
    pub existe: bool,
}

fn sans_noselect(d: &DossierListe) -> bool {
    !d.attributs
        .iter()
        .any(|a| a.eq_ignore_ascii_case("\\Noselect") || a.eq_ignore_ascii_case("\\NonExistent"))
}

fn dernier_element(d: &DossierListe) -> String {
    d.nom
        .rsplit(|c| c == '/' || c == '.' || Some(c) == d.delimiteur)
        .next()
        .unwrap_or_default()
        .to_owned()
}

fn indesirables(liste: &[DossierListe]) -> Option<String> {
    liste
        .iter()
        .filter(|d| sans_noselect(d))
        .find(|d| d.attributs.iter().any(|a| a.eq_ignore_ascii_case("\\Junk")))
        .or_else(|| {
            liste.iter().filter(|d| sans_noselect(d)).find(|d| {
                let nom = dernier_element(d).to_lowercase();
                ["junk", "spam", "courrier indésirable", "indésirables"].contains(&nom.as_str())
            })
        })
        .map(|d| d.nom.clone())
}

fn libelle_hierarchique(d: &DossierListe) -> String {
    let separateur = d.delimiteur.unwrap_or('/');
    d.nom.replace(separateur, " / ")
}

/// Dossiers où un message peut être rangé, du plus courant au plus rare : Réception, Brouillons, Envoyés, Archives,
/// Corbeille, Courrier indésirable, puis les autres dossiers par ordre alphabétique. Archives et Corbeille sont
/// toujours proposés (créés au premier déplacement si le serveur n'en a pas).
#[must_use]
pub fn presenter_dossiers(liste: &[DossierListe]) -> Vec<DossierPresente> {
    let existe = |nom: &str| liste.iter().any(|d| d.nom == nom && sans_noselect(d));
    let mut roles: Vec<(RoleDossier, String)> = Vec::new();
    if existe("INBOX") || liste.is_empty() {
        roles.push((RoleDossier::Reception, "INBOX".to_owned()));
    }
    let brouillons = choisir_dossier_brouillons(liste);
    if existe(&brouillons) {
        roles.push((RoleDossier::Brouillons, brouillons));
    }
    let envoyes = choisir_dossier_envoyes(liste);
    if existe(&envoyes) {
        roles.push((RoleDossier::Envoyes, envoyes));
    }
    roles.push((RoleDossier::Archives, choisir_dossier_archives(liste)));
    roles.push((RoleDossier::Corbeille, choisir_dossier_corbeille(liste)));
    if let Some(indesirables) = indesirables(liste) {
        roles.push((RoleDossier::Indesirables, indesirables));
    }

    let mut resultat: Vec<DossierPresente> = Vec::new();
    for (role, nom) in &roles {
        // Un même dossier ne porte qu'un rôle (le premier) ; deux rôles ne se confondent pas.
        if resultat.iter().any(|d| &d.nom == nom) {
            continue;
        }
        resultat.push(DossierPresente {
            nom: nom.clone(),
            libelle: role.libelle().to_owned(),
            role: Some(*role),
            existe: existe(nom),
        });
    }
    resultat.sort_by_key(|d| d.role.map_or(u8::MAX, RoleDossier::rang));

    let mut autres: Vec<&DossierListe> = liste
        .iter()
        .filter(|d| sans_noselect(d) && !resultat.iter().any(|deja| deja.nom == d.nom))
        .collect();
    autres.sort_by_key(|d| libelle_hierarchique(d).to_lowercase());
    resultat.extend(autres.into_iter().map(|d| DossierPresente {
        nom: d.nom.clone(),
        libelle: libelle_hierarchique(d),
        role: None,
        existe: true,
    }));
    resultat
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(nom: &str, attributs: &[&str]) -> DossierListe {
        DossierListe {
            nom: nom.to_owned(),
            delimiteur: Some('/'),
            attributs: attributs.iter().map(|a| (*a).to_owned()).collect(),
        }
    }

    fn noms(liste: &[DossierPresente]) -> Vec<(&str, &str)> {
        liste
            .iter()
            .map(|p| (p.nom.as_str(), p.libelle.as_str()))
            .collect()
    }

    #[test]
    fn un_serveur_gmail_donne_des_noms_francais_aux_dossiers_speciaux() {
        let liste = [
            d("INBOX", &[]),
            d("[Gmail]", &["\\Noselect", "\\HasChildren"]),
            d("[Gmail]/Sent Mail", &["\\Sent"]),
            d("[Gmail]/Drafts", &["\\Drafts"]),
            d("[Gmail]/Trash", &["\\Trash"]),
            d("[Gmail]/Spam", &["\\Junk"]),
            d("[Gmail]/All Mail", &["\\All"]),
            d("Dossier client", &[]),
        ];
        let p = presenter_dossiers(&liste);
        assert_eq!(
            noms(&p),
            vec![
                ("INBOX", "Réception"),
                ("[Gmail]/Drafts", "Brouillons"),
                ("[Gmail]/Sent Mail", "Envoyés"),
                ("Archives", "Archives"),
                ("[Gmail]/Trash", "Corbeille"),
                ("[Gmail]/Spam", "Courrier indésirable"),
                ("[Gmail]/All Mail", "[Gmail] / All Mail"),
                ("Dossier client", "Dossier client"),
            ]
        );
        // Les noms IMAP exacts sont conservés pour déplacer.
        assert!(p.iter().any(|x| x.nom == "[Gmail]/All Mail"));
        // Le parent non sélectionnable n'est jamais proposé.
        assert!(!p.iter().any(|x| x.nom == "[Gmail]"));
    }

    #[test]
    fn archives_et_corbeille_sont_toujours_proposees_meme_absentes() {
        let p = presenter_dossiers(&[d("INBOX", &[])]);
        let archives = p.iter().find(|x| x.role == Some(RoleDossier::Archives));
        let corbeille = p.iter().find(|x| x.role == Some(RoleDossier::Corbeille));
        assert_eq!(
            archives.map(|x| (x.nom.as_str(), x.existe)),
            Some(("Archives", false))
        );
        assert_eq!(
            corbeille.map(|x| (x.nom.as_str(), x.existe)),
            Some(("Corbeille", false))
        );
        // Un compte sans aucun dossier lisible garde au moins la réception à l'écran.
        assert!(presenter_dossiers(&[])
            .iter()
            .any(|x| x.role == Some(RoleDossier::Reception)));
    }

    #[test]
    fn des_noms_francais_sont_reconnus_sans_attribut() {
        let liste = [
            d("INBOX", &[]),
            d("Brouillons", &[]),
            d("Envoyés", &[]),
            d("Archives", &[]),
            d("Corbeille", &[]),
            d("Courrier indésirable", &[]),
        ];
        let p = presenter_dossiers(&liste);
        assert_eq!(p.len(), 6, "aucun doublon");
        assert!(p.iter().all(|x| x.role.is_some() && x.existe));
    }

    #[test]
    fn la_corbeille_n_est_pas_confondue_avec_les_archives() {
        let p = presenter_dossiers(&[
            d("INBOX", &[]),
            d("Archive", &["\\Archive"]),
            d("Trash", &["\\Trash"]),
        ]);
        let nom_de = |role| {
            p.iter()
                .find(|x| x.role == Some(role))
                .map(|x| x.nom.clone())
        };
        assert_eq!(nom_de(RoleDossier::Archives).as_deref(), Some("Archive"));
        assert_eq!(nom_de(RoleDossier::Corbeille).as_deref(), Some("Trash"));
    }

    #[test]
    fn un_dossier_n_a_qu_un_role_et_la_hierarchie_est_lisible() {
        let liste = [
            d("INBOX", &[]),
            d("INBOX/Clients", &[]),
            d("INBOX/Clients/Durand", &[]),
        ];
        let p = presenter_dossiers(&liste);
        assert!(p
            .iter()
            .any(|x| x.nom == "INBOX/Clients/Durand" && x.libelle == "INBOX / Clients / Durand"));
        assert_eq!(p.iter().filter(|x| x.nom == "INBOX").count(), 1);
    }
}
