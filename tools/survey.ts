// data/survey.json：从卫星图（S7）描下来的地面、楼、树和物件，坐标都是世界米坐标（上北，见 geo.ts）。
// 后写的面盖住先写的面，所以先写大面（街区底面、草地、林地），再写路和铺装。
// 生成器按 1 m = 8 px 直接把这些形状画成像素，不再先落到 2 m 的格子上，所以弧线、斜线和非整格的宽度都能画准。
import { readFileSync } from 'node:fs';
import type { P } from './geo.ts';

/** wood：林地，地面是草，树冠按轮廓成片；单棵树看不清的林子都用它 */
/** track：塑胶跑道；pitch：足球场草皮（天然或人工）；court：硬地球场 */
export type AreaKind = 'asphalt' | 'paving' | 'plaza' | 'sidewalk' | 'slab' | 'permeable' | 'dirt' | 'parking' | 'grass' | 'wood' | 'hedge' | 'planter' | 'water' | 'track' | 'pitch' | 'court';

/**
 * 一块地面的形状，四种写法选一种：
 * - poly：多边形顶点
 * - line + width：沿中线 line 宽 width 米的带子（路、步道）。两端是平头；
 *   curve 是中线折点处的圆弧半径（弯路写成几个折点加 curve，生成器自动倒圆弧）；
 *   corner 是这条路两端和别的路相接处的转角半径（路沿倒圆），只对 asphalt 有效，默认 4 m；
 *   dash 在中线上画白色虚线（双车道的车行道）
 * - circle：[圆心 x, 圆心 y, 半径]
 * - ellipse：[圆心 x, 圆心 y, 东西半轴, 南北半轴]
 */
export interface Shape {
  poly?: P[];
  line?: P[];
  width?: number;
  curve?: number;
  corner?: number;
  dash?: boolean;
  circle?: [number, number, number];
  ellipse?: [number, number, number, number];
}

/**
 * 楼的一个高度分区（世界米坐标，楼基坐标系）：楼基里落在这个形状内的部分按这里的高度和屋顶画，
 * 后写的分区盖住先写的。分区只改高度，不扩大楼基。
 * - storeys：层数（一层 3.6 m）；height：直接给高度（米），给了就不看 storeys
 * - roof：flat 平顶（默认）；dome 穹顶，墙高之上再拱起 rise 米，按分区外接椭圆起拱；
 *   stands 看台，座位从朝 toward 的一边起、到背向的一边升到全高，按 0.8 m 一排画台阶，排和「分区中心 → toward」垂直；
 *   gable 双坡，屋脊沿分区外接框的长边，檐口到屋脊升 rise 米；hip 四坡，四面都从檐口升到屋脊
 * - look：这个分区换一种楼型（例如裙楼是石材、塔楼是幕墙），不写跟整栋楼
 */
export interface Part extends Shape {
  storeys?: number;
  height?: number;
  roof?: 'flat' | 'dome' | 'stands' | 'gable' | 'hip';
  rise?: number;
  toward?: P;
  look?: string;
}

/** 立面朝向（墙面朝外的地理方向） */
export type Face = 'N' | 'E' | 'S' | 'W';

/**
 * 楼的特色构件，画在 face 那面墙上从 from 到 to 的一段（两点都在墙脚线上，世界米坐标）。
 * storeys 是 [起层, 止层]，层号从 0 数（0 是首层），不写就是整面墙高：
 * - stair：外挂楼梯，之字形梯段加栏杆，一层一折
 * - void：镂空或架空，这一段墙后是空的（看进去是暗的），两边留柱
 * - screen：花格或格栅，墙面前一层镂空格子，pitch 是格子间距（米，默认 1）
 * - glass：竖向通高玻璃带（楼梯间、门厅）
 * - colonnade：柱廊，pitch 米一根柱子（默认 4），柱间是暗的廊下
 * - band：一道横向饰带（color 是色板颜色名），常见于檐口下、层间
 */
export interface Feature {
  kind: 'stair' | 'void' | 'screen' | 'glass' | 'colonnade' | 'band';
  face: Face;
  from: P;
  to: P;
  storeys?: [number, number];
  pitch?: number;
  color?: string;
}

/**
 * 楼的外观，写在 buildings、newBuildings 的条目里：
 * - look：楼型名（tools/facades.ts 的 LOOKS），相似的楼共用一个；不写用 neutral（中性立面）
 * - tweak：只改这栋楼的几个参数（字段同 Look，例如换墙色、窗宽）
 * - features：特色构件（见 Feature）
 * - src：外观依据的来源编号（R 号、S 号），和 name 的 src 合写在一起
 */
export interface Appearance {
  look?: string;
  tweak?: Record<string, unknown>;
  features?: Feature[];
}

/**
 * 标准运动场，按规定尺寸生成地面、标线和球门，卫星图只用来定位置和朝向：
 * - track：400 m 标准跑道（直道 84.39 m、弯道内沿半径 36.5 m，lanes 条 1.22 m 宽的跑道，默认 8），内场是足球场
 * - football：足球场 length × width（默认 105 × 68）
 * - basketball 28 × 15、tennis 23.77 × 10.97（双打线）、volleyball 18 × 9：只画场线，场地底色另用 court 面描
 * at 是场地中心；angle 是长轴相对正南北的转角（度，顺时针），默认 0
 */
export interface Field {
  type: 'track' | 'football' | 'basketball' | 'tennis' | 'volleyball';
  at: P;
  angle?: number;
  lanes?: number;
  length?: number;
  width?: number;
}

