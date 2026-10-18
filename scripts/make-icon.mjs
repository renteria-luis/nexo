// Rebuild the app icons from the approved Tech Matrix mark:
// node scripts/make-icon.mjs
// The source stays separate so exporting icons cannot restore the old discipline grid.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Use Expo's existing image tooling without adding an application dependency.
const requireImageUtils = createRequire(import.meta.resolve('@expo/image-utils'));
const Jimp = requireImageUtils('jimp-compact');
const assets = new URL('../assets/', import.meta.url);
const BACKGROUND = '#071b1d';
const background = Jimp.cssColorToHex(BACKGROUND);
const source = await Jimp.read(fileURLToPath(new URL('tech-matrix-mark.png', assets)));

let left = source.bitmap.width;
let top = source.bitmap.height;
let right = -1;
let bottom = -1;
let transparent = false;
source.scan(0, 0, source.bitmap.width, source.bitmap.height, (x, y, index) => {
  const alpha = source.bitmap.data[index + 3];
  if (alpha === 0) transparent = true;
  // Ignore nearly invisible edge pixels when measuring the optical bounds.
  if (alpha < 32) return;
  left = Math.min(left, x);
  top = Math.min(top, y);
  right = Math.max(right, x);
  bottom = Math.max(bottom, y);
});
if (!transparent || right < left || bottom < top) {
  throw new Error('tech-matrix-mark.png must contain a visible mark on a transparent background');
}
const mark = source.crop(left, top, right - left + 1, bottom - top + 1);

function icon(size, fraction, { opaque = false, monochrome = false } = {}) {
  const foreground = mark.clone();
  if (monochrome) {
    foreground.scan(0, 0, foreground.bitmap.width, foreground.bitmap.height, (_x, _y, index) => {
      foreground.bitmap.data[index] = 255;
      foreground.bitmap.data[index + 1] = 255;
      foreground.bitmap.data[index + 2] = 255;
    });
  }
  const extent = Math.round(size * fraction);
  foreground.scaleToFit(extent, extent, Jimp.RESIZE_BICUBIC);
  const canvas = new Jimp(size, size, opaque ? background : 0x00000000);
  canvas.composite(
    foreground,
    Math.round((size - foreground.bitmap.width) / 2),
    Math.round((size - foreground.bitmap.height) / 2),
  );
  // iOS requires an opaque RGB PNG; Android foreground layers need their alpha.
  return canvas.colorType(opaque ? 2 : 6);
}

async function write(name, canvas) {
  writeFileSync(new URL(name, assets), await canvas.getBufferAsync(Jimp.MIME_PNG));
  console.log(`assets/${name} ${canvas.bitmap.width}x${canvas.bitmap.height}`);
}

await write('icon.png', icon(1024, 0.68, { opaque: true }));
await write('favicon.png', icon(64, 0.75, { opaque: true }));
// The square-ended N fits inside the circular safe zone of adaptive masks.
await write('android-icon-foreground.png', icon(1024, 0.42));
await write('android-icon-monochrome.png', icon(1024, 0.42, { monochrome: true }));
await write('android-icon-background.png', new Jimp(1024, 1024, background).colorType(2));
