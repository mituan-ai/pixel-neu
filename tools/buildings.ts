// 楼的模型：OSM 轮廓（按 survey.json 校正）和补描的楼，按 1 m = 8 px 算出楼基像素和每个像素的高度。
// 地图工具用楼基挡路、铺地面，美术工具用高度画楼；两边各算一次，结果一样。
import { BUILDING } from './tiles.ts';
import { toWorld, type P } from './geo.ts';
import { PPM, fillShape, inPoly, inShape } from './shape.ts';
import type { Feature, Part, Shape, Survey } from './survey.ts';
import { EXTENT } from './geo.ts';

export interface OsmEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** 楼的一个高度分区：墙高、屋顶（像素） */
export interface PartModel {
  wall: number;
  roof: NonNullable<Part['roof']>;
  rise: number;
  /** 看台朝向的点（世界像素） */
  toward?: P;
  /** 这个分区换用的楼型 */
  look?: string;
}

/** 落在这栋楼墙上的门（世界米坐标） */
export type DoorModel = Survey['doors'][number];

export interface BuildingModel {
  id: number;
  name: string;
  style: 'info' | 'library' | 'plain';
  /** 楼基外接框（世界像素，以 EXTENT 西北角为原点） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 外接框里每个像素属于哪个分区：0 不是楼，k 是 parts[k - 1] */
  part: Uint8Array;
  parts: PartModel[];
  /** 顶上另加的高度（信息学馆的塔顶） */
  extraTop: number;
  /** 楼型、单栋微调和特色构件（见 survey.ts 的 Appearance） */
  look: string;
  tweak: Record<string, unknown>;
  features: Feature[];
  doors: DoorModel[];
}

/** 只给核实过名字的楼标名字 */
const NAMED: Record<number, { name: string; style: BuildingModel['style'] }> = {
  87664797: { name: '信息学馆', style: 'info' },
  87664798: { name: '宁恩承图书馆', style: 'library' },
};

export const levelPx = (storeys: number) => storeys * BUILDING.storey + BUILDING.plinth + BUILDING.parapet;

function partOf(p: { storeys?: number; height?: number; roof?: Part['roof']; rise?: number; toward?: P; look?: string }, storeys: number): PartModel {
  return {
    look: p.look,
    wall: p.height !== undefined ? Math.round(p.height * PPM) : levelPx(p.storeys ?? storeys),
    roof: p.roof ?? 'flat',
    rise: Math.round((p.rise ?? 0) * PPM),
    toward: p.toward && [(p.toward[0] - EXTENT.x0) * PPM, (p.toward[1] - EXTENT.y0) * PPM],
  };
}

/** 全部楼的模型；gateX 是北门的世界米 x（信息学馆中央塔楼按它定） */
export function loadBuildings(osm: { elements: OsmEl[] }, survey: Survey, gateX: number): BuildingModel[] {
  const sources: { id: number; shape: Shape; levels: number }[] = [
    ...osm.elements
      .filter((e) => e.type === 'way' && e.tags.building && e.geometry)
      .map((e) => ({ id: e.id, shape: { poly: e.geometry!.map((g) => toWorld(g.lat, g.lon)) }, levels: Number(e.tags['building:levels']) || 0 })),
    // survey.json 里补描的楼（没有 OSM 编号，用负数）
    ...survey.newBuildings.map((b, k) => ({ id: -(k + 1), shape: b as Shape, levels: b.storeys })),
  ];
  const out: BuildingModel[] = [];
  for (const src of sources) {
    const fix = src.id > 0 ? (survey.buildings[src.id] ?? {}) : survey.newBuildings[-src.id - 1];
    if ('drop' in fix && fix.drop) continue;
    const shift = ('shift' in fix && fix.shift) || [0, 0];
    const lean = 'lean' in fix ? fix.lean : undefined;
    const storeys = fix.storeys ?? (src.levels || 4);
    const shape: Shape = src.shape.poly ? { poly: src.shape.poly.map(([x, y]): P => [x + shift[0], y + shift[1]]) } : src.shape;
    // 楼基像素；lean 时只留往楼顶方向挪 lean 后仍在轮廓里的像素
    const px: number[] = [];
    fillShape(shape, (x, y) => {
      if (lean) {
        const wx = EXTENT.x0 + (x + 0.5) / PPM + lean[0], wy = EXTENT.y0 + (y + 0.5) / PPM + lean[1];
        if (!inPoly([wx, wy], shape.poly!)) return;
      }
      px.push(x, y);
    });
    if (!px.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < px.length; k += 2) (x0 = Math.min(x0, px[k])), (x1 = Math.max(x1, px[k])), (y0 = Math.min(y0, px[k + 1])), (y1 = Math.max(y1, px[k + 1]));
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const meta = NAMED[src.id] ?? { name: '', style: 'plain' as const };
    const b: BuildingModel = {
      id: src.id, name: fix.name ?? meta.name, style: meta.style, x: x0, y: y0, w, h, part: new Uint8Array(w * h), parts: [partOf({ ...fix, look: undefined }, storeys)], extraTop: 0,
      look: fix.look ?? 'neutral', tweak: fix.tweak ?? {}, features: fix.features ?? [], doors: [],
    };
    for (let k = 0; k < px.length; k += 2) b.part[(px[k + 1] - y0) * w + px[k] - x0] = 1;
    // 门：从门洞中点往墙里退 1 m 落在这栋楼上的，算这栋楼的门
    const inside = (wx: number, wy: number) => {
      const x = Math.floor((wx - EXTENT.x0) * PPM) - x0, y = Math.floor((wy - EXTENT.y0) * PPM) - y0;
      return x >= 0 && y >= 0 && x < w && y < h && b.part[y * w + x] > 0;
    };
    const IN: Record<string, P> = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] };
    b.doors = survey.doors.filter((d) => inside(d.at[0] + IN[d.facing][0], d.at[1] + IN[d.facing][1]));
    const zones: Part[] = [...(fix.parts ?? [])];
    // 信息学馆（据航拍 R-info-06-02、正面照 R-info-01）：两翼 5 层；中轴上的中央楼 7 层，宽约 26 m、
    // 从北墙往南约 19.5 m（宽深据卫星图 S7 上中央楼的屋面）；楼顶再有退台、小塔和旗杆
    if (meta.style === 'info') {
      b.parts[0] = partOf({ storeys: 5 }, 5);
      const north = EXTENT.y0 + y0 / PPM;
      zones.push({ poly: [[gateX - 13, north], [gateX + 13, north], [gateX + 13, north + 19.5], [gateX - 13, north + 19.5]], storeys: 7 });
      b.extraTop = 4 * BUILDING.storey;
    }
    zones.forEach((z, k) => {
      b.parts.push(partOf(z, storeys));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (b.part[i] && inShape([EXTENT.x0 + (x0 + x + 0.5) / PPM, EXTENT.y0 + (y0 + y + 0.5) / PPM], z)) b.part[i] = k + 2;
        }
    });
    out.push(b);
  }
  return out;
}

