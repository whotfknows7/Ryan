use axum::{
    extract::{State, Json},
    response::{IntoResponse, Response},
    http::{StatusCode, header},
};
use crate::{
    models::{RenderRequest, RenderResponse},
    template,
    AppState,
};

pub async fn render_rank_card(
    State(state): State<AppState>,
    Json(payload): Json<RenderRequest>,
) -> Response {
    // 1. Generate HTML
    // 1. Generate HTML
    let html = match template::generate_rank_card_html(&payload) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("Template rendering failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RenderResponse {
                    success: false,
                    message: format!("Template rendering failed: {}", e),
                }),
            ).into_response();
        }
    };

    // 2. Render via Browser
    match state.browser_manager.render_html(&html).await {
        Ok(image_bytes) => {
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "image/png")],
                image_bytes,
            ).into_response()
        }
        Err(e) => {
            tracing::error!("Rendering failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RenderResponse {
                    success: false,
                    message: format!("Rendering failed: {}", e),
                }),
            ).into_response()
        }
    }
}

pub async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, "Ryan Renderer is Running")
}
