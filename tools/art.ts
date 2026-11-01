// 生成全部程序化美术：地面瓦片、建筑、物件、角色、表情、调色板。用法：npm run art（先 npm run map）
// 产物写进 assets/，同时在 data/preview.png 拼一张全图预览（不进仓库），用来检查风格是否统一。
// 某张图改成手绘后，把它从 HANDMADE 之外的生成列表里拿掉，避免被覆盖（规则见 assets/AGENTS.md）。
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { EMOTES } from '../shared/social.ts';
import { FACING, VIEWS, VIEW_NAME, type View } from '../shared/view.ts';
import { LAYER, METERS_PER_TILE, TILE, prop, type TiledMap } from '../shared/world.ts';
import { drawAvatarSheet } from './art-avatar.ts';
import { drawBuilding, type BuildingSpec } from './art-building.ts';
import { PAL, type PalKey } from './palette.ts';
import { Pix, loadPix, rng } from './pix.ts';
import { TILESET, TREES } from './tiles.ts';

const out = (p: string) => new URL(`../assets/${p}`, import.meta.url);
/** 每米像素（物件和树按真实尺寸画） */
const PPM = TILE / METERS_PER_TILE;

/** 已经换成手绘的文件名（相对 assets/），生成时跳过 */
const HANDMADE = new Set<string>([]);
function save(pix: Pix, name: string): void {
  if (HANDMADE.has(name)) return;
  pix.save(out(name));
}

// ---------- 地面瓦片 ----------
function noise(p: Pix, seed: number, base: PalKey, dots: [PalKey, number][]): void {
  const r = rng(seed);
  p.rect(0, 0, TILE, TILE, base);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = r();
      let acc = 0;
      for (const [c, pr] of dots) {
        acc += pr;
        if (v < acc) {
          p.px(x, y, c);
          break;
        }
      }
    }
}

