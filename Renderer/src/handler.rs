use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use reqwest::Client;
use base64::{engine::general_purpose, Engine as _};
use usvg::{fontdb, Options, Tree, TreeParsing, TreePostProc};
use tiny_skia::Pixmap;

use crate::models::{RankCardRequest, MugshotRequest};
use crate::template::{RankCardTemplate, MugshotTemplate};
use askama::Template;
use std::time::Instant;


pub async fn render_rank_card(Json(payload): Json<serde_json::Value>) -> Response {
    let start = Instant::now();
    let client = Client::new();

    // Check the type of request to determine which renderer to use
    let render_type = payload.get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("rank_card");

    // 1. Fetch Discord Avatar & Convert to Base64
    let avatar_url = payload.get("avatar_url")
        .and_then(|u| u.as_str())
        .unwrap_or("");
        
    let avatar_bytes = match client.get(avatar_url).send().await {
        Ok(res) => res.bytes().await.unwrap_or_default(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch avatar").into_response(),
    };
    let avatar_b64 = general_purpose::STANDARD.encode(&avatar_bytes);

    // Route based on render type
    match render_type {
        "mugshot" => {
            let username = payload.get("username")
                .and_then(|u| u.as_str())
                .unwrap_or("Unknown");
            let background_color = payload.get("background_color")
                .and_then(|c| c.as_str())
                .unwrap_or("#8B0000");

            let template = MugshotTemplate {
                username: username.to_string(),
                avatar_b64,
                background_color: background_color.to_string(),
            };
            
            let svg_string = match template.render() {
                Ok(s) => s,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to render mugshot template").into_response(),
            };

            // Render SVG to PNG
            render_svg_to_png(&svg_string, start)
        }
        _ => {
            // Default to rank card rendering
            let username = payload.get("username")
                .and_then(|u| u.as_str())
                .unwrap_or("User");
            let current_xp = payload.get("current_xp")
                .and_then(|xp| xp.as_i64())
                .unwrap_or(0) as i32;
            let next_xp = payload.get("next_xp")
                .and_then(|xp| xp.as_i64())
                .unwrap_or(100) as i32;
            let rank = payload.get("rank")
                .and_then(|r| r.as_i64())
                .unwrap_or(1) as i32;
            let clan_color = payload.get("clan_color")
                .and_then(|c| c.as_str())
                .unwrap_or("#FFFFFF");

            // Math for Progress Bar (Max width is 500px)
            let progress_percent = if next_xp > 0 {
                current_xp as f64 / next_xp as f64
            } else {
                1.0
            };
            let progress_width = (progress_percent * 500.0).clamp(0.0, 500.0);

            // Populate Askama SVG Template
            let template = RankCardTemplate {
                username: username.to_string(),
                avatar_b64,
                current_xp,
                next_xp,
                rank,
                clan_color: clan_color.to_string(),
                progress_width,
            };
            let svg_string = match template.render() {
                Ok(s) => s,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to render template").into_response(),
            };

            // Setup resvg & Font Database
            let mut opt = Options::default();
            opt.font_family = "TT Fors Trial Bold".to_string();

            let mut fontdb = fontdb::Database::new();
            let font_data = include_bytes!("../../assets/fonts/TT Fors Trial Bold.ttf");
            fontdb.load_font_data(font_data.to_vec());

            // Render SVG to PNG Bytes
            let mut rtree = match Tree::from_str(&svg_string, &opt) {
                Ok(tree) => tree,
                Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to parse SVG").into_response(),
            };
            
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

            // Record Metrics
            let duration = start.elapsed().as_secs_f64();
            metrics::histogram!("renderer_render_duration_seconds").record(duration);

            // Return the raw PNG bytes to Node.js
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "image/png")],
                png_bytes,
            ).into_response()
        }
    }
}

fn render_svg_to_png(svg_string: &str, start: Instant) -> Response {
    let mut pixmap = match Pixmap::new(400, 400) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    
    let tree = match Tree::from_str(svg_string, &Options::default()) {
        Ok(t) => t,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to parse SVG").into_response(),
    };
    
    resvg::render(&tree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    // Record Metrics
    let duration = start.elapsed().as_secs_f64();
    metrics::histogram!("renderer_render_duration_seconds").record(duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}
