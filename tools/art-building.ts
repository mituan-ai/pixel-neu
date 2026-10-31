// 建筑：按地图里的占地掩码和高度图做 3/4 俯视挤出——每格画屋顶（上移自身高度），
// 前面没有同高的格子就往下画立面。从后排往前排画，前排自然盖住后排。
// 立面花样按 style 区分；新地标在 STYLES 里加一种，再在 map.ts 的 NAMED 里指定。
import { TILE } from '../shared/world.ts';
import type { PalKey } from './palette.ts';
import { Pix, rng } from './pix.ts';
import { BUILDING } from './tiles.ts';

const { storey: STOREY, plinth: PLINTH, parapet: PARAPET, shadow: SHADOW } = BUILDING;

export interface BuildingSpec {
  sprite: string;
  style: string;
  mask: string;
  levels: string;
  top: number;
}

interface FacadeCtx {
  /** 立面上的 x（像素，相对建筑左缘） */
  x: number;
  /** 离地高度（像素，0 = 最下一排） */
  yg: number;
  /** 这段立面所属格子的高度级别 */
  level: number;
  /** 这段立面的上下界（离地像素） */
  hTop: number;
  hBottom: number;
  /** 建筑中轴的 x（像素），对称构图用 */
  axis: number;
}

interface Style {
  roof: [PalKey, PalKey, PalKey];
  facade(c: FacadeCtx): PalKey;
}

/** 一层里窗的上下范围（离本层地面的像素）：窗台在 WIN0-1，窗顶高光在 WIN1 */
const WIN0 = 4, WIN1 = 13;

/** 普通楼：浅色墙面、规则的窗 */
const plain: Style = {
  roof: ['roof0', 'roof1', 'roof2'],
  facade({ x, yg, hTop, hBottom }) {
    if (hBottom === 0 && yg < PLINTH) return 'plain0';
    if (yg >= hTop - PARAPET) return yg === hTop - 1 ? 'plain2' : 'plain1';
    const ys = (yg - PLINTH) % STOREY, xs = x % 8;
    if (ys >= WIN0 && ys <= WIN1 && xs >= 2 && xs <= 5) return ys === WIN1 ? 'glass2' : xs === 2 ? 'glass0' : 'glass1';
    if (ys === WIN0 - 1 && xs >= 2 && xs <= 5) return 'plain1';
    return 'plain2';
  },
};

/** 信息学馆：两翼为规则的竖窗，中段与塔楼为贯通的深色竖向窗带（石材为主，不是玻璃幕墙）；首层中轴是正门 */
const info: Style = {
  roof: ['roof0', 'roof1', 'roof2'],
  facade({ x, yg, level, hTop, hBottom, axis }) {
    const dx = Math.abs(x - axis);
    if (hBottom === 0 && dx < 14 && yg < 30) {
      // 正门：门廊立柱 + 深色大门，上方一道檐
      if (yg >= 26) return yg === 29 ? 'beige3' : 'beige1';
      if (yg < 3) return yg === 2 ? 'stone2' : 'stone1';
      return dx % 5 === 0 ? 'beige3' : dx % 5 === 1 ? 'beige2' : yg > 20 ? 'glass1' : 'glass0';
    }
    if (hBottom === 0 && yg < PLINTH) return 'beige0';
    if (yg >= hTop - PARAPET) return yg === hTop - 1 ? 'beige3' : 'beige2';
    const ys = (yg - PLINTH) % STOREY, xs = x % 6;
    if (level >= 2) {
      if (xs >= 2 && xs <= 3) return ys <= 1 ? 'beige1' : ys === WIN1 + 2 ? 'glass1' : 'glass0';
      return xs === 0 ? 'beige3' : 'beige2';
    }
    if (ys >= WIN0 && ys <= WIN1 && xs >= 2 && xs <= 3) return ys === WIN1 ? 'glass1' : 'glass0';
    if (ys === WIN0 - 1 && xs >= 1 && xs <= 4) return 'beige1';
    return 'beige2';
  },
};

