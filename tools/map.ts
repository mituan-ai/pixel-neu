// 生成 Tiled 地图 assets/map.json。用法：npm run map（之后跑 npm run art 重画建筑）
//
// 世界坐标见 geo.ts：上北，单位米。这个文件里的坐标一律先经 cell() 换成格（减去地图西北角，再除以 METERS_PER_TILE）。
// 地面（路、铺装、林地、草坪、停车场）全部来自 data/survey.json（从卫星图 S7 描的）；没描过的地方画成不可进入的校外色块。
// 楼的占地、纪念物和北门的位置来自 OSM（S1）。只有林地里的树是按冠幅铺满的（DESIGN），因为单棵树的位置看不清。
import { readFileSync, writeFileSync } from 'node:fs';
import { LAYER, METERS_PER_TILE as M, TILE, type TiledLayer, type TiledObject, type TiledProperty } from '../shared/world.ts';
import { EXTENT, MAP_W as W, MAP_H as H, toWorld, type P } from './geo.ts';
import { loadSurvey } from './survey.ts';
import { BUILDING, GROUND, TILESET, TREES } from './tiles.ts';

interface El {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
const osm: { elements: El[] } = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));
const survey = loadSurvey();

/** 世界米坐标 → 格坐标 */
const cell = ([x, y]: P): P => [(x - EXTENT.x0) / M, (y - EXTENT.y0) / M];
const geom = (e: El): P[] => (e.geometry ?? []).map((g) => cell(toWorld(g.lat, g.lon)));
const nodeAt = (e: El): P => cell(toWorld(e.lat!, e.lon!));
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

function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ---------- 网格 ----------
type Kind = keyof typeof GROUND;
const kind: Kind[] = new Array(W * H).fill('outside');
const solid = new Uint8Array(W * H);
const at = (c: number, r: number) => r * W + c;
const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H;
const kindAt = (c: number, r: number): Kind | null => (inGrid(c, r) ? kind[at(c, r)] : null);
const hash = (c: number, r: number) => ((c * 73856093) ^ (r * 19349663)) >>> 0;
function each(fn: (c: number, r: number, p: P, i: number) => void): void {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) fn(c, r, [c + 0.5, r + 0.5], at(c, r));
}
/** 只扫多边形外接矩形里的格子 */
function fill(poly: P[], fn: (i: number, c: number, r: number) => void): void {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const c0 = Math.max(0, Math.floor(Math.min(...xs))), c1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const r0 = Math.max(0, Math.floor(Math.min(...ys))), r1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inPoly([c + 0.5, r + 0.5], poly)) fn(at(c, r), c, r);
}

// 1. 地面：按 survey.json 的顺序铺，后写的盖住先写的
const AREA_KIND: Record<string, Kind> = { asphalt: 'asphalt', paving: 'paving', parking: 'parking', grass: 'grass', wood: 'wood', hedge: 'hedge', planter: 'flower', water: 'water', track: 'track', pitch: 'pitch', court: 'court' };
for (const a of survey.areas) fill(a.poly.map(cell), (i) => (kind[i] = AREA_KIND[a.kind]));
// 斜边换算成格子后，相邻两块之间会漏出校外格。从地图边上连不出去的校外格都是漏缝，由外向内用邻格补上
{
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const open = new Uint8Array(W * H);
  const queue: number[] = [];
  each((c, r, _p, i) => {
    if (kind[i] === 'outside' && (c === 0 || r === 0 || c === W - 1 || r === H - 1)) (open[i] = 1), queue.push(i);
  });
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] % W, r = (queue[head] / W) | 0;
    for (const [dc, dr] of DIRS) {
      const j = at(c + dc, r + dr);
      if (inGrid(c + dc, r + dr) && !open[j] && kind[j] === 'outside') (open[j] = 1), queue.push(j);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    each((c, r, _p, i) => {
      if (kind[i] !== 'outside' || open[i]) return;
      const nb = DIRS.map(([dc, dr]) => kindAt(c + dc, r + dr)).find((k) => k && k !== 'outside');
      if (nb) (kind[i] = nb), (changed = true);
    });
  }
}

