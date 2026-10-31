// 把 data/osm.json 栅格化成 Tiled 地图 assets/map.json。用法：npm run map（之后跑 npm run art 重画建筑）
//
// 坐标处理（详见 docs/design.md）：
// 1. 经纬度 → 以 LAT0/LON0 为原点的米坐标（x 向东，y 向南）
// 2. 整片校园的路网约有 3.85° 偏转，先转正，让主要楼和路对齐网格
// 3. 再整体旋转 180°：屏幕上方 = 地理南。从北门进校、往屏幕上方走，正好看到信息学馆朝北的正立面
// 4. 1 格 = 2 米，全图同一比例，不压缩距离
//
// 布局只来自 OSM；OSM 没画的细节（广场铺装、草坪、树、路灯）在 DESIGN 段补充，每项都写了依据。
import { readFileSync, writeFileSync } from 'node:fs';
import { LAYER, METERS_PER_TILE as MPT, TILE, type TiledLayer, type TiledObject, type TiledProperty } from '../shared/world.ts';
import { BUILDING, GROUND, TILESET } from './tiles.ts';

type P = [number, number];
interface El {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
const osm: { elements: El[] } = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));

// ---------- 坐标 ----------
const LAT0 = 41.7655, LON0 = 123.4135;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
/** 校园路网偏转角：由信息学馆北墙（OSM way 87664797）量得 3.84°，图书馆北墙 3.92° */
const ROT = (3.85 * Math.PI) / 180;
/** 地图范围（转正后的米坐标）：东西各到两侧楼群中部，北到北门外约 30 米，南到汉卿北路以南的鼎 */
const X_W = -136, X_E = 136, Y_N = -282, Y_S = 206;
const W = (X_E - X_W) / MPT, H = (Y_S - Y_N) / MPT;

const cos = Math.cos(ROT), sin = Math.sin(ROT);
/** 本地米坐标（未转正）→ 格坐标（浮点，屏幕方向） */
function T([x, y]: P): P {
  const xr = x * cos + y * sin, yr = -x * sin + y * cos;
  return [(X_E - xr) / MPT, (Y_S - yr) / MPT];
}
const local = (lat: number, lon: number): P => [(lon - LON0) * M_LON, (LAT0 - lat) * M_LAT];
const geomT = (e: El): P[] => (e.geometry ?? []).map((g) => T(local(g.lat, g.lon)));
const nodeLocal = (e: El): P => local(e.lat!, e.lon!);

const byId = (id: number) => {
  const e = osm.elements.find((x) => x.id === id);
  if (!e) throw new Error(`OSM 里找不到 ${id}，可能被删改了，先核对 data/osm.json`);
  return e;
};
const byName = (name: string) => {
  const e = osm.elements.find((x) => x.tags.name === name);
  if (!e) throw new Error(`OSM 里找不到「${name}」`);
  return e;
};

// ---------- 几何工具（格坐标） ----------
function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const distLine = (p: P, line: P[]) => Math.min(...line.slice(1).map((b, i) => distSeg(p, line[i], b)));
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ---------- 网格 ----------
type Kind = keyof typeof GROUND;
const kind: Kind[] = new Array(W * H);
const inside = new Uint8Array(W * H);
const solid = new Uint8Array(W * H);
const at = (c: number, r: number) => r * W + c;
const center = (c: number, r: number): P => [c + 0.5, r + 0.5];
function each(fn: (c: number, r: number, p: P, i: number) => void): void {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) fn(c, r, center(c, r), at(c, r));
}
const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H;
const hash = (c: number, r: number) => ((c * 73856093) ^ (r * 19349663)) >>> 0;

// 1. 校界：OSM 上校园范围的那条墙（amenity=university + barrier=wall）
const campus = geomT(byId(53573481));
const gateLocal = nodeLocal(byName('北门'));
const gate = T(gateLocal);
/** 北门外可以走动的门前广场（校外其余区域不可进入） */
const apron = (p: P) => !inPoly(p, campus) && Math.abs(p[0] - gate[0]) < 22 / MPT && p[1] > gate[1] - 1 && p[1] < H;
const park = osm.elements.filter((e) => e.tags.leisure === 'park').map(geomT);
each((_c, _r, p, i) => {
  inside[i] = inPoly(p, campus) ? 1 : 0;
  kind[i] = inside[i] ? 'grass' : park.some((g) => inPoly(p, g)) ? 'park' : 'outside';
  if (apron(p)) kind[i] = 'paving';
});

