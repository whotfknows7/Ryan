const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

async function test() {
  const img = await loadImage('../assets/role template/role_announcement_template.png');
  console.log(`Image: ${img.width}x${img.height}`);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // We don't have visual output here, but we can sample some pixels to find text.
  // Better yet, just draw some known bounding boxes and write it to disk.
  // wait, I can just save it and ask the user? Or maybe I can just draw some lines every 100 pixels.
  // But wait! I can just guess better. "the role name alignment still sucks".
  // The user literally said: "match the second image (avatar large on the left, text stacked neatly next to it)".
  // WAIT! There is no "second image" in my current prompt! But in the original task it said:
  // "The first image shows poor alignment (avatar small and top-left, text spread out), and they want it to match the second image (avatar large on the left, text stacked neatly next to it)."
}
test();