// 生成地图 assets/map.json、地面分块图 assets/ground/、小地图 assets/minimap.png。用法：npm run map（之后跑 npm run art 重画建筑）
//
// 世界坐标见 geo.ts：上北，单位米。地图里的物件坐标是世界像素（1 m = 8 px，以 EXTENT 西北角为原点）。
// 地面（路、铺装、林地、草坪、停车场、运动场）全部来自 data/survey.json（从卫星图 S7 描的），按像素直接画，见 ground.ts；
// 没描过的地方画成不可进入的校外色块。碰撞按 1 m 一格（shared/world.ts 的 CELL）。
// 楼的占地、纪念物和北门的位置来自 OSM（S1），楼基校正见 buildings.ts。只有林地里的树是按冠幅铺满的（DESIGN），因为单棵树的位置看不清。
import { readFileSync, writeFileSync } from 'node:fs';
import { SPECIES, treeFrame, type Species } from '../shared/flora.ts';
import { CELL, LAYER, METERS_PER_TILE as M, TILE, type TiledLayer, type TiledObject, type TiledProperty } from '../shared/world.ts';
import { VEHICLES } from '../shared/vehicles.ts';
import { toView, viewSize, VIEWS, VIEW_NAME } from '../shared/view.ts';
import { MAT, WALKABLE } from './art-ground.ts';
import { heights, lifts, loadBuildings, type BuildingModel, type OsmEl } from './buildings.ts';
import { EXTENT, MAP_W as W, MAP_H as H, toWorld, type P } from './geo.ts';
import { Ground, PH, PW } from './ground.ts';
import { Pix } from './pix.ts';
import { PPM, inPoly } from './shape.ts';
import { loadSurvey } from './survey.ts';
import { TREES } from './tiles.ts';

const osm: { elements: OsmEl[] } = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));
const survey = loadSurvey();

/** 世界米 → 世界像素 */
const wpx = ([x, y]: P): P => [(x - EXTENT.x0) * PPM, (y - EXTENT.y0) * PPM];
const geom = (e: OsmEl): P[] => (e.geometry ?? []).map((g) => toWorld(g.lat, g.lon));
const nodeAt = (e: OsmEl): P => toWorld(e.lat!, e.lon!);
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
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const hash = (c: number, r: number) => ((c * 73856093) ^ (r * 19349663)) >>> 0;

// 1. 地面：按 survey.json 的顺序铺，后写的盖住先写的；再画标准运动场，补漏缝
const ground = new Ground();
ground.paintAreas(survey.areas);
const goals = ground.paintFields(survey.fields);
ground.fillGaps();
ground.paintDashes(survey.areas);
ground.paintMarks(survey.marks, survey.stalls);
const drawn = (p: P) => ground.at(p) !== 'outside';

// 碰撞格（1 m）：物件、栅栏挡住的格子
const CW = PW / CELL, CH = PH / CELL;
const solid = new Uint8Array(CW * CH);
const cellOf = ([x, y]: P): [number, number] => [Math.floor(((x - EXTENT.x0) * PPM) / CELL), Math.floor(((y - EXTENT.y0) * PPM) / CELL)];
const setSolid = (c: number, r: number) => c >= 0 && r >= 0 && c < CW && r < CH && (solid[r * CW + c] = 1);
const isSolid = (p: P) => {
  const [c, r] = cellOf(p);
  return c < 0 || r < 0 || c >= CW || r >= CH || solid[r * CW + c] === 1;
};

