const fs = require('fs');
// Using built-in fetch in Node 22+

/**
 * Quick Test Utility for Renderer Coordinates
 * 
 * Usage:
 * node test_coords.js --username_y 417 --role_y 637 --role_name "Level Up!"
 */

const args = {};
process.argv.slice(2).forEach(val => {
    if (val.startsWith('--')) {
        const parts = val.split('=');
        const key = parts[0].replace('--', '');
        const value = parts[1] || process.argv[process.argv.indexOf(val) + 1];
        args[key] = value;
    }
});

const RENDERER_URL = 'http://localhost:3000';

async function runTest() {
    console.log('--- Starting Renderer Coordinate Test ---');

    // 1. Render Base
    console.log('Step 1: Rendering Base Image...');
    const basePayload = {
        role_name: args.role_name || "PRO ATHLETE",
        role_color: args.role_color || "#823EF0",
        icon_url: args.icon_url || "https://cdn.discordapp.com/embed/avatars/0.png",
        icon_x: args.icon_x ? parseInt(args.icon_x) : undefined,
        icon_y: args.icon_y ? parseInt(args.icon_y) : undefined,
        icon_size: args.icon_size ? parseInt(args.icon_size) : undefined,
        text_x: args.role_x ? parseInt(args.role_x) : undefined,
        text_y: args.role_y ? parseInt(args.role_y) : undefined,
        font_size: args.role_font ? parseInt(args.role_font) : undefined
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

    const baseArrayBuffer = await baseRes.arrayBuffer();
    const baseBuffer = Buffer.from(baseArrayBuffer);
    const baseB64 = baseBuffer.toString('base64');
    fs.writeFileSync('test_base.png', baseBuffer);
    console.log('✔ Base Image saved to test_base.png');

    // 2. Render Final
    console.log('Step 2: Rendering Final Overlay...');
    const finalPayload = {
        base_image_b64: baseB64,
        username: args.username || "RyanDeveloper",
        text_x: args.username_x ? parseInt(args.username_x) : undefined,
        text_y: args.username_y ? parseInt(args.username_y) : undefined,
        font_size: args.username_font ? parseInt(args.username_font) : undefined
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

    const finalArrayBuffer = await finalRes.arrayBuffer();
    const finalBuffer = Buffer.from(finalArrayBuffer);
    fs.writeFileSync('test_final.png', finalBuffer);
    console.log('✔ Final Image saved to test_final.png');

    console.log('--- Test Complete ---');
}

runTest().catch(console.error);
