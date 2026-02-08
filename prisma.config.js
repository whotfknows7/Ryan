const dotenv = require('dotenv');
dotenv.config(); // Explicitly load .env

const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