// 2. 校界（OSM 上的校园范围线）：沿线的铁栅栏（据 R-gate-03 照片），北门和 survey.json 记下的其他校门留空
const campus = geom(byId(53573481));
const gate = nodeAt(byName('北门'));
const openings = [{ at: gate, half: 15 }, ...survey.gates.map((g) => ({ at: g.at, half: g.width / 2 }))];
const inOpening = (q: P) => openings.some((o) => dist(q, o.at) < o.half);
/** 栅栏折线（世界米）：范围线上落在描过地面、又不在门口的连续几段，每 0.5 m 一点 */
const fences: P[][] = [];
{
  let run: P[] = [];
  const flush = () => (run.length > 1 && fences.push(run), (run = []));
  for (let k = 1; k < campus.length; k++) {
    const [a, b] = [campus[k - 1], campus[k]];
    const n = Math.max(1, Math.ceil(dist(a, b) * 2));
    for (let j = k === 1 ? 0 : 1; j <= n; j++) {
      const q = lerp(a, b, j / n);
      if (drawn(q) && !inOpening(q)) run.push(q);
      else flush();
    }
  }
  flush();
  // 栅栏挡路：折线经过的碰撞格，斜着走也连成一片
  for (const f of fences)
    for (let k = 1; k < f.length; k++) {
      const n = Math.ceil(dist(f[k - 1], f[k]) * 4) + 1;
      let prev: [number, number] | null = null;
      for (let j = 0; j <= n; j++) {
        const c = cellOf(lerp(f[k - 1], f[k], j / n));
        if (prev && prev[0] !== c[0] && prev[1] !== c[1]) setSolid(c[0], prev[1]);
        setSolid(c[0], c[1]);
        prev = c;
      }
    }
}

// ---------- 建筑 ----------
// 只画已经描过地面的楼：楼基每 1 m 取一点，至少一半落在描过的范围里
const buildings: BuildingModel[] = loadBuildings(osm, survey, gate[0]).filter((b) => {
  let inside = 0, total = 0;
  for (let y = 4; y < b.h; y += PPM)
    for (let x = 4; x < b.w; x += PPM) {
      if (!b.part[y * b.w + x]) continue;
      total++;
      const px = b.x + x, py = b.y + y;
      if (px >= 0 && py >= 0 && px < PW && py < PH && ground.mat[py * PW + px] !== MAT.outside) inside++;
    }
  return total > 0 && inside * 2 >= total;
});
for (const b of buildings) {
  const low = lifts(b);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const px = b.x + x, py = b.y + y;
      if (b.part[y * b.w + x] && low[y * b.w + x] < 2.4 * PPM && px >= 0 && py >= 0 && px < PW && py < PH) ground.mat[py * PW + px] = MAT.floor;
    }
}

