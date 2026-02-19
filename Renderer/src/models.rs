use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum RenderRequest {
    #[serde(rename = "rank_card")]
    RankCard {
        username: String,
        avatar_url: String,
        current_xp: i32,
        next_xp: i32,
        rank: i32,
        clan_color: String,
    },
    #[serde(rename = "mugshot")]
    Mugshot {
        username: String,
        avatar_url: String,
        background_color: Option<String>,
    },
}

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
pub struct MugshotRequest {
    pub username: String,
    pub avatar_url: String,
    pub background_color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RenderResponse {
    pub success: bool,
    pub message: String,
}
