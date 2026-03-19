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

/// Normalizes fancy mathematical alphanumeric characters back to standard Latin characters
fn normalize_discord_name(input: &str) -> String {
    input.chars().map(|c| {
        let u = c as u32;
        match u {
            // Mathematical Bold Capital (A-Z) -> 𝐆, 𝐅, etc.
            0x1D400..=0x1D419 => std::char::from_u32(u - 0x1D400 + 0x0041).unwrap_or(c),
            // Mathematical Bold Small (a-z)
            0x1D41A..=0x1D433 => std::char::from_u32(u - 0x1D41A + 0x0061).unwrap_or(c),
            // Mathematical Italic Capital
            0x1D434..=0x1D44D => std::char::from_u32(u - 0x1D434 + 0x0041).unwrap_or(c),
            // Mathematical Italic Small
            0x1D44E..=0x1D467 => std::char::from_u32(u - 0x1D44E + 0x0061).unwrap_or(c),
            // Mathematical Script Capital (e.g., 𝓨)
            0x1D49C..=0x1D4B5 => std::char::from_u32(u - 0x1D49C + 0x0041).unwrap_or(c),
            // Mathematical Script Small (e.g., 𝓮, 𝓸, 𝓵)
            0x1D4B6..=0x1D4CF => std::char::from_u32(u - 0x1D4B6 + 0x0061).unwrap_or(c),
            // Mathematical Fraktur Capital (e.g., 𝔐)
            0x1D504..=0x1D51D => std::char::from_u32(u - 0x1D504 + 0x0041).unwrap_or(c),
            // Mathematical Fraktur Small (e.g., 𝔞, 𝔰, 𝔥)
            0x1D51E..=0x1D537 => std::char::from_u32(u - 0x1D51E + 0x0061).unwrap_or(c),
            _ => c,
        }
    }).collect()
}

