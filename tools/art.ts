// 生成全部程序化美术：建筑、物件、角色、表情、调色板（地面在 npm run map 时烘焙）。用法：npm run art（先 npm run map）
// 产物写进 assets/，同时在 data/preview.png 拼一张全图预览（不进仓库），用来检查风格是否统一。
// 某张图改成手绘后，把它从 HANDMADE 之外的生成列表里拿掉，避免被覆盖（规则见 assets/AGENTS.md）。
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { EMOTES } from '../shared/social.ts';
import { FACING, VIEWS, VIEW_NAME, type View } from '../shared/view.ts';
import { GROUND_CHUNK, LAYER, METERS_PER_TILE, TILE, prop, type TiledMap } from '../shared/world.ts';
import { drawAvatarSheet } from './art-avatar.ts';
import { drawBikes } from './art-bikes.ts';
import { drawFauna } from './art-fauna.ts';
import { drawUi } from './art-ui.ts';
import { drawVehicles } from './art-vehicles.ts';
import { drawBuilding } from './art-building.ts';
import { loadBuildings } from './buildings.ts';
import { toWorld } from './geo.ts';
import { PAL, type PalKey } from './palette.ts';
import { Pix, loadPix, packAtlas, rng, type Sprite } from './pix.ts';
import { loadSurvey } from './survey.ts';
import { TREES } from './tiles.ts';

const out = (p: string) => new URL(`../assets/${p}`, import.meta.url);
/** 每米像素（物件和树按真实尺寸画） */
const PPM = TILE / METERS_PER_TILE;

/** 已经换成手绘的文件名（相对 assets/），生成时跳过 */
const HANDMADE = new Set<string>([]);
function save(pix: Pix, name: string): void {
  if (HANDMADE.has(name)) return;
  pix.save(out(name));
}

// ---------- 物件 ----------
// 每个物件一张小图，脚底（锚点）在 (ax, ay)。合成一张图集 props.png + props.json
type PropArt = Sprite;
const shadowAt = (p: Pix, cx: number, cy: number, rx: number, ry: number) => p.ellipse(cx, cy, rx, ry, 'shadow', 60);

/** 只往透明处画的地面阴影（不盖住树本身） */
function shadowUnder(p: Pix, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = -ry; y <= ry; y++)
    for (let x = -Math.round(rx); x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1 && !p.opaque(Math.round(cx + x), Math.round(cy + y))) p.px(cx + x, cy + y, 'shadow', 60);
}

/** 阔叶树：树冠半径 R 米。树冠由许多小团叶簇成，左上亮、右下暗 */
function broadleaf(R: number, seed: number): PropArt {
  const r = Math.round(R * PPM), ry = Math.round(r * 0.85), trunk = 11;
  const sy = Math.round(r * 0.3);
  const w = 2 * r + 12 + Math.round(r * 0.3), h = 2 * ry + trunk + 6 + sy;
  const p = new Pix(w, h);
  const rand = rng(seed);
  const cx = r + 6, cy = ry + 3, ay = h - sy - 2;
  p.rect(cx - 1, cy + ry * 0.4, 3, ay - cy - ry * 0.4, 'trunk');
  p.vline(cx - 1, cy + ry * 0.4, ay - cy - ry * 0.4, 'brick0');
  const blob = Math.max(3, Math.round(r * 0.3));
  for (let k = 0; k < r * 1.6; k++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (1 - blob / r);
    const x = cx + Math.cos(a) * d * r, y = cy + Math.sin(a) * d * ry;
    const light = (x - cx) / r + (y - cy) / ry;
    p.ellipse(Math.round(x), Math.round(y), blob, Math.round(blob * 0.85), light < -0.5 ? 'leaf2' : light < 0.4 ? 'leaf1' : 'leaf0');
  }
  // 亮面上再点几簇高光
  for (let k = 0; k < r / 4; k++) {
    const a = Math.PI * (1.1 + rand() * 0.6), d = 0.3 + rand() * 0.45;
    p.ellipse(Math.round(cx + Math.cos(a) * d * r), Math.round(cy + Math.sin(a) * d * ry), Math.round(blob / 2), Math.round(blob / 2.5), 'grass3');
  }
  p.outline('ink');
  // 地面阴影最后画：不描边，落在树干右下
  shadowUnder(p, cx + r * 0.3, ay, r * 0.9, sy);
  return { pix: p, ax: Math.round(cx), ay };
}

/** 针叶树：底部半径 R 米，高约 3.2R，层层收分 */
function conifer(R: number, seed: number): PropArt {
  const r = Math.round(R * PPM), hc = Math.round(R * 3.2 * PPM), trunk = 5;
  const sy = Math.round(r * 0.3);
  const w = 2 * r + 12 + Math.round(r * 0.4), h = hc + trunk + 6 + sy;
  const p = new Pix(w, h);
  const rand = rng(seed);
  const cx = r + 6, ay = h - sy - 2, base = ay - trunk;
  p.rect(cx - 1, base - 2, 3, trunk + 2, 'trunk');
  const tiers = Math.max(4, Math.round(R * 2));
  for (let t = 0; t < tiers; t++) {
    // 每层是一个下沿略垂的三角，越往上越窄
    const yb = base - (t * hc * 0.8) / tiers, ht = (hc * 0.38) * (1 - t / tiers / 2);
    const half = r * (1 - t / tiers) + 2;
    for (let y = 0; y < ht; y++) {
      const hw = Math.round(half * ((y + 1) / ht) * (0.9 + 0.1 * rand()));
      const yy = Math.round(yb - ht + y);
      for (let x = -hw; x <= hw; x++) p.px(cx + x, yy, x < -hw / 3 ? 'pine2' : x > hw / 3 ? 'pine0' : 'pine1');
    }
  }
  p.outline('ink');
  shadowUnder(p, cx + r * 0.4, ay, r, sy);
  return { pix: p, ax: cx, ay };
}

