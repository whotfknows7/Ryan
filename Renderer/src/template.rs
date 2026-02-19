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

#[derive(Template)]
#[template(path = "mugshot.svg", escape = "xml")]
pub struct MugshotTemplate {
    pub username: String,
    pub avatar_b64: String,
    pub background_color: String,
}
