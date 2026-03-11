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
- **RAM Disk I/O:** Uses `/dev/shm` (Linux RAM Disk) for temporary file processing (GIF frames, icons), offering nanosecond latency vs standard SSD writes.
- **3-Phase Role Reward Validation:** High-speed RAM cache check → Member verification → Execution to handle chat floods efficiently without hitting Discord API limits.
- **Worker Thread Isolation:** GIF generation is isolated to dedicated worker threads to prevent bot latency during heavy rendering jobs.
- **Self-Healing Architecture:** Automatic zombie process cleanup (Chrome/Renderer/Ports) on startup and graceful shutdown handling.

---

## 🚀 Core Technology Stack

### Bot Technologies (Node.js)
- **Runtime:** Node.js 20+ with strict engine requirements.
- **Framework:** `discord.js v14.25.1` for Discord API integration.
- **Database:** PostgreSQL with **Prisma ORM (v7.4.0)** for type-safe database operations.
- **Caching & State:** **Redis (v5.9.3)** for live leaderboards, XP buffering, and cross-process Pub/Sub.
- **Image Processing:** `sharp` (0.34.5) for resizing and basic image manipulation.
- **GIF Generation:** System `ffmpeg` and `gifsicle` via `worker_threads` for heavy lifting.
- **Queue Management:** `BullMQ` (5.69.2) for reliable scheduled background jobs.
- **Validation & Safety:** `Zod` (4.3.6) for environment variables; `rate-limiter-flexible` for API protection.
- **Monitoring:** `prom-client` (15.1.3) for Prometheus performance metrics.

### Rust Rendering Service
- **Framework:** `Axum` web server for high-concurrency HTTP API.
- **Engine:** `resvg` / `usvg` / `tiny-skia` for lightning-fast SVG-to-PNG transformation.
- **Memory:** `tikv-jemallocator` for long-running stability and fragmentation prevention.
- **Template Engine:** `Askama` for type-safe SVG template rendering with dynamic data injection.

---

## 📊 Database Schema (Prisma)

### Core Models
- **UserXp:** Tracks user experience points with lifetime, daily, weekly counters, and clan associations.
- **GuildConfig:** Multi-guild configuration storage (reaction roles, keywords, clans, role rewards, IDs).
- **JailLog:** Prison system with strike tracking and a vote-based release system.
- **ResetCycle:** Manages the Unified 7-Day Reset Cycle, where dailyXp and weeklyXp are automatically managed for every server concurrently.
- **LeaderboardState:** Persistent leaderboard message state management.
- **GifTemplate / ClanAsset:** Dynamic clan GIF generation templates and cached role icons.
- **GifCache:** Hash-based GIF caching system to skip redundant renders.

### Indexing Strategy
- **Compound Indexes:** Optimized for `[guildId, xp/dailyXp/weeklyXp]` to ensure instant leaderboard queries.
- **Faction Indexing:** Indexing on `clanId` for rapid faction-based aggregations.
- **Uniqueness:** Strict unique constraints for `guild-user` combinations and role-based assets.

---

## ⚙️ Service Architecture

### Core Services (`src/services/`)
- **XpService.js:** Main XP processing, scoring logic, and keyword reaction handling.
- **DatabaseService.js:** Prisma client management, atomic JSON updates, and Redis ZSET interactions.
- **AssetService.js:** External asset fetching and Discord message-link image retrieval.
- **XpSyncService.js:** "Write-Behind" synchronization from Redis buffers to PostgreSQL.
- **LeaderboardUpdateService.js:** Real-time leaderboard generation and Discord message integration.
- **ImageService.js:** Orchestrates rank card and reward generation via the Rust microservice.
- **GifService.js:** Clan warfare GIF generation pipeline with animated background processing.
- **CustomRoleService.js:** Management of user-owned custom roles.
- **WeeklyRoleService.js:** Automated delivery of rewards for weekly leaderboard winners.
- **PunishmentService.js:** 8-tier strike system with progressive jail management.
- **ConfigService.js:** Abstracted management of guild-specific JSON configurations.
- **ResetService.js:** Unified 7-day reset logic driven by cron jobs.
- **MetricsService.js:** Prometheus collection (latency, cache hits, queue sizes).

### Event Handling & Commands
- **Command Architecture:** `CommandHandler.js` preloads slash commands into the client.
- **Interactions:** `InteractionHandler.js` routes slash commands and validates parameters.
- **Messages:** `MessageIntentHandler.js` processes content-based triggers and logic.
- **Profiles:** `RawProfileUpdateHandler.js` intercepts raw WebSocket packets for avatar/name changes.
- **Reactions:** `ReactionHandler.js` processes emoji-based interaction flows via BullMQ.

---

## ⚔️ Key Systems & Features

### XP Engagement Core
- **Smart Scoring:** Alpha characters (**1 XP**), Emojis (**2 XP**), Stickers (**2 XP**) to prioritize quality engagement.
- **3-Phase Verification:** RAM cache check → Member refetch → Execution with rich announcements and Level-Up cards.
- **Unified 7-Day Reset Cycle:** Automatically manages dailyXp and weeklyXp concurrently across all servers.

### Clan Wars Conquest
- **4-Faction Competition:** Dynamic visuals combining customized icons with high-octane backgrounds.
- **Automated Sync:** User XP is automatically "poured" into clan pools daily.
- **GIF Pipeline:** Uses message-link hashing; if a state hasn't changed, retrieves the pre-generated GIF instead of re-rendering.

### The Torture Chamber (Moderation)
- **8-Tier Strike System:** Progressive punishment from a 30-minute mute to a permanent server ban.
- **Community Redemption:** Allows members to **Vote to Release** prisoners, shortening their sentences.

---

## 🛠️ Development & Operations

### Build System
- `npm run setup`: Automated dependency install and Rust renderer compilation.
- `npm run dev`: Concurrent execution of both Node.js (with watch mode) and Rust services.
- `Prisma Workflow`: Automated schema pushing (`db push`) and client generation.

### Performance & Health
- **Database Heartbeat:** 5-minute integrity checks with detailed latency logging.
- **Graceful Shutdown:** Proper cleanup of DB pools, Redis connections, and child process groups on `SIGTERM`.
- **Zod Validation:** Strict validation of all environment variables (TOKEN, DATABASE_URL, REDIS_URL) on startup.

---

## 📂 File Organization
```text
Ryan/
├── src/
│   ├── commands/         # admin, config, general, moderation, owner
│   ├── services/         # Core business logic layer
│   ├── handlers/         # Event and interaction routing
│   ├── structures/       # Custom Discord Client extensions
│   ├── workers/          # Heavy GIF/FFmpeg processing threads
│   ├── events/           # Discord event specific listeners
│   ├── config/           # Redis and Logger initialization
│   ├── utils/            # Shared helpers (GuildIdsHelper, etc.)
│   ├── lib/              # Prisma and core client instances
│   └── index.js          # Main entrypoint and lifecycle management
├── Renderer/             # RUST: High-performance visual engine (Axum)
├── assets/               # Fonts, Icons, and MP4/PNG Templates
├── monitoring/           # Prometheus/Grafana configurations
└── schema.prisma         # Postgres Source of Truth
```

*Created with ❤️ for the world's best communities. Powered by Node.js, Prisma, and the speed of Rust.*
