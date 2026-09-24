//! Types métier V1 de base (contrats partagés).

mod cabinet;
mod dossier;
mod ids;
mod poste;
mod utilisateur;

pub use cabinet::Cabinet;
pub use dossier::{Dossier, DossierVisibilite};
pub use ids::{CabinetId, DossierId, PosteId, UtilisateurId};
pub use poste::Poste;
pub use utilisateur::Utilisateur;
