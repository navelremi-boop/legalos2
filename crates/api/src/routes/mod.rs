pub mod actions_messages;
pub mod agenda;
pub mod auth;
pub mod boites;
pub mod brouillons;
pub mod cabinets;
pub mod collaborateurs;
pub mod connexion_boites;
pub mod contacts;
pub mod destinataires;
pub mod documents;
pub mod dossiers;
pub mod dossiers_imap;
pub mod factures;
pub mod file_envoi;
pub mod health;
pub mod intercalaires;
pub mod invitations;
pub mod messagerie;
pub mod recherche_messages;
pub mod redaction;
pub mod temps;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post, put},
    Router,
};

use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/auth/connexion", post(auth::connexion))
        .route("/auth/totp/verifier", post(auth::totp_verifier))
        .route("/auth/jwks", get(auth::jwks))
        .route("/cabinets/me", get(cabinets::cabinet_me))
        .route("/cabinets/{cabinet_id}", patch(cabinets::patch_cabinet))
        .route(
            "/cabinets/{cabinet_id}/reference",
            get(cabinets::lire_reference).put(cabinets::ecrire_reference),
        )
        .route("/dossiers", post(dossiers::creer_dossier))
        .route("/dossiers/{dossier_id}", patch(dossiers::patch_dossier))
        .route(
            "/dossiers/{dossier_id}/parties",
            post(dossiers::creer_partie),
        )
        .route("/parties/{partie_id}", patch(dossiers::patch_partie))
        .route("/contacts", post(contacts::creer_contact))
        .route("/contacts/{contact_id}", patch(contacts::patch_contact))
        .route(
            "/contacts/{contact_id}/historique",
            get(contacts::historique_contact),
        )
        .route(
            "/dossiers/{dossier_id}/liens",
            post(contacts::lier_dossiers),
        )
        .route("/dossiers/{dossier_id}/agenda", post(agenda::creer_element))
        .route(
            "/agenda/{element_id}",
            patch(agenda::patch_element).delete(agenda::retirer_element),
        )
        .route(
            "/dossiers/{dossier_id}/intercalaires",
            post(intercalaires::creer_intercalaire),
        )
        .route(
            "/intercalaires/{intercalaire_id}",
            patch(intercalaires::patch_intercalaire).delete(intercalaires::retirer_intercalaire),
        )
        .route(
            "/intercalaires/{intercalaire_id}/elements",
            post(intercalaires::rattacher_element),
        )
        .route(
            "/intercalaire-elements/{element_lien_id}",
            delete(intercalaires::detacher_element),
        )
        .route(
            "/collaborateurs",
            get(collaborateurs::lister_collaborateurs).post(collaborateurs::creer_collaborateur),
        )
        .route("/repertoires", post(documents::creer_repertoire))
        .route(
            "/repertoires/{repertoire_id}",
            patch(documents::patch_repertoire),
        )
        .route("/documents", post(documents::creer_document))
        .route("/documents/{document_id}", patch(documents::patch_document))
        .route(
            "/documents/{document_id}/versions",
            post(documents::preparer_version),
        )
        .route(
            "/documents/{document_id}/versions/{numero}/sceller",
            post(documents::sceller_version),
        )
        .route(
            "/documents/{document_id}/versions/{numero}",
            get(documents::lire_version),
        )
        .route("/factures", post(factures::creer_brouillon))
        .route("/factures/{id}/valider", post(factures::valider))
        .route("/factures/{id}/emettre", post(factures::emettre))
        .route("/factures/{id}/encaissements", post(factures::encaisser))
        .route("/factures/{id}/avoir", post(factures::avoir))
        .route("/factures/{id}/cii", get(factures::lire_cii))
        .route("/factures/{id}/pdf", get(factures::lire_pdf))
        .route("/annuaire/{siren}", get(factures::annuaire))
        .route("/temps", post(temps::creer_temps))
        .route("/temps/{temps_id}", patch(temps::patch_temps))
        .route("/brouillons-facture", post(temps::creer_brouillon_temps))
        .route(
            "/brouillons-facture/{brouillon_id}",
            patch(temps::patch_brouillon),
        )
        .route("/taux-horaires", post(temps::creer_taux))
        .route("/taux-horaires/{taux_id}", patch(temps::patch_taux))
        .route(
            "/messagerie/classement/relever",
            post(messagerie::relever_classement),
        )
        .route("/messagerie/messages", get(messagerie::lister_messages))
        .route(
            "/messagerie/messages/{message_id}/corps",
            post(messagerie::lire_corps_message),
        )
        .route(
            "/messagerie/messages/{message_id}/actions",
            post(actions_messages::creer_action),
        )
        .route("/messagerie/actions", get(actions_messages::lister_actions))
        .route(
            "/messagerie/actions/{action_id}",
            get(actions_messages::lire_action),
        )
        .route(
            "/messagerie/recherche",
            get(recherche_messages::rechercher_messages),
        )
        .route(
            "/messagerie/messages/{message_id}/accepter-suggestion",
            post(messagerie::accepter_suggestion),
        )
        .route(
            "/messagerie/messages/{message_id}/classer",
            post(messagerie::classer_message),
        )
        .route(
            "/dossiers/{dossier_id}/chrono-mails",
            get(messagerie::chrono_mails_dossier),
        )
        .route(
            "/messagerie/comptes",
            get(boites::lister_comptes).post(messagerie::creer_compte_nominatif),
        )
        .route(
            "/messagerie/comptes/{compte_id}/connexion",
            put(connexion_boites::modifier_connexion),
        )
        .route(
            "/messagerie/comptes/{compte_id}/dossiers",
            get(dossiers_imap::lister_dossiers_imap),
        )
        .route(
            "/messagerie/boites-partagees",
            post(boites::creer_boite_partagee),
        )
        .route(
            "/messagerie/boites-partagees/{compte_id}/membres",
            get(boites::lister_membres).put(boites::definir_membres),
        )
        .route("/messagerie/sante", get(boites::sante_boites))
        .route(
            "/messagerie/invitations",
            get(invitations::lister_invitations),
        )
        .route(
            "/messagerie/invitations/{id}/reponse",
            post(invitations::repondre_invitation),
        )
        .route("/messagerie/composition", post(redaction::composer))
        .route("/messagerie/brouillons", get(brouillons::lister_brouillons))
        .route(
            "/messagerie/brouillons/{id}",
            get(brouillons::lire_brouillon)
                .put(brouillons::ecrire_brouillon)
                .delete(brouillons::supprimer_brouillon),
        )
        // Seule route à dépasser la limite de corps par défaut : la pièce arrive en corps brut.
        .route(
            "/messagerie/brouillons/{id}/pieces",
            post(brouillons::ajouter_piece)
                .layer(DefaultBodyLimit::max(redaction::TAILLE_MAX_PIECES + 1024)),
        )
        .route(
            "/messagerie/brouillons/{id}/pieces/{piece_id}",
            delete(brouillons::retirer_piece),
        )
        .route(
            "/messagerie/brouillons/{id}/envoyer",
            post(brouillons::envoyer_brouillon),
        )
        .route(
            "/messagerie/destinataires",
            get(destinataires::completer_destinataires),
        )
        .route(
            "/messagerie/comptes/{compte_id}/signature",
            get(redaction::lire_signature).put(redaction::ecrire_signature),
        )
        .route(
            "/messagerie/modeles",
            get(redaction::lister_modeles).post(redaction::creer_modele),
        )
        .route(
            "/messagerie/modeles/{modele_id}",
            patch(redaction::patch_modele).delete(redaction::supprimer_modele),
        )
        .route(
            "/messagerie/oauth/fournisseurs",
            get(crate::oauth_mail::lister_fournisseurs),
        )
        .route("/messagerie/oauth/debut", post(crate::oauth_mail::debut))
        .route(
            "/messagerie/oauth/echange",
            post(crate::oauth_mail::echange),
        )
        .route(
            "/messagerie/oauth/renouveler",
            post(crate::oauth_mail::renouveler),
        )
        .route("/messagerie/file-envoi", get(file_envoi::lister_file_envoi))
        .route("/messagerie/file-envoi", post(file_envoi::creer_envoi))
        .route(
            "/messagerie/file-envoi/{id}/mettre-en-attente",
            post(file_envoi::mettre_en_attente),
        )
        .route(
            "/messagerie/file-envoi/{id}/annuler",
            post(file_envoi::annuler_envoi),
        )
        .route(
            "/messagerie/file-envoi/{id}/traiter",
            post(file_envoi::traiter_envoi),
        )
        .with_state(state)
}
