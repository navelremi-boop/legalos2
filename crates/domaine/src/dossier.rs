use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::ids::{CabinetId, DossierId};

/// Visibilité du dossier (cloisonnement sync PowerSync en phase ultérieure).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DossierVisibilite {
    Standard,
    Restreint,
}

/// Dossier client — squelette V1 (champs métier enrichis en phase 2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dossier {
    pub id: DossierId,
    pub cabinet_id: CabinetId,
    pub reference: String,
    pub intitule: String,
    pub visibilite: DossierVisibilite,
    pub cree_le: OffsetDateTime,
}
