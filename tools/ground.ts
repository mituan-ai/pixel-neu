// 地面栅格：按 1 m = 8 px 把 survey.json 的面、标准运动场和楼基直接画成像素，再烘焙成分块图 assets/ground/<列>-<行>.png。
// 一个像素存一个材质编号（art-ground.ts 的 MATS）和一个标线编号；烘焙时按材质平铺小样，草地和铺装的交界画路缘，最后叠标线。
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { GROUND_CHUNK, METERS_PER_TILE } from '../shared/world.ts';
import { MAT, MATS, PATTERNS, PAVED, ROAD, type Mat } from './art-ground.ts';
import { EXTENT, type P } from './geo.ts';
import { Pix } from './pix.ts';
import { PAL, type PalKey } from './palette.ts';
import { PPM, edt, fillShape, smoothLine } from './shape.ts';
import type { Field, Shape, Survey } from './survey.ts';

/** 地图像素宽高 */
export const PW = (EXTENT.x1 - EXTENT.x0) * PPM, PH = (EXTENT.y1 - EXTENT.y0) * PPM;
/** 标线：白漆、深色（球网） */
const MARK = { paint: 1, dark: 2 } as const;
/** 路口转角半径的默认值（米） */
const CORNER = 4;

const hash = (c: number, r: number) => ((c * 73856093) ^ (r * 19349663)) >>> 0;
const rgba = (k: PalKey) => [PAL[k] >> 16, (PAL[k] >> 8) & 255, PAL[k] & 255, 255];
/** 白漆、深色标线、路缘、路缘内侧、路沿石、路沿石外侧 */
const INK = { paint: rgba('paint'), dark: rgba('ink'), curb: rgba('curb'), curbIn: rgba('grass0'), kerb: rgba('stone2'), kerbOut: rgba('stone0') };
/** 世界米 → 像素 */
export const toPx = ([x, y]: P): P => [(x - EXTENT.x0) * PPM, (y - EXTENT.y0) * PPM];

export class Ground {
  readonly mat = new Uint8Array(PW * PH);
  readonly mark = new Uint8Array(PW * PH);

  /** 世界米坐标处的材质名 */
  at([x, y]: P): Mat {
    const px = Math.floor((x - EXTENT.x0) * PPM), py = Math.floor((y - EXTENT.y0) * PPM);
    return px < 0 || py < 0 || px >= PW || py >= PH ? 'outside' : MATS[this.mat[py * PW + px]];
  }

  paint(s: Shape, m: Mat): void {
    const v = MAT[m];
    fillShape(s, (x, y) => (this.mat[y * PW + x] = v), PW, PH);
  }

  /** 按 survey.json 的顺序铺面；沥青路的两端再按 corner 把路口的路沿倒圆 */
  paintAreas(areas: Survey['areas']): void {
    for (const a of areas) this.paint(a, a.kind === 'planter' ? 'flower' : a.kind);
    for (const a of areas) {
      if (a.kind !== 'asphalt' || !a.line || !a.width) continue;
      const r = a.corner ?? CORNER;
      if (r > 0) for (const end of [a.line[0], a.line[a.line.length - 1]]) this.roundCorners(end, a.width / 2, r);
    }
  }