// 2. 道路：OSM 中心线 + 按道路等级给宽度（米）
const ROAD_W: Record<string, number> = { residential: 8, unclassified: 6, service: 4 };
const roads = osm.elements.filter((e) => e.type === 'way' && ROAD_W[e.tags.highway]);
const footways = osm.elements.filter((e) => e.type === 'way' && ['footway', 'steps', 'path', 'pedestrian'].includes(e.tags.highway));
const roadLines = roads.map((e) => ({ line: geomT(e), half: ROAD_W[e.tags.highway] / 2 / MPT, main: e.tags.highway === 'residential' }));

// 3. 人行道（DESIGN）：校内主干道两侧各 3 米铺装。依据：校园照片里的主干道两侧都有铺装人行道和行道树
const SIDEWALK = 3 / MPT;
each((_c, _r, p, i) => {
  if (!inside[i]) return;
  for (const r of roadLines) if (r.main && distLine(p, r.line) < r.half + SIDEWALK) kind[i] = 'sidewalk';
});

// 4. 广场与草坪（DESIGN）。坐标是未转正的本地米坐标，取自 OSM 顶点（注释里写了来源）
const L = (pts: P[]) => pts.map(T);
/** Y 形路口围出的三角地：路口 87664806 末端、知行路与自强路的折点。依据：照片里校训石背后是草坪和高大针叶树 */
const triangle = L([[9.1, -192.4], [-74.6, -122.9], [80.4, -110.4]]);
/** 信息学馆北面的前庭：三角地底边到信息学馆北墙，两侧到道路 */
const forecourt = L([[-74.6, -122.9], [80.4, -110.4], [75.5, -45], [-80.5, -55]]);
/** 信息学馆与图书馆之间、图书馆四周的广场：两侧到道路，南到图书馆南墙外 8 米。依据：校园平面图上图书馆四周为铺装 */
const core = L([[-80.5, -55], [75.5, -45], [64.7, 133], [-88.9, 128]]);
/** 信息学馆南侧院落中的半圆草坪。依据：校园平面图上院落里画有半圆形绿地 */
const courtLawn = { c: T([-6, 8]), r: 18 / MPT };
each((_c, _r, p, i) => {
  if (!inside[i]) return;
  if (inPoly(p, forecourt) || inPoly(p, core)) kind[i] = 'paving';
  if (inPoly(p, triangle)) kind[i] = 'grass';
  // 半圆：只取圆心北侧（转正后 y 更小 = 屏幕更下方）
  if (dist(p, courtLawn.c) < courtLawn.r && p[1] > courtLawn.c[1]) kind[i] = 'grass';
});

// 5. 步行道（OSM footway），铺装 3 米
each((_c, _r, p, i) => {
  for (const f of footways) {
    const line = geomT(f);
    if (line.length > 1 && distLine(p, line) < 1.5 / MPT) {
      if (!inside[i] && !apron(p)) continue;
      kind[i] = f.tags.footway === 'crossing' ? 'zebra' : 'paving';
    }
  }
});

// 6. 车行道
each((_c, _r, p, i) => {
  for (const r of roadLines) if (distLine(p, r.line) < r.half) kind[i] = kind[i] === 'zebra' ? 'zebra' : 'asphalt';
});

// 7. 水面
for (const e of osm.elements.filter((e) => e.type === 'way' && e.tags.natural === 'water')) {
  const g = geomT(e);
  each((_c, _r, p, i) => {
    if (inPoly(p, g)) kind[i] = 'water';
  });
}

// 8. 校界墙：沿墙线逐格画（四连通，不会漏缝），北门两根大石柱之间与两侧人行门留空
function supercover(a: P, b: P, fn: (c: number, r: number) => void): void {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 4) + 1;
  let prev: P | null = null;
  for (let k = 0; k <= n; k++) {
    const q = lerp(a, b, k / n);
    const cell: P = [Math.floor(q[0]), Math.floor(q[1])];
    if (prev && prev[0] !== cell[0] && prev[1] !== cell[1]) fn(cell[0], prev[1]);
    fn(cell[0], cell[1]);
    prev = cell;
  }
}
const GATE_HALF = 13 / MPT;
for (let k = 1; k < campus.length; k++)
  supercover(campus[k - 1], campus[k], (c, r) => {
    if (!inGrid(c, r) || dist(center(c, r), gate) < GATE_HALF) return;
    kind[at(c, r)] = 'wall';
  });

