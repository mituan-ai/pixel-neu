// 生成全部程序化美术：地面瓦片、建筑、物件、角色、表情、调色板。用法：npm run art（先 npm run map）
// 产物写进 assets/，同时在 data/preview.png 拼一张全图预览（不进仓库），用来检查风格是否统一。
// 某张图改成手绘后，把它从 HANDMADE 之外的生成列表里拿掉，避免被覆盖（规则见 assets/AGENTS.md）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { EMOTES } from '../shared/social.ts';
import { LAYER, TILE, prop, type TiledMap } from '../shared/world.ts';
import { drawAvatarSheet } from './art-avatar.ts';
import { drawBuilding, type BuildingSpec } from './art-building.ts';
import { PAL, type PalKey } from './palette.ts';
import { Pix, rng } from './pix.ts';
import { TILESET } from './tiles.ts';

const out = (p: string) => new URL(`../assets/${p}`, import.meta.url);

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
      noise(p, 10 + i, 'grass1', [['grass2', 0.12], ['grass0', 0.05]]);
      // 草叶：两像素高的小竖笔
      for (let k = 0; k < 3 + i; k++) {
        const x = (r() * 15) | 0, y = 1 + ((r() * 14) | 0);
        p.px(x, y, 'grass3'), p.px(x, y + 1, 'grass0');
      }
      if (i === 3) for (let k = 0; k < 3; k++) p.px((r() * 15) | 0, (r() * 15) | 0, k ? 'flowerW' : 'flowerY');
      break;
    }
    case 4: case 5:
      noise(p, 20 + i, 'asph1', [['asph0', 0.1], ['asph2', 0.06]]);
      break;
    case 6: case 7: {
      // 方形石板 8×8，缝用深一档
      p.rect(0, 0, TILE, TILE, 'pave2');
      for (let k = 0; k < TILE; k++) p.px(k, 0, 'pave1'), p.px(k, 8, 'pave1'), p.px(0, k, 'pave1'), p.px(8, k, 'pave1');
      for (let k = 1; k < 8; k++) p.px(k, 1, 'pave3'), p.px(k + 8, 9, 'pave3');
      if (i === 7) p.rect(9, 1, 7, 7, 'pave1'), p.px(12, 4, 'pave0');
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
      // 花坛：矮绿篱围一圈红花
      p.rect(0, 0, TILE, TILE, 'hedge');
      p.rect(2, 2, 12, 12, 'leaf1');
      for (let k = 0; k < 18; k++) p.px(2 + ((r() * 12) | 0), 2 + ((r() * 12) | 0), k % 4 ? 'flowerR' : 'flowerP');
      p.hline(0, 15, TILE, 'leaf0');
      break;
    }
    case 13:
      noise(p, 33, 'hedge', [['leaf2', 0.2], ['leaf0', 0.1]]);
      p.hline(0, 15, TILE, 'leaf0');
      break;
    case 14: {
      // 校外：压暗的大块铺装，一眼看出不能进入
      p.rect(0, 0, TILE, TILE, 'pave0');
      for (let k = 0; k < TILE; k++) p.px(k, 0, 'wall0'), p.px(0, k, 'wall0');
      for (let k = 0; k < 10; k++) p.px((r() * 15) | 0, (r() * 15) | 0, 'wall0');
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
      noise(p, 60 + i, 'grass0', [['grass1', 0.18], ['leaf1', 0.06]]);
      for (let k = 0; k < 4; k++) {
        const x = (r() * 15) | 0, y = 1 + ((r() * 14) | 0);
        p.px(x, y, 'grass2'), p.px(x, y + 1, 'leaf0');
      }
      break;
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

function pine(): PropArt {
  // 高大的柱状针叶树（北门内与前庭两侧，据照片）
  const p = new Pix(16, 44);
  shadowAt(p, 9, 41, 6, 2);
  p.rect(7, 36, 2, 6, 'trunk');
  for (let y = 2; y < 38; y++) {
    const t = (y - 2) / 36;
    const half = Math.round(1 + t * 5.5 + (y % 5 === 0 ? -0.6 : 0));
    for (let x = -half; x <= half; x++) {
      const col: PalKey = x < -half / 3 ? 'pine2' : x > half / 3 ? 'pine0' : 'pine1';
      p.px(8 + x, y, (y % 5 === 4 && Math.abs(x) === half) ? 'pine0' : col);
    }
  }
  p.outline('ink');
  return { pix: p, ax: 8, ay: 42 };
}

function tree(): PropArt {
  // 阔叶行道树：圆冠
  const p = new Pix(24, 32);
  const r = rng(77);
  shadowAt(p, 13, 29, 8, 2);
  p.rect(11, 20, 2, 10, 'trunk');
  p.ellipse(12, 11, 10, 9, 'leaf1');
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2, d = r() * 8;
    const x = 12 + Math.cos(a) * d, y = 11 + Math.sin(a) * d * 0.9;
    p.px(x, y, x + y < 22 ? 'leaf2' : 'leaf0');
  }
  p.ellipse(9, 7, 4, 3, 'leaf2');
  p.outline('ink');
  return { pix: p, ax: 12, ay: 30 };
}

