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
}

#[derive(Deserialize, Debug)]
pub struct LeaderboardUser {
    pub user_id: String,
    pub username: String,
    pub emojis: Vec<EmojiData>,
    pub avatar_url: String,
    pub xp: i32,
    pub rank: i32,
}

#[derive(Deserialize, Debug)]
pub struct LeaderboardRequest {
    pub users: Vec<LeaderboardUser>,
    pub highlight_user_id: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct RoleRewardBaseRequest {
    pub role_name: Option<String>,
    pub emojis: Option<Vec<EmojiData>>,
    pub role_color: String, // hex e.g. "#FF5500"
    pub icon_url: Option<String>,
    pub icon_x: Option<u32>,
    pub icon_y: Option<u32>,
    pub icon_size: Option<u32>,
    pub text_x: Option<u32>,
    pub text_y: Option<u32>,
    pub font_size: Option<u32>,
}

#[derive(Deserialize, Debug)]
pub struct RoleRewardFinalRequest {
    pub base_image_b64: String, // base64-encoded PNG of the pre-rendered base image
    pub username: String,
    pub emojis: Option<Vec<EmojiData>>,
    pub text_x: Option<u32>,
    pub text_y: Option<u32>,
    pub font_size: Option<u32>,
}
