use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct RankCardRequest {
    pub username: String,
    pub avatar_url: String,
    pub current_xp: i32,
    pub next_xp: i32,
    pub rank: i32,
    pub clan_color: String,
}

#[derive(Deserialize, Debug)]
pub struct EmojiData {
    pub hex: String,
    pub x_offset: f64,
}

#[derive(Deserialize, Debug)]
pub struct LeaderboardUser {
    pub user_id: String,
    pub username: String,
    pub emojis: Vec<EmojiData>,
    pub avatar_url: String,
    pub xp: i32,
    pub rank: i32,
    pub text_end_x: f64,
}

#[derive(Deserialize, Debug)]
pub struct LeaderboardRequest {
    pub users: Vec<LeaderboardUser>,
    pub highlight_user_id: Option<String>,
}


