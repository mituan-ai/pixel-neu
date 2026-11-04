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
      for (const p of [b, ...(b.parts ?? [])]) {
        if (p.lift === undefined) continue;
        expect(typeof p.lift, `楼 ${id} 的 lift`).toBe('number');
        expect(p.lift, `楼 ${id} 的 lift`).toBeGreaterThanOrEqual(0);
        expect(p.lift, `楼 ${id} 的 lift`).toBeLessThan(p.height ?? (p.storeys ?? b.storeys ?? 4) * 3.6);
      }
      if (b.like !== undefined) {
        // 参照的楼要存在、有自己的楼型（不能再是参照来的）
        const ref = entries.find(([k]) => k === String(b.like))?.[1];
        expect(ref?.look, `楼 ${id} 参照的楼 ${b.like}`).toBeDefined();
        expect(ref?.like, `楼 ${id} 参照的楼 ${b.like} 本身也是参照来的`).toBeUndefined();
      }
      for (const f of b.features ?? []) {
        expect(['stair', 'void', 'screen', 'glass', 'colonnade', 'band'], `楼 ${id}`).toContain(f.kind);
        expect('NESW', `楼 ${id} 的 face`).toContain(f.face);
        if (f.kind === 'band') expect(RAMPS, `楼 ${id} 的饰面 ${f.color}`).toHaveProperty(f.color!);
        if (f.storeys) expect(f.storeys[0] <= f.storeys[1], `楼 ${id} 的 storeys`).toBe(true);
      }
    }
  });
});

describe('survey.json', () => {
  it('每个数组的条目都是这个数组的写法（并行任务合并时容易接错数组）', () => {
    const MARKS = new Set(['zebra', 'stop', 'arrow', 'bump']);
    for (const a of survey.areas) expect(MARKS.has(a.kind), `areas 里的 ${JSON.stringify(a)}`).toBe(false);
    for (const m of survey.marks) expect(MARKS.has(m.kind), `marks 里的 ${JSON.stringify(m)}`).toBe(true);
    const need: [keyof typeof survey, string][] = [['doors', 'facing'], ['bikeRacks', 'from'], ['stalls', 'back'], ['treeRows', 'gap'], ['lampRows', 'gap'], ['props', 'sprite'], ['gates', 'width'], ['places', 'text'], ['newBuildings', 'storeys']];
    for (const [k, f] of need) for (const x of survey[k] as object[]) expect(x, `${k} 里的 ${JSON.stringify(x)}`).toHaveProperty(f);
  });
});
