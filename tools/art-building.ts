// 建筑：按地图里的占地掩码和高度图做 3/4 俯视挤出——每格画屋顶（上移自身高度），
// 前面没有同高的格子就往下画立面。从后排往前排画，前排自然盖住后排。
// 每个视角各画一张：掩码先转到视角下，屏幕朝下的那一面是哪个地理朝向，就用哪个朝向的立面。
// 立面和屋顶花样按 style 区分；新地标在 STYLES 里加一种，再在 map.ts 的 NAMED 里指定。
// 有照片依据的立面放在 art/facades/<style>-<朝向>.png（正立面图，1 m = 8 px），按图取色；其余朝向用程序立面。
import { existsSync } from 'node:fs';
import { FACING, fromView, rotateGrid, viewSize, type View } from '../shared/view.ts';
import { TILE } from '../shared/world.ts';
import type { PalKey } from './palette.ts';
import { Pix, loadPix, rng } from './pix.ts';
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
  /** 这面立面的地理朝向 */
  face: (typeof FACING)[number];
  /** 离地高度（像素，0 = 最下一排） */
  yg: number;
  /** 这段立面所属格子的高度级别 */
  level: number;
  /** 这段立面的上下界（离地像素） */
  hTop: number;
  hBottom: number;
  /** 楼的中轴在立面上的 x（像素）：信息学馆取中央楼正中，其他楼取占地正中 */
  axis: number;
}

interface RoofCtx {
  /** 屋顶平面上的像素坐标（相对建筑左上角） */
  x: number;
  y: number;
  /** 在占地外接矩形里的相对位置 0–1 */
  fx: number;
  fy: number;
  /** 离这块屋顶边缘的像素数 */
  inset: number;
  level: number;
}

interface Style {
  facade(c: FacadeCtx): PalKey;
  /** 屋顶上的构件；返回 null 画素屋面 */
  roof?(c: RoofCtx): PalKey | null;
}

// 立面尺寸按 1 m = 8 px 换算
/** 一层里窗的上下范围（离本层地面的像素）：窗台 0.9 m，窗高 2 m */
const WIN0 = 7, WIN1 = 23;

/** 窗格：外框深一档，左上亮、右下暗，中间一道横档 */
function pane(xs: number, ys: number, w: number, h: number): PalKey {
  if (xs === 0 || ys === h - 1) return 'glass0';
  if (ys === 0 || xs === w - 1) return 'glass2';
  if (ys === Math.round(h * 0.35)) return 'glass0';
  return xs + ys < 5 ? 'glass2' : 'glass1';
}

/** 普通楼：浅色墙面，每 4 m 一扇 1.5 m 宽的窗 */
const plain: Style = {
  facade({ x, yg, hTop, hBottom }) {
    if (hBottom === 0 && yg < PLINTH) return 'plain0';
    if (yg >= hTop - PARAPET) return yg === hTop - 1 ? 'plain2' : 'plain1';
    const ys = (yg - PLINTH) % STOREY, xs = x % 32;
    if (ys >= WIN0 && ys < WIN1 && xs >= 10 && xs < 22) return pane(xs - 10, WIN1 - 1 - ys, 12, WIN1 - WIN0);
    if (ys === WIN0 - 1 && xs >= 9 && xs < 23) return 'plain1';
    return 'plain2';
  },
};

/**
 * 信息学馆：米色石材（据航拍 R-info-06-02、正面照 R-info-01）。
 * - 两翼：每 4 m 一扇约 2 m 见方的窗，首层上沿一道腰线
 * - 中央楼北面：中间三列通高窗带，每层窗下一段砖红窗下墙；两侧实墙各一列小方窗；首层前是六柱门廊，三樘大门
 * - 中央楼其他三面没有照片，按两翼的窗画
 */
