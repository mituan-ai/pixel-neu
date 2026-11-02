// 汽车、特种车和电动两轮车（目录见 shared/vehicles.ts，group 不是 bike、share 的车型）。
// 每个车型 × 车色 × 屏幕朝向 × 帧出一张图，锚点在占地中心落地处，不画投影。
import { VEHICLES, vehicleKey, type VehicleKind } from '../shared/vehicles.ts';
import { METERS_PER_TILE, TILE } from '../shared/world.ts';
import type { PalKey } from './palette.ts';
import { Pix, type Sprite } from './pix.ts';

const PPM = TILE / METERS_PER_TILE;

/** 占位用的车色 */
export const PAINT: Record<string, PalKey> = {
  白: 'stone3', 银: 'grey3', 黑: 'slate', 蓝: 'water1', 红: 'flowerR', 棕: 'brick0', 灰: 'grey1',
  绿: 'grass2', 粉: 'flowerP', 黄: 'flowerY', 青: 'water2',
};

/** 占位：按真实尺寸画顶面和朝屏幕下方的立面，dir 是车头的屏幕朝向（下、左、右、上） */
export function placeholder(v: VehicleKind, paint: number, dir: number, frame: number): Sprite {
  const [L, W, H] = v.size.map((m) => Math.max(2, Math.round(m * PPM)));
  const along = dir === 0 || dir === 3;
  const sw = along ? W : L, sd = along ? L : W;
  const p = new Pix(sw + 2, sd + H + 2);
  const gy = H + 1;
  p.rect(1, gy - H, sw, sd, PAINT[v.paints[paint]]);
  p.rect(1, gy + sd - H, sw, H, 'grey0');
  // 车头一侧点一条深色，行驶帧错一个像素
  const c: PalKey = v.group === 'nev' ? 'grass1' : 'ink';
  if (dir === 0) p.hline(1, gy + sd - 1, sw, c);
  else if (dir === 3) p.hline(1, gy - H, sw, c);
  else p.vline(dir === 1 ? 1 : sw, gy - H + frame, sd, c);
  p.outline('ink');
  return { pix: p, ax: 1 + Math.floor(sw / 2), ay: gy + Math.floor(sd / 2) };
}

// 顶面、立面、暗部沿用现有色板，粉色背光面单独补色。
const BODY: Record<string, [PalKey, PalKey, PalKey]> = {
  白: ['stone3', 'stone2', 'stone0'], 银: ['grey3', 'grey2', 'grey0'],
  黑: ['glass0', 'slate', 'ink'], 蓝: ['water1', 'water0', 'glass0'],
  红: ['flowerR', 'brick0', 'bronze0'], 棕: ['brick1', 'brick0', 'bronze0'],
  灰: ['grey1', 'grey0', 'asph0'], 绿: ['grass2', 'grass1', 'leaf0'],
  粉: ['flowerP', 'carPink1', 'carPink0'],
};

// 从车头起量的座舱两端、平顶两端；仅表达任务单指定的通用车型特征。
const CABIN: Record<string, [number, number, number, number]> = {
  sedan: [0.29, 0.76, 0.40, 0.65], hatch: [0.25, 0.97, 0.38, 0.90],
  suv: [0.27, 0.97, 0.38, 0.91], mpv: [0.18, 0.97, 0.29, 0.92],
  van: [0.04, 0.98, 0.12, 0.95], pickup: [0.23, 0.57, 0.32, 0.53],
  'nev-sedan': [0.22, 0.94, 0.38, 0.59], 'nev-suv': [0.24, 0.97, 0.37, 0.76],
  'nev-mini': [0.10, 0.97, 0.20, 0.92],
};

