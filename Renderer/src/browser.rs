
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;
use chromiumoxide::page::Page;
use std::sync::Arc;
use tokio::sync::{RwLock, Semaphore};
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};
use futures::StreamExt;

use crate::models::BrowserStats;

const MAX_RENDERS_BEFORE_RESTART: usize = 500;
const BROWSER_SEMAPHORE_PERMITS: usize = 2;
const ANIMATION_WAIT_MS: u64 = 2000;

pub struct BrowserManager {
    browser: Arc<RwLock<Option<Browser>>>,
    stats: Arc<RwLock<BrowserStats>>,
    semaphore: Arc<Semaphore>,
    shutdown_tx: tokio::sync::mpsc::Sender<()>,
}

impl BrowserManager {
    pub async fn new() -> anyhow::Result<Self> {
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel(1);
        
        let manager = Self {
            browser: Arc::new(RwLock::new(None)),
            stats: Arc::new(RwLock::new(BrowserStats::default())),
            semaphore: Arc::new(Semaphore::new(BROWSER_SEMAPHORE_PERMITS)),
            shutdown_tx,
        };

        // Initial browser spawn
        manager.spawn_browser().await?;

        // Start health check task
        let browser_clone = Arc::clone(&manager.browser);
        let stats_clone = Arc::clone(&manager.stats);
        
        tokio::spawn(async move {
            let mut check_interval = interval(Duration::from_secs(30));
            
            loop {
                tokio::select! {
                    _ = check_interval.tick() => {
                        let stats = stats_clone.read().await;
                        if stats.render_count >= MAX_RENDERS_BEFORE_RESTART {
                            drop(stats);
                            warn!("Browser reached {} renders, triggering restart", MAX_RENDERS_BEFORE_RESTART);
                            if let Err(e) = Self::restart_browser_internal(&browser_clone, &stats_clone).await {
                                error!("Failed to restart browser: {}", e);
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!("Health check task shutting down");
                        break;
                    }
                }
            }
        });

        Ok(manager)
    }

    async fn spawn_browser(&self) -> anyhow::Result<()> {
        let config = BrowserConfig::builder()
            .arg("--no-sandbox")
            .arg("--disable-gpu")
            .arg("--disable-dev-shm-usage")
            .arg("--single-process")
            .arg("--no-zygote")
            .arg("--disable-background-timer-throttling")
            .arg("--disable-backgrounding-occluded-windows")
            .arg("--disable-renderer-backgrounding")
            .arg("--disable-features=TranslateUI")
            .arg("--disable-ipc-flooding-protection")
            .arg("--memory-model=low")
            .arg("--max_old_space_size=512")
            .arg("--disable-extensions")
            .arg("--disable-plugins")
            .window_size(1000, 300)
            .build()?;

        let (browser, mut handler) = Browser::launch(config).await?;
        
        // Spawn handler task
        tokio::spawn(async move {
            while let Some(h) = handler.next().await {
                if h.is_err() {
                    break;
                }
            }
        });

        let mut guard = self.browser.write().await;
        *guard = Some(browser);
        
        let mut stats = self.stats.write().await;
        *stats = BrowserStats::default();
        
        info!("Browser spawned successfully");
        Ok(())
    }

    async fn restart_browser_internal(
        browser: &Arc<RwLock<Option<Browser>>>,
        stats: &Arc<RwLock<BrowserStats>>,
    ) -> anyhow::Result<()> {
        info!("Restarting browser...");
        
        // Close existing browser
        {
            let mut guard = browser.write().await;
            if let Some(b) = guard.take() {
                drop(b);
            }
        }

        // Brief pause to ensure cleanup
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Spawn new browser with optimized config
        let config = BrowserConfig::builder()
            .arg("--no-sandbox")
            .arg("--disable-gpu")
            .arg("--disable-dev-shm-usage")
            .arg("--single-process")
            .arg("--no-zygote")
            .window_size(1000, 300)
            .build()?;

        let (new_browser, mut handler) = Browser::launch(config).await?;
        
        tokio::spawn(async move {
            while let Some(h) = handler.next().await {
                if h.is_err() {
                    break;
                }
            }
        });

        {
            let mut guard = browser.write().await;
            *guard = Some(new_browser);
        }
        
        {
            let mut s = stats.write().await;
            s.render_count = 0;
            s.last_health_check = std::time::Instant::now();
        }

        info!("Browser restarted successfully");
        Ok(())
    }

    pub async fn render_html(&self, html: &str) -> anyhow::Result<Vec<u8>> {
        let _permit = self.semaphore.acquire().await?;
        
        let browser_guard = self.browser.read().await;
        let browser = browser_guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Browser not initialized"))?;
        
        // Create new page
        let page = browser.new_page("about:blank").await?;
        
        // Set content and wait for load
        page.set_content(html).await?;
        
        // Wait for animations to complete
        tokio::time::sleep(Duration::from_millis(ANIMATION_WAIT_MS)).await;
        
        // Wait for ready signal from JS (optional, won't fail if not present)
        page.wait_for_function("window.cardReady === true")
            .await
            .ok();
        
        // Capture screenshot
        let screenshot = page
            .save_screenshot(CaptureScreenshotFormat::Png, true)
            .await?;
        
        // Close page immediately
        page.close().await.ok();
        
        // Update stats
        {
            let mut stats = self.stats.write().await;
            stats.render_count += 1;
            stats.last_health_check = std::time::Instant::now();
        }
        
        Ok(screenshot)
    }

    pub async fn force_restart(&self) -> anyhow::Result<()> {
        Self::restart_browser_internal(&self.browser, &self.stats).await
    }
}

impl Drop for BrowserManager {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.try_send(());
    }
}