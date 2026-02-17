require('dotenv').config();
const { DatabaseService } = require('../src/services/DatabaseService');
const { prisma } = require('../src/lib/prisma');

async function verify() {
    const guildId = 'verify-guild-1';
    const u1 = 'user-1';
    const u2 = 'user-2';

    console.log('--- Starting Verification ---');

    // 1. Cleanup
    await prisma.userXp.deleteMany({ where: { guildId } });

    // 2. Setup initial users (no clan)
    await DatabaseService.addUserXp(guildId, u1, 100);
    await DatabaseService.addUserXp(guildId, u2, 200);

    // 3. Verify initial state
    let u1Data = await prisma.userXp.findUnique({ where: { guildId_userId: { guildId, userId: u1 } } });
    console.log('Initial U1 ClanId:', u1Data.clanId); // Should be 0 or null depending on default, schema says default(0)

    // 4. Test syncUserClanRoles
    console.log('Testing syncUserClanRoles...');
    const clanUpdates = [
        { userId: u1, clanId: 1, xp: 100 }, // xp param is ignored for clanId update in my implementation?
        // Wait, syncUserClanRoles implementation:
        // const updates = clanUpdates.map(u => prisma.userXp.updateMany({ where: { guildId, userId: u.userId }, data: { clanId: u.clanId } }));
        // So yes, it sets clanId.
        { userId: u2, clanId: 2, xp: 200 }
    ];

    await DatabaseService.syncUserClanRoles(guildId, clanUpdates);

    u1Data = await prisma.userXp.findUnique({ where: { guildId_userId: { guildId, userId: u1 } } });
    const u2Data = await prisma.userXp.findUnique({ where: { guildId_userId: { guildId, userId: u2 } } });

    console.log('U1 ClanId:', u1Data.clanId); // Should be 1
    console.log('U2 ClanId:', u2Data.clanId); // Should be 2

    if (u1Data.clanId !== 1 || u2Data.clanId !== 2) {
        console.error('FAILED: syncUserClanRoles did not update clanIds correctly.');
        process.exit(1);
    }

    // 5. Test getClanTotalXp
    console.log('Testing getClanTotalXp...');
    const totals = await DatabaseService.getClanTotalXp(guildId);
    console.log('Clan Totals:', totals);

    if (totals[1] !== 100 || totals[2] !== 200) {
        console.error('FAILED: getClanTotalXp returned incorrect values.');
        process.exit(1);
    }

    // 6. Test aggregation with multiple users in same clan
    await DatabaseService.addUserXp(guildId, 'user-3', 50);
    // syncUserClanRoles resets guild state, so we must provide ALL current clan members
    await DatabaseService.syncUserClanRoles(guildId, [
        { userId: u1, clanId: 1, xp: 0 },
        { userId: u2, clanId: 2, xp: 0 },
        { userId: 'user-3', clanId: 1, xp: 0 }
    ]);

    const newTotals = await DatabaseService.getClanTotalXp(guildId);
    console.log('New Clan Totals (Clan 1 should be 150):', newTotals);

    if (newTotals[1] !== 150) {
        console.error('FAILED: getClanTotalXp aggregation failed.');
        process.exit(1);
    }

    console.log('--- Verification Passed ---');

    // Cleanup
    await prisma.userXp.deleteMany({ where: { guildId } });
}

verify()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