// ---------- 建筑 ----------
const levelPx = (storeys: number) => storeys * BUILDING.storey + BUILDING.plinth + BUILDING.parapet;
interface Building {
  id: number;
  name: string;
  style: 'info' | 'library' | 'plain';
  /** 每格的高度级别下标（0 = 不属于建筑） */
  cells: Map<number, number>;
  levels: number[];
  extraTop: number;
}
/** 只给核实过名字的楼标名字；OSM 与校园平面图对不上的楼先不标（见 docs/design.md） */
const NAMED: Record<number, { name: string; style: Building['style'] }> = {
  87664797: { name: '信息学馆', style: 'info' },
  87664798: { name: '宁恩承图书馆', style: 'library' },
  514995514: { name: '双馨苑', style: 'plain' },
};
const buildings: Building[] = [];
for (const e of osm.elements.filter((e) => e.type === 'way' && e.tags.building && e.geometry)) {
  const poly = geomT(e);
  const meta = NAMED[e.id] ?? { name: '', style: 'plain' as const };
  const b: Building = { id: e.id, name: meta.name, style: meta.style, cells: new Map(), levels: [0, levelPx(4)], extraTop: 0 };
  // 信息学馆：两翼 5 层，中段 7 层，中央塔楼 10 层，塔顶再加亭子和旗杆（据北门方向照片目测，层数按像素尺度压缩）
  const axis = -5.4; // 北翼东西中点（本地米）
  const infoLevel = (lx: number, ly: number) => (Math.abs(lx - axis) <= 7 && ly < -42 ? 3 : Math.abs(lx - axis) <= 16 && ly < -25 ? 2 : 1);
  if (meta.style === 'info') {
    b.levels = [0, levelPx(5), levelPx(7), levelPx(10)];
    b.extraTop = 40;
  }
  // 图书馆与其他楼：统一 4 层（图书馆据照片为 4 层）
  each((c, r, p) => {
    if (!inPoly(p, poly)) return;
    // 反算本地米坐标，给分段高度用
    const xr = X_E - p[0] * MPT, yr = Y_S - p[1] * MPT;
    const lx = xr * cos - yr * sin, ly = xr * sin + yr * cos;
    b.cells.set(at(c, r), meta.style === 'info' ? infoLevel(lx, ly) : 1);
  });
  if (b.cells.size) buildings.push(b);
}
for (const b of buildings) for (const i of b.cells.keys()) kind[i] = 'floor';

// ---------- 物件 ----------
const objects: TiledObject[] = [];
let nextId = 1;
const props = (o: Record<string, string | number | boolean>): TiledProperty[] =>
  Object.entries(o).map(([name, value]) => ({ name, type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string', value }));
function point(type: string, name: string, p: P, extra: Record<string, string | number | boolean> = {}): void {
  objects.push({ id: nextId++, name, type, x: Math.round(p[0] * TILE), y: Math.round(p[1] * TILE), width: 0, height: 0, point: true, properties: props(extra) });
}
/** 物件脚下的格子：实心物件挡路，花坛也挡。p 是贴图的落脚点（底边中点），挡住脚所在那一排往上 hTiles 排、左右居中 wTiles 列 */
function block(p: P, wTiles = 1, hTiles = 1): void {
  const c0 = Math.round(p[0] - wTiles / 2), r0 = Math.floor(p[1] - 0.01) - hTiles + 1;
  for (let r = r0; r < r0 + hTiles; r++) for (let c = c0; c < c0 + wTiles; c++) if (inGrid(c, r)) solid[at(c, r)] = 1;
}
const free = (p: P) => {
  const c = Math.floor(p[0]), r = Math.floor(p[1]);
  return inGrid(c, r) && inside[at(c, r)] && !solid[at(c, r)] && ['grass', 'paving', 'sidewalk'].includes(kind[at(c, r)]);
};
/** 草坪里的树：只种在草地上，且不贴着步道，免得挡路 */
const green = (p: P) => {
  const c = Math.floor(p[0]), r = Math.floor(p[1]);
  return free(p) && kind[at(c, r)] === 'grass' && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dc, dr]) => !inGrid(c + dc, r + dr) || kind[at(c + dc, r + dr)] !== 'paving');
};
function prop(sprite: string, p: P, solidW = 0, solidH = 1): boolean {
  if (!free(p) || (sprite === 'pine' && !green(p))) return false;
  point('prop', sprite, p, { sprite });
  if (solidW) block(p, solidW, solidH);
  return true;
}

