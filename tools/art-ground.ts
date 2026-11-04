// 地面材质的花样：每种材质四张 64×64 的小样，烘焙地面时按世界像素坐标平铺（每 8 m 一格按位置挑一张，打散重复感）。
// 加新材质：在 MATS 里加名字，在 PATTERNS 里画出小样。
import type { PalKey } from './palette.ts';
import { Pix, rng } from './pix.ts';

/** 地面材质；数组下标就是地面栅格里存的编号 */
export const MATS = ['outside', 'grass', 'wood', 'paving', 'asphalt', 'parking', 'water', 'hedge', 'flower', 'track', 'pitch', 'pitch2', 'court', 'floor', 'plaza', 'sidewalk', 'slab', 'permeable', 'dirt'] as const;
export type Mat = (typeof MATS)[number];
export const MAT = Object.fromEntries(MATS.map((m, i) => [m, i])) as Record<Mat, number>;

/** 人能走的材质 */
export const WALKABLE = new Set<number>(['grass', 'wood', 'paving', 'asphalt', 'parking', 'track', 'pitch', 'pitch2', 'court', 'plaza', 'sidewalk', 'slab', 'permeable', 'dirt'].map((m) => MAT[m as Mat]));
/** 草地、林地挨着这些材质时画一道路缘 */
export const PAVED = new Set<number>(['paving', 'asphalt', 'parking', 'outside', 'floor', 'track', 'court', 'plaza', 'sidewalk', 'slab', 'permeable'].map((m) => MAT[m as Mat]));
/** 铺装挨着这些材质时画路沿石 */
export const ROAD = new Set<number>(['asphalt', 'parking'].map((m) => MAT[m as Mat]));

const T = 64;
/** 每米像素 */
const PPM = 8;

function noise(p: Pix, seed: number, base: PalKey, dots: [PalKey, number][]): Pix {
  const r = rng(seed);
  p.rect(0, 0, T, T, base);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
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
  return p;
}

function grass(i: number): Pix {
  const p = noise(new Pix(T, T), 10 + i, 'grass1', [['grass2', 0.004], ['grass0', 0.002]]);
  const r = rng(1000 + i);
  for (let k = 0; k < 4 + i; k++) {
    const x = (r() * (T - 1)) | 0, y = (r() * (T - 2)) | 0;
    p.px(x, y, 'grass3'), p.px(x, y + 1, 'grass0');
  }
  if (i === 3) {
    p.px(23, 38, 'flowerW'), p.px(25, 39, 'flowerY'), p.px(24, 41, 'flowerP');
  }
  return p;
}

/** 默认铺装：1 m 见方的石板 */
function paving(dark: boolean): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y += PPM)
    for (let x = 0; x < T; x += PPM) {
      p.rect(x, y, PPM, PPM, dark && x === 0 && y === 0 ? 'pave1' : 'pave2');
      p.hline(x, y, PPM, 'pave1'), p.vline(x, y, PPM, 'pave1');
    }
  return p;
}

function water(): Pix {
  const p = noise(new Pix(T, T), 31, 'water1', [['water0', 0.015]]);
  const r = rng(1011);
  for (let k = 0; k < 5; k++) p.hline((r() * (T - 4)) | 0, (r() * T) | 0, 4, 'water2');
  return p;
}

/** 花坛：绿叶里点红花 */
function flower(): Pix {
  const p = new Pix(T, T), r = rng(1012);
  p.rect(0, 0, T, T, 'leaf1');
  for (let k = 0; k < 90; k++) p.px((r() * T) | 0, (r() * T) | 0, k % 4 ? 'flowerR' : 'flowerP');
  return p;
}

/** 林下地面：落叶和裸土斑 */
function woodFloor(i: number): Pix {
  const p = noise(new Pix(T, T), 60 + i, 'grass0', [['leaf1', 0.004], ['leaf0', 0.003]]);
  const r = rng(3000 + i);
  for (let k = 0; k < 3; k++) {
    const x = 4 + ((r() * (T - 12)) | 0), y = 4 + ((r() * (T - 12)) | 0);
    p.ellipse(x, y, 2 + ((r() * 3) | 0), 1 + ((r() * 2) | 0), 'dirt0');
    p.hline(x + 2, y + 3, 2, k % 2 ? 'ochre0' : 'brick2');
  }
  return p;
}

