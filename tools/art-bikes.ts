// 自行车和共享单车（目录见 shared/vehicles.ts，group 是 bike、share 的车型），图集键和锚点同 art-vehicles.ts。
import { VEHICLES, vehicleKey, type VehicleKind } from '../shared/vehicles.ts';
import { METERS_PER_TILE, TILE } from '../shared/world.ts';
import type { PalKey } from './palette.ts';
import { Pix, type Sprite } from './pix.ts';

const PPM = TILE / METERS_PER_TILE;

const BODY: Record<string, [PalKey, PalKey, PalKey]> = {
  黑: ['grey0', 'slate', 'ink'], 蓝: ['water1', 'carPlateB', 'glass0'],
  红: ['flowerR', 'brick0', 'bronze0'], 银: ['grey3', 'grey2', 'grey0'],
  白: ['stone3', 'stone2', 'stone0'], 粉: ['flowerP', 'carPink1', 'carPink0'],
  绿: ['grass3', 'grass2', 'leaf0'], 黄: ['flowerY', 'gold', 'brick0'],
  青: ['bikeCyan', 'pine2', 'pine0'],
};

/** 按目录尺寸画停放的四向自行车。 */
function bike(v: VehicleKind, paint: number, dir: number): Sprite {
  const [L, W, H] = v.size.map((m) => Math.round(m * PPM));
  const along = dir === 0 || dir === 3;
  const sw = along ? W : L, sd = along ? L : W, gy = H + 1;
  const p = new Pix(sw + 2, sd + H + 2);
  const [top, side, dark] = BODY[v.paints[paint]];
  const electric = v.id.startsWith('share-e-'), basket = v.id !== 'bike-m';
  const yellow = v.paints[paint] === '黄';
  const basketTop: PalKey = yellow ? top : 'stone3';
  const basketSide: PalKey = yellow ? side : 'grey1';
  const ax = 1 + Math.floor(sw / 2), ay = gy + Math.floor(sd / 2);

  // 车轮直径取任务单的 5 px，部件比例按通用车架概括，非实车测量。
  if (!along) {
    const ground = ay, rear = 2, front = L - 3, crank = Math.round(L * 0.43);
    const seat = crank - 2, head = front - 2;
    const x = (u: number, z: number) => 1 + (dir === 2 ? u : L - 1 - u) - (z >= H - 2 ? 1 : 0);
    const dot = (u: number, z: number, c: PalKey) => p.px(x(u, z), ground - z, c);
    const line = (u0: number, z0: number, u1: number, z1: number, c: PalKey) => {
      const n = Math.max(Math.abs(u1 - u0), Math.abs(z1 - z0));
      for (let i = 0; i <= n; i++) dot(Math.round(u0 + (u1 - u0) * i / n), Math.round(z0 + (z1 - z0) * i / n), c);
    };
    line(rear, 2, seat, H - 2, top);
    line(seat, H - 2, crank, 2, side);
    line(rear, 2, crank, 2, dark);
    line(crank, 2, head, H - 2, top);
    line(head, H - 2, front, 2, side);
    if (v.id === 'bike-m') line(seat, H - 2, head, H - 2, top);
    else {
      line(seat, H - 2, seat + 1, 3, side);
      line(seat + 1, 3, head - 1, 3, top);
      line(head - 1, 3, head, H - 2, top);
    }
    line(head, H - 2, head, H, 'grey2');
    line(seat, H - 2, seat, H - 1, 'grey1');
    // 挡泥板在轮胎上方，青车和黄车沿用车架色。
    for (const u of [rear, front]) for (let i = -1; i <= 1; i++) dot(u + i, 5, top);
    p.outline('ink');

    // 轮圈保留镂空，外缘直接用 ink，不再加粗。
    for (const u of [rear, front]) {
      const cx = x(u, 2), cy = ground - 2;
      for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
        p.data[((cy + yy) * p.w + cx + xx) * 4 + 3] = 0;
        if ((Math.abs(xx) === 2 && Math.abs(yy) < 2) || (Math.abs(yy) === 2 && Math.abs(xx) < 2))
          p.px(cx + xx, cy + yy, 'ink');
      }
      p.px(cx - 1, cy - 1, 'grey2');
      p.px(cx, cy, 'grey0');
    }
    const sx = x(seat, H - 1), sy = ground - H + 1;
    p.rect(sx - 1, sy - 1, electric ? 5 : 4, 2, 'ink');
    p.hline(sx, sy - 1, electric ? 3 : 2, 'slate');
    const hx = x(head, H), hy = ground - H;
    p.hline(hx - 1, hy, 3, 'ink');
    p.px(hx - 1, hy - 1, 'grey2');
    if (electric) {
      const bx = Math.min(x(seat, 4), x(crank, 4));
      p.rect(bx, ground - 7, 4, 4, 'ink');
      p.rect(bx + 1, ground - 6, 2, 2, side);
      p.hline(bx + 1, ground - 6, 2, top);
    }
    if (basket) {
      const bw = electric ? 5 : 4, bh = electric ? 4 : 3;
      const bx = dir === 2 ? L + 1 - bw : 1, by = ground - H;
      p.rect(bx, by, bw, bh, 'ink');
      p.rect(bx + 1, by + 1, bw - 2, bh - 2, basketSide);
      p.px(bx + 1, by + 1, basketTop);
    }
    const cx = x(crank, 2);
    p.px(cx, ground - 2, 'grey2');
    p.hline(cx - 1, ground - 1, 3, 'ink');
    p.px(cx + 1, ground, 'ink');
    p.px(cx + 2, ground + 1, 'ink');
  } else {
    const cx = ax, q = (t: number) => dir === 0 ? L - 1 - t : t;
    const front = 2, rear = L - 3, seat = Math.round(L * 0.62);
    // 纵向轮胎和车架保持窄线，车把含描边共 5 px。
    for (const t of [front, rear]) p.vline(cx, gy + q(t) - 4, 5, 'ink');
    p.rect(cx - 1, gy, 3, L - 6, 'ink');
    p.vline(cx, gy, L - 6, top);
    const parts = [
      { t: front, z: 5, kind: 'fender' }, { t: rear, z: 5, kind: 'fender' },
      { t: front + 1, z: H, kind: 'handle' }, { t: seat, z: H - 1, kind: 'seat' },
    ];
    if (electric) parts.push({ t: seat, z: 4, kind: 'battery' });
    if (basket) parts.push({ t: front, z: H - 1, kind: 'basket' });
    parts.sort((a, b) => q(a.t) + a.z - q(b.t) - b.z);
    for (const part of parts) {
      const y = gy + q(part.t) - part.z, x = cx;
      if (part.kind === 'fender') {
        p.rect(x - 1, y - 1, 3, 4, 'ink');
        p.vline(x, y, 2, top);
      } else if (part.kind === 'handle') {
        p.hline(x - 2, y, 5, 'ink');
        p.hline(x - 1, y, 3, 'grey2');
      } else if (part.kind === 'seat') {
        p.rect(x - 1, y, electric ? 4 : 3, 3, 'ink');
        p.hline(x, y, electric ? 2 : 1, 'slate');
      } else if (part.kind === 'battery') {
        p.rect(x - 1, y, 3, 4, 'ink');
        p.vline(x, y + 1, 2, top);
      } else {
        const bw = electric ? 5 : 3, bh = electric ? 4 : 3;
        p.rect(x - Math.floor(bw / 2), y, bw, bh, 'ink');
        p.rect(x - Math.floor(bw / 2) + 1, y + 1, bw - 2, bh - 2, basketTop);
        if (electric) p.hline(x - Math.floor(bw / 2) + 1, y + bh - 2, bw - 2, basketSide);
      }
    }
  }
  return { pix: p, ax, ay };
}

export function drawBikes(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const v of VEHICLES.filter((v) => v.group === 'bike' || v.group === 'share'))
    v.paints.forEach((_, p) => {
      for (let d = 0; d < 4; d++) for (let f = 0; f < v.frames; f++) out[vehicleKey(v.id, p, d, f)] = bike(v, p, d);
    });
  return out;
}
