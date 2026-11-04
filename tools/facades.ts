// 楼型：参数化的立面和屋面模板。相似的楼共用一个楼型，单栋楼在 survey.json 里用 tweak 改几个参数，
// 特色构件（外挂楼梯、镂空、花格、玻璃带、柱廊、饰面）用 features 按世界坐标放在某面墙上，门洞和门头按 survey 的 doors 画。
// 尺寸都按米写，画的时候按 1 m = 8 px 换算；一层 30 px（BUILDING.storey）。
import type { DoorModel } from './buildings.ts';
import type { PalKey } from './palette.ts';
import type { Face, Feature } from './survey.ts';
import { BUILDING } from './tiles.ts';

const { storey: STOREY, plinth: PLINTH, parapet: PARAPET } = BUILDING;
const M = 8;

export interface Look {
  /** 墙面三档：暗（勒脚、线脚的阴影）、中（主墙）、亮（压顶、线脚高光） */
  wall: [PalKey, PalKey, PalKey];
  /** 勒脚（首层下沿 0.5 m） */
  base: PalKey;
  /**
   * 窗型：punched 点窗；ribbon 通长带窗（窗下墙是 spandrel）；curtain 玻璃幕墙（竖梃按 bay 分格）；
   * pilaster 壁柱间的竖向窗带（柱宽 = bay − win）；none 实墙
   */
  windows: 'punched' | 'ribbon' | 'curtain' | 'pilaster' | 'none';
  /** 开间、窗宽、窗高、窗台高（米） */
  bay: number;
  win: number;
  winH: number;
  sill: number;
  /** 窗洞一圈的窗套颜色，null 不画 */
  frame: PalKey | null;
  /** 每层楼板处一道横线脚，null 不画 */
  bands: PalKey | null;
  /** ribbon 的窗下墙、pilaster 的窗间墙 */
  spandrel: PalKey | null;
  /** 每开间一个阳台（宿舍、住宅） */
  balcony: boolean;
  /** 女儿墙下一道檐口，null 不画 */
  cornice: PalKey | null;
  /** 首层整排落地窗（食堂、商业、门厅） */
  groundGlass: boolean;
  /** 屋面三档：暗（阴影）、中（屋面）、亮（女儿墙压顶） */
  roof: [PalKey, PalKey, PalKey];
  /** 屋顶小件：equipment 设备箱，solar 成排光伏板，none 素屋面 */
  rooftop: 'equipment' | 'solar' | 'none';
  /** 屋顶楼梯间（凸出屋面的小房子），每 800 m² 屋面一个 */
  penthouse: boolean;
  /** 平屋面的隔热砖分格（米），0 不画 */
  roofGrid: number;
}

const base: Look = {
  wall: ['plain0', 'plain1', 'plain2'], base: 'plain0',
  windows: 'punched', bay: 4, win: 1.5, winH: 2, sill: 0.9,
  frame: null, bands: null, spandrel: null, balcony: false, cornice: null, groundGlass: false,
  roof: ['roof0', 'roof1', 'roof2'], rooftop: 'equipment', penthouse: true, roofGrid: 1,
};

/**
 * 楼型目录。新楼型加在这里，名字写进 survey.json 的 look；每个楼型的依据（哪栋楼的哪张照片）写在注释里。
 * neutral 是没有资料时的中性立面，不要给它加特征。
 */