const info: Style = {
  facade({ x, yg, level, face, hTop, hBottom, axis }) {
    if (hBottom === 0 && yg < PLINTH) return yg === PLINTH - 1 ? 'beige1' : 'beige0';
    if (yg >= hTop - PARAPET) return yg === hTop - 1 ? 'beige3' : 'beige2';
    const ys = (yg - PLINTH) % STOREY, storey = Math.floor((yg - PLINTH) / STOREY);
    const rel = x - axis;
    if (level === 2 && face === 'N') {
      // 门廊：宽约 20.5 m、高两层，挑檐下是成对或单根的柱子，柱间深色门洞里三樘门
      if (Math.abs(rel) < 82 && yg < PLINTH + 2 * STOREY) {
        if (yg >= PLINTH + 2 * STOREY - 6) return yg === PLINTH + 2 * STOREY - 1 ? 'beige3' : yg === PLINTH + 2 * STOREY - 6 ? 'beige1' : 'beige2';
        const col = [-80, -72, -26, 22, 68, 76].find((c) => rel >= c && rel < c + 4);
        if (col !== undefined) return rel === col ? 'beige3' : rel === col + 3 ? 'beige1' : 'beige2';
        const door = [-49, 0, 49].find((c) => Math.abs(rel - c) < 12);
        if (door !== undefined && yg < PLINTH + 24) return Math.abs(rel - door) === 11 || yg === PLINTH + 23 ? 'glass0' : pane(rel - door + 11, PLINTH + 23 - yg, 22, 24);
        return 'slate';
      }
      const bay = [-38, 0, 38].find((c) => Math.abs(rel - c) < 11);
      if (bay !== undefined && storey >= 2) {
        if (ys < 8) return ys === 0 ? 'brick0' : 'brick1';
        return ys >= STOREY - 2 ? 'beige1' : pane(rel - bay + 11, STOREY - 3 - ys, 22, STOREY - 10);
      }
      const small = Math.abs(Math.abs(rel) - 76) < 4;
      if (small && ys >= 12 && ys < 20) return ys === 12 ? 'glass0' : 'glass1';
      return Math.abs(rel) === 50 ? 'beige1' : Math.abs(rel) === 49 ? 'beige3' : 'beige2';
    }
    if (storey === 1 && ys < 2) return ys ? 'beige1' : 'beige3';
    const xs = (((rel - 16) % 32) + 32) % 32;
    if (ys >= WIN0 && ys < WIN1 && xs >= 8 && xs < 24) return pane(xs - 8, WIN1 - 1 - ys, 16, WIN1 - WIN0);
    if (ys === WIN0 - 1 && xs >= 7 && xs < 25) return 'beige1';
    return xs === 0 ? 'beige3' : 'beige2';
  },
  // 两翼屋顶上一排排东西向的深色设备条，约 1 m 宽、每 2.5 m 一道（据卫星图 S7；航拍 R-info-06-02 上是成排的支架）
  roof({ x, y, inset, level }) {
    if (level !== 1 || inset < 10) return null;
    const ys = y % 20;
    if (ys >= 8 || x % 96 < 4) return null;
    return ys === 0 ? 'asph2' : ys === 7 ? 'shadow' : 'asph1';
  },
};

/** 宁恩承图书馆屋顶上的四个天井和中央玻璃金字塔（据卫星图 S7，按占地比例量取） */
const ATRIA: [number, number, number, number][] = [
  [0.13, 0.34, 0.37, 0.46],
  [0.65, 0.34, 0.88, 0.46],
  [0.13, 0.65, 0.37, 0.78],
  [0.65, 0.65, 0.88, 0.78],
];
const PYRAMID = [0.45, 0.48, 0.57, 0.63];

/** 宁恩承图书馆：每 1.5 m 一根浅色壁柱，柱间是贯通的深色窗带，顶上一道檐口 */
const library: Style = {
  facade({ x, yg, hTop, hBottom }) {
    if (hBottom === 0 && yg < PLINTH) return 'grey0';
    if (yg >= hTop - PARAPET - 3) return yg === hTop - 1 ? 'grey3' : yg === hTop - PARAPET - 3 ? 'grey1' : 'grey3';
    const ys = (yg - PLINTH) % STOREY, xs = x % 12;
    if (xs < 2) return xs === 0 ? 'grey3' : 'grey2';
    if (ys < 4) return ys === 3 ? 'grey2' : 'grey1';
    return pane(xs - 2, STOREY - 1 - ys, 10, STOREY - 4);
  },
  roof({ fx, fy, x, y }) {
    for (const [x0, y0, x1, y1] of ATRIA) {
      if (fx < x0 || fx >= x1 || fy < y0 || fy >= y1) continue;
      // 天井：下沉的深色玻璃顶；北沿和西沿落着女儿墙的影子
      const u = fx - x0, v = fy - y0;
      if (u < 0.006 || v < 0.008) return 'roof2';
      if (u < 0.02 || v < 0.03) return 'ink';
      return (x + y) % 6 === 0 ? 'glass0' : 'slate';
    }
    const [px0, py0, px1, py1] = PYRAMID;
    if (fx >= px0 && fx < px1 && fy >= py0 && fy < py1) {
      // 四坡玻璃金字塔：西坡、北坡迎光
      const u = ((fx - px0) / (px1 - px0)) * 2 - 1, v = ((fy - py0) / (py1 - py0)) * 2 - 1;
      if (Math.max(Math.abs(u), Math.abs(v)) > 0.92) return 'grey3';
      if (Math.abs(Math.abs(u) - Math.abs(v)) < 0.06) return 'grey2';
      const face: PalKey = Math.abs(u) > Math.abs(v) ? (u < 0 ? 'glass2' : 'glass0') : v < 0 ? 'glass2' : 'glass1';
      return x % 4 === 0 || y % 4 === 0 ? 'glass0' : face;
    }
    return null;
  },
};