  /**
   * 路口倒圆：在路端附近做一次沥青的闭运算（先膨胀 r 再腐蚀 r），凹角就被半径 r 的圆弧填上。
   * 只把草地、林地、铺装改成沥青，不动水面和花坛
   */
  private roundCorners(end: P, hw: number, r: number): void {
    const R = r * PPM, half = Math.ceil((hw + 3 * r + 2) * PPM);
    const [cx, cy] = toPx(end).map(Math.round);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half), x1 = Math.min(PW, cx + half), y1 = Math.min(PH, cy + half);
    const w = x1 - x0, h = y1 - y0;
    const road = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) road[y * w + x] = this.mat[(y0 + y) * PW + x0 + x] === MAT.asphalt ? 1 : 0;
    const d1 = edt(road, w, h);
    const outside = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) outside[i] = d1[i] <= R * R ? 0 : 1;
    // 窗口外当作「没膨胀到」，窗口边上不会被误填
    for (let x = 0; x < w; x++) (outside[x] = 1), (outside[(h - 1) * w + x] = 1);
    for (let y = 0; y < h; y++) (outside[y * w] = 1), (outside[y * w + w - 1] = 1);
    const d2 = edt(outside, w, h);
    const soft = new Set<number>([MAT.grass, MAT.wood, MAT.paving]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * PW + x0 + x;
        if (!road[y * w + x] && d2[y * w + x] > R * R && soft.has(this.mat[i])) this.mat[i] = MAT.asphalt;
      }
  }

  /** 中线虚线：沿中线每 6 m 画 2 m 长、2 像素宽的白线；弯道也跟着中线走 */
  paintDashes(areas: Survey['areas']): void {
    for (const a of areas) {
      if (!a.dash || !a.line) continue;
      const line = smoothLine(a.line, a.curve ?? 0);
      let along = 0;
      for (let k = 1; k < line.length; k++) {
        const [p, q] = [line[k - 1], line[k]];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let s = 0; s < len; s += 1 / PPM) {
          if ((along + s) % 6 >= 2) continue;
          const [x, y] = toPx([p[0] + ((q[0] - p[0]) * s) / len, p[1] + ((q[1] - p[1]) * s) / len]);
          for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
            const xi = Math.round(x) + dx, yi = Math.round(y) + dy;
            if (this.mat[yi * PW + xi] === MAT.asphalt) this.mark[yi * PW + xi] = MARK.paint;
          }
        }
        along += len;
      }
    }
  }

  /** 标准运动场：画地面和标线，返回要摆的球门（世界米坐标和朝向） */
  paintFields(fields: Field[]): { at: P; rot: number }[] {
    const goals: { at: P; rot: number }[] = [];
    for (const f of fields) {
      const a = ((f.angle ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      // 场地本地坐标：u 横、v 沿长轴（angle = 0 时 u 向东、v 向南）
      const toWorld = (u: number, v: number): P => [f.at[0] + u * ca - v * sa, f.at[1] + u * sa + v * ca];
      const local = (x: number, y: number): P => {
        const dx = x - f.at[0], dy = y - f.at[1];
        return [dx * ca + dy * sa, -dx * sa + dy * ca];
      };
      const half = f.type === 'track' ? 92 : Math.max(f.length ?? 105, f.width ?? 68) / 2 + 4;
      const [x0, y0] = toPx([f.at[0] - half, f.at[1] - half]).map(Math.floor), [x1, y1] = toPx([f.at[0] + half, f.at[1] + half]).map(Math.ceil);
      /** 1 像素宽的线：|q| 在半个像素以内 */
      const on = (q: number) => Math.abs(q) <= 0.5 / PPM;
      const each = (fn: (u: number, v: number, i: number) => void) => {
        for (let y = Math.max(0, y0); y < Math.min(PH, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(PW, x1); x++) {
            const [u, v] = local(EXTENT.x0 + (x + 0.5) / PPM, EXTENT.y0 + (y + 0.5) / PPM);
            fn(u, v, y * PW + x);
          }
      };
      const football = (L: number, Wd: number) => {
        each((u, v, i) => {
          if (Math.abs(u) > Wd / 2 + 0.1 || Math.abs(v) > L / 2 + 0.1) return;
          if (this.mat[i] === MAT.pitch || this.mat[i] === MAT.pitch2 || f.type === 'football') this.mat[i] = Math.floor((v + L / 2) / 5) % 2 ? MAT.pitch2 : MAT.pitch;
          const au = Math.abs(u), av = Math.abs(v);
          const box = (bw: number, bd: number) => (on(au - bw / 2) && av >= L / 2 - bd && av <= L / 2) || (on(av - (L / 2 - bd)) && au <= bw / 2);
          const line =
            ((on(au - Wd / 2) || on(av - L / 2)) && au <= Wd / 2 && av <= L / 2) || // 边线、端线
            (on(v) && au <= Wd / 2) || // 中线
            on(Math.hypot(u, v) - 9.15) || Math.hypot(u, v) < 0.2 || // 中圈、中点
            box(40.32, 16.5) || box(18.32, 5.5) || // 罚球区、球门区
            Math.hypot(u, av - (L / 2 - 11)) < 0.2 || // 罚球点
            (on(Math.hypot(u, av - (L / 2 - 11)) - 9.15) && av < L / 2 - 16.5); // 罚球弧
          if (line) this.mark[i] = MARK.paint;
        });
        goals.push({ at: toWorld(0, -L / 2 - 1), rot: 0 }, { at: toWorld(0, L / 2 + 1), rot: 2 });
      };
      if (f.type === 'track') {
        const lanes = f.lanes ?? 8, S = 84.39 / 2, R0 = 36.5, R1 = R0 + lanes * 1.22;
        each((u, v, i) => {
          const d = Math.abs(v) <= S ? Math.abs(u) : Math.hypot(u, Math.abs(v) - S);
          if (d <= R0) this.mat[i] = MAT.pitch;
          else if (d <= R1 + 0.3) this.mat[i] = MAT.track;
          else return;
          // 分道线：内沿起每 1.22 m 一道
          const k = (d - R0) / 1.22;
          if (d >= R0 && d <= R1 + 0.1 && on((k - Math.round(k)) * 1.22)) this.mark[i] = MARK.paint;
        });
        football(f.length ?? 105, f.width ?? 68);
        continue;
      }
      if (f.type === 'football') {
        football(f.length ?? 105, f.width ?? 68);
        continue;
      }
      // 球场线：只画线，不改底色
      const [L, Wd] = { basketball: [28, 15], tennis: [23.77, 10.97], volleyball: [18, 9] }[f.type];
      each((u, v, i) => {
        const au = Math.abs(u), av = Math.abs(v);
        if (au > Wd / 2 + 0.1 || av > L / 2 + 0.1) return;
        let line = ((on(au - Wd / 2) || on(av - L / 2)) && au <= Wd / 2 && av <= L / 2) || (on(v) && au <= Wd / 2);
        if (f.type === 'basketball') {
          // 中圈、三秒区（4.9 m 宽、罚球线距端线 5.8 m）、罚球圈、三分线（6.75 m，两侧直线离边线 0.9 m）
          const hv = L / 2 - 1.575; // 篮筐中心离端线 1.575 m
          line ||= on(Math.hypot(u, v) - 1.8);
          line ||= (on(au - 2.45) && av >= L / 2 - 5.8) || (on(av - (L / 2 - 5.8)) && au <= 2.45);
          line ||= on(Math.hypot(u, av - (L / 2 - 5.8)) - 1.8) && av <= L / 2 - 5.8;
          const r3 = Math.hypot(u, av - hv);
          line ||= (on(r3 - 6.75) && av <= hv) || (on(au - (Wd / 2 - 0.9)) && av > hv);
        } else if (f.type === 'tennis') {
          // 单打边线、发球线（离网 6.4 m）、中线；网画深色
          line ||= (on(au - 4.115) && av <= L / 2) || (on(av - 6.4) && au <= 4.115) || (on(u) && av <= 6.4);
          if (on(v) && au <= Wd / 2 + 0.9) {
            this.mark[i] = MARK.dark;
            return;
          }
        } else line ||= on(av - 3) && au <= Wd / 2; // 排球进攻线
        if (line) this.mark[i] = MARK.paint;
      });
    }
    return goals;
  }

  /**
   * 漏缝：没有描到的「校外」像素，如果它所在的 1 m 格中心描过，就跟着格子中心；
   * 整格都没描、又从地图边上连不出去的，按 1 m 格由外向内用邻格补上
   */
  fillGaps(): void {
    const C = PPM, cw = PW / C, ch = PH / C;
    const cell = new Uint8Array(cw * ch);
    for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) cell[r * cw + c] = this.mat[(r * C + C / 2) * PW + c * C + C / 2];
    const O = MAT.outside;
    const open = new Uint8Array(cw * ch);
    const queue: number[] = [];
    for (let r = 0; r < ch; r++)
      for (let c = 0; c < cw; c++)
        if (cell[r * cw + c] === O && (c === 0 || r === 0 || c === cw - 1 || r === ch - 1)) (open[r * cw + c] = 1), queue.push(r * cw + c);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head] % cw, r = (queue[head] / cw) | 0;
      for (const [dc, dr] of DIRS) {
        const cc = c + dc, rr = r + dr, j = rr * cw + cc;
        if (cc >= 0 && rr >= 0 && cc < cw && rr < ch && !open[j] && cell[j] === O) (open[j] = 1), queue.push(j);
      }
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (let r = 0; r < ch; r++)
        for (let c = 0; c < cw; c++) {
          const i = r * cw + c;
          if (cell[i] !== O || open[i]) continue;
          for (const [dc, dr] of DIRS) {
            const cc = c + dc, rr = r + dr;
            if (cc < 0 || rr < 0 || cc >= cw || rr >= ch || cell[rr * cw + cc] === O) continue;
            cell[i] = cell[rr * cw + cc];
            changed = true;
            break;
          }
        }
    }
    // 格子里的细缝像素：先从四邻像素往里长（最多 1 m），长不到的再取格子的材质
    let gap: number[] = [];
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) {
        const i = y * PW + x;
        if (this.mat[i] === O && cell[((y / C) | 0) * cw + ((x / C) | 0)] !== O) gap.push(i);
      }
    for (let pass = 0; pass < C && gap.length; pass++) {
      const fill: [number, number][] = [];
      const rest: number[] = [];
      for (const i of gap) {
        const x = i % PW;
        const nb = [x > 0 ? i - 1 : -1, x < PW - 1 ? i + 1 : -1, i - PW, i + PW].find((j) => j >= 0 && j < PW * PH && this.mat[j] !== O);
        if (nb === undefined) rest.push(i);
        else fill.push([i, this.mat[nb]]);
      }
      for (const [i, m] of fill) this.mat[i] = m;
      gap = rest;
    }
    for (const i of gap) this.mat[i] = cell[(((i / PW) | 0) / C | 0) * cw + (((i % PW) / C) | 0)];
  }

  /** 一个像素的颜色：材质小样，草地和铺装交界的路缘，标线 */
  private color(x: number, y: number, out: Uint8ClampedArray, o: number): void {
    const i = y * PW + x, m = this.mat[i];
    if (this.mark[i]) {
      out.set(this.mark[i] === MARK.paint ? INK.paint : INK.dark, o);
      return;
    }
    const near = (set: Set<number>, d: number) =>
      (x >= d && set.has(this.mat[i - d])) || (x + d < PW && set.has(this.mat[i + d])) || (y >= d && set.has(this.mat[i - d * PW])) || (y + d < PH && set.has(this.mat[i + d * PW]));
    if (m === MAT.grass || m === MAT.wood) {
      if (near(PAVED, 1)) return void out.set(INK.curb, o);
      if (near(PAVED, 2)) return void out.set(INK.curbIn, o);
    } else if (m === MAT.paving) {
      if (near(ROAD, 1)) return void out.set(INK.kerb, o);
      if (near(ROAD, 2)) return void out.set(INK.kerbOut, o);
    }
    const pats = PATTERNS[MATS[m]];
    const pat = pats[pats.length > 1 ? hash(x >> 4, y >> 4) % pats.length : 0];
    out.set(pat.data.subarray(((y & 15) * 16 + (x & 15)) * 4, ((y & 15) * 16 + (x & 15)) * 4 + 4), o);
  }

  /** 烘焙地面分块图，返回块数 */
  bake(dir: URL): number {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) rmSync(new URL(f, dir));
    let n = 0;
    for (let cy = 0; cy * GROUND_CHUNK < PH; cy++)
      for (let cx = 0; cx * GROUND_CHUNK < PW; cx++) {
        const w = Math.min(GROUND_CHUNK, PW - cx * GROUND_CHUNK), h = Math.min(GROUND_CHUNK, PH - cy * GROUND_CHUNK);
        const pix = new Pix(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.color(cx * GROUND_CHUNK + x, cy * GROUND_CHUNK + y, pix.data, (y * w + x) * 4);
        pix.save(new URL(`${cx}-${cy}.png`, dir));
        n++;
      }
    return n;
  }

  /** 小地图底图：每 2 m 一个像素，取格子中心的材质色；楼基画成灰色 */
  minimap(): Pix {
    const S = METERS_PER_TILE * PPM, w = PW / S, h = PH / S;
    const pix = new Pix(w, h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const m = this.mat[(r * S + S / 2) * PW + c * S + S / 2];
        if (m === MAT.floor) pix.px(c, r, 0x93989a);
        else pix.data.set(PATTERNS[MATS[m]][0].data.subarray(8 * 16 * 4 + 32, 8 * 16 * 4 + 36), (r * w + c) * 4);
      }
    return pix;
  }
}
