// 动物目录：物种、花色、动作和帧数。美术按它出图（tools/art-fauna.ts），场景按它生成校园里的动物。
// 动物和人一样按 Q 版比例画（人全身约 26 px），不按 1 m = 8 px：真实尺寸的麻雀只有 1 px。
import { SCREEN_DIRS } from './vehicles.ts';

export interface Species {
  id: string;
  name: string;
  /** 花色名，序号就是图集键里的花色号 */
  variants: string[];
  /** 动作 → 帧数 */
  states: Record<string, number>;
  /** 身体外框的大致像素宽高（朝左右时），各动作、朝向都以它为准 */
  box: [number, number];
}

export const FAUNA: Species[] = [
  { id: 'magpie', name: '喜鹊', variants: ['喜鹊'], states: { stand: 2, hop: 3, fly: 4, perch: 2 }, box: [12, 9] },
  { id: 'sparrow', name: '麻雀', variants: ['麻雀'], states: { stand: 2, hop: 2, fly: 2 }, box: [6, 5] },
  { id: 'cat', name: '猫', variants: ['橘猫', '狸花猫', '奶牛猫', '三花猫', '黑猫', '白猫'], states: { walk: 4, run: 4, sit: 2, sleep: 2 }, box: [14, 10] },
  { id: 'dog', name: '狗', variants: ['黄狗', '黑狗'], states: { walk: 4, run: 4, sit: 2, lie: 2 }, box: [18, 13] },
];

/** 图集 assets/fauna.json 里的键；朝向是屏幕朝向（下、左、右、上） */
export const faunaKey = (id: string, variant: number, state: string, dir: number, frame: number) => `${id}-${variant}-${state}-${SCREEN_DIRS[dir]}-${frame}`;

/** 目录要求的全部图集键 */
export function faunaKeys(): string[] {
  const keys: string[] = [];
  for (const s of FAUNA)
    s.variants.forEach((_, v) => {
      for (const [state, n] of Object.entries(s.states)) for (let d = 0; d < 4; d++) for (let f = 0; f < n; f++) keys.push(faunaKey(s.id, v, state, d, f));
    });
  return keys;
}