/** 停车场底面：车位线按 stalls 画 */
function parking(): Pix {
  return noise(new Pix(T, T), 24, 'asph1', [['asph0', 0.006], ['asph2', 0.004]]);
}

const solid = (c: PalKey) => {
  const p = new Pix(T, T);
  p.rect(0, 0, T, T, c);
  return p;
};

/** 大块广场砖、人行道砖和错缝石板 */
function bricks(i: number, kind: 'plaza' | 'sidewalk' | 'slab'): Pix {
  const p = new Pix(T, T), r = rng(4000 + i);
  const [w, h] = kind === 'plaza' ? [16, 16] : kind === 'sidewalk' ? [4, 2] : [16, 8];
  for (let y = 0; y < T; y += h)
    for (let x = kind === 'plaza' || (y / h) % 2 === 0 ? 0 : -w / 2; x < T; x += w) {
      const c = kind === 'sidewalk' ? (r() < 0.35 ? 'brick1' : 'pave1') : (x === i * w && y === 0 || r() < 0.035 ? 'pave1' : 'pave2');
      p.rect(x, y, w, h, c);
      p.hline(x, y, w, 'pave0'), p.vline(x, y, h, 'pave0');
    }
  return p;
}

/** 彩色透水砖的颗粒面 */
function permeable(i: number): Pix {
  const p = noise(new Pix(T, T), 5000 + i, 'brick1', [['brick0', 0.018], ['brick2', 0.012]]);
  for (let y = 0; y < T; y += 4) {
    p.hline(0, y, T, 'brick0');
    for (let x = (y / 4) % 2 ? 4 : 0; x < T; x += 8) p.vline(x, y, 4, 'brick0');
  }
  return p;
}

/** 每种材质的小样 */
export const PATTERNS: Record<Mat, Pix[]> = {
  outside: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 34 + i, 'slate', [['ink', 0.002]])),
  grass: [0, 1, 2, 3].map(grass),
  wood: [0, 1, 2, 3].map(woodFloor),
  paving: [0, 1, 2, 3].map((i) => {
    const p = paving(i === 3);
    p.rect((i + 1) * PPM + 1, 1, PPM - 1, PPM - 1, 'pave1');
    return p;
  }),
  asphalt: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 20 + i, 'asph1', [['asph0', 0.006], ['asph2', 0.004]])),
  parking: [0, 1, 2, 3].map((i) => {
    const p = parking();
    p.hline(5 + i * 13, 42, 2, 'asph2');
    return p;
  }),
  water: [0, 1, 2, 3].map((i) => {
    const p = water();
    p.hline(4 + i * 13, 23, 4, 'water2');
    return p;
  }),
  hedge: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 33 + i, 'hedge', [['leaf2', 0.025], ['leaf0', 0.015]])),
  flower: [0, 1, 2, 3].map((i) => {
    const p = flower();
    p.px(3 + i * 13, 31, 'flowerY');
    return p;
  }),
  track: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 80 + i, 'track1', [['track0', 0.012]])),
  pitch: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 154 + i, 'grass1', [['grass0', 0.003]])),
  pitch2: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 158 + i, 'grass2', [['grass0', 0.003]])),
  court: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 86 + i, 'court1', [['court0', 0.006]])),
  floor: [0, 1, 2, 3].map((i) => {
    const p = solid('pave0');
    p.px(3 + i * 13, 41, 'pave1');
    return p;
  }),
  plaza: [0, 1, 2, 3].map((i) => bricks(i, 'plaza')),
  sidewalk: [0, 1, 2, 3].map((i) => bricks(i, 'sidewalk')),
  slab: [0, 1, 2, 3].map((i) => bricks(i, 'slab')),
  permeable: [0, 1, 2, 3].map(permeable),
  dirt: [0, 1, 2, 3].map((i) => noise(new Pix(T, T), 6000 + i, 'dirt1', [['dirt0', 0.008], ['pave0', 0.003]])),
};
