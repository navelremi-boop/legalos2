use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiErrorBody {
    pub code: &'static str,
    pub message: String,
    /// Présent seulement pour un 409 `reference_existante` quand un numéro de départ
    /// plus élevé rendrait le changement acceptable (R0-f).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numero_depart_minimal: Option<i64>,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    numero_depart_minimal: Option<i64>,
}

impl ApiError {
    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_IMPLEMENTED,
            code: "not_implemented",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "bad_request",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "forbidden",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "not_found",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "conflict",
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    /// Erreur HTTP avec un code métier libre (`modele_invalide`, `reference_existante`…).
    pub fn with_code(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            numero_depart_minimal: None,
        }
    }

    /// Comme `with_code`, avec un numéro de départ minimal (409 `reference_existante`, R0-f).
    pub fn with_code_et_numero_depart(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        numero_depart_minimal: Option<i64>,
    ) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            numero_depart_minimal,
        }
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ApiErrorBody {
            code: self.code,
            message: self.message,
            numero_depart_minimal: self.numero_depart_minimal,
        };
        (self.status, Json(body)).into_response()
    }
}
