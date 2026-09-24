use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::ids::CabinetId;

/// Cabinet juridique (une instance serveur par cabinet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cabinet {
    pub id: CabinetId,
    pub slug: String,
    pub nom: String,
    /// Double authentification exigée pour tous les utilisateurs du cabinet.
    pub totp_obligatoire: bool,
    pub cree_le: OffsetDateTime,
}