// 2. 校界墙（OSM 上的校园范围线），北门大门与两侧人行门留空
const campus = geom(byId(53573481));
const gate = nodeAt(byName('北门'));
const GATE_HALF = 15 / M;
/** 校界上的豁口：北门，加上 survey.json 记下的其他校门 */
const openings = [{ at: gate, half: GATE_HALF }, ...survey.gates.map((g) => ({ at: cell(g.at), half: g.width / 2 / M }))];
const inOpening = (q: P) => openings.some((o) => dist(q, o.at) < o.half);
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
// 墙所在的格子照常挡路，地面按原来的画；墙本身是沿范围线的铁栅栏（据 R-gate-03 照片），由客户端按折线画，斜着走也不会成台阶
const wallUnder = new Map<number, Kind>();
for (let k = 1; k < campus.length; k++)
  supercover(campus[k - 1], campus[k], (c, r) => {
    if (inGrid(c, r) && kind[at(c, r)] !== 'outside' && !inOpening([c + 0.5, r + 0.5])) {
      if (kind[at(c, r)] !== 'wall') wallUnder.set(at(c, r), kind[at(c, r)]);
      kind[at(c, r)] = 'wall';
    }
  });
/** 栅栏折线：范围线上落在描过地面、又不在大门口的连续几段 */
const fences: P[][] = [];
{
  let run: P[] = [];
  const flush = () => (run.length > 1 && fences.push(run), (run = []));
  for (let k = 1; k < campus.length; k++) {
    const [a, b] = [campus[k - 1], campus[k]];
    const n = Math.max(1, Math.ceil(dist(a, b) * 2));
    for (let j = k === 1 ? 0 : 1; j <= n; j++) {
      const q = lerp(a, b, j / n);
      const ok = inGrid(Math.floor(q[0]), Math.floor(q[1])) && kind[at(Math.floor(q[0]), Math.floor(q[1]))] === 'wall' && !inOpening(q);
      if (ok) run.push(q);
      else flush();
    }
  }
  flush();
}

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
/** 只给核实过名字的楼标名字 */
const NAMED: Record<number, { name: string; style: Building['style'] }> = {
  87664797: { name: '信息学馆', style: 'info' },
  87664798: { name: '宁恩承图书馆', style: 'library' },
};
const buildings: Building[] = [];
// OSM 的楼，加上 survey.json 里补描的楼（没有 OSM 编号，用负数）
const footprints = [
  ...osm.elements.filter((e) => e.type === 'way' && e.tags.building && e.geometry).map((e) => ({ id: e.id, poly: geom(e), levels: Number(e.tags['building:levels']) || 0 })),
  ...survey.newBuildings.map((b, k) => ({ id: -(k + 1), poly: b.poly.map(cell), levels: b.storeys })),
];
for (const e of footprints) {
  // OSM 轮廓贴的是斜拍的楼顶，survey.json 里记了平移到楼基的量
  const { shift = [0, 0], lean = [0, 0], storeys = e.levels || 4, drop } = survey.buildings[e.id] ?? {};
  if (drop) continue;
  const poly = e.poly.map(([x, y]): P => [x + shift[0] / M, y + shift[1] / M]);
  // 只画已经描过地面的楼：楼基至少一半的格子在描过的范围里；伸出地图边的部分裁掉
  let inside = 0, total = 0;
  fill(poly, (i) => (total++, kind[i] !== 'outside' && inside++));
  if (!total || inside * 2 < total) continue;
  const meta = NAMED[e.id] ?? { name: '', style: 'plain' as const };
  // 图书馆 4 层（据照片）；其他楼按 survey.json 或 OSM 的层数
  const b: Building = { id: e.id, name: meta.name, style: meta.style, cells: new Map(), levels: [0, levelPx(storeys)], extraTop: 0 };
  // 楼基 = 轮廓里往楼顶方向挪 lean 后仍在轮廓内的格子
  fill(poly, (i, c, r) => {
    if (inPoly([c + 0.5 + lean[0] / M, r + 0.5 + lean[1] / M], poly)) b.cells.set(i, 1);
  });
  // 信息学馆（据航拍 R-info-06-02、正面照 R-info-01）：两翼 5 层；中轴上的中央楼 7 层，宽约 26 m、
  // 从北墙往南约 19.5 m（宽深据卫星图 S7 上中央楼的屋面）；楼顶再有退台、小塔和旗杆
  if (meta.style === 'info') {
    b.levels = [0, levelPx(5), levelPx(7)];
    b.extraTop = 4 * BUILDING.storey;
    const r0 = Math.min(...[...b.cells.keys()].map((i) => Math.floor(i / W)));
    for (const i of b.cells.keys())
      if (Math.abs((i % W) + 0.5 - gate[0]) <= 13 / M && Math.floor(i / W) < r0 + 19.5 / M) b.cells.set(i, 2);
  }
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
/** 物件挡路：以 p（格坐标，物件占地中心）为中心、东西 wm 米、南北 dm 米的矩形覆盖到的格子 */
function block(p: P, wm: number, dm: number): void {
  const c0 = Math.floor(p[0] - wm / M / 2 + 0.25), c1 = Math.ceil(p[0] + wm / M / 2 - 0.25);
  const r0 = Math.floor(p[1] - dm / M / 2 + 0.25), r1 = Math.ceil(p[1] + dm / M / 2 - 0.25);
  for (let r = r0; r < Math.max(r1, r0 + 1); r++) for (let c = c0; c < Math.max(c1, c0 + 1); c++) if (inGrid(c, r)) solid[at(c, r)] = 1;
}
/** 放一个物件：位置是占地中心；rot 是相对美术朝向（车头朝北）顺时针转了几个 90° */
function placeProp(sprite: string, p: P, wm: number, dm: number, rot = 0): void {
  point('prop', sprite, p, rot ? { sprite, rot } : { sprite });
  if (rot % 2) [wm, dm] = [dm, wm];
  block(p, wm, dm);
}

// 校界栅栏：折线，坐标按像素
for (const f of fences)
  objects.push({
    id: nextId++, name: '', type: 'fence', x: Math.round(f[0][0] * TILE), y: Math.round(f[0][1] * TILE), width: 0, height: 0,
    polyline: f.map((q) => ({ x: Math.round((q[0] - f[0][0]) * TILE), y: Math.round((q[1] - f[0][1]) * TILE) })),
  });

/** 楼基的外接框（格）和东西中点 */
function baseBox(name: string): { x0: number; x1: number; y0: number; y1: number; cx: number } {
  const cells = [...buildings.find((b) => b.name === name)!.cells.keys()];
  const xs = cells.map((i) => i % W), ys = cells.map((i) => Math.floor(i / W));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs) + 1, Math.min(...ys), Math.max(...ys) + 1];
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2 };
}

