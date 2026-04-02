require('dotenv').config();
const { prisma } = require('./src/lib/prisma');
const { ResetService } = require('./src/services/ResetService');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function main() {
  await client.login(process.env.DISCORD_BOT_TOKEN);
  
  const guildId = '1227505156220784692';
  
  // Update one user to have clanId 1 and weeklyXp 500
  await prisma.userXp.updateMany({
    where: { guildId, userId: '762715169351532555' },
    data: { clanId: 1, weeklyXp: 500 }
  });
  
  console.log("Updated user to have clanId 1 and weeklyXp 500");
  
  const clanTotals = await prisma.userXp.groupBy({
    by: ['clanId'],
    where: { guildId, clanId: { gt: 0 } },
    _sum: { weeklyXp: true }
  });
  console.log("Clan totals for test DB:", clanTotals);
  
  const finalTotals = {};
  clanTotals.forEach((r) => {
    if (r.clanId) finalTotals[r.clanId] = r._sum.weeklyXp || 0;
  });
  
  console.log("finalTotals:", finalTotals);
  
  // simulate the announcement
  await ResetService.sendWeeklyAnnouncement(client, guildId, false, finalTotals);
  
  console.log("Announcement sent!");
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  client.destroy();
});
