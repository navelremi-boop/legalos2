use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::ids::{CabinetId, PosteId, UtilisateurId};

/// Poste de travail enregistré (registre pour révocation S10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Poste {
    pub id: PosteId,
    pub cabinet_id: CabinetId,
    pub utilisateur_id: UtilisateurId,
    pub nom_appareil: String,
    pub revoque_le: Option<OffsetDateTime>,
    pub derniere_connexion_le: Option<OffsetDateTime>,
    pub cree_le: OffsetDateTime,
}

impl Poste {
    pub fn est_actif(&self) -> bool {
        self.revoque_le.is_none()
    }
}
