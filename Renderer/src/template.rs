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

pub struct TemplateUserData {
    pub username: String,
    pub avatar_b64: String,
    pub rank: i32,
    pub formatted_xp: String,
    pub bg_color: String,
    pub y_pos: i32,
    pub separator_x: f64,
    pub username_x: f64,
    pub xp_x: f64,
}

#[derive(Template)]
#[template(path = "leaderboard.svg", escape = "xml")]
pub struct LeaderboardTemplate {
    pub users: Vec<TemplateUserData>,
    pub height: i32,
}

#[derive(Template)]
#[template(path = "role_reward_base.svg", escape = "xml")]
pub struct BaseRewardTemplate {
    pub role_name: String,
    pub role_color_hex: String,
    pub icon_b64: Option<String>,
}

#[derive(Template)]
#[template(path = "role_reward_final.svg", escape = "xml")]
pub struct FinalRewardTemplate {
    pub base_image_b64: String,
    pub username: String,
}