// 北门（据 R-gate-03 照片、R-gate-80 卫星图）：自西向东小柱、大柱、大柱、小柱，中心距北门点 -14.5、-8.5、+8、+14 m；
// 校名牌在西侧大柱北面。大柱与小柱之间是铁栅栏，车道中间一座岗亭
for (const [d, sprite, w, dd] of [[-14.5, 'pylon-small', 2.5, 2], [-8.5, 'pylon-west', 4, 3], [8, 'pylon-east', 4, 3], [14, 'pylon-small', 2.5, 2]] as const)
  placeProp(sprite, [gate[0] + d / M, gate[1]], w, dd);
for (const d of [-11.5, 11]) placeProp('fence-gate', [gate[0] + d / M, gate[1]], 2.75, 0.2);
placeProp('booth', [gate[0], gate[1]], 1.6, 1.6);

// 图书馆南入口台阶（据 R-library-11），平铺在地上，可以走
const library = baseBox('宁恩承图书馆');
point('prop', 'library-steps', [library.cx, library.y1 + 2 / M], { sprite: 'library-steps', flat: true });

// OSM 标注的纪念物与雕塑，位置照搬；只放在描过地面的范围里。占地据 docs/refs（校训石据揭幕报道，其余为照片估计）
const MONUMENTS: [string, string, number, number][] = [
  ['校训石', 'motto-stone', 7.2, 0.6],
  ['大书', 'big-book', 2, 1.5],
  ['宁恩承先生', 'bust-ning', 3, 2],
  ['张捷迁校友', 'bust-zhang', 3, 2],
  ['鼎', 'ding', 4, 3],
];
const monumentAt: Record<string, P> = {};
for (const [name, sprite, w, d] of MONUMENTS) {
  const p = nodeAt(byName(name));
  if (kind[at(Math.floor(p[0]), Math.floor(p[1]))] === 'outside') continue;
  monumentAt[name] = p;
  placeProp(sprite, p, w, d);
}