const STYLES: Record<string, Style> = { plain, info, library };

/** 屋顶平面上每个像素离同高屋面边缘的距离（棋盘距离，最多算到 cap） */
function insetMap(w: number, h: number, height: (x: number, y: number) => number, cap: number): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = height(x, y);
      const same = (xx: number, yy: number) => height(xx, yy) === v;
      d[y * w + x] = v && same(x - 1, y) && same(x + 1, y) && same(x, y - 1) && same(x, y + 1) ? cap : 0;
    }
  // 两遍扫描的距离变换
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) m = Math.min(m, d[i - w] + 1, x > 0 ? d[i - w - 1] + 1 : cap, x < w - 1 ? d[i - w + 1] + 1 : cap);
      d[i] = m;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
      if (y < h - 1) m = Math.min(m, d[i + w] + 1, x < w - 1 ? d[i + w + 1] + 1 : cap, x > 0 ? d[i + w - 1] + 1 : cap);
      d[i] = m;
    }
  return d;
}

/** 立面图：按朝向缓存，没有就是 null */
const elevations = new Map<string, Pix | null>();
function elevation(style: string, face: string): Pix | null {
  const key = `${style}-${face}`;
  if (!elevations.has(key)) {
    const url = new URL(`../art/facades/${key}.png`, import.meta.url);
    elevations.set(key, existsSync(url) ? loadPix(url) : null);
  }
  return elevations.get(key)!;
}

export function drawBuilding(spec: BuildingSpec, view: View = 0): Pix {
  const world = spec.mask.split('/');
  const rows = rotateGrid(view, world.map((r) => [...r])).map((r) => r.join(''));
  const levels = spec.levels.split(',').map(Number);
  const nr = rows.length, nc = rows[0].length;
  const face = FACING[view];
  const elev = elevation(spec.style, face);
  const style = STYLES[spec.style] ?? plain;
  const top = spec.top;
  const pix = new Pix(nc * TILE + SHADOW, nr * TILE + top);
  const lv = (c: number, r: number) => (r < 0 || c < 0 || r >= nr || c >= nc ? 0 : Number(rows[r][c]));
  const h = (c: number, r: number) => levels[lv(c, r)] ?? 0;
  const groundY = (r: number) => top + (r + 1) * TILE; // 第 r 排格子下缘在图里的 y
  const rand = rng(Number(spec.sprite.replace(/\D/g, '')) || 7);
  const W = nc * TILE, H = nr * TILE;
  const worldSize = viewSize(view, W, H);
  /** 视角下屋顶平面的像素 → 世界朝向下的像素（屋顶花样按世界方向排） */
  const toWorldPx = (x: number, y: number) => fromView(view, worldSize.w, worldSize.h, x + 0.5, y + 0.5);
  // 中轴：信息学馆取最高一级（中央楼）最前一排的正中，其他楼取占地正中
  const topLv = String(levels.length - 1);
  const axisRow = [...rows].reverse().find((row) => row.includes(topLv)) ?? '';
  const axis = spec.style === 'info' && axisRow ? ((axisRow.indexOf(topLv) + axisRow.lastIndexOf(topLv) + 1) * TILE) / 2 : W / 2;
  const inset = insetMap(W, H, (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : h(Math.floor(x / TILE), Math.floor(y / TILE))), 255);

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
      // 屋顶：女儿墙压顶一圈亮色，内侧一道阴影；北边和西边的女儿墙把影子投到屋面上
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const gx = x0 + x, gy = r * TILE + y;
          const d = inset[gy * W + gx];
          let col: PalKey;
          if (d < 2) col = 'roof2';
          else if (d === 2) col = 'roof0';
          else {
            const wp = toWorldPx(gx, gy);
            col = style.roof?.({ x: Math.floor(wp.x), y: Math.floor(wp.y), fx: wp.x / worldSize.w, fy: wp.y / worldSize.h, inset: d, level: lv(c, r) }) ?? (rand() < 0.04 ? 'roof0' : 'roof1');
            const shadowed = inset[(gy - 2) * W + gx] < 2 || inset[gy * W + gx - 2] < 2;
            if (shadowed && col === 'roof1') col = 'roof0';
          }
          pix.px(gx, roofY + y, col);
        }
      // 立面：前面那格更矮时，画出两者高度差那一段
      const front = h(c, r + 1);
      if (front >= hh) continue;
      for (let yg = front; yg < hh; yg++)
        for (let x = 0; x < TILE; x++) {
          const fx = x0 + x;
          // 有立面图就按图取色（图和占地按中线对齐）；女儿墙仍用程序画，和屋顶接得上
          if (elev && yg < hh - PARAPET) {
            const ex = fx - Math.round(W / 2) + Math.round(elev.w / 2), ey = elev.h - 1 - yg;
            const k = (ey * elev.w + ex) * 4;
            if (ex >= 0 && ex < elev.w && ey >= 0 && elev.data[k + 3] > 0) {
              pix.px(fx, groundY(r) - 1 - yg, (elev.data[k] << 16) | (elev.data[k + 1] << 8) | elev.data[k + 2]);
              continue;
            }
          }
          let col: PalKey = style.facade({ x: fx, yg, face, level: lv(c, r), hTop: hh, hBottom: front, axis });
          // 立面左右端：左亮右暗，体积感
          if (x === 0 && h(c - 1, r + 1) < yg + 1 && h(c - 1, r) < yg + 1 && !lv(c - 1, r)) col = shade(col, +1);
          if (x === TILE - 1 && !lv(c + 1, r)) col = shade(col, -1);
          pix.px(fx, groundY(r) - 1 - yg, col);
        }
    }
    // 素屋面上随机放几台设备箱，打破大片平顶
    for (let c = 0; c < nc; c++) {
      const x = c * TILE, gy = r * TILE;
      if (!lv(c, r) || inset[(gy + 8) * W + x + 8] < 14 || rand() > 0.015) continue;
      const wp = toWorldPx(x + 8, gy + 8);
      if (style.roof?.({ x: Math.floor(wp.x), y: Math.floor(wp.y), fx: wp.x / worldSize.w, fy: wp.y / worldSize.h, inset: 99, level: lv(c, r) })) continue;
      const y = groundY(r) - TILE - h(c, r);
      pix.rect(x + 2, y + 2, 12, 7, 'roof2');
      pix.rect(x + 2, y + 9, 12, 3, 'roof0');
    }
  }

  if (spec.style === 'info') drawInfoCrown(pix, rows, levels, top, face);
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