// ---------- 物件 ----------
const objects: TiledObject[] = [];
let nextId = 1;
const props = (o: Record<string, string | number | boolean>): TiledProperty[] =>
  Object.entries(o).map(([name, value]) => ({ name, type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string', value }));
/** p 是世界米坐标 */
function point(type: string, name: string, p: P, extra: Record<string, string | number | boolean> = {}): void {
  const [x, y] = wpx(p);
  objects.push({ id: nextId++, name, type, x: Math.round(x), y: Math.round(y), width: 0, height: 0, point: true, properties: props(extra) });
}
/** 物件挡路：以 p（世界米，物件占地中心）为中心、东西 wm 米、南北 dm 米的矩形压到的碰撞格（四边各收 0.25 m） */
function block(p: P, wm: number, dm: number): void {
  const [c0, r0] = cellOf([p[0] - wm / 2 + 0.25, p[1] - dm / 2 + 0.25]);
  const [c1, r1] = cellOf([p[0] + wm / 2 - 0.25, p[1] + dm / 2 - 0.25]);
  for (let r = r0; r <= Math.max(r0, r1); r++) for (let c = c0; c <= Math.max(c0, c1); c++) setSolid(c, r);
}
/** 放一个物件：位置是占地中心；rot 是相对美术朝向（车头朝北）顺时针转了几个 90° */
function placeProp(sprite: string, p: P, wm: number, dm: number, rot = 0): void {
  point('prop', sprite, p, rot ? { sprite, rot } : { sprite });
  if (rot % 2) [wm, dm] = [dm, wm];
  block(p, wm, dm);
}

// 校界栅栏：折线，坐标按世界像素
for (const f of fences) {
  const [x0, y0] = wpx(f[0]);
  objects.push({
    id: nextId++, name: '', type: 'fence', x: Math.round(x0), y: Math.round(y0), width: 0, height: 0,
    polyline: f.map((q) => ({ x: Math.round(wpx(q)[0] - x0), y: Math.round(wpx(q)[1] - y0) })),
  });
}

/** 楼基的外接框（世界米）和东西中点 */
function baseBox(name: string): { x0: number; x1: number; y0: number; y1: number; cx: number } {
  const b = buildings.find((o) => o.name === name)!;
  const [x0, y0, x1, y1] = [EXTENT.x0 + b.x / PPM, EXTENT.y0 + b.y / PPM, EXTENT.x0 + (b.x + b.w) / PPM, EXTENT.y0 + (b.y + b.h) / PPM];
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2 };
}

// 北门（据 R-gate-03 照片、R-gate-80 卫星图）：自西向东小柱、大柱、大柱、小柱，中心距北门点 -14.5、-8.5、+8、+14 m；
// 校名牌在西侧大柱北面。大柱与小柱之间是铁栅栏，车道中间一座岗亭
for (const [d, sprite, w, dd] of [[-14.5, 'pylon-small', 2.5, 2], [-8.5, 'pylon-west', 4, 3], [8, 'pylon-east', 4, 3], [14, 'pylon-small', 2.5, 2]] as const)
  placeProp(sprite, [gate[0] + d, gate[1]], w, dd);
for (const d of [-11.5, 11]) placeProp('fence-gate', [gate[0] + d, gate[1]], 2.75, 0.2);
placeProp('booth', gate, 1.6, 1.6);

// 图书馆南入口台阶（据 R-library-11），平铺在地上，可以走
const library = baseBox('宁恩承图书馆');
point('prop', 'library-steps', [library.cx, library.y1 + 2], { sprite: 'library-steps', flat: true });

// OSM 标注的纪念物与雕塑，位置照搬；只放在描过地面的范围里。占地据 docs/refs（校训石据揭幕报道，其余为照片估计）
const MONUMENTS: [string, string, number, number][] = [
  ['校训石', 'motto-stone', 7.2, 0.6],
  ['大书', 'big-book', 2, 1.5],
  ['宁恩承先生', 'bust-ning', 3, 2],
  ['张捷迁校友', 'bust-zhang', 3, 2],
  ['鼎', 'ding', 4, 3],
  ['火箭', 'rocket', 4, 4],
  ['雕塑', 'park-sculpture', 2, 1.5],
  ['刘长春像', 'liu-statue', 2.5, 2.5],
  ['一二九塑像', 'movement-129', 9, 3],
  ['能量球', 'energy-sphere', 2, 1.5],
];
const monumentAt: Record<string, P> = {};
for (const [name, sprite, w, d] of MONUMENTS) {
  const p = nodeAt(byName(name));
  if (!drawn(p)) continue;
  monumentAt[name] = p;
  placeProp(sprite, p, w, d);
}

// 南门门楼（S24、S7）：柱子在 18 m 门洞两侧，横梁单独摆，不给门洞加碰撞。
const southGate = nodeAt(byName('南门'));
for (const dx of [-10.5, 10.5]) placeProp('gate-south-pillar', [southGate[0] + dx, southGate[1]], 3, 4);
point('prop', 'gate-south-beam', southGate, { sprite: 'gate-south-beam' });

// 运动场的球门（ground.ts 按标准尺寸算出位置）：宽 7.32 m、进深约 2 m
for (const g of goals) placeProp('goal', g.at, 7.32, 2, g.rot);

// survey.json 里单个摆放的物件
for (const p of survey.props) {
  if (p.flat) point('prop', p.sprite, p.at, { sprite: p.sprite, flat: true, ...(p.rot ? { rot: p.rot } : {}) });
  else placeProp(p.sprite, p.at, p.size[0], p.size[1], p.rot ?? 0);
}

// 中轴两侧的行道树：成排的高柱状针叶树（据 R-gate-03、R-info-01 照片），种在路缘外 2.5 m 的林地里，每 5 m 一棵。
// 中轴两侧的路灯（据同两张照片）：沿进校路和十字广场两边，每 20 m 一盏；具体间距待核实
const reserved: P[] = [];
{
  const rows: [number, number, number][] = [
    [123.5, 34, 76], [137.5, 34, 76], // 进校路
    [116.5, 115, 150], [143.5, 115, 150], // 十字广场北段
    [115.5, 170, 204], [144.5, 170, 204], // 十字广场南段
  ];
  let k = 0;
  for (const [x, y0, y1] of rows)
    for (let y = y0; y <= y1; y += 5) {
      if (ground.at([x, y]) !== 'wood') continue;
      placeProp(`conifer-column-${(k++ % 3) + 1}`, [x, y], 1, 1);
      reserved.push([x, y]);
    }
  const lamps: [number, number, number][] = [[125.3, 40, 76], [135.7, 40, 76], [119.6, 115, 205], [140.4, 115, 205]];
  for (const [x, y0, y1] of lamps) for (let y = y0; y <= y1; y += 20) placeProp('lamp', [x, y], 0.6, 0.6);
  // survey.json 的路灯排
  for (const { from: [x0, y0], to: [x1, y1], gap, sprite = 'lamp' } of survey.lampRows) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / gap));
    for (let i = 0; i <= n; i++) placeProp(sprite, [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n], 0.6, 0.6);
  }
}
const nearAxis = (p: P) => reserved.some((q) => Math.abs(q[0] - p[0]) < 5 && Math.abs(q[1] - p[1]) < 5);

