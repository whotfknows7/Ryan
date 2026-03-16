use axum::{Json, http::StatusCode, response::{IntoResponse, Response}, extract::State};
use reqwest::Client;
use base64::{engine::general_purpose, Engine as _};
use usvg::{Options, Tree, TreeParsing, TreePostProc};
use tiny_skia::Pixmap;
use std::io::Cursor;

fn to_png_b64(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "".to_string();
    }
    match image::load_from_memory(bytes) {
        Ok(img) => {
            let mut buf = Cursor::new(Vec::new());
            if img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                general_purpose::STANDARD.encode(&buf.into_inner())
            } else {
                "".to_string()
            }
        }
        Err(_) => "".to_string(),
    }
}

use crate::models::{RankCardRequest, RoleRewardBaseRequest};
use crate::template::{RankCardTemplate, RoleRewardBaseTemplate};
use crate::state::AppState;
use askama::Template;
use std::sync::Arc;
use std::time::Instant;

pub async fn render_rank_card(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RankCardRequest>,
) -> Response {
    let start = Instant::now();

    // 1. Fetch Discord Avatar & Convert to Base64
    let avatar_b64 = if let Some(cached) = state.avatar_cache.get(&payload.avatar_url).await {
        cached
    } else {
        let client = Client::new();
        let avatar_bytes = match client.get(&payload.avatar_url).send().await {
            Ok(res) if res.status().is_success() => res.bytes().await.unwrap_or_default().to_vec(),
            _ => {
                let mut buf = tokio::fs::read("./assets/default_avatar.png").await;
                if buf.is_err() {
                    buf = tokio::fs::read("../assets/default_avatar.png").await;
                }
                buf.unwrap_or_default()
            }
        };
        
        let b64 = to_png_b64(&avatar_bytes);
        
        if !payload.avatar_url.is_empty() && !b64.is_empty() {
            state.avatar_cache.insert(payload.avatar_url.clone(), b64.clone()).await;
        }
        
        b64
    };

    // 2. Math for Progress Bar (Max width is 500px)
    let progress_percent = if payload.next_xp > 0 {
        payload.current_xp as f64 / payload.next_xp as f64
    } else {
        1.0
    };
    let progress_width = (progress_percent * 500.0).clamp(0.0, 500.0);

    // 3. Populate Askama SVG Template (dynamic layer only — no bg rect, no trough)
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
    opt.font_family = "Poppins, DejaVu Sans, Noto Color Emoji, Symbola, sans-serif".to_string();

    // 5. Render SVG to PNG Bytes
    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to parse SVG").into_response(),
    };
    
    // Convert text to paths using the loaded font database
    rtree.postprocess(usvg::PostProcessingSteps::default(), &state.fontdb);

    // 6. Clone the pre-baked background pixmap — O(n) memcpy of pixel bytes.
    //    This pixmap already has the gradient background + progress trough painted.
    //    We composite the dynamic SVG layer directly on top.
    let mut pixmap = state.rank_card_bg.as_ref().clone();
    
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
    State(state): State<Arc<AppState>>,
    Json(payload): Json<crate::models::LeaderboardRequest>,
) -> Response {
    let start = Instant::now();
    let client = Client::new();

    let mut template_users = Vec::new();
    let mut y_pos = 10;
    
    // 1. Fetch ALL avatars concurrently
    let mut avatar_futures = Vec::new();
    for user in &payload.users {
        let client_clone = client.clone();
        let url = user.avatar_url.clone();
        let cache = state.avatar_cache.clone();
        avatar_futures.push(async move {
            if !url.is_empty() {
                if let Some(cached) = cache.get(&url).await {
                    return cached;
                }
                match client_clone.get(&url).send().await {
                    Ok(res) if res.status().is_success() => {
                        let bytes = res.bytes().await.unwrap_or_default().to_vec();
                        if bytes.is_empty() {
                            "".to_string()
                        } else {
                            let b64 = to_png_b64(&bytes);
                            if !b64.is_empty() {
                                cache.insert(url.clone(), b64.clone()).await;
                            }
                            b64
                        }
                    },
                    _ => "".to_string(),
                }
            } else {
                "".to_string()
            }
        });
    }

    let avatars_b64 = futures::future::join_all(avatar_futures).await;

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

    let font_data = include_bytes!("../../assets/fonts/Poppins-Bold.ttf");
    let face = ttf_parser::Face::parse(font_data, 0).unwrap();
    let units_per_em = face.units_per_em() as f64;
    let scale = 30.0 / units_per_em;

    let measure_text = |text: &str| -> f64 {
        text.chars().map(|c| {
            if let Some(glyph_id) = face.glyph_index(c) {
                if let Some(advance) = face.glyph_hor_advance(glyph_id) {
                    return advance as f64 * scale;
                }
            }
            if c == ' ' { return 8.0; } // Fallback for spaces if needed
            0.0
        }).sum()
    };

    for (i, user) in payload.users.into_iter().enumerate() {
        let avatar_b64 = avatars_b64[i].clone();

        let is_highlighted = payload.highlight_user_id.as_ref() == Some(&user.user_id);
        
        // 1. Measure precise widths
        let rank_text = format!("#{}", user.rank);
        let rank_width = measure_text(&rank_text);
        let separator_width = measure_text("|");
        
        // 2. Calculate horizontal positions dynamically with EXACT 20px gaps
        let rank_x_start = 75.0; // Fixed start past avatar
        let separator_x_start = rank_x_start + rank_width + 20.0;
        let username_x_start = separator_x_start + separator_width + 20.0;

        // Measure the xp width
        let xp_str = format!("XP: {} pts", format_xp(user.xp));
        let xp_width = measure_text(&xp_str);

        // Emoji total width
        let emoji_count = user.emojis.len();
        let emoji_total_width = if emoji_count > 0 {
            (emoji_count as f64) * 30.0 + ((emoji_count - 1) as f64) * 7.0 + 8.0 
        } else {
            0.0
        };

        let max_content_end = 775.0 - xp_width - 18.0 - separator_width - 20.0 - emoji_total_width;
        let max_username_width = max_content_end - username_x_start;

        let mut display_username = user.username.clone();

        let mut username_width = measure_text(&display_username);

        if username_width > max_username_width && max_username_width > 0.0 {
            let mut chars: Vec<char> = display_username.chars().collect();
            while username_width > max_username_width && !chars.is_empty() {
                chars.pop();
                display_username = format!("{}...", chars.iter().collect::<String>());
                username_width = measure_text(&display_username);
            }
        }

        // Generate template_emojis with x_offset calculated dynamically!
        let mut template_emojis = Vec::new();
        let mut current_emoji_x = username_x_start + username_width + 8.0;

        for emoji in user.emojis {
            let mut path = format!("./assets/emojis/{}.png", emoji.hex);
            if !std::path::Path::new(&path).exists() {
                path = format!("../assets/emojis/{}.png", emoji.hex);
            }
            let b64 = match tokio::fs::read(&path).await {
                Ok(bytes) => to_png_b64(&bytes),
                Err(_) => "".to_string(),
            };
            if !b64.is_empty() {
                template_emojis.push(crate::template::TemplateEmojiData {
                    b64,
                    x_offset: current_emoji_x,
                });
                current_emoji_x += 37.0; // 30 size + 7 gap
            }
        }

        // End of the content block (username + emojis)
        let content_end_x = username_x_start + username_width + if emoji_count > 0 { emoji_total_width } else { 0.0 };
        
        // Exact 20px gap for the second separator and 18px gap for XP text
        let separator2_x_start = content_end_x + 20.0;
        let xp_x_start = separator2_x_start + separator_width + 18.0;

        template_users.push(crate::template::TemplateUserData {
            username: display_username,
            avatar_b64,
            rank: user.rank,
            formatted_xp: format_xp(user.xp),
            emojis: template_emojis,
            rank_x_start,
            separator_x_start,
            username_x_start,
            separator2_x_start,
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
    opt.font_family = "Poppins, DejaVu Sans, Noto Color Emoji, Noto Sans Math, Noto Sans Arabic, Symbola, sans-serif".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(tree) => tree,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse SVG: {}", e)).into_response(),
    };
    
    rtree.postprocess(usvg::PostProcessingSteps::default(), &state.fontdb);

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

// =============================================================================
// Role Reward Renderers
// =============================================================================

/// POST /render/role-reward/base
/// Generates the "base" role reward image:
///   role_announcement_template.png + circle-clipped icon + role name text
pub async fn render_role_reward_base(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RoleRewardBaseRequest>,
) -> Response {
    let start = Instant::now();

    // 1. Load template PNG from disk
    let template_bytes = {
        let mut buf = tokio::fs::read("./assets/role template/role_announcement_template.png").await;
        if buf.is_err() {
            buf = tokio::fs::read("../assets/role template/role_announcement_template.png").await;
        }
        match buf {
            Ok(b) => b,
            Err(e) => {
                tracing::error!("Failed to read role template PNG: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Missing role template PNG").into_response();
            }
        }
    };

    // Decode the template to get its actual dimensions
    let template_pixmap = match Pixmap::decode_png(&template_bytes) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to decode role template PNG: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to decode role template PNG").into_response();
        }
    };
    let canvas_width  = template_pixmap.width();
    let canvas_height = template_pixmap.height();

    let template_b64 = general_purpose::STANDARD.encode(&template_bytes);

    // 2. Fetch the role icon (if provided)
    let icon_b64 = if let Some(ref url) = payload.icon_url {
        if !url.is_empty() {
            if let Some(cached) = state.avatar_cache.get(url).await {
                cached
            } else {
                let client = Client::new();
                match client.get(url).send().await {
                    Ok(res) if res.status().is_success() => {
                        let bytes = res.bytes().await.unwrap_or_default().to_vec();
                        if bytes.is_empty() {
                            String::new()
                        } else {
                            let b64 = to_png_b64(&bytes);
                            if !b64.is_empty() {
                                state.avatar_cache.insert(url.clone(), b64.clone()).await;
                            }
                            b64
                        }
                    }
                    _ => String::new(),
                }
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Canvas is 3041x894. We want a large left avatar and nicely stacked text next to it.
    // Avatar: size 600, centered vertically (894-600)/2 = 147. Margin left 200.
    // Text: nicely stacked next to the avatar. x=950.
    let template = RoleRewardBaseTemplate {
        template_b64,
        icon_b64,
        role_name: payload.role_name.clone(),
        role_color: payload.role_color.clone(),
        canvas_width,
        canvas_height,
        icon_x: 200,
        icon_y: 147,
        icon_size: 600,
        icon_cx: 500,
        icon_cy: 447,
        icon_radius: 300,
        text_x: 1132,
        text_y: 780, // Role name baseline (bottom line)
        font_size: 190,
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG template error: {}", e)).into_response(),
    };

    // 4. Render SVG → PNG
    let mut opt = Options::default();
    opt.font_family = "Poppins, DejaVu Sans, sans-serif".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(t) => t,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG parse error: {}", e)).into_response(),
    };
    rtree.postprocess(usvg::PostProcessingSteps::default(), &state.fontdb);

    let mut pixmap = match Pixmap::new(canvas_width, canvas_height) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    let duration = start.elapsed().as_secs_f64();
    metrics::histogram!("renderer_role_reward_base_duration_seconds").record(duration);
    tracing::debug!("Role reward base rendered in {:.3}s", duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}

/// POST /render/role-reward/final
/// Overlays the username onto the pre-rendered base image.
///   username: x=1132, y=480 baseline, font-size=160 (stacked above role name)
pub async fn render_role_reward_final(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<crate::models::RoleRewardFinalRequest>,
) -> Response {
    let start = Instant::now();

    // 1. Decode base image to get its dimensions
    let base_bytes = match general_purpose::STANDARD.decode(&payload.base_image_b64) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid base64 in base_image_b64").into_response(),
    };

    let base_pixmap = match Pixmap::decode_png(&base_bytes) {
        Ok(p) => p,
        Err(_) => return (StatusCode::BAD_REQUEST, "base_image_b64 is not a valid PNG").into_response(),
    };
    let canvas_width  = base_pixmap.width();
    let canvas_height = base_pixmap.height();

    // 2. Build the SVG — embed base image + draw username text
    let template = crate::template::RoleRewardFinalTemplate {
        base_b64: payload.base_image_b64.clone(),
        username: payload.username.clone(),
        canvas_width,
        canvas_height,
        text_x: 1132,
        text_y: 480, // Username baseline (top line, stacked above role name)
        font_size: 160,
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG template error: {}", e)).into_response(),
    };

    // 3. Render SVG → PNG
    let mut opt = Options::default();
    opt.font_family = "Poppins, DejaVu Sans, sans-serif".to_string();

    let mut rtree = match Tree::from_str(&svg_string, &opt) {
        Ok(t) => t,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG parse error: {}", e)).into_response(),
    };
    rtree.postprocess(usvg::PostProcessingSteps::default(), &state.fontdb);

    let mut pixmap = match Pixmap::new(canvas_width, canvas_height) {
        Some(p) => p,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to allocate pixmap").into_response(),
    };
    resvg::render(&rtree, usvg::Transform::default(), &mut pixmap.as_mut());

    let png_bytes = match pixmap.encode_png() {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to encode PNG").into_response(),
    };

    let duration = start.elapsed().as_secs_f64();
    metrics::histogram!("renderer_role_reward_final_duration_seconds").record(duration);
    tracing::debug!("Role reward final rendered in {:.3}s", duration);

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        png_bytes,
    ).into_response()
}

// Removed escape_xml as it is no longer used.