function drawTile(i: number): Pix {
  const p = new Pix(TILE, TILE);
  const r = rng(1000 + i);
  switch (i) {
    case 0: case 1: case 2: case 3: {
      noise(p, 10 + i, 'grass1', [['grass2', 0.03], ['grass0', 0.015]]);
      // 草叶：两像素高的小竖笔，只在少数瓦片上
      for (let k = 0; k < i - 1; k++) {
        const x = (r() * 15) | 0, y = 1 + ((r() * 14) | 0);
        p.px(x, y, 'grass3'), p.px(x, y + 1, 'grass0');
      }

      break;
    }
    case 4: case 5:
      noise(p, 20 + i, 'asph1', [['asph0', 0.1], ['asph2', 0.06]]);
      break;
    case 6: case 7: {
      // 1 m 见方的石板，缝用深一档；少数石板颜色略深
      for (let y = 0; y < TILE; y += PPM)
        for (let x = 0; x < TILE; x += PPM) {
          p.rect(x, y, PPM, PPM, i === 7 && x === 0 && y === 0 ? 'pave1' : 'pave2');
          p.hline(x, y, PPM, 'pave1'), p.vline(x, y, PPM, 'pave1');
        }
      break;
    }
    case 8: case 9: {
      // 人行道：错缝砖，红砖夹灰砖（据校园人行道照片）
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const row = y >> 2, off = row % 2 ? 4 : 0;
          const joint = y % 4 === 3 || (x + off) % 8 === 7;
          const grey = ((((x + off) >> 3) + row + i) % 5) === 0;
          p.px(x, y, joint ? 'brick0' : grey ? 'pave1' : (x + y) % 7 === 0 ? 'brick2' : 'brick1');
        }
      break;
    }
    case 10: {
      // 校界墙：上面是墙顶，下半是朝北（朝屏幕下方）的墙面
      p.rect(0, 0, TILE, 6, 'wall2');
      p.hline(0, 0, TILE, 'stone3');
      p.rect(0, 6, TILE, 10, 'wall1');
      for (let y = 6; y < TILE; y += 3) p.hline(0, y, TILE, 'wall0');
      p.hline(0, 15, TILE, 'ink');
      break;
    }
    case 11:
      noise(p, 31, 'water1', [['water0', 0.12]]);
      for (let k = 0; k < 3; k++) p.hline((r() * 10) | 0, (r() * 15) | 0, 4, 'water2');
      break;
    case 12: {
      // 花坛：绿叶里点红花
      p.rect(0, 0, TILE, TILE, 'leaf1');
      for (let k = 0; k < 18; k++) p.px(2 + ((r() * 12) | 0), 2 + ((r() * 12) | 0), k % 4 ? 'flowerR' : 'flowerP');
      break;
    }
    case 13:
      noise(p, 33, 'hedge', [['leaf2', 0.2], ['leaf0', 0.1]]);
      break;
    case 14: {
      // 校外和还没描过的地方：深灰色块，一眼看出不能进入
      noise(p, 34, 'slate', [['ink', 0.04]]);
      break;
    }
    case 52: {
      // 广场铺装带：深一档的长条石
      p.rect(0, 0, TILE, TILE, 'pave1');
      for (let k = 0; k < TILE; k += 4) p.vline(k, 0, TILE, 'pave0'), p.hline(0, k, TILE, 'pave0');
      for (let k = 1; k < TILE; k += 4) p.hline(k, k, 2, 'pave2');
      break;
    }
    case 53: case 54:
      // 林下地面：树荫里的深色草
      noise(p, 60 + i, 'grass0', [['leaf1', 0.04], ['leaf0', 0.03]]);
      if (i === 54) p.px(5, 9, 'grass1'), p.px(5, 10, 'leaf0');
      break;
    case 72: case 73:
      // 塑胶跑道：红色颗粒面
      noise(p, 80 + i, 'track1', [['track0', 0.12]]);
      break;
    case 74: case 75:
      // 人工草：割草条纹，相邻两格深浅交替（地图按列挑）
      noise(p, 80 + i, i === 74 ? 'grass1' : 'grass2', [['grass0', 0.03]]);
      break;
    case 76:
      noise(p, 86, 'court1', [['court0', 0.06]]);
      break;
    case 56:
      // 停车位线：一道 1 像素宽的白线（约 12 cm）
      noise(p, 24, 'asph1', [['asph0', 0.1], ['asph2', 0.06]]);
      p.vline(0, 0, TILE, 'paint');
      break;
    case 57: case 58: case 59: case 60: {
      // 车道中心虚线：2 m 一段，透明底，叠在沥青上
      const at = (i - 57) % 2 ? 0 : TILE / 2 - 1;
      if (i < 59) p.rect(at, 4, 2, 8, 'paint');
      else p.rect(4, at, 8, 2, 'paint');
      break;
    }
    case 55:
      noise(p, 70, 'asph0', [['shadow', 0.08], ['asph1', 0.05]]);
      break;
    case 15:
      p.rect(0, 0, TILE, TILE, 'flowerR', 120);
      break;
    case 48: case 49:
      noise(p, 40 + i, 'grass0', [['leaf1', 0.15], ['grass1', 0.08]]);
      break;
    case 50: {
      noise(p, 50, 'asph1', [['asph0', 0.1]]);
      for (let y = 0; y < TILE; y++) if (y % 4 < 2) p.hline(2, y, 12, 'paint');
      break;
    }
    case 51:
      p.rect(0, 0, TILE, TILE, 'pave0');
      break;
    case 64: case 65: case 66: case 67: case 68: case 69: case 70: case 71: {
      // 斜边过渡：草地格的一个角填成沥青或铺装，斜边上一道路缘
      const base = drawTile(i < 68 ? 4 : 6);
      const corner = (i - 64) % 4; // 东北、东南、西南、西北
      const fx = (x: number) => (corner === 0 || corner === 1 ? x : TILE - 1 - x);
      const fy = (y: number) => (corner === 1 || corner === 2 ? y : TILE - 1 - y);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const d = fx(x) + fy(y) - (TILE - 1); // 0 在斜边上，正的一侧是被填的角
          if (d > 0) p.data.set(base.data.subarray((y * TILE + x) * 4, (y * TILE + x) * 4 + 4), (y * TILE + x) * 4);
          else if (d === 0) p.px(x, y, 'curb');
          else if (d === -1) p.px(x, y, 'grass0');
        }
      break;
    }
    default: {
      // 16–31 草地边缘、32–47 路沿石：按掩码在对应边上画
      const isGrass = i >= TILESET.grassEdge && i < TILESET.grassEdge + 16;
      const mask = i - (isGrass ? TILESET.grassEdge : TILESET.curb);
      if (i >= TILESET.curb + 16 || mask <= 0) break;
      const edge = (bit: number, draw: (k: number, d: number) => void) => {
        if (mask & bit) for (let k = 0; k < TILE; k++) for (let d = 0; d < 2; d++) draw(k, d);
      };
      const c0: PalKey = isGrass ? 'curb' : 'stone2', c1: PalKey = isGrass ? 'grass0' : 'stone0';
      edge(1, (k, d) => p.px(k, d, d ? c1 : c0));
      edge(4, (k, d) => p.px(k, TILE - 1 - d, d ? c1 : c0));
      edge(8, (k, d) => p.px(d, k, d ? c1 : c0));
      edge(2, (k, d) => p.px(TILE - 1 - d, k, d ? c1 : c0));
    }
  }
  return p;
}