/** 宁恩承图书馆：密排的浅色壁柱，柱间是贯通的深色窗带，顶上一道檐口 */
const library: Style = {
  roof: ['roof0', 'roof1', 'roof2'],
  facade({ x, yg, hTop, hBottom }) {
    if (hBottom === 0 && yg < PLINTH) return 'grey0';
    if (yg >= hTop - PARAPET - 2) return yg === hTop - 1 ? 'grey3' : yg === hTop - PARAPET - 2 ? 'grey1' : 'grey3';
    const ys = (yg - PLINTH) % STOREY, xs = x % 6;
    if (xs === 0) return 'grey3';
    if (xs === 1) return 'grey2';
    if (ys <= 1) return 'grey1';
    return ys === WIN1 + 2 ? 'glass1' : 'glass0';
  },
};

const STYLES: Record<string, Style> = { plain, info, library };

export function drawBuilding(spec: BuildingSpec): Pix {
  const rows = spec.mask.split('/');
  const levels = spec.levels.split(',').map(Number);
  const nr = rows.length, nc = rows[0].length;
  const style = STYLES[spec.style] ?? plain;
  const top = spec.top;
  const pix = new Pix(nc * TILE + SHADOW, nr * TILE + top);
  const lv = (c: number, r: number) => (r < 0 || c < 0 || r >= nr || c >= nc ? 0 : Number(rows[r][c]));
  const h = (c: number, r: number) => levels[lv(c, r)] ?? 0;
  const groundY = (r: number) => top + (r + 1) * TILE; // 第 r 排格子下缘在图里的 y
  const rand = rng(Number(spec.sprite.replace(/\D/g, '')) || 7);

  // 中轴：取最前一排（屏幕最下方）占地的中点
  let axis = (nc * TILE) / 2;
  for (let r = nr - 1; r >= 0; r--) {
    const cs = [...rows[r]].map((ch, c) => (ch !== '0' ? c : -1)).filter((c) => c >= 0);
    if (cs.length) {
      axis = ((cs[0] + cs[cs.length - 1] + 1) * TILE) / 2;
      break;
    }
  }

  // 地面投影：光从左上来，影子落在右侧
  for (let r = 0; r < nr; r++)
    for (let c = 0; c < nc; c++)
      if (lv(c, r) && !lv(c + 1, r)) pix.rect((c + 1) * TILE, groundY(r) - TILE, SHADOW, TILE, 'shadow', 70);

  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const hh = h(c, r);
      if (!hh) continue;
      const x0 = c * TILE;
      const roofY = groundY(r) - TILE - hh;
      // 屋顶：内部带一点颗粒，四周与不同高度交界处画女儿墙
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          // 大平顶上每 32 像素一道分格缝，避免一整块死板的灰
          const seam = (x0 + x) % 32 === 0 || (r * TILE + y) % 32 === 0;
          let col: PalKey = seam || rand() < 0.05 ? style.roof[0] : style.roof[1];
          if (y === 0 && h(c, r - 1) !== hh) col = style.roof[2];
          if (x === 0 && h(c - 1, r) !== hh) col = style.roof[2];
          if (x === TILE - 1 && h(c + 1, r) !== hh) col = style.roof[0];
          if (y === TILE - 1 && h(c, r + 1) !== hh) col = style.roof[2];
          pix.px(x0 + x, roofY + y, col);
        }
      // 立面：前面那格更矮时，画出两者高度差那一段
      const front = h(c, r + 1);
      if (front >= hh) continue;
      for (let yg = front; yg < hh; yg++)
        for (let x = 0; x < TILE; x++) {
          const fx = x0 + x;
          let col: PalKey = style.facade({ x: fx, yg, level: lv(c, r), hTop: hh, hBottom: front, axis });
          // 立面左右端：左亮右暗，体积感
          if (x === 0 && h(c - 1, r + 1) < yg + 1 && h(c - 1, r) < yg + 1 && !lv(c - 1, r)) col = shade(col, +1);
          if (x === TILE - 1 && !lv(c + 1, r)) col = shade(col, -1);
          pix.px(fx, groundY(r) - 1 - yg, col);
        }
    }
    // 小楼顶上随机放几台设备箱，打破大片平顶
    if (spec.style === 'plain')
      for (let c = 0; c < nc; c++)
        if (lv(c, r) && lv(c, r - 1) && lv(c, r + 1) && rand() < 0.04) {
          const x = c * TILE + 4, y = groundY(r) - TILE - h(c, r) + 5;
          pix.rect(x, y, 7, 4, 'roof2');
          pix.rect(x, y + 4, 7, 2, 'roof0');
        }
  }

  if (spec.style === 'info') drawInfoCrown(pix, rows, levels, top);
  return pix;
}

