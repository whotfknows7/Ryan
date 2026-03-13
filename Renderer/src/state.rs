use std::sync::Arc;
use moka::future::Cache;
use tiny_skia::Pixmap;
use usvg::fontdb::Database;

pub struct AppState {
    pub fontdb: Arc<Database>,
    pub rank_card_bg: Arc<Pixmap>,
    pub avatar_cache: Cache<String, String>,
}
