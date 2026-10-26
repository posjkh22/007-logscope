// Render our geometric brand mark without external image or font dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const side = 256, scale = 4;
const pixels = Buffer.alloc((side * 4 + 1) * side);
for (let y = 0; y < side; y++) {
  const scanline = y * (side * 4 + 1); pixels[scanline] = 0;
  for (let x = 0; x < side; x++) {
    let alpha = 0, dark = 0;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const px = x + (sx + .5) / scale, py = y + (sy + .5) / scale;
      const dx = Math.max(0, Math.abs(px - 128) - 76), dy = Math.max(0, Math.abs(py - 128) - 76);
      if (dx * dx + dy * dy > 46 * 46) continue;
      alpha++;
      for (let row = 0; row < 3; row++) {
        const wave = 88 + row * 41 + Math.sin((px - 54) / 148 * Math.PI * 2) * 12;
        if (px >= 54 && px <= 202 && Math.abs(py - wave) < 7.5) { dark++; break; }
      }
    }
    const amount = alpha ? dark / alpha : 0;
    const offset = scanline + 1 + x * 4;
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round([164, 230, 196][channel] * (1 - amount) + [20, 49, 36][channel] * amount);
    pixels[offset + 3] = Math.round(alpha / (scale * scale) * 255);
  }
}
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type); const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([header, label, data, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
const directory = path.join(__dirname, '../app/assets'); fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'icon.png'), png); fs.writeFileSync(path.join(directory, 'icon.ico'), Buffer.concat([icoHeader, png]));
console.log('Generated Logscope app icons.');