export const LOOKS: Record<string, Look> = {
  /** 中性立面：没有照片的楼 */
  neutral: { ...base, penthouse: false, roofGrid: 0 },
  /** 红砖楼：清水红砖墙，白窗套，每层一道水泥线脚 */
  brick: { ...base, wall: ['redbrick0', 'redbrick1', 'redbrick2'], base: 'stone0', bay: 3.6, win: 1.5, winH: 1.9, frame: 'tile2', bands: 'stone2', cornice: 'stone2' },
  /** 黄色涂料老楼：黄墙白线脚，高窗，檐口和勒脚明显 */
  ochre: { ...base, wall: ['ochre0', 'ochre1', 'ochre2'], base: 'stone0', bay: 3.6, win: 1.6, winH: 2.2, sill: 0.8, frame: 'tile2', bands: 'tile2', cornice: 'tile2' },
  /** 白瓷砖楼：白色面砖，蓝灰玻璃，点窗 */
  tile: { ...base, wall: ['tile0', 'tile1', 'tile2'], base: 'grey1', bay: 3.6, win: 1.8, winH: 1.9, frame: 'grey2' },
  /** 带窗教学楼：通长的窗带，窗下墙一道浅色 */
  ribbon: { ...base, wall: ['tile0', 'tile1', 'tile2'], base: 'grey1', windows: 'ribbon', bay: 1.5, win: 1.3, winH: 2.1, spandrel: 'grey2', cornice: 'grey2' },
  /** 石材楼：米色石材，壁柱间竖向窗带 */
  stone: { ...base, wall: ['beige1', 'beige2', 'beige3'], base: 'beige0', windows: 'pilaster', bay: 4, win: 2.6, winH: 2.4, sill: 0.6, spandrel: 'beige1', cornice: 'beige3' },
  /** 玻璃幕墙：蓝绿玻璃，铝竖梃 */
  curtain: { ...base, wall: ['grey1', 'grey2', 'grey3'], base: 'grey1', windows: 'curtain', bay: 1.5, win: 1.4, winH: 3.4, sill: 0, cornice: 'grey3', rooftop: 'none', penthouse: false },
  /** 宿舍楼：浅色墙，每间一个阳台 */
  dorm: { ...base, wall: ['tile0', 'tile1', 'tile2'], base: 'grey1', bay: 3.6, win: 1.5, winH: 1.9, balcony: true, rooftop: 'solar', penthouse: true },
  /** 体育馆、大跨度馆：灰色实墙，上部一圈高窗 */
  hall: { ...base, wall: ['grey0', 'grey1', 'grey2'], base: 'grey0', windows: 'ribbon', bay: 2, win: 1.8, winH: 1.5, sill: 2.4, spandrel: null, cornice: 'grey3', rooftop: 'none', penthouse: false, roofGrid: 0 },
  /** 平房、附属用房：灰墙小窗 */
  shed: { ...base, wall: ['grey0', 'grey1', 'grey2'], base: 'grey0', bay: 4, win: 1.2, winH: 1.4, sill: 1.2, rooftop: 'none', penthouse: false, roofGrid: 0 },
};

/** 饰面颜色的三档（feature band 的 color） */
export const RAMPS: Record<string, [PalKey, PalKey, PalKey]> = {
  redbrick: ['redbrick0', 'redbrick1', 'redbrick2'],
  ochre: ['ochre0', 'ochre1', 'ochre2'],
  tile: ['tile0', 'tile1', 'tile2'],
  beige: ['beige1', 'beige2', 'beige3'],
  grey: ['grey0', 'grey1', 'grey2'],
  stone: ['stone0', 'stone1', 'stone2'],
  plain: ['plain0', 'plain1', 'plain2'],
  curtain: ['curtain0', 'curtain1', 'curtain2'],
  brick: ['brick0', 'brick1', 'brick2'],
};

/** 楼型加上单栋微调；名字不在目录里就抛错，免得拼错的楼型悄悄变成中性立面 */
export function lookOf(name: string, tweak: Record<string, unknown> = {}): Look {
  const l = LOOKS[name];
  if (!l) throw new Error(`没有楼型 ${name}（见 tools/facades.ts 的 LOOKS）`);
  return { ...l, ...tweak } as Look;
}

/** 立面上一个像素的位置 */
export interface FacadeAt {
  /** 立面上的 x（视角下的像素） */
  x: number;
  /** 这一段连续立面的左右端（含），窗按这段居中排 */
  run0: number;
  run1: number;
  /** 离地高度（像素，0 = 最下一排） */
  yg: number;
  /** 这段立面的上下界（离地像素） */
  hTop: number;
  hBottom: number;
  face: Face;
  /** 这一列墙脚的世界米坐标 */
  wx: number;
  wy: number;
}