// 北门：四根石柱。大柱在车道两侧，小柱在两侧人行门外；校名牌在西侧大柱上（据校门照片：从校外看在右手）
const along = (d: number): P => T([gateLocal[0] + d, gateLocal[1] + 1]);
for (const [d, sprite] of [[-6, 'pylon-plaque'], [6, 'pylon'], [-12, 'pylon-small'], [12, 'pylon-small']] as const) {
  const p = along(d);
  point('prop', sprite, p, { sprite });
  block(p, 1, 1);
}

// OSM 标注的纪念物与雕塑，位置照搬
const MONUMENTS: [string, string, number, number][] = [
  ['校训石', 'motto-stone', 3, 1],
  ['大书', 'big-book', 2, 1],
  ['能量球', 'energy-ball', 1, 1],
  ['宁恩承先生', 'bust', 1, 1],
  ['张捷迁校友', 'bust', 1, 1],
  ['鼎', 'ding', 2, 1],
];
const monumentAt: Record<string, P> = {};
for (const [name, sprite, w, h] of MONUMENTS) {
  const p = T(nodeLocal(byName(name)));
  monumentAt[name] = p;
  // 纪念物脚下铺一小块圆形铺装
  each((_c, _r, q, i) => {
    if (inside[i] && dist(q, p) < (name === '校训石' ? 5 : 3.2) / MPT && kind[i] !== 'asphalt') kind[i] = 'paving';
  });
  point('prop', sprite, p, { sprite });
  block(p, w, h);
}
// 校训石底座两侧的红花（DESIGN，依据：校训石照片中底座旁有红色花坛）
for (const dx of [-3, 3]) {
  const p: P = [monumentAt['校训石'][0] + dx, monumentAt['校训石'][1]];
  const c = Math.floor(p[0]), r = Math.floor(p[1]);
  if (inGrid(c, r)) kind[at(c, r)] = 'flower';
}

// 树（DESIGN）：前庭与三角地两侧是高大针叶树（据北门、校训石方向的照片），其余主干道人行道上是阔叶行道树
const westRoad = geomT(byName('知行路')), eastRoad = geomT(byName('自强路'));
function rowAlong(line: P[], offset: number, step: number, sprite: string, from: number, to: number): void {
  // 沿折线每隔 step 格放一棵，offset 为向线左侧（正）或右侧（负）的偏移格数
  let acc = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k];
    const len = dist(a, b);
    const n: P = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    for (let s = (step - acc) % step; s < len; s += step) {
      const q = lerp(a, b, s / len);
      if (q[1] < from || q[1] > to) continue;
      prop(sprite, [q[0] + n[0] * offset, q[1] + n[1] * offset], 1, 1);
    }
    acc = (acc + len) % step;
  }
}
const yOf = (lx: number, ly: number) => T([lx, ly])[1];
const forecourtRows: [number, number] = [yOf(0, -45), yOf(0, -118)];
/** 针叶树种在人行道外侧，行道树种在人行道靠外一边（格，离道路中心线） */
const pineOff = 4 / MPT + SIDEWALK + 1.2;
const treeOff = 4 / MPT + SIDEWALK - 0.4;
for (const road of [westRoad, eastRoad])
  for (const side of [1, -1]) {
    rowAlong(road, side * pineOff, 3.5, 'pine', forecourtRows[0], yOf(0, -190));
    rowAlong(road, side * treeOff, 4, 'tree', 0, forecourtRows[0]);
  }
const hanqing = geomT(byName('汉卿北路'));
for (const side of [1, -1]) rowAlong(hanqing, side * treeOff, 4, 'tree', 0, H);
// 三角地草坪里的针叶树：沿两条斜边内侧
const [tJ, tW, tE] = triangle;
for (const [a, b] of [[tJ, tW], [tJ, tE]] as const)
  for (let t = 0.12; t < 0.95; t += 0.11) {
    const q = lerp(a, b, t);
    const toCenter: P = [(tW[0] + tE[0] + tJ[0]) / 3 - q[0], (tW[1] + tE[1] + tJ[1]) / 3 - q[1]];
    const len = Math.hypot(...toCenter);
    prop('pine', [q[0] + (toCenter[0] / len) * 4.5, q[1] + (toCenter[1] / len) * 4.5], 1, 1);
  }

