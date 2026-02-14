# 🤖 Ryan Bot Features

Ryan is a high-performance Discord bot enabling advanced XP tracking, gamified moderation, and clan warfare, powered by a Node.js core and a Rust-based rendering engine.

## 🌟 Core Features

### 1. 📈 Advanced XP & Leveling System
A robust engagement tracking system that goes beyond simple message counting.
*   **Smart XP Calculation:**
    *   **1 XP** per alphabetic character.
    *   **2 XP** per emoji (Custom & Unicode).
    *   *URLs are excluded to prevent spam.*
*   **Role Rewards:** Automatically assigns roles as users reach XP milestones.
    *   **3-Phase Verification:** Uses a high-speed cache + API double-check system to ensure roles are awarded instantly without rate-limit issues.
    *   **Level-Up Announcements:** Sends customizable messages with generated images to a designated channel.
*   **Reset Modules:**
    *   **Daily Reset:** Users compete daily.
    *   **Weekly Reset:** Persistent daily tracking with a weekly reset.
    *   **Lifetime:** No resets, accumulation only.

### 2. 🏰 Clan Wars System
A competitive 4-faction system where users fight for dominance.
*   **Live Leaderboard (`/clans`):** Displays real-time standings of the 4 clans.
    *   **Dynamic Visuals:** Generates a **custom GIF** combining the background template and clan icons using a dedicated Rust/FFmpeg pipeline.
    *   **Progress Bars:** Visual representation of "Destruction Inflicted".
*   **Clan Management:**
    *   **Custom Icons:** Server owners can upload custom icons for each clan.
    *   **Role Linking:** Each clan is linked to a specific Discord role.

### 3. ⛓️ The Torture Chamber (Moderation)
A unique, gamified moderation system that replaces standard bans with a "Torture Chamber."
*   **Strike System (1-8):**
    *   **Strikes 1-7:** Progressive "Time Outs" ranging from 30 minutes to 4 weeks.
    *   **Strike 8:** Permanent Ban.
*   **Immersive Experience:**
    *   **Mugshots:** "Caught" GIFs displayed on punishment.
    *   **Flavor Text:** Custom messages mocking the "prisoner."
    *   **Vote to Release:** Community members can vote to release a prisoner (if enabled).
*   **Commands:**
    *   `/jail punish`: Inflict a strike.
    *   `/jail forgive`: Clear record.
    *   `/jail lets_go_ez`: Reduce punishment/release.
    *   `/crime_investigation`: View a user's criminal dossier or the server's "Most Wanted" leaderboard.

### 4. 🏆 Dynamic Leaderboards
*   **Live Leaderboard (`/live`):**
    *   Generates a high-quality image of the top 10 "Yappers of the Day."
    *   Interactive buttons to browse pages or check your own rank.
*   **Weekly Best Chatter:**
    *   **Automated Service:** Automatically tracks weekly XP.
    *   **The Crown:** Assigns a specific "Best Chatter" role to the #1 user at the end of the week and removes it from the previous winner.

### 5. 🚨 Emergency 911 Service
A safety feature allowing users to summon moderators quickly.
*   **Trigger:** Users can mention "911" to trigger the system.
*   **Mod Alert:** Sends a high-priority ping to the Moderator role in a private log channel with a direct link to the incident.
*   **Anti-Abuse:**
    *   **Cooldown:** 10-minute server-wide cooldown.
    *   **Silent Logging:** Logs spam attempts without pinging staff.

### 6. ⚙️ Configuration & Utils
*   **Setup Wizard (`/setup`):** extensive slash command to configure all roles (Admin, Mod, Jail, Clans) and channels (Leaderboard, Logs).
*   **Keyword Reactions:** The bot can automatically react with specific emojis when users type certain keywords.
*   **Greeting System:** Welcomes new guilds and prompts setup.
*   **Graceful Shutdown:** Ensures data integrity and proper resource cleanup on restart.

---
*Powered by Node.js, Prisma, and Rust.*
