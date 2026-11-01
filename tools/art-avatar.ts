// 角色精灵表 assets/avatar.png，布局见 shared/social.ts 的 AVATAR、AVATAR_BLOCK。
// 底模和七种发型来自 art/chibi/（CC0，见 art/chibi/README.md）。衣服、鞋和四种短发按底模的轮廓生成：
// - 下巴下面那一整行描边是头和身子的分界，往下按行分出上衣、下装、鞋
// - 躯干和两臂之间有描边隔开，按连通块分出袖子
// 要染色的部件转成灰阶，运行时乘玩家选的颜色；眼睛单独一层，虹膜换成棕色。
import { AVATAR, AVATAR_BLOCK, BOTTOM_STYLE, HAIR_STYLE, TOP_STYLE, avatarFrame } from '../shared/social.ts';
import { Pix, loadPix } from './pix.ts';

const { w: FW, h: FH, frames: FRAMES } = AVATAR;
const chibi = (name: string) => loadPix(new URL(`../art/chibi/${name}.png`, import.meta.url));
const BASES = ['base-male', 'base-female'];
/** art/chibi/hair 的行是 上、右、下、左；本项目的朝向是 下、左、右、上 */
const HAIR_ROW = [2, 3, 1, 0];
/** 与 HAIR_STYLE 一一对应：前四种按头型生成，其余取 art/chibi/hair/ */
const HAIR = ['short', 'buzz', 'parted', 'spiky', 'medium', 'tail', 'side-tail', 'twin-braids', 'side-plait', 'curls', 'afro'] as const;
const CUTS = ['short', 'buzz', 'parted', 'spiky'];
const TOPS = ['tshirt', 'long', 'polo'] as const;
const BOTTOMS = ['pants', 'shorts', 'skirt'] as const;

const OUTLINE = 0x613900;
/** 眼睛：虹膜蓝 → 棕，眼白、眉眼线保留 */
const EYE: Record<number, number> = { 0x187791: 0x3c2818, 0x2893bb: 0x6e4a28, 0xd8d8d8: 0xd8d8d8, 0xfafafa: 0xfafafa, 0x3a1400: 0x3a1400 };
/** 底模最亮的肤色，灰阶以它为 255 */
const LUM_MAX = lum(0xffdbb1);
/** 衣服、头发描边的灰度：染色后是同色系的深色 */
const EDGE = 70;

function lum(c: number): number {
  return 0.299 * (c >> 16) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
}
const grayOf = (c: number) => Math.min(255, Math.round((lum(c) / LUM_MAX) * 255));

/** 一帧底模：每格的颜色（-1 透明），加上从轮廓量出的分界 */
class Frame {
  readonly c = new Int32Array(FW * FH).fill(-1);
  chin = 0;
  foot = 0;
  top = 0;
  eyeTop = 0;
  /** 上衣行里的连通块：最大的是躯干，其余是胳膊；值是块号 */
  part = new Int32Array(FW * FH).fill(-1);
  torsoPart = -1;
  partBottom: number[] = [];

  constructor(src: Pix, fx: number, fy: number) {
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const i = ((fy + y) * src.w + fx + x) * 4;
        if (src.data[i + 3]) this.c[y * FW + x] = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2];
      }
    const rows = [...Array(FH).keys()];
    const opaque = (y: number) => rows.filter((x) => this.at(x, y) >= 0);
    this.top = rows.find((y) => opaque(y).length)!;
    this.foot = [...rows].reverse().find((y) => opaque(y).length)!;
    this.chin = rows.find((y) => y >= 12 && opaque(y).length >= 4 && opaque(y).every((x) => this.at(x, y) === OUTLINE))!;
    this.eyeTop = rows.find((y) => y < this.chin && rows.some((x) => this.at(x, y) in EYE)) ?? this.chin - 5;
    // 上衣行里皮肤的四连通块
    let n = 0;
    const sizes: number[] = [];
    for (let y = this.chin + 1; y <= this.chin + 7; y++)
      for (let x = 0; x < FW; x++) {
        if (!this.skin(x, y) || this.part[y * FW + x] >= 0) continue;
        const stack = [[x, y]];
        this.part[y * FW + x] = n;
        sizes[n] = 0;
        this.partBottom[n] = y;
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          sizes[n]++;
          this.partBottom[n] = Math.max(this.partBottom[n], cy);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (ny < this.chin + 1 || ny > this.chin + 7 || !this.skin(nx, ny) || this.part[ny * FW + nx] >= 0) continue;
            this.part[ny * FW + nx] = n;
            stack.push([nx, ny]);
          }
        }
        n++;
      }
    this.torsoPart = sizes.indexOf(Math.max(...sizes));
  }

  at(x: number, y: number): number {
    return x < 0 || y < 0 || x >= FW || y >= FH ? -1 : this.c[y * FW + x];
  }
  skin(x: number, y: number): boolean {
    const c = this.at(x, y);
    return c >= 0 && c !== OUTLINE && !(c in EYE);
  }
  /** 这一行不透明像素的左右界 */
  span(y: number): [number, number] {
    let a: number = FW, b = -1;
    for (let x = 0; x < FW; x++) if (this.at(x, y) >= 0) (a = Math.min(a, x)), (b = Math.max(b, x));
    return [a, b];
  }
}

