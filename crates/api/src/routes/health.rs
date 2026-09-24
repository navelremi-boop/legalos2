use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const API_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

#[utoipa::path(
    get,
    path = "/health",
    tag = "systeme",
    responses(
        (status = 200, description = "Service opérationnel", body = HealthResponse)
    )
)]
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: API_VERSION,
    })
}
