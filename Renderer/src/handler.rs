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
    let avatar_b64 = match client.get(&payload.avatar_url).send().await {
        Ok(res) if res.status().is_success() => {
            let bytes = res.bytes().await.unwrap_or_default();
            general_purpose::STANDARD.encode(&bytes)
        },
        _ => "".to_string(),
    };

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
    opt.font_family = "TT Fors Trial, ColrEmoji, Noto Color Emoji, sans-serif".to_string();

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
                Ok(res) if res.status().is_success() => {
                    let bytes = res.bytes().await.unwrap_or_default();
                    general_purpose::STANDARD.encode(&bytes)
                },
                _ => "".to_string(),
            }
        } else {
            "".to_string()
        };

        let is_highlighted = payload.highlight_user_id.as_ref() == Some(&user.user_id);

        let display_text = user.username.trim().to_string();

        // Fixed layout: rank starts at x=75, then separator "|" with spacing, then username
        let rank_str = format!("#{}", user.rank);
        let rank_char_count = rank_str.chars().count() as f64;
        // Bold font-size 30 is approx 19px per character
        let rank_text_end = 75.0 + (rank_char_count * 19.0);
        // Place separator with generous gap after rank text
        let separator_x = rank_text_end + 15.0;
        // Username starts well after separator (pipe ~10px wide + 15px gap)
        let username_x = separator_x + 25.0;

        // Username truncation (conservative: ~19px per char at bold font-size 30)
        let max_username_width = 380.0;
        let mut final_text = display_text;
        let estimated_width = final_text.chars().count() as f64 * 19.0;
        if estimated_width > max_username_width {
            let max_chars = (max_username_width / 19.0) as usize;
            if max_chars > 3 {
                // UTF-8 safe truncation: use char_indices to find a safe boundary
                let truncated: String = final_text.chars().take(max_chars - 3).collect();
                final_text = format!("{}...", truncated);
            } else {
                final_text = "...".to_string();
            }
        }

        let text_width_after = final_text.chars().count() as f64 * 19.0;
        
        // Calculate xp_x: position the "| XP: N pts" after username text with padding
        let xp_x = username_x + text_width_after + 15.0;

        template_users.push(crate::template::TemplateUserData {
            username: final_text,
            avatar_b64,
            rank: user.rank,
            formatted_xp: format_xp(user.xp),
            bg_color: get_bg_color(user.rank, is_highlighted),
            y_pos,
            separator_x,
            username_x,
            xp_x,
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
    opt.font_family = "TT Fors Trial, ColrEmoji, Noto Color Emoji, sans-serif".to_string();

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

pub async fn render_role_reward_base(
    State(fontdb): State<std::sync::Arc<usvg::fontdb::Database>>,
    Json(payload): Json<crate::models::RoleRewardBaseRequest>,
) -> Response {
    let start = Instant::now();
    let client = Client::new();

    let icon_b64 = if let Some(url) = payload.icon_url {
        match client.get(&url).send().await {
            Ok(res) if res.status().is_success() => {
                let bytes = res.bytes().await.unwrap_or_default();
                Some(general_purpose::STANDARD.encode(&bytes))
            }
            _ => None,
        }
    } else {
        None
    };

    let template = crate::template::BaseRewardTemplate {
        role_name: payload.role_name,
        role_color_hex: payload.role_color_hex,
        icon_b64,
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to render template: {}", e)).into_response(),
    };

    let mut opt = Options::default();
    opt.font_family = "TT Fors Trial, ColrEmoji, Noto Color Emoji, sans-serif".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse SVG: {}", e)).into_response(),
    };
    
    rtree.postprocess(usvg::PostProcessingSteps::default(), &fontdb);

    let mut pixmap = match Pixmap::new(1024, 341) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    let duration = start.elapsed().as_secs_f64();
    tracing::debug!("Recording role_reward_base render duration: {}s", duration);
    metrics::histogram!("renderer_role_reward_base_duration_seconds").record(duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}

pub async fn render_role_reward_final(
    State(fontdb): State<std::sync::Arc<usvg::fontdb::Database>>,
    Json(payload): Json<crate::models::RoleRewardFinalRequest>,
) -> Response {
    let start = Instant::now();

    let template = crate::template::FinalRewardTemplate {
        base_image_b64: payload.base_image_b64,
        username: payload.username,
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to render template: {}", e)).into_response(),
    };

    let mut opt = Options::default();
    opt.font_family = "TT Fors Trial, ColrEmoji, Noto Color Emoji, sans-serif".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse SVG: {}", e)).into_response(),
    };
    
    rtree.postprocess(usvg::PostProcessingSteps::default(), &fontdb);

    let mut pixmap = match Pixmap::new(1024, 341) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    let duration = start.elapsed().as_secs_f64();
    tracing::debug!("Recording role_reward_final render duration: {}s", duration);
    metrics::histogram!("renderer_role_reward_final_duration_seconds").record(duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}
