// 生成扩展图标资源（无设计依赖，可重复执行）：
// - resources/lattice-activity-bar.svg（24×24 单色，mask 方式由 VSCode 主题着色）
// - resources/lattice-icon.png（128×128，内置纯 Node PNG 编码器，零三方依赖）
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const here = import.meta.dirname;
const outDir = join(here, '..', 'resources');
mkdirSync(outDir, { recursive: true });

// ── 活动栏 SVG ──
const svg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3L5 7.5V16.5L12 21L19 16.5V7.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
  <path d="M12 3V8.2M12 15.8V21M12 8.2L5 7.5M12 8.2L19 7.5M12 15.8L5 16.5M12 15.8L19 16.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="12" cy="8.2" r="1.7" fill="currentColor"/>
  <circle cx="12" cy="15.8" r="1.7" fill="currentColor"/>
</svg>
`;
writeFileSync(join(outDir, 'lattice-activity-bar.svg'), svg);

// ── 128×128 PNG（手写编码器） ──
const W = 128;
const H = 128;
const pixels = new Uint8Array(W * H * 4); // RGBA

function blend(x, y, r, g, b, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 4;
  const a = Math.min(1, alpha);
  pixels[i] = Math.round(pixels[i] * (1 - a) + r * a);
  pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + g * a);
  pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + b * a);
  pixels[i + 3] = Math.round(pixels[i + 3] * (1 - a) + 255 * a);
}

function fillCircle(cx, cy, radius, color) {
  const [r, g, b] = color;
  const from = Math.floor(Math.min(cx, cy) - radius - 2);
  const to = Math.ceil(Math.max(cx, cy) + radius + 2);
  for (let y = Math.max(0, from); y <= Math.min(H - 1, to); y++) {
    for (let x = Math.max(0, from); x <= Math.min(W - 1, to); x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(x, y, r, g, b, Math.min(1, radius - dist + 0.7));
    }
  }
}

function drawLine(x0, y0, x1, y1, width, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color);
  }
}

function fillRoundedRect(x0, y0, x1, y1, radius, color) {
  const [r, g, b] = color;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.max(x0 + radius - x - 0.5, 0, x + 0.5 - (x1 - radius));
      const dy = Math.max(y0 + radius - y - 0.5, 0, y + 0.5 - (y1 - radius));
      const dist = Math.hypot(dx, dy);
      blend(x, y, r, g, b, Math.min(1, radius - dist + 0.7));
    }
  }
}

const BLUE = [22, 119, 255];
const WHITE = [255, 255, 255];

// 圆角背景
fillRoundedRect(6, 6, 122, 122, 26, BLUE);

// 六边形晶格 + 双节点（与活动栏图标同构，等比放大）
const V = {
  top: [64, 18],
  leftTop: [27, 41],
  leftBottom: [27, 87],
  bottom: [64, 110],
  rightBottom: [101, 87],
  rightTop: [101, 41],
};
const n1 = [64, 44];
const n2 = [64, 84];
const edges = [
  [V.top, V.leftTop],
  [V.leftTop, V.leftBottom],
  [V.leftBottom, V.bottom],
  [V.bottom, V.rightBottom],
  [V.rightBottom, V.rightTop],
  [V.rightTop, V.top],
  [V.top, V.bottom],
  [n1, V.leftTop],
  [n1, V.rightTop],
  [n2, V.leftBottom],
  [n2, V.rightBottom],
];
for (const [a, b] of edges) drawLine(a[0], a[1], b[0], b[1], 6, WHITE);
fillCircle(n1[0], n1[1], 10, WHITE);
fillCircle(n2[0], n2[1], 10, WHITE);
fillCircle(n1[0], n1[1], 4.5, BLUE);
fillCircle(n2[0], n2[1], 4.5, BLUE);

// PNG 编码（filter 0 + zlib + CRC32）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(pixels.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(outDir, 'lattice-icon.png'), png);

console.log(
  'icons written:',
  join(outDir, 'lattice-activity-bar.svg'),
  join(outDir, 'lattice-icon.png'),
);
