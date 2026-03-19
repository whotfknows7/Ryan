# 🤖 Ryan Bot v7: The Ultimate Handbook

**Ryan** is a premium, high-performance Discord engagement ecosystem. Designed for massive communities, it leverages a hybrid architecture—combining a robust **Node.js** enterprise core with a high-fidelity **Rust** rendering engine. 

Ryan doesn't just manage a server; it creates a living, breathing world through gamified moderation, faction warfare, and optimized engagement tracking.

---

## 🏛️ Technical Architecture: The 3-Layer Rule

To ensure system determinism and reliability, Ryan follows a strict 3-layer architectural hierarchy.

### Layer 1: Entrypoints (Interactions & Events)
- **Paths**: `src/handlers/`, `src/commands/`, `src/events/`
- **Constraint**: Thin routers. They parse Discord inputs and pass them to Services. **Strictly no database calls or complex business logic here.**

### Layer 2: The Service Layer (The Logic Core)
- **Paths**: `src/services/` (e.g., `XpService.js`, `PunishmentService.js`)
- **Constraint**: Logic must be composable and cohesive. Feature-specific logic (XP counting, jail mechanics, etc.) belongs here.

### Layer 3: Data & Infrastructure
- **Database**: Prisma (`schema.prisma`) is the single source of truth.
- **State**: Redis for atomic operations and high-speed caching.
- **Rendering**: Rust/Axum microservice (`Renderer/`) handles SVG-to-PNG offloading.

---

## 🗺️ System Memory Map

| Component | Path | Description |
| :--- | :--- | :--- |
| **Entrypoints** | `src/handlers/` | Interaction & Message routing |
| **Features Logic** | `src/services/` | XP, Leaderboards, Punishments |
| **Visuals** | `Renderer/src/` | Rust/Axum high-performance rendering |
| **Persistence** | `schema.prisma` | Database schema & Prisma client |
| **Workers** | `src/workers/` | Background jobs (Gifs, DB Sync) |

---

## ⚡ Scaling for 10,000+ Servers

Ryan is engineered for extreme scale, utilizing low-level optimizations to maintain sub-100ms response times even under heavy load.

- **UDS Redis Connectivity**: Prefers Unix Domain Sockets (`/run/redis/redis-server.sock`) for ultra-low latency, bypassing the TCP stack.
- **RAM Disk /dev/shm**: Uses Linux Shared Memory for temporary image processing (GIF frames, icons), offering nanosecond I/O.
- **Micro-Batch XP Pipeline**: XP events are buffered in-memory (Node.js) and flushed to Redis every **1,000ms** to prevent network congestion.
- **Marker-Based Rank Sync**: Uses a Redis Set (`lb_dirty_guilds`) to signal which guilds require a visual refresh, eliminating wasteful polling.

---

## 📈 The XP Engine

### The Linear Formula
Ryan uses a deterministic linear progression model for leveling and role rewards:
**`XP(L) = 238L + 179`**
- **Level from XP**: `L = floor((XP - 179) / 238)`
- **Standard Rewards**: Messages (1XP per alpha char), Emojis/Stickers (2XP).

### Data Lifecycle
1. **The Buffer (1s)**: XP is collected in a local Map.
2. **The Cache (Redis)**: Every second, the buffer is pushed to a Redis Hash.
3. **The Persistence (60s)**: `XpSyncService.js` performs a bulk Prisma upsert to PostgreSQL.

---

## 🎨 Rust Rendering Engine (`Renderer/`)

A dedicated high-performance service built with **Axum** and **resvg** to handle complex visual generation.

- **Multi-Layer Font Fallback**: Supports `Poppins-Bold`, `DejaVu Sans`, `NotoSansMath`, and `Symbola`.
- **Unicode Normalization**: Automatically standardizes mathematically styled names (e.g., 𝐆𝐎𝐊𝐔 → GOKU) to ensure layout consistency.
- **Tikv-Jemalloc**: Optimized memory allocation for long-running, CPU-intensive rendering tasks.

---

## ⚔️ Clan Warfare & GIF Engine

Powered by a distributed background job system using **BullMQ**.
- **GifService.js**: Computes rank state hashes; if a hash changes, it triggers a re-render.
- **gifWorker.js**: Isolated worker processes using `ffmpeg` and `gifsicle` to generate high-fidelity competition GIFs.

---

## ⛓️ The Torture Chamber (Moderation)

An 8-tier progressive punishment system integrated with the XP engine.
- **Jail Mechanics**: Users in jail are suppressed from gaining XP.
- **Community Redemption**: Servers can enable "Vote to Release" for jailed members.

---

## 🗃️ Services Overview

| Service | Primary Responsibility |
| :--- | :--- |
| `XpService.js` | Live XP calculation and reward distribution. |
| `DatabaseService.js` | High-speed leaderboard queries and JSON config parsing. |
| `XpSyncService.js` | Atomic write-behind sync from Redis to Postgres. |
| `AssetService.js` | Discord-backed asset delivery for custom icons. |

---

*Created with ❤️ for the world's best communities. Powered by Node.js, Prisma, and the speed of Rust.*
