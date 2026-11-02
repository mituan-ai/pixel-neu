// 校园动物：Q 版四向动画，脚底锚点固定，飞行和栖枝锚点在身体下沿。
import { FAUNA, faunaKey } from '../shared/fauna.ts';
import type { PalKey } from './palette.ts';
import { Pix, type Sprite } from './pix.ts';

const COATS: [PalKey, PalKey, PalKey][] = [
  ['faunaGinger', 'faunaGingerLight', 'brick0'],
  ['beige1', 'beige2', 'trunk'],
  ['flowerW', 'white', 'grey1'],
  ['flowerW', 'white', 'grey1'],
  ['slate', 'glass1', 'ink'],
  ['flowerW', 'white', 'grey1'],
];

/** 去掉空边，保留落脚点和跳跃时的离地间距。 */
function framed(p: Pix, ax: number, ay: number): Sprite {
  p.outline('ink');
  let x0 = ax, x1 = ax, y0 = ay, y1 = ay;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++)
    if (p.opaque(x, y)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  const pix = new Pix(x1 - x0 + 1, y1 - y0 + 1);
  pix.blit(p, -x0, -y0);
  return { pix, ax: ax - x0, ay: ay - y0 };
}

/** 麻雀的小体型和啄食、跳跃、双帧振翅。 */
function sparrow(state: string, d: number, f: number): Sprite {
  const p = new Pix(18, 18), side = d === 1 || d === 2;
  const x = (u: number) => d === 2 ? 16 - u : u;
  const dot = (u: number, y: number, c: PalKey) => p.px(x(u), y, c);
  const jump = state === 'hop' && f === 0 ? 2 : 0, b = 13 - jump;
  p.ellipse(8, b - 2, side ? 2 : 1, 1, 'brick1');
  if (side) dot(11, b - 2, 'trunk');
  if (state === 'fly') {
    const sign = f === 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      dot(8 + (side ? 0 : k + 1), b - 3 + sign * k, 'trunk');
      if (!side) dot(7 - k, b - 3 + sign * k, 'brick1');
    }
  } else dot(9, b - 3, 'trunk');
  dot(8, b - 1, 'stone3'); dot(9, b - 2, 'trunk');
  const hx = side ? 6 : 8, hy = b - 3 + (state === 'stand' && f === 1 ? 2 : 0);
  dot(hx, hy - 1, 'brick0'); dot(hx + 1, hy - 1, 'brick1');
  dot(hx, hy, d === 3 ? 'brick1' : 'flowerW'); dot(hx + 1, hy, 'ink');
  if (d !== 3) dot(hx - 1, hy, 'ink');
  if (state !== 'fly') { dot(7, b, 'ink'); dot(9, b, 'ink'); }
  return framed(p, 8, state === 'fly' ? b - 1 : 14);
}