// 中轴两侧的行道树：成排的高柱状针叶树（据 R-gate-03、R-info-01 照片），种在路缘外 2.5 m 的林地里，每 5 m 一棵。
// 中轴两侧的路灯（据同两张照片）：沿进校路和十字广场两边，每 20 m 一盏；具体间距待核实
const reserved = new Uint8Array(W * H);
{
  const rows: [number, number, number][] = [
    [123.5, 34, 76], [137.5, 34, 76], // 进校路
    [116.5, 115, 150], [143.5, 115, 150], // 十字广场北段
    [115.5, 170, 204], [144.5, 170, 204], // 十字广场南段
  ];
  let k = 0;
  for (const [x, y0, y1] of rows)
    for (let y = y0; y <= y1; y += 5) {
      const p = cell([x, y]);
      if (kindAt(Math.floor(p[0]), Math.floor(p[1])) !== 'wood') continue;
      placeProp(`conifer-column-${(k++ % 3) + 1}`, p, 1, 1);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (inGrid(Math.floor(p[0]) + dc, Math.floor(p[1]) + dr)) reserved[at(Math.floor(p[0]) + dc, Math.floor(p[1]) + dr)] = 1;
    }
  const lamps: [number, number, number][] = [[125.3, 40, 76], [135.7, 40, 76], [119.6, 115, 205], [140.4, 115, 205]];
  for (const [x, y0, y1] of lamps) for (let y = y0; y <= y1; y += 20) placeProp('lamp', cell([x, y]), 0.6, 0.6);
}
const nearAxis = (c: number, r: number) => reserved[at(c, r)] === 1;

// 停车场里的车（据卫星图 S7：信息学馆院内和图书馆南面的停车场都停着车，车身南北向）。
// 车位深 6 m（3 格），约一半车位有车，按格子哈希挑，每次生成一样
{
  const CARS = ['car-0', 'car-1', 'car-2', 'car-3', 'car-4'];
  each((c, r, _p, i) => {
    if (kind[i] !== 'parking' || r % 3 || solid[i] || hash(c, r) % 100 >= 45) return;
    if (![1, 2].every((k) => kindAt(c, r + k) === 'parking')) return;
    placeProp(CARS[hash(r, c) % CARS.length], [c + 0.5, r + 1.5], 1.8, 4.5, hash(c + 7, r) % 2 ? 0 : 2);
  });
  // 垂直车位排（survey.json 的 stalls，据卫星图 S7）：每个车位一张地面标线，约八成有车，车头大多朝底线
  const NOSE = { N: 0, E: 1, S: 2, W: 3 } as const;
  for (const { at: [x, y], n, back } of survey.stalls)
    for (let k = 0; k < n; k++) {
      const along = 1.25 + k * 2.5;
      const centre: P = back === 'W' ? [x + 2.5, y + along] : back === 'E' ? [x - 2.5, y + along] : back === 'N' ? [x + along, y + 2.5] : [x + along, y - 2.5];
      const rot = (NOSE[back] + 1) % 4; // 标线美术的底线在西
      point('prop', 'stall', cell(centre), { sprite: 'stall', flat: true, ...(rot ? { rot } : {}) });
      const h = hash(Math.round(centre[0] * 10), Math.round(centre[1] * 10));
      if (h % 100 >= 80) continue;
      placeProp(CARS[h % CARS.length], cell(centre), 1.8, 4.5, h % 10 < 3 ? (NOSE[back] + 2) % 4 : NOSE[back]);
    }
  // 信息学馆院内东排背后林地边上的 4 个电动车充电桩（维护者实地描述），每 5 m 一个
  const Y0 = 261;
  for (let k = 0; k < 4; k++) placeProp('ev-charger', cell([145.6, Y0 + 1.25 + k * 5]), 0.6, 0.6);
  // 半圆车道南边东西向路上停着的通勤客车（据卫星图 S7）
  placeProp('campus-bus', cell([105, 319]), 2.5, 12, 1);
  placeProp('campus-bus', cell([165, 319]), 2.5, 12, 3);
}

