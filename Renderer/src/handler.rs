use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use reqwest::Client;
use base64::{engine::general_purpose, Engine as _};
use usvg::{fontdb, Options, Tree, TreeParsing, TreePostProc};
use tiny_skia::Pixmap;
use std::sync::Arc;
use crate::models::RankCardRequest;
use crate::template::RankCardTemplate;
use askama::Template;

pub async fn render_rank_card(
    Json(payload): Json<RankCardRequest>,
) -> Response {
    // 1. Fetch Discord Avatar & Convert to Base64
    let client = Client::new();
    let avatar_bytes = match client.get(&payload.avatar_url).send().await {
        Ok(res) => res.bytes().await.unwrap_or_default(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch avatar").into_response(),
    };
    let avatar_b64 = general_purpose::STANDARD.encode(&avatar_bytes);

    // 2. Math for Progress Bar (Max width is 500px)
    let progress_percent = if payload.next_xp > 0 {
        payload.current_xp as f64 / payload.next_xp as f64
    } else {
        1.0
    };
    let progress_width = (progress_percent * 500.0).clamp(0.0, 500.0);

    // 3. Populate Askama SVG Template
    let template = RankCardTemplate {
        username: payload.username,
        avatar_b64,
        current_xp: payload.current_xp,
        next_xp: payload.next_xp,
        rank: payload.rank,
        clan_color: payload.clan_color,
        progress_width,
    };
    let svg_string = match template.render() {
        Ok(s) => s,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to render template").into_response(),
    };

    // 4. Setup resvg & Font Database
    let mut opt = Options::default();
    opt.font_family = "TT Fors Trial Bold".to_string();

    let mut fontdb = fontdb::Database::new();
    // Load your custom font
    let font_data = include_bytes!("../../assets/fonts/TT Fors Trial Bold.ttf");
    fontdb.load_font_data(font_data.to_vec());

    // 5. Render SVG to PNG Bytes
    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to parse SVG").into_response(),
    };
    
    // Convert text to paths using the loaded font database
    rtree.postprocess(usvg::PostProcessingSteps::default(), &fontdb);

    let mut pixmap = match Pixmap::new(800, 250) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    // Return the raw PNG bytes to Node.js
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}