/** 一组格子（键是 y*FW+x）画成 24×32 的灰阶图，挨着的底模描边画成深色 */
function cloth(f: Frame, cells: Set<number>, rows: [number, number]): Pix {
  const out = new Pix(FW, FH);
  for (const i of cells) out.px(i % FW, Math.floor(i / FW), grayLevel(grayOf(f.c[i])));
  for (let y = rows[0]; y <= rows[1]; y++)
    for (let x = 0; x < FW; x++) {
      if (f.at(x, y) !== OUTLINE) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cells.has((y + dy) * FW + x + dx))) out.px(x, y, grayLevel(EDGE));
    }
  return out;
}
const grayLevel = (v: number) => (v << 16) | (v << 8) | v;

function body(f: Frame): Pix {
  const out = new Pix(FW, FH);
  for (let i = 0; i < f.c.length; i++) if (f.c[i] >= 0 && !(f.c[i] in EYE)) out.px(i % FW, Math.floor(i / FW), grayLevel(grayOf(f.c[i])));
  return out;
}

function eyes(f: Frame): Pix {
  const out = new Pix(FW, FH);
  for (let i = 0; i < f.c.length; i++) if (f.c[i] in EYE) out.px(i % FW, Math.floor(i / FW), EYE[f.c[i]]);
  return out;
}

/** 鞋：脚底往上两行，深灰，上面一行稍亮 */
function feet(f: Frame): Pix {
  const out = new Pix(FW, FH);
  for (let y = f.foot - 2; y < f.foot; y++) for (let x = 0; x < FW; x++) if (f.skin(x, y)) out.px(x, y, y === f.foot - 2 ? 0x5a5460 : 0x3a3440);
  return out;
}

function top(f: Frame, style: (typeof TOPS)[number], dir: number): Pix {
  const cells = new Set<number>();
  for (let y = f.chin + 1; y <= f.chin + 7; y++)
    for (let x = 0; x < FW; x++) {
      const p = f.part[y * FW + x];
      if (p < 0) continue;
      // 短袖到上臂，长袖留出最下面一行的手
      const keep = p === f.torsoPart || (style === 'long' ? y < f.partBottom[p] : y <= f.chin + 3);
      if (keep) cells.add(y * FW + x);
    }
  const out = cloth(f, cells, [f.chin, f.chin + 8]);
  if (style === 'polo') {
    // 翻领：领口一行提亮；正面中间一道门襟
    for (const i of cells) if (Math.floor(i / FW) === f.chin + 1 && f.part[i] === f.torsoPart) out.px(i % FW, f.chin + 1, grayLevel(255));
    if (dir === 0) {
      const [a, b] = f.span(f.chin + 2);
      out.px(Math.floor((a + b) / 2), f.chin + 2, grayLevel(EDGE));
    }
  }
  return out;
}

function bottom(f: Frame, style: (typeof BOTTOMS)[number]): Pix {
  const y0 = f.chin + 8;
  if (style !== 'skirt') {
    const y1 = style === 'pants' ? f.foot - 3 : y0 + 2;
    const cells = new Set<number>();
    for (let y = y0; y <= y1; y++) for (let x = 0; x < FW; x++) if (f.skin(x, y)) cells.add(y * FW + x);
    return cloth(f, cells, [y0, y1 + 1]);
  }
  // 裙子：腰到膝盖，越往下越往两边张开一格，下摆一道深色
  const out = new Pix(FW, FH);
  const y1 = y0 + 3;
  for (let y = y0; y <= y1 + 1; y++) {
    const [a, b] = f.span(Math.min(y, y1));
    const k = Math.max(0, y - y0 - 1);
    for (let x = a - k; x <= b + k; x++) {
      const edge = y > y1 || x === a - k || x === b + k;
      out.px(x, y, grayLevel(edge ? EDGE : f.skin(x, y) ? grayOf(f.c[y * FW + x]) : 200));
    }
  }
  return out;
}