// 描过的单棵树（survey.json 的 trees，加上 treeRows 展开的行道树）：按冠幅挑最接近的树种，阔叶和针叶按位置交替
{
  const sizes = TREES.map((name) => ({ name, R: Number(name.split('-')[1]) / 10 }));
  const rows = survey.treeRows.flatMap(({ from: [x0, y0], to: [x1, y1], gap, r }) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / gap));
    return Array.from({ length: n + 1 }, (_, k): [number, number, number] => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r]);
  });
  for (const [x, y, R] of [...survey.trees, ...rows]) {
    const p = cell([x, y]);
    if (!inGrid(Math.floor(p[0]), Math.floor(p[1])) || solid[at(Math.floor(p[0]), Math.floor(p[1]))]) continue;
    const kindOf = hash(Math.round(x), Math.round(y)) % 2 ? 'tree' : 'pine';
    const pick = sizes.filter((t) => t.name.startsWith(kindOf)).reduce((a, b) => (Math.abs(b.R - R) < Math.abs(a.R - R) ? b : a));
    point('prop', pick.name, p, { sprite: pick.name });
    block(p, 1, 1);
  }
}

// 林地里的树（DESIGN）：卫星图上树冠连片，看不清单棵树，只在描出的林地范围内每约 7 m 种一棵，留出林下空地。
// 针叶与阔叶约各半（卫星图上林地里深色针叶树和浅色阔叶树混杂），冠幅见 tiles.ts 的 TREES
{
  const STEP = 7 / M;
  for (let gy = STEP / 2; gy < H; gy += STEP)
    for (let gx = STEP / 2; gx < W; gx += STEP) {
      const h = hash(Math.round(gx * 10), Math.round(gy * 10));
      const p: P = [gx + ((h % 100) / 100 - 0.5) * (3 / M), gy + (((h >>> 8) % 100) / 100 - 0.5) * (3 / M)];
      const c = Math.floor(p[0]), r = Math.floor(p[1]);
      if (!inGrid(c, r) || kind[at(c, r)] !== 'wood' || solid[at(c, r)] || nearAxis(c, r)) continue;
      // 北门石柱前留空，别挡住校名
      if (Math.abs(p[0] - gate[0]) < 18 / M && p[1] < gate[1] + 8 / M) continue;
      // 树干离林地边缘至少一格，免得长在路上
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !inGrid(c + dc, r + dr) || kind[at(c + dc, r + dr)] !== 'wood')) continue;
      const sprite = TREES[(h >>> 16) % TREES.length];
      point('prop', sprite, p, { sprite });
      block(p, 1, 1);
    }
}

// 出生点：北门内的进校路上
point('spawn', '北门内', [gate[0], gate[1] + 14 / M], { radius: 2 * TILE });

