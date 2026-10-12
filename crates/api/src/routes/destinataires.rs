//! Complétion des destinataires (J11, étape 1b).
//!
//! Trois sources, dans cet ordre de priorité : l'annuaire du cabinet (colonne `contacts.email`),
//! les adresses des envois de l'utilisateur, les adresses des messages qu'il a le droit de lire
//! (mêmes filtres que la liste des messages et que la lecture d'un message : boîte nominative du
//! seul titulaire, dossier restreint réservé à ses accès). Jamais d'adresse issue d'une boîte
//! nominative d'autrui ni d'un dossier restreint non autorisé.
//!
//! Les messages relevés ne gardent que les adresses (pas les noms d'affichage) : un nom ne vient
//! que de l'annuaire ou des envois.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    Json,
};
use legalos_messagerie::adresse_et_nom;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

const LIMITE_PAR_DEFAUT: i64 = 8;
const LIMITE_MAX: i64 = 50;
const SAISIE_MIN: usize = 2;
/// Lignes lues par source : la complétion reste rapide sur une boîte de 50 000 messages.
const LIGNES_PAR_SOURCE: i64 = 300;

#[derive(Debug, Deserialize)]
pub struct DestinatairesQuery {
    /// Saisie de l'utilisateur, 2 caractères au moins.
    pub q: Option<String>,
    /// Nombre de résultats (8 par défaut, 50 au plus).
    pub limite: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DestinataireSuggere {
    /// Adresse en minuscules.
    pub adresse: String,
    /// Nom d'affichage, vide s'il n'est pas connu.
    pub nom: String,
    /// `annuaire`, `envoye` ou `recu`.
    pub source: String,
}

/// Motif `ILIKE` sûr : `%`, `_` et `\` de la saisie sont des caractères ordinaires.
fn motif_contient(saisie: &str) -> String {
    let mut motif = String::from("%");
    for car in saisie.chars() {
        if matches!(car, '%' | '_' | '\\') {
            motif.push('\\');
        }
        motif.push(car);
    }
    motif.push('%');
    motif
}

/// Candidats dédoublonnés sans casse, premier arrivé gagnant (l'ordre des sources est l'ordre de
/// priorité) ; un nom connu complète une entrée restée sans nom.
#[derive(Default)]
struct Candidats {
    ordre: Vec<String>,
    par_adresse: HashMap<String, DestinataireSuggere>,
}

impl Candidats {
    fn ajouter(&mut self, adresse: &str, nom: &str, source: &str, saisie_minuscule: &str) {
        let adresse = adresse.trim().to_lowercase();
        if !adresse.contains('@') || adresse.chars().any(char::is_whitespace) {
            return;
        }
        let nom = nom.trim();
        if !adresse.contains(saisie_minuscule) && !nom.to_lowercase().contains(saisie_minuscule) {
            return;
        }
        match self.par_adresse.get_mut(&adresse) {
            Some(existant) => {
                if existant.nom.is_empty() && !nom.is_empty() {
                    existant.nom = nom.to_owned();
                }
            }
            None => {
                self.ordre.push(adresse.clone());
                self.par_adresse.insert(
                    adresse.clone(),
                    DestinataireSuggere {
                        adresse,
                        nom: nom.to_owned(),
                        source: source.to_owned(),
                    },
                );
            }
        }
    }

