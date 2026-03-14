# 🤖 Ryan Bot v7: The Ultimate Handbook

**Ryan** is a premium, high-performance Discord engagement ecosystem. Designed for massive communities, it leverages a hybrid architecture—combining a robust **Node.js** enterprise core with a high-fidelity **Rust** rendering engine. 

Ryan doesn't just manage a server; it creates a living, breathing world through gamified moderation, faction warfare, and optimized engagement tracking.

---

## 🏛️ Technical Architecture

### Hybrid System Design
**Two-Process Architecture** running concurrently:
- **Discord Bot Core (Node.js 20+, discord.js v14):** Handles Discord events, commands, background jobs, and database interactions.
- **Rust Rendering Engine (Axum + resvg):** High-performance SVG-to-PNG conversion via a native Rust pipeline (offloading CPU-intensive work from the Node.js event loop).

### Performance Optimizations
- **UDS Redis Connectivity:** Prefers Unix Domain Sockets (`/run/redis/redis-server.sock`) for ultra-low latency, with automatic TCP fallback.
- **RAM Disk I/O:** Uses `/dev/shm` (Linux RAM Disk) for temporary file processing (GIF frames, icons), offering nanosecond latency vs standard SSD writes.
- **Micro-Batch XP Pipeline:** XP gain is buffered in memory and flushed to Redis every 1,000ms to minimize network overhead.
- **Write-Behind Synchronization:** XP is synced from Redis to PostgreSQL every **60 seconds** using an atomic "Rename-then-Process" strategy to ensure no data loss.
- **Live Leaderboard Updates:** Global leaderboard visuals and state are refreshed every **20 seconds** via a dedicated BullMQ cron worker.
- **Worker Thread Isolation:** GIF generation is isolated to dedicated worker threads using `ffmpeg` and `gifsicle` to prevent event loop blocking.
- **Self-Healing Architecture:** Automatic startup cleanup of stale renderer/chrome processes and port 3000 liberation.

---

## 🚀 Core Technology Stack

### Bot Technologies (Node.js)
- **Runtime:** Node.js 20+ (Strictly enforced).
- **Framework:** `discord.js v14.25.1`.
- **Database:** PostgreSQL with **Prisma ORM (v7.4.0)**.
- **Caching & State:** **Redis (v5.9.3)** using `ioredis`.
- **Image Processing:** `sharp` (0.34.5) & System `ffmpeg`/`gifsicle`.
- **Queue Management:** `BullMQ` (5.69.2) for reliable scheduled background jobs.
- **Validation:** `Zod` (4.3.6) for environment variables.
- **Monitoring:** `prom-client` (15.1.3) exposing metrics on port **9400**.

### Rust Rendering Service (Renderer/)
- **Framework:** `Axum` web server listening on port **3000**.
- **Engine:** `resvg` / `usvg` / `tiny-skia` with `Poppins-Bold` and `Symbola` fonts.
- **Memory:** `tikv-jemallocator` for long-term stability.
- **API Endpoints:**
    - `POST /render`: Rank Card generation.
    - `POST /render/leaderboard`: High-fidelity leaderboard visuals.
    - `POST /render/role-reward/base`: Reward template creation.
    - `POST /render/role-reward/final`: Personalized reward card delivery.
    - `GET /metrics`: Prometheus performance metrics.

---

## ⚙️ Service Architecture

### Core Services (`src/services/`)
- **XpService.js:** Scoring logic (Alpha: 1XP, Emoji/Sticker: 2XP) and automated role reward delivery (Channel Priority: Role Rewards > Leaderboard).
- **DatabaseService.js:** Prisma client management and **Stateless Hybrid Leaderboards** combining DB baselines with Redis hot buffers in-memory.
- **AssetService.js:** Handles storage and retrieval of assets via Discord message links.
- **XpSyncService.js:** Manages the lifecycle of XP data moving from Redis buffers to Postgres (60s cycle).
- **ResetService.js:** Unified 7-day cycle (Daily resets at 0:00, Weekly resets on Day 0).
- **PunishmentService.js:** 8-tier strike system with progressive jail durations (30m to 4w/Ban).
- **GifService.js:** Multi-vCPU GIF generation pipeline (Max 2 workers).
- **MetricsService.js:** Prometheus collection on port **9400** for Node, Redis pipeline, and Discord latency.
- **CustomRoleService.js / WeeklyRoleService.js:** Management of user-owned and reward roles.

### Event Handling & Commands
- **Command Architecture:** `CommandHandler.js` preloads slash commands.
- **Interactions:** `InteractionHandler.js` routes commands and validates permissions.
- **Profiles:** `RawProfileUpdateHandler.js` intercepts raw WebSocket packets to detect avatar/name changes instantly.
- **Reactions:** `ReactionHandler.js` implements stateless clan role switching via BullMQ.

---

## 📜 Key Command List

| Category | Commands |
| :--- | :--- |
| **Admin** | `reset-role`, `skip-cycle` |
| **Config** | `keyword`, `remove-clan-role`, `set-clan-role`, `setup-clan-icon`, `setup`, `setup-role-rewards` |
| **General** | `clans`, `help`, `hi`, `live`, `rank`, `reconnect`, `repeat` |
| **Mod** | `crime`, `jail`, `set-xp` |
| **Owner** | `setup-gif` |

---

## ⚔️ Key Systems & Features

### XP Engagement Core
- **Smart Scoring:** Alpha chars (**1 XP**), Emojis/Stickers (**2 XP**), URLs (**0 XP**) to prioritize quality.
- **Unified 7-Day Cycle:** Centralized management of Daily and Weekly XP resets across all servers simultaneously.
- **Alpha Pipeline:** Micro-batched Redis updates with DB verification guards to prevent data loss.

### Clan Wars Conquest
- **4-Faction Competition:** Dynamic visuals combining customized icons with high-octane backgrounds.
- **Stateless Participation:** Roles are mapped to clans via DB, allowing instant switching via reactions.
- **GIF Cache:** Hash-based caching system; reuses pre-generated GIFs if the leaderboard state is unchanged.

### The Torture Chamber
- **8-Tier Progression:** Punishments scale from 30 minutes to 4 weeks, culminating in a permanent ban.
- **Community Redemption:** Community-driven "Vote to Release" system for jailed members.

---

## ⚙️ Configuration (Env Vars)

- `DISCORD_BOT_TOKEN`, `CLIENT_ID`, `DATABASE_URL`: **Required**.
- `REGISTER_COMMANDS_GLOBALLY`: Boolean (default `false`).
- `DEV_GUILD_IDS`: Comma-separated list of test servers.
- `REDIS_SOCKET`: Unix socket path (optional, defaults to `/run/redis/redis-server.sock`).
- `REDIS_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`: TCP fallback configuration.

---

*Created with ❤️ for the world's best communities. Powered by Node.js, Prisma, and the speed of Rust.*
