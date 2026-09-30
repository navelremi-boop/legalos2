//! File d'envoi (§ 3.8.3). Aucun contenu de mail n'est journalisé.

/// États visibles dans l'app. Un mail ne quitte la file qu'à
/// [`EtatFileEnvoi::CopieEnvoyesConfirmee`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EtatFileEnvoi {
    Brouillon,
    EnAttente,
    Envoye,
    CopieEnvoyesConfirmee,
    Echec,
}

impl EtatFileEnvoi {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Brouillon => "brouillon",
            Self::EnAttente => "en_attente",
            Self::Envoye => "envoye",
            Self::CopieEnvoyesConfirmee => "copie_envoyes_confirmee",
            Self::Echec => "echec",
        }
    }

    pub fn parse(valeur: &str) -> Option<Self> {
        match valeur {
            "brouillon" => Some(Self::Brouillon),
            "en_attente" => Some(Self::EnAttente),
            "envoye" => Some(Self::Envoye),
            "copie_envoyes_confirmee" => Some(Self::CopieEnvoyesConfirmee),
            "echec" => Some(Self::Echec),
            _ => None,
        }
    }

    /// Encore dans la file (ne doit pas être retiré).
    pub fn dans_la_file(self) -> bool {
        !matches!(self, Self::CopieEnvoyesConfirmee)
    }
}

/// Entrée de file. `message_id` est figé à la création.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntreeFileEnvoi {
    pub message_id: String,
    pub etat: EtatFileEnvoi,
    pub tentatives: u32,
}

/// Décision pure avant I/O. La vérification « déjà dans Envoyés » prime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionEnvoi {
    /// Déjà confirmé : rien à faire.
    Rien,
    /// Présent dans Envoyés : passer à confirmé sans renvoyer.
    ConfirmerCopie,
    /// Passer brouillon → en_attente (délai d'annulation).
    MettreEnAttente,
    /// Envoyer par SMTP (identifiant déjà fixé).
    EnvoyerSmtp,
    /// SMTP déjà accepté : APPEND dans Envoyés.
    CopierDansEnvoyes,
    /// Nouvelle tentative après échec (toujours vérifier Envoyés d'abord côté appelant).
    Retenter,
}

/// Décide la prochaine action. `deja_dans_envoyes` vient d'une recherche IMAP
/// par Message-ID, faite avant toute nouvelle tentative.
pub fn decider_action(entree: &EntreeFileEnvoi, deja_dans_envoyes: bool) -> ActionEnvoi {
    if entree.etat == EtatFileEnvoi::CopieEnvoyesConfirmee {
        return ActionEnvoi::Rien;
    }
    if deja_dans_envoyes {
        return ActionEnvoi::ConfirmerCopie;
    }
    match entree.etat {
        EtatFileEnvoi::Brouillon => ActionEnvoi::MettreEnAttente,
        EtatFileEnvoi::EnAttente => ActionEnvoi::EnvoyerSmtp,
        EtatFileEnvoi::Envoye => ActionEnvoi::CopierDansEnvoyes,
        EtatFileEnvoi::Echec => ActionEnvoi::Retenter,
        EtatFileEnvoi::CopieEnvoyesConfirmee => ActionEnvoi::Rien,
    }
}

/// Applique le résultat d'une action (sans I/O).
pub fn appliquer(
    entree: &mut EntreeFileEnvoi,
    action: ActionEnvoi,
    succes: bool,
) -> EtatFileEnvoi {
    match action {
        ActionEnvoi::Rien => {}
        ActionEnvoi::ConfirmerCopie => {
            entree.etat = EtatFileEnvoi::CopieEnvoyesConfirmee;
        }
        ActionEnvoi::MettreEnAttente => {
            entree.etat = EtatFileEnvoi::EnAttente;
        }
        ActionEnvoi::EnvoyerSmtp | ActionEnvoi::Retenter => {
            entree.tentatives = entree.tentatives.saturating_add(1);
            entree.etat = if succes {
                EtatFileEnvoi::Envoye
            } else {
                EtatFileEnvoi::Echec
            };
        }
        ActionEnvoi::CopierDansEnvoyes => {
            entree.etat = if succes {
                EtatFileEnvoi::CopieEnvoyesConfirmee
            } else {
                EtatFileEnvoi::Envoye
            };
        }
    }
    entree.etat
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entree(etat: EtatFileEnvoi) -> EntreeFileEnvoi {
        EntreeFileEnvoi {
            message_id: "<fixe@cabinet.example>".into(),
            etat,
            tentatives: 0,
        }
    }

    #[test]
    fn message_id_unique_et_verification_envoyes_avant_retry() {
        let mut e = entree(EtatFileEnvoi::EnAttente);
        assert_eq!(
            decider_action(&e, false),
            ActionEnvoi::EnvoyerSmtp
        );
        appliquer(&mut e, ActionEnvoi::EnvoyerSmtp, true);
        assert_eq!(e.etat, EtatFileEnvoi::Envoye);
        // Coupure après SMTP : retry voit Envoyés vide → APPEND seulement.
        assert_eq!(
            decider_action(&e, false),
            ActionEnvoi::CopierDansEnvoyes
        );
        // Si la copie est déjà là (fournisseur ou tentative précédente) : confirmer.
        assert_eq!(
            decider_action(&e, true),
            ActionEnvoi::ConfirmerCopie
        );
        appliquer(&mut e, ActionEnvoi::ConfirmerCopie, true);
        assert!(!e.etat.dans_la_file());
        assert_eq!(e.message_id, "<fixe@cabinet.example>");
    }

    #[test]
    fn echec_reste_dans_la_file() {
        let mut e = entree(EtatFileEnvoi::EnAttente);
        appliquer(&mut e, ActionEnvoi::EnvoyerSmtp, false);
        assert_eq!(e.etat, EtatFileEnvoi::Echec);
        assert!(e.etat.dans_la_file());
        assert_eq!(decider_action(&e, false), ActionEnvoi::Retenter);
    }

    #[test]
    fn brouillon_puis_attente_annulable() {
        let e = entree(EtatFileEnvoi::Brouillon);
        assert_eq!(decider_action(&e, false), ActionEnvoi::MettreEnAttente);
    }
}
