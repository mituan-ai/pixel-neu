// 建筑：按楼基像素和每个像素的屋面高度（buildings.ts）做 3/4 俯视挤出——每个像素画屋顶（上移自身高度），
// 前面那个像素更矮就往下画立面。从后排往前排画，前排自然盖住后排；斜墙、弧墙按像素自然成形。
// 每个视角各画一张：楼基先转到视角下，屏幕朝下的那一面是哪个地理朝向，就用哪个朝向的立面。
// 一般的楼按楼型画（tools/facades.ts 的 LOOKS，survey.json 里给每栋楼指定），再叠特色构件和门；
// 信息学馆、图书馆这样的地标有专门的 style（STYLES，在 buildings.ts 的 NAMED 里指定）。
// 有照片依据的立面放在 art/facades/<style>-<朝向>.png（正立面图，1 m = 8 px），按图取色；其余朝向用程序立面。
import { existsSync } from 'node:fs';
import { FACING, fromView, toView, viewSize, type View } from '../shared/view.ts';
import { heights, lifts, type BuildingModel, type PartModel } from './buildings.ts';
import { EXTENT } from './geo.ts';
import { doorPixel, featurePixel, lookFacade, lookOf, RAMPS, type Look } from './facades.ts';
import { PPM } from './shape.ts';
import { PAL, type Color, type PalKey } from './palette.ts';
import { Pix, loadPix, rng } from './pix.ts';
import { BUILDING } from './tiles.ts';

const { storey: STOREY, plinth: PLINTH, parapet: PARAPET } = BUILDING;

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

interface GlassPixel {
  color: PalKey;
  window: string;
  door: boolean;
}
type FacadePixel = PalKey | GlassPixel;
type Paint = (x: number, y: number, c: Color | GlassPixel, group?: string) => void;

interface Style {
  facade(c: FacadeCtx): FacadePixel;
  /** 屋顶上的构件；返回 null 画素屋面 */
  roof?(c: RoofCtx): PalKey | null;
}

// 立面尺寸按 1 m = 8 px 换算
/** 一层里窗的上下范围（离本层地面的像素）：窗台 0.9 m，窗高 2 m */
const WIN0 = 7, WIN1 = 23;

/** 玻璃取色和窗格编号一起返回，门洞始终亮灯。 */
function glass(color: PalKey, window: string, door = false): GlassPixel {
  return { color, window, door };
}

/** 同一窗格共用亮灯状态，非玻璃像素在蒙版里清空。 */
function buildingPainter(pix: Pix, light: boolean, seed: number): { paint: Paint; finish: () => void } {
  if (!light) return { paint: (x, y, c) => pix.px(x, y, typeof c === 'object' ? c.color : c), finish: () => {} };
  const cells = new Int32Array(pix.w * pix.h), windows = new Map<string, number>();
  const parent = [0], doors = new Set<number>();
  const root = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  };
  const paint: Paint = (x, y, c, group = '') => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= pix.w || y >= pix.h) return;
    const i = y * pix.w + x;
    cells[i] = 0;
    if (typeof c !== 'object') return;
    const key = `${group}:${c.window}`;
    if (!windows.has(key)) {
      windows.set(key, parent.length);
      parent.push(parent.length);
    }
    const id = windows.get(key)!;
    cells[i] = id;
    if (c.door) doors.add(id);
  };
  return { paint, finish: () => {
    for (let y = 0; y < pix.h; y++)
      for (let x = 0; x < pix.w; x++) {
        const i = y * pix.w + x;
        if (!cells[i]) continue;
        for (const j of [x + 1 < pix.w ? i + 1 : i, y + 1 < pix.h ? i + pix.w : i]) {
          if (cells[j]) parent[root(cells[j])] = root(cells[i]);
        }
      }
    const doorRoots = new Set([...doors].map(root)), colors = new Map<number, PalKey | null>(), rand = rng(seed);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      const id = root(cells[i]);
      if (!colors.has(id)) colors.set(id, doorRoots.has(id) ? 'flowerY' : rand() < 0.6 ? (rand() < 1 / 3 ? 'gold' : 'flowerY') : null);
      const color = colors.get(id)!;
      if (color) pix.px(i % pix.w, Math.floor(i / pix.w), color);
    }
  } };
}

/** 屋面和塔顶的矩形也按同一遮挡顺序清空蒙版。 */
function paintRect(paint: Paint, x: number, y: number, w: number, h: number, c: Color): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) paint(x + i, y + j, c);
}