/** 每个像素的屋面高度（像素）：平顶是墙高；穹顶按分区外接椭圆起拱；看台每 0.8 m 一排台阶，从朝 toward 的一边升到墙高 */
export function heights(b: BuildingModel): Float32Array {
  const hgt = new Float32Array(b.w * b.h);
  b.parts.forEach((p, k) => {
    const idx: number[] = [];
    for (let i = 0; i < b.part.length; i++) if (b.part[i] === k + 1) idx.push(i);
    if (!idx.length) return;
    if (p.roof === 'flat') {
      for (const i of idx) hgt[i] = p.wall;
      return;
    }
    if (p.roof === 'gable' || p.roof === 'hip') {
      // 坡屋顶：屋脊沿外接框长边；双坡只按到长边的距离起坡，四坡再加上到短边的距离
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of idx) (x0 = Math.min(x0, i % b.w)), (x1 = Math.max(x1, i % b.w)), (y0 = Math.min(y0, (i / b.w) | 0)), (y1 = Math.max(y1, (i / b.w) | 0));
      const wide = x1 - x0 >= y1 - y0, half = ((wide ? y1 - y0 : x1 - x0) + 1) / 2;
      for (const i of idx) {
        const x = i % b.w, y = (i / b.w) | 0;
        const across = wide ? Math.min(y - y0, y1 - y) : Math.min(x - x0, x1 - x);
        const along = wide ? Math.min(x - x0, x1 - x) : Math.min(y - y0, y1 - y);
        const d = p.roof === 'hip' ? Math.min(across, along) : across;
        hgt[i] = p.wall + p.rise * Math.min(1, (d + 0.5) / half);
      }
      return;
    }
    if (p.roof === 'dome') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of idx) (x0 = Math.min(x0, i % b.w)), (x1 = Math.max(x1, i % b.w)), (y0 = Math.min(y0, (i / b.w) | 0)), (y1 = Math.max(y1, (i / b.w) | 0));
      const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
      for (const i of idx) {
        const u = ((i % b.w) + 0.5 - cx) / rx, v = (((i / b.w) | 0) + 0.5 - cy) / ry;
        hgt[i] = p.wall + p.rise * Math.sqrt(Math.max(0, 1 - u * u - v * v));
      }
      return;
    }
    // 排和「分区中心 → toward」垂直，所以直看台的座位排是直的
    const cx = idx.reduce((a, i) => a + (i % b.w), 0) / idx.length + b.x + 0.5, cy = idx.reduce((a, i) => a + ((i / b.w) | 0), 0) / idx.length + b.y + 0.5;
    const [tx, ty] = p.toward ?? [cx, cy + 1];
    const l = Math.hypot(tx - cx, ty - cy) || 1, ux = (tx - cx) / l, uy = (ty - cy) / l;
    const d = idx.map((i) => -((b.x + (i % b.w) + 0.5 - cx) * ux + (b.y + ((i / b.w) | 0) + 0.5 - cy) * uy));
    const d0 = d.reduce((a, v) => Math.min(a, v)), rows = Math.max(1, Math.ceil((d.reduce((a, v) => Math.max(a, v)) - d0) / (0.8 * PPM)));
    idx.forEach((i, k2) => (hgt[i] = Math.round((p.wall * (Math.min(rows - 1, Math.floor((d[k2] - d0) / (0.8 * PPM))) + 1)) / rows)));
  });
  return hgt;
}
