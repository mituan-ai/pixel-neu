// 生态和界面素材与目录对得上：npm run art 之后跑，缺图、多图都会报出来
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPECIES, treeFrame, type Season } from '../shared/flora.ts';
import { faunaKeys } from '../shared/fauna.ts';
import { FX } from '../shared/fx.ts';
import { ICONS, SKINS } from '../shared/icons.ts';
import { vehicleKeys } from '../shared/vehicles.ts';
import { PAL } from '../tools/palette.ts';
import { decodePNG } from '../tools/pix.ts';

const meta = (name: string) => JSON.parse(readFileSync(new URL(`../assets/${name}.json`, import.meta.url), 'utf8')) as Record<string, { w: number; h: number; ax: number; ay: number }>;

describe('素材目录', () => {
  for (const [name, keys] of [
    ['vehicles', vehicleKeys()],
    ['fauna', faunaKeys()],
    ['ui', [...ICONS, ...SKINS]],
    ['fx', FX],
  ] as const)
    it(`${name}.json 和目录一一对应`, () => {
      expect(Object.keys(meta(name)).sort()).toEqual([...keys].sort());
    });

  it('树种的全部尺寸、变体和季节都有帧且只用色板颜色', () => {
    const frames = JSON.parse(readFileSync(new URL('../assets/props.json', import.meta.url), 'utf8')) as Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }>;
    const { w, h, data } = decodePNG(readFileSync(new URL('../assets/props.png', import.meta.url)));
    const pal = new Set<number>(Object.values(PAL));
    expect(w).toBeLessThanOrEqual(2048);
    expect(h).toBeLessThanOrEqual(2048);
    expect(readFileSync(new URL('../assets/props.png', import.meta.url)).length).toBeLessThanOrEqual(600 * 1024);
    for (const t of SPECIES) for (const size of t.sizes) for (let v = 0; v < t.variants; v++) {
      const seasons: Season[] = t.evergreen ? ['summer'] : ['spring', 'summer', 'autumn', 'winter'];
      for (const s of seasons) {
        const name = treeFrame(t.id, size, v, s), m = frames[name];
        expect(m, name).toBeDefined();
        expect(m.ax, name).toBeGreaterThanOrEqual(0);
        expect(m.ax, name).toBeLessThan(m.w);
        expect(m.ay, name).toBeLessThan(m.h);
        const bad = new Set<string>();
        for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) {
          const i = (y * w + x) * 4;
          if (!data[i + 3]) continue;
          const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          if (data[i + 3] !== 255 || !pal.has(c)) bad.add(`#${c.toString(16).padStart(6, '0')}/${data[i + 3]}`);
        }
        expect([...bad], name).toEqual([]);
      }
    }
  });

  it('锚点落在图内', () => {
    for (const name of ['vehicles', 'fauna'])
      for (const [k, m] of Object.entries(meta(name))) {
        expect(m.ax, k).toBeGreaterThanOrEqual(0);
        expect(m.ax, k).toBeLessThan(m.w);
        expect(m.ay, k).toBeLessThan(m.h);
      }
  });

  it('只用色板颜色，没有半透明', () => {
    const pal = new Set<number>(Object.values(PAL));
    for (const name of ['vehicles', 'fauna', 'ui', 'fx']) {
      const { data } = decodePNG(readFileSync(new URL(`../assets/${name}.png`, import.meta.url)));
      const bad = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        if (data[i + 3] !== 255 || !pal.has(c)) bad.add(`#${c.toString(16).padStart(6, '0')}/${data[i + 3]}`);
      }
      expect([...bad], name).toEqual([]);
    }
  });
});
