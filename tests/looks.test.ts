import { describe, expect, it } from 'vitest';
import { LOOKS, RAMPS } from '../tools/facades.ts';
import { PAL } from '../tools/palette.ts';
import { loadSurvey } from '../tools/survey.ts';

const survey = loadSurvey();
const entries = [...Object.entries(survey.buildings), ...survey.newBuildings.map((b, k) => [String(-(k + 1)), b] as const)];

describe('楼型', () => {
  it('楼型和饰面只用色板里的颜色', () => {
    for (const [name, l] of Object.entries(LOOKS))
      for (const c of [...l.wall, ...l.roof, l.base, l.frame, l.bands, l.spandrel, l.cornice])
        if (c !== null) expect(PAL, `${name} 的 ${c}`).toHaveProperty(c);
    for (const r of Object.values(RAMPS)) for (const c of r) expect(PAL).toHaveProperty(c);
  });

  it('survey 里的楼型、微调和构件都写对了', () => {
    const keys = new Set(Object.keys(LOOKS.neutral));
    for (const [id, b] of entries) {
      const looks = [b.look, ...(b.parts ?? []).map((p) => p.look)].filter((l) => l !== undefined);
      for (const l of looks) expect(LOOKS, `楼 ${id} 的楼型 ${l}`).toHaveProperty(l!);
      for (const k of Object.keys(b.tweak ?? {})) expect(keys.has(k), `楼 ${id} 的 tweak.${k}`).toBe(true);
      for (const f of b.features ?? []) {
        expect(['stair', 'void', 'screen', 'glass', 'colonnade', 'band'], `楼 ${id}`).toContain(f.kind);
        expect('NESW', `楼 ${id} 的 face`).toContain(f.face);
        if (f.kind === 'band') expect(RAMPS, `楼 ${id} 的饰面 ${f.color}`).toHaveProperty(f.color!);
        if (f.storeys) expect(f.storeys[0] <= f.storeys[1], `楼 ${id} 的 storeys`).toBe(true);
      }
    }
  });
});
