// Generates the extension toolbar / store icons by downsampling the brand
// artwork at static/icons/logo-yt-downloader.png into PNG sizes 16/32/48/128.
//
// Dependency-free: decodes the source PNG with Node's built-in zlib, box-filters
// it down to each target size, and re-encodes with a minimal PNG writer.
//
// Run: node scripts/gen-icons.mjs   (writes static/icons/icon-{16,32,48,128}.png)
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "static", "icons", "logo-yt-downloader.png");
const OUT_DIR = join(ROOT, "static", "icons");
const SIZES = [16, 32, 48, 128];

/* ------------------------------- PNG decode ------------------------------ */

function decodePng(buffer) {
  if (
    buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    throw new Error("Not a PNG file");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let palette = null;
  let trns = null;

  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0) throw new Error("Unsupported compression method");
      if (data[12] !== 0) throw new Error("Interlaced PNG not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth === 16) throw new Error("16-bit PNG not supported");

  const raw = inflateSync(Buffer.concat(idat));
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (channels === 0) throw new Error(`Unsupported color type ${colorType}`);

  // Unfilter scanlines into an RGBA buffer.
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const rgba = Buffer.alloc(width * height * 4);
  let rawPos = 0;
  let prev = Buffer.alloc(stride);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const line = raw.subarray(rawPos, rawPos + stride);
    rawPos += stride;
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = line[x]; break;
        case 1: val = line[x] + a; break;
        case 2: val = line[x] + b; break;
        case 3: val = line[x] + ((a + b) >> 1); break;
        case 4: val = line[x] + paeth(a, b, c); break;
        default: throw new Error(`Bad filter ${filter}`);
      }
      out[x] = val & 0xff;
    }
    prev = out;

    // Convert sample -> RGBA.
    const bpp = Math.floor((channels * bitDepth) / 8);
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      const sample = (idx) => {
        if (bitDepth === 8) return out[si + idx];
        // bitDepth 1/2/4: expand packed samples.
        const bitsPerByte = 8 / bitDepth;
        const byte = out[si + Math.floor(idx / bitsPerByte)];
        const shift = 8 - bitDepth * ((idx % bitsPerByte) + 1);
        return ((byte >> shift) & ((1 << bitDepth) - 1)) * (255 / ((1 << bitDepth) - 1));
      };
      if (colorType === 6) {
        rgba[di] = out[si]; rgba[di + 1] = out[si + 1];
        rgba[di + 2] = out[si + 2]; rgba[di + 3] = out[si + 3];
      } else if (colorType === 2) {
        rgba[di] = out[si]; rgba[di + 1] = out[si + 1];
        rgba[di + 2] = out[si + 2]; rgba[di + 3] = 255;
      } else if (colorType === 0) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = sample(0); rgba[di + 3] = 255;
      } else if (colorType === 4) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = sample(0); rgba[di + 3] = sample(1);
      } else if (colorType === 3) {
        const idx = sample(0);
        rgba[di] = palette[idx * 3];
        rgba[di + 1] = palette[idx * 3 + 1];
        rgba[di + 2] = palette[idx * 3 + 2];
        rgba[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** Box-filter downsample to `size` x `size`. */
function resize(width, height, rgba, size) {
  const out = Buffer.alloc(size * size * 4);
  const xRatio = width / size;
  const yRatio = height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(height, Math.ceil((y + 1) * yRatio));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(width, Math.ceil((x + 1) * xRatio));
      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * width + sx) * 4;
          r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3];
          count++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }
  return out;
}

/* ------------------------------- PNG encode ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- main --------------------------------- */

const source = decodePng(readFileSync(SRC));
console.log(`source: ${source.width}x${source.height}`);
mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, resize(source.width, source.height, source.rgba, size));
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
