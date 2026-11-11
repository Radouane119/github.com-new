#!/usr/bin/env node
// Deterministic PWA icon generator.
//
// The dashboard ships PNG icons because installable web apps on Android, iOS
// and Windows ignore SVG icons in some contexts. Drawing them here keeps the
// binary assets reproducible: `node scripts/make-icons.mjs` rewrites the four
// files under icons/ with the same pixels on every machine.
//
// The design is a rising line with three data points on the dashboard
// background. Maskable and Apple variants use a full-bleed background because
// those platforms crop the icon themselves and reject transparency.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../icons/", import.meta.url);

const BG = [11, 17, 23];
const GREEN = [63, 185, 80];
const GRID = [148, 163, 184];

// Render every icon at 4x and box-filter it down, which gives clean edges
// without needing a rasteriser or a font.
const SS = 4;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - (halfWidth - radius);
  const qy = Math.abs(y) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius <= 0;
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function mix(from, to, amount) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

// Normalised icon geometry. Everything stays inside the maskable safe zone
// (the central 80% of the canvas).
const POINTS = [
  [0.2, 0.7],
  [0.38, 0.55],
  [0.56, 0.62],
  [0.8, 0.34],
];
const ARROW = [
  [0.86, 0.28],
  [0.813, 0.415],
  [0.707, 0.325],
];

function render(size, { rounded = true } = {}) {
  const scale = size * SS;
  const radius = rounded ? scale * 0.22 : 0;
  const lineWidth = scale * 0.048;
  const dotRadius = scale * 0.04;
  const points = POINTS.map(([x, y]) => [x * scale, y * scale]);
  const arrow = ARROW.map(([x, y]) => [x * scale, y * scale]);
  const gridLines = [0.3, 0.5, 0.7].map((v) => v * scale);
  const gridWidth = scale * 0.0045;

  const hires = Buffer.alloc(scale * scale * 4);

  for (let y = 0; y < scale; y += 1) {
    for (let x = 0; x < scale; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const covered = rounded ? insideRoundedRect(px - scale / 2, py - scale / 2, scale / 2, scale / 2, radius) : true;
      if (!covered) continue;

      let colour = BG;
      for (const line of gridLines) {
        if (Math.abs(px - line) <= gridWidth || Math.abs(py - line) <= gridWidth) {
          colour = mix(colour, GRID, 0.14);
          break;
        }
      }

      let onLine = false;
      for (let i = 1; i < points.length && !onLine; i += 1) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        if (distanceToSegment(px, py, ax, ay, bx, by) <= lineWidth / 2) onLine = true;
      }
      for (const [cx, cy] of points) {
        if (Math.hypot(px - cx, py - cy) <= dotRadius) onLine = true;
      }
      if (insideTriangle(px, py, arrow[0], arrow[1], arrow[2])) onLine = true;

      if (onLine) colour = GREEN;

      const offset = (y * scale + x) * 4;
      hires[offset] = colour[0];
      hires[offset + 1] = colour[1];
      hires[offset + 2] = colour[2];
      hires[offset + 3] = 255;
    }
  }

  // Box-filter the supersampled image. Colours are premultiplied so partially
  // transparent corner pixels do not pick up a dark fringe.
  const rgba = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const offset = ((y * SS + sy) * scale + (x * SS + sx)) * 4;
          const alpha = hires[offset + 3] / 255;
          r += hires[offset] * alpha;
          g += hires[offset + 1] * alpha;
          b += hires[offset + 2] * alpha;
          a += alpha;
        }
      }
      const offset = (y * size + x) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
      }
      rgba[offset + 3] = Math.round((a / samples) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });

const outputs = [
  { file: "icon-192.png", size: 192, options: {} },
  { file: "icon-512.png", size: 512, options: {} },
  { file: "icon-maskable-512.png", size: 512, options: { rounded: false } },
  { file: "apple-touch-icon.png", size: 180, options: { rounded: false } },
];

const check = process.argv.includes("--check");
let stale = false;

for (const { file, size, options } of outputs) {
  const png = render(size, options);
  const target = new URL(file, OUT);
  if (check) {
    let current = null;
    try {
      current = readFileSync(target);
    } catch {
      current = null;
    }
    if (!current || !current.equals(png)) {
      stale = true;
      console.error(`icons: ${file} is out of date — run \`node scripts/make-icons.mjs\``);
    }
    continue;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(target, png);
  console.log(`icons: wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}

if (stale) process.exitCode = 1;
if (check && !stale) console.log(`icons: all ${outputs.length} icons match the generator`);

