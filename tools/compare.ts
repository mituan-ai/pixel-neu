// 对比图：生成结果（data/preview.png，npm run art 拼的全图）和卫星图按世界坐标左右并排，用来审查描图和画面。
// 用法：npm run compare -- x0 y0 x1 y1 [每米像素] [来源]   范围是世界米坐标；每米像素默认 2；来源见 geo.ts 的 SAT_SOURCES
// 输出 data/compare.png。每米像素低于原图时按块平均缩小，高于时最近邻放大；两边每 50 m 一条网格线。
import { readFileSync, writeFileSync } from 'node:fs';
import { EXTENT, SAT_PPM, SAT_SOURCES } from './geo.ts';
import { decodePNG, encodePNG } from './pix.ts';
import { PPM } from './shape.ts';

const argv = process.argv.slice(2);
const source = argv.length > 5 ? argv.pop()! : SAT_SOURCES[0];
const [x0, y0, x1, y1, ppm = 2] = argv.map(Number);
if (!(x1 > x0 && y1 > y0)) throw new Error('用法：npm run compare -- x0 y0 x1 y1 [每米像素] [来源]');
const W = Math.round((x1 - x0) * ppm), H = Math.round((y1 - y0) * ppm), GAP = 4;
const img = new Uint8ClampedArray((W * 2 + GAP) * H * 4).fill(255);

/** 把每米 k 像素的全图 src 裁出范围，画到 img 的 ox 列起 */
function blit(src: { w: number; h: number; data: Uint8ClampedArray }, k: number, ox: number): void {
  const n = Math.max(1, Math.round(k / ppm));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.floor((x0 - EXTENT.x0 + x / ppm) * k), sy = Math.floor((y0 - EXTENT.y0 + y / ppm) * k);
      const sum = [0, 0, 0];
      let cnt = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const px = sx + i, py = sy + j;
          if (px < 0 || py < 0 || px >= src.w || py >= src.h) continue;
          const o = (py * src.w + px) * 4;
          for (let c = 0; c < 3; c++) sum[c] += src.data[o + c];
          cnt++;
        }
      const o = (y * (W * 2 + GAP) + ox + x) * 4;
      if (cnt) for (let c = 0; c < 3; c++) img[o + c] = sum[c] / cnt;
      img[o + 3] = 255;
    }
  // 网格：每 50 m
  for (let g = Math.ceil(x0 / 50) * 50; g < x1; g += 50)
    for (let y = 0; y < H; y++) img.set([255, 255, 0, 255], (y * (W * 2 + GAP) + ox + Math.round((g - x0) * ppm)) * 4);
  for (let g = Math.ceil(y0 / 50) * 50; g < y1; g += 50)
    for (let x = 0; x < W; x++) img.set([255, 255, 0, 255], (Math.round((g - y0) * ppm) * (W * 2 + GAP) + ox + x) * 4);
}

blit(decodePNG(readFileSync(new URL('../data/preview.png', import.meta.url))), PPM, 0);
blit(decodePNG(readFileSync(new URL(`../data/sat-${source}.png`, import.meta.url))), SAT_PPM, W + GAP);
writeFileSync(new URL('../data/compare.png', import.meta.url), encodePNG(W * 2 + GAP, H, img));
console.log(`data/compare.png：左生成结果、右卫星图 ${source}；x ${x0}–${x1}，y ${y0}–${y1}，每米 ${ppm} 像素，网格 50 m`);
