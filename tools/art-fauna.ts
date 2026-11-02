// 校园动物（目录见 shared/fauna.ts）：物种 × 花色 × 动作 × 屏幕朝向 × 帧出一张图，锚点在脚底中心（飞行帧是身体下沿中心，离地高度由场景加）。
// 现在是占位色块，正式美术按 docs/codex/TASK-08-fauna.md 画。
import { FAUNA, faunaKey } from '../shared/fauna.ts';
import type { PalKey } from './palette.ts';
import { Pix, type Sprite } from './pix.ts';

const BODY: Record<string, PalKey> = { magpie: 'slate', sparrow: 'brick1', cat: 'gold', dog: 'beige1' };

export function drawFauna(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const s of FAUNA)
    s.variants.forEach((_, v) => {
      for (const [state, n] of Object.entries(s.states))
        for (let d = 0; d < 4; d++)
          for (let f = 0; f < n; f++) {
            const [bw, bh] = d === 0 || d === 3 ? [Math.ceil(s.box[0] * 0.6), s.box[1]] : s.box;
            const p = new Pix(bw + 2, bh + 2);
            p.rect(1, 1 + (f % 2), bw, bh - 1, BODY[s.id]);
            p.outline('ink');
            out[faunaKey(s.id, v, state, d, f)] = { pix: p, ax: 1 + Math.floor(bw / 2), ay: bh };
          }
    });
  return out;
}