const tiles = new Pix(TILESET.columns * TILE, Math.ceil(TILESET.count / TILESET.columns) * TILE);
const tileArt: Pix[] = [];
for (let i = 0; i < TILESET.count; i++) {
  const t = drawTile(i);
  tileArt.push(t);
  tiles.blit(t, (i % TILESET.columns) * TILE, Math.floor(i / TILESET.columns) * TILE);
}
save(tiles, 'tiles.png');

// ---------- 物件 ----------
// 每个物件一张小图，脚底（锚点）在 (ax, ay)。合成一张图集 props.png + props.json
interface PropArt {
  pix: Pix;
  ax: number;
  ay: number;
}
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
  // 图集：按高度从高到低排成宽 1024 的若干行
  const pad = 1, AW = 1024;
  const items = Object.entries(PROPS).sort((a, b) => b[1].pix.h - a[1].pix.h);
  const pos: [number, number][] = [];
  let x = 0, y = 0, rowH = 0;
  for (const [, a] of items) {
    if (x + a.pix.w > AW) (x = 0), (y += rowH + pad), (rowH = 0);
    pos.push([x, y]);
    x += a.pix.w + pad;
    rowH = Math.max(rowH, a.pix.h);
  }
  const atlas = new Pix(AW, y + rowH);
  const meta: Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }> = {};
  items.forEach(([name, a], i) => {
    atlas.blit(a.pix, pos[i][0], pos[i][1]);
    meta[name] = { x: pos[i][0], y: pos[i][1], w: a.pix.w, h: a.pix.h, ax: a.ax, ay: a.ay };
  });
  save(atlas, 'props.png');
  writeFileSync(out('props.json'), JSON.stringify(meta, null, 1));
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
for (const o of objLayer.objects.filter((o) => o.type === 'building')) {
  const spec: BuildingSpec = {
    sprite: prop(o, 'sprite', ''),
    style: prop(o, 'style', 'plain'),
    mask: prop(o, 'mask', ''),
    levels: prop(o, 'levels', '0'),
    top: prop(o, 'top', 0),
  };
  for (const v of VIEWS) {
    const pix = drawBuilding(spec, v);
    if (v === 0) buildingArt.set(spec.sprite, pix);
    save(pix, `buildings/${spec.sprite}-${VIEW_NAME[v]}.png`);
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
  for (const name of [LAYER.ground, LAYER.edges]) {
    const l = map.layers.find((x) => x.name === name);
    if (!l || l.type !== 'tilelayer') continue;
    l.data.forEach((g, i) => g && pv.blit(tileArt[g - TILESET.firstgid], (i % W) * TILE, Math.floor(i / W) * TILE));
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
console.log(`美术已生成：tiles.png、${buildingArt.size} 栋建筑、${Object.keys(PROPS).length} 种物件、avatar.png、emotes.png`);
