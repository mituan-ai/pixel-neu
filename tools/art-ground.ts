// 地面材质的花样：每种材质几张 16×16 的小样，烘焙地面时按世界像素坐标平铺（每 2 m 一格按位置挑一张，打散重复感）。
// 加新材质：在 MATS 里加名字，在 PATTERNS 里画出小样。
import type { PalKey } from './palette.ts';
import { Pix, rng } from './pix.ts';

/** 地面材质；数组下标就是地面栅格里存的编号 */
export const MATS = ['outside', 'grass', 'wood', 'paving', 'asphalt', 'parking', 'water', 'hedge', 'flower', 'track', 'pitch', 'pitch2', 'court', 'floor'] as const;
export type Mat = (typeof MATS)[number];
export const MAT = Object.fromEntries(MATS.map((m, i) => [m, i])) as Record<Mat, number>;

/** 人能走的材质 */
export const WALKABLE = new Set<number>(['grass', 'wood', 'paving', 'asphalt', 'parking', 'track', 'pitch', 'pitch2', 'court'].map((m) => MAT[m as Mat]));
/** 草地、林地挨着这些材质时画一道路缘 */
export const PAVED = new Set<number>(['paving', 'asphalt', 'parking', 'outside', 'floor', 'track', 'court'].map((m) => MAT[m as Mat]));
/** 铺装挨着这些材质时画路沿石 */
export const ROAD = new Set<number>(['asphalt', 'parking'].map((m) => MAT[m as Mat]));

const T = 16;
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
  const p = noise(new Pix(T, T), 10 + i, 'grass1', [['grass2', 0.03], ['grass0', 0.015]]);
  // 草叶：两像素高的小竖笔，只在少数小样上
  const r = rng(1000 + i);
  for (let k = 0; k < i - 1; k++) {
    const x = (r() * 15) | 0, y = 1 + ((r() * 14) | 0);
    p.px(x, y, 'grass3'), p.px(x, y + 1, 'grass0');
  }
  return p;
}

/** 1 m 见方的石板，缝用深一档；少数石板颜色略深 */
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
  const p = noise(new Pix(T, T), 31, 'water1', [['water0', 0.12]]);
  const r = rng(1011);
  for (let k = 0; k < 3; k++) p.hline((r() * 10) | 0, (r() * 15) | 0, 4, 'water2');
  return p;
}

/** 花坛：绿叶里点红花 */
function flower(): Pix {
  const p = new Pix(T, T);
  const r = rng(1012);
  p.rect(0, 0, T, T, 'leaf1');
  for (let k = 0; k < 18; k++) p.px(2 + ((r() * 12) | 0), 2 + ((r() * 12) | 0), k % 4 ? 'flowerR' : 'flowerP');
  return p;
}

/** 林下地面：树荫里的深色草 */
function woodFloor(i: number): Pix {
  const p = noise(new Pix(T, T), 60 + i, 'grass0', [['leaf1', 0.04], ['leaf0', 0.03]]);
  if (i) p.px(5, 9, 'grass1'), p.px(5, 10, 'leaf0');
  return p;
}

/** 停车场：每 2 m 一道 1 像素宽的车位线（约 12 cm）；成排的车位另用 stalls 画标线 */
function parking(): Pix {
  const p = noise(new Pix(T, T), 24, 'asph1', [['asph0', 0.1], ['asph2', 0.06]]);
  p.vline(0, 0, T, 'paint');
  return p;
}

const solid = (c: PalKey) => {
  const p = new Pix(T, T);
  p.rect(0, 0, T, T, c);
  return p;
};

/** 每种材质的小样 */
export const PATTERNS: Record<Mat, Pix[]> = {
  // 校外和还没描过的地方：深灰色块，一眼看出不能进入
  outside: [noise(new Pix(T, T), 34, 'slate', [['ink', 0.04]])],
  grass: [0, 0, 0, 1, 1, 2, 3].map(grass),
  wood: [0, 0, 1].map(woodFloor),
  paving: [false, false, true].map(paving),
  asphalt: [4, 4, 5].map((i) => noise(new Pix(T, T), 20 + i, 'asph1', [['asph0', 0.1], ['asph2', 0.06]])),
  parking: [parking()],
  water: [water()],
  hedge: [noise(new Pix(T, T), 33, 'hedge', [['leaf2', 0.2], ['leaf0', 0.1]])],
  flower: [flower()],
  // 塑胶跑道：红色颗粒面
  track: [72, 73].map((i) => noise(new Pix(T, T), 80 + i, 'track1', [['track0', 0.12]])),
  // 人工草：割草条纹的浅、深两色，按场地生成器分的条带取
  pitch: [noise(new Pix(T, T), 154, 'grass1', [['grass0', 0.03]])],
  pitch2: [noise(new Pix(T, T), 155, 'grass2', [['grass0', 0.03]])],
  court: [noise(new Pix(T, T), 86, 'court1', [['court0', 0.06]])],
  floor: [solid('pave0')],
};
