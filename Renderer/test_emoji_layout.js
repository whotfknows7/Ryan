const fs = require('fs');

const RENDERER_URL = 'http://localhost:3000';

async function runTest() {
    console.log('--- Starting Renderer Emoji Layout Test ---');

    // 1. Render Base
    console.log('Step 1: Rendering Base Image with Emoji...');
    const basePayload = {
        role_name: "VETERAN",
        role_color: "#00FF00",
        icon_url: "https://cdn.discordapp.com/embed/avatars/0.png",
        emojis: [{ hex: "1f949" }] // 🥉
    };

    const baseRes = await fetch(`${RENDERER_URL}/render/role-reward/base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload)
    });

    if (!baseRes.ok) {
        console.error('Failed to render base:', await baseRes.text());
        return;
    }

    const baseBuffer = Buffer.from(await baseRes.arrayBuffer());
    const baseB64 = baseBuffer.toString('base64');
    fs.writeFileSync('test_base_emoji.png', baseBuffer);
    console.log('✔ Base Image saved to test_base_emoji.png');

    // 2. Render Final
    console.log('Step 2: Rendering Final Overlay with Emoji...');
    const finalPayload = {
        base_image_b64: baseB64,
        username: "RyanDeveloper",
        emojis: [{ hex: "1f525" }] // 🔥
    };

    const finalRes = await fetch(`${RENDERER_URL}/render/role-reward/final`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload)
    });

    if (!finalRes.ok) {
        console.error('Failed to render final:', await finalRes.text());
        return;
    }

    const finalBuffer = Buffer.from(await finalRes.arrayBuffer());
    fs.writeFileSync('test_final_emoji.png', finalBuffer);
    console.log('✔ Final Image saved to test_final_emoji.png');

    console.log('--- Test Complete ---');
}

runTest().catch(console.error);
