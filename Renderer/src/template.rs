use crate::models::RenderRequest;
use askama::Template;
use anyhow::Result;

#[derive(Template)]
#[template(path = "rank_card.html")]
struct RankCardTemplate<'a> {
    username: &'a str,
    avatar_base64: &'a str,
    hex_color: String,
    weekly_xp: i32,
    all_time_xp: i32,
    weekly_rank: i32,
    all_time_rank: i32,
}

pub fn generate_rank_card_html(data: &RenderRequest) -> Result<String> {
    let sanitized_color = sanitize_hex(&data.hex_color);
    
    let template = RankCardTemplate {
        username: &data.username,
        avatar_base64: &data.avatar_base64,
        hex_color: sanitized_color,
        weekly_xp: data.weekly_xp,
        all_time_xp: data.all_time_xp,
        weekly_rank: data.weekly_rank,
        all_time_rank: data.all_time_rank,
    };
    
    Ok(template.render()?)
}

fn sanitize_hex(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{}", hex)
    } else {
        "#00d4ff".to_string() // fallback cyan
    }
}
