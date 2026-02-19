// src/services/MetricsService.js

const client = require('prom-client');
const express = require('express');
const logger = require('../lib/logger');

class MetricsService {
  constructor() {
    this.registry = new client.Registry();
    this.app = express();
    this.port = 9400;

    // 1. Default Node.js Metrics (Event Loop, Heap, CPU)
    client.collectDefaultMetrics({ register: this.registry, prefix: 'ryan_node_' });

    // 2. Custom Metrics Definitions

    // --- Cache Metrics ---
    this.cacheHits = new client.Counter({
      name: 'ryan_cache_hits_total',
      help: 'Total number of guild config cache hits',
      registers: [this.registry],
    });

    this.cacheMisses = new client.Counter({
      name: 'ryan_cache_misses_total',
      help: 'Total number of guild config cache misses',
      registers: [this.registry],
    });

    // --- Redis Metrics ---
    this.redisPipelineSize = new client.Histogram({
      name: 'ryan_redis_pipeline_size',
      help: 'Number of commands in the XP micro-batch pipeline',
      buckets: [1, 5, 10, 50, 100, 500, 1000],
      registers: [this.registry],
    });

    this.redisPipelineLatency = new client.Histogram({
      name: 'ryan_redis_pipeline_latency_seconds',
      help: 'Latency of Redis pipeline execution',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    });

    // --- Renderer Metrics ---
    this.rendererRequestDuration = new client.Histogram({
      name: 'ryan_renderer_request_duration_seconds',
      help: 'Duration of requests to the Rust renderer service',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // --- Discord Metrics ---
    this.discordPing = new client.Gauge({
      name: 'ryan_discord_ping',
      help: 'Discord Gateway Websocket Ping',
      registers: [this.registry],
    });

    this.guildCount = new client.Gauge({
      name: 'ryan_guild_count',
      help: 'Number of guilds the bot is in',
      registers: [this.registry],
    });

    this.userCount = new client.Gauge({
      name: 'ryan_user_count',
      help: 'Approximate number of users across all guilds',
      registers: [this.registry],
    });
  }

  /**
   * Starts collecting Discord metrics periodically
   * @param {import('discord.js').Client} discordClient
   */
  startCollection(discordClient) {
    // Update metrics every 15 seconds
    setInterval(() => {
      if (discordClient.ws) {
        this.discordPing.set(discordClient.ws.ping);
      }
      if (discordClient.guilds) {
        this.guildCount.set(discordClient.guilds.cache.size);
        this.userCount.set(
          discordClient.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
        );
      }
    }, 15000);
  }

  startServer() {
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', this.registry.contentType);
        res.end(await this.registry.metrics());
      } catch (err) {
        res.status(500).end(err);
      }
    });

    const server = this.app.listen(this.port, () => {
      logger.info(`📊 Metrics server listening on port ${this.port}`);
    });
    server.on('error', (err) => {
      logger.error('❌ Metrics server failed to start:', err);
    });
  }
}

// Singleton instance
module.exports = new MetricsService();