/// Detects if a string contains non-standard scripts (including Latin Extended) 
/// that require a unified system font to avoid the "Frankenstein" effect.
fn requires_system_font(text: &str) -> bool {
    text.chars().any(|c| {
        let u = c as u32;
        
        // 1. Latin Extended (Catches Ş, æ, ø, ğ, ł, á, etc.)
        (0x0080..=0x02AF).contains(&u) ||
        
        // 2. Greek, Cyrillic, Arabic, Indic, Thai, etc.
        (0x0370..=0x1FFF).contains(&u) || 
        
        // 3. CJK Ideographs & Kana
        (0x2E80..=0x9FFF).contains(&u) || 
        
        // 4. Hangul (Korean)
        (0xAC00..=0xD7AF).contains(&u) || 
        
        // 5. CJK Compatibility & Arabic Presentation
        (0xF900..=0xFDFF).contains(&u) ||
        (0xFE70..=0xFEFF).contains(&u) ||
        
        // 6. Fullwidth Forms
        (0xFF00..=0xFFEF).contains(&u) ||
        
        // 7. CJK Extensions
        (0x20000..=0x2FA1F).contains(&u)
    })
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
    let normalized_username = normalize_discord_name(&payload.username);
    let use_system_font = requires_system_font(&normalized_username);

    let template = RankCardTemplate {
        username: normalized_username,
        avatar_b64,
        current_xp: payload.current_xp,
        next_xp: payload.next_xp,
        rank: payload.rank,
        level: payload.level,
        clan_color: payload.clan_color,
        progress_width,
        use_system_font,
    };
    let svg_string = match template.render() {
        Ok(s) => s,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to render template").into_response(),
    };

    // 4. Setup resvg & Font options
    let mut opt = Options::default();
    opt.font_family = "Poppins, DejaVu Sans, Noto Color Emoji, Noto Sans Math, Symbola, sans-serif".to_string();

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
            2 => "#CECECE".to_string(),
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

    // 1. Load Poppins
    let poppins_data = include_bytes!("../../assets/fonts/Poppins-Bold.ttf");
    let poppins_face = ttf_parser::Face::parse(poppins_data, 0).unwrap();
    let poppins_scale = 30.0 / poppins_face.units_per_em() as f64;

    // 2. Load Math Font
    let math_data = include_bytes!("../../assets/fonts/NotoSansMath-Regular.ttf");
    let math_face = ttf_parser::Face::parse(math_data, 0).unwrap();
    let math_scale = 30.0 / math_face.units_per_em() as f64;

    // 3. Load Symbola
    let symbola_data = include_bytes!("../../assets/fonts/Symbola.ttf");
    let symbola_face = ttf_parser::Face::parse(symbola_data, 0).unwrap();
    let symbola_scale = 30.0 / symbola_face.units_per_em() as f64;

    // 4. Bulletproof measuring closure
    let measure_text = |text: &str| -> f64 {
        text.chars().map(|c| {
            let u = c as u32;

            // 1. HARD OVERRIDES (Execute BEFORE font parsing to prevent bad metrics)
            // Em Space, Em Quad, Ideographic Space
            if u == 0x2001 || u == 0x2003 || u == 0x3000 { return 30.0; } 
            // En Space, En Quad
            if u == 0x2000 || u == 0x2002 { return 15.0; } 
            // Standard Space & NBSP
            if u == 0x0020 || u == 0x00A0 { return 8.0; } 
            
            // CJK Ideographs (Force full-width 1em since they use fallback fonts)
            if (0x4E00..=0x9FFF).contains(&u) || (0x3400..=0x4DBF).contains(&u) || (0xFF00..=0xFFEF).contains(&u) {
                return 30.0; 
            }

            // 2. Try Poppins First
            if let Some(glyph_id) = poppins_face.glyph_index(c) {
                if glyph_id.0 != 0 { // Explicitly ignore the .notdef missing box
                    if let Some(advance) = poppins_face.glyph_hor_advance(glyph_id) {
                        return advance as f64 * poppins_scale;
                    }
                }
            }
            // 3. Try Math Font Fallback
            if let Some(glyph_id) = math_face.glyph_index(c) {
                if glyph_id.0 != 0 {
                    if let Some(advance) = math_face.glyph_hor_advance(glyph_id) {
                        return advance as f64 * math_scale;
                    }
                }
            }
            // 4. Try Symbola Fallback
            if let Some(glyph_id) = symbola_face.glyph_index(c) {
                if glyph_id.0 != 0 {
                    if let Some(advance) = symbola_face.glyph_hor_advance(glyph_id) {
                        return advance as f64 * symbola_scale;
                    }
                }
            }
            
            // 5. Ultimate Fallback for unmapped characters (e.g., Thai)
            24.0 
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
        let xp_str = format!("Lvl {} • XP: {} pts", user.level, format_xp(user.xp));
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

        // Normalize fancy fonts before measuring or rendering
        let mut display_username = normalize_discord_name(&user.username);

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

        let use_system_font = requires_system_font(&display_username);

        template_users.push(crate::template::TemplateUserData {
            username: display_username,
            avatar_b64,
            rank: user.rank,
            level: user.level,
            formatted_xp: format_xp(user.xp),
            emojis: template_emojis,
            rank_x_start,
            separator_x_start,
            username_x_start,
            separator2_x_start,
            bg_color: get_bg_color(user.rank, is_highlighted),
            y_pos,
            xp_x_start,
            use_system_font,
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
    let icon_x = payload.icon_x.unwrap_or(180);
    let icon_y = payload.icon_y.unwrap_or(147);
    let icon_size = payload.icon_size.unwrap_or(600);

    let role_name = payload.role_name.clone().unwrap_or_else(|| "HOMOSAPIEN".to_string());
    let font_size = payload.font_size.unwrap_or(190);
    let text_x = payload.text_x.unwrap_or(885);
    let text_y = payload.text_y.unwrap_or(500);

    let mut template_emojis = Vec::new();
    let mut current_emoji_x = text_x as f64;
    let emoji_size = font_size as f64;

    if let Some(emojis) = &payload.emojis {
        for emoji in emojis {
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
                current_emoji_x += emoji_size + 15.0;
            }
        }
    }

    let text_x_after_emojis = current_emoji_x as u32;

    let template = RoleRewardBaseTemplate {
        template_b64,
        icon_b64,
        role_name,
        emojis: template_emojis,
        role_color: payload.role_color.clone(),
        canvas_width,
        canvas_height,
        icon_x,
        icon_y,
        icon_size,
        text_x: text_x_after_emojis,
        text_y, // Pulls the bottom line up significantly
        font_size,
        emoji_y: text_y as f64 - font_size as f64 + (font_size as f64 * 0.15),
    };

    let svg_string = match template.render() {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("SVG template error: {}", e)).into_response(),
    };

    // 4. Render SVG → PNG
    let mut opt = Options::default();
     opt.font_family = "Poppins, DejaVu Sans, Noto Color Emoji, Noto Sans Math, Symbola, sans-serif".to_string();

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

