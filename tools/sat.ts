// 抓卫星图，重采样到世界坐标（上北、转正），存为 data/sat-<来源>.png，作为描图和对照的底图。
// 卫星图只作参考，不进仓库（.gitignore），也不进游戏。来源登记见 docs/sources.md 的 S7、S8。
// 用法：npm run sat [-- 来源]，默认 2025-07-31。天地图要在 .env.local 里写 TIANDITU_TK（服务端 Key）
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { encodePNG } from './pix.ts';
import { EXTENT, SAT_PPM, SAT_SOURCES, toLatLon, type P } from './geo.ts';

const ENV = new URL('../.env.local', import.meta.url);
if (existsSync(ENV)) process.loadEnvFile(ENV);

const WAYBACK = (id: number) => (z: number, x: number, y: number) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/${z}/${y}/${x}`;
/**
 * 各来源的最高缩放级别和瓦片地址。
 * Esri Wayback（S7）：版本号见 waybackconfig.json。2025-07-31 是夏季、阴影短，适合描树和地面；2018 年及以前图书馆四周还是广场，布局已变，只能参考。
 * 天地图（S8）：这一带只到 z18（约 0.45 m/像素），比 Esri 糊，但拍摄时间和角度不同，用来交叉核对。国内服务，直连不走代理。
 */
const SOURCES: Record<(typeof SAT_SOURCES)[number], { z: number; url: (z: number, x: number, y: number) => string; direct?: boolean }> = {
  '2026-10-29': { z: 19, url: WAYBACK(43291) },
  '2025-07-31': { z: 19, url: WAYBACK(49999) },
  '2024-03-28': { z: 19, url: WAYBACK(13968) },
  tianditu: {
    z: 18,
    direct: true,
    url: (z, x, y) =>
      `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${process.env.TIANDITU_TK}`,
  },
};
const name = (process.argv[2] ?? SAT_SOURCES[0]) as keyof typeof SOURCES;
const source = SOURCES[name];
if (!source) throw new Error(`没有这个来源：${name}。可选 ${SAT_SOURCES.join('、')}`);
if (name === 'tianditu' && !process.env.TIANDITU_TK) throw new Error('.env.local 里没有 TIANDITU_TK');

/** 瓦片像素坐标（浮点） */
const N = 256 * 2 ** source.z;
const tilePx = ([lat, lon]: P): P => [((lon + 180) / 360) * N, ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * N];

const W = (EXTENT.x1 - EXTENT.x0) * SAT_PPM, H = (EXTENT.y1 - EXTENT.y0) * SAT_PPM;
/** 卫星图像素 → 世界米坐标：图的左上角是 EXTENT 的西北角 */
const world = (x: number, y: number): P => [EXTENT.x0 + x / SAT_PPM, EXTENT.y0 + y / SAT_PPM];

// 世界范围四角外扩 10 m，算出要拼的瓦片
const corners = [[-40, -40], [W + 40, -40], [-40, H + 40], [W + 40, H + 40]].map(([x, y]) => tilePx(toLatLon(world(x, y))));
const tx0 = Math.floor(Math.min(...corners.map((c) => c[0])) / 256), tx1 = Math.floor(Math.max(...corners.map((c) => c[0])) / 256);
const ty0 = Math.floor(Math.min(...corners.map((c) => c[1])) / 256), ty1 = Math.floor(Math.max(...corners.map((c) => c[1])) / 256);
const sw = (tx1 - tx0 + 1) * 256, sh = (ty1 - ty0 + 1) * 256;
const src = new Uint8Array(sw * sh * 4);
let missing = 0;
for (let ty = ty0; ty <= ty1; ty++)
  for (let tx = tx0; tx <= tx1; tx++) {
    // 用 curl：国外来源走系统代理，国内来源直连；Wayback 某期没变的瓦片会 301 到更早一期，要跟着跳
    const body = execFileSync('curl', ['-sSfL', '-m', '60', ...(source.direct ? ['--noproxy', '*'] : []), source.url(source.z, tx, ty)]);
    // 不是 JPEG 的瓦片（这一期没拍到的地方），留成黑色，最后报数
    if (body[0] !== 0xff || body[1] !== 0xd8) {
      if (!missing++) console.log(`瓦片不是 JPEG（${body.subarray(0, 8).toString('hex')}）：${source.url(source.z, tx, ty)}`);
      continue;
    }
    const t = jpeg.decode(body, { useTArray: true });
    for (let r = 0; r < 256; r++) src.set(t.data.subarray(r * 1024, r * 1024 + 1024), ((ty - ty0) * 256 + r) * sw * 4 + (tx - tx0) * 1024);
  }

// 双线性重采样到世界坐标
const out = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const [px, py] = tilePx(toLatLon(world(x + 0.5, y + 0.5)));
    const sx = px - tx0 * 256 - 0.5, sy = py - ty0 * 256 - 0.5;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const o = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) {
      const at = (cx: number, cy: number) => src[(Math.min(sh - 1, Math.max(0, cy)) * sw + Math.min(sw - 1, Math.max(0, cx))) * 4 + k];
      out[o + k] = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
    }
    out[o + 3] = 255;
  }
writeFileSync(new URL(`../data/sat-${name}.png`, import.meta.url), encodePNG(W, H, out));
console.log(`data/sat-${name}.png：${W}×${H}，每米 ${SAT_PPM} 像素${missing ? `；${missing} 张瓦片缺图，留黑` : ''}`);