/** 按头型生成的短发：头顶到额头、两鬓、后脑；外圈一道深色 */
function cut(f: Frame, style: string, dir: number): Pix {
  const inHead = (x: number, y: number) => y < f.chin && f.at(x, y) >= 0;
  const mask = new Set<number>();
  for (let y = f.top; y < f.chin; y++) {
    const [a, b] = f.span(y), mid = (a + b) / 2;
    for (let x = a; x <= b; x++) {
      if (!inHead(x, y)) continue;
      const back = dir === 1 ? x >= mid : dir === 2 ? x <= mid : false;
      const fringe = style === 'buzz' ? f.top + 3 : f.eyeTop - 1;
      let on: boolean;
      if (dir === 3) on = y <= f.chin - (style === 'buzz' ? 4 : 3);
      else on = y <= fringe || (back && y <= f.chin - 3) || (dir === 0 && style !== 'buzz' && y <= f.eyeTop + 1 && (x <= a + 1 || x >= b - 1));
      // 中分：额前正中露出一块
      if (style === 'parted' && dir === 0 && y >= f.eyeTop - 2 && y <= fringe && Math.abs(x - mid) < 1) on = false;
      if (on) mask.add(y * FW + x);
    }
  }
  // 头顶蓬起一行；刺猬头再隔一格竖一根
  const [a, b] = f.span(f.top);
  for (let x = a + 1; x < b; x++) mask.add((f.top - 1) * FW + x);
  if (style === 'spiky')
    for (let x = a - 1; x <= b + 1; x += 2) {
      mask.add((f.top - 2) * FW + x);
      if (dir === 1 || dir === 2) mask.add((f.top - 1 + (x % 4 ? 1 : 0)) * FW + (dir === 1 ? b + 1 : a - 1));
    }
  const out = new Pix(FW, FH);
  for (const i of mask) {
    const x = i % FW, y = Math.floor(i / FW);
    const border = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !mask.has((y + dy) * FW + x + dx));
    const v = border ? EDGE : y <= f.top ? 235 : style === 'buzz' && (x + y) % 2 ? 150 : !mask.has((y + 1) * FW + x + 0) || !mask.has((y + 2) * FW + x) ? 150 : 195;
    out.px(x, y, grayLevel(v));
  }
  return out;
}

/** 现成发型转灰阶：按整张图最亮的像素拉满 */
function grayHair(src: Pix): Pix {
  const out = new Pix(src.w, src.h);
  let max = 1;
  for (let i = 0; i < src.data.length; i += 4) if (src.data[i + 3]) max = Math.max(max, lum((src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]));
  for (let i = 0; i < src.data.length; i += 4) {
    if (!src.data[i + 3]) continue;
    const v = Math.min(255, Math.round((lum((src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]) / max) * 255));
    out.data.set([v, v, v, 255], i);
  }
  return out;
}

function crop(src: Pix, x: number, y: number): Pix {
  const out = new Pix(FW, FH);
  for (let j = 0; j < FH; j++) out.data.set(src.data.subarray(((y + j) * src.w + x) * 4, ((y + j) * src.w + x + FW) * 4), j * FW * 4);
  return out;
}

export function drawAvatarSheet(): Pix {
  if (TOPS.length !== TOP_STYLE.length || BOTTOMS.length !== BOTTOM_STYLE.length || HAIR.length !== HAIR_STYLE.length)
    throw new Error('角色部件表和 shared/social.ts 的选项数对不上');
  const sheet = new Pix(FW * FRAMES * AVATAR.columns, FH * AVATAR.rowsPerColumn);
  const put = (block: number, d: number, k: number, pix: Pix) => {
    const n = avatarFrame(block, d, k), per = AVATAR.columns * FRAMES;
    sheet.blit(pix, (n % per) * FW, Math.floor(n / per) * FH);
  };
  const hairSheets = new Map(HAIR.filter((h) => !CUTS.includes(h)).map((h) => [h, grayHair(chibi(`hair/${h}`))]));
  BASES.forEach((name, b) => {
    const src = chibi(name);
    for (let d = 0; d < 4; d++)
      for (let k = 0; k < FRAMES; k++) {
        const f = new Frame(src, k * FW, d * FH);
        put(AVATAR_BLOCK.body + b, d, k, body(f));
        put(AVATAR_BLOCK.eyes + b, d, k, eyes(f));
        put(AVATAR_BLOCK.feet + b, d, k, feet(f));
        TOPS.forEach((s, i) => put(AVATAR_BLOCK.torso + i * 2 + b, d, k, top(f, s, d)));
        BOTTOMS.forEach((s, i) => put(AVATAR_BLOCK.legs + i * 2 + b, d, k, bottom(f, s)));
        // 头发两种体型共用（两个底模的头一样），只按男底模画一次
        if (b === 0)
          HAIR.forEach((h, i) => put(AVATAR_BLOCK.hair + i, d, k, CUTS.includes(h) ? cut(f, h, d) : crop(hairSheets.get(h)!, k * FW, HAIR_ROW[d] * FH)));
      }
  });
  return sheet;
}