// 兴趣点：靠近时弹出介绍卡片。只写核实过的事实，来源编号见 docs/sources.md
const POI: { name: string; at: P | undefined; text: string; src: string }[] = [
  { name: '北门', at: gate, text: '南湖校区北门。四根石柱的校门，西侧大石柱上竖写校名“東北大學”，落款张学良。进门正对信息学馆。', src: 'S3,S4,S9' },
  { name: '校训石', at: monumentAt['校训石'], text: '刻着东北大学校训：自强不息，知行合一。石长 7.2 米，由老五届校友捐赠，2022 年 9 月揭幕。', src: 'S1,S5,S11' },
  { name: '信息学馆', at: [baseBox('信息学馆').cx, baseBox('信息学馆').y0 - 2 / M], text: '原东北大学主楼，正门朝北、正对北门，中央是阶梯式塔楼。现为信息科学与工程学院的主要办公楼。', src: 'S1,S3,S9,S10' },
  { name: '大书', at: monumentAt['大书'], text: '信息学馆与图书馆之间的校园雕塑。', src: 'S1' },
  { name: '宁恩承图书馆', at: [library.cx, library.y1 + 2 / M], text: '学校在八十周年校庆之际以宁恩承先生命名，纪念他在东北大学危难时期主持校务。', src: 'S1,S6' },
  { name: '宁恩承先生像', at: monumentAt['宁恩承先生'], text: '宁恩承先生胸像，在图书馆南侧。', src: 'S1,S12,S14' },
  { name: '张捷迁校友像', at: monumentAt['张捷迁校友'], text: '张捷迁校友胸像，在图书馆南侧。', src: 'S1,S13,S14' },
  { name: '鼎', at: monumentAt['鼎'], text: '图书馆南面中轴上的铜鼎。', src: 'S1,S2,S17' },
];
for (const p of POI) if (p.at) point('poi', p.name, p.at, { text: p.text, src: p.src, radius: (16 / M) * TILE });