/**
 * 停着的车从车型目录（shared/vehicles.ts）里按哈希挑：新能源车约占三成，偶尔是快递三轮车。
 * 物件名写成「v:车型:车色号」，客户端和预览图从 vehicles 图集取图，rot 是车头朝向（0 北，顺时针）
 */
const FUEL = VEHICLES.filter((v) => v.group === 'fuel'), NEV = VEHICLES.filter((v) => v.group === 'nev');
const NEV_SHARE = 30;
function parkedCar(h: number): string {
  const k = h % 100;
  const list = k < NEV_SHARE ? NEV : FUEL;
  const v = k >= 97 ? VEHICLES.find((x) => x.id === 'express-trike')! : list[(h >>> 7) % list.length];
  return `v:${v.id}:${(h >>> 12) % v.paints.length}`;
}

// 停车场里的车（据卫星图 S7：信息学馆院内和图书馆南面的停车场都停着车，车身南北向）。
// 车位深 6 m（3 个 2 m 格），约一半车位有车，按格子哈希挑，每次生成一样
{
  const tileM = (c: number, r: number): P => [EXTENT.x0 + (c + 0.5) * M, EXTENT.y0 + (r + 0.5) * M];
  for (let r = 0; r < H; r += 3)
    for (let c = 0; c < W; c++) {
      if (hash(c, r) % 100 >= 45 || ![0, 1, 2].every((k) => ground.at(tileM(c, r + k)) === 'parking') || isSolid(tileM(c, r))) continue;
      placeProp(parkedCar(hash(r, c)), tileM(c, r + 1), 1.8, 4.5, hash(c + 7, r) % 2 ? 0 : 2);
    }
  // 垂直车位排（survey.json 的 stalls，据卫星图 S7）：每个车位一张地面标线，约八成有车，车头大多朝底线
  const NOSE = { N: 0, E: 1, S: 2, W: 3 } as const;
  for (const { at: [x, y], n, back } of survey.stalls)
    for (let k = 0; k < n; k++) {
      const along = 1.25 + k * 2.5;
      const centre: P = back === 'W' ? [x + 2.5, y + along] : back === 'E' ? [x - 2.5, y + along] : back === 'N' ? [x + along, y + 2.5] : [x + along, y - 2.5];
      const rot = (NOSE[back] + 1) % 4; // 标线美术的底线在西
      point('prop', 'stall', centre, { sprite: 'stall', flat: true, ...(rot ? { rot } : {}) });
      const h = hash(Math.round(centre[0] * 10), Math.round(centre[1] * 10));
      if (h % 100 >= 80) continue;
      placeProp(parkedCar(h), centre, 1.8, 4.5, h % 10 < 3 ? (NOSE[back] + 2) % 4 : NOSE[back]);
    }
  // 信息学馆院内东排背后林地边上的 4 个电动车充电桩（维护者实地描述），每 5 m 一个
  const Y0 = 261;
  for (let k = 0; k < 4; k++) placeProp('ev-charger', [145.6, Y0 + 1.25 + k * 5], 0.6, 0.6);
  // 半圆车道南边东西向路上停着的通勤客车（据卫星图 S7）
  placeProp('campus-bus', [105, 319], 2.5, 12, 1);
  placeProp('campus-bus', [165, 319], 2.5, 12, 3);
}