/** 窗格：外框深一档，左上亮、右下暗，中间一道横档 */
function pane(xs: number, ys: number, w: number, h: number): PalKey {
  if (xs === 0 || ys === h - 1) return 'glass0';
  if (ys === 0 || xs === w - 1) return 'glass2';
  if (ys === Math.round(h * 0.35)) return 'glass0';
  return xs + ys < 5 ? 'glass2' : 'glass1';
}

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
        if (door !== undefined && yg < PLINTH + 24) return glass(Math.abs(rel - door) === 11 || yg === PLINTH + 23 ? 'glass0' : pane(rel - door + 11, PLINTH + 23 - yg, 22, 24), `door:${door}`, true);
        return 'slate';
      }
      const bay = [-38, 0, 38].find((c) => Math.abs(rel - c) < 11);
      if (bay !== undefined && storey >= 2) {
        if (ys < 8) return ys === 0 ? 'brick0' : 'brick1';
        return ys >= STOREY - 2 ? 'beige1' : glass(pane(rel - bay + 11, STOREY - 3 - ys, 22, STOREY - 10), `bay:${bay}:${storey}`);
      }
      const small = Math.abs(Math.abs(rel) - 76) < 4;
      if (small && ys >= 12 && ys < 20) return glass(ys === 12 ? 'glass0' : 'glass1', `small:${Math.sign(rel)}:${storey}`);
      return Math.abs(rel) === 50 ? 'beige1' : Math.abs(rel) === 49 ? 'beige3' : 'beige2';
    }
    if (storey === 1 && ys < 2) return ys ? 'beige1' : 'beige3';
    const xs = (((rel - 16) % 32) + 32) % 32;
    if (ys >= WIN0 && ys < WIN1 && xs >= 8 && xs < 24) return glass(pane(xs - 8, WIN1 - 1 - ys, 16, WIN1 - WIN0), `info:${Math.floor((rel - 16) / 32)}:${storey}`);
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
    return glass(pane(xs - 2, STOREY - 1 - ys, 10, STOREY - 4), `library:${Math.floor(x / 12)}:${Math.floor((yg - PLINTH) / STOREY)}`);
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

const STYLES: Record<string, Style> = { info, library };

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

const GLASS = ['glass0', 'glass1', 'glass2'] as const;
const elevationPanes = new Map<Pix, { cells: Int32Array; doors: Set<number> }>();

/** 手绘立面在取色前按玻璃连通窗格分组，library-S 最低的玻璃排是三樘门。 */
function elevationWindows(pix: Pix): { cells: Int32Array; doors: Set<number> } {
  if (!elevationPanes.has(pix)) {
    const cells = new Int32Array(pix.w * pix.h), doors = new Set<number>();
    const isGlass = (i: number) => pix.data[i * 4 + 3] && GLASS.some((c) => PAL[c] === ((pix.data[i * 4] << 16) | (pix.data[i * 4 + 1] << 8) | pix.data[i * 4 + 2]));
    let count = 0, bottom = -1;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] || !isGlass(i)) continue;
      const queue = [i], id = ++count;
      cells[i] = id;
      for (let k = 0; k < queue.length; k++) {
        const j = queue[k], x = j % pix.w, y = Math.floor(j / pix.w);
        bottom = Math.max(bottom, y);
        for (const n of [x > 0 ? j - 1 : -1, x < pix.w - 1 ? j + 1 : -1, j - pix.w, j + pix.w]) {
          if (n < 0 || n >= cells.length || cells[n] || !isGlass(n)) continue;
          cells[n] = id;
          queue.push(n);
        }
      }
    }
    for (let x = 0; x < pix.w; x++) if (cells[bottom * pix.w + x]) doors.add(cells[bottom * pix.w + x]);
    elevationPanes.set(pix, { cells, doors });
  }
  return elevationPanes.get(pix)!;
}

/** 世界朝向的数组转到视角下（宽 w、高 h） */
function rotateArr<T extends Uint8Array | Float32Array>(v: View, a: T, w: number, h: number, make: (n: number) => T): { a: T; w: number; h: number } {
  const s = viewSize(v, w, h);
  const out = make(s.w * s.h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = toView(v, w, h, x + 0.5, y + 0.5);
      out[Math.floor(q.y) * s.w + Math.floor(q.x)] = a[y * w + x];
    }
  return { a: out, w: s.w, h: s.h };
}

