use utoipa::OpenApi;

use crate::error::ApiErrorBody;
use crate::routes::auth::{
    ConnexionRequest, ConnexionResponse, TotpVerifyRequest, TotpVerifyResponse,
};
use crate::routes::cabinets::{CabinetResponse, PatchCabinetRequest};
use crate::routes::health::HealthResponse;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "LEGAL OS — API instance",
        version = env!("CARGO_PKG_VERSION"),
        description = "Contrat serveur (écritures validées côté API, auth JWT + TOTP, JWKS PowerSync)."
    ),
    paths(
        crate::routes::health::health,
        crate::routes::auth::connexion,
        crate::routes::auth::totp_verifier,
        crate::routes::auth::jwks,
        crate::routes::cabinets::cabinet_me,
        crate::routes::cabinets::patch_cabinet,
    ),
    components(schemas(
        HealthResponse,
        ConnexionRequest,
        ConnexionResponse,
        TotpVerifyRequest,
        TotpVerifyResponse,
        CabinetResponse,
        PatchCabinetRequest,
        ApiErrorBody,
    )),
    modifiers(&SecurityAddon),
    tags(
        (name = "systeme", description = "Santé et métadonnées"),
        (name = "auth", description = "Connexion, TOTP, jetons PowerSync"),
        (name = "cabinets", description = "Cabinet courant (sync PowerSync)")
    )
)]
pub struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}