export interface Glass {
  color: PalKey;
  window: string;
  door: boolean;
}
export type FacadePixel = PalKey | Glass;

const glass = (color: PalKey, window: string, door = false): Glass => ({ color, window, door });

/** 窗格：左上亮、右下暗，中间一道横档 */
function pane(xs: number, ys: number, w: number, h: number): PalKey {
  if (xs === 0 || ys === h - 1) return 'glass0';
  if (ys === 0 || xs === w - 1) return 'glass2';
  if (ys === Math.round(h * 0.35)) return 'glass0';
  return xs + ys < 5 ? 'glass2' : 'glass1';
}

/** 按楼型画墙面（不含门和特色构件） */
export function lookFacade(l: Look, a: FacadeAt): FacadePixel {
  const { x, run0, run1, yg, hTop, hBottom } = a;
  const [w0, w1, w2] = l.wall;
  if (hBottom === 0 && yg < PLINTH) return yg === PLINTH - 1 ? w0 : l.base;
  if (yg >= hTop - PARAPET) return yg === hTop - 1 ? w2 : w1;
  if (l.cornice && yg >= hTop - PARAPET - 3) return yg === hTop - PARAPET - 1 ? l.cornice : yg === hTop - PARAPET - 3 ? w0 : l.cornice;
  const ys = (yg - PLINTH) % STOREY, storey = Math.floor((yg - PLINTH) / STOREY);
  if (l.bands && ys < 2 && storey > 0) return ys === 0 ? w0 : l.bands;
  const len = run1 - run0 + 1, u = x - run0;
  const win0 = Math.round(l.sill * M), win1 = Math.min(STOREY - 2, win0 + Math.round(l.winH * M));
  // 首层落地窗
  if (l.groundGlass && storey === 0 && ys >= 2 && ys < STOREY - 4 && u >= 4 && u < len - 4) {
    const k = Math.floor((u - 4) / 12);
    if ((u - 4) % 12 === 0) return 'grey2';
    return glass(ys === 2 ? 'glass0' : (u - 4) % 12 < 3 ? 'glass2' : 'glass1', `gg:${run0}:${k}`);
  }
  if (l.windows === 'none') return w1;
  if (l.windows === 'curtain') {
    const bay = Math.round(l.bay * M);
    if (u < 2 || u >= len - 2) return w1;
    const xs = (u - 2) % bay;
    if (xs === 0) return 'grey3';
    if (ys < 2) return ys === 0 ? 'grey1' : 'grey3';
    return glass(xs === 1 || ys === 2 ? 'curtain2' : (xs + ys) % 11 === 0 ? 'curtain2' : ys > STOREY - 6 ? 'curtain0' : 'curtain1', `cw:${run0}:${Math.floor((u - 2) / bay)}:${storey}`);
  }
  if (l.windows === 'ribbon') {
    if (u < 6 || u >= len - 6) return w1;
    if (ys >= win0 && ys < win1) {
      const bay = Math.round(l.bay * M), xs = (u - 6) % bay;
      if (xs === 0) return 'grey3';
      return glass(pane(xs, win1 - 1 - ys, bay, win1 - win0), `rb:${run0}:${Math.floor((u - 6) / bay)}:${storey}`);
    }
    if (l.spandrel && ys >= win0 - 6 && ys < win0) return ys === win0 - 1 ? w0 : l.spandrel;
    return w1;
  }
  // 点窗和壁柱：窗按这段立面居中排，两端至少留半个开间的实墙
  const bay = Math.round(l.bay * M), ww = Math.round(l.win * M);
  const n = Math.max(0, Math.floor((len - bay / 2) / bay));
  if (!n) return w1;
  const off = Math.floor((len - n * bay) / 2), k = Math.floor((u - off) / bay), xs = u - off - k * bay;
  const inBay = u >= off && k < n;
  const x0 = Math.floor((bay - ww) / 2);
  if (l.windows === 'pilaster') {
    if (!inBay) return w1;
    if (xs < x0 || xs >= x0 + ww) return xs === x0 - 1 ? w0 : xs === x0 + ww ? w2 : w1;
    if (ys >= win0 && ys < win1) return glass(pane(xs - x0, win1 - 1 - ys, ww, win1 - win0), `pl:${run0}:${k}:${storey}`);
    return l.spandrel ?? w0;
  }
  if (!inBay) return w1;
  // 阳台：窗下 1.1 m 高的栏板，比墙亮一档，底下一道阴影
  if (l.balcony && ys >= win0 - 9 + 4 && ys < win0 + 4 && xs >= x0 - 4 && xs < x0 + ww + 4 && storey > 0) {
    if (ys === win0 - 5) return w0;
    return xs === x0 - 4 || xs === x0 + ww + 3 ? w1 : w2;
  }
  if (xs >= x0 && xs < x0 + ww && ys >= win0 && ys < win1) return glass(pane(xs - x0, win1 - 1 - ys, ww, win1 - win0), `pw:${run0}:${k}:${storey}`);
  if (l.frame && xs >= x0 - 1 && xs <= x0 + ww && ys >= win0 - 1 && ys <= win1) return l.frame;
  if (ys === win0 - 1 && xs >= x0 - 1 && xs <= x0 + ww) return w0;
  return w1;
}