/** 穹顶、看台的屋面颜色：按表面朝向取明暗（光从左上来） */
function surface(roof: PartModel['roof'], hgt: (x: number, y: number) => number, x: number, y: number, wx: number, wy: number, look: Look): PalKey {
  if (roof === 'stands') return Math.round(hgt(x, y)) % 2 ? 'water1' : 'water0';
  const gx = hgt(x + 1, y) - hgt(x - 1, y), gy = hgt(x, y + 1) - hgt(x, y - 1);
  const lit = (gx + gy) / 2 + 0.6;
  // 坡屋面：按朝光与否取楼型屋面的亮、暗两档，每 0.4 m 一道瓦缝
  if (roof === 'gable' || roof === 'hip') {
    const [r0, r1, r2] = look.roof;
    if (Math.round(hgt(x, y) * 2) % 7 === 0) return r0;
    return lit > 0.9 ? r2 : lit > 0.2 ? r1 : r0;
  }
  // 东西向每 4 m 一道接缝
  if (wx % 32 === 0) return lit > 0.9 ? 'stone2' : 'stone1';
  void wy;
  return lit > 1.4 ? 'white' : lit > 0.9 ? 'stone3' : lit > 0.3 ? 'stone2' : lit > -0.3 ? 'stone1' : 'stone0';
}

export function drawBuilding(b: BuildingModel, view: View = 0): Pix {
  return renderBuilding(b, view, false);
}

export function drawBuildingLight(b: BuildingModel, view: View): Pix {
  return renderBuilding(b, view, true);
}

