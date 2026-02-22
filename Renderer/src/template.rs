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