/** 世界点落在某面墙的哪一段：返回沿墙的位置 u（像素，从 from 起）和整段长度；不在这段墙上返回 null */
export function onWall(face: Face, from: [number, number], to: [number, number], wx: number, wy: number, slack = 2): { u: number; len: number } | null {
  const dx = to[0] - from[0], dy = to[1] - from[1], l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const t = ((wx - from[0]) * dx + (wy - from[1]) * dy) / l2;
  if (t < 0 || t > 1) return null;
  const px = from[0] + t * dx, py = from[1] + t * dy;
  if (Math.hypot(wx - px, wy - py) > slack) return null;
  void face;
  const len = Math.sqrt(l2) * M;
  return { u: t * len, len };
}

/** 特色构件在这个像素上的颜色；不归它管返回 null（照常画墙） */
export function featurePixel(l: Look, f: Feature, k: number, a: FacadeAt, under: FacadePixel): FacadePixel | null {
  if (f.face !== a.face) return null;
  const on = onWall(f.face, f.from, f.to, a.wx, a.wy);
  if (!on) return null;
  const { yg, hTop } = a;
  const [s0, s1] = f.storeys ?? [0, 99];
  const bottom = s0 === 0 ? 0 : PLINTH + s0 * STOREY, top = Math.min(hTop - PARAPET, PLINTH + (s1 + 1) * STOREY);
  if (yg < bottom || yg >= top) return null;
  const u = Math.floor(on.u), len = Math.floor(on.len);
  const ys = (yg - PLINTH + STOREY) % STOREY, storey = Math.floor((yg - PLINTH) / STOREY);
  const [w0, w1, w2] = l.wall;
  switch (f.kind) {
    case 'stair': {
      // 一层一折：偶数层从左下到右上，奇数层反过来；梯段是斜的梁和踏步，上面一道栏杆，层间一块平台
      if (yg < PLINTH) return null;
      const t = storey % 2 ? 1 - u / len : u / len, line = t * (STOREY - 4) + 2;
      if (ys < 2) return ys === 0 ? 'grey0' : 'grey2';
      if (Math.abs(ys - line) < 1.5) return 'grey1';
      if (ys > line - 4 && ys < line - 1.5) return 'grey0';
      if (Math.abs(ys - (line + 8)) < 0.6) return 'grey3';
      if (ys > line && ys < line + 8 && u % 4 === 0) return 'grey2';
      return null;
    }
    case 'void': {
      // 两边各留 0.4 m 的柱，顶上一道梁，里面是暗的；每层楼板露出一道边
      if (u < 3 || u >= len - 3) return u === 0 || u === len - 1 ? w0 : w2;
      if (yg >= top - 3) return yg === top - 3 ? w0 : w1;
      if (ys < 2 && yg >= PLINTH) return ys === 0 ? 'stone0' : 'stone1';
      return yg >= top - 6 || u < 5 ? 'ink' : 'shadow';
    }
    case 'screen': {
      const p = Math.max(4, Math.round((f.pitch ?? 1) * M));
      if (u % p < 2 || (yg - bottom) % p < 2) return (u % p === 0 || (yg - bottom) % p === 0) ? w2 : w1;
      return typeof under === 'object' ? { ...under, color: 'glass0' } : 'slate';
    }
    case 'glass': {
      if (u < 2 || u >= len - 2) return w0;
      if (ys < 2) return 'grey3';
      return glass(u % 8 === 0 ? 'grey3' : ys < 4 ? 'curtain2' : u % 8 < 3 ? 'curtain2' : 'curtain1', `fg:${k}:${storey}`);
    }
    case 'colonnade': {
      const p = Math.max(16, Math.round((f.pitch ?? 4) * M)), c = u % p;
      if (yg >= top - 4) return yg === top - 4 ? w0 : yg === top - 1 ? w2 : w1;
      if (c < 5) return c === 0 ? w2 : c === 4 ? w0 : w1;
      return yg < 2 ? 'stone1' : 'shadow';
    }
    case 'band': {
      const ramp = RAMPS[f.color ?? ''];
      if (!ramp || typeof under === 'object') return null;
      const i = l.wall.indexOf(under);
      return i >= 0 ? ramp[i] : null;
    }
  }
}