function treePit(): PropArt {
  // 树池里的小树（图书馆四周一圈）
  const p = new Pix(16, 26);
  p.rect(2, 20, 12, 5, 'stone1');
  p.rect(3, 21, 10, 3, 'trunk');
  p.rect(7, 12, 2, 10, 'trunk');
  p.ellipse(8, 8, 6, 6, 'leaf1');
  p.ellipse(6, 6, 3, 2, 'leaf2');
  p.outline('ink');
  return { pix: p, ax: 8, ay: 24 };
}

function lamp(): PropArt {
  const p = new Pix(8, 30);
  p.rect(3, 6, 2, 22, 'slate');
  p.rect(1, 2, 6, 4, 'slate');
  p.rect(2, 3, 4, 2, 'flowerW');
  p.rect(2, 27, 4, 2, 'slate');
  p.outline('ink');
  return { pix: p, ax: 4, ay: 29 };
}

function bench(): PropArt {
  const p = new Pix(18, 12);
  shadowAt(p, 10, 10, 8, 1);
  p.rect(1, 2, 16, 3, 'trunk'); // 靠背
  p.hline(1, 2, 16, 'brick2');
  p.rect(1, 6, 16, 2, 'brick1'); // 坐板
  p.rect(2, 8, 1, 3, 'slate'), p.rect(15, 8, 1, 3, 'slate');
  p.outline('ink');
  return { pix: p, ax: 9, ay: 11 };
}

function pylon(kind: 'big' | 'plaque' | 'small'): PropArt {
  // 北门石柱：方柱、上部收分出檐，顶部一圈装饰带（据校门照片）
  const small = kind === 'small';
  const w = small ? 14 : 20, h = small ? 40 : 60;
  const p = new Pix(w + 4, h + 3);
  shadowAt(p, w / 2 + 3, h, w / 2 + 1, 2);
  const x0 = 2, shaftTop = small ? 10 : 14;
  p.rect(x0 + 1, shaftTop, w - 2, h - shaftTop, 'stone2');
  p.rect(x0 + 1, shaftTop, 2, h - shaftTop, 'stone3');
  p.rect(x0 + w - 4, shaftTop, 2, h - shaftTop, 'stone1');
  p.rect(x0, h - 4, w, 4, 'stone1'); // 基座
  p.rect(x0, shaftTop - 4, w, 4, 'stone1'); // 檐
  p.hline(x0, shaftTop - 4, w, 'stone3');
  p.rect(x0 + 1, 3, w - 2, shaftTop - 7, 'stone2'); // 顶部
  for (let x = x0 + 2; x < x0 + w - 2; x += 3) p.px(x, 5, 'stone0'); // 装饰带
  p.rect(x0 + 3, 0, w - 6, 3, 'stone1');
  if (kind === 'plaque') {
    // 竖写校名牌：白底黑字（字形抽象成笔画块）
    const px0 = x0 + 6, py0 = shaftTop + 6;
    p.rect(px0, py0, 8, 30, 'flowerW');
    for (let k = 0; k < 4; k++) {
      const y = py0 + 2 + k * 7;
      p.rect(px0 + 2, y, 4, 1, 'ink');
      p.rect(px0 + 3, y + 1, 1, 4, 'ink');
      p.px(px0 + 5, y + 3, 'ink'), p.px(px0 + 2, y + 4, 'ink');
    }
  }
  p.outline('ink');
  return { pix: p, ax: w / 2 + 2, ay: h };
}

function mottoStone(): PropArt {
  // 校训石：深色梯形底座刻金字“自强不息 知行合一”，上置灰色纹理景石（据照片）
  const p = new Pix(36, 30);
  shadowAt(p, 19, 27, 17, 2);
  for (let y = 0; y < 9; y++) p.hline(2 + Math.max(0, 2 - y), 18 + y, 32 - 2 * Math.max(0, 2 - y), y === 0 ? 'grey0' : 'slate');
  for (let k = 0; k < 8; k++) p.rect(6 + k * 3 + (k >= 4 ? 2 : 0), 22, 2, 2, 'gold');
  p.ellipse(18, 10, 8, 8, 'stone1');
  p.ellipse(16, 8, 5, 5, 'stone2');
  for (let k = 0; k < 6; k++) p.px(12 + k * 2, 6 + ((k * 5) % 7), 'stone0'), p.px(13 + k * 2, 7 + ((k * 3) % 6), 'water2');
  p.outline('ink');
  return { pix: p, ax: 18, ay: 27 };
}

