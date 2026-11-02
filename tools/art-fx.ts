// 光照和天气特效（目录见 shared/fx.ts）。现在是占位色块，正式美术按 docs/codex/TASK-09-light.md 画。
import { FX } from '../shared/fx.ts';
import { Pix, type Sprite } from './pix.ts';

export function drawFx(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const name of FX) {
    const s = name.includes('glow') ? 16 : 4;
    const p = new Pix(s, s);
    p.rect(0, 0, s, s, 'flowerY');
    out[name] = { pix: p, ax: s >> 1, ay: s >> 1 };
  }
  return out;
}
