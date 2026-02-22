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
use metrics_exporter_prometheus::PrometheusBuilder;

// Use jemalloc to prevent memory fragmentation in long-running service
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with environment variable support
    let rust_log = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let filter = tracing_subscriber::EnvFilter::new(format!("{},usvg_text_layout=error", rust_log));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Renderer Microservice (SVG Edition)...");
    tracing::info!("Using jemalloc for memory management");

    let mut fontdb = usvg::fontdb::Database::new();
    fontdb.load_system_fonts();
    tracing::info!("Loaded system fonts.");
    let font_data = include_bytes!("../../assets/fonts/TT Fors Trial Bold.ttf");
    fontdb.load_font_data(font_data.to_vec());
    tracing::info!("Loaded TT Fors Trial Bold font.");
    
    let fontdb_arc = Arc::new(fontdb);

    // Initialize Prometheus recorder
    let builder = PrometheusBuilder::new();
    let handle = builder
        .install_recorder()
        .expect("failed to install Prometheus recorder");

    // Build router with middleware
    let app = Router::new()
        .route("/render", post(handler::render_rank_card))
        .route("/render/leaderboard", post(handler::render_leaderboard))
        .route("/metrics", get(move || {
            // println!("Metrics endpoint hit!");
            metrics::counter!("renderer_metrics_requests").increment(1);
            let output = handle.render();
           // println!("Metrics output length: {}", output.len());
            std::future::ready(output)
        }))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(fontdb_arc);

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