function sculpture(): PropArt {
  // 外观未核实的雕塑（大书、能量球）：先用统一的底座占位，核实后替换（见 docs/design.md）
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

function bust(): PropArt {
  // 铜像胸像 + 石基座
  const p = new Pix(16, 30);
  shadowAt(p, 9, 27, 7, 2);
  p.rect(3, 14, 10, 14, 'stone2');
  p.rect(3, 14, 2, 14, 'stone3');
  p.rect(11, 14, 2, 14, 'stone1');
  p.rect(4, 8, 8, 6, 'bronze1'); // 肩
  p.rect(6, 1, 4, 7, 'bronze1'); // 头
  p.rect(6, 1, 2, 7, 'bronze2');
  p.rect(4, 8, 2, 6, 'bronze2');
  p.outline('ink');
  return { pix: p, ax: 8, ay: 28 };
}

function ding(): PropArt {
  // 铜鼎：圆腹、双立耳、三足，腹部一圈纹饰（据照片）
  const p = new Pix(24, 30);
  shadowAt(p, 13, 27, 10, 2);
  p.rect(2, 22, 20, 6, 'stone1');
  p.hline(2, 22, 20, 'stone3');
  p.rect(5, 16, 2, 6, 'bronze0'), p.rect(11, 17, 2, 5, 'bronze0'), p.rect(17, 16, 2, 6, 'bronze0');
  p.ellipse(12, 12, 9, 6, 'bronze1');
  p.rect(3, 6, 18, 2, 'bronze2'); // 口沿
  for (let x = 5; x < 20; x += 2) p.px(x, 12, 'bronze0'), p.px(x + 1, 13, 'bronze2');
  p.rect(5, 1, 3, 5, 'bronze1'), p.rect(16, 1, 3, 5, 'bronze1'); // 立耳
  p.px(6, 2, 'bronze0'), p.px(6, 3, 'bronze0'), p.px(17, 2, 'bronze0'), p.px(17, 3, 'bronze0');
  p.outline('ink');
  return { pix: p, ax: 12, ay: 27 };
}

const PROPS: Record<string, PropArt> = {
  pine: pine(),
  tree: tree(),
  'tree-pit': treePit(),
  lamp: lamp(),
  bench: bench(),
  pylon: pylon('big'),
  'pylon-plaque': pylon('plaque'),
  'pylon-small': pylon('small'),
  'motto-stone': mottoStone(),
  'big-book': sculpture(),
  'energy-ball': sculpture(),
  bust: bust(),
  ding: ding(),
};

{
  // 简单的横向排布图集
  const pad = 1;
  const W = Object.values(PROPS).reduce((s, a) => s + a.pix.w + pad, 0);
  const H = Math.max(...Object.values(PROPS).map((a) => a.pix.h));
  const atlas = new Pix(W, H);
  const meta: Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }> = {};
  let x = 0;
  for (const [name, a] of Object.entries(PROPS)) {
    atlas.blit(a.pix, x, 0);
    meta[name] = { x, y: 0, w: a.pix.w, h: a.pix.h, ax: a.ax, ay: a.ay };
    x += a.pix.w + pad;
  }
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
mkdirSync(out('buildings'), { recursive: true });
const buildingArt = new Map<string, Pix>();
for (const o of objLayer.objects.filter((o) => o.type === 'building')) {
  const spec: BuildingSpec = {
    sprite: prop(o, 'sprite', ''),
    style: prop(o, 'style', 'plain'),
    mask: prop(o, 'mask', ''),
    levels: prop(o, 'levels', '0'),
    top: prop(o, 'top', 0),
  };
  const pix = drawBuilding(spec);
  buildingArt.set(spec.sprite, pix);
  save(pix, `buildings/${spec.sprite}.png`);
}

// ---------- 调色板导出（给手绘用） ----------
{
  const entries = Object.entries(PAL);
  const gpl = ['GIMP Palette', 'Name: Pixel NEU', 'Columns: 8', '#'];
  for (const [name, v] of entries) gpl.push(`${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}\t${name}`);
  writeFileSync(out('palette.gpl'), gpl.join('\n') + '\n');
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
      const a = PROPS[prop(o, 'sprite', '')];
      if (a) draws.push({ y: o.y, fn: () => pv.blit(a.pix, o.x - a.ax, o.y - a.ay) });
    }
  }
  draws.sort((a, b) => a.y - b.y).forEach((d) => d.fn());
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  pv.save(new URL('../data/preview.png', import.meta.url));
}
console.log(`美术已生成：tiles.png、${buildingArt.size} 栋建筑、${Object.keys(PROPS).length} 种物件、avatar.png、emotes.png`);
