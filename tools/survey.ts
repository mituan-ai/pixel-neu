// data/survey.json：从卫星图（S7）描下来的地面与树，坐标都是世界米坐标（上北，见 geo.ts）。
// 后写的面盖住先写的面，所以先写大面（草地、林地），再写路和铺装。
import { readFileSync } from 'node:fs';
import type { P } from './geo.ts';

/** wood：林地，地面是草，树冠按轮廓成片；单棵树看不清的林子都用它 */
/** track：塑胶跑道；pitch：足球场草皮（天然或人工）；court：硬地球场 */
export type AreaKind = 'asphalt' | 'paving' | 'parking' | 'grass' | 'wood' | 'hedge' | 'planter' | 'water' | 'track' | 'pitch' | 'court';

export interface Survey {
  /**
   * OSM 楼轮廓的校正（米）。卫星图是斜着拍的，楼顶会偏离楼基，楼越高偏得越多，OSM 描的轮廓常常歪在楼顶上：
   * - shift：轮廓只描了楼顶，整体平移到楼基的量
   * - lean：轮廓把楼顶和楼基并在一起描了（一侧是楼顶边、另一侧是墙脚），楼顶相对楼基的偏移；
   *   生成时把轮廓朝 lean 方向多出的那一条切掉，只留楼基。量法：卫星图上露出的那面墙有多宽，lean 就有多长，方向朝墙的反面
   * - storeys：地上层数，不写按 OSM 的 building:levels，再没有按 4 层
   * - drop：OSM 轮廓和实际的楼对不上（形状错、楼已拆），不画它，改在 newBuildings 里重描
   */
  buildings: Record<string, { shift?: P; lean?: P; storeys?: number; drop?: boolean }>;
  /** OSM 里没有的楼：poly 直接描墙脚（楼基），不起名 */
  newBuildings: { poly: P[]; storeys: number }[];
  areas: { kind: AreaKind; poly: P[] }[];
  /** 每棵树：树干位置和冠幅半径（米） */
  trees: [number, number, number][];
  /** 一排等间距的树（行道树）：从 from 到 to（两端都种），间距 gap 米，冠幅半径 r 米 */
  treeRows: { from: P; to: P; gap: number; r: number }[];
  /**
   * 垂直车位排：每个车位宽 2.5 m、深 5 m。at 是底线的起点（北端或西端），back 是底线在车位的哪一侧，
   * n 个车位从 at 起沿底线往南（底线在东西侧时）或往东（底线在南北侧时）排
   */
  stalls: { at: P; n: number; back: 'N' | 'E' | 'S' | 'W' }[];
  /** 北门以外的校门：校界栅栏在 at 处断开 width 米 */
  gates: { at: P; width: number }[];
}

export function loadSurvey(): Survey {
  return JSON.parse(readFileSync(new URL('../data/survey.json', import.meta.url), 'utf8'));
}