/** 楼贴图和窗灯蒙版共用屋面、立面及遮挡顺序。 */
function renderBuilding(b: BuildingModel, view: View, light: boolean): Pix {
  const face = FACING[view];
  const elev = elevation(b.style, face);
  const style = STYLES[b.style];
  const looks = new Map<string, Look>();
  const lookAt = (k: number) => {
    const name = b.parts[k - 1].look ?? b.look;
    if (!looks.has(name)) looks.set(name, lookOf(name, name === b.look ? b.tweak : {}));
    return looks.get(name)!;
  };
  const hw = heights(b);
  const P = rotateArr(view, b.part, b.w, b.h, (n) => new Uint8Array(n));
  const Hh = rotateArr(view, hw, b.w, b.h, (n) => new Float32Array(n));
  const Ll = rotateArr(view, lifts(b), b.w, b.h, (n) => new Float32Array(n));
  const W = P.w, H = P.h;
  const part = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : P.a[y * W + x]);
  const hf = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Hh.a[y * W + x]);
  const lo = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Ll.a[y * W + x]);
  const hr = (x: number, y: number) => Math.round(hf(x, y));
  const frontAt = (x: number, y: number) => lo(x, y) > 0 ? 0 : hr(x, y);
  const top = Math.ceil(hw.reduce((a, v) => Math.max(a, v), 0)) + b.extraTop;
  const pix = new Pix(W, H + top);
  const { paint, finish } = buildingPainter(pix, light, b.id);
  const rand = rng(Math.abs(b.id) || 7);
  /** 视角下屋顶平面的像素 → 世界朝向下的像素（屋顶花样按世界方向排） */
  const toWorldPx = (x: number, y: number) => fromView(view, b.w, b.h, x + 0.5, y + 0.5);
  // 中轴：信息学馆取塔楼（第 2 分区）最前一排的正中，其他楼取占地正中
  let axis = W / 2;
  if (b.style === 'info') {
    let ty = -1, tx0 = W, tx1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (part(x, y) === 2) ty = y;
    for (let x = 0; x < W; x++) if (part(x, ty) === 2 || part(x, ty - 1) === 2) (tx0 = Math.min(tx0, x)), (tx1 = Math.max(tx1, x));
    if (ty >= 0) axis = (tx0 + tx1 + 1) / 2;
  }
  // 平顶的女儿墙：按「同一平顶分区」算离边缘的距离
  const flatId = (x: number, y: number) => {
    const k = part(x, y);
    return k && b.parts[k - 1].roof === 'flat' ? k : 0;
  };
  const inset = insetMap(W, H, flatId, 255);
  /** 视角下的像素 → 世界米坐标（像素中心） */
  const toMeters = (x: number, y: number): [number, number] => {
    const q = toWorldPx(x, y);
    return [EXTENT.x0 + (b.x + q.x) / PPM, EXTENT.y0 + (b.y + q.y) / PPM];
  };
  // 每一排连续立面的左右端：窗按段居中排
  const runs = new Int32Array(W * H * 2).fill(-1);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const isFace = (xx: number) => part(xx, y) > 0 && frontAt(xx, y + 1) < hr(xx, y) && frontAt(xx, y + 1) === frontAt(x, y + 1) && hr(xx, y) === hr(x, y);
      if (!isFace(x)) {
        x++;
        continue;
      }
      let e = x;
      while (e + 1 < W && isFace(e + 1)) e++;
      for (let i = x; i <= e; i++) (runs[(y * W + i) * 2] = x), (runs[(y * W + i) * 2 + 1] = e);
      x = e + 1;
    }
  }

  // 地面投影不烘焙：游戏里按太阳位置实时投影（src/shadows.ts）

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = part(x, y);
      if (!k) continue;
      const pm = b.parts[k - 1];
      const hh = hr(x, y);
      const roofY = top + y - hh;
      // 屋顶：平顶是女儿墙压顶一圈亮色，内侧一道阴影，北边和西边的女儿墙把影子投到屋面上；穹顶和看台按表面明暗
      const wp = toWorldPx(x, y);
      const look = lookAt(k);
      const [r0, r1, r2] = look.roof;
      let col: PalKey;
      if (pm.roof !== 'flat') col = surface(pm.roof, hf, x, y, Math.floor(wp.x), Math.floor(wp.y), look);
      else {
        const d = inset[y * W + x];
        if (d < 2) col = r2;
        else if (d === 2) col = r0;
        else {
          const g = Math.round(look.roofGrid * PPM), gx = Math.floor(wp.x), gy = Math.floor(wp.y);
          // 隔热砖分格：缝是暗一档的细线，每块砖里偶尔一块颜色浅一点
          const seam = g && !style && (gx % g === 0 || gy % g === 0) && (gx + gy) % 2 === 0;
          const pale = g && !style && ((Math.imul(((gx / g) | 0) + 31, 2654435761) ^ Math.imul(((gy / g) | 0) + 17, 40503)) >>> 0) % 97 === 0;
          col = style?.roof?.({ x: gx, y: gy, fx: wp.x / b.w, fy: wp.y / b.h, inset: d, level: k }) ?? (seam ? r0 : pale ? r2 : rand() < 0.04 ? r0 : r1);
          const shadowed = (y >= 2 && inset[(y - 2) * W + x] < 2) || (x >= 2 && inset[y * W + x - 2] < 2);
          if (shadowed && col === r1) col = r0;
        }
      }
      paint(x, roofY, col);
      // 立面：前面那个像素更矮时，画出两者高度差那一段
      const front = frontAt(x, y + 1);
      if (front >= hh) continue;
      // 墙面朝向：前沿往右下斜的一段朝左下、受光，往右上斜的一段背光
      const leftOpen = (yg: number) => hr(x - 1, y) <= yg && hr(x - 1, y + 1) <= yg;
      const rightOpen = (yg: number) => hr(x + 1, y) <= yg;
      const [wx, wy] = toMeters(x, y);
      const run0 = runs[(y * W + x) * 2], run1 = runs[(y * W + x) * 2 + 1];
      if (lo(x, y) > 0 && lo(x, y) - 1 >= front) paint(x, top + y - lo(x, y) + 1, 'ink');
      for (let yg = Math.max(front, lo(x, y)); yg < hh; yg++) {
        let c: FacadePixel;
        if (yg >= pm.wall) c = surface(pm.roof, hf, x, y, Math.floor(wp.x), Math.floor(wp.y), look);
        else if (pm.roof === 'stands') c = yg % 6 === 0 ? 'stone1' : 'stone2';
        else {
          // 有立面图就按图取色（图和占地按中线对齐）；女儿墙仍用程序画，和屋顶接得上
          if (elev && yg < pm.wall - PARAPET) {
            const ex = x - Math.round(W / 2) + Math.round(elev.w / 2), ey = elev.h - 1 - yg;
            const o = (ey * elev.w + ex) * 4;
            if (ex >= 0 && ex < elev.w && ey >= 0 && elev.data[o + 3] > 0) {
              const color = (elev.data[o] << 16) | (elev.data[o + 1] << 8) | elev.data[o + 2];
              const g = GLASS.find((c) => PAL[c] === color);
              if (g) {
                const { cells, doors } = elevationWindows(elev), id = cells[ey * elev.w + ex];
                paint(x, top + y - yg, glass(g, `elevation:${id}`, doors.has(id)), face);
              } else paint(x, top + y - yg, color);
              continue;
            }
          }
          if (style) c = style.facade({ x, yg, face, level: k, hTop: pm.wall, hBottom: front, axis });
          else {
            const at = { x, run0: run0 < 0 ? x : run0, run1: run1 < 0 ? x : run1, yg, hTop: pm.wall, hBottom: front, face, wx, wy };
            c = lookFacade(look, at);
            for (const [fi, f] of b.features.entries()) c = featurePixel(look, f, fi, at, c) ?? c;
            c = doorPixel(look, b.doors, at) ?? c;
          }
        }
        let color = typeof c === 'object' ? c.color : c;
        if (leftOpen(yg)) color = shadeKey(color, +1);
        else if (rightOpen(yg)) color = shadeKey(color, -1);
        paint(x, top + y - yg, typeof c === 'object' ? { ...c, color } : color, face);
      }
    }
  }
  // 屋顶小件：只放在最高的平顶分区上，免得盖住前面更高的部分
  const maxWall = Math.max(...b.parts.filter((p) => p.roof === 'flat').map((p) => p.wall), 0);
  const onTop = (x: number, y: number, need: number) => flatId(x, y) && b.parts[part(x, y) - 1].wall === maxWall && inset[y * W + x] >= need;
  const free = (x: number, y: number) => !style?.roof?.({ ...(() => { const q = toWorldPx(x, y); return { x: Math.floor(q.x), y: Math.floor(q.y), fx: q.x / b.w, fy: q.y / b.h }; })(), inset: 99, level: part(x, y) });
  // 楼梯间：每 800 m² 屋面一个，4 × 6 m、高 3 m，正面一扇门
  let roofArea = 0;
  for (let i = 0; i < W * H; i++) if (P.a[i] && b.parts[P.a[i] - 1].wall === maxWall && b.parts[P.a[i] - 1].roof === 'flat') roofArea++;
  for (let n = 0, tries = 0; !style && n < Math.round(roofArea / (PPM * PPM) / 800) && tries < 80; tries++) {
    const look = lookAt(1);
    if (!look.penthouse) break;
    const bw = 32, bh = 48, x = Math.floor(rand() * (W - bw)), y = Math.floor(rand() * (H - bh));
    if (![[x, y], [x + bw, y], [x, y + bh], [x + bw, y + bh]].every(([px, py]) => onTop(px, py, 16))) continue;
    const ry = top + y - maxWall - 24, [w0, w1, w2] = look.wall;
    paintRect(paint, x, ry, bw, bh, look.roof[1]);
    paintRect(paint, x, ry, bw, 1, look.roof[2]);
    paintRect(paint, x, ry + bh, bw, 24, w1);
    paintRect(paint, x, ry + bh, 1, 24, w2);
    paintRect(paint, x + bw - 1, ry + bh, 1, 24, w0);
    paintRect(paint, x + 12, ry + bh + 6, 8, 18, 'slate');
    n++;
  }
  const lookTop = lookAt(1);
  // 光伏板：成排的深蓝板，每排 1 m 宽、间隔 1.5 m
  if (!style && lookTop.rooftop === 'solar')
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!onTop(x, y, 10) || !free(x, y)) continue;
        const q = toWorldPx(x, y), ys = Math.floor(q.y) % 20;
        if (ys >= 8 || Math.floor(q.x) % 48 < 2) continue;
        paint(x, top + y - maxWall, ys === 0 ? 'curtain2' : ys === 7 ? 'shadow' : ys % 3 ? 'curtain0' : 'curtain1');
      }
  // 素平顶上随机放几台设备箱，打破大片平顶
  if (style || lookTop.rooftop === 'equipment')
    for (let y = 0; y + 16 <= H; y += 16)
      for (let x = 0; x + 16 <= W; x += 16) {
        if (!onTop(x + 8, y + 8, 14) || rand() > 0.015 || !free(x + 8, y + 8)) continue;
        const ry = top + y - hr(x + 8, y + 8);
        paintRect(paint, x + 2, ry + 2, 12, 7, 'roof2');
        paintRect(paint, x + 2, ry + 9, 12, 3, 'roof0');
      }

  if (b.style === 'info') {
    if (light) renderInfoCrown(pix, part, W, H, hr, top, face, paint);
    else drawInfoCrown(pix, part, W, H, hr, top, face);
  }
  finish();
  return pix;
}

