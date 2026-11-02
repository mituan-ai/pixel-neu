// 视差测楼：用两期卫星图上楼顶的错位，反推每栋楼的高度和楼基位置。
// 用法：npm run parallax -- x0 y0 x1 y1        范围是世界米坐标，量中心落在范围里的 OSM 楼
//
// 卫星图斜着拍，楼顶比楼基偏出「楼高 × 每米偏移 t」，两期偏的方向不同。所以：
// 1. 第一期 OSM 轮廓里的灰度和第二期做相关，求出楼顶在两期之间挪了多少
// 2. 找楼顶在第一期的位置 d：第一期轮廓挪 d、第二期轮廓挪 d 加上一步的错位时，两期轮廓边上的亮度梯度都最强。
//    单看一期，轮廓常对到露出的立面或阴影的边上，两期露出的是不同的面，合起来只剩楼顶
// 3. survey.json 的 tilt 给出这片的参考楼（shift 和 storeys 对着墙脚量准的）和两期地面的错位 off，用它求出两期的 t
// 4. 每栋楼：d1 = s + h·t1，d2 − off = s + h·t2，最小二乘解出楼高 h 和楼基平移 s
// 输出每栋楼的建议 shift、storeys 和残差，以及对照图 data/parallax.png（第一期；红 OSM、黄楼顶、品红算出的楼基）。
import { readFileSync, writeFileSync } from 'node:fs';
import { levelPx, type OsmEl } from './buildings.ts';
import { EXTENT, SAT_PPM, SAT_SOURCES, toWorld, type P } from './geo.ts';
import { decodePNG, encodePNG } from './pix.ts';
import { PPM, inPoly } from './shape.ts';
import { loadSurvey } from './survey.ts';

/** 楼顶最多偏离 OSM 轮廓多少米 */
const R = 14;
const [A, B] = SAT_SOURCES;

const box = process.argv.slice(2).map(Number);
if (box.length !== 4 || box.some(isNaN)) throw new Error('用法：npm run parallax -- x0 y0 x1 y1');
const [x0, y0, x1, y1] = box;
const survey = loadSurvey();
const osm: { elements: OsmEl[] } = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));

/** 中心落在范围里的 OSM 楼（不含 drop 的） */
const blds = osm.elements
  .filter((e) => e.type === 'way' && e.tags.building && e.geometry && !survey.buildings[e.id]?.drop)
  .map((e) => ({ id: e.id, poly: e.geometry!.map((q) => toWorld(q.lat, q.lon)) }))
  .filter(({ poly }) => {
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    return cx >= x0 && cx < x1 && cy >= y0 && cy < y1;
  });
if (!blds.length) throw new Error(`x ${x0}–${x1}、y ${y0}–${y1} 里没有 OSM 楼`);

// 读图窗口：这些楼的外接框外扩 2R + 2 m（第一期挪 R、第二期再挪 R）
const all = blds.flatMap((b) => b.poly), pad = 2 * R + 2;
const wx0 = Math.min(...all.map((p) => p[0])) - pad, wy0 = Math.min(...all.map((p) => p[1])) - pad;
const wx1 = Math.max(...all.map((p) => p[0])) + pad, wy1 = Math.max(...all.map((p) => p[1])) + pad;
const gx0 = Math.floor((wx0 - EXTENT.x0) * SAT_PPM), gy0 = Math.floor((wy0 - EXTENT.y0) * SAT_PPM);
const GW = Math.ceil((wx1 - wx0) * SAT_PPM), GH = Math.ceil((wy1 - wy0) * SAT_PPM);

/** 窗口里的颜色、灰度和灰度梯度 */
function load(source: string): { rgb: Uint8ClampedArray; g: Float32Array; dx: Float32Array; dy: Float32Array } {
  const sat = decodePNG(readFileSync(new URL(`../data/sat-${source}.png`, import.meta.url)));
  const rgb = new Uint8ClampedArray(GW * GH * 4), g = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const sx = Math.min(sat.w - 1, Math.max(0, gx0 + x)), sy = Math.min(sat.h - 1, Math.max(0, gy0 + y));
      const o = (sy * sat.w + sx) * 4;
      rgb.set(sat.data.subarray(o, o + 4), (y * GW + x) * 4);
      g[y * GW + x] = 0.299 * sat.data[o] + 0.587 * sat.data[o + 1] + 0.114 * sat.data[o + 2];
    }
  const dx = new Float32Array(GW * GH), dy = new Float32Array(GW * GH);
  for (let y = 1; y < GH - 1; y++)
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      dx[i] = (g[i + 1] - g[i - 1]) / 2;
      dy[i] = (g[i + GW] - g[i - GW]) / 2;
    }
  return { rgb, g, dx, dy };
}
const img: Record<string, ReturnType<typeof load>> = { [A]: load(A), [B]: load(B) };
/** 世界米 → 窗口像素 */
const gp = ([x, y]: P): P => [(x - EXTENT.x0) * SAT_PPM - gx0, (y - EXTENT.y0) * SAT_PPM - gy0];