/** 校名「東北大學」的 12 px 点阵（文泉驿点阵正黑栅格化），竖排刻在北门西侧大石柱上 */
const NAME_GLYPHS = [
  ['............', '............', '.....#......', '.....#......', '.#########..', '..#######...', '..#..#..#...', '..#######...', '..#######...', '....###.....', '...#.#.#....', '..#..#..##..'],
  ['............', '....#..#....', '....#..#....', '....#..#..#.', '#####..#.#..', '....#..##...', '....#..#....', '....#..#....', '....#..#....', '...##..#...#', '###.#..#...#', '....#..#####'],
  ['............', '....#.......', '....#.......', '....#.......', '##########..', '....#.......', '....##......', '...#.#......', '...#..#.....', '..#...##....', '.#.....##...', '#.......##..'],
  ['............', '............', '.##.##.###..', '.####.####..', '.#..###..#..', '.##.###.##..', '###########.', '#.........#.', '...#####....', '.##########.', '.....#......', '.....#......'],
];

/** 盒子在视角 v 下的屏幕宽、顶面进深（世界宽 W 沿东西、深 D 沿南北） */
const boxView = (v: View, W: number, D: number) => (v % 2 ? { sw: D, sd: W } : { sw: W, sd: D });
/** 某个地理朝向的面在视角 v 下朝屏幕哪边：0 上、1 右、2 下、3 左 */
const screenSide = (v: View, face: 'N' | 'E' | 'S' | 'W') => ('NESW'.indexOf(face) - v + 4) % 4;

/**
 * 北门石柱（据 R-gate-03 照片、R-gate-80 卫星图）：
 * 大柱约 4 m 宽、3 m 深、8 m 高，小柱约 2.5×2×5 m；柱头是两道出挑的檐，中间一圈浮雕带，顶上四角各起一块。
 * 西侧大柱北面嵌白底竖排校名，旁边一列落款；两根大柱朝车道的一面各挂一盏壁灯。
 */
function pylon(big: boolean, v: View, plaque: boolean, lamp: 'E' | 'W' | null): PropArt {
  const { sw, sd } = boxView(v, (big ? 4 : 2.5) * PPM, (big ? 3 : 2) * PPM);
  const h = (big ? 8 : 5) * PPM;
  const pad = 4;
  const p = new Pix(sw + pad * 2 + 8, sd + h + 10);
  const x0 = pad, ground = 6 + sd + h; // 正面底边
  const capH = big ? 12 : 10, shaftTop = ground - h + capH;
  // 柱身与基座
  p.rect(x0, shaftTop, sw, ground - shaftTop, 'stone2');
  p.rect(x0, shaftTop, 2, ground - shaftTop, 'stone3');
  p.rect(x0 + sw - 3, shaftTop, 3, ground - shaftTop, 'stone1');
  p.rect(x0 - 1, ground - 5, sw + 2, 5, 'stone1');
  p.hline(x0 - 1, ground - 5, sw + 2, 'stone3');
  // 柱头：下檐、浮雕带、上檐，各比柱身宽出一两像素
  const capTop = ground - h;
  p.rect(x0 - 1, shaftTop - 3, sw + 2, 3, 'stone3');
  p.hline(x0 - 1, shaftTop - 1, sw + 2, 'stone0');
  p.rect(x0, capTop + 5, sw, capH - 8, 'stone2');
  for (let x = x0 + 1; x < x0 + sw - 1; x++) if ((x - x0) % 4 < 2) p.px(x, capTop + 6 + ((x - x0) % 8 < 4 ? 0 : 1), 'stone0'), p.px(x, capTop + capH - 5, 'stone1');
  p.rect(x0 - 2, capTop + 2, sw + 4, 3, 'stone3');
  p.hline(x0 - 2, capTop + 4, sw + 4, 'stone1');
  // 顶面（进深 sd）和四角的起块
  p.rect(x0 - 2, capTop + 2 - sd, sw + 4, sd, 'stone2');
  p.hline(x0 - 2, capTop + 2 - sd, sw + 4, 'stone3');
  for (const cx of [x0 - 2, x0 + sw - 2])
    for (const cy of [capTop + 2 - sd, capTop + 2 - 4]) {
      p.rect(cx, cy - 3, 4, 4, 'stone3');
      p.rect(cx, cy + 1, 4, 2, 'stone1');
    }
  if (plaque && screenSide(v, 'N') === 2) {
    // 校名牌：白底黑字竖排，左边一列小字落款（字形不可辨，画成点）
    // 每个字形第一行是空的，去掉后 11 行一字，正好放进大柱柱身
    const gw = 14, gh = 4 * 11 + 1, gx = x0 + Math.round((sw - gw) / 2) + 2, gy = shaftTop + 1;
    p.rect(gx, gy, gw, gh, 'white');
    p.vline(gx, gy, gh, 'stone1'), p.hline(gx, gy, gw, 'stone1');
    NAME_GLYPHS.forEach((g, k) => g.slice(1).forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && p.px(gx + 1 + x, gy + 1 + k * 11 + y, 'ink'))));
    for (let y = gy + 18; y < gy + 40; y += 3) p.px(gx - 3, y, 'ink');
  }
  if (lamp) {
    // 壁灯：挂在柱身中上部；那一面朝屏幕下方时画在正中，朝左右时伸出柱外
    const side = screenSide(v, lamp), ly = shaftTop + Math.round((ground - shaftTop) * 0.25);
    const at = side === 2 ? x0 + Math.round(sw / 2) - 2 : side === 1 ? x0 + sw : side === 3 ? x0 - 5 : -1;
    if (at >= 0) {
      p.rect(at, ly, 5, 2, 'bronze0');
      p.rect(at + 1, ly + 2, 3, 5, 'flowerY');
      p.hline(at, ly + 7, 5, 'bronze0');
    }
  }
  p.outline('ink');
  // 投影：落在右侧地面
  for (let y = ground - sd; y < ground; y++) for (let x = x0 + sw + 2; x < x0 + sw + 10; x++) if (!p.opaque(x, y)) p.px(x, y, 'shadow', 60);
  // 锚点在占地中心
  return { pix: p, ax: x0 + sw / 2, ay: ground - sd / 2 };
}

