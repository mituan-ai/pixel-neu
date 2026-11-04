// 树种与比例据 S50–S59；林地混种是推定，见 docs/sources.md。
export interface Species {
  id: string;
  name: string;
  kind: 'broad' | 'conifer' | 'shrub';
  evergreen: boolean;
  /** 冠幅半径（分米） */
  sizes: number[];
  variants: number;
  /** 树高、冠心高与冠幅半径之比 */
  height: number;
  crown: number;
}

export const SPECIES: Species[] = [
  { id: 'pine', name: '油松', kind: 'conifer', evergreen: true, sizes: [25, 30, 35], variants: 4, height: 3.4, crown: 2.1 },
  { id: 'spruce', name: '红皮云杉', kind: 'conifer', evergreen: true, sizes: [20, 25, 30], variants: 4, height: 4.5, crown: 2.5 },
  { id: 'poplar', name: '杨树', kind: 'broad', evergreen: false, sizes: [25, 30, 40], variants: 4, height: 5.2, crown: 3.1 },
  { id: 'willow', name: '柳树', kind: 'broad', evergreen: false, sizes: [25, 30, 40], variants: 4, height: 3.4, crown: 2.1 },
  { id: 'elm', name: '榆树', kind: 'broad', evergreen: false, sizes: [25, 30, 40], variants: 4, height: 3.3, crown: 2.2 },
  { id: 'ginkgo', name: '银杏', kind: 'broad', evergreen: false, sizes: [25, 30, 40], variants: 4, height: 4.2, crown: 2.6 },
  { id: 'lilac', name: '紫丁香', kind: 'shrub', evergreen: false, sizes: [8, 12, 15], variants: 4, height: 1.8, crown: 0.9 },
];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 北京时间按 S51 沈阳物候概括为 4/15 萌叶、5/15 深绿、9/25 秋色、11/5 落光，日期是统一显示的估值。 */
export function season(t: Date): Season {
  const day = new Date(t.getTime() + 8 * 3600_000);
  const md = (day.getUTCMonth() + 1) * 100 + day.getUTCDate();
  return md < 415 || md >= 1105 ? 'winter' : md < 515 ? 'spring' : md < 925 ? 'summer' : 'autumn';
}

/** 树的贴图名，常绿树只用夏季帧。 */
export function treeFrame(species: string, size: number, variant: number, s: Season): string {
  const tree = SPECIES.find((t) => t.id === species)!;
  return `${species}-${size}-${variant}${tree.evergreen || s === 'summer' ? '' : `~${s}`}`;
}

/** 树贴图名对应的树种、冠幅与变体。 */
export function parseTree(name: string): { species: Species; size: number; variant: number } | null {
  const m = /^([a-z]+)-(\d+)-(\d+)(?:~(?:spring|autumn|winter))?$/.exec(name);
  if (!m) return null;
  const species = SPECIES.find((t) => t.id === m[1]);
  const size = Number(m[2]), variant = Number(m[3]);
  return species && species.sizes.includes(size) && variant < species.variants ? { species, size, variant } : null;
}
