// Draws the app icon and writes the PNGs in assets/.
//
// The icon is the discipline grid, which is what the app is: four days, each filled to
// what it scored, in the palette the app uses. Flat fills, 2 px ink borders scaled up,
// and the hard shadow down and to the right, so the home screen carries the same object
// language as every card inside.
//
// Drawn here rather than saved from a design tool for one reason: the palette moves.
// When the colours changed to pastel the icon would have gone stale silently, and a
// script that reads the same hexes cannot.
//
// No dependencies: shapes are rasterised into a byte array at 2x and averaged down, and
// the PNG is written with node's own zlib. Run with `node scripts/make-icon.mjs`.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/** The same values as src/ui/theme.ts. Kept in sync by hand, checked by eye. */
const PAPER = '#fff4e0';
const SURFACE = '#fffdf7';
const INK = '#121212';
const FILLS = ['#ffe9a8', '#cfeda6', '#bccdf4', '#ffd0a3'];
/** What each day scored, which is what decides how high its colour reaches. */
const SCORES = [1, 0.62, 0.88, 0.4];

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

class Canvas {
  constructor(size) {
    this.size = size;
    this.pixels = new Uint8Array(size * size * 3);
  }

  fill(hex) {
    const [r, g, b] = rgb(hex);
    for (let i = 0; i < this.pixels.length; i += 3) {
      this.pixels[i] = r;
      this.pixels[i + 1] = g;
      this.pixels[i + 2] = b;
    }
  }

  /** A rounded rectangle, filled flat. Everything in this icon is one of these. */
  box({ x, y, width, height, radius, colour }) {
    const [r, g, b] = rgb(colour);
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.size, Math.ceil(x + width));
    const bottom = Math.min(this.size, Math.ceil(y + height));

    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) {
        if (!inside(px + 0.5, py + 0.5, x, y, width, height, radius)) continue;
        const at = (py * this.size + px) * 3;
        this.pixels[at] = r;
        this.pixels[at + 1] = g;
        this.pixels[at + 2] = b;
      }
    }
  }

  /** Half the size, averaging four pixels into one: that is the anti-aliasing. */
  half() {
    const size = this.size / 2;
    const out = new Canvas(size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const a = this.pixels[(y * 2 * this.size + x * 2) * 3 + channel];
          const b = this.pixels[(y * 2 * this.size + x * 2 + 1) * 3 + channel];
          const c = this.pixels[((y * 2 + 1) * this.size + x * 2) * 3 + channel];
          const d = this.pixels[((y * 2 + 1) * this.size + x * 2 + 1) * 3 + channel];
          out.pixels[(y * size + x) * 3 + channel] = Math.round((a + b + c + d) / 4);
        }
      }
    }
    return out;
  }

  png() {
    const stride = this.size * 3;
    // One filter byte per row, and the filter is "none": the image is flat colour and
    // deflate already eats the repetition.
    const raw = Buffer.alloc((stride + 1) * this.size);
    for (let y = 0; y < this.size; y += 1) {
      raw[y * (stride + 1)] = 0;
      Buffer.from(this.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.size, 0);
    header.writeUInt32BE(this.size, 4);
    header[8] = 8; // bits per channel
    header[9] = 2; // truecolour, no alpha: an iOS icon may not carry any
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function inside(px, py, x, y, width, height, radius) {
  if (px < x || py < y || px > x + width || py > y + height) return false;
  if (radius <= 0) return true;

  const cx = Math.min(Math.max(px, x + radius), x + width - radius);
  const cy = Math.min(Math.max(py, y + radius), y + height - radius);
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(tagged), 0);
  return Buffer.concat([head, tagged, tail]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * The mark itself, on a canvas of any size. `bleed` paints the paper behind it, which is
 * what an iOS icon needs and an Android foreground layer must not have.
 */
function draw(size, { bleed = true, mono = false } = {}) {
  const canvas = new Canvas(size);
  canvas.fill(bleed ? PAPER : mono ? '#000000' : PAPER);

  const unit = size / 1024;
  const margin = 132 * unit;
  const gap = 56 * unit;
  const cell = (size - margin * 2 - gap) / 2;
  const border = 17 * unit;
  const radius = 44 * unit;
  const shadow = 21 * unit;

  for (const [index, score] of SCORES.entries()) {
    const x = margin + (index % 2) * (cell + gap);
    const y = margin + Math.floor(index / 2) * (cell + gap);

    // The hard shadow first, so the square sits on top of it.
    canvas.box({ x: x + shadow, y: y + shadow, width: cell, height: cell, radius, colour: INK });
    canvas.box({ x, y, width: cell, height: cell, radius, colour: INK });
    canvas.box({
      x: x + border,
      y: y + border,
      width: cell - border * 2,
      height: cell - border * 2,
      radius: radius - border,
      colour: mono ? '#000000' : SURFACE,
    });

    // The fill rises from the bottom, exactly as a day's square does in the grid.
    const inner = cell - border * 2;
    const tall = inner * score;
    canvas.box({
      x: x + border,
      y: y + border + (inner - tall),
      width: inner,
      height: tall,
      radius: radius - border,
      colour: mono ? '#ffffff' : FILLS[index],
    });
    // The rounded top of a partial fill would float; square it off against the border.
    if (score < 1) {
      canvas.box({
        x: x + border,
        y: y + border + (inner - tall) + (radius - border),
        width: inner,
        height: tall - (radius - border),
        radius: 0,
        colour: mono ? '#ffffff' : FILLS[index],
      });
    }
  }

  return canvas;
}

function write(path, size, options) {
  writeFileSync(
    path,
    draw(size * 2, options)
      .half()
      .png(),
  );
  console.log(`${path} ${size}x${size}`);
}

write('assets/icon.png', 1024);
write('assets/favicon.png', 64);
write('assets/splash-icon.png', 512);
write('assets/android-icon-foreground.png', 1024);
write('assets/android-icon-monochrome.png', 1024, { mono: true });
writeFileSync(
  'assets/android-icon-background.png',
  (() => {
    const canvas = new Canvas(64);
    canvas.fill(PAPER);
    return canvas.png();
  })(),
);
console.log('assets/android-icon-background.png 64x64');