/** 轮廓边上每 1/SAT_PPM 米一个采样点（窗口像素）和法线 */
function edgeSamples(poly: P[]): { p: P; n: P }[] {
  const out: { p: P; n: P }[] = [];
  poly.forEach((a, k) => {
    const b = poly[(k + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!l) return;
    const n: P = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
    for (let s = 0.5; s < l * SAT_PPM; s++) out.push({ p: gp([a[0] + ((b[0] - a[0]) * s) / (l * SAT_PPM), a[1] + ((b[1] - a[1]) * s) / (l * SAT_PPM)]), n });
  });
  return out;
}

/** 轮廓平移 ±R 米内（每 1/SAT_PPM 米一档）边上法向梯度之和，按最大值归一 */
function edgeScore(poly: P[], source: string): Float32Array {
  const { dx, dy } = img[source];
  const pts = edgeSamples(poly);
  const r = R * SAT_PPM, n = 2 * r + 1;
  const score = new Float32Array(n * n);
  for (let v = -r; v <= r; v++)
    for (let u = -r; u <= r; u++) {
      let s = 0;
      for (const { p, n: nn } of pts) {
        const i = Math.round(p[1] + v) * GW + Math.round(p[0] + u);
        s += Math.abs(dx[i] * nn[0] + dy[i] * nn[1]);
      }
      score[(v + r) * n + u + r] = s;
    }
  const top = score.reduce((a, v) => Math.max(a, v), 0);
  return score.map((v) => v / top);
}

/** 楼顶在第二期相对第一期挪了多少（窗口像素）：第一期轮廓里的灰度和第二期做归一化相关，先 1 m 粗找再逐像素细找 */
function roofShift(poly: P[]): { d: P; ncc: number } {
  const ga = img[A].g, gb = img[B].g;
  const idx: number[] = [];
  const xs = poly.map((p) => gp(p)[0]), ys = poly.map((p) => gp(p)[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++)
      if (inPoly([EXTENT.x0 + (gx0 + x + 0.5) / SAT_PPM, EXTENT.y0 + (gy0 + y + 0.5) / SAT_PPM], poly)) idx.push(y * GW + x);
  const ncc = (u: number, v: number) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (const i of idx) {
      const p = ga[i], q = gb[i + v * GW + u];
      (sa += p), (sb += q), (saa += p * p), (sbb += q * q), (sab += p * q);
    }
    const k = idx.length;
    return (sab - (sa * sb) / k) / Math.sqrt((saa - (sa * sa) / k) * (sbb - (sb * sb) / k) || 1);
  };
  let best: P = [0, 0], bs = -Infinity;
  for (let v = -R; v <= R; v++)
    for (let u = -R; u <= R; u++) {
      const s = ncc(u * SAT_PPM, v * SAT_PPM);
      if (s > bs) (bs = s), (best = [u * SAT_PPM, v * SAT_PPM]);
    }
  const [cu, cv] = best;
  for (let v = cv - SAT_PPM; v <= cv + SAT_PPM; v++)
    for (let u = cu - SAT_PPM; u <= cu + SAT_PPM; u++) {
      const s = ncc(u, v);
      if (s > bs) (bs = s), (best = [u, v]);
    }
  return { d: best, ncc: bs };
}

/** 两期楼顶相对 OSM 轮廓的位置（米） */
function roofOffsets(poly: P[]): { a: P; b: P; ncc: number } {
  const { d: [du, dv], ncc } = roofShift(poly);
  const ea = edgeScore(poly, A), eb = edgeScore(poly, B);
  const r = R * SAT_PPM, n = 2 * r + 1;
  let best = -1, bu = 0, bv = 0;
  for (let v = -r; v <= r; v++)
    for (let u = -r; u <= r; u++) {
      const u2 = u + du, v2 = v + dv;
      if (Math.abs(u2) > r || Math.abs(v2) > r) continue;
      const s = ea[(v + r) * n + u + r] + eb[(v2 + r) * n + u2 + r];
      if (s > best) (best = s), (bu = u), (bv = v);
    }
  return { a: [bu / SAT_PPM, bv / SAT_PPM], b: [(bu + du) / SAT_PPM, (bv + dv) / SAT_PPM], ncc };
}

/** 楼高（米）和层数互换，和 buildings.ts 画楼一样算底座和女儿墙 */
const heightOf = (storeys: number) => levelPx(storeys) / PPM;
const storeysOf = (h: number) => Math.max(1, Math.round((h * PPM - levelPx(0)) / (levelPx(1) - levelPx(0))));
const f = (p: P) => `[${p.map((v) => v.toFixed(1)).join(', ')}]`;

const meas = blds.map((b) => ({ ...b, ...roofOffsets(b.poly) }));

// 标定：tilt 里范围包含这片中心的那条
const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
const cal = survey.tilt.find(({ box: [a0, b0, a1, b1] }) => cx >= a0 && cx < a1 && cy >= b0 && cy < b1);
const off: P = cal?.off ?? [0, 0];
let t: [P, P] | undefined;
if (cal) {
  const ref = meas.find((m) => m.id === cal.ref);
  if (!ref) throw new Error(`参考楼 ${cal.ref} 不在 x ${x0}–${x1}、y ${y0}–${y1} 里，把范围扩到包含它`);
  const fix = survey.buildings[cal.ref];
  if (!fix?.storeys) throw new Error(`参考楼 ${cal.ref} 在 survey.json 里要写量准的 storeys 和 shift`);
  const s = fix.shift ?? [0, 0], h = heightOf(fix.storeys);
  t = [
    [(ref.a[0] - s[0]) / h, (ref.a[1] - s[1]) / h],
    [(ref.b[0] - off[0] - s[0]) / h, (ref.b[1] - off[1] - s[1]) / h],
  ];
  console.log(`参考楼 ${cal.ref}（${fix.storeys} 层），${B} 地面相对 ${A} 错开 ${f(off)}：每米楼高 ${A} 偏 [${t[0].map((v) => v.toFixed(3)).join(', ')}]，${B} 偏 [${t[1].map((v) => v.toFixed(3)).join(', ')}]`);
} else console.log('survey.json 的 tilt 里没有覆盖这片的参考楼，只输出楼顶位置，不解楼高和楼基');

console.log(`\nOSM 编号 | 现 shift | 现层数 | ${A} 楼顶 | ${B} 楼顶 | 楼顶相关 | 建议 shift | 建议层数 | 楼高 m | 残差 m`);
const draw: { poly: P[]; roof: P; base?: P }[] = [];
for (const m of meas) {
  const fix = survey.buildings[m.id] ?? {};
  const row = [m.id, fix.shift ? f(fix.shift) : '—', fix.storeys ?? '—', f(m.a), f(m.b), m.ncc.toFixed(2)];
  let base: P | undefined;
  if (t) {
    const d2: P = [m.b[0] - off[0], m.b[1] - off[1]];
    const dt: P = [t[0][0] - t[1][0], t[0][1] - t[1][1]];
    const h = Math.max(0, ((m.a[0] - d2[0]) * dt[0] + (m.a[1] - d2[1]) * dt[1]) / (dt[0] ** 2 + dt[1] ** 2));
    base = [(m.a[0] - h * t[0][0] + d2[0] - h * t[1][0]) / 2, (m.a[1] - h * t[0][1] + d2[1] - h * t[1][1]) / 2];
    const res = Math.hypot(m.a[0] - base[0] - h * t[0][0], m.a[1] - base[1] - h * t[0][1]);
    row.push(f(base), storeysOf(h), h.toFixed(1), res.toFixed(1));
  }
  console.log(row.join(' | '));
  draw.push({ poly: m.poly, roof: m.a, base });
}
console.log('\n楼顶相关是两期楼顶灰度的相关系数，低于 0.6 的两期没对上，别用；残差大于 1.5 m 说明两期对不上（轮廓不是楼顶、楼被树挡，或参考楼不准）');

// 对照图
const out = new Uint8ClampedArray(img[A].rgb);
const ring = (poly: P[], d: P, c: [number, number, number]) =>
  poly.forEach((a, k) => {
    const b = poly[(k + 1) % poly.length];
    const [ax, ay] = gp([a[0] + d[0], a[1] + d[1]]), [bx, by] = gp([b[0] + d[0], b[1] + d[1]]);
    const n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
      if (x >= 0 && y >= 0 && x < GW && y < GH) out.set(c, (y * GW + x) * 4);
    }
  });
for (const b of draw) {
  ring(b.poly, [0, 0], [255, 40, 40]);
  ring(b.poly, b.roof, [255, 230, 0]);
  if (b.base) ring(b.poly, b.base, [255, 0, 255]);
}
writeFileSync(new URL('../data/parallax.png', import.meta.url), encodePNG(GW, GH, out));
console.log(`data/parallax.png：${A}，x ${wx0.toFixed(0)}–${wx1.toFixed(0)}，y ${wy0.toFixed(0)}–${wy1.toFixed(0)}，每米 ${SAT_PPM} 像素`);
