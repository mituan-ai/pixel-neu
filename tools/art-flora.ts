// 树木像素画：冠形参考 S53–S59，脚底锚点与比例取自 shared/flora.ts。
import { SPECIES, treeFrame, type Season } from '../shared/flora.ts';
import { TILE, METERS_PER_TILE } from '../shared/world.ts';
import type { PalKey } from './palette.ts';
import { Pix, rng, type Sprite as PropArt } from './pix.ts';

const PPM = TILE / METERS_PER_TILE;

/** 树木的画布与冠心。 */
function canvas(id: string, R: number, variant: number) {
  const tree = SPECIES.find((t) => t.id === id)!;
  const r = Math.round(R * PPM), ax = r + 4, ay = Math.round(R * tree.height * PPM) + 3;
  const pix = new Pix(2 * r + 9, ay + 3);
  const rand = rng(701 + SPECIES.indexOf(tree) * 97 + Math.floor(variant / 2) * 139);
  const side = variant % 2 ? -1 : 1;
  return { pix, ax, ay, r, cy: ay - R * tree.crown * PPM, rand, side };
}
type Crown = ReturnType<typeof canvas>;

/** 主干和分枝。 */
function branch(a: Crown, x0: number, y0: number, x1: number, y1: number, width = 1): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(a.ax + (x0 + (x1 - x0) * k / n) * a.side), y = Math.round(y0 + (y1 - y0) * k / n);
    a.pix.rect(x - Math.floor(width / 2), y, width, 1, 'trunk');
    if (width > 1) a.pix.px(x - Math.floor(width / 2), y, 'brick0');
  }
}

/** 左上亮、右下暗的叶团。 */
function leaves(a: Crown, x: number, y: number, rx: number, ry: number, s: Season, autumn: 'yellow' | 'orange' | 'red' = 'yellow'): void {
  const colors: PalKey[] = s === 'spring' ? ['bud0', 'bud1', 'bud2'] : s === 'autumn'
    ? autumn === 'red' ? ['autumnRed0', 'autumnRed1', 'autumnRed2'] : autumn === 'orange' ? ['autumnOrange0', 'autumnOrange1', 'autumnOrange2'] : ['autumnGold0', 'autumnGold1', 'autumnGold2']
    : ['leaf0', 'leaf1', 'leaf2'];
  const cx = Math.round(a.ax + x * a.side), cy = Math.round(y), w = Math.round(rx), h = Math.round(ry);
  for (let v = -h; v <= h; v++) for (let u = -w; u <= w; u++) {
    if (u * u / (w * w + 0.5) + v * v / (h * h + 0.5) > 1) continue;
    const light = u / w + v / h + (cx - a.ax) / a.r * 0.5;
    a.pix.px(cx + u, cy + v, colors[light < -0.45 ? 2 : light < 0.65 ? 1 : 0]);
  }
  if (s === 'autumn' && Math.abs(cx * 13 + cy * 7) % 19 < 3) a.pix.ellipse(cx, cy, 2, 1, 'leaf1');
}

