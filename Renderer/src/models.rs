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
pub struct LeaderboardUser {
    pub user_id: String,
    pub username: String,
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
    pub role_name: String,
    pub role_color_hex: String,
    pub icon_url: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct RoleRewardFinalRequest {
    pub base_image_b64: String,
    pub username: String,
}