/** 喜鹊的黑白翼斑、长尾和四种动作。 */
function magpie(state: string, d: number, f: number): Sprite {
  const p = new Pix(36, 32), side = d === 1 || d === 2, right = d === 2;
  const fly = state === 'fly', perch = state === 'perch';
  const jump = state === 'hop' ? [0, 2, 0][f] : 0, b = 20 - jump, cx = 17;
  const x = (u: number) => right ? 34 - u : u;
  const dot = (u: number, y: number, c: PalKey) => p.px(x(u), y, c);
  const rect = (u: number, y: number, w: number, h: number, c: PalKey) => p.rect(right ? x(u) - w + 1 : u, y, w, h, c);
  const oval = (u: number, y: number, rx: number, ry: number, c: PalKey) => p.ellipse(x(u), y, rx, ry, c);
  const lift = state === 'stand' && f === 1 ? 2 : 0;
  if (side) {
    for (let k = 0; k < 7; k++) rect(19 + (perch ? Math.floor(k / 2) : k), b - 4 + (perch ? k : -Math.floor(k / 3) - lift), 2, 2, 'slate');
    dot(21, b - 5 + (perch ? 4 : -lift), 'bikeCyan');
    dot(23, b - 5 + (perch ? 6 : -lift), 'water0');
  } else {
    const tailY = d === 3 ? b - 11 - lift : b - 4 - lift;
    rect(cx, tailY, 2, perch ? 9 : 7, 'slate');
    dot(cx, tailY + 1, 'bikeCyan');
  }
  if (side) {
    oval(17, b - 4, 3, 3, 'slate');
    rect(15, b - 3, 4, 2, 'flowerW');
  } else {
    p.ellipse(cx, b - 4, 2, 3, 'slate');
    if (d === 0) p.rect(cx - 1, b - 3, 3, 2, 'flowerW');
  }
  if (fly) {
    if (side) {
      if (f === 0) {
        rect(17, b - 10, 2, 6, 'slate'); rect(18, b - 9, 2, 5, 'slate');
        rect(17, b - 9, 1, 4, 'flowerW');
      } else if (f === 1) {
        rect(17, b - 6, 7, 2, 'slate'); rect(18, b - 5, 6, 2, 'flowerW');
        dot(23, b - 6, 'grey2');
      } else if (f === 2) {
        rect(17, b - 4, 3, 6, 'slate'); rect(18, b - 3, 1, 4, 'flowerW');
      } else {
        oval(18, b - 4, 2, 1, 'slate'); rect(17, b - 4, 2, 1, 'flowerW');
      }
    } else {
      const span = [3, 7, 4, 2][f];
      for (const sign of [-1, 1]) for (let k = 1; k <= span; k++) {
        const y = b - 5 + (f === 0 ? -k : f === 2 ? k : 0);
        p.rect(cx + sign * (k + 1), y, 1, 2, 'slate');
        if (k > 1) p.px(cx + sign * (k + 1), y + 1, 'flowerW');
      }
    }
  } else if (side) {
    oval(18, b - 4, 2, 1, 'slate'); rect(17, b - 5, 3, 1, 'flowerW');
  } else if (d === 3) {
    p.vline(cx - 1, b - 5, 3, 'flowerW'); p.vline(cx + 1, b - 5, 3, 'flowerW');
  }
  const turn = perch && f === 1, hx = side ? 14 : cx + (turn ? 1 : 0), hy = b - 7;
  oval(hx, hy, 2, 2, 'slate');
  p.px(x(hx) - 1, hy - 1, 'glass1');
  if (d !== 3 || turn) {
    if (side && !turn) { dot(hx - 3, hy, 'ink'); dot(hx - 1, hy, 'white'); }
    else if (turn && !side) {
      p.px(hx + 2, hy, 'ink'); p.px(hx + 1, hy, 'white');
    } else {
      p.px(x(hx) - 1, hy, 'white'); p.px(x(hx) + 1, hy, 'white');
      p.px(x(hx), hy + 1, 'ink');
    }
  }
  if (!fly && !perch) for (const u of state === 'hop' && f < 2 ? [16, 17] : side ? [16, 18] : [cx - 1, cx + 1]) dot(u, b, 'ink');
  return framed(p, cx, fly || perch ? b - 1 : 21);
}