/** 黑色铁栅栏：东西向一段，长 L 米、高 1.6 m（据 R-gate-03） */
function fence(L: number, v: View): PropArt {
  const len = Math.round(L * PPM), h = Math.round(1.6 * PPM);
  if (v % 2 === 0) {
    const p = new Pix(len + 2, h + 4);
    for (let x = 1; x <= len; x += 2) p.vline(x, 2, h, 'slate');
    p.hline(1, 1, len, 'ink'), p.hline(1, 3, len, 'ink'), p.hline(1, h - 1, len, 'ink');
    for (let x = 1; x <= len; x++) if (!p.opaque(x, h + 2)) p.px(x, h + 2, 'shadow', 50);
    return { pix: p, ax: len / 2 + 1, ay: h + 1 };
  }
  // 侧看：只剩一条竖着的栏杆，沿屏幕上下延伸
  const p = new Pix(5, len + h + 2);
  for (let y = 0; y < len; y++) p.vline(1, y + 1, h, 'slate'), p.px(1, y + 1, 'ink');
  p.vline(1, len + 1, h, 'ink');
  for (let y = h; y < len + h; y++) p.px(3, y, 'shadow', 50);
  return { pix: p, ax: 2, ay: h + len / 2 };
}

/** 北门车道中间的蓝色岗亭（据 R-gate-03）：约 1.6 m 见方、2.6 m 高，四面开窗；照片上的字不可辨，不画 */
function booth(v: View): PropArt {
  const s = Math.round(1.6 * PPM), h = Math.round(2.6 * PPM);
  const p = new Pix(s + 10, s + h + 6);
  const x0 = 2, ground = 3 + s + h;
  p.rect(x0, ground - h, s, h, 'water0');
  p.rect(x0 + 2, ground - h + 4, s - 4, 8, 'glass2');
  p.vline(x0 + Math.round(s / 2), ground - h + 4, 8, 'water0');
  p.rect(x0, ground - 3, s, 3, 'flowerY');
  for (let x = x0; x < x0 + s; x += 4) p.rect(x, ground - 3, 2, 3, 'ink');
  p.rect(x0 - 1, ground - h - s, s + 2, s, 'water1');
  p.hline(x0 - 1, ground - h - s, s + 2, 'water2');
  p.rect(x0 + 3, ground - h - s - 3, s - 6, 3, 'flowerR');
  p.outline('ink');
  for (let y = ground - s; y < ground; y++) for (let x = x0 + s + 1; x < x0 + s + 6; x++) if (!p.opaque(x, y)) p.px(x, y, 'shadow', 60);
  void v;
  return { pix: p, ax: x0 + s / 2, ay: ground - s / 2 };
}

function sculpture(): PropArt {
  // 外观未核实的雕塑（大书、能量球）：先用统一的底座占位，核实后替换（见 docs/sources.md 待核实）
  const p = new Pix(20, 26);
  shadowAt(p, 11, 23, 9, 2);
  p.rect(3, 14, 14, 10, 'stone1');
  p.rect(3, 14, 14, 2, 'stone3');
  p.rect(5, 18, 10, 3, 'stone0');
  p.rect(6, 4, 8, 10, 'grey1');
  p.rect(6, 4, 3, 10, 'grey2');
  p.rect(9, 1, 2, 3, 'grey1');
  p.outline('ink');
  return { pix: p, ax: 10, ay: 24 };
}

/** 把图逆时针转 k 个 90°：平铺在地上的物件，视角转了就跟着转 */
function rotCCW(a: PropArt, k: number): PropArt {
  let { pix, ax, ay } = a;
  for (let i = 0; i < k % 4; i++) {
    const q = new Pix(pix.h, pix.w);
    for (let y = 0; y < pix.h; y++)
      for (let x = 0; x < pix.w; x++) {
        const o = (y * pix.w + x) * 4;
        if (pix.data[o + 3]) q.px(y, pix.w - 1 - x, (pix.data[o] << 16) | (pix.data[o + 1] << 8) | pix.data[o + 2], pix.data[o + 3]);
      }
    [pix, ax, ay] = [q, ay, pix.w - ax];
  }
  return { pix, ax, ay };
}

/** 宁恩承图书馆南入口的大台阶（据 R-library-11 照片约 12 级）：宽 23 m、进深 4 m，世界朝向下踏步朝南 */
function librarySteps(): PropArt {
  const w = 23 * PPM, d = 4 * PPM;
  const p = new Pix(w, d);
  for (let y = 0; y < d; y++) p.hline(0, y, w, y % 3 === 2 ? 'stone1' : y % 3 === 0 ? 'stone3' : 'stone2');
  p.vline(0, 0, d, 'stone0'), p.vline(w - 1, 0, d, 'stone0');
  return { pix: p, ax: w / 2, ay: d / 2 };
}

/** 一个垂直车位的地面标线：宽 2.5 m、深 5 m。世界朝向下底线在西、车位口朝东 */
function stall(): PropArt {
  const w = 5 * PPM, d = 2.5 * PPM + 1;
  const p = new Pix(w, d);
  p.vline(0, 0, d, 'paint');
  p.hline(0, 0, w - 2, 'paint'), p.hline(0, d - 1, w - 2, 'paint');
  return { pix: p, ax: w / 2, ay: d / 2 };
}

/** 电动车充电桩：占地 0.6 m 见方、高 1.6 m，白色机身、绿色灯带，屏幕和充电枪朝世界西 */
function evCharger(v: View): PropArt {
  const s = Math.round(0.6 * PPM), h = Math.round(1.6 * PPM);
  const p = new Pix(s + 8, s + h + 5);
  const x0 = 2, ground = 2 + s + h;
  const face = FACING[v];
  p.rect(x0, ground - h, s, h, 'stone3');
  p.vline(x0 + s - 1, ground - h, h, 'stone1');
  p.rect(x0, ground - h - s, s, s, 'stone2');
  p.rect(x0, ground - h + 2, s, 1, 'leaf2');
  p.rect(x0, ground - 2, s, 2, 'slate');
  if (face === 'W') p.rect(x0 + 1, ground - h + 4, s - 2, 3, 'glass0'), p.px(x0 + 2, ground - h + 8, 'ink');
  // 侧面能看到挂在西侧的充电枪
  if (face === 'S' || face === 'N') p.rect(face === 'S' ? x0 - 1 : x0 + s, ground - h + 6, 1, 3, 'ink');
  p.outline('ink');
  for (let y = ground - s; y < ground; y++) for (let x = x0 + s + 1; x < x0 + s + 5; x++) if (!p.opaque(x, y)) p.px(x, y, 'shadow', 60);
  return { pix: p, ax: x0 + s / 2, ay: ground - s / 2 };
}

