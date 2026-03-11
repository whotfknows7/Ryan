use askama::Template;

#[derive(Template)]
#[template(path = "rank_card.svg", escape = "xml")]
pub struct RankCardTemplate {
    pub username: String,
    pub avatar_b64: String,
    pub current_xp: i32,
    pub next_xp: i32,
    pub rank: i32,
    pub clan_color: String,
    pub progress_width: f64,
}

pub struct TemplateEmojiData {
    pub b64: String,
    pub x_offset: f64,
}

pub struct TemplateUserData {
    pub username: String,
    pub avatar_b64: String,
    pub rank: i32,
    pub formatted_xp: String,
    pub emojis: Vec<TemplateEmojiData>,
    pub rank_x_start: f64,
    pub separator_x_start: f64,
    pub username_x_start: f64,
    pub separator2_x_start: f64,
    pub bg_color: String,
    pub y_pos: i32,
    pub xp_x_start: f64,
}

#[derive(Template)]
#[template(path = "leaderboard.svg", escape = "xml")]
pub struct LeaderboardTemplate {
    pub users: Vec<TemplateUserData>,
    pub height: i32,
}

// ─── Role Reward Templates ────────────────────────────────────────────────────

/// Rendered as an SVG that embeds the template PNG + icon + role name text.
/// All coordinates match the original Node.js canvas geometry:
///   - Template size: 3041 × 894
///   - Icon:  x=74, y=67, size=171×172, clipped to circle (cx=159, cy=153, r=85)
///   - Role name: x=298, y=159 (baseline), font-size=50
#[derive(Template)]
#[template(path = "role_reward_base.svg", escape = "xml")]
pub struct RoleRewardBaseTemplate {
    pub template_b64: String,
    pub icon_b64: String,
    pub role_name: String,
    pub role_color: String,
    // canvas
    pub canvas_width: u32,
    pub canvas_height: u32,
    // icon geometry
    pub icon_x: u32,
    pub icon_y: u32,
    pub icon_size: u32,
    pub icon_cx: u32, // clip-path circle centre
    pub icon_cy: u32,
    pub icon_radius: u32,
    // text geometry
    pub text_x: u32,
    pub text_y: u32,
    pub font_size: u32,
}

/// Renders the pre-baked base image + username text overlay.
/// Username: x=298, y=241 (baseline), font-size=40 — matches generateFinalReward.
#[derive(Template)]
#[template(path = "role_reward_final.svg", escape = "xml")]
pub struct RoleRewardFinalTemplate {
    pub base_b64: String,
    pub username: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub text_x: u32,
    pub text_y: u32,
    pub font_size: u32,
}
