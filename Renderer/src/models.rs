// Ryan v6/Renderer/src/models.rs
use serde::Deserialize;

#[derive(Deserialize)]
pub struct RenderRequest {
    pub username: String,
    pub avatar_base64: String,
    pub hex_color: String,
    // [NEW] Fields
    pub weekly_xp: i32,
    pub all_time_xp: i32,
    pub weekly_rank: i32,
    pub all_time_rank: i32,
}


#[derive(Debug, Serialize)]
pub struct RenderResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug)]
pub struct BrowserStats {
    pub render_count: usize,
    pub last_health_check: std::time::Instant,
}

impl Default for BrowserStats {
    fn default() -> Self {
        Self {
            render_count: 0,
            last_health_check: std::time::Instant::now(),
        }
    }
}
