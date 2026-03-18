# 🤖 Ryan Bot v7: The Ultimate Handbook

**Ryan** is a premium, high-performance Discord engagement ecosystem. Designed for massive communities, it leverages a hybrid architecture—combining a robust **Node.js** enterprise core with a high-fidelity **Rust** rendering engine. 

Ryan doesn't just manage a server; it creates a living, breathing world through gamified moderation, faction warfare, and optimized engagement tracking.

---

## 🏛️ Technical Architecture

### Hybrid System Design
**Two-Process Architecture** running concurrently:
- **Discord Bot Core (Node.js 22+, discord.js v14):** Handles Discord events, commands, background jobs, and database interactions.
- **Rust Rendering Engine (Axum + resvg):** High-performance SVG-to-PNG conversion via a native Rust pipeline (offloading CPU-intensive work from the Node.js event loop).

### Performance Optimizations
- **UDS Redis Connectivity:** Prefers Unix Domain Sockets (`/run/redis/redis-server.sock`) for ultra-low latency, with automatic TCP fallback.
- **RAM Disk I/O:** Uses `/dev/shm` (Linux RAM Disk) for temporary file processing (GIF frames, icons), offering nanosecond latency vs standard SSD writes.
- **Micro-Batch XP Pipeline:** XP gain is buffered in memory and flushed to Redis every 1,000ms to minimize network overhead.
- **Marker-Based Sync Strategy:** Uses a Redis Set (`lb_dirty_guilds`) to track guilds needing updates, replacing broad polling with a high-efficiency targeted refresh loop.
- **Stateless Profile Cache:** High-speed Redis Hash (`member_cache`) stores top 10 profiles, reducing Discord API overhead by 90% for high-traffic leaderboards.
- **Self-Healing Architecture:** Automatic startup cleanup of stale renderer/chrome processes and port 3000 liberation.

---

## 🚀 Core Technology Stack

### Bot Technologies (Node.js)
- **Runtime:** Node.js 22+ (Latest LTS recommended).
- **Framework:** `discord.js v14.25.1`.
- **Database:** PostgreSQL with **Prisma ORM (v7.4.0)**.
- **Caching & State:** **Redis (v5.9.3)** using `ioredis`.
- **Image Processing:** `sharp` (0.34.5) & System `ffmpeg`/`gifsicle`.
- **Queue Management:** `BullMQ` (5.69.2) for reliable scheduled background jobs.
- **Validation:** `Zod` (4.3.6) for environment variables and service integrity.
- **Monitoring:** `prom-client` (15.1.3) exposing metrics on port **9400**.

### Rust Rendering Service (Renderer/)
- **Framework:** `Axum` web server listening on port **3000**.
- **Engine:** `resvg` / `usvg` / `tiny-skia` with native `ttf-parser` integration.
- **Fonts:** Multi-layer fallback system: `Poppins-Bold`, `DejaVu Sans`, `NotoSansMath`, `Symbola`.
- **Memory:** `tikv-jemallocator` for extreme long-term memory stability.
- **Advanced Features:**
    - **Unicode Normalization:** Standardizes mathematical alphanumeric characters (𝐆, 𝓨, 𝔐) to Latin for layout consistency.
    - **Dynamic Measuring:** Character-level width calculations for pixel-perfect HUD alignment.
    - **System Font Detection:** Automatic fallback for complex scripts (CJK, Arabic, Greek, Cyrillic).

---

## 📊 Data Lifecycle & Sync Strategy

Ryan implements a **Write-Behind Synchronization** strategy to handle massive burst traffic without database contention.

### 1. The Micro-Batching Loop (1s)
- XP gain is captured in an **In-Memory Buffer** (Map).
- Every **1,000ms**, the buffer is flushed to Redis using a high-speed pipeline.
- Redis increments the `xp_buffer:{guildId}` hash and marks the guild as dirty in `lb_dirty_guilds`.