export interface Survey {
  /**
   * OSM 楼轮廓的校正（米）。卫星图是斜着拍的，楼顶会偏离楼基，楼越高偏得越多，OSM 描的轮廓常常是楼顶：
   * - shift：轮廓是楼顶，整体平移到楼基的量（形状不变）。用 npm run parallax 量
   * - lean：只用于轮廓把楼顶和露出的立面一起描进去的楼（轮廓比两期卫星图上的楼顶都宽出 |lean|）：
   *   生成时把轮廓和自己朝 -lean 平移的那份取交集。这样会把与 lean 垂直的翼都削薄 |lean|，
   *   轮廓只是楼顶时千万不要用，用 shift
   * - storeys：地上层数，不写按 OSM 的 building:levels，再没有按 4 层
   * - height、roof、rise、toward：整栋楼的高度和屋顶（见 Part）
   * - parts：高度分区（楼基坐标系，见 Part）
   * - drop：OSM 轮廓和实际的楼对不上（形状错、楼已拆），不画它，改在 newBuildings 里重描
   * - name、src：楼名和它的来源编号（docs/sources.md 的 S 号，逗号分隔）；不写就没有名字，OSM 的 name 不自动用
   */
  buildings: Record<string, Appearance & { shift?: P; lean?: P; storeys?: number; height?: number; roof?: Part['roof']; rise?: number; toward?: P; parts?: Part[]; drop?: boolean; name?: string; src?: string }>;
  /** OSM 里没有的楼：形状直接描墙脚（楼基）；height、roof、rise、toward、parts、name、src 和外观同上 */
  newBuildings: (Shape & Appearance & { storeys: number; height?: number; roof?: Part['roof']; rise?: number; toward?: P; parts?: Part[]; name?: string; src?: string })[];
  /**
   * 视差标定（npm run parallax 用）：box [x0, y0, x1, y1] 范围里的楼，以 ref 这栋 OSM 楼为参考算每期卫星图的斜拍偏移。
   * ref 的 shift 和 storeys 必须是对着墙脚、立面照片量准的。卫星图是几次航拍拼起来的，换一片偏移方向和大小都会变，所以按范围分别标定。
   * off 是第二期（2026-10-29）地面相对第一期错开的米数：两期对照图上量同一个路口或路面标线，不写按 [0, 0]
   */
  tilt: { box: [number, number, number, number]; ref: number; off?: P }[];
  areas: (Shape & { kind: AreaKind })[];
  /** 路面标线：斑马线中线和横道宽；停止线；箭头朝向（上北为 0°，顺时针）；减速带 */
  marks: ({ kind: 'zebra'; from: P; to: P; width: number } | { kind: 'stop'; from: P; to: P } | { kind: 'arrow'; at: P; dir: number; shape: 'straight' | 'left' | 'right' } | { kind: 'bump'; from: P; to: P })[];
  /** 标准运动场（见 Field），画在 areas 之上 */
  fields: Field[];
  /** 每棵树：树干位置和冠幅半径（米） */
  trees: [number, number, number][];
  /** 一排等间距的树（行道树）：从 from 到 to（两端都种），间距 gap 米，冠幅半径 r 米 */
  treeRows: { from: P; to: P; gap: number; r: number }[];
  /** 一排等间距的路灯：从 from 到 to（两端都放），间距 gap 米；sprite 不写用 lamp */
  lampRows: { from: P; to: P; gap: number; sprite?: string }[];
  /**
   * 单个物件：sprite 是 props 图集里的名字（四个视角的物件只写名字，不带 @N），at 是占地中心，
   * size 是占地东西、南北宽（米，挡路），rot 是相对美术朝向顺时针转了几个 90°；flat 平铺在地上、可以走
   */
  props: { sprite: string; at: P; size: P; rot?: number; flat?: boolean }[];
  /**
   * 垂直车位排：每个车位宽 2.5 m、深 5 m。at 是底线的起点（北端或西端），back 是底线在车位的哪一侧，
   * n 个车位从 at 起沿底线往南（底线在东西侧时）或往东（底线在南北侧时）排
   */
  stalls: { at: P; n: number; back: 'N' | 'E' | 'S' | 'W' }[];
  /** 北门以外的校门：校界栅栏在 at 处断开 width 米 */
  gates: { at: P; width: number }[];
  /**
   * 楼门：at 是门洞中点（落在墙脚线上），facing 是门朝外的方向，main 是正门。
   * 楼的贴图按它在墙上开门洞：width 门洞宽（米，默认正门 3、侧门 1.8），height 门洞高（米，默认 2.6）；
   * canopy 是门头：slab 一块挑出的雨棚板（正门默认），portico 两根柱子撑的门廊，none 没有（侧门默认）
   */
  doors: { at: P; facing: Face; main?: boolean; width?: number; height?: number; canopy?: 'slab' | 'portico' | 'none' }[];
  /** 单车停放排：车头朝向和排垂直，从 from 到 to 每 0.7 m 一辆；covered 是有棚的（多为电动车棚） */
  bikeRacks: { from: P; to: P; covered?: boolean }[];
  /** 兴趣点（介绍卡片）：at 是卡片触发的位置（楼的正门外、纪念物旁），text 每句都要有来源，src 是 S 号，逗号分隔 */
  places: { name: string; at: P; text: string; src: string }[];
}

export function loadSurvey(): Survey {
  return JSON.parse(readFileSync(new URL('../data/survey.json', import.meta.url), 'utf8'));
}