// 楼基也算挡路，下面种树时用
for (const b of buildings) {
  const low = lifts(b);
  for (let y = 0; y < b.h; y += CELL / 2)
    for (let x = 0; x < b.w; x += CELL / 2) if (b.part[y * b.w + x] && low[y * b.w + x] < 2.4 * PPM) setSolid(Math.floor((b.x + x) / CELL), Math.floor((b.y + y) / CELL));
}

// 描过的单棵树与行道树：树位和冠幅沿用 S7，未核实树种的整排按位置选一种阔叶树（待核实）
{
  const broad = SPECIES.filter((t) => t.kind === 'broad');
  const trees: { at: P; r: number; species: Species; variant: number }[] = survey.trees.map(([x, y, r]) => {
    const h = hash(Math.round(x), Math.round(y));
    return { at: [x, y], r, species: broad[h % broad.length], variant: h >>> 8 };
  });
  for (const { from: [x0, y0], to: [x1, y1], gap, r, species } of survey.treeRows) {
    // 同一直线的分段共用树种，接头不混种
    const h = hash(x0 === x1 ? Math.round(x0) : 0, y0 === y1 ? Math.round(y0) : 0);
    const t = species ? SPECIES.find((t) => t.id === species)! : broad[(h >>> 8) % broad.length];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / gap));
    for (let k = 0; k <= n; k++) trees.push({ at: [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n], r, species: t, variant: k });
  }
  for (const { at, r, species, variant } of trees) {
    if (isSolid(at)) continue;
    const size = species.sizes.reduce((a, b) => Math.abs(b / 10 - r) < Math.abs(a / 10 - r) ? b : a);
    placeProp(treeFrame(species.id, size, variant % species.variants, 'summer'), at, 1, 1);
  }
}