    fn resultat(mut self, limite: usize) -> Vec<DestinataireSuggere> {
        self.ordre
            .into_iter()
            .filter_map(|adresse| self.par_adresse.remove(&adresse))
            .take(limite)
            .collect()
    }
}

#[utoipa::path(
    get,
    path = "/messagerie/destinataires",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Destinataires proposés pour la saisie (paramètres de requête : `q`, 2 caractères au moins, et `limite`, 8 par défaut)", body = Vec<DestinataireSuggere>),
        (status = 400, description = "Saisie trop courte", body = crate::error::ApiErrorBody),
    )
)]
pub async fn completer_destinataires(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Query(query): Query<DestinatairesQuery>,
) -> Result<Json<Vec<DestinataireSuggere>>, ApiError> {
    let saisie = query.q.unwrap_or_default().trim().to_owned();
    if saisie.chars().count() < SAISIE_MIN {
        return Err(ApiError::bad_request(
            "Saisir au moins 2 caractères pour chercher un destinataire",
        ));
    }
    let limite = query
        .limite
        .unwrap_or(LIMITE_PAR_DEFAUT)
        .clamp(1, LIMITE_MAX);
    let minuscule = saisie.to_lowercase();
    let motif = motif_contient(&saisie);
    let mut candidats = Candidats::default();

    // 1. Annuaire du cabinet.
    let contacts = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT btrim(email), nom
        FROM contacts
        WHERE cabinet_id = $1
          AND email IS NOT NULL AND btrim(email) <> ''
          AND (email ILIKE $2 ESCAPE '\' OR nom ILIKE $2 ESCAPE '\')
        ORDER BY lower(nom)
        LIMIT $3
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(&motif)
    .bind(LIGNES_PAR_SOURCE)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de l'annuaire"))?;
    for (adresse, nom) in &contacts {
        candidats.ajouter(adresse, nom, "annuaire", &minuscule);
    }

    // 2. Envois de l'utilisateur (à, cc, cci), le plus récent d'abord.
    let envois = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT destinataire, cc, cci
        FROM file_envoi
        WHERE cabinet_id = $1 AND auteur_id = $2
          AND (destinataire ILIKE $3 ESCAPE '\' OR cc ILIKE $3 ESCAPE '\' OR cci ILIKE $3 ESCAPE '\')
        ORDER BY cree_le DESC
        LIMIT $4
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(&motif)
    .bind(LIGNES_PAR_SOURCE)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des envois"))?;
    for (a, cc, cci) in &envois {
        for brut in [a, cc, cci].into_iter().flat_map(|champ| champ.split('\n')) {
            if let Some((adresse, nom)) = adresse_et_nom(brut) {
                candidats.ajouter(&adresse, &nom, "envoye", &minuscule);
            }
        }
    }

    // 3. Messages lisibles par l'utilisateur : mêmes règles que `lister_messages` (boîte
    //    nominative du seul titulaire) et que `charger_message` (dossier restreint réservé à ses
    //    accès).
    let messages = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT m.expediteur, m.destinataires_texte
        FROM messages m
        WHERE m.cabinet_id = $1
          AND (m.titulaire_id IS NULL OR m.titulaire_id = $2)
          AND (
            m.dossier_id IS NULL
            OR EXISTS (
                SELECT 1 FROM dossiers d
                WHERE d.id = m.dossier_id
                  AND d.cabinet_id = $1
                  AND (
                    d.restreint = FALSE
                    OR EXISTS (
                        SELECT 1 FROM dossier_acces a
                        WHERE a.dossier_id = d.id AND a.utilisateur_id = $2
                    )
                  )
            )
          )
          AND (m.expediteur ILIKE $3 ESCAPE '\' OR m.destinataires_texte ILIKE $3 ESCAPE '\')
        ORDER BY m.cree_le DESC
        LIMIT $4
        "#,
    )
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .bind(&motif)
    .bind(LIGNES_PAR_SOURCE)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des messages"))?;
    for (expediteur, destinataires) in &messages {
        candidats.ajouter(expediteur, "", "recu", &minuscule);
        for adresse in destinataires.split(',') {
            candidats.ajouter(adresse, "", "recu", &minuscule);
        }
    }

    Ok(Json(
        candidats.resultat(usize::try_from(limite).unwrap_or(1)),
    ))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn le_motif_neutralise_les_jokers_de_la_saisie() {
        assert_eq!(motif_contient("jean"), "%jean%");
        assert_eq!(motif_contient("100%_a\\b"), "%100\\%\\_a\\\\b%");
    }

    #[test]
    fn doublons_sans_casse_priorite_des_sources_et_nom_complete() {
        let mut candidats = Candidats::default();
        candidats.ajouter("Jean.Dupont@Example.com", "", "recu", "dupont");
        candidats.ajouter(
            "jean.dupont@example.com",
            "Jean Dupont",
            "annuaire",
            "dupont",
        );
        candidats.ajouter("autre@example.com", "Autre Dupont", "envoye", "dupont");
        // Hors saisie, sans arobase, avec espace : écartés.
        candidats.ajouter("marie@example.com", "Marie", "recu", "dupont");
        candidats.ajouter("dupont-sans-arobase", "", "recu", "dupont");
        candidats.ajouter("a dupont@example.com", "", "recu", "dupont");
        let resultat = candidats.resultat(8);
        assert_eq!(resultat.len(), 2);
        assert_eq!(resultat[0].adresse, "jean.dupont@example.com");
        assert_eq!(
            resultat[0].nom, "Jean Dupont",
            "le nom connu complète l'entrée"
        );
        assert_eq!(
            resultat[0].source, "recu",
            "la première source rencontrée reste"
        );
        assert_eq!(resultat[1].source, "envoye");
    }

    #[test]
    fn la_limite_coupe_la_liste() {
        let mut candidats = Candidats::default();
        for i in 0..10 {
            candidats.ajouter(&format!("dupont{i}@example.com"), "", "recu", "dupont");
        }
        assert_eq!(candidats.resultat(3).len(), 3);
    }
}