### 2. The Persistence Loop (60s)
- `XpSyncService.js` scans for active `xp_buffer` keys.
- **Atomic Rename:** Buffers are renamed to `xp_buffer_processing:{timestamp}` to allow new XP to accumulate while processing.
- **Bulk Upsert:** Prisma performs a single bulk transaction to update `UserXp` in PostgreSQL.
- **Self-Healing Rollback:** If the DB update fails, the processing data is merged back into the active Redis buffer.

---

## ⚔️ Clan Warfare & GIF Engine

The Clan Warfare system is a visual-first competition powered by a distributed GIF generation pipeline.

### Architectural Flow
1. **Trigger**: An XP event or timer triggers a leaderboard refresh.
2. **Analysis**: `GifService.js` checks if the current leaderboard state (rankings/XP) matches a cached hash in `GifCache`.
3. **Queue**: If a miss occurs, a job is pushed to **BullMQ**.
4. **Worker**: `gifWorker.js` spawns an isolated process to handle intensive visual frames using `ffmpeg` and `gifsicle`.
5. **Storage**: The final GIF is uploaded to a Discord asset channel, and the message link is cached in the DB for instant reuse.

### Assets Mapping
- Clans are defined in `GuildConfig.clans`.
- Individual clan icons/banners are stored in `ClanAsset` (id: `guildId:roleId`) and fetched via `AssetService.js`.

---

## ⛓️ The Torture Chamber (Moderation)

A progressive, anti-toxic strike system that integrates directly with the XP engine.

### The 8-Tier Strike System
| Tier | Punishment | Duration |
| :--- | :--- | :--- |
| 1-2 | Warning | Instant |
| 3 | Short Jail | 30 Minutes |
| 4 | Mid Jail | 2 Hours |
| 5 | Long Jail | 12 Hours |
| 6 | Heavy Jail | 1 Week |
| 7 | Super Jail | 4 Weeks |
| 8 | Execution | Permanent Ban |

### Jail Mechanics
- **State Capture:** `JailLog` stores the user's status, case ID, and offences.
- **XP Suppression:** Jailed users are blocked from gaining XP at the service layer.
- **Vote to Release:** Fellow members can vote to release a prisoner if the server configuration allows it.

---

## ⚙️ Service Architecture

### Core Services (`src/services/`)
- **XpService.js:** "True Live XP" logic (DB + Redis + Local Buffer). Scoring: Alpha (1XP), Emoji/Sticker (2XP).
- **DatabaseService.js:** Centralized Prisma client and hybrid leaderboard generation.
- **LeaderboardUpdateService.js:** Uses Redis markers (`lb_dirty_guilds`) to refresh visuals every 20s (if dirty).
- **CustomRoleService.js:** Manages user-owned roles with weekly maintenance cycles.
- **ResetService.js:** Per-guild UTC reset management (Daily @ 0:00, Weekly @ Sunday).

---

## 🗃️ Database Schema Overview

| Model | Purpose |
| :--- | :--- |
| `UserXp` | Multi-interval XP storage (Daily, Weekly, Lifetime) + Clan mapping. |
| `GuildConfig` | JSON-driven store for configuration, IDs, clans, and reaction roles. |
| `JailLog` | Tracks criminal history, active jail status, and community votes. |
| `ResetCycle` | Stores per-guild maintenance windows for XP resets. |
| `GifCache` | Maps rank state hashes to pre-generated Discord message links. |

---

## 📜 Key Commands

| Category | Commands |
| :--- | :--- |
| **Admin** | `/reset-role`, `/skip-cycle` |
| **Config** | `/custom-role`, `/keyword`, `/setup`, `/setup-clan-icon`, `/setup-role-rewards` |
| **General** | `/clans`, `/hi`, `/live`, `/rank`, `/repeat` |
| **Mod** | `/crime`, `/jail`, `/set-xp` |

---

*Created with ❤️ for the world's best communities. Powered by Node.js, Prisma, and the speed of Rust.*
