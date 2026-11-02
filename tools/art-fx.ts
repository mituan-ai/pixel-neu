// 光照和天气特效：尺寸和画法见 docs/codex/TASK-09-light.md。
import { FX } from '../shared/fx.ts';
import { Pix, type Sprite } from './pix.ts';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function drawFx(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const name of FX) {
    if (name === 'lamp-glow' || name === 'lamp-glow-small') {
      const r = name === 'lamp-glow' ? 40 : 20, p = new Pix(r * 2, r * 2);
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
          const density = Math.min(1, (r - d) / (r - 8));
          if (density > (BAYER[y % 4][x % 4] + 0.5) / 16) p.px(x, y, 'flowerY');
        }
      out[name] = { pix: p, ax: r, ay: r };
    } else if (name === 'door-glow') {
      const p = new Pix(24, 16);
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const d = Math.hypot((x + 0.5 - 12) / 12, (y + 0.5) / 16);
          const density = Math.min(1, (1 - d) / 0.8);
          if (density > (BAYER[y % 4][x % 4] + 0.5) / 16) p.px(x, y, 'flowerY');
        }
      out[name] = { pix: p, ax: 12, ay: 0 };
    } else if (name.startsWith('rain-')) {
      const h = [4, 6, 9][Number(name.slice(-1))], w = 2 + Math.floor((h - 1) / 3), p = new Pix(w, h);
      for (let y = 0; y < h; y++) p.hline(Math.floor(y / 3), y, 2, 'water2');
      p.px(w - 1, h - 1, 'glass2');
      out[name] = { pix: p, ax: Math.floor(w / 2), ay: Math.floor(h / 2) };
    } else if (name.startsWith('splash-')) {
      const p = new Pix(7, 3), frame = Number(name.slice(-1));
      if (frame === 0) p.px(3, 1, 'water2');
      else if (frame === 1) {
        p.px(3, 0, 'water2');
        p.px(2, 1, 'water2');
        p.px(4, 1, 'water2');
        p.px(3, 2, 'glass2');
      } else {
        p.hline(2, 0, 3, 'water2');
        p.px(0, 1, 'water2');
        p.px(6, 1, 'water2');
        p.px(1, 2, 'glass2');
        p.px(5, 2, 'glass2');
      }
      out[name] = { pix: p, ax: 3, ay: 1 };
    } else {
      const s = [1, 2, 3, 5][Number(name.slice(-1))], p = new Pix(s, s), c = s >> 1;
      if (s <= 2) p.rect(0, 0, s, s, 'white');
      else if (s === 3) {
        p.hline(0, c, s, 'stone3');
        p.vline(c, 0, s, 'stone3');
        p.px(c, c, 'white');
      } else {
        const rows = ['  #  ', '# # #', ' ### ', '# # #', '  #  '];
        rows.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch === '#') p.px(x, y, y === c ? 'white' : 'stone3');
        }));
      }
      out[name] = { pix: p, ax: c, ay: c };
    }
  }
  return out;
}