/** 小汽车的车漆：顶面、立面、暗部 */
const CAR_PAINT: [PalKey, PalKey, PalKey][] = [
  ['stone3', 'stone2', 'stone0'], // 白
  ['grey3', 'grey2', 'grey0'], // 银
  ['slate', 'glass0', 'ink'], // 黑
  ['water1', 'water0', 'glass0'], // 蓝
  ['flowerR', 'brick0', 'bronze0'], // 红
];

/**
 * 普通轿车：长 4.6 m、宽 1.8 m，下半截车身高 0.75 m、缩进的座舱再高 0.6 m。
 * head 是车头在屏幕上的朝向（0 上、1 右、2 下、3 左）；按 3/4 俯视画顶面和朝屏幕下方的立面
 */
function car(paint: number, head: number): PropArt {
  const [top, side, dark] = CAR_PAINT[paint];
  const L = Math.round(4.6 * PPM), Wd = Math.round(1.8 * PPM), HB = 6, HC = 5, Z = HB + HC;
  const along = head % 2 === 0; // 车身沿屏幕竖向
  const sw = along ? Wd : L, sd = along ? L : Wd;
  const p = new Pix(sw + 7, sd + Z + 4);
  const x0 = 1, gy = Z + 1; // 地面上占地矩形的左上角是 (x0, gy)
  // 盒子：屏幕坐标里占地 [xa, xb) × [ya, yb)，高 [za, zb)
  const box = (xa: number, xb: number, ya: number, yb: number, za: number, zb: number, t: PalKey, f: PalKey) => {
    p.rect(x0 + xa, gy + ya - zb, xb - xa, yb - ya, t);
    p.rect(x0 + xa, gy + yb - zb, xb - xa, zb - za, f);
  };
  // 座舱沿车长方向的范围（从车头量起），挡风玻璃在前、后窗在后
  const c0 = Math.round(L * 0.3), c1 = Math.round(L * 0.78);
  // 影子
  for (let y = gy + 2; y < gy + sd + 2; y++) for (let x = x0 + 2; x < x0 + sw + 3; x++) p.px(x, y, 'shadow', 60);
  // 车轮
  if (along) for (const yy of [Math.round(L * 0.2), Math.round(L * 0.8)]) p.rect(x0, gy + yy - 2, sw, 4, 'ink');
  else for (const xx of [Math.round(L * 0.2), Math.round(L * 0.8)]) p.rect(x0 + xx - 2, gy + sd - 3, 4, 3, 'ink');
  box(0, sw, 0, sd, 1, HB, top, side);
  if (along) {
    const [ya, yb] = head === 0 ? [c0, c1] : [L - c1, L - c0];
    box(1, sw - 1, ya, yb, HB, Z, top, 'glass0');
    // 顶面上看得到斜挡风玻璃和后窗
    const front = head === 0 ? ya : yb - 4, rear = head === 0 ? yb - 3 : ya;
    p.rect(x0 + 1, gy + front - Z, sw - 2, 4, 'glass1');
    p.hline(x0 + 2, gy + front - Z + (head === 0 ? 1 : 2), sw - 6, 'glass2');
    p.rect(x0 + 1, gy + rear - Z, sw - 2, 3, 'glass0');
    if (head === 2) p.px(x0 + 2, gy + yb - Z + 1, 'glass2'), p.px(x0 + 3, gy + yb - Z + 2, 'glass2');
    // 立面：车头（大灯、格栅）或车尾（尾灯、牌照）
    const fy = gy + sd - HB;
    if (head === 2) {
      p.rect(x0 + 1, fy + 1, 2, 2, 'flowerW'), p.rect(x0 + sw - 3, fy + 1, 2, 2, 'flowerW');
      p.rect(x0 + 4, fy + 2, sw - 8, 2, 'slate');
    } else {
      p.rect(x0 + 1, fy + 1, 2, 1, 'flowerR'), p.rect(x0 + sw - 3, fy + 1, 2, 1, 'flowerR');
      p.rect(x0 + sw / 2 - 2, fy + 3, 4, 1, 'water2');
    }
    p.hline(x0, gy + sd - 2, sw, dark);
  } else {
    const [xa, xb] = head === 3 ? [c0, c1] : [L - c1, L - c0];
    box(xa, xb, 1, sd - 1, HB, Z, top, 'glass0');
    // 顶面的挡风玻璃和后窗
    const front = head === 3 ? xa : xb - 4, rear = head === 3 ? xb - 3 : xa;
    p.rect(x0 + front, gy + 1 - Z, 4, sd - 2, 'glass1');
    p.vline(x0 + front + (head === 3 ? 1 : 2), gy + 2 - Z, sd - 6, 'glass2');
    p.rect(x0 + rear, gy + 1 - Z, 3, sd - 2, 'glass0');
    // 侧窗：B 柱分成前后两扇，前后斜边用车漆削角
    const wy = gy + sd - 1 - Z;
    p.vline(x0 + Math.round((xa + xb) / 2), wy, HC, top);
    p.px(x0 + (head === 3 ? xa : xb - 1), wy, top), p.px(x0 + (head === 3 ? xb - 1 : xa), wy, top);
    p.px(x0 + xa + 2, wy + 1, 'glass2');
    // 车门缝、前后灯
    const fy = gy + sd - HB;
    p.vline(x0 + Math.round((xa + xb) / 2), fy, HB - 1, dark);
    p.hline(x0, gy + sd - 2, sw, dark);
    p.rect(x0 + (head === 3 ? 0 : sw - 1), fy + 1, 1, 2, 'flowerW');
    p.rect(x0 + (head === 3 ? sw - 1 : 0), fy + 1, 1, 2, 'flowerR');
    // 车轮压在立面下沿
    for (const xx of [Math.round(L * 0.2), Math.round(L * 0.8)]) p.rect(x0 + xx - 2, gy + sd - 3, 4, 3, 'ink'), p.px(x0 + xx - 1, gy + sd - 2, 'grey1');
  }
  p.outline('ink');
  return { pix: p, ax: x0 + sw / 2, ay: gy + sd / 2 };
}