/** 杨树：上举分枝的高瘦冠。 */
function poplar(R: number, variant: number, s: Season): PropArt {
  const a = canvas('poplar', R, variant), { r, ay, cy, rand } = a;
  branch(a, 0, ay, -r * 0.06, 5, 3);
  for (let k = 0; k < 13; k++) {
    const t = k / 12, y = 7 + t * (ay - r * 0.8 - 7), side = k % 2 ? -1 : 1;
    const x = side * r * Math.sin(Math.PI * (0.08 + t * 0.84)) * (0.58 + rand() * 0.24) + (variant < 2 ? -0.08 : 0.08) * r;
    const width = r * (0.22 + rand() * 0.1);
    branch(a, 0, y + r * 0.5, x, y, 2);
    branch(a, x * 0.65, y + r * 0.18, x + side * 2, y - r * 0.2);
    if (s !== 'winter') leaves(a, x * 0.72, Math.max(r * 0.42 + 3, y + r * 0.12), width, r * 0.42, s);
    else a.pix.px(a.ax + Math.round(x * a.side), Math.round(y - r * 0.2), 'plain0');
  }
  if (s !== 'winter') leaves(a, -r * 0.06, cy - r * 1.7, r * 0.22, r * 0.35, s);
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 柳树：拱枝与垂下的细枝。 */
function willow(R: number, variant: number, s: Season): PropArt {
  const a = canvas('willow', R, variant), { r, ay, cy, rand } = a;
  branch(a, 0, ay, r * 0.1, cy + r * 0.2, 4);
  for (let k = 0; k < 11; k++) {
    const x = (k / 10 * 1.7 - 0.85) * r + (rand() - 0.5) * r * 0.22;
    const y = cy - r * (0.8 - Math.abs(x / r) * 0.5) + rand() * r * 0.18;
    branch(a, r * 0.1, cy + r * 0.3, x * 0.75, y, 2);
    branch(a, x * 0.75, y, x, y + r * (0.9 + rand() * 0.5));
    if (s !== 'winter') {
      leaves(a, x * 0.7, y + r * 0.15, r * 0.26, r * 0.36, s);
      for (let j = 0; j < 4; j++) leaves(a, x, y + r * (0.35 + j * 0.3), r * 0.11, r * 0.22, s);
    }
  }
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 榆树：分叉主干与不规则圆冠。 */
function elm(R: number, variant: number, s: Season): PropArt {
  const a = canvas('elm', R, variant), { r, ay, cy, rand } = a;
  branch(a, 0, ay, -r * 0.08, cy + r * 0.3, 4);
  const tips: [number, number][] = [];
  for (let k = 0; k < 9; k++) {
    const angle = Math.PI * (0.12 + k / 8 * 1.76 + (rand() - 0.5) * 0.1), d = 0.55 + rand() * 0.27;
    const x = Math.cos(angle) * r * d, y = cy + Math.sin(angle) * r * d * 0.85;
    branch(a, -r * 0.08, cy + r * 0.4, x * 0.6, y + 4, 2);
    branch(a, x * 0.6, y + 4, x, y);
    branch(a, x * 0.6, y + 4, x - 3, y - 4);
    tips.push([x, y]);
  }
  if (s !== 'winter') {
    leaves(a, -2, cy, r * 0.72, r * 0.65, s, 'orange');
    for (const [x, y] of tips) leaves(a, x, y, r * (0.23 + rand() * 0.07), r * 0.24, s, 'orange');
  }
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 银杏：上窄下宽的卵形冠与扇形叶簇。 */
function ginkgo(R: number, variant: number, s: Season): PropArt {
  const a = canvas('ginkgo', R, variant), { r, ay, cy, rand } = a;
  branch(a, 0, ay, r * 0.06, 5, 3);
  for (let k = 0; k < 15; k++) {
    const t = k / 14, side = k % 2 ? -1 : 1;
    const x = side * r * Math.sin(t * Math.PI * 0.9) * (0.48 + rand() * 0.28);
    const y = r * 0.34 + 3 + t * r * 2.4;
    branch(a, 0, y + r * 0.42, x, y, 2);
    branch(a, x * 0.6, y + r * 0.17, x + side * 3, y - 3);
    if (s !== 'winter') {
      leaves(a, x * 0.7, y, r * 0.3, r * 0.34, s);
      leaves(a, x, y - 2, r * 0.2, r * 0.14, s);
    }
  }
  if (s !== 'winter') leaves(a, 0, cy, r * 0.55, r * 0.6, s);
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 紫丁香：低矮的多干灌丛。 */
function lilac(R: number, variant: number, s: Season): PropArt {
  const a = canvas('lilac', R, variant), { r, ay, cy, rand } = a;
  for (let k = 0; k < 7; k++) {
    const x = (k / 6 * 1.5 - 0.75) * r, y = cy - Math.sin(k / 6 * Math.PI) * r * 0.45 + rand() * 2;
    branch(a, (rand() - 0.5) * r * 0.5, ay, x, y, 1);
    branch(a, x * 0.7, y + r * 0.4, x + 2, y - 2);
    if (s !== 'winter') leaves(a, x, y, r * 0.27, r * 0.38, s, 'red');
  }
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 油松：平展的伞冠与疏开的枝层。 */
function pine(R: number, variant: number, _s: Season): PropArt {
  const a = canvas('pine', R, variant), { r, ay, cy, rand } = a;
  branch(a, 0, ay, -r * 0.12, 6, 4);
  for (let k = 0; k < 4; k++) {
    const y = 8 + k * r * 0.48 + (rand() - 0.5) * r * 0.16, half = r * (0.55 + k * 0.09);
    branch(a, 0, cy + r * 0.35, -half * 0.8, y + 3, 2);
    branch(a, 0, cy + r * 0.35, half * 0.8, y + 3, 2);
    for (let j = 0; j < 5; j++) {
      if (k === 1 && j === (variant < 2 ? 0 : 4)) continue;
      const x = (j / 4 * 2 - 1) * half + (rand() - 0.5) * r * 0.18, yy = y + Math.abs(x) * 0.12;
      const cx = Math.round(a.ax + x * a.side), sy = Math.round(yy), rx = Math.round(r * 0.22), ry = Math.round(r * 0.16);
      a.pix.ellipse(cx, sy, rx, ry, 'pine0');
      a.pix.ellipse(cx - 1, sy - 1, rx - 1, Math.max(1, ry - 1), 'pine1');
      a.pix.hline(cx - rx + 1, sy - ry + 1, rx, 'pine2');
    }
  }
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 红皮云杉：枝层分明的窄塔冠。 */
function spruce(R: number, variant: number, _s: Season): PropArt {
  const a = canvas('spruce', R, variant), { r, ay, rand } = a;
  branch(a, 0, ay, 0, 4, 3);
  for (let k = 6; k >= 0; k--) {
    const base = r * 0.7 + 4 + k * r * 0.5, ht = r * (0.7 + k * 0.04), half = r * (0.15 + k * 0.12);
    const off = ((rand() - 0.5) * r * 0.16 + (variant < 2 ? -1 : 1) * k * 0.35) * a.side;
    for (let y = 0; y < ht; y++) {
      const w = Math.round(half * (y + 1) / ht * (0.92 + rand() * 0.08));
      for (let x = -w; x <= w; x++) a.pix.px(a.ax + off + x, base - ht + y, x < -w / 3 ? 'pine2' : x > w / 3 ? 'pine0' : 'pine1');
    }
  }
  a.pix.outline('ink');
  return { pix: a.pix, ax: a.ax, ay };
}

/** 全部树种、尺寸、变体和季节的贴图。 */
export function drawFlora(): Record<string, PropArt> {
  const draw: Record<string, (R: number, variant: number, s: Season) => PropArt> = { pine, spruce, poplar, willow, elm, ginkgo, lilac };
  const out: Record<string, PropArt> = {};
  for (const t of SPECIES) for (const r of t.sizes) for (let v = 0; v < t.variants; v++)
    for (const s of t.evergreen ? ['summer'] as const : ['spring', 'summer', 'autumn', 'winter'] as const) out[treeFrame(t.id, r, v, s)] = draw[t.id](r / 10, v, s);
  return out;
}