// 建筑对象：占地外接矩形 + 高度图，美术工具按这些画图
for (const b of buildings) {
  let minC = W, maxC = 0, minR = H, maxR = 0;
  for (const i of b.cells.keys()) {
    const c = i % W, r = (i / W) | 0;
    (minC = Math.min(minC, c)), (maxC = Math.max(maxC, c)), (minR = Math.min(minR, r)), (maxR = Math.max(maxR, r));
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
/** 斜边过渡：被填的角（东北、东南、西南、西北）对应的边缘掩码和对角方向 */
const DIAG: [number, number, number][] = [[1 | 2, 1, -1], [2 | 4, 1, 1], [4 | 8, -1, 1], [8 | 1, -1, -1]];
function diagFill(c: number, r: number, [, dx, dy]: [number, number, number]): 'asphalt' | 'paving' | undefined {
  const a = kindAt(c + dx, r), b = kindAt(c, r + dy), d = kindAt(c + dx, r + dy);
  for (const k of ['asphalt', 'paving'] as const) if (a === k && b === k && d === k) return k;
  return undefined;
}

const PAVED: Kind[] = ['paving', 'asphalt', 'parking', 'outside', 'floor', 'track', 'court'];
const ROAD: Kind[] = ['asphalt', 'parking'];
const WALKABLE: Kind[] = ['grass', 'wood', 'paving', 'asphalt', 'parking', 'track', 'pitch', 'court'];
const groundData: number[] = [], edgeData: number[] = [], blockedData: number[] = [];
each((c, r, _p, i) => {
  const k = kind[i] === 'wall' ? (wallUnder.get(i) ?? 'grass') : kind[i];
  const variants = GROUND[k];
  // 停车场：每格一道车位线（2 m，比真实的 2.5 m 略密）
  const v = k === 'parking' ? 1 : k === 'pitch' ? c % 2 : hash(c, r) % variants.length;
  groundData.push(TILESET.firstgid + variants[Math.min(v, variants.length - 1)]);
  // 边缘：草地、林地挨着铺装画一道路缘；铺装挨着车行道画路沿石
  let mask = 0;
  const nb: [number, number, number][] = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
  if (k === 'grass' || k === 'wood') {
    for (const [dx, dy, bit] of nb) if (PAVED.includes(kindAt(c + dx, r + dy) as Kind)) mask |= bit;
    // 斜路：两条相邻边和夹着的那个角都是同一种路面，就把这一角切成斜边，免得一格一格的台阶
    const corner = DIAG.findIndex(([m]) => m === mask);
    const fill = corner >= 0 ? diagFill(c, r, DIAG[corner]) : undefined;
    if (fill) edgeData.push(TILESET.firstgid + TILESET.diag[fill] + corner);
    else edgeData.push(mask ? TILESET.firstgid + TILESET.grassEdge + mask : 0);
  } else if (k === 'paving') {
    for (const [dx, dy, bit] of nb) if (ROAD.includes(kindAt(c + dx, r + dy) as Kind)) mask |= bit;
    edgeData.push(mask ? TILESET.firstgid + TILESET.curb + mask : 0);
  } else if (k === 'asphalt') {
    const lane = laneAt(c, r);
    edgeData.push(lane < 0 ? 0 : TILESET.firstgid + TILESET.lane[lane]);
  } else edgeData.push(0);
  blockedData.push(WALKABLE.includes(kind[i]) && !solid[i] ? 0 : TILESET.firstgid + TILESET.blocked);
});

/**
 * 车道中心虚线：沥青路宽 4–7 格（8–14 m）、上下（或左右）相邻几排宽度不变的直路段，在路中线上画。
 * 返回 TILESET.lane 的下标，不画返回 -1
 */
function laneAt(c: number, r: number): number {
  const isRoad = (cc: number, rr: number) => kindAt(cc, rr) === 'asphalt';
  /** 沿 (dx, dy) 方向量这一排路面的起点和宽度 */
  const span = (cc: number, rr: number, dx: number, dy: number): [number, number] => {
    let a = 0, b = 0;
    while (isRoad(cc - dx * (a + 1), rr - dy * (a + 1))) a++;
    while (isRoad(cc + dx * (b + 1), rr + dy * (b + 1))) b++;
    return [dx ? cc - a : rr - a, a + b + 1];
  };
  for (const [dx, dy, base] of [[1, 0, 0], [0, 1, 2]] as const) {
    const [s0, w] = span(c, r, dx, dy);
    if (w < 4 || w > 7) continue;
    // 前后各两排宽度一样，才算直路段
    const straight = [-2, -1, 1, 2].every((k) => {
      const cc = c + dy * k, rr = r + dx * k;
      if (!isRoad(cc, rr)) return false;
      const [s1, w1] = span(cc, rr, dx, dy);
      return s1 === s0 && w1 === w;
    });
    if (!straight) continue;
    const pos = dx ? c : r;
    if (w % 2 && pos === s0 + (w - 1) / 2) return base;
    if (!(w % 2) && pos === s0 + w / 2) return base + 1;
  }
  return -1;
}

const tile = (name: string, data: number[], visible = true): TiledLayer => ({ type: 'tilelayer', name, width: W, height: H, data, visible });
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
    metersPerTile: M,
    orientation: '上北（路网转正 3.85°）',
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
  layers: [
    { id: 1, ...tile(LAYER.ground, groundData), x: 0, y: 0, opacity: 1 },
    { id: 2, ...tile(LAYER.edges, edgeData), x: 0, y: 0, opacity: 1 },
    { id: 3, ...tile(LAYER.blocked, blockedData, false), x: 0, y: 0, opacity: 0.4 },
    { id: 4, type: 'objectgroup', name: LAYER.objects, objects, visible: true, x: 0, y: 0, opacity: 1, draworder: 'topdown' },
  ],
};
writeFileSync(new URL('../assets/map.json', import.meta.url), JSON.stringify(map));
const trees = objects.filter((o) => TREES.includes(String(o.name))).length;
console.log(`assets/map.json：${W}×${H} 格，${buildings.length} 栋楼，${trees} 棵树，${objects.length} 个物件`);