/**
 * 足球门：宽 7.32 m、高 2.44 m（规则尺寸），网兜进深约 2 m。世界朝向下（rot 0）门口朝南、网兜在北。
 * 白色门框，网画成稀疏的浅色点；门口朝屏幕上方时网兜在前，先画门框再画网
 */
function goal(v: View): PropArt {
  const mouth = screenSide(v, 'S');
  const Wm = Math.round(7.32 * PPM), D = 2 * PPM, Z = Math.round(2.44 * PPM);
  const along = mouth % 2 === 0; // 门口这条边在屏幕上是横的
  const sw = along ? Wm : D, sd = along ? D : Wm;
  const p = new Pix(sw + 4, sd + Z + 4);
  const ox = 2, oy = Z + 2;
  const at = (x: number, y: number, z: number, c: PalKey, a = 255) => p.px(ox + x, oy + y - z, c, a);
  // 门口那条边上的两点（屏幕地面坐标）和网兜方向
  const [m0, m1]: [number, number][] = mouth === 2 ? [[0, sd - 1], [sw - 1, sd - 1]] : mouth === 0 ? [[0, 0], [sw - 1, 0]] : mouth === 1 ? [[sw - 1, 0], [sw - 1, sd - 1]] : [[0, 0], [0, sd - 1]];
  const back: [number, number] = mouth === 2 ? [0, -(sd - 1)] : mouth === 0 ? [0, sd - 1] : mouth === 1 ? [-(sw - 1), 0] : [sw - 1, 0];
  const frame = () => {
    const n = Math.max(Math.abs(m1[0] - m0[0]), Math.abs(m1[1] - m0[1]));
    for (let k = 0; k <= n; k++) at(m0[0] + ((m1[0] - m0[0]) * k) / n, m0[1] + ((m1[1] - m0[1]) * k) / n, Z, 'white');
    for (const [x, y] of [m0, m1]) for (let z = 0; z <= Z; z++) at(x, y, z, z === 0 ? 'stone1' : 'white');
  };
  const net = () => {
    // 网兜：顶面和后面，向后斜收到地面
    const n = Math.max(Math.abs(m1[0] - m0[0]), Math.abs(m1[1] - m0[1]));
    for (let k = 0; k <= n; k += 2)
      for (let t = 0; t <= 1; t += 1 / D) {
        const x = m0[0] + ((m1[0] - m0[0]) * k) / n + back[0] * t, y = m0[1] + ((m1[1] - m0[1]) * k) / n + back[1] * t;
        at(x, y, Math.round(Z * (1 - t * 0.6)), 'stone3', 150);
        if (t > 0.95) for (let z = 0; z < Z * 0.4; z += 2) at(x, y, z, 'stone3', 150);
      }
  };
  if (mouth === 0) frame(), net();
  else net(), frame();
  return { pix: p, ax: ox + sw / 2, ay: oy + sd / 2 };
}

/** 篮球架：S26 标准篮高 3.05 m、篮板 1.8×1.05 m，杆后置，篮板朝世界南。 */
function hoop(v: View): PropArt {
  const p = new Pix(40, 56), ax = 20, ay = 44;
  const project = (x: number, y: number, z: number): [number, number] => {
    const [sx, sy] = v === 0 ? [x, y] : v === 1 ? [y, -x] : v === 2 ? [-x, -y] : [-y, x];
    return [ax + sx * PPM, ay + (sy - z) * PPM];
  };
  const edge = (a: [number, number, number], b: [number, number, number], c: PalKey) => {
    const [x0, y0] = project(...a), [x1, y1] = project(...b), n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) p.px(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
  };
  shadowAt(p, ax + 3, ay + 1, 6, 2);
  p.rect(ax - 3, ay - 2, 6, 4, 'stone1');
  for (const dx of [-0.1, 0, 0.1]) edge([dx, 0, 0], [dx, 0, 3.5], 'leaf0');
  edge([0, 0, 3.5], [0, 1.2, 3.5], 'leaf0');
  for (let z = 2.9; z <= 3.95; z += 1 / PPM) edge([-0.9, 1.2, z], [0.9, 1.2, z], 'stone3');
  for (const z of [2.9, 3.95]) edge([-0.9, 1.2, z], [0.9, 1.2, z], 'grey0');
  for (const x of [-0.9, 0.9]) edge([x, 1.2, 2.9], [x, 1.2, 3.95], 'grey0');
  if (screenSide(v, 'S') === 2) {
    for (const z of [3.05, 3.5]) edge([-0.3, 1.21, z], [0.3, 1.21, z], 'flowerR');
    for (const x of [-0.3, 0.3]) edge([x, 1.21, 3.05], [x, 1.21, 3.5], 'flowerR');
  }
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const x = Math.cos(a) * 0.225, y = 1.5 + Math.sin(a) * 0.225;
    const [px, py] = project(x, y, 3.05);
    p.px(px, py, 'flowerR');
    if (Math.round(a * 10) % 3 === 0) edge([x, y, 3.0], [x * 0.6, 1.5 + (y - 1.5) * 0.6, 2.65], 'stone2');
  }
  return { pix: p, ax, ay };
}

/** 南门门柱：据 S24 和 S7 暂估宽 3 m、深 4 m、高 7.5 m。 */
function southPillar(v: View): PropArt {
  const { sw, sd } = boxView(v, 3 * PPM, 4 * PPM), h = 7.5 * PPM;
  const p = new Pix(sw + 10, sd + h + 8), x0 = 3, ground = sd + h + 3;
  p.rect(x0, ground - h, sw, h, 'grey2');
  p.rect(x0, ground - h, 2, h, 'grey3');
  p.rect(x0 + sw - 2, ground - h, 2, h, 'grey0');
  p.rect(x0, ground - h - sd, sw, sd, 'grey3');
  p.hline(x0, ground - 3, sw, 'grey0');
  p.outline('ink');
  shadowUnder(p, x0 + sw / 2 + 3, ground - sd / 2 + 2, sw / 2, sd / 2);
  return { pix: p, ax: x0 + sw / 2, ay: ground - sd / 2 };
}

