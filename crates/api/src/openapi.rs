use utoipa::OpenApi;

use crate::error::ApiErrorBody;
use crate::routes::auth::{
    ConnexionRequest, ConnexionResponse, TotpVerifyRequest, TotpVerifyResponse,
};
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
    ),
    components(schemas(
        HealthResponse,
        ConnexionRequest,
        ConnexionResponse,
        TotpVerifyRequest,
        TotpVerifyResponse,
        ApiErrorBody,
    )),
    tags(
        (name = "systeme", description = "Santé et métadonnées"),
        (name = "auth", description = "Connexion, TOTP, jetons PowerSync")
    )
)]
pub struct ApiDoc;