// 林地范围沿用 S7；林内位置、密度与混种是 TASK-19 的程序化推定，见 sources.md 待核实
{
  const trees = SPECIES.filter((t) => t.kind !== 'shrub'), shrubs = SPECIES.filter((t) => t.kind === 'shrub');
  const noise = (x: number, y: number) => {
    const gx = Math.floor(x / 64), gy = Math.floor(y / 64), u = x / 64 - gx, v = y / 64 - gy;
    const sx = u * u * (3 - 2 * u), sy = v * v * (3 - 2 * v);
    const at = (c: number, r: number) => hash(c * 37 + 137, r * 53 - 211) / 4294967296;
    return (at(gx, gy) * (1 - sx) + at(gx + 1, gy) * sx) * (1 - sy) + (at(gx, gy + 1) * (1 - sx) + at(gx + 1, gy + 1) * sx) * sy;
  };
  const edge = (p: P, d: number) => [[d, 0], [-d, 0], [0, d], [0, -d], [d * 0.707, d * 0.707], [-d * 0.707, d * 0.707], [d * 0.707, -d * 0.707], [-d * 0.707, -d * 0.707]].some(([dx, dy]) => ground.at([p[0] + dx, p[1] + dy]) !== 'wood');
  const STEP = 5.5;
  for (let gy = EXTENT.y0 + STEP / 2, iy = 0; gy < EXTENT.y1; gy += STEP, iy++)
    for (let gx = EXTENT.x0 + STEP / 2, ix = 0; gx < EXTENT.x1; gx += STEP, ix++) {
      const h = hash(ix * 11 + 41, iy * 13 + 97), density = noise(gx, gy);
      if (density < 0.32 || (density < 0.60 && (ix % 2 || iy % 2))) continue;
      const p: P = [gx + ((h % 100) / 100 - 0.5) * 0.4, gy + (((h >>> 8) % 100) / 100 - 0.5) * 0.4];
      if (ground.at(p) !== 'wood' || isSolid(p) || nearAxis(p) || edge(p, 4)) continue;
      // 北门石柱前留空，别挡住校名
      if (Math.abs(p[0] - gate[0]) < 18 && p[1] < gate[1] + 8) continue;
      const main = Math.min(trees.length - 1, Math.floor(noise(gx + 1024, gy - 768) * trees.length));
      const t = trees[h % 100 < 75 ? main : h % 100 < 95 ? (main + 1) % trees.length : (h >>> 12) % trees.length];
      const size = t.sizes[(h >>> 16) % t.sizes.length];
      placeProp(treeFrame(t.id, size, (h >>> 22) % t.variants, 'summer'), p, 1, 1);
    }
  // 灌木只放在已描林地内、距林缘约 2–4 m 的带上，楼前林地同样处理
  for (let y = EXTENT.y0 + 2; y < EXTENT.y1; y += 4)
    for (let x = EXTENT.x0 + 2; x < EXTENT.x1; x += 4) {
      const p: P = [x, y], h = hash(Math.round(x * 10), Math.round(y * 10));
      if (ground.at(p) !== 'wood' || isSolid(p) || nearAxis(p) || edge(p, 2) || !edge(p, 4) || h % 100 < 35) continue;
      if (Math.abs(p[0] - gate[0]) < 18 && p[1] < gate[1] + 8) continue;
      const t = shrubs[(h >>> 8) % shrubs.length];
      placeProp(treeFrame(t.id, t.sizes[(h >>> 16) % t.sizes.length], (h >>> 22) % t.variants, 'summer'), p, 0.6, 0.6);
    }
}

// 出生点：北门内的进校路上
point('spawn', '北门内', [gate[0], gate[1] + 14], { radius: 2 * TILE });

// 兴趣点：靠近时弹出介绍卡片。只写核实过的事实，来源编号见 docs/sources.md
const info = baseBox('信息学馆');
const POI: { name: string; at: P | undefined; text: string; src: string }[] = [
  { name: '北门', at: gate, text: '南湖校区北门。四根石柱的校门，西侧大石柱上竖写校名“東北大學”，落款张学良。进门正对信息学馆。', src: 'S3,S4,S9' },
  { name: '校训石', at: monumentAt['校训石'], text: '刻着东北大学校训：自强不息，知行合一。石长 7.2 米，由老五届校友捐赠，2022 年 9 月揭幕。', src: 'S1,S5,S11' },
  { name: '信息学馆', at: [info.cx, info.y0 - 2], text: '原东北大学主楼，正门朝北、正对北门，中央是阶梯式塔楼。现为信息科学与工程学院的主要办公楼。', src: 'S1,S3,S9,S10' },
  { name: '大书', at: monumentAt['大书'], text: '信息学馆与图书馆之间的校园雕塑。', src: 'S1' },
  { name: '宁恩承图书馆', at: [library.cx, library.y1 + 2], text: '学校在八十周年校庆之际以宁恩承先生命名，纪念他在东北大学危难时期主持校务。', src: 'S1,S6' },
  { name: '宁恩承先生像', at: monumentAt['宁恩承先生'], text: '宁恩承先生胸像，在图书馆南侧。', src: 'S1,S12,S14' },
  { name: '张捷迁校友像', at: monumentAt['张捷迁校友'], text: '张捷迁校友胸像，在图书馆南侧。', src: 'S1,S13,S14' },
  { name: '鼎', at: monumentAt['鼎'], text: '图书馆南面中轴上的铜鼎。', src: 'S1,S2,S17' },
  { name: '火箭', at: monumentAt['火箭'], text: '长征五号运载火箭模型。', src: 'S1,S21' },
  { name: '刘长春像', at: monumentAt['刘长春像'], text: '基座刻有“中国奥运第一人”。', src: 'S1,S25' },
  { name: '一二九塑像', at: monumentAt['一二九塑像'], text: '纪念一二九运动的群雕。', src: 'S1,S23' },
];
for (const p of [...POI, ...survey.places]) if (p.at) point('poi', p.name, p.at, { text: p.text, src: p.src, radius: 16 * PPM });

