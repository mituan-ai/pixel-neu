// 对照图：卫星图上叠坐标网格、OSM 楼轮廓和 data/survey.json 的描图，用来描图和验收。
// 用法：npm run check -- [来源] [x0 y0 x1 y1 [每米像素]]   来源见 geo.ts 的 SAT_SOURCES；范围是世界米坐标，默认全图、每米 4 像素
// 输出 data/check.png。网格每 5 m 一条，每 10 m 标坐标。
import { readFileSync, writeFileSync } from 'node:fs';
import { EXTENT, SAT_PPM, SAT_SOURCES, toWorld, type P } from './geo.ts';
import { decodePNG, encodePNG } from './pix.ts';
import { loadSurvey, type Survey } from './survey.ts';

const argv = process.argv.slice(2);
const source = isNaN(Number(argv[0])) ? argv.shift()! : SAT_SOURCES[0];
const sat = decodePNG(readFileSync(new URL(`../data/sat-${source}.png`, import.meta.url)));
if (sat.w !== (EXTENT.x1 - EXTENT.x0) * SAT_PPM || sat.h !== (EXTENT.y1 - EXTENT.y0) * SAT_PPM)
  throw new Error(`data/sat-${source}.png 是按旧的地图范围抓的，先跑 npm run sat -- ${source}`);
const args = argv.map(Number);
const [x0, y0, x1, y1] = args.length >= 4 ? args : [EXTENT.x0, EXTENT.y0, EXTENT.x1, EXTENT.y1];
const ppm = args[4] || SAT_PPM;
const W = Math.round((x1 - x0) * ppm), H = Math.round((y1 - y0) * ppm);
const img = new Uint8ClampedArray(W * H * 4);

// 底图：最近邻放大
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const sx = Math.floor((x0 - EXTENT.x0 + (x + 0.5) / ppm) * SAT_PPM), sy = Math.floor((y0 - EXTENT.y0 + (y + 0.5) / ppm) * SAT_PPM);
    const o = (y * W + x) * 4;
    if (sx < 0 || sy < 0 || sx >= sat.w || sy >= sat.h) continue;
    img.set(sat.data.subarray((sy * sat.w + sx) * 4, (sy * sat.w + sx) * 4 + 4), o);
  }

type RGB = [number, number, number];
const toPx = ([wx, wy]: P): P => [(wx - x0) * ppm, (wy - y0) * ppm];
function dot(x: number, y: number, c: RGB, a = 1): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - a) + c[k] * a;
}
function line(a: P, b: P, c: RGB, alpha = 1): void {
  const [ax, ay] = toPx(a), [bx, by] = toPx(b);
  const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) + 1;
  for (let i = 0; i <= n; i++) dot(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, c, alpha);
}
const ring = (poly: P[], c: RGB) => poly.forEach((p, i) => line(p, poly[(i + 1) % poly.length], c));

// 3×5 数字字形，放大 2 倍
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
const MINUS = '000000111000000';
function label(text: string, x: number, y: number): void {
  [...text].forEach((ch, i) => {
    const g = ch === '-' ? MINUS : DIGITS[+ch];
    for (let r = 0; r < 5; r++)
      for (let q = 0; q < 3; q++)
        if (g[r * 3 + q] === '1') for (let s = 0; s < 4; s++) dot(x + i * 8 + q * 2 + (s & 1), y + r * 2 + (s >> 1), [255, 255, 0]);
  });
}

// 网格
for (let gx = Math.ceil(x0 / 5) * 5; gx <= x1; gx += 5) line([gx, y0], [gx, y1], [255, 255, 0], gx % 10 ? 0.25 : 0.5);
for (let gy = Math.ceil(y0 / 5) * 5; gy <= y1; gy += 5) line([x0, gy], [x1, gy], [255, 255, 0], gy % 10 ? 0.25 : 0.5);
for (let gx = Math.ceil(x0 / 10) * 10; gx <= x1; gx += 10) label(String(gx), toPx([gx, y0])[0] + 2, 2);
for (let gy = Math.ceil(y0 / 10) * 10; gy <= y1; gy += 10) label(String(gy), 2, toPx([x0, gy])[1] + 2);

// OSM 楼轮廓（红），校正后的楼基和补描的楼（品红）
const survey: Survey = loadSurvey();
const osm = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));
for (const e of osm.elements) {
  if (!e.tags.building || !e.geometry) continue;
  const poly: P[] = e.geometry.map((g: { lat: number; lon: number }) => toWorld(g.lat, g.lon));
  ring(poly, [255, 40, 40]);
  const { shift: s = [0, 0], lean } = survey.buildings[e.id] ?? {};
  const base = poly.map(([x, y]): P => [x + s[0], y + s[1]]);
  if (s[0] || s[1]) ring(base, [255, 0, 255]);
  // lean：楼基是轮廓和它朝 lean 反方向挪过的那份的重叠部分，两圈都画出来
  if (lean) ring(base.map(([x, y]): P => [x - lean[0], y - lean[1]]), [255, 0, 255]);
}
for (const b of survey.newBuildings) ring(b.poly, [255, 0, 255]);

// 描图：面按类别上色，树画冠幅圆
const COLORS: Record<string, RGB> = { asphalt: [80, 160, 255], paving: [255, 160, 0], parking: [0, 220, 255], grass: [120, 255, 80], wood: [0, 255, 120], hedge: [255, 0, 160], planter: [200, 255, 0], water: [0, 120, 255], track: [255, 60, 60], pitch: [200, 255, 120], court: [0, 255, 200] };
for (const a of survey.areas) ring(a.poly, COLORS[a.kind] ?? [255, 255, 255]);
for (const [tx, ty, r] of survey.trees) {
  const [cx, cy] = toPx([tx, ty]);
  for (let i = 0; i < 64; i++) dot(cx + Math.cos((i / 64) * Math.PI * 2) * r * ppm, cy + Math.sin((i / 64) * Math.PI * 2) * r * ppm, [0, 255, 120]);
  dot(cx, cy, [255, 255, 255]);
}

writeFileSync(new URL('../data/check.png', import.meta.url), encodePNG(W, H, img));
console.log(`data/check.png：x ${x0}–${x1}，y ${y0}–${y1}，每米 ${ppm} 像素，${W}×${H}`);