/**
 * 信息学馆塔顶（据北面照片 R-info-01）：塔身上退一级，约 1.3 层高、宽约塔身六成，开三扇大窗；
 * 再往上是宽约塔身四分之一的小塔，约 2.3 层高，北面中间一块砖红色饰面，顶上一圈檐、一根旗杆。
 * 砖红饰面只有北面有照片，其他朝向画成素面
 */
function drawInfoCrown(pix: Pix, rows: string[], levels: number[], top: number, face: string): void {
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
  /** 画一个方塔体：底边在 base，正面高 fh，顶面进深 d；body 给正面每个像素取色 */
  const block = (w: number, fh: number, d: number, base: number, body: (x: number, y: number) => PalKey) => {
    const x0 = Math.round(axis - w / 2);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < w; x++) {
        let col = body(x, y);
        if (x === 0) col = shade(col, +1);
        if (x === w - 1) col = shade(col, -1);
        pix.px(x0 + x, base - fh + y, col);
      }
    pix.rect(x0, base - fh - d, w, d, 'beige1');
    pix.hline(x0, base - fh - d, w, 'beige3');
    pix.vline(x0, base - fh - d, d, 'beige3');
    return base - fh - Math.floor(d / 2);
  };
  // 退台：檐口 3 px，下面三扇大窗
  const w1 = Math.round(tw * 0.58), fh1 = Math.round(STOREY * 1.3);
  let base = towerRoofFront - 10;
  base = block(w1, fh1, 14, base, (x, y) => {
    if (y < 3) return y === 2 ? 'beige1' : 'beige3';
    const bay = w1 / 3, xs = x % bay;
    if (y >= 9 && y < fh1 - 5 && xs >= 4 && xs < bay - 4) return pane(Math.floor(xs - 4), fh1 - 6 - y, Math.floor(bay - 8), fh1 - 14);
    return 'beige2';
  });
  // 小塔：顶上一层小窗，中间砖红饰面
  const w2 = Math.round(tw * 0.26), fh2 = Math.round(STOREY * 2.3);
  base = block(w2, fh2, 10, base, (x, y) => {
    if (y < 3) return y === 2 ? 'beige1' : 'beige3';
    if (y >= 6 && y < 14 && x % 6 >= 2 && x % 6 < 5) return 'glass0';
    if (face === 'N' && y >= 24 && y < fh2 - 6 && x >= Math.round(w2 * 0.25) && x < Math.round(w2 * 0.75)) return y % 4 === 0 ? 'brick0' : 'brick1';
    return 'beige2';
  });
  // 旗杆与旗
  pix.rect(Math.round(axis), base - 34, 1, 34, 'stone0');
  pix.rect(Math.round(axis) + 1, base - 34, 10, 6, 'flag');
}