const SHADES: PalKey[][] = [
  ['beige0', 'beige1', 'beige2', 'beige3'],
  ['grey0', 'grey1', 'grey2', 'grey3'],
  ['plain0', 'plain1', 'plain2'],
  ['glass0', 'glass1', 'glass2'],
];
function shade(c: PalKey, d: number): PalKey {
  for (const ramp of SHADES) {
    const i = ramp.indexOf(c);
    if (i >= 0) return ramp[Math.max(0, Math.min(ramp.length - 1, i + d))];
  }
  return c;
}

/** 信息学馆塔顶：塔楼屋顶上再退两级，顶上是小亭和旗杆（据北门方向照片） */
function drawInfoCrown(pix: Pix, rows: string[], levels: number[], top: number): void {
  const towerLv = levels.length - 1;
  let bottom = -1;
  rows.forEach((row, r) => {
    if (row.includes(String(towerLv))) bottom = r;
  });
  if (bottom < 0) return;
  // 塔楼最前一排的左右范围
  const front = rows[bottom];
  const tx0 = front.indexOf(String(towerLv)) * TILE, tx1 = (front.lastIndexOf(String(towerLv)) + 1) * TILE;
  const axis = (tx0 + tx1) / 2, tw = tx1 - tx0;
  const towerRoofFront = top + (bottom + 1) * TILE - levels[towerLv];
  // 三级退台：宽度按塔身比例收，最上一级是小亭（据照片）
  const tiers = [
    { w: Math.round(tw * 0.72), fh: STOREY * 2, d: 10 },
    { w: Math.round(tw * 0.5), fh: Math.round(STOREY * 1.5), d: 8 },
    { w: Math.round(tw * 0.28), fh: STOREY, d: 5 },
  ];
  let base = towerRoofFront - 8;
  tiers.forEach((t, k) => {
    const x0 = Math.round(axis - t.w / 2);
    for (let y = 0; y < t.fh; y++)
      for (let x = 0; x < t.w; x++) {
        const xs = x % 4;
        let col: PalKey = y < 2 ? 'beige3' : xs === 1 || xs === 2 ? (y === 2 ? 'glass2' : 'glass1') : 'beige2';
        if (k === 2) col = y < 2 ? 'beige3' : xs === 0 ? 'beige2' : 'glass0';
        if (x === t.w - 1) col = shade(col, -1);
        if (x === 0) col = shade(col, +1);
        pix.px(x0 + x, base - t.fh + y, col);
      }
    // 这一级的屋顶
    pix.rect(x0, base - t.fh - t.d, t.w, t.d, 'beige1');
    pix.hline(x0, base - t.fh - t.d, t.w, 'beige3');
    base = base - t.fh - Math.floor(t.d / 2);
  });
  // 小亭的尖顶与旗杆
  for (let k = 0; k < 4; k++) pix.hline(Math.round(axis - 4 + k), base - 2 - k, 8 - 2 * k, k === 0 ? 'beige1' : 'beige0');
  pix.vline(Math.round(axis), base - 18, 13, 'stone0');
  pix.rect(Math.round(axis) + 1, base - 18, 5, 3, 'flag');
}