/** 南门门楼横梁：据 S24 暂估总宽 24 m、净高 4.5 m，未见的背面用中性墙。 */
function southBeam(v: View): PropArt {
  const { sw, sd } = boxView(v, 24 * PPM, 4 * PPM), h = 7.5 * PPM, clear = 4.5 * PPM;
  const p = new Pix(sw + 10, sd + h + 8), x0 = 3, ground = sd + h + 3;
  p.rect(x0, ground - h, sw, h - clear, 'grey2');
  p.hline(x0, ground - clear - 1, sw, 'grey0');
  p.rect(x0, ground - h - sd, sw, sd, 'grey3');
  if (screenSide(v, 'S') === 2) {
    for (let x = x0 + 12; x < x0 + sw - 12; x += 18) {
      p.rect(x, ground - h + 3, 10, 6, 'glass0');
      p.vline(x + 4, ground - h + 3, 6, 'grey1');
    }
    // 校名是繁体「東北大學」，深色，四字沿墙面等距排开（R-gates-01-02）
    const step = Math.floor((sw - 24) / 4), gy = ground - clear - 13;
    NAME_GLYPHS.forEach((g, k) => g.slice(1).forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && p.px(x0 + 12 + k * step + ((step - 12) >> 1) + x, gy + y, 'grey0'))));
  }
  p.outline('ink');
  return { pix: p, ax: x0 + sw / 2, ay: ground - sd / 2 };
}

/** 长征五号模型：S21 的白色芯级和四枚助推器，S22 人高参照与 S27 的 1:5 比例暂估体量。 */
function rocket(v: View): PropArt {
  const p = new Pix(56, 152), ax = 26, ay = 130;
  const project = (x: number, y: number): [number, number] => v === 0 ? [x, y] : v === 1 ? [y, -x] : v === 2 ? [-x, -y] : [-y, x];
  p.rect(ax - 16, ay - 32, 32, 32, 'brick1');
  p.rect(ax - 16, ay, 32, 16, 'brick0');
  p.hline(ax - 16, ay, 32, 'brick2');
  const tubes = [[0, 0, 1, 11.4], [-1.05, 0, 0.67, 7], [1.05, 0, 0.67, 7], [0, -1.05, 0.67, 7], [0, 1.05, 0.67, 7]];
  tubes.sort((a, b) => project(a[0], a[1])[1] - project(b[0], b[1])[1]);
  for (const [x, y, d, h] of tubes) {
    const [sx, sy] = project(x, y), cx = Math.round(ax + sx * PPM), base = Math.round(ay + sy * PPM - 2 * PPM), w = Math.round(d * PPM), ht = Math.round(h * PPM);
    p.rect(cx - w / 2, base - ht + 5, w, ht - 5, 'stone3');
    p.vline(cx + w / 2 - 1, base - ht + 5, ht - 5, 'grey1');
    for (let k = 0; k < 5; k++) p.hline(cx - (w * (k + 1)) / 10, base - ht + k, (w * (k + 1)) / 5, 'white');
    p.hline(cx - w / 2, base - 9, w, 'slate');
    p.hline(cx - w / 2, base - ht + 6, w, 'slate');
    p.rect(cx - w / 2 + 1, base, w - 2, 2, 'grey0');
    if (d === 1 && screenSide(v, 'S') === 2) {
      p.rect(cx - 2, base - ht + 3, 4, 2, 'flowerR');
      for (let yy = base - ht + 11; yy < base - 12; yy += 3) p.px(cx, yy, 'flowerR');
    }
  }
  p.outline('ink');
  shadowUnder(p, ax + 5, ay + 3, 21, 13);
  return { pix: p, ax, ay };
}

/** 刘长春像：S25 可见运动服、垂臂与前伸的左脚，基座和总高按附近成人 1.7 m 暂估。 */
function liuStatue(v: View): PropArt {
  const p = new Pix(38, 66), ax = 18, ay = 52;
  const ground = ay + 10;
  p.rect(ax - 10, ground - 32, 20, 20, 'brick1');
  p.rect(ax - 10, ground - 12, 20, 12, 'brick0');
  p.hline(ax - 10, ground - 12, 20, 'brick2');
  p.rect(ax - 11, ground - 1, 22, 2, 'grey0');
  const base = ay - 13, front = screenSide(v, 'W') === 2, back = screenSide(v, 'W') === 0;
  const w = front || back ? 7 : 5;
  p.rect(ax - w / 2, base - 18, w, 10, 'statue1');
  p.rect(ax - w / 2, base - 8, w, 4, 'statue0');
  p.ellipse(ax, base - 21, 2, 3, 'statue1');
  p.hline(ax - 2, base - 23, 4, 'statue0');
  for (const dx of [-w / 2 - 1, w / 2]) p.rect(ax + dx, base - 16, 1, 11, 'statue0');
  p.rect(ax - 3, base - 4, 2, 5, 'statue1');
  p.rect(ax + 1, base - 4, 2, 5, 'statue1');
  p.hline(ax - 4, base + 1, 4, 'statue0');
  p.hline(ax + 1, base, 3, 'statue0');
  if (front) {
    p.px(ax - 1, base - 21, 'statue0'), p.px(ax + 1, base - 21, 'statue0');
    p.hline(ax - 2, base - 15, 4, 'statue2');
    p.rect(ax - 4, ground - 10, 8, 1, 'gold');
  } else if (!back) p.px(ax + (v === 0 ? -3 : 3), base - 21, 'statue2');
  p.outline('ink');
  shadowUnder(p, ax + 4, ay + 2, 13, 10);
  return { pix: p, ax, ay };
}