// 楼门和单车停放排：生态和寻路用，不画图。停放排的 dx、dy 是终点相对起点的像素偏移
for (const d of survey.doors) point('door', '', d.at, { facing: d.facing, main: d.main ?? false });
for (const r of survey.bikeRacks) {
  const [x0, y0] = wpx(r.from), [x1, y1] = wpx(r.to);
  point('rack', '', r.from, { dx: Math.round(x1 - x0), dy: Math.round(y1 - y0), covered: r.covered ?? false });
}

/**
 * 建筑对象：楼基外接框（世界像素）。front 是每个视角下，精灵图按 16 像素一列切开后，
 * 每列楼基最靠前（屏幕最下）那一行的行号（-1 是空列），客户端按它排遮挡
 */
for (const b of buildings) {
  const hgt = heights(b);
  const top = Math.ceil(hgt.reduce((a, v) => Math.max(a, v), 0)) + b.extraTop;
  const fronts = VIEWS.map((v) => {
    const s = viewSize(v, b.w, b.h);
    const f = new Array<number>(Math.ceil(s.w / TILE)).fill(-1);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        if (!b.part[y * b.w + x]) continue;
        const q = toView(v, b.w, b.h, x + 0.5, y + 0.5);
        const col = Math.floor(q.x) >> 4;
        f[col] = Math.max(f[col], Math.floor(q.y));
      }
    return `${VIEW_NAME[v]}:${f.join(',')}`;
  });
  objects.push({
    id: nextId++,
    name: b.name,
    type: 'building',
    x: b.x,
    y: b.y,
    width: b.w,
    height: b.h,
    properties: props({ sprite: `b${b.id}`, style: b.style, osm: b.id, top, front: fronts.join('|') }),
  });
}

// 高度图 assets/heights.png：每米一像素，红色通道是这一米见方里最高的屋面（米，向上取整）。
// 客户端按太阳方位和高度实时投出楼的影子（src/shadows.ts）；树的影子按树冠另算，不进高度图
{
  const HW = EXTENT.x1 - EXTENT.x0, HH = EXTENT.y1 - EXTENT.y0;
  const hp = new Pix(HW, HH);
  for (const b of buildings) {
    const hgt = heights(b);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        if (!b.part[y * b.w + x]) continue;
        const mx = Math.floor((b.x + x) / PPM), my = Math.floor((b.y + y) / PPM);
        if (mx < 0 || my < 0 || mx >= HW || my >= HH) continue;
        const i = (my * HW + mx) * 4;
        hp.data[i] = Math.max(hp.data[i], Math.min(255, Math.ceil(hgt[y * b.w + x] / PPM)));
      }
  }
  for (let i = 3; i < hp.data.length; i += 4) hp.data[i] = 255;
  hp.save(new URL('../assets/heights.png', import.meta.url));
}

// ---------- 单车 ----------
// 单车停放排（survey.json 的 bikeRacks）：每 0.8 m 一辆，车身垂直于停放排。描好以前，先在主楼门旁边放一小排（DESIGN），不挡路
{
  const BIKES = VEHICLES.filter((v) => v.group === 'bike' || v.group === 'share' || v.group === 'moto');
  const bike = (p: P, rot: number) => {
    if (!drawn(p) || isSolid(p)) return;
    const h = hash(Math.round(p[0] * 10), Math.round(p[1] * 10));
    const v = BIKES[h % BIKES.length];
    point('prop', '', p, { sprite: `v:${v.id}:${(h >>> 9) % v.paints.length}`, rot });
  };
  const DIRS: P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const r of survey.bikeRacks) {
    const n = Math.max(1, Math.round(dist(r.from, r.to) / 0.8));
    // 车身和停放排垂直：停放排东西向时车头朝北，南北向时车头朝东
    const rot = Math.abs(r.to[0] - r.from[0]) > Math.abs(r.to[1] - r.from[1]) ? 0 : 1;
    for (let k = 0; k <= n; k++) bike(lerp(r.from, r.to, k / n), rot);
  }
  if (!survey.bikeRacks.length)
    for (const d of survey.doors) {
      if (!d.main) continue;
      const f = 'NESW'.indexOf(d.facing), out = DIRS[f], side = DIRS[(f + 1) % 4];
      const n = 3 + (hash(Math.round(d.at[0]), Math.round(d.at[1])) % 4);
      for (let k = 0; k < n; k++) bike([d.at[0] + out[0] * 2 + side[0] * (3 + k * 0.8), d.at[1] + out[1] * 2 + side[1] * (3 + k * 0.8)], (f + 2) % 4);
    }
}