// 路灯与长椅（DESIGN）：前庭两侧路灯；大书广场、图书馆南侧草地、院落四周放长椅，作为停留点
const lampLine = (a: P, b: P, n: number) => {
  for (let k = 0; k <= n; k++) prop('lamp', lerp(a, b, k / n), 0);
};
lampLine(T([-60, -112]), T([-56, -66]), 4);
lampLine(T([66, -102]), T([46, -60]), 4);
const book = monumentAt['大书'];
for (const [dx, dy] of [[-6, -2], [6, -2], [-6, 2], [6, 2]]) prop('bench', [book[0] + dx, book[1] + dy], 0);
for (const name of ['宁恩承先生', '张捷迁校友']) {
  const p = monumentAt[name];
  prop('bench', [p[0] - 3, p[1]], 0);
  prop('bench', [p[0] + 3, p[1]], 0);
}
// 图书馆四周的树池（依据：校园平面图上图书馆外圈画有一排小方块）。南侧被屋顶挡住，只放北、东、西三面
const lib = buildings.find((b) => b.style === 'library')!;
{
  let minC = W, maxC = 0, minR = H, maxR = 0;
  for (const i of lib.cells.keys()) {
    const c = i % W, r = (i / W) | 0;
    minC = Math.min(minC, c), maxC = Math.max(maxC, c), minR = Math.min(minR, r), maxR = Math.max(maxR, r);
  }
  for (let c = minC; c <= maxC; c += 5) prop('tree-pit', [c + 0.5, maxR + 4], 1, 1);
  for (let r = minR + 2; r <= maxR; r += 5) {
    prop('tree-pit', [minC - 3.5, r + 1], 1, 1);
    prop('tree-pit', [maxC + 4.5, r + 1], 1, 1);
  }
}

// 地面的大尺度变化（DESIGN，纯视觉）：广场每 8 格一道深色铺装带，以信息学馆中轴对齐；草地有成片的深浅
{
  const axisC = Math.round(T([-5.4, 0])[0]);
  const smooth = (c: number, r: number) => {
    const n = (x: number, y: number) => (hash(x, y) % 1000) / 1000;
    const x = c / 7, y = r / 7, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const a = n(xi, yi), b = n(xi + 1, yi), c2 = n(xi, yi + 1), d = n(xi + 1, yi + 1);
    return a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d) * fx * fy;
  };
  each((c, r, p, i) => {
    if (kind[i] === 'paving' && inside[i] && (inPoly(p, forecourt) || inPoly(p, core)) && ((c - axisC) % 8 === 0 || r % 8 === 0)) kind[i] = 'band';
    if (kind[i] === 'grass' && smooth(c, r) > 0.62) kind[i] = 'grassDark';
    if (kind[i] === 'asphalt' && !inside[i] && !apron(p)) kind[i] = 'outsideRoad';
  });
}

// 出生点：北门内侧
point('spawn', '北门内', T([gateLocal[0] - 2, gateLocal[1] + 14]), { radius: 3 * TILE });

// 兴趣点：靠近时弹出介绍卡片。只写核实过的事实，来源编号见 docs/sources.md
const POI: { name: string; at: P; text: string; src: string }[] = [
  { name: '北门', at: gate, text: '南湖校区北门。四根石柱的校门，西侧大石柱上竖写校名“東北大學”，落款张学良。进门正对信息学馆。', src: 'S3,S4' },
  { name: '校训石', at: monumentAt['校训石'], text: '刻着东北大学校训：自强不息，知行合一。', src: 'S1,S4,S5' },
  { name: '信息学馆', at: T([-5.4, -66]), text: '原东北大学主楼，正门朝北、正对北门，中央是阶梯式塔楼。', src: 'S1,S3,S4' },
  { name: '大书', at: book, text: '信息学馆与图书馆之间的校园雕塑。', src: 'S1' },
  { name: '宁恩承图书馆', at: T([-18.8, 55]), text: '学校在八十周年校庆之际以宁恩承先生命名，纪念他在东北大学危难时期主持校务。', src: 'S1,S6' },
  { name: '宁恩承先生像', at: monumentAt['宁恩承先生'], text: '宁恩承先生胸像，在图书馆南侧。', src: 'S1' },
  { name: '张捷迁校友像', at: monumentAt['张捷迁校友'], text: '张捷迁校友胸像，在图书馆南侧。', src: 'S1' },
  { name: '鼎', at: monumentAt['鼎'], text: '汉卿北路南侧草坪中的铜鼎。', src: 'S1,S2' },
  { name: '能量球', at: monumentAt['能量球'], text: '信息学馆西侧的校园雕塑。', src: 'S1' },
];
for (const p of POI) point('poi', p.name, p.at, { text: p.text, src: p.src, radius: 4 * TILE });

