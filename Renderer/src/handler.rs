use axum::{Json, http::StatusCode, response::{IntoResponse, Response}, extract::State};
use reqwest::Client;
use base64::{engine::general_purpose, Engine as _};
use usvg::{Options, Tree, TreeParsing, TreePostProc};
use tiny_skia::Pixmap;

use crate::models::RankCardRequest;
use crate::template::RankCardTemplate;
use askama::Template;
use std::time::Instant;


pub async fn render_rank_card(
    State(fontdb): State<std::sync::Arc<usvg::fontdb::Database>>,
    Json(payload): Json<RankCardRequest>,
) -> Response {
    let start = Instant::now();

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

    // 4. Setup resvg & Font options
    let mut opt = Options::default();
    opt.font_family = "TT Fors Trial".to_string();

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

    // Record Metrics
    let duration = start.elapsed().as_secs_f64();
    tracing::debug!("Recording render duration: {}s", duration);
    metrics::histogram!("renderer_render_duration_seconds").record(duration);

    // Return the raw PNG bytes to Node.js
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}

pub async fn render_leaderboard(
    State(fontdb): State<std::sync::Arc<usvg::fontdb::Database>>,
    Json(payload): Json<crate::models::LeaderboardRequest>,
) -> Response {
    let start = Instant::now();
    let client = Client::new();

    let mut template_users = Vec::new();
    let mut y_pos = 10;
    
    // Map colors
    let get_bg_color = |rank: i32, is_highlighted: bool| -> String {
        if is_highlighted {
            return "#823EF0".to_string();
        }
        match rank {
            1 => "#FFD700".to_string(),
            2 => "#E6E8FA".to_string(),
            3 => "#CD7F32".to_string(),
            _ => "#36393e".to_string(),
        }
    };

    let format_xp = |xp: i32| -> String {
        if xp >= 1_000_000 {
            let num = xp as f64 / 1_000_000.0;
            if num.fract() == 0.0 { format!("{}m", num) } else { format!("{:.1}m", num) }
        } else if xp >= 1_000 {
            let num = xp as f64 / 1_000.0;
            if num.fract() == 0.0 { format!("{}k", num) } else { format!("{:.1}k", num) }
        } else {
            xp.to_string()
        }
    };

    for user in payload.users {
        // Fetch avatar concurrently or sequentially (sequential for simplicity here, can optimize later)
        let avatar_b64 = if !user.avatar_url.is_empty() {
            match client.get(&user.avatar_url).send().await {
                Ok(res) => {
                    let bytes = res.bytes().await.unwrap_or_default();
                    general_purpose::STANDARD.encode(&bytes)
                },
                Err(_) => "".to_string(),
            }
        } else {
            "".to_string()
        };

        let is_highlighted = payload.highlight_user_id.as_ref() == Some(&user.user_id);
        
        let mut template_emojis = Vec::new();
        for emoji in user.emojis {
            // we read emoji from disk: assets/emojis/{hex}.png
            let mut path = format!("./assets/emojis/{}.png", emoji.hex);
            if !std::path::Path::new(&path).exists() {
                path = format!("../assets/emojis/{}.png", emoji.hex);
            }
            let b64 = match tokio::fs::read(&path).await {
                Ok(bytes) => general_purpose::STANDARD.encode(&bytes),
                Err(_) => "".to_string(),
            };
            if !b64.is_empty() {
                template_emojis.push(crate::template::TemplateEmojiData {
                    b64,
                    x_offset: emoji.x_offset + 145.0 + 8.0, // 145 is username X start, 8 is gap
                });
            }
        }

        // naive way to calculate xp x start based on username length and emoji count
        // We will pass emoji_x_end from Node.js, so we know exactly where it ends.
        let xp_x_start = user.text_end_x + 145.0 + 8.0 + 30.0;

        template_users.push(crate::template::TemplateUserData {
            username: user.username,
            avatar_b64,
            rank: user.rank,
            formatted_xp: format_xp(user.xp),
            emojis: template_emojis,
            bg_color: get_bg_color(user.rank, is_highlighted),
            y_pos,
            xp_x_start,
        });

        y_pos += 60;
    }

    let height = if template_users.is_empty() { 100 } else { y_pos + 10 };

    let template = crate::template::LeaderboardTemplate {
        users: template_users,
        height,
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to render template: {}", e)).into_response(),
    };

    let mut opt = Options::default();
    opt.font_family = "TT Fors Trial".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse SVG: {}", e)).into_response(),
    };
    
    rtree.postprocess(usvg::PostProcessingSteps::default(), &fontdb);

    let mut pixmap = match Pixmap::new(800, height as u32) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    let duration = start.elapsed().as_secs_f64();
    tracing::debug!("Recording leaderboard render duration: {}s", duration);
    metrics::histogram!("renderer_leaderboard_render_duration_seconds").record(duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}