/** 按目录尺寸画四向车辆，局部坐标 u 横跨车宽、t 从车头指向车尾、z 向上。 */
function vehicle(v: VehicleKind, paint: number, dir: number, frame: number): Sprite {
  const [L, W, H] = v.size.map((m) => Math.round(m * PPM));
  const along = dir === 0 || dir === 3;
  const sw = along ? W : L, sd = along ? L : W, gy = H + 1;
  const p = new Pix(sw + 2, sd + H + 2);
  const depth = new Int16Array(p.w * p.h).fill(-32768);
  const [top, side, dark] = BODY[v.paints[paint]];
  const id = v.id;
  // 尺寸取目录的四舍五入值，轮廓额外留一像素描边。
  const dot = (x: number, y: number, z: number, c: PalKey) => {
    const py = gy + y - z, i = py * p.w + x + 1, d = y + z;
    if (d >= depth[i]) {
      p.px(x + 1, py, c);
      depth[i] = d;
    }
  };
  const box = (u0: number, u1: number, t0: number, t1: number, z0: number, z1: number, a: PalKey, b: PalKey, c: PalKey = b) => {
    const [xa, xb, ya, yb] = dir === 0 ? [u0, u1, L - t1, L - t0]
      : dir === 1 ? [t0, t1, W - u1, W - u0]
      : dir === 2 ? [L - t1, L - t0, u0, u1] : [W - u1, W - u0, t0, t1];
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) dot(x, y, z1, xb - xa > 2 && x === xb - 1 ? c : a);
    for (let z = z0; z < z1; z++) for (let x = xa; x < xb; x++) dot(x, yb - 1, z, xb - xa > 2 && x === xb - 1 ? c : b);
  };
  const wheel = (u: number, t: number, width = 2) => {
    for (let dt = -2; dt <= 2; dt++) for (let z = 0; z < 4; z++) {
      if (Math.abs(dt) === 2 && (z === 0 || z === 3)) continue;
      const c: PalKey = dt === frame - 1 && (z === 1 || z === 2) ? 'grey2' : 'ink';
      box(u, u + width, t + dt, t + dt + 1, z, z + 1, z === 3 && dt === frame - 1 ? 'grey0' : 'ink', c);
    }
  };
  const endFace = (t: number, u0: number, width: number, z: number, c: PalKey) => {
    if (dir === 0 && t === 0) for (let u = u0; u < u0 + width; u++) dot(u, L - 1, z, c);
    if (dir === 3 && t === L - 1) for (let u = u0; u < u0 + width; u++) dot(W - 1 - u, L - 1, z, c);
  };
  const plate = (t: number, z: number, width = 4) => {
    const u = Math.floor((W - width) / 2);
    if (v.group === 'nev') {
      endFace(t, u, width, z + 1, 'carPlateG0');
      endFace(t, u, width, z, 'carPlateG1');
    } else {
      endFace(t, u, width, z, 'carPlateB');
      if (width === 4) endFace(t, u, width, z + 1, 'carPlateB');
    }
  };

  if (v.group === 'moto') {
    const u = Math.floor((W - 2) / 2), front = 2, rear = L - 3;
    wheel(u, front), wheel(u, rear);
    // 踏板、后座与车把；电摩的车身和前整流罩更粗。
    box(1, W - 1, 4, L - 3, 2, 3, top, side, dark);
    box(1, W - 1, L - 7, L - 2, 3, 5, top, side, dark);
    box(1, W - 1, L - 7, L - 5, 5, 7, 'slate', 'ink');
    box(1, W - 1, L - 4, L - 2, 5, 7, 'slate', 'ink');
    if (id === 'emoto') {
      box(1, W - 1, 1, 5, 3, H - 1, top, side, dark);
      box(1, W - 1, 2, 4, H - 1, H, 'glass1', 'glass0');
      box(1, W - 1, 0, 1, H - 4, H - 2, 'flowerW', 'flowerW');
      box(1, W - 1, 5, L - 6, 3, 6, top, side, dark);
    } else {
      box(u, u + 1, 2, 4, 3, H, top, side, dark);
      box(u, u + 2, 1, 2, H - 3, H - 2, 'flowerW', 'flowerW');
    }
    box(0, W, 3, 4, H - 1, H, 'grey1', 'slate');
    box(0, 1, 3, 4, H - 1, H, 'ink', 'ink');
    box(W - 1, W, 3, 4, H - 1, H, 'ink', 'ink');
    box(u, u + 2, L - 1, L, 4, 5, 'flowerR', 'flowerR');
    endFace(L - 1, u, 2, 2, 'flowerY');
  } else if (id === 'express-trike') {
    const split = Math.round(L * 0.40), axle = L - 4, mid = Math.floor(W / 2);
    wheel(mid - 1, 2), wheel(0, axle), wheel(W - 2, axle);
    box(2, W - 2, 2, L - 1, 2, 4, top, side, dark);
    box(1, W - 1, split, L, 4, H, top, side, dark);
    box(1, W - 1, split, L, H - 2, H - 1, side, side, dark);
    box(2, W - 2, split + 1, L - 1, H, H, top, side);
    box(2, W - 2, split - 3, split, 4, 7, 'slate', 'ink');
    box(mid - 1, mid + 1, 2, 3, 4, 8, side, dark);
    box(0, W, 3, 4, 8, 9, 'grey1', 'slate');
    box(mid - 1, mid + 1, 1, 2, 6, 7, 'flowerW', 'flowerW');
    // 货厢后门中缝、两侧竖筋与门锁。
    box(mid, mid + 1, L - 1, L, 5, H - 1, side, dark);
    for (const u of [1, W - 2]) box(u, u + 1, split + 2, split + 3, 5, H - 1, side, dark);
    box(mid - 1, mid, L - 1, L, 8, 9, 'grey2', 'grey0');
    plate(0, 3, 3), plate(L - 1, 3, 3);
    for (const u of [1, W - 3]) box(u, u + 2, L - 1, L, 5, 6, 'flowerR', 'flowerR');
  } else if (id === 'sweeper') {
    const cab = Math.round(L * 0.43), mid = Math.floor(W / 2);
    wheel(1, 4), wheel(W - 3, 4), wheel(1, L - 4), wheel(W - 3, L - 4);
    box(2, W - 2, 0, L, 3, 5, top, side, dark);
    box(2, W - 2, 1, cab, 5, H, top, side, dark);
    box(2, W - 2, 1, 2, 8, H - 2, 'glass1', 'glass1', 'glass0');
    for (const u of [2, W - 3]) box(u, u + 1, 3, cab - 1, 8, H - 2, 'glass2', 'glass1', 'glass0');
    box(2, W - 2, cab + 1, L - 1, 5, H - 2, 'grey2', 'grey0', 'asph0');
    box(3, W - 3, cab + 3, L - 3, H - 2, H - 1, 'grey3', 'grey1', 'grey0');
    for (let t = cab + 3; t < L - 3; t += 2) box(2, W - 2, t, t + 1, 7, 8, 'asph0', 'asph0');
    // 两侧圆盘扫刷计入目录车宽，不伸出占地。
    for (const u of [1, W - 2]) for (let du = -1; du <= 1; du++) for (let dt = -2; dt <= 2; dt++) {
      if (Math.abs(du) === 1 && Math.abs(dt) === 2) continue;
      const c: PalKey = (du + dt + frame) % 2 === 0 ? 'grey0' : 'bronze0';
      box(u + du, u + du + 1, cab - 2 + dt, cab - 1 + dt, 0, 2, c, 'ink');
    }
    box(2, W - 2, 0, 1, 5, 6, 'flowerY', 'flowerY');
    for (const u of [2, W - 3]) box(u, u + 1, 0, 1, 6, 7, 'flowerW', 'flowerW');
    box(mid - 1, mid + 1, 4, 6, H, H, 'flowerY', 'flowerY');
    plate(0, 3, 3), plate(L - 1, 3, 3);
    for (const u of [2, W - 3]) box(u, u + 1, L - 1, L, 6, 7, 'flowerR', 'flowerR');
  } else {
    const tall = ['suv', 'nev-suv', 'mpv', 'van', 'pickup'].includes(id);
    const clearance = tall ? 3 : 2, B = Math.round(H * (tall ? 0.50 : 0.48));
    const [c0, c1, r0, r1] = CABIN[id].map((f) => Math.round(f * L));
    const tapered = id === 'sedan' || id === 'hatch' || id === 'nev-sedan';
    for (const t of [Math.round(L * 0.19), Math.round(L * 0.80)]) wheel(0, t), wheel(W - 2, t);
    for (let t = 0; t < L; t++) {
      const inset = tapered && (t < 2 || t >= L - 2) ? 2 : 1;
      const z = id === 'pickup' && t > c1 ? B - 2 : B;
      box(inset, W - inset, t, t + 1, clearance, z, id === 'pickup' && t > c1 ? 'asph0' : top, side, dark);
    }
    // 座舱、轮距、灯窗比例按通用特征概括，不代表某辆实车的测量。
    const sloped = id === 'sedan' || id === 'nev-sedan';
    const pillars = [c0, c1 - 1, Math.round((r0 + r1) / 2)];
    if (id === 'van' || id === 'mpv') pillars.push(Math.round(c0 + (c1 - c0) * 0.73));
    for (let t = c0; t < c1; t++) {
      const z = t < r0 ? B + 2 + Math.round((H - B - 2) * (t - c0) / (r0 - c0))
        : t > r1 && (sloped || id === 'nev-suv') ? H - Math.round((sloped ? H - B - 2 : 2) * (t - r1) / (c1 - r1 - 1)) : H;
      const glass = t < r0 || t > r1;
      const a: PalKey = glass ? t < r0 ? 'glass1' : 'glass0' : top;
      const b: PalKey = pillars.includes(t) ? side : 'glass1';
      box(2, W - 2, t, t + 1, B, z, a, b, glass ? 'glass0' : dark);
      if (!pillars.includes(t)) box(2, W - 2, t, t + 1, B, B + 1, side, side, dark);
      // 玻璃的亮点固定在屏幕左上，不随朝向镜像。
      if (glass) {
        const [x, y] = dir === 0 ? [2, L - 1 - t] : dir === 1 ? [t, 2]
          : dir === 2 ? [L - 1 - t, 2] : [2, t];
        dot(x, y, z, 'glass2');
      }
    }
    if (!along) {
      const u = dir === 1 ? 2 : W - 3, t = dir === 1 ? r0 + 1 : r1 - 2;
      box(u, u + 1, t, t + 2, H - 2, H - 1, 'glass2', 'glass2');
    }
    const seams = id === 'nev-mini' ? [c1 - 2] : [Math.round((r0 + r1) / 2), c1 - 2];
    for (const t of seams) {
      for (const u of [1, W - 2]) {
        box(u, u + 1, t, t + 1, clearance + 1, B, side, dark);
        box(u, u + 1, t - 2, t, B - 1, B, 'grey2', 'grey0');
      }
    }
    if (id === 'suv') {
      for (const u of [2, W - 3]) box(u, u + 1, r0, r1 + 1, H, H, 'grey0', 'slate');
      for (const t of [r0 + 1, r1 - 1]) box(2, W - 2, t, t + 1, H, H, 'grey2', 'grey0');
    }
    if (id === 'mpv') for (const u of [1, W - 2]) box(u, u + 1, seams[0], c1 - 1, B - 1, B, 'slate', 'slate');
    if (id === 'pickup') {
      // 敞开货斗的低底板、侧围和尾门。
      box(1, W - 1, c1 + 1, L, clearance, B - 2, 'asph0', side, dark);
      for (const u of [1, W - 2]) box(u, u + 1, c1 + 1, L, B - 2, B + 1, top, side, dark);
      box(1, W - 1, L - 1, L, B - 2, B + 1, top, side, dark);
      for (let t = c1 + 2; t < L - 1; t += 3) box(3, W - 3, t, t + 1, B - 2, B - 2, 'grey0', 'grey0');
    }
    // 前后灯、保险杠和牌照都落在对应端面。
    for (const t of [0, L - 1]) {
      const rear = t !== 0, lamp: PalKey = rear ? 'flowerR' : 'flowerW';
      for (const u of [2, W - 4]) box(u, u + 2, t, t + 1, B - 2, B, lamp, lamp);
      box(2, W - 2, t, t + 1, clearance, clearance + 1, dark, dark);
      if (!rear && v.group === 'fuel') box(4, W - 4, t, t + 1, B - 3, B - 2, 'slate', 'slate');
      if (rear && v.group === 'nev') box(2, W - 2, t, t + 1, B - 1, B, 'flowerR', 'flowerR');
      plate(t, clearance + 1);
    }
  }
  p.outline('ink');
  return { pix: p, ax: 1 + Math.floor(sw / 2), ay: gy + Math.floor(sd / 2) };
}

export function drawVehicles(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const v of VEHICLES.filter((v) => v.group !== 'bike' && v.group !== 'share'))
    v.paints.forEach((_, p) => {
      for (let d = 0; d < 4; d++) for (let f = 0; f < v.frames; f++) out[vehicleKey(v.id, p, d, f)] = vehicle(v, p, d, f);
    });
  return out;
}