/** 猫和田园犬的花色、四足步态与休息姿势。 */
function mammal(dog: boolean, v: number, state: string, d: number, f: number): Sprite {
  const p = new Pix(34, 28), side = d === 1 || d === 2, right = d === 2;
  const [base, light, dark]: [PalKey, PalKey, PalKey] = dog ? (v ? COATS[4] : ['gold', 'flowerY', 'bronze1']) : COATS[v];
  const run = state === 'run', sit = state === 'sit', rest = state === 'sleep' || state === 'lie';
  const b = 23, cx = 16, bob = run && f % 2 === 1 ? 1 : 0;
  const x = (u: number) => right ? 32 - u : u;
  const rect = (u: number, y: number, w: number, h: number, c: PalKey) => p.rect(right ? x(u) - w + 1 : u, y, w, h, c);
  const dot = (u: number, y: number, c: PalKey) => p.px(x(u), y, c);
  const oval = (u: number, y: number, rx: number, ry: number, c: PalKey) => p.ellipse(x(u), y, rx, ry, c);
  const torsoY = rest ? b - 3 - (!dog && f === 1 ? 1 : 0) : sit ? b - 3 : b - (dog ? 5 : 4) - bob;
  const bodyX = side ? 16 : cx;
  const rx = side ? (dog ? 5 : 4) + (run ? 1 : 0) : (dog ? 3 : 2);
  const ry = rest ? 2 : sit ? (dog ? 4 : 3) : dog ? 3 : 2;
  let hx = side ? (sit ? 14 : 10) : cx;
  let hy = rest ? b - 3 : sit ? b - (dog ? 9 : 7) : b - (dog ? 8 : 6) - bob;
  if (rest && !dog) { hx = side ? 12 : cx - 2; hy = b - 3; }
  if (rest && dog) hy = b - 3;
  // 犬尾上卷，猫尾细长。
  const tailX = side ? 21 + (dog ? 1 : 0) + (dog && sit ? f : 0) : cx + (f === 1 ? -2 : 2);
  if (dog) {
    oval(tailX, torsoY - 2, 1, 2, base); dot(tailX - 1, torsoY - 4, light);
  } else if (sit || rest) {
    rect(side ? 16 : cx, b - 1, 5, 1, base); dot(side ? 21 : cx + 5, b - 1 - f, dark);
  } else {
    rect(side ? 20 : tailX, torsoY - 3, 1, 4, base); dot(side ? 19 : tailX - 1, torsoY - 4, base);
  }
  if (!rest && !sit) {
    const stride = run ? [-2, 1, 2, -1] : [-1, 0, 1, 0];
    for (let leg = 0; leg < 4; leg++) {
      const phase = (f + [0, 2, 2, 0][leg]) % 4, step = stride[phase];
      const u = side ? (leg < 2 ? 12 : 19) + step : cx + (leg % 2 ? 2 : -2);
      const y = b - (run && f % 2 ? 1 : 0) - (!side && leg < 2 ? 1 : 0) - (step > 0 || phase === 1 ? 1 : 0);
      rect(u, torsoY + 1, 1, y - torsoY, leg % 2 ? base : dark);
      dot(u + (side ? (step < 0 ? -1 : 0) : 0), y, leg % 2 ? light : dark);
    }
  } else {
    rect(side ? 10 : cx - 2, b - 1, dog ? 5 : 3, 1, light);
    if (!side) rect(cx + 1, b - 1, 2, 1, base);
  }
  oval(bodyX, torsoY, sit && side ? rx - 1 : rx, ry, base);
  // 花斑只覆盖已有被毛，亮面始终留在屏幕左上。
  const coat = (u: number, y: number, c: PalKey) => { if (p.opaque(x(u), y)) dot(u, y, c); };
  for (let yy = torsoY - ry; yy < torsoY + ry; yy++) for (let u = bodyX - rx; u <= bodyX + rx; u++) {
    if (!dog && (v === 0 || v === 1) && (u + (yy > torsoY ? 1 : 0)) % 4 === 0 && yy < torsoY + 1) coat(u, yy, dark);
    if (!dog && v === 2 && ((u < bodyX - 1 && yy <= torsoY) || u > bodyX + 2)) coat(u, yy, 'slate');
    if (!dog && v === 3 && yy < torsoY + 1 && (u < bodyX || u > bodyX + 2)) coat(u, yy, u < bodyX ? 'faunaGinger' : 'slate');
    if (yy === torsoY - ry + 1 && x(u) < x(bodyX) + 1 && (dog || v === 4 || v === 5)) coat(u, yy, light);
  }
  if (d === 0 && !rest) rect(cx - 1, torsoY, 3, 2, dog && v === 1 ? 'grey1' : 'stone3');
  const headR = dog ? 3 : 2;
  oval(hx, hy, headR, 2, base);
  const earY = hy - 3;
  for (const u of [hx - headR + 1, hx + headR - 1]) {
    dot(u, earY - (dog && rest && f === 1 ? 1 : 0), base); dot(u, earY + 1, dog ? dark : 'carPink1');
  }
  if (!dog && (v === 0 || v === 1)) { dot(hx, hy - 2, dark); dot(hx + 1, hy - 1, dark); }
  if (!dog && (v === 2 || v === 3)) {
    rect(hx - 2, hy - 1, 2, 2, v === 3 ? 'faunaGinger' : 'slate');
    if (v === 3) dot(hx + 1, hy - 2, 'slate');
  }
  p.px(x(hx) - 1, hy - 1, light);
  if (d !== 3) {
    if (side) {
      dot(hx - headR, hy + 1, dog ? (v ? 'grey1' : 'beige3') : 'stone3');
      dot(hx - headR - 1, hy + 1, 'ink');
      dot(hx - 1, hy, rest ? 'ink' : v === 4 || (dog && v === 1) ? 'flowerY' : 'ink');
      if (rest) dot(hx, hy, 'ink');
    } else {
      if (rest) { p.hline(cx - 2, hy, 2, 'ink'); p.hline(cx + 1, hy, 2, 'ink'); }
      else {
        p.px(cx - 1, hy, v === 4 || (dog && v === 1) ? 'flowerY' : 'ink');
        p.px(cx + 1, hy, v === 4 || (dog && v === 1) ? 'flowerY' : 'ink');
      }
      p.px(cx, hy + 1, 'ink');
    }
  }
  return framed(p, side ? 15 : cx, b + 1);
}

export function drawFauna(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const s of FAUNA)
    s.variants.forEach((_, v) => {
      for (const [state, n] of Object.entries(s.states))
        for (let d = 0; d < 4; d++)
          for (let f = 0; f < n; f++)
            out[faunaKey(s.id, v, state, d, f)] = s.id === 'magpie' ? magpie(state, d, f)
              : s.id === 'sparrow' ? sparrow(state, d, f) : mammal(s.id === 'dog', v, state, d, f);
    });
  return out;
}