/** 门洞和门头；不在门上返回 null */
export function doorPixel(l: Look, doors: DoorModel[], a: FacadeAt): FacadePixel | null {
  if (a.hBottom !== 0) return null;
  for (const [k, d] of doors.entries()) {
    if (d.facing !== a.face) continue;
    const main = d.main ?? false;
    const width = (d.width ?? (main ? 3 : 1.8)) * M, height = Math.round((d.height ?? 2.6) * M);
    const canopy = d.canopy ?? (main ? 'slab' : 'none');
    const along = a.face === 'N' || a.face === 'S' ? a.wx - d.at[0] : a.wy - d.at[1];
    const perp = a.face === 'N' || a.face === 'S' ? a.wy - d.at[1] : a.wx - d.at[0];
    if (Math.abs(perp) > 1.5) continue;
    const u = along * M, yg = a.yg;
    const half = width / 2, wide = half + (canopy === 'none' ? 0 : canopy === 'portico' ? 10 : 6);
    if (Math.abs(u) >= wide) continue;
    // 门头：雨棚板挑在门洞上方 0.5 m；门廊再加两根柱子，板高到二层窗下
    const slab = canopy === 'portico' ? Math.min(a.hTop - PARAPET - 4, height + 14) : height + 4;
    if (canopy !== 'none') {
      if (yg >= slab && yg < slab + 4) return yg === slab + 3 ? 'stone3' : yg === slab ? 'shadow' : 'stone1';
      if (canopy === 'portico' && yg < slab && Math.abs(u) >= wide - 4) return Math.abs(u) >= wide - 1 ? 'stone0' : Math.abs(u) >= wide - 2 ? 'stone1' : 'stone3';
    }
    if (Math.abs(u) < half && yg < height) {
      if (Math.abs(u) >= half - 1 || yg === height - 1) return 'slate';
      // 两扇玻璃门，中缝和横档是门框色
      if (Math.abs(u) < 0.6) return 'slate';
      return glass(yg === height - 2 || yg === Math.round(height * 0.45) ? 'glass0' : (Math.abs(u) + yg) % 7 === 0 ? 'glass2' : 'glass1', `door:${k}`, true);
    }
    // 门两侧和上方一圈门套
    if (Math.abs(u) < half + 2 && yg < height + 2 && yg >= PLINTH - 1) return l.frame ?? 'stone2';
    if (canopy === 'portico' && yg < slab && Math.abs(u) < wide) return yg < PLINTH ? 'stone1' : 'shadow';
  }
  return null;
}
