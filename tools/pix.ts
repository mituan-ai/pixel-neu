// 生成美术用的像素画布：只在 Node 里跑，画完存 PNG（不依赖第三方库）。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PAL, type Color } from './palette.ts';

const rgbOf = (c: Color): number => (typeof c === 'number' ? c : PAL[c]);

export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  /** 画一个点；alpha < 255 时与底色混合（只用于阴影等少数场合） */
  px(x: number, y: number, c: Color, alpha = 255): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const v = rgbOf(c);
    const i = (y * this.w + x) * 4;
    const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    if (alpha >= 255) {
      this.data.set([r, g, b, 255], i);
      return;
    }
    const a = alpha / 255;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa === 0) return;
    for (let k = 0; k < 3; k++) {
      const src = [r, g, b][k];
      this.data[i + k] = (src * a + this.data[i + k] * da * (1 - a)) / oa;
    }
    this.data[i + 3] = oa * 255;
  }

  rect(x: number, y: number, w: number, h: number, c: Color, alpha = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, alpha);
  }

  hline(x: number, y: number, w: number, c: Color): void {
    this.rect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: Color): void {
    this.rect(x, y, 1, h, c);
  }

  /** 实心椭圆（像素对齐） */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, alpha = 255): void {
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++)
        if ((x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) <= 1) this.px(cx + x, cy + y, c, alpha);
  }

  opaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3] > 0;
  }

  /** 把另一张画布贴上来（透明像素跳过） */
  blit(src: Pix, x: number, y: number): void {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const k = (j * src.w + i) * 4;
        const a = src.data[k + 3];
        if (!a) continue;
        const tx = x + i, ty = y + j;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        const v = (src.data[k] << 16) | (src.data[k + 1] << 8) | src.data[k + 2];
        this.px(tx, ty, v, a);
      }
  }

  /** 给已有像素描一圈外轮廓（四邻域） */
  outline(c: Color): void {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.opaque(x, y) && (this.opaque(x - 1, y) || this.opaque(x + 1, y) || this.opaque(x, y - 1) || this.opaque(x, y + 1)))
          add.push([x, y]);
    for (const [x, y] of add) this.px(x, y, c);
  }

  save(path: string | URL): void {
    writeFileSync(path, encodePNG(this.w, this.h, this.data));
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function encodePNG(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** 确定性随机数：同一种子每次生成同样的美术，方便比对 diff */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
