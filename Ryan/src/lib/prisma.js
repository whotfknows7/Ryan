// src/lib/prisma.js
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;

const needsSSL = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=');

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  max: 30
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