// 建筑对象：footprint 外接矩形 + 高度图，美术工具按这些画图
for (const b of buildings) {
  let minC = W, maxC = 0, minR = H, maxR = 0;
  for (const i of b.cells.keys()) {
    const c = i % W, r = (i / W) | 0;
    minC = Math.min(minC, c), maxC = Math.max(maxC, c), minR = Math.min(minR, r), maxR = Math.max(maxR, r);
  }
  const rows: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    let s = '';
    for (let c = minC; c <= maxC; c++) s += String(b.cells.get(at(c, r)) ?? 0);
    rows.push(s);
  }
  const top = Math.max(...b.levels) + b.extraTop;
  objects.push({
    id: nextId++,
    name: b.name,
    type: 'building',
    x: minC * TILE,
    y: minR * TILE,
    width: (maxC - minC + 1) * TILE,
    height: (maxR - minR + 1) * TILE,
    properties: props({ sprite: `b${b.id}`, style: b.style, osm: b.id, mask: rows.join('/'), levels: b.levels.join(','), top }),
  });
}

// ---------- 图层 ----------
const PAVED: Kind[] = ['paving', 'band', 'sidewalk', 'asphalt', 'zebra', 'outside', 'outsideRoad', 'floor'];
const groundData: number[] = [], edgeData: number[] = [], blockedData: number[] = [];
const kindAt = (c: number, r: number): Kind | null => (inGrid(c, r) ? kind[at(c, r)] : null);
each((c, r, p, i) => {
  const k = kind[i];
  const variants = GROUND[k];
  groundData.push(TILESET.firstgid + variants[hash(c, r) % variants.length]);
  // 边缘：草地挨着铺装画一道路缘；铺装挨着车行道画路沿石
  let mask = 0;
  const nb: [number, number, number][] = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
  if (k === 'grass' || k === 'grassDark' || k === 'park') {
    for (const [dx, dy, bit] of nb) if (PAVED.includes(kindAt(c + dx, r + dy) as Kind)) mask |= bit;
    edgeData.push(mask ? TILESET.firstgid + TILESET.grassEdge + mask : 0);
  } else if (k === 'paving' || k === 'band' || k === 'sidewalk' || k === 'outside') {
    for (const [dx, dy, bit] of nb) if (['asphalt', 'zebra', 'outsideRoad'].includes(kindAt(c + dx, r + dy) as Kind)) mask |= bit;
    edgeData.push(mask ? TILESET.firstgid + TILESET.curb + mask : 0);
  } else edgeData.push(0);
  const walk = (inside[i] || apron(p)) && !['wall', 'water', 'floor', 'flower', 'hedge'].includes(k) && !solid[i];
  blockedData.push(walk ? 0 : TILESET.firstgid + TILESET.blocked);
});

const tile = (name: string, data: number[], visible = true): TiledLayer => ({ type: 'tilelayer', name, width: W, height: H, data, visible });
const layers = [
  { id: 1, ...tile(LAYER.ground, groundData), x: 0, y: 0, opacity: 1 },
  { id: 2, ...tile(LAYER.edges, edgeData), x: 0, y: 0, opacity: 1 },
  { id: 3, ...tile(LAYER.blocked, blockedData, false), x: 0, y: 0, opacity: 0.4 },
  { id: 4, type: 'objectgroup', name: LAYER.objects, objects, visible: true, x: 0, y: 0, opacity: 1, draworder: 'topdown' },
];
const map = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.2',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: W,
  height: H,
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: 5,
  nextobjectid: nextId,
  properties: props({
    area: '南湖校区·北门—信息学馆—宁恩承图书馆',
    metersPerTile: MPT,
    orientation: '屏幕上方为地理南（整体旋转 180°）',
    attribution: '地图数据 © OpenStreetMap contributors（ODbL）',
  }),
  tilesets: [
    {
      firstgid: TILESET.firstgid,
      name: 'tiles',
      image: 'tiles.png',
      imagewidth: TILESET.columns * TILE,
      imageheight: Math.ceil(TILESET.count / TILESET.columns) * TILE,
      tilewidth: TILE,
      tileheight: TILE,
      tilecount: TILESET.count,
      columns: TILESET.columns,
      margin: 0,
      spacing: 0,
    },
  ],
  layers,
};
writeFileSync(new URL('../assets/map.json', import.meta.url), JSON.stringify(map));
console.log(`assets/map.json：${W}×${H} 格，${buildings.length} 栋楼，${objects.length} 个物件`);