// ---------- 车道 ----------
// 行驶的车沿 OSM（S1）里校内的机动车道走：沿中心线每米取样，落在柏油路上、没被挡住的连续一段超过 30 m 才要，每 4 m 留一个点
{
  const ROADS = new Set(['residential', 'unclassified', 'tertiary', 'tertiary_link', 'service']);
  for (const e of osm.elements) {
    if (e.type !== 'way' || !ROADS.has(e.tags.highway ?? '')) continue;
    const g = geom(e);
    let run: P[] = [];
    const flush = () => {
      if (run.length > 30) {
        const pts = run.filter((_, i) => i % 4 === 0 || i === run.length - 1);
        const [x0, y0] = wpx(pts[0]);
        objects.push({
          id: nextId++, name: '', type: 'lane', x: Math.round(x0), y: Math.round(y0), width: 0, height: 0,
          polyline: pts.map((q) => ({ x: Math.round(wpx(q)[0] - x0), y: Math.round(wpx(q)[1] - y0) })),
        });
      }
      run = [];
    };
    for (let i = 1; i < g.length; i++) {
      const n = Math.max(1, Math.round(dist(g[i - 1], g[i])));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const q = lerp(g[i - 1], g[i], k / n);
        if (inPoly(q, campus) && ground.at(q) === 'asphalt' && !isSolid(q)) run.push(q);
        else flush();
      }
    }
    flush();
  }
}

// ---------- 碰撞 ----------
// 碰撞格中心的材质不能走，或者被物件、栅栏、楼占了，就挡路
const runs: number[] = [];
{
  let cur = 0, n = 0;
  for (let r = 0; r < CH; r++)
    for (let c = 0; c < CW; c++) {
      const m = ground.mat[(r * CELL + CELL / 2) * PW + c * CELL + CELL / 2];
      const b = solid[r * CW + c] || !WALKABLE.has(m) ? 1 : 0;
      if (b === cur) n++;
      else runs.push(n), (cur = b), (n = 1);
    }
  runs.push(n);
}

ground.paintDetails(survey.areas);
const chunks = ground.bake(new URL('../assets/ground/', import.meta.url));
ground.minimap().save(new URL('../assets/minimap.png', import.meta.url));

const blocked: TiledLayer = { type: 'runs', name: LAYER.blocked, width: CW, height: CH, runs };
const map = {
  type: 'map',
  version: '1.10',
  orientation: 'orthogonal',
  width: W,
  height: H,
  tilewidth: TILE,
  tileheight: TILE,
  nextobjectid: nextId,
  properties: props({
    area: '南湖校区',
    metersPerTile: M,
    orientation: '上北（路网转正 3.85°）',
    attribution: '地图数据 © OpenStreetMap contributors（ODbL）',
  }),
  layers: [blocked, { type: 'objectgroup', name: LAYER.objects, objects, visible: true }],
};
writeFileSync(new URL('../assets/map.json', import.meta.url), JSON.stringify(map));
const trees = objects.filter((o) => TREES.includes(String(o.name))).length;
console.log(`assets/map.json：${W}×${H} 格，${buildings.length} 栋楼，${trees} 棵树，${objects.length} 个物件；地面 ${chunks} 块`);
