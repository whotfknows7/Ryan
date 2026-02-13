
mod browser;
mod handler;
mod models;
mod template;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};


// Use jemalloc to prevent memory fragmentation in long-running service
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

use crate::browser::BrowserManager;

#[derive(Clone)]
pub struct AppState {
    pub browser_manager: Arc<BrowserManager>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with environment variable support
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Renderer Microservice...");
    tracing::info!("Using jemalloc for memory management");
    tracing::info!("Initializing Browser Manager...");

    // Initialize browser manager
    let browser_manager = Arc::new(BrowserManager::new().await?);
    let state = AppState { browser_manager };

    // Build router with middleware
    let app = Router::new()
        .route("/render", post(handler::render_rank_card))
        .route("/health", get(handler::health_handler))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Renderer listening on {}", addr);

    // Start server with graceful shutdown
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Server shutdown complete");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("Received Ctrl+C"),
        _ = terminate => tracing::info!("Received SIGTERM"),
    }

    tracing::info!("Shutting down gracefully...");
}