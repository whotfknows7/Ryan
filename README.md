# 🤖 Ryan Bot v7 (The Ultimate Edition)

**Ryan** is a next-generation Discord bot designed for high-engagement communities. It fuses a robust **Node.js** event core with a high-performance **Rust** rendering engine to deliver real-time gamification, immersive moderation, and dynamic visual content.

---

## 🚀 Key Highlights

*   **Hybrid Architecture:** Logic is handled by Node.js, while heavy image/video generation (Leaderboards, GIFs) is offloaded to a compiled **Rust** binary.
*   **Performance First:** Uses RAM-disk caching, optimized caching strategies, and robust process management to ensure 24/7 uptime.
*   **Immersive UX:** Every feature is designed with "flavor text," animations, and interactivity to keep users hooked.

---

## 🌟 Comprehensive Feature List

### 1. 📈 The XP Engine
A sophisticated leveling system designed to encourage meaningful conversation, not spam.

*   **Smart Scoring:**
    *   **1 XP** per alphabetic character (resists spam).
    *   **2 XP** per emoji (Custom or Unicode) to encourage expression.
    *   *URLs are explicitly ignored.*
*   **Interactive Role Rewards:**
    *   **Setup Wizard (`/setup_role_rewards`):** An interactive GUI to configure roles.
    *   **Hybrid Image Generation:** Automatically generates "Level Up" cards combining the Role Icon and User Avatar.
    *   **3-Phase Verification:** Uses a nano-second RAM check followed by an API double-check to ensure rewards are granted instantly but safely.
*   **Reset Cycles:**
    *   **Daily:** Users compete for the "Daily Winner" spot.
    *   **Weekly:** Persistent tracking with a weekly reset using the **Cycle Manager**.
    *   **Lifetime:** Permanent XP tracking for all-time ranks.

### 2. 🏰 Clan Wars System
An automated 4-Faction warfare system.

*   **Live Visuals (`/clans`):**
    *   Generates a **real-time GIF** showing the current state of the war.
    *   Uses a **Rust -> FFmpeg** pipeline to composite clan icons onto animated backgrounds.
    *   Visual "Health Bars" showing destruction inflicted by each clan.
*   **Management:**
    *   **Custom Icons:** Server owners can upload unique icons for each clan.
    *   **Role Linking:** Each clan maps to a Discord role; XP earned by members contributes to the clan total.

### 3. ⛓️ The Torture Chamber (Moderation)
Replacing boring bans with a gamified "Jail" system.

*   **Strike System (1-8):**
    *   **Strikes 1-7:** Time-outs ranging from minutes to weeks.
    *   **Strike 8:** Permanent Ban.
*   **Immersive Punishment:**
    *   **Mugshots:** Generates a "Caught" GIF with the user's avatar when punished.
    *   **Torture Text:** Sends randomized, mocking messages to the jail channel.
    *   **Vote to Release:** Allows the community to vote on releasing a prisoner (configurable).
*   **Commands:**
    *   `/jail punish`: Inflict a strike and mute the user.
    *   `/jail forgive`: Pardon a user and clear their record.
    *   `/jail lets_go_ez`: Reduce a punishment or release early.
    *   `/crime_investigation`: View a user's full criminal history (Rap Sheet).

### 4. 👑 Social & Economy
*   **Rank Cards (`/rank`):** Generates a high-quality image displaying Weekly/Lifetime Rank and XP.
*   **Live Leaderboard (`/live`):**
    *   Instant snapshot of the top 10 "Yappers of the Day."
    *   Interactive pagination buttons.
*   **Weekly Best Chatter:**
    *   **The Crown:** Automatically assigns a specific role to the #1 user of the week.
    *   **Auto-Rotation:** Removes the role from the previous winner automatically.
*   **Custom Roles (`/custom_role`):**
    *   **Request System:** Users meeting criteria can request a custom role with a specific color.
    *   **Anchor Positioning:** The bot automatically places new custom roles below a designated "Anchor Role" to maintain hierarchy.

### 5. 🛠️ Server Management Tools
*   **Setup Wizard (`/setup`):** A massive configuration command to link all channels and roles.
*   **Keyword Reactions (`/keyword`):**
    *   Map triggers to emojis (e.g., "Ryan" -> 👑).
    *   Supports smart boundary matching (matches "Ryan's" but not "Bryan").
*   **Reset Role System (`/resetrole_system`):**
    *   **Mass Remove:** Temporarily strip a role from *all* members for testing or resets.
    *   **Mass Restore:** Re-add the role to the same members with one click (valid for 15 mins).

### 6. 🚨 Emergency 911
A safety tool for urgent moderation.

*   **Trigger:** Mentioning "911" or using the command.
*   **Mod Alert:** Pings the staff team in a private channel with a direct link to the message.
*   **Anti-Abuse:**
    *   **Cooldown:** 10-minute server-wide lockout.
    *   **Silent Logging:** Logs attempts made during cooldown without pinging staff.

### 7. ⚙️ Technical & Diagnostics
*   **System Diagnostics (`/hi`):**
    *   Displays **Roundtrip Latency**, **Shard Ping**, **Database Health**, and **Uptime**.
*   **Self-Healing:**
    *   **Zombie Killer:** Cleans up stale Chrome/Renderer processes on startup.
    *   **Graceful Shutdown:** Ensures no data corruption on restart.
*   **Database:** Powered by **Prisma (PostgreSQL)** for type-safe, atomic transactions.

---

## 🔧 Installation

1.  **Prerequisites:** Node.js (v20+), Rust/Cargo, Postgres.
2.  **Setup:**
    ```bash
    npm install
    npx prisma generate
    npm run setup  # Builds the Rust Renderer
    ```
3.  **Run:**
    ```bash
    npm start
    ```
    *This will launch the Bot, the Rust Renderer, and sync the Database.*
