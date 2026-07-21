// Generates PaperHood PWA icons as PNGs with zero dependencies.
// Draws a rounded green square (brand accent #00c805) with a bold white "P"
// built from per-pixel shape tests (stem + ring bowl), then encodes PNG via zlib.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../public");
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Coverage of a pixel by the icon shape set, supersampled 4x4.
function makeIcon(size, { rounded = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [0, 200, 5]; // brand accent
  const fg = [255, 255, 255];
  const r = rounded ? size * 0.22 : 0;

  // "P": stem plus bowl ring, in unit coords (0..1 of icon).
  const stemX0 = 0.30, stemX1 = 0.44, stemY0 = 0.22, stemY1 = 0.80;
  const bowlCx = 0.50, bowlCy = 0.385, bowlR = 0.165, bowlInner = 0.075;

  function inRoundedSquare(x, y) {
    if (x < r) {
      if (y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
      if (y > size - r) return (x - r) ** 2 + (y - (size - r)) ** 2 <= r * r;
    } else if (x > size - r) {
      if (y < r) return (x - (size - r)) ** 2 + (y - r) ** 2 <= r * r;
      if (y > size - r) return (x - (size - r)) ** 2 + (y - (size - r)) ** 2 <= r * r;
    }
    return true;
  }

  function inP(u, v) {
    if (u >= stemX0 && u <= stemX1 && v >= stemY0 && v <= stemY1) return true;
    const dx = u - bowlCx, dy = v - bowlCy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bowlR * bowlR && d2 >= bowlInner * bowlInner && u >= stemX0) return true;
    return false;
  }

  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0, fgCov = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (!inRoundedSquare(px, py)) continue;
          bgCov++;
          if (inP(px / size, py / size)) fgCov++;
        }
      }
      const total = S * S;
      const a = bgCov / total;
      const f = fgCov / total;
      const i = (y * size + x) * 4;
      const mix = (c1, c2) => Math.round((c1 * (bgCov - fgCov) + c2 * fgCov) / Math.max(bgCov, 1));
      rgba[i] = mix(bg[0], fg[0]);
      rgba[i + 1] = mix(bg[1], fg[1]);
      rgba[i + 2] = mix(bg[2], fg[2]);
      rgba[i + 3] = Math.round(a * 255);
      void f;
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192));
writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512));
// Apple touch icon: no transparency, square-ish corners handled by iOS mask.
writeFileSync(path.join(outDir, "apple-touch-icon.png"), makeIcon(180, { rounded: false }));
console.log("icons written to web/public");
