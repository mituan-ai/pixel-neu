// survey.json 里形状（Shape）的几何：外接框、点在不在形状里、按像素中心填充。
// 坐标一律是世界米；填充时按 1 m = PPM 像素换到以 EXTENT 西北角为原点的像素坐标。
import { EXTENT, type P } from './geo.ts';
import type { Shape } from './survey.ts';

/** 每米像素：地面和建筑都按这个分辨率画 */
export const PPM = 8;

export function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 中线在折点处倒成半径 r 的圆弧（每 0.5 m 一点）。圆弧的切点不超过相邻两段各自的一半，
 * 所以两个折点挨得近时半径会自动变小
 */
export function smoothLine(line: P[], r: number): P[] {
  if (!r || line.length < 3) return line;
  const out: P[] = [line[0]];
  for (let k = 1; k < line.length - 1; k++) {
    const [a, b, c] = [line[k - 1], line[k], line[k + 1]];
    const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u1: P = [(b[0] - a[0]) / la, (b[1] - a[1]) / la], u2: P = [(c[0] - b[0]) / lc, (c[1] - b[1]) / lc];
    const turn = Math.atan2(u1[0] * u2[1] - u1[1] * u2[0], u1[0] * u2[0] + u1[1] * u2[1]);
    if (Math.abs(turn) < 1e-3) {
      out.push(b);
      continue;
    }
    const t = Math.min(r * Math.tan(Math.abs(turn) / 2), la / 2, lc / 2);
    const rr = t / Math.tan(Math.abs(turn) / 2);
    const t1: P = [b[0] - u1[0] * t, b[1] - u1[1] * t];
    const s = Math.sign(turn);
    const centre: P = [t1[0] - u1[1] * rr * s, t1[1] + u1[0] * rr * s];
    const a0 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]);
    const n = Math.max(2, Math.ceil((Math.abs(turn) * rr) / 0.5));
    for (let i = 0; i <= n; i++) {
      const a1 = a0 + (turn * i) / n;
      out.push([centre[0] + Math.cos(a1) * rr, centre[1] + Math.sin(a1) * rr]);
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

/** 椭圆和圆换成多边形（每 0.5 m 弧长一点） */
export function ellipsePoly(cx: number, cy: number, rx: number, ry: number): P[] {
  const n = Math.max(16, Math.ceil((Math.PI * (rx + ry)) / 0.5));
  return Array.from({ length: n }, (_, k): P => [cx + Math.cos((2 * Math.PI * k) / n) * rx, cy + Math.sin((2 * Math.PI * k) / n) * ry]);
}

/** 线状形状展开成带宽的线段；其他形状展开成多边形 */
function resolve(s: Shape): { poly: P[] } | { segs: [P, P][]; hw: number } {
  if (s.poly) return { poly: s.poly };
  if (s.circle) return { poly: ellipsePoly(s.circle[0], s.circle[1], s.circle[2], s.circle[2]) };
  if (s.ellipse) return { poly: ellipsePoly(...s.ellipse) };
  if (s.line && s.width) {
    const pts = smoothLine(s.line, s.curve ?? 0);
    return { segs: pts.slice(1).map((b, k): [P, P] => [pts[k], b]), hw: s.width / 2 };
  }
  throw new Error(`形状缺少 poly、line + width、circle 或 ellipse：${JSON.stringify(s)}`);
}

/** 形状的外接框 [x0, y0, x1, y1]（米） */
export function shapeBox(s: Shape): [number, number, number, number] {
  const r = resolve(s);
  const pts = 'poly' in r ? r.poly : r.segs.flat();
  const pad = 'poly' in r ? 0 : r.hw;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** 对照图用的轮廓线（米）：多边形、圆是闭合的一圈；线状形状是中线和两侧路沿 */
export function outlines(s: Shape): { closed: boolean; pts: P[] }[] {
  const r = resolve(s);
  if ('poly' in r) return [{ closed: true, pts: r.poly }];
  const centre = [r.segs[0][0], ...r.segs.map((g) => g[1])];
  const side = (k: number) =>
    r.segs.flatMap(([a, b]): P[] => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (-(b[1] - a[1]) / l) * r.hw * k, ny = ((b[0] - a[0]) / l) * r.hw * k;
      return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]];
    });
  return [{ closed: false, pts: centre }, { closed: false, pts: side(1) }, { closed: false, pts: side(-1) }];
}

/** 点（米）在不在线段带里：两端平头，中间折点按圆接 */
function inSegs(p: P, segs: [P, P][], hw: number): boolean {
  return segs.some(([a, b], k) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
    if ((k === 0 && t < 0) || (k === segs.length - 1 && t > 1)) return false;
    const tc = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - dx * tc, p[1] - a[1] - dy * tc) <= hw;
  });
}

export function inShape(p: P, s: Shape): boolean {
  const r = resolve(s);
  return 'poly' in r ? inPoly(p, r.poly) : inSegs(p, r.segs, r.hw);
}

/**
 * 按像素中心填充形状：fn 收到像素坐标（以 EXTENT 西北角为原点，每米 PPM 像素）。
 * 多边形按扫描线填，相邻两块共用的边上每个像素只归一边，不漏缝也不重叠
 */
export function fillShape(s: Shape, fn: (x: number, y: number) => void, W = Infinity, H = Infinity): void {
  const r = resolve(s);
  if ('poly' in r) {
    const pts = r.poly.map(([x, y]): P => [(x - EXTENT.x0) * PPM, (y - EXTENT.y0) * PPM]);
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > yc !== yj > yc) xs.push(((xj - xi) * (yc - yi)) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let x = xa; x <= xb; x++) fn(x, y);
      }
    }
    return;
  }
  // 线：每段只扫自己的外接框
  const { segs, hw } = r;
  segs.forEach(([a, b], k) => {
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - hw - EXTENT.x0) * PPM)), x1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + hw - EXTENT.x0) * PPM));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - hw - EXTENT.y0) * PPM)), y1 = Math.min(H - 1, Math.ceil((Math.max(a[1], b[1]) + hw - EXTENT.y0) * PPM));
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = EXTENT.x0 + (x + 0.5) / PPM, py = EXTENT.y0 + (y + 0.5) / PPM;
        const t = ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
        if ((k === 0 && t < 0) || (k === segs.length - 1 && t > 1)) continue;
        const tc = Math.max(0, Math.min(1, t));
        const ex = px - a[0] - dx * tc, ey = py - a[1] - dy * tc;
        if (ex * ex + ey * ey <= hw * hw) fn(x, y);
      }
  });
}

/** 一维平方距离变换（Felzenszwalb）：f 里 0 是目标、Infinity 是空 */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) {
      v[k] = q;
      continue;
    }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = f[v[k]] === Infinity ? Infinity : (q - v[k]) ** 2 + f[v[k]];
  }
}

/** 二维平方距离变换：每个像素到最近的 on 像素的平方距离（像素） */
export function edt(on: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = on[y * w + x] ? 0 : Infinity;
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}