/** 一二九群雕：据 S23 概括斜升旗面和七个前排人物，约 9×3 m、高 6 m，背面细节未取得。 */
function movement129(v: View): PropArt {
  const { sw, sd } = boxView(v, 9 * PPM, 3 * PPM), h = 6 * PPM;
  const p = new Pix(sw + 12, sd + h + 12), ax = sw / 2 + 4, ay = sd / 2 + h + 5;
  const project = (x: number, y: number, z: number): [number, number] => {
    const [sx, sy] = v === 0 ? [x, y] : v === 1 ? [y, -x] : v === 2 ? [-x, -y] : [-y, x];
    return [ax + sx * PPM, ay + (sy - z) * PPM];
  };
  const front = screenSide(v, 'S') === 2;
  for (let x = -4.5; x <= 4.5; x += 1 / PPM) {
    const ztop = 4 + ((x + 4.5) / 9) * 2;
    for (let z = v === 2 ? 0 : 1.3; z <= ztop; z += 1 / PPM) {
      const [sx, sy] = project(x, -0.6, z);
      p.px(sx, sy, v === 2 ? 'brick0' : 'brick1');
    }
  }
  if (v !== 2) {
    const people = [-3, -2, -1, 0, 1, 2, 3].map((x) => ({ x, at: project(x, 0.6, 0) })).sort((a, b) => a.at[1] - b.at[1]);
    for (const { x, at: [sx, sy] } of people) {
      p.rect(sx - 2, sy - 22, 5, 15, 'brick2');
      p.ellipse(sx, sy - 25, 2, 3, 'brick2');
      p.rect(sx - 2, sy - 7, 2, 8, 'brick1');
      p.rect(sx + 1, sy - 7, 2, 8, 'brick1');
      p.vline(sx - 3, sy - 20, 13, 'brick0');
      if (front) p.px(sx - 1, sy - 25, 'brick0'), p.px(sx + 1, sy - 25, 'brick0');
      if (x === -1 || x === 2) p.rect(sx + 3, sy - 31, 2, 14, 'brick2');
    }
  }
  p.outline('ink');
  shadowUnder(p, ax + 4, ay + 3, sw / 2, sd / 2);
  return { pix: p, ax, ay };
}

/** 物件图集的键：四个视角各画一张的物件叫「名字@N」等，地图里只写名字 */
const PROPS: Record<string, PropArt> = {
  'big-book': sculpture(),
  booth: booth(0),
};
for (const v of VIEWS) {
  const k = (name: string) => `${name}@${VIEW_NAME[v]}`;
  PROPS[k('pylon-west')] = pylon(true, v, true, 'E');
  PROPS[k('pylon-east')] = pylon(true, v, false, 'W');
  PROPS[k('pylon-small')] = pylon(false, v, false, null);
  PROPS[k('fence-gate')] = fence(2.75, v);
  PROPS[k('library-steps')] = rotCCW(librarySteps(), v);
  PROPS[k('stall')] = rotCCW(stall(), v);
  PROPS[k('ev-charger')] = evCharger(v);
  PROPS[k('goal')] = goal(v);
  PROPS[k('hoop')] = hoop(v);
  PROPS[k('gate-south-pillar')] = southPillar(v);
  PROPS[k('gate-south-beam')] = southBeam(v);
  PROPS[k('rocket')] = rocket(v);
  PROPS[k('liu-statue')] = liuStatue(v);
  PROPS[k('movement-129')] = movement129(v);
  PROPS[k('park-sculpture')] = sculpture();
  PROPS[k('energy-sphere')] = sculpture();
  // 车头朝北的车在各视角下屏幕上的车头朝向：上北朝上，上东朝左，上南朝下，上西朝右
  CAR_PAINT.forEach((_, i) => (PROPS[`car-${i}@${VIEW_NAME[v]}`] = car(i, [0, 3, 2, 1][v])));
}
// art/props/ 里审核通过的手绘物件：同名 json 给锚点（底边中点）和屏幕上的占地，这里换成占地中心
for (const f of readdirSync(new URL('../art/props/', import.meta.url)).filter((f) => f.endsWith('.png'))) {
  const name = f.slice(0, -4);
  const j = JSON.parse(readFileSync(new URL(`../art/props/${name}.json`, import.meta.url), 'utf8'));
  const depth = (j.screen_footprint_m ?? j.footprint_m)[1] * PPM;
  PROPS[name] = { pix: loadPix(new URL(`../art/props/${f}`, import.meta.url)), ax: j.ax, ay: Math.round(j.ay - depth / 2) };
}
// 树名里的数字是树冠半径（分米）
TREES.forEach((name, i) => {
  const R = Number(name.split('-')[1]) / 10;
  PROPS[name] = name.startsWith('pine') ? conifer(R, 300 + i) : broadleaf(R, 300 + i);
});

{
  const { atlas, meta } = packAtlas(PROPS);
  save(atlas, 'props.png');
  writeFileSync(out('props.json'), JSON.stringify(meta, null, 1));
}

// ---------- 生态与界面（车辆、动物、图标），目录在 shared/vehicles.ts、fauna.ts、icons.ts ----------
for (const [name, sprites] of [
  ['vehicles', { ...drawVehicles(), ...drawBikes() }],
  ['fauna', drawFauna()],
  ['ui', drawUi()],
] as const) {
  const { atlas, meta } = packAtlas(sprites);
  save(atlas, `${name}.png`);
  writeFileSync(out(`${name}.json`), JSON.stringify(meta, null, 1));
  // 放大 3 倍、铺浅灰底的联系表 data/<名字>-sheet.png（不进仓库），审图用
  const k = 3, sheet = new Pix(atlas.w * k, atlas.h * k);
  sheet.rect(0, 0, sheet.w, sheet.h, 'grey2');
  for (let y = 0; y < atlas.h; y++)
    for (let x = 0; x < atlas.w; x++) {
      const i = (y * atlas.w + x) * 4;
      if (atlas.data[i + 3]) sheet.rect(x * k, y * k, k, k, (atlas.data[i] << 16) | (atlas.data[i + 1] << 8) | atlas.data[i + 2], atlas.data[i + 3]);
    }
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  sheet.save(new URL(`../data/${name}-sheet.png`, import.meta.url));
}

