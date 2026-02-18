use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct RankCardRequest {
    pub username: String,
    pub avatar_url: String,
    pub current_xp: i32,
    pub next_xp: i32,
    pub rank: i32,
    pub clan_color: String,
}

#[derive(Debug, Serialize)]
pub struct RenderResponse {
    pub success: bool,
    pub message: String,
}