const SHADES: PalKey[][] = [
  ['beige0', 'beige1', 'beige2', 'beige3'],
  ['grey0', 'grey1', 'grey2', 'grey3'],
  ['plain0', 'plain1', 'plain2'],
  ['glass0', 'glass1', 'glass2'],
  ...Object.values(RAMPS).filter((r) => !['beige', 'grey', 'plain'].includes(r[0].replace(/\d$/, ''))),
];
function shadeKey(c: PalKey, d: number): PalKey {
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
function drawInfoCrown(pix: Pix, part: (x: number, y: number) => number, W: number, H: number, hr: (x: number, y: number) => number, top: number, face: string): void {
  renderInfoCrown(pix, part, W, H, hr, top, face, buildingPainter(pix, false, 0).paint);
}

/** 塔顶的窗户和塔身共用逐窗亮灯与遮挡判定。 */
function renderInfoCrown(pix: Pix, part: (x: number, y: number) => number, W: number, H: number, hr: (x: number, y: number) => number, top: number, face: string, paint: Paint): void {
  let bottom = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (part(x, y) === 2) bottom = y;
  if (bottom < 0) return;
  // 塔楼最前两排的左右范围
  let tx0 = W, tx1 = -1;
  for (let x = 0; x < W; x++) if (part(x, bottom) === 2 || part(x, bottom - 1) === 2) (tx0 = Math.min(tx0, x)), (tx1 = Math.max(tx1, x + 1));
  const axis = (tx0 + tx1) / 2, tw = tx1 - tx0;
  const towerRoofFront = top + bottom + 1 - hr(Math.floor(axis), bottom);
  /** 画一个方塔体：底边在 base，正面高 fh，顶面进深 d；body 给正面每个像素取色 */
  const block = (w: number, fh: number, d: number, base: number, body: (x: number, y: number) => FacadePixel) => {
    const x0 = Math.round(axis - w / 2);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < w; x++) {
        const c = body(x, y);
        let col = typeof c === 'object' ? c.color : c;
        if (x === 0) col = shadeKey(col, +1);
        if (x === w - 1) col = shadeKey(col, -1);
        paint(x0 + x, base - fh + y, typeof c === 'object' ? { ...c, color: col } : col, 'crown');
      }
    paintRect(paint, x0, base - fh - d, w, d, 'beige1');
    paintRect(paint, x0, base - fh - d, w, 1, 'beige3');
    paintRect(paint, x0, base - fh - d, 1, d, 'beige3');
    return base - fh - Math.floor(d / 2);
  };
  // 退台：檐口 3 px，下面三扇大窗
  const w1 = Math.round(tw * 0.58), fh1 = Math.round(STOREY * 1.3);
  let base = towerRoofFront - 10;
  base = block(w1, fh1, 14, base, (x, y) => {
    if (y < 3) return y === 2 ? 'beige1' : 'beige3';
    const bay = w1 / 3, xs = x % bay;
    if (y >= 9 && y < fh1 - 5 && xs >= 4 && xs < bay - 4) return glass(pane(Math.floor(xs - 4), fh1 - 6 - y, Math.floor(bay - 8), fh1 - 14), `terrace:${Math.floor(x / bay)}`);
    return 'beige2';
  });
  // 小塔：顶上一层小窗，中间砖红饰面
  const w2 = Math.round(tw * 0.26), fh2 = Math.round(STOREY * 2.3);
  base = block(w2, fh2, 10, base, (x, y) => {
    if (y < 3) return y === 2 ? 'beige1' : 'beige3';
    if (y >= 6 && y < 14 && x % 6 >= 2 && x % 6 < 5) return glass('glass0', `tower:${Math.floor(x / 6)}`);
    if (face === 'N' && y >= 24 && y < fh2 - 6 && x >= Math.round(w2 * 0.25) && x < Math.round(w2 * 0.75)) return y % 4 === 0 ? 'brick0' : 'brick1';
    return 'beige2';
  });
  // 旗杆与旗
  paintRect(paint, Math.round(axis), base - 34, 1, 34, 'stone0');
  paintRect(paint, Math.round(axis) + 1, base - 34, 10, 6, 'flag');
}