// ---------- 角色与表情 ----------
save(drawAvatarSheet(), 'avatar.png');

function emoteIcon(i: number, p: Pix, ox: number, oy: number): void {
  const px = (x: number, y: number, c: PalKey) => p.px(ox + x, oy + y, c);
  const rows = (art: string[], map: Record<string, PalKey>) =>
    art.forEach((row, y) => [...row].forEach((ch, x) => map[ch] && px(x, y, map[ch])));
  const ART: [string[], Record<string, PalKey>][] = [
    // 挥手
    [['  # # #  ', ' ## # ## ', ' #######', ' #######', '  ######', '  ##### ', '   ###  '], { '#': 'brick2' }],
    // 开心
    [['  ####  ', ' #oooo# ', '#o#oo#o#', '#oooooo#', '#o#oo#o#', ' #o##o# ', '  ####  '], { '#': 'ink', o: 'flowerY' }],
    // 爱心
    [[' ## ##  ', '#rr#rr# ', '#rrrrr# ', ' #rrr#  ', '  #r#   ', '   #    '], { '#': 'ink', r: 'flowerR' }],
    // 疑问
    [['  ###  ', ' #   # ', '     # ', '   ##  ', '   #   ', '       ', '   #   '], { '#': 'water0' }],
    // 惊讶
    [['   #   ', '   #   ', '   #   ', '   #   ', '   #   ', '       ', '   #   '], { '#': 'flowerR' }],
    // 点赞
    [['   #    ', '  ##    ', '  ##### ', '####### ', '####### ', '####### ', ' ###### '], { '#': 'flowerY' }],
  ];
  const [art, map] = ART[i];
  rows(art, map);
}
{
  const FW = 18, FH = 18;
  const sheet = new Pix(FW * EMOTES.length, FH);
  EMOTES.forEach((_, i) => {
    const b = new Pix(FW, FH);
    b.rect(1, 1, 16, 13, 'white');
    b.rect(7, 14, 4, 2, 'white');
    b.px(8, 16, 'white');
    b.outline('ink');
    emoteIcon(i, b, 5, 4);
    sheet.blit(b, i * FW, 0);
  });
  save(sheet, 'emotes.png');
}

// ---------- 建筑 ----------
const map: TiledMap = JSON.parse(readFileSync(out('map.json'), 'utf8'));
const objLayer = map.layers.find((l) => l.name === LAYER.objects);
if (!objLayer || objLayer.type !== 'objectgroup') throw new Error('地图缺少 objects 图层，先跑 npm run map');
// 先清空：拆掉或改了编号的楼不留旧图。只删文件、保留目录，开着的 Vite 才不会丢掉它
mkdirSync(out('buildings'), { recursive: true });
for (const f of readdirSync(out('buildings'))) rmSync(new URL(f, out('buildings/')));
const buildingArt = new Map<string, Pix>();
{
  // 楼的模型和地图工具算的是同一份（buildings.ts），地图里留下的楼才画
  const osm = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));
  const gate = osm.elements.find((e: { tags: Record<string, string> }) => e.tags.name === '北门');
  const models = new Map(loadBuildings(osm, loadSurvey(), toWorld(gate.lat, gate.lon)[0]).map((b) => [`b${b.id}`, b]));
  for (const o of objLayer.objects.filter((o) => o.type === 'building')) {
    const sprite = prop(o, 'sprite', '');
    for (const v of VIEWS) {
      const pix = drawBuilding(models.get(sprite)!, v);
      if (v === 0) buildingArt.set(sprite, pix);
      save(pix, `buildings/${sprite}-${VIEW_NAME[v]}.png`);
    }
  }
}

// ---------- 调色板导出（给手绘用） ----------
{
  const entries = Object.entries(PAL);
  const gpl = ['GIMP Palette', 'Name: Pixel NEU', 'Columns: 8', '#'];
  for (const [name, v] of entries) gpl.push(`${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}\t${name}`);
  writeFileSync(out('palette.gpl'), gpl.join('\n') + '\n');
  // 公开美术仓库（art/ 子模块）里放同一份，投稿人用它
  writeFileSync(new URL('../art/palette.gpl', import.meta.url), gpl.join('\n') + '\n');
  const sw = new Pix(8 * 8, Math.ceil(entries.length / 8) * 8);
  entries.forEach(([, v], i) => sw.rect((i % 8) * 8, Math.floor(i / 8) * 8, 8, 8, v));
  save(sw, 'palette.png');
}

// ---------- 全图预览 ----------
{
  const W = map.width, H = map.height;
  const pv = new Pix(W * TILE, H * TILE);
  // 地面分块图按位置拼回去
  for (const f of readdirSync(out('ground'))) {
    const [cx, cy] = f.slice(0, -4).split('-').map(Number);
    const g = loadPix(new URL(f, out('ground/')));
    for (let y = 0; y < g.h; y++) pv.data.set(g.data.subarray(y * g.w * 4, (y + 1) * g.w * 4), ((cy * GROUND_CHUNK + y) * pv.w + cx * GROUND_CHUNK) * 4);
  }
  // 建筑与物件按脚底 y 排序后画
  const draws: { y: number; fn: () => void }[] = [];
  for (const o of objLayer.objects) {
    if (o.type === 'building') {
      const pix = buildingArt.get(prop(o, 'sprite', ''))!;
      draws.push({ y: o.y + o.height, fn: () => pv.blit(pix, o.x, o.y - prop(o, 'top', 0)) });
    } else if (o.type === 'prop') {
      const name = prop(o, 'sprite', '');
      const a = PROPS[name] ?? PROPS[`${name}@${VIEW_NAME[(4 - prop(o, 'rot', 0)) % 4]}`];
      if (a) draws.push({ y: o.y, fn: () => pv.blit(a.pix, o.x - a.ax, o.y - a.ay) });
    }
  }
  draws.sort((a, b) => a.y - b.y).forEach((d) => d.fn());
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  pv.save(new URL('../data/preview.png', import.meta.url));
}
console.log(`美术已生成：${buildingArt.size} 栋建筑、${Object.keys(PROPS).length} 种物件、车辆、动物、界面图标、avatar.png、emotes.png`);
