use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::ids::{CabinetId, UtilisateurId};

/// Compte utilisateur rattaché à un cabinet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Utilisateur {
    pub id: UtilisateurId,
    pub cabinet_id: CabinetId,
    /// Adresse de connexion (identifiant technique, jamais journalisée en clair côté serveur).
    pub email: String,
    pub actif: bool,
    pub cree_le: OffsetDateTime,
}